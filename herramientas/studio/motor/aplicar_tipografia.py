#!/usr/bin/env python3
"""Reglas de tipografía de Ale sobre los templates (2-sep-2026).

1. **Heldane sólo para títulos y números.** Todo el cuerpo va en Nunito Sans. Auditados los
   17, sólo dos textos de cuerpo estaban en Heldane: la bajada de `dato_declaracion_post` y
   el contexto de `historia_dato_story`. Son justo los dos que Ale no podía leer.
2. **Las etiquetas de arriba** (GUÍA · REQUISITOS · CONSEJO INMOBILIARIO · {{tema}} ·
   {{ciudad}}) van en mayúsculas, Nunito Sans, y **más chicas**. Las literales ya venían en
   mayúsculas; las que son token traen el valor capitalizado de Mongo ("Polanco"), así que
   se fuerzan con `textTransform` —soportado en los dos renderizadores desde hoy— y se les
   da un poco de interletra, que es lo que hace legible una versalita chica.
3. **El filete amarillo, más delgado.**
4. **El texto crece en stories.** Estaban al revés: la frase de la story pesaba 78 y la del
   post 80, con 570px más de alto para usar. Se sube el cuerpo y los títulos de story.
5. **Fuera "Fuente:"**.

Idempotente: cada regla comprueba el valor actual antes de escribir.
"""
import json
import sys
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor"

NUNITO_R = "NunitoSans_10pt-Regular"
NUNITO_B = "NunitoSans_10pt-Bold"

# --- 1. cuerpo que estaba en Heldane y además se quedaba corto de tamaño ---
A_NUNITO = {
    # archivo: [(texto que identifica el elemento, fuente nueva, tamaño nuevo)]
    "dato_declaracion_post.json":       [("{{bajada}}",   NUNITO_R, 52)],
    "stories/historia_dato_story.json": [("{{contexto}}", NUNITO_R, 56)],
}

# --- 2. etiquetas: mayúsculas, más chicas, con interletra ---
ETIQUETAS = {
    "consejo_3-pasos_post.json":            [("GUÍA", 20)],
    "consejo_requisitos_post.json":         [("REQUISITOS", 20)],
    "zonas_los-mejores_post.json":          [("CONSEJO INMOBILIARIO", 20)],
    "consejo_5-ventajas_post.json":         [("{{ciudad}}", 20)],
    "zonas_top5_post.json":                 [("{{ciudad}}", 20)],
    "dato_declaracion_post.json":           [("{{tema}}", 20)],
    "frase_quote_post.json":                [("{{tema}}", 20)],
    "pregunta_portada_post.json":           [("{{tema}}", 20)],
    # en stories la etiqueta puede ser un punto más grande: se ve de más lejos
    "stories/historia_dato_story.json":     [("{{tema}}", 22)],
    "stories/historia_frase_story.json":    [("{{tema}}", 22)],
    "stories/historia_pregunta_story.json": [("{{tema}}", 22)],
    "stories/historia_zona_story.json":     [("{{ciudad}}", 22)],
}

# --- 3. filete amarillo: 4px y 3px → 2px ---
AMARILLO = "rgba(246,190,0"
FILETE_ALTO = 2

# --- 4. stories: el título y el cuerpo crecen ---
STORIES_MAS_GRANDE = {
    "stories/historia_frase_story.json":    [("{{frase}}", 96)],
    "stories/historia_pregunta_story.json": [("¿{{pregunta}}?", 112)],
    "stories/historia_zona_story.json":     [("{{zona}}", 104), ("{{bajada}}", 40)],
}

# --- 5. textos que se van ---
A_BORRAR = {"stories/historia_dato_story.json": ["Fuente:"]}


def textos(d):
    for p in d.get("pages") or []:
        for c in p.get("children") or []:
            if c.get("type") == "text":
                yield p, c


def cargar(ref):
    return json.loads((TPL / ref).read_text(encoding="utf-8"))


def guardar(ref, d):
    (TPL / ref).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def procesar(ref, escribir=True):
    d = cargar(ref)
    cambios = []

    for marca, fuente, tam in A_NUNITO.get(ref, []):
        for _, c in textos(d):
            if marca in (c.get("text") or "") and (
                    c.get("fontFamily") != fuente or c.get("fontSize") != tam):
                cambios.append(f"cuerpo {marca}: {c.get('fontFamily')} {c.get('fontSize')} "
                               f"→ {fuente} {tam}")
                c["fontFamily"], c["fontSize"] = fuente, tam

    for marca, tam in ETIQUETAS.get(ref, []):
        for _, c in textos(d):
            if (c.get("text") or "").strip() == marca:
                antes = (c.get("fontSize"), c.get("textTransform"), c.get("letterSpacing"))
                # la interletra escala con el cuerpo: ~9% es lo que abre una versalita sin
                # que se desarme la palabra
                nuevo = (tam, "uppercase", round(tam * 0.09, 1))
                if antes != nuevo:
                    cambios.append(f"etiqueta {marca!r}: {antes[0]} → {tam}, mayúsculas, "
                                   f"interletra {nuevo[2]}")
                    c["fontSize"], c["textTransform"], c["letterSpacing"] = nuevo
                    c["fontFamily"] = NUNITO_B

    for p in d.get("pages") or []:
        for c in p.get("children") or []:
            if (c.get("type") == "figure" and str(c.get("fill", "")).startswith(AMARILLO)
                    and (c.get("height") or 0) > FILETE_ALTO):
                cambios.append(f"filete amarillo: {round(c['height'])}px → {FILETE_ALTO}px")
                c["height"] = FILETE_ALTO

    for marca, tam in STORIES_MAS_GRANDE.get(ref, []):
        for _, c in textos(d):
            if (c.get("text") or "").strip() == marca and c.get("fontSize") != tam:
                cambios.append(f"story {marca}: {c.get('fontSize')} → {tam}")
                c["fontSize"] = tam

    for marca in A_BORRAR.get(ref, []):
        for p in d.get("pages") or []:
            antes = len(p.get("children") or [])
            p["children"] = [c for c in (p.get("children") or [])
                             if not (c.get("type") == "text" and marca in (c.get("text") or ""))]
            if len(p["children"]) != antes:
                cambios.append(f"borrado el texto que empieza con {marca!r}")

    if cambios and escribir:
        guardar(ref, d)
    return cambios


def main():
    seco = "--dry-run" in sys.argv
    refs = sorted(set(list(A_NUNITO) + list(ETIQUETAS) + list(STORIES_MAS_GRANDE)
                      + list(A_BORRAR) + [p.name for p in TPL.glob("*.json")]
                      + ["stories/" + p.name for p in (TPL / "stories").glob("*.json")]))
    tocados = 0
    for ref in refs:
        cambios = procesar(ref, escribir=not seco)
        if cambios:
            tocados += 1
            print(f"{ref}")
            for c in cambios:
                print(f"    {c}")
    print(f"\n{tocados} templates con cambios{' (simulacro)' if seco else ''}.")


if __name__ == "__main__":
    main()
