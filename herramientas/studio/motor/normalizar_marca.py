#!/usr/bin/env python
"""
Pulppo Studio — normalizador de marca para templates de Polotno.

Aplica las reglas de marca decididas por Ale el 6 ago 2026 a cualquier template,
para que los diseños que lleguen después salgan iguales sin revisarlos a mano:

  1. El amarillo (#F6BE00) va SOLO en líneas y reglas. Nunca en texto.
     · texto amarillo  → blanco si la pieza es oscura, tinta si es clara
     · bloque amarillo detrás de texto → blanco, y el texto encima pasa a tinta
     · líneas y filetes amarillos → SE QUEDAN amarillos
  2. El usuario de Instagram no va en el diseño (va en la caption).
  3. Los logos no se recortan: se marca `fit: contain` para el renderer.
  4. Toda fontFamily tiene que estar embebida en el propio archivo. "Nunito Sans" (con espacio)
     NO lo está — las embebidas se llaman NunitoSans_10pt-*. En una Mac con la fuente instalada
     no se nota; en un celular cae a Arial. Detectado el 18 ago 2026 por Ale, en su teléfono.

Uso:
  python normalizar_marca.py --dry-run     # solo reporta
  python normalizar_marca.py               # aplica y guarda copia en originales/
"""
import argparse
import json
import re
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
TPL_DIR = BASE.parent / "contenido-valor"
BACKUP = TPL_DIR / "originales"

TINTA = "rgba(33,35,34,1)"
BLANCO = "rgba(255,255,255,1)"
GRUESO_LINEA = 10          # ≤ 10px de alto o ancho = línea, no bloque

# Excepción pedida por Ale (6 ago): el numeral chico de una lista numerada puede quedarse
# amarillo — funciona como viñeta, casi como una línea. El número GIGANTE protagonista no:
# ahí el amarillo pasa a ser un bloque de texto, que es justo lo que no queremos.
# Se aplica solo en algunos diseños, para que el sistema no quede monótono.
NUMERAL_AMARILLO = {"consejo_3-pasos_post.json", "zonas_top5_post.json",
                    "consejo_swipe_post.json"}


# fontFamily pedida → la equivalente que sí viene embebida
ALIAS_FUENTE = {"Nunito Sans": ("NunitoSans_10pt-Regular", "NunitoSans_10pt-Bold")}


def es_numeral_de_lista(c):
    t = str(c.get("text") or "").strip()
    return t.isdigit() and len(t) <= 2 and (c.get("fontSize") or 0) <= 80


def rgba(s):
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", str(s or ""))
    return tuple(int(m.group(i)) for i in (1, 2, 3)) if m else None


def es_amarillo(fill):
    c = rgba(fill)
    return bool(c and c[0] > 230 and 170 < c[1] < 215 and c[2] < 60)


def luminancia(fill):
    c = rgba(fill)
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 if c else 1.0


def rect(c):
    return (c.get("x", 0), c.get("y", 0),
            c.get("x", 0) + c.get("width", 0), c.get("y", 0) + c.get("height", 0))


