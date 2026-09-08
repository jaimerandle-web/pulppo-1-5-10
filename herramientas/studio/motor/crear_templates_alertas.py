#!/usr/bin/env python3
"""Crea los templates de las dos alertas nuevas: Baja de precio y Nueva propiedad.

Los dos se derivan de `cierre_exitoso_post/story`, que ya trae resuelto lo caro: foto del
aviso a sangre, velo para que el texto blanco se lea sobre cualquier foto, co-marca con la
variante correcta, la línea de ubicación y el auto-ajuste de título. Diseñar de cero significaría
re-resolver todo eso y volver a equivocarse.

**Baja de precio** lleva el lockup "BAJA DE PRECIO" que ya existía como vector en la marca
(`~/Downloads/baja de precio.svg`, nov-2023) — y su amarillo `#f6be00` ES el acento actual de
Studio, así que no hay que recolorear nada. Debajo, el precio anterior tachado y el nuevo grande.

**Nueva propiedad** es la misma anatomía con otro mensaje: hasta ahora el evento de captación
existía pero reusaba el template genérico de propiedad, que no dice que sea nueva.

Idempotente: no sobreescribe si el archivo ya existe, salvo con --forzar.
"""
import base64
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
TPL = BASE.parent / "contenido-valor" / "propiedad"
SVG_BAJA = Path.home() / "Downloads" / "baja de precio.svg"

BLANCO = "rgba(255,255,255,1)"
NUN_R = "NunitoSans_10pt-Regular"
NUN_B = "NunitoSans_10pt-Bold"
HELD = "HeldaneTextRegular"


def texto(name, txt, x, y, w, size, fam=NUN_R, fill=BLANCO, align="center",
          tachado=False, autofit=False, ls=0, upper=False):
    e = {"type": "text", "name": name, "text": txt, "x": x, "y": y, "width": w,
         "height": round(size * 1.3), "fontSize": size, "fontFamily": fam, "fill": fill,
         "align": align, "lineHeight": 1.3, "letterSpacing": ls, "rotation": 0,
         "opacity": 1, "visible": True}
    if tachado:
        e["textDecoration"] = "line-through"
    if autofit:
        e["autofit"], e["minFontSize"] = True, round(size * 0.7)
    if upper:
        e["textTransform"] = "uppercase"
    return e


def _caja(c):
    return (c.get("x") or 0, c.get("y") or 0,
            (c.get("x") or 0) + (c.get("width") or 0),
            (c.get("y") or 0) + (c.get("height") or 0))


def limpiar_mensaje(pagina):
    """Saca los textos del cierre —cada alerta pone los suyos— Y las pastillas que les servían
    de fondo. Sin esto quedaba una barra negra flotando donde antes iba "¡GRACIAS!": el texto
    se iba pero su respaldo se quedaba. Se identifican por solaparse con el texto que se quita,
    no por posición fija, para que siga funcionando si el template de cierre se rediseña."""
    fuera = ("Cierre Exitoso", "GRACIAS POR SU CONFIANZA")
    hijos = pagina.get("children", [])
    quitados = [_caja(c) for c in hijos
                if c.get("type") == "text" and any(f in (c.get("text") or "") for f in fuera)]

    def respaldaba_texto(c):
        # sólo pastillas opacas y acotadas: el velo a sangre y el bloque del logo se quedan
        if c.get("type") != "figure" or (c.get("width") or 0) > 900:
            return False
        ax, ay, ax2, ay2 = _caja(c)
        area = max((ax2 - ax) * (ay2 - ay), 1)
        for bx, by, bx2, by2 in quitados:
            solape = max(0, min(ax2, bx2) - max(ax, bx)) * max(0, min(ay2, by2) - max(ay, by))
            if solape / area >= 0.5:
                return True
        return False

    pagina["children"] = [
        c for c in hijos
        if not (c.get("type") == "text" and any(f in (c.get("text") or "") for f in fuera))
        and not respaldaba_texto(c)]


