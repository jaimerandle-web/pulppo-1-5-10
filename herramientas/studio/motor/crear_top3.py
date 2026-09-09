#!/usr/bin/env python3
"""Deriva `zonas_top3_post.json` de la plantilla de cinco.

**Por qué hace falta.** La pieza de "los mejores lugares para desayunar" exigía cinco cafés
nombrables y sólo 3 de 107 colonias los tienen —Roma Norte, Juárez e Hipódromo, que además
comparten los mismos cinco, así que la pieza salía idéntica en las tres—. Ale bajó el umbral
a tres el 9-sep.

**No basta con dejar dos tokens vacíos.** Los numerales "01".."05" son texto FIJO de la
plantilla, no tokens: con tres lugares, los renglones 04 y 05 quedarían con el número puesto
y la línea en blanco al lado. Ya se vio así cuando los cinco tokens no resolvían.

Qué hace: quita los renglones 4 y 5, cambia "Top 5" por "Top 3", y **centra** los tres que
quedan en el bloque que ocupaban los cinco. Se conserva el paso original de 104 px en vez de
repartirlos por todo el bloque: estirarlos a 208 px de separación deja la lista aireada y
rompe el ritmo del resto de las piezas; dejarlos arriba deja la mitad de abajo hueca.
"""
import json
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor"
_YS = []
ORIGEN, DESTINO = "zonas_top5_post.json", "zonas_top3_post.json"

# El bloque que ocupaban los cinco renglones: del primero (730) al último (1146+42).
BLOQUE_Y0, BLOQUE_Y1 = 730, 1188


def construir():
    d = json.loads((TPL / ORIGEN).read_text(encoding="utf-8"))
    for pg in d["pages"]:
        hijos = []
        for c in pg.get("children", []):
            txt = str(c.get("text") or "")
            nom = str(c.get("name") or "")
            if txt in ("04", "05") or "{{lugar_4}}" in (txt + nom) or "{{lugar_5}}" in (txt + nom):
                continue
            if txt == "Top 5 {{cosa}} en {{zona}}.":
                c["text"] = "Top 3 {{cosa}} en {{zona}}."
            if nom == "Top 5 {{cosa}} en {{zona}}.":
                c["name"] = "Top 3 {{cosa}} en {{zona}}."
            hijos.append(c)

        filas = [c for c in hijos
                 if (c.get("y") or 0) >= BLOQUE_Y0
                 and (str(c.get("text") or "") in ("01", "02", "03")
                      or "{{lugar_" in str(c.get("text") or "") + str(c.get("name") or ""))]
        ys = sorted({round(c["y"]) for c in filas})
        if len(ys) > 1:
            alto = filas[0].get("height", 42)
            paso = ys[1] - ys[0]                       # el ritmo original, 104 px
            usado = paso * (len(ys) - 1) + alto
            y0 = BLOQUE_Y0 + (BLOQUE_Y1 - BLOQUE_Y0 - usado) / 2
            nuevo_y = {y: y0 + i * paso for i, y in enumerate(ys)}
            for c in filas:
                c["y"] = round(nuevo_y[round(c["y"])], 2)
            _YS[:] = sorted(set(nuevo_y.values()))

        pg["children"] = hijos

    (TPL / DESTINO).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
    print(f"{DESTINO}: 3 renglones en y={_YS} · paso original conservado · "
          f"bloque {BLOQUE_Y0}-{BLOQUE_Y1}")


if __name__ == "__main__":
    construir()