def solapan(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def pieza_oscura(pg, W, H):
    """¿Hay un fondo oscuro que cubra casi todo el lienzo?"""
    area = max(W * H, 1)
    for c in pg.get("children", []):
        if c.get("type") in ("figure", "image"):
            w, h = c.get("width", 0), c.get("height", 0)
            if w * h >= 0.7 * area and luminancia(c.get("fill")) < 0.5:
                return True
    return str(pg.get("background", "")).lower() in ("#212322", "black")


def normalizar(ruta, aplicar):
    d = json.loads(ruta.read_text(encoding="utf-8"))
    W, H = d.get("width", 1080), d.get("height", 1350)
    cambios = []

    for ip, pg in enumerate(d.get("pages", []), 1):
        oscura = pieza_oscura(pg, W, H)
        hijos = pg.get("children", [])

        # 1a · bloques amarillos → blancos (las líneas se quedan)
        blanqueados = []
        for c in hijos:
            if c.get("type") == "text" or not es_amarillo(c.get("fill")):
                continue
            delgado = min(c.get("width", 0), c.get("height", 0)) <= GRUESO_LINEA
            if c.get("type") == "line" or delgado:
                cambios.append(f"p{ip} línea amarilla · se queda")
                continue
            if aplicar:
                c["fill"] = BLANCO
            blanqueados.append(rect(c))
            cambios.append(f"p{ip} bloque amarillo {int(c.get('width',0))}x{int(c.get('height',0))} → blanco")

        # 1b · texto amarillo → blanco o tinta
        for c in hijos:
            if c.get("type") != "text":
                continue
            if es_amarillo(c.get("fill")):
                if ruta.name in NUMERAL_AMARILLO and es_numeral_de_lista(c):
                    cambios.append(f"p{ip} numeral '{str(c.get('text')).strip()}' · se queda amarillo (excepción)")
                    continue
                nuevo = BLANCO if oscura else TINTA
                if aplicar:
                    c["fill"] = nuevo
                cambios.append(f"p{ip} texto amarillo {repr(str(c.get('text'))[:22])} → "
                               + ("blanco" if nuevo == BLANCO else "tinta"))

        # 1c · texto sobre un bloque recién blanqueado → tinta, o queda invisible
        for c in hijos:
            if c.get("type") != "text":
                continue
            if any(solapan(rect(c), b) for b in blanqueados) and luminancia(c.get("fill")) > 0.7:
                if aplicar:
                    c["fill"] = TINTA
                cambios.append(f"p{ip} texto sobre bloque blanqueado → tinta (era invisible)")

        # 2 · fuera el usuario de Instagram
        quitar = [c for c in hijos
                  if "broker.handle" in str(c.get("text") or "") + str(c.get("name") or "")]
        for c in quitar:
            if aplicar:
                hijos.remove(c)
            cambios.append(f"p{ip} elemento con el usuario de Instagram → eliminado")

        # 4 · fuentes no embebidas → su equivalente embebida (bold si el texto va en negrita)
        disponibles = {f.get("fontFamily") for f in d.get("fonts", [])}
        for c in hijos:
            fam = c.get("fontFamily")
            if c.get("type") != "text" or not fam or fam in disponibles:
                continue
            if fam in ALIAS_FUENTE:
                reg, bold = ALIAS_FUENTE[fam]
                nueva = bold if str(c.get("fontWeight", "")) in ("700", "bold") else reg
                if aplicar:
                    c["fontFamily"] = nueva
                cambios.append(f"p{ip} fuente '{fam}' no embebida → {nueva}")
            else:
                cambios.append(f"p{ip} ⚠️ fuente '{fam}' no embebida y sin equivalente conocida")

        # 3 · los logos no se recortan
        for c in hijos:
            if re.search(r"logo", str(c.get("name") or ""), re.I) and c.get("type") == "image":
                if c.get("fit") != "contain":
                    if aplicar:
                        c["fit"] = "contain"
                    cambios.append(f"p{ip} logo · fit=contain (no recortar)")

    if aplicar and cambios:
        BACKUP.mkdir(exist_ok=True)
        dest = BACKUP / ruta.name
        if not dest.exists():
            shutil.copy2(ruta, dest)
        ruta.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return cambios


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    refs = (sorted(TPL_DIR.glob("*.json")) + sorted((TPL_DIR / "stories").glob("*.json"))
            + sorted((TPL_DIR / "propiedad").glob("*.json")))
    total = 0
    for r in refs:
        cambios = normalizar(r, aplicar=not a.dry_run)
        if cambios:
            print(f"\n{r.relative_to(TPL_DIR)}")
            for c in cambios:
                print(f"   · {c}")
            total += len(cambios)
    print(f"\n{'(dry-run) ' if a.dry_run else ''}{total} cambios en {len(refs)} templates")
    if not a.dry_run and total:
        print(f"Originales respaldados en {BACKUP.relative_to(TPL_DIR.parent)}/")


if __name__ == "__main__":
    main()
