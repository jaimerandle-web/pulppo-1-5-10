#!/usr/bin/env python3
"""Convierte las piezas de propiedad al lienzo 4:5 de Instagram (1080x1350).

Hoy ninguna lo es: la ficha es 1:1 (1080x1080) y las otras cinco son 3:4 (1080x1440).

No es recortar. El ancho no cambia —los seis miden 1080— pero el alto sí, así que hay que
reacomodar en vertical. El criterio:

- **Las fotos a sangre** se estiran al lienzo nuevo. Son fondo: que cubran es lo único que
  importa, y el render las dibuja con `cover`.
- **El resto se reposiciona proporcionalmente** en Y, conservando su tamaño de letra. Escalar
  también la tipografía haría que un 3:4→4:5 encogiera todo un 6% sin razón: el ancho no
  cambió, así que el texto cabe igual.
- Al comprimir, los espacios entre bloques se achican y algo puede chocar. Para eso está
  `#empalmes`: se convierte, se audita y se corrige lo que aparezca. No se asume que salió bien.

Escribe al lado, con sufijo `_45`, para poder comparar contra el original antes de reemplazar.
"""
import json
import sys
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor" / "propiedad"
ANCHO, ALTO = 1080, 1350          # 4:5

PIEZAS = [
    "propiedad_datos_post.json",
    "propiedad_fotos_post6.json",
    "cierre_exitoso_post.json",
    "contrato_nuevo_post.json",
    "baja_precio_post.json",
    "nueva_propiedad_post.json",
]


def es_a_sangre(c, w, h):
    """¿cubre prácticamente todo el lienzo? entonces es fondo, no contenido colocado."""
    return ((c.get("width") or 0) >= w * 0.95 and (c.get("height") or 0) >= h * 0.9
            and (c.get("x") or 0) <= w * 0.05 and (c.get("y") or 0) <= h * 0.05)


def convertir(ref, escribir=True):
    d = json.loads((TPL / ref).read_text(encoding="utf-8"))
    w0, h0 = d["width"], d["height"]
    if (w0, h0) == (ANCHO, ALTO):
        return ["ya estaba en 4:5"]
    k = ALTO / h0
    notas = [f"{w0}x{h0} → {ANCHO}x{ALTO} (alto x{k:.3f})"]
    for pg in d["pages"]:
        for c in pg.get("children", []):
            if es_a_sangre(c, w0, h0):
                c["x"], c["y"], c["width"], c["height"] = 0, 0, ANCHO, ALTO
                continue
            # Y proporcional; el alto de las cajas de texto se conserva para no
            # estrangularlas, el de las figuras e imágenes sí escala
            c["y"] = round((c.get("y") or 0) * k, 2)
            if c.get("type") != "text":
                c["height"] = round((c.get("height") or 0) * k, 2)
    d["width"], d["height"] = ANCHO, ALTO
    if escribir:
        salida = ref.replace(".json", "_45.json")
        (TPL / salida).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                                  encoding="utf-8")
        notas.append(f"escrito {salida}")
    return notas


def main():
    for ref in PIEZAS:
        if not (TPL / ref).exists():
            print(f"{ref}: no existe, salto")
            continue
        print(ref)
        for n in convertir(ref, escribir="--dry-run" not in sys.argv):
            print(f"    {n}")


if __name__ == "__main__":
    main()