def lockup_baja(x, y, w):
    """El vector de marca "BAJA DE PRECIO", embebido como data URI."""
    if not SVG_BAJA.exists():
        return None
    b64 = base64.b64encode(SVG_BAJA.read_bytes()).decode()
    # el viewBox del archivo es 556.56 x 272.42
    return {"type": "svg", "name": "lockup.baja", "x": x, "y": y,
            "width": w, "height": round(w * 272.42 / 556.56),
            "src": "data:image/svg+xml;base64," + b64,
            "rotation": 0, "opacity": 1, "visible": True}


def baja_de_precio(origen, destino, story):
    d = json.loads((TPL / origen).read_text(encoding="utf-8"))
    d["pages"] = d["pages"][:1]                  # una sola versión, no dos variantes
    pg = d["pages"][0]
    limpiar_mensaje(pg)
    H = d["height"]
    y0 = 760 if story else 560
    lock = lockup_baja(96, y0, 480 if story else 430)
    if lock:
        pg["children"].append(lock)
        y0 += lock["height"] + (70 if story else 50)
    tam_ant = 54 if story else 46
    tam_new = 118 if story else 98
    pg["children"] += [
        texto("precio.antes", "$ {{precio_antes}}", 96, y0, d["width"] - 192, tam_ant,
              fam=NUN_R, align="left", tachado=True),
        texto("precio.ahora", "$ {{precio_ahora}}", 96, y0 + round(tam_ant * 1.6),
              d["width"] - 192, tam_new, fam=HELD, align="left", autofit=True),
    ]
    # la ubicación heredada se reacomoda debajo del precio
    for c in pg["children"]:
        if c.get("name") == "{{ubicacion}}":
            c["y"] = y0 + round(tam_ant * 1.6) + round(tam_new * 1.5)
            c["x"], c["align"] = 96, "left"
            c["width"] = d["width"] - 192
    (TPL / destino).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
    return f"{destino}: lockup de marca + precio tachado + precio nuevo"


def nueva_propiedad(origen, destino, story):
    d = json.loads((TPL / origen).read_text(encoding="utf-8"))
    d["pages"] = d["pages"][:1]
    pg = d["pages"][0]
    limpiar_mensaje(pg)
    y0 = 900 if story else 640
    tam = 104 if story else 92
    pg["children"] += [
        texto("etiqueta.nueva", "RECIÉN PUBLICADA", 96, y0, d["width"] - 192,
              22 if story else 20, fam=NUN_B, align="left", ls=2, upper=True),
        texto("titulo.nueva", "Nueva en el mercado.", 96, y0 + 52, d["width"] - 192,
              tam, fam=HELD, align="left", autofit=True),
    ]
    for c in pg["children"]:
        if c.get("name") == "{{ubicacion}}":
            c["y"] = y0 + 52 + round(tam * 1.5)
            c["x"], c["align"] = 96, "left"
            c["width"] = d["width"] - 192
    (TPL / destino).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
    return f"{destino}: etiqueta + titular + ubicación"


PLAN = [
    ("cierre_exitoso_post.json", "baja_precio_post.json", False, baja_de_precio),
    ("cierre_exitoso_story.json", "baja_precio_story.json", True, baja_de_precio),
    ("cierre_exitoso_post.json", "nueva_propiedad_post.json", False, nueva_propiedad),
    ("cierre_exitoso_story.json", "nueva_propiedad_story.json", True, nueva_propiedad),
]


def main():
    forzar = "--forzar" in sys.argv
    if not SVG_BAJA.exists():
        print(f"⚠ no encontré {SVG_BAJA}: la pieza de baja saldrá sin el lockup de marca")
    for origen, destino, story, fn in PLAN:
        if (TPL / destino).exists() and not forzar:
            print(f"{destino}: ya existía, sin tocar (--forzar para regenerar)")
            continue
        print(fn(origen, destino, story))


if __name__ == "__main__":
    main()
