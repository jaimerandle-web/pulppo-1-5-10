#!/usr/bin/env python
"""
Pulppo Studio — genera la plantilla paramétrica de SWIPE (carrusel de consejo).

Por qué paramétrica y no 96 archivos: en Canva hay 96 swipes publicados porque cada pieza
se armó a mano. Todos tienen la MISMA estructura, leída de los diseños reales:

    portada (bajada + pregunta como título) → N puntos (título + 2 sub-viñetas) → cierre

Con una plantilla de N páginas variables queda cubierto el 28% del contenido que publican
las inmobiliarias, que hoy Studio no puede hacer.

Reglas de marca aplicadas (Ale, 6 ago 2026):
  · Heldane Text para display, Nunito Sans para cuerpo
  · amarillo SOLO en filetes y en el numeral chico de lista. Nunca en bloques de texto
  · soft black & white: el amarillo es acento, no protagonista
  · co-brand inmobiliaria / Pulppo en todas las páginas, con la variante correcta por fondo:
    `pulppoInverted` (blanca) sobre oscuro · `pulppo` sobre claro
  · sin usuario de Instagram, sin emojis en la pieza

Uso:
  python gen_swipe.py                # 3 puntos → 5 páginas
  python gen_swipe.py --puntos 4     # 4 puntos → 6 páginas
"""
import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
TPL_DIR = BASE.parent / "contenido-valor"
FUENTE_DE_FUENTES = TPL_DIR / "consejo_3-pasos_post.json"

W, H = 1080, 1350
M = 96                      # margen lateral, igual que el resto del sistema
TINTA = "rgba(33,35,34,1)"
BLANCO = "rgba(255,255,255,1)"
AMARILLO = "rgba(246,190,0,1)"
GRIS = "rgba(183,183,183,1)"
DISPLAY = "HeldaneTextRegular"
CUERPO = "NunitoSans_10pt-Regular"
CUERPO_B = "NunitoSans_10pt-Bold"
ETIQ = "Mark-Medium"


def txt(x, y, w, texto, tam, fam=CUERPO, fill=TINTA, alto=None, lh=1.2, ls=0, align="left"):
    return {"type": "text", "name": "", "opacity": 1, "x": x, "y": y, "width": w,
            "height": alto if alto is not None else round(tam * lh, 1), "rotation": 0,
            "text": texto, "fontSize": tam, "fontFamily": fam, "fontWeight": "normal",
            "fill": fill, "align": align, "verticalAlign": "top", "strokeWidth": 0,
            "stroke": "black", "lineHeight": lh, "letterSpacing": ls}


def filete(x, y, w, color=AMARILLO, grosor=3):
    """Línea de acento. Es el único lugar donde el amarillo es bienvenido."""
    return {"type": "figure", "name": "filete", "subType": "rect", "opacity": 1,
            "x": x, "y": y, "width": w, "height": grosor, "rotation": 0,
            "fill": color, "strokeWidth": 0, "stroke": "black", "cornerRadius": 0}


def fondo(color):
    return {"type": "figure", "name": "fondo", "subType": "rect", "opacity": 1,
            "x": 0, "y": 0, "width": W, "height": H, "rotation": 0,
            "fill": color, "strokeWidth": 0, "stroke": "black", "cornerRadius": 0}


def logo(oscuro):
    """El co-brand va en TODAS las páginas. Variante blanca sobre oscuro, normal sobre claro."""
    tk = "pulppoInverted" if oscuro else "pulppo"
    return {"type": "image", "name": f"{{{{company.logo.{tk}}}}}", "opacity": 1,
            "x": W - M - 260, "y": 78, "width": 260, "height": 94, "rotation": 0,
            "src": "", "fit": "contain", "cornerRadius": 0}


def desliza(oscuro):
    c = BLANCO if oscuro else TINTA
    return txt(M, H - 130, 400, "DESLIZA  →", 22, ETIQ, c, ls=2.4)


def portada():
    return {"id": "swipe-portada", "background": "white", "width": "auto", "height": "auto",
            "children": [
                fondo(TINTA), logo(True),
                txt(M, 300, 200, "CONSEJO", 22, ETIQ, AMARILLO, ls=2.6),
                filete(M, 348, 120),
                txt(M, 400, W - 2 * M, "{{titulo}}", 78, DISPLAY, BLANCO, alto=330, lh=1.06),
                txt(M, 760, W - 2 * M - 60, "{{bajada}}", 34, CUERPO, GRIS, alto=120, lh=1.35),
                desliza(True)]}


def punto(i, ultimo):
    """Página de un punto: numeral chico amarillo (excepción de lista), título y 2 viñetas."""
    hijos = [fondo(BLANCO), logo(False),
             txt(M, 300, 90, f"0{i}", 56, DISPLAY, AMARILLO, alto=70),
             filete(M, 386, 88),
             txt(M, 430, W - 2 * M, f"{{{{punto_{i}_titulo}}}}", 62, DISPLAY, TINTA,
                 alto=200, lh=1.08)]
    y = 700
    for sub in ("a", "b"):
        hijos.append(txt(M, y + 4, 26, "·", 34, CUERPO_B, AMARILLO))
        hijos.append(txt(M + 40, y, W - 2 * M - 40, f"{{{{punto_{i}_{sub}}}}}", 34,
                         CUERPO, TINTA, alto=100, lh=1.35))
        y += 130
    if not ultimo:
        hijos.append(desliza(False))
    return {"id": f"swipe-punto-{i}", "background": "white", "width": "auto",
            "height": "auto", "children": hijos}


def cierre():
    return {"id": "swipe-cierre", "background": "white", "width": "auto", "height": "auto",
            "children": [
                fondo(TINTA), logo(True),
                filete(M, 348, 120),
                txt(M, 400, W - 2 * M, "{{cierre}}", 70, DISPLAY, BLANCO, alto=260, lh=1.08),
                txt(M, 700, W - 2 * M - 60, "{{cta}}", 34, CUERPO, GRIS, alto=100, lh=1.35),
                txt(M, H - 130, 460, "GUARDA ESTE POST", 22, ETIQ, AMARILLO, ls=2.4)]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--puntos", type=int, default=3)
    a = ap.parse_args()
    if not 2 <= a.puntos <= 5:
        raise SystemExit("✗ entre 2 y 5 puntos (Instagram permite 10 páginas, pero más de 5 nadie desliza)")

    fuentes = json.loads(FUENTE_DE_FUENTES.read_text(encoding="utf-8")).get("fonts", [])
    doc = {"width": W, "height": H, "dpi": 72, "unit": "px", "fonts": fuentes,
           "pages": [portada()] + [punto(i, i == a.puntos) for i in range(1, a.puntos + 1)] + [cierre()]}

    out = TPL_DIR / "consejo_swipe_post.json"
    out.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    tokens = ["titulo", "bajada", "cierre", "cta"] + [
        f"punto_{i}_{s}" for i in range(1, a.puntos + 1) for s in ("titulo", "a", "b")]
    print(f"✓ {out.relative_to(TPL_DIR.parent)}  ({out.stat().st_size/1024:.0f} KB)")
    print(f"  {len(doc['pages'])} páginas · {W}x{H} · {len(tokens)} campos")
    print(f"  campos: {', '.join(tokens)}")


if __name__ == "__main__":
    main()
