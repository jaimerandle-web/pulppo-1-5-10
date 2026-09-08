#!/usr/bin/env python3
"""Pone el lockup co-marca [inmobiliaria / pulppo] en los templates que no lo tenían.

Antes de esto, de los 17 templates sólo 5 llevaban co-marca (los 4 de propiedad y el swipe):
9 llevaban `pulppo.logo` —Pulppo solo, sin la inmobiliaria— y 3 no llevaban ningún logo.

Dos cosas que obligan a decidir template por template en vez de reemplazar en bloque:

1. **La variante depende del fondo REAL bajo el logo**, no del `background` de la página
   (que es "white" en los 17). `company.logo.pulppo` es el lockup negro y sólo sirve sobre
   claro; `company.logo.pulppoInverted` es el blanco y sólo sirve sobre oscuro o sobre foto.
   Un template con `background:"white"` puede tener una foto a sangre encima (zonas_top5,
   historia_zona) y ahí va el blanco.

2. **El lockup es mucho más ancho que el logo de Pulppo solo**: 3.5:1 contra 2.34:1. La caja
   de 150x64 que ocupaba `pulppo.logo` deja el lockup en 150x43 —se ve diminuto—, así que hay
   que agrandar la caja. Y al agrandarla choca con la etiqueta de arriba-izquierda en los
   posts que la tienen en y=104. Como esas etiquetas son todas `align:"left"` y su caja está
   sobredimensionada (700px para textos como "GUÍA"), se estrecha la caja a 560: el texto no
   se mueve un pixel y aparece el espacio.

La referencia de geometría no es inventada: es la del swipe, que ya llevaba co-marca bien
puesta —(724, 78, 260x94), borde derecho en 984, el mismo que usaba `pulppo.logo`—.

Idempotente: si el elemento ya apunta a `company.logo.*`, no lo toca.
"""
import json
import sys
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor"

# Geometría del swipe, que ya estaba bien. Borde derecho en 984 igual que `pulppo.logo`.
POST = (724, 78, 260, 94)
# Las stories traían el logo un 13% más grande (170x72 vs 150x64): se escala igual para no
# cambiarles el peso visual. Borde derecho 984 y mismo centro vertical (256) que antes.
STORY = (689, 203, 295, 107)

# `label` estrecha la caja del texto de arriba-izquierda para hacerle lugar al lockup.
# Sólo donde ese texto está a la altura del logo; en las stories vive en y>=700 y no molesta.
PLAN = {
    # ---- posts que tenían `pulppo.logo` ----
    "consejo_3-pasos_post.json":      dict(var="pulppo",         caja=POST,  label=560),
    "consejo_requisitos_post.json":   dict(var="pulppo",         caja=POST,  label=560),
    "pregunta_portada_post.json":     dict(var="pulppo",         caja=POST,  label=560),
    # figure negro a sangre (0,0,1080x1350) → el logo cae sobre negro
    "dato_declaracion_post.json":     dict(var="pulppoInverted", caja=POST,  label=560),
    # foto.lugar a sangre arriba (0,0,1080x760) → el logo cae sobre foto; su etiqueta está en y=806
    "zonas_top5_post.json":           dict(var="pulppoInverted", caja=POST),

    # ---- stories que tenían `pulppo.logo` ----
    "stories/historia_dato_story.json":     dict(var="pulppoInverted", caja=STORY),
    "stories/historia_frase_story.json":    dict(var="pulppoInverted", caja=STORY),
    "stories/historia_pregunta_story.json": dict(var="pulppo",         caja=STORY),
    # foto.zona a sangre en toda la pieza; el overlay negro empieza en y=1120, muy por debajo
    # del logo (y=203), así que el logo queda sobre la foto → blanco
    "stories/historia_zona_story.json":     dict(var="pulppoInverted", caja=STORY),

    # ---- los 3 que no llevaban ningún logo (se agrega el elemento) ----
    # foto a sangre + overlay negro encima
    "frase_quote_post.json":          dict(var="pulppoInverted", caja=POST,  label=560, agregar=True),
    # foto.lugar a sangre arriba (0,0,1080x864); el primer texto está en y=906
    "consejo_5-ventajas_post.json":   dict(var="pulppoInverted", caja=POST,  agregar=True),
    # todo blanco, sin foto. Caso aparte: tiene un filete de 888px de ancho en y=142 que
    # cruzaría la caja del swipe (78..172), así que el lockup va MÁS ARRIBA y más chico
    # (224x64, y 56..120) para no pisar el filete ni obligar a recortarlo.
    "zonas_los-mejores_post.json":    dict(var="pulppo", caja=(760, 56, 224, 64),
                                           label=560, agregar=True),
}


