#!/usr/bin/env python3
"""Retro de Ale sobre los 12 artes numerados (3-sep-2026). Idempotente.

Global
  · Nombre y celular del pie, 13% más chicos: con mucha info en la pieza se sentían "too much".
  · El celular ya se imprime sin lada (`55 7893 5745`), resuelto en `telefono_mx`.

Arte 1 · consejo_3-pasos_post — el titular largo partía muy desbalanceado (línea 1 llena,
  línea 2 corta). Se estrecha la caja para que el quiebre reparta mejor.
Arte 2 · consejo_requisitos_post — los cinco requisitos no tenían viñeta. Ya existían cinco
  cuadrados de 34x34 en BLANCO sobre fondo blanco, o sea invisibles: se convierten en el guión
  largo amarillo.
Arte 7 · historia_frase_story — a 96 quedaba una palabra sola colgando en la última línea.
Arte 8 · zonas_top5_post — rearmado completo, que es lo que pidió: la foto con velo, el rótulo
  y el titular ENCIMA de la foto, y abajo sólo los bullets con aire.
"""
import json
import sys
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor"
AMARILLO = "rgba(246,190,0,1)"
GRIS = "rgba(183,183,183,1)"


def leer(ref):
    return json.loads((TPL / ref).read_text(encoding="utf-8"))


def escribir(ref, d):
    (TPL / ref).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def textos(d, pg=0):
    return [c for c in d["pages"][pg].get("children", []) if c.get("type") == "text"]


# --------------------------------------------------------------- global: el pie
# 30 → 26 y 26 → 22: 13%, dentro del 10-15% que pidió
PIE = {"{{broker.name}}": (30, 26), "{{broker.phone}}": (26, 22),
       "{{company.name}}": (26, 22)}


def pie_mas_chico():
    cambios = []
    refs = [p.name for p in TPL.glob("*.json")] + \
           ["stories/" + p.name for p in (TPL / "stories").glob("*.json")]
    for ref in refs:
        d = leer(ref)
        toco = False
        for pg in range(len(d["pages"])):
            for c in textos(d, pg):
                t = (c.get("text") or "").strip()
                if t in PIE:
                    antes, nuevo = PIE[t]
                    if c.get("fontSize") == antes:
                        c["fontSize"] = nuevo
                        cambios.append(f"{ref}: {t} {antes} → {nuevo}")
                        toco = True
        if toco:
            escribir(ref, d)
    return cambios


# ------------------------------------------------------------------- arte por arte
def arte_1():
    ref = "consejo_3-pasos_post.json"
    d = leer(ref)
    for c in textos(d):
        if "en 3 pasos" in (c.get("text") or "") and c.get("width") != 780:
            antes = round(c["width"])
            c["width"] = 780
            escribir(ref, d)
            return [f"{ref}: caja del titular {antes} → 780 (quiebre más balanceado)"]
    return []


def arte_2():
    ref = "consejo_requisitos_post.json"
    d = leer(ref)
    cambios = []
    for c in d["pages"][0]["children"]:
        # los cinco cuadrados blancos invisibles de 34x34 delante de cada requisito
        if (c.get("type") == "figure" and round(c.get("width") or 0) == 34
                and round(c.get("height") or 0) == 34):
            y = round(c.get("y") or 0)
            c["fill"] = AMARILLO
            c["width"], c["height"] = 30, 3      # guión largo
            c["y"] = y + 20                      # a la altura del ojo de la línea
            c["cornerRadius"] = 0
            cambios.append(f"{ref}: viñeta en y={y} → guión amarillo 30x3")
    if cambios:
        escribir(ref, d)
    return cambios


def arte_7():
    ref = "stories/historia_frase_story.json"
    d = leer(ref)
    for c in textos(d):
        if (c.get("text") or "").strip() == "{{frase}}" and c.get("fontSize") != 88:
            antes = c.get("fontSize")
            c["fontSize"] = 88
            escribir(ref, d)
            return [f"{ref}: frase {antes} → 88 (para que no cuelgue una palabra sola)"]
    return []


def arte_8():
    """La foto pasa a ser el fondo del bloque de arriba con velo, el rótulo y el titular van
    ENCIMA en blanco, y abajo queda sólo la lista con más aire entre renglones."""
    ref = "zonas_top5_post.json"
    d = leer(ref)
    hijos = d["pages"][0]["children"]
    if any(c.get("name") == "velo.foto" for c in hijos):
        return ["ya estaba rearmado, sin tocar"]
    cambios = []
    FOTO_H = 620          # menos alto para la foto: pidió que no se amontone abajo
    foto = next((c for c in hijos if (c.get("name") or "").startswith("foto.")), None)
    if foto:
        foto["y"], foto["height"] = 0, FOTO_H
        cambios.append(f"foto → 0..{FOTO_H} (era 0..760)")
    # velo para que el texto blanco se lea sobre cualquier foto
    velo = {"type": "figure", "name": "velo.foto", "x": 0, "y": 0,
            "width": 1080, "height": FOTO_H, "fill": "rgba(33,35,34,1)",
            "opacity": 0.55, "rotation": 0, "visible": True}
    hijos.insert(hijos.index(foto) + 1 if foto else 0, velo)
    cambios.append("velo negro al 55% sobre la foto")

    blanco = "rgba(255,255,255,1)"
    for c in hijos:
        if c.get("type") != "text":
            continue
        t = (c.get("text") or "").strip()
        if t == "{{ciudad}}":
            c["y"], c["fill"] = 96, blanco
            cambios.append("rótulo de ciudad → encima de la foto, en blanco")
        elif t.startswith("Top 5"):
            c["y"], c["fill"], c["height"] = 150, blanco, 190
            c["autofit"], c["minFontSize"] = True, 44
            cambios.append("titular → encima de la foto, en blanco, con auto-ajuste")
    # el filete amarillo, también sobre la foto
    for c in hijos:
        if c.get("type") == "figure" and str(c.get("fill")) == AMARILLO and round(c.get("height") or 0) <= 4:
            c["y"] = 134
            cambios.append("filete amarillo → encima de la foto")
    # la lista arranca debajo de la foto y respira más
    fila = 0
    for c in sorted([c for c in hijos if c.get("type") == "text"
                     and (c.get("text") or "").strip().startswith(("0", "{{lugar"))],
                    key=lambda c: (round(c.get("y") or 0), round(c.get("x") or 0))):
        c["y"] = FOTO_H + 90 + (fila // 2) * 76      # dos elementos por renglón: número y texto
        fila += 1
    cambios.append(f"lista → arranca en {FOTO_H + 90}, renglones cada 76px (eran 64)")
    escribir(ref, d)
    return cambios


def main():
    bloques = [("global · pie más chico", pie_mas_chico), ("arte 1", arte_1),
               ("arte 2", arte_2), ("arte 7", arte_7), ("arte 8", arte_8)]
    for nombre, fn in bloques:
        cambios = fn()
        print(f"{nombre}:")
        for c in (cambios or ["sin cambios"]):
            print(f"    {c}")


if __name__ == "__main__":
    main()
