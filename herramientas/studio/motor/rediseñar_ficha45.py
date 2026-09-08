#!/usr/bin/env python3
"""Rediseña la ficha de propiedad en 4:5 (1080x1350). Reemplaza a la conversión automática.

**Por qué no servía la conversión.** La ficha original es 1:1, así que pasarla a 4:5 la hace
crecer 25%. Escalar posiciones proporcionalmente funciona cuando comprimes un 6%, no cuando
estiras: el bloque de tres fotos de la derecha se corría respecto al texto, y el logo blanco
quedaba sobre la foto —donde desaparece si la foto es clara, que fue justo lo que pasó—.

**El acomodo nuevo**, pensado para el alto que hay:

    0    ┌──────────────────────────────┐  foto principal a todo lo ancho
         │                  ┌─────────┐ │  el co-marca en su cuadro negro, como en
         │                  │  logo   │ │  las alertas: así no depende de que la
         │                  └─────────┘ │  foto sea oscura
    700  ├────────┬─────────┬───────────┤  tres fotos en fila, sin huecos
    930  ├────────┴─────────┴───────────┤
         │  Residencial Vidalta         │  título corto (una sola cosa)
         │  Lomas del Chamizal          │  colonia
         │  ── DEPARTAMENTO EN VENTA    │  filete amarillo + operación
         │  3 rec · 3 baños · 2 est ·   │  características en una línea
    1350 └──────────────────────────────┘

Las tres fotos en fila en vez de apiladas a la derecha es el cambio que ordena todo: el texto
recupera el ancho completo, y por eso el título ya no necesita partirse.
"""
import json
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor" / "propiedad"
W, H = 1080, 1350
M = 96                              # margen lateral, el mismo que el resto de las piezas
FOTO_H, TIRA_Y, TIRA_H = 700, 700, 230
NEGRO = "rgba(33,35,34,1)"
BLANCO = "rgba(255,255,255,1)"
GRIS = "rgba(140,140,134,1)"
AMARILLO = "rgba(246,190,0,1)"
NUN_R, NUN_B, HELD = ("NunitoSans_10pt-Regular", "NunitoSans_10pt-Bold",
                      "HeldaneTextRegular")


def img(name, x, y, w, h):
    return {"type": "image", "name": name, "src": "", "x": x, "y": y,
            "width": w, "height": h, "rotation": 0, "opacity": 1, "visible": True}


def txt(name, y, size, fam, fill, alto=None, autofit=True, ls=0, upper=False):
    e = {"type": "text", "name": name, "text": name, "x": M, "y": y, "width": W - M * 2,
         "height": alto or round(size * 1.3), "fontSize": size, "fontFamily": fam,
         "fill": fill, "align": "left", "lineHeight": 1.25, "letterSpacing": ls,
         "rotation": 0, "opacity": 1, "visible": True}
    if autofit:
        e["autofit"], e["minFontSize"] = True, round(size * 0.68)
    if upper:
        e["textTransform"] = "uppercase"
    return e


def construir():
    hijos = [
        # fondo blanco: la mitad de abajo es papel, no foto
        {"type": "figure", "name": "papel", "x": 0, "y": 0, "width": W, "height": H,
         "fill": BLANCO, "rotation": 0, "opacity": 1, "visible": True},
        img("{{pictures.0.url}}", 0, 0, W, FOTO_H),
        # el co-marca en cuadro negro y no suelto sobre la foto: en la versión anterior el
        # lockup blanco caía sobre una ventana y se perdía
        {"type": "figure", "name": "cuadro.logo", "x": 497, "y": 0, "width": 461,
         "height": 260, "fill": NEGRO, "rotation": 0, "opacity": 1, "visible": True},
        img("{{company.logo.pulppoInverted}}", 501, 111, 417, 119),
        # tres fotos en fila: le devuelven el ancho completo al texto
        img("{{pictures.2.url}}", 0, TIRA_Y, 360, TIRA_H),
        img("{{pictures.3.url}}", 360, TIRA_Y, 360, TIRA_H),
        img("{{pictures.4.url}}", 720, TIRA_Y, 360, TIRA_H),
    ]
    y = TIRA_Y + TIRA_H + 60
    hijos.append(txt("{{titulo_corto}}", y, 54, HELD, NEGRO, alto=70))
    y += 78
    hijos.append(txt("{{colonia}}", y, 27, NUN_R, GRIS, alto=36))
    y += 54
    hijos.append({"type": "figure", "name": "acento", "x": M, "y": y, "width": 120,
                  "height": 3, "fill": AMARILLO, "rotation": 0, "opacity": 1,
                  "visible": True})
    y += 24
    hijos.append(txt("{{type}} en {{listing.operation}}", y, 21, NUN_B, NEGRO,
                     alto=30, ls=1.6, upper=True))
    y += 60
    # un solo token y no cuatro: un terreno no tiene recámaras, y escrito token por token
    # la pieza imprimía "rec · baños · est · m²" con las etiquetas huérfanas
    hijos.append(txt("{{specs}}", y, 28, NUN_R, NEGRO, alto=40))

    base = {"width": W, "height": H, "unit": "px", "dpi": 72,
            "fonts": json.loads((TPL / "propiedad_datos_post.json")
                                .read_text(encoding="utf-8")).get("fonts", []),
            "pages": [{"background": "white", "children": hijos}]}
    salida = TPL / "propiedad_datos_post_45.json"
    salida.write_text(json.dumps(base, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{salida.name}: foto {W}x{FOTO_H} · tira de 3 en y={TIRA_Y} · texto desde "
          f"{TIRA_Y + TIRA_H + 60} · el co-marca en cuadro negro")


if __name__ == "__main__":
    construir()