def etiqueta_de_arriba(children):
    """El texto más alto de la pieza; es la etiqueta que le pelea el espacio al logo."""
    textos = [c for c in children if c.get("type") == "text"]
    return min(textos, key=lambda c: c.get("y") or 0) if textos else None


def aplicar(ref, cfg, escribir=True):
    ruta = TPL / ref
    d = json.loads(ruta.read_text(encoding="utf-8"))
    pagina = d["pages"][0]
    hijos = pagina.setdefault("children", [])
    x, y, w, h = cfg["caja"]
    nombre = "{{company.logo.%s}}" % cfg["var"]
    cambios = []

    logos = [c for c in hijos if "logo" in (c.get("name") or "").lower()]
    ya = [c for c in logos if "company.logo" in (c.get("name") or "")]
    if ya and not cfg.get("agregar"):
        return ["ya tenía co-marca, sin tocar"]

    if cfg.get("agregar"):
        if ya:
            return ["ya tenía co-marca, sin tocar"]
        # el logo va al frente: sobre la foto y sobre el overlay, nunca debajo
        hijos.append({"type": "image", "name": nombre, "src": "",
                      "x": x, "y": y, "width": w, "height": h,
                      "rotation": 0, "opacity": 1, "visible": True})
        cambios.append(f"agregado {nombre} en ({x},{y}) {w}x{h}")
    else:
        viejos = [c for c in logos if (c.get("name") or "") == "pulppo.logo"]
        if not viejos:
            return ["✗ no encontré pulppo.logo y no está marcado para agregar"]
        for c in viejos:
            antes = f'{c.get("name")} ({round(c.get("x") or 0)},{round(c.get("y") or 0)}) ' \
                    f'{round(c.get("width") or 0)}x{round(c.get("height") or 0)}'
            c["name"] = nombre
            # el PNG de Pulppo venía embebido en base64; con el token en el name el src se
            # resuelve en el navegador, así que dejarlo sólo engordaría el bundle
            c["src"] = ""
            c["x"], c["y"], c["width"], c["height"] = x, y, w, h
            cambios.append(f"{antes} → {nombre} ({x},{y}) {w}x{h}")

    if cfg.get("label"):
        lab = etiqueta_de_arriba(hijos)
        # sólo si de verdad está a la altura del logo
        if lab and (lab.get("y") or 0) < y + h and (lab.get("width") or 0) > cfg["label"]:
            if lab.get("align") != "left":
                cambios.append(f"⚠ la etiqueta no es align:left ({lab.get('align')!r}), "
                               f"NO se estrecha para no moverla")
            else:
                cambios.append(f'etiqueta {repr((lab.get("text") or "")[:18])} '
                               f'{round(lab["width"])} → {cfg["label"]} de ancho')
                lab["width"] = cfg["label"]

    if escribir:
        ruta.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return cambios


def main():
    seco = "--dry-run" in sys.argv
    print("— simulacro, no escribe —\n" if seco else "")
    for ref, cfg in PLAN.items():
        print(f"{ref}")
        for c in aplicar(ref, cfg, escribir=not seco):
            print(f"    {c}")
    print(f"\n{len(PLAN)} templates procesados.")


if __name__ == "__main__":
    main()
