#!/usr/bin/env python3
"""Rediseña "Anuncio: recién publicada" en 4:5. Ale, 8-sep: "no me encanta, necesitaríamos
cambiar el diseño".

**Por qué no convencía.** La pieza sólo decía etiqueta + titular + ubicación. Nada más. Para un
aviso que recién salió al mercado eso no le da a nadie una razón para detener el scroll: no dice
cuánto cuesta ni qué es. Era la única pieza de propiedad sin un solo dato.

**Qué cambia.** Se vuelve informativa sin volverse una ficha: precio grande —que es lo primero
que busca quien mira propiedades— más una línea de características, sobre la foto a sangre con
velo. La jerarquía es precio → qué es → dónde, que es el orden en el que la gente decide.

Se construye sobre la anatomía de las otras alertas (foto, velo, co-marca) para no reinventar
lo que ya está resuelto, pero el bloque de contenido es nuevo.
"""
import json
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor" / "propiedad"
ANCHO, ALTO = 1080, 1350
BLANCO = "rgba(255,255,255,1)"
AMARILLO = "rgba(246,190,0,1)"
NUN_R = "NunitoSans_10pt-Regular"
NUN_B = "NunitoSans_10pt-Bold"
HELD = "HeldaneTextRegular"
MARGEN = 96


def txt(name, size, y, fam=NUN_R, fill=BLANCO, alto=None, autofit=False, ls=0,
        upper=False, ancho=None):
    e = {"type": "text", "name": name, "text": name, "x": MARGEN, "y": y,
         "width": ancho or (ANCHO - MARGEN * 2), "height": alto or round(size * 1.35),
         "fontSize": size, "fontFamily": fam, "fill": fill, "align": "left",
         "lineHeight": 1.25, "letterSpacing": ls, "rotation": 0, "opacity": 1,
         "visible": True}
    if autofit:
        e["autofit"], e["minFontSize"] = True, round(size * 0.62)
    if upper:
        e["textTransform"] = "uppercase"
    return e


def construir():
    # se hereda la base de la alerta de baja de precio: foto, velo y el cuadro del co-marca
    base = json.loads((TPL / "baja_precio_post_45.json").read_text(encoding="utf-8"))
    pg = base["pages"][0]
    conservar = ("{{pictures.0.url}}", "company.logo")
    nuevos = [c for c in pg["children"]
              if c.get("type") in ("image", "figure")
              and (any(k in str(c.get("name", "")) for k in conservar)
                   or (c.get("type") == "figure" and not str(c.get("fill", "")).endswith(",1)"))
                   or (c.get("type") == "figure" and (c.get("width") or 0) < ANCHO * 0.6))]
    base["pages"][0]["children"] = nuevos

    # el velo sube de 39% a 55%: acá hay más texto encima que en la de baja de precio
    for c in nuevos:
        if c.get("type") == "figure" and not str(c.get("fill", "")).endswith(",1)"):
            c["opacity"] = 0.55

    y = 700
    nuevos.append({"type": "figure", "name": "acento", "x": MARGEN, "y": y,
                   "width": 140, "height": 3, "fill": AMARILLO,
                   "rotation": 0, "opacity": 1, "visible": True})
    y += 30
    nuevos.append(txt("RECIÉN PUBLICADA", 20, y, fam=NUN_B, ls=1.8, upper=True))
    y += 52
    # el precio manda: es lo primero que busca quien mira propiedades
    nuevos.append(txt("$ {{listing.price.price}}", 112, y, fam=HELD, autofit=True,
                      alto=140))
    y += 152
    # `specs` ya viene armado con lo que la propiedad tiene: un terreno sale "Terreno
    # residencial · 420 m²" y no "TERRENO RESIDENCIAL · rec · baños · m²"
    nuevos.append(txt("{{type}} · {{specs}}", 30, y, fam=NUN_R, autofit=True, alto=44))
    y += 62
    nuevos.append(txt("{{titulo_corto}}", 44, y, fam=HELD, autofit=True, alto=60))
    y += 66
    nuevos.append(txt("{{colonia}}", 26, y, fam=NUN_R, autofit=True))

    for salida in ("nueva_propiedad_post_45.json",):
        (TPL / salida).write_text(json.dumps(base, ensure_ascii=False, indent=2) + "\n",
                                  encoding="utf-8")
        print(f"{salida}: precio grande + características + título corto + colonia")


if __name__ == "__main__":
    construir()
