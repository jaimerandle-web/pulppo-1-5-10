#!/usr/bin/env python3
"""Crea los templates de "¡Nuevo contrato!" derivando de los de cierre exitoso.

Ale, 2-sep: "podemos hacer dos templates, uno de cierre exitoso como está ahorita y otro de
¡Nuevo contrato! o algo así, como que avanzó la oferta".

Se derivan en vez de diseñarse de cero porque la anatomía es la misma (foto del aviso a sangre,
velo, título grande y una línea de agradecimiento) y así heredan el co-marca, la tipografía y el
auto-ajuste que ya se corrigieron. Lo único que cambia es el texto y su peso: un contrato no se
celebra igual que un cierre, es una etapa —todavía se puede caer— así que el tono es "avanzamos",
no "gracias por su confianza".

Idempotente: si el archivo ya existe, no lo sobreescribe (para no pisar ajustes de diseño
posteriores). Con --forzar se regenera.
"""
import json
import sys
from pathlib import Path

TPL = Path(__file__).resolve().parent.parent / "contenido-valor" / "propiedad"

# (origen, destino, {texto viejo: texto nuevo})
DERIVAR = [
    ("cierre_exitoso_post.json", "contrato_nuevo_post.json"),
    ("cierre_exitoso_story.json", "contrato_nuevo_story.json"),
]

REEMPLAZOS = {
    "Cierre Exitoso.": "Nuevo contrato.",
    "¡GRACIAS POR SU CONFIANZA!": "UNA MENOS EN EL MERCADO",
}


def derivar(origen, destino, forzar=False):
    dst = TPL / destino
    if dst.exists() and not forzar:
        return [f"ya existía, sin tocar (usa --forzar para regenerar)"]
    d = json.loads((TPL / origen).read_text(encoding="utf-8"))
    cambios = []
    for pg in d.get("pages", []):
        for c in pg.get("children", []):
            if c.get("type") != "text":
                continue
            t = (c.get("text") or "").strip()
            if t in REEMPLAZOS:
                c["text"] = REEMPLAZOS[t]
                cambios.append(f'"{t}" → "{REEMPLAZOS[t]}"')
                # "Nuevo contrato." es más largo que "Cierre Exitoso.": sin esto el
                # auto-ajuste lo encogería de más. Se le suelta el piso.
                if c.get("autofit"):
                    c["minFontSize"] = round((c.get("fontSize") or 90) * 0.55)
    dst.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cambios.append(f"escrito {destino} ({len(d.get('pages', []))} páginas)")
    return cambios


def main():
    forzar = "--forzar" in sys.argv
    for origen, destino in DERIVAR:
        print(destino)
        for c in derivar(origen, destino, forzar):
            print(f"    {c}")


if __name__ == "__main__":
    main()
