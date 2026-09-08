#!/usr/bin/env python
"""
Pulppo Studio — visor local de las piezas generadas.
Renderiza los JSON de Polotno de salidas/ a HTML y los sirve en localhost,
para VER la pieza sin abrir Polotno ni tener la UI del paso 5.

Uso:
  python preview.py            # renderiza todo salidas/ y levanta el server
  python preview.py --port 8765
  python preview.py --no-serve # solo escribe preview/index.html

Es una APROXIMACIÓN fiel-pero-no-exacta: usa las fuentes embebidas del template y
posicionamiento absoluto en px, pero el motor de texto del navegador no es el de
Polotno (konva), así que los saltos de línea pueden diferir un poco.
"""
import argparse
import http.server
import json
import re
import socketserver
import webbrowser
from functools import partial
from html import escape
from pathlib import Path

BASE = Path(__file__).resolve().parent
SALIDAS = BASE / "salidas"
PREVIEW = BASE / "preview"


def font_faces(doc):
    """Las fuentes vienen en base64 dentro del JSON → @font-face inline."""
    css = []
    for f in doc.get("fonts", []):
        fam, url = f.get("fontFamily"), f.get("url", "")
        if fam and url.startswith("data:"):
            css.append(f"@font-face{{font-family:'{fam}';src:url({url});font-display:block;}}")
    return "\n".join(css)


def render_page(pg, doc, escala):
    """Un page de Polotno → un div con hijos posicionados en absoluto."""
    W = pg.get("width") if isinstance(pg.get("width"), (int, float)) else doc.get("width", 1080)
    H = pg.get("height") if isinstance(pg.get("height"), (int, float)) else doc.get("height", 1350)
    bg = pg.get("background") or "white"
    out = [f'<div class="page" style="width:{W}px;height:{H}px;background:{bg};'
           f'transform:scale({escala});">']

    for c in pg.get("children", []):
        t = c.get("type")
        x, y = c.get("x", 0), c.get("y", 0)
        w, h = c.get("width", 0), c.get("height", 0)
        rot = c.get("rotation") or 0
        op = c.get("opacity", 1)
        base = (f"left:{x}px;top:{y}px;width:{w}px;height:{h}px;opacity:{op};"
                f"transform:rotate({rot}deg);")
        nombre = c.get("name") or ""
        # la etiqueta solo cabe en elementos grandes; en el círculo de 78px tapaba la foto
        tag_slot = f'<span class="slot">{escape(nombre)}</span>' if nombre and w >= 200 else ""

        if t == "text":
            fam = c.get("fontFamily", "sans-serif")
            fs = c.get("fontSize", 16)
            lh = c.get("lineHeight", 1.2)
            fill = c.get("fill", "#000")
            align = c.get("align", "left")
            weight = c.get("fontWeight", "normal")
            ls = c.get("letterSpacing", 0)
            txt = escape(c.get("text", "")).replace("\n", "<br>")
            # marcar en rojo lo que quedó sin resolver
            txt = re.sub(r"(\{\{[^}]+\}\})", r'<mark class="tok">\1</mark>', txt)
            out.append(
                f'<div class="el txt" style="{base}font-family:\'{fam}\',sans-serif;'
                f'font-size:{fs}px;line-height:{lh};color:{fill};text-align:{align};'
                f'font-weight:{weight};letter-spacing:{ls}px;height:auto;">{txt}</div>')

        elif t == "image":
            src = c.get("src", "")
            r = c.get("cornerRadius") or 0
            out.append(f'<div class="el img" style="{base}">{tag_slot}'
                       f'<img src="{escape(src)}" style="width:100%;height:100%;'
                       f'object-fit:cover;border-radius:{r}px;"></div>')

        elif t == "figure":
            r = c.get("cornerRadius") or 0
            fill = c.get("fill", "#ccc")
            out.append(f'<div class="el fig" style="{base}background:{fill};'
                       f'border-radius:{r}px;">{tag_slot}</div>')

        elif t == "line":
            out.append(f'<div class="el" style="{base}background:#212322;height:1px;"></div>')

    out.append("</div>")
    return "".join(out), W, H


def render_pieza(fjson, escala=0.42):
    doc = json.loads(fjson.read_text(encoding="utf-8"))
    meta_f = fjson.with_name(fjson.stem + "_pieza.json")
    meta = json.loads(meta_f.read_text(encoding="utf-8")) if meta_f.exists() else {}

    paginas, W, H = [], 1080, 1350
    for pg in doc.get("pages", []):
        html, W, H = render_page(pg, doc, escala)
        paginas.append(html)

    estado = meta.get("estado", "?")
    pend = meta.get("tokens_sin_resolver") or []
    avisos = meta.get("avisos_marca") or []
    slots = meta.get("slots_imagen") or []
    chips = "".join(
        f'<span class="chip {"warn" if "⚠" in s["resultado"] else "ok"}">'
        f'{escape(s["slot"])}: {escape(s["resultado"])}</span>' for s in slots)

    ficha = f"""
    <div class="ficha">
      <h2>{escape(meta.get('titulo_idea', fjson.stem))}</h2>
      <p class="sub">{escape(meta.get('template_ref',''))} · {escape(meta.get('formato',''))}
         · {W}×{H} · <span class="est {'ok' if estado=='listo_para_editar' else 'warn'}">{escape(estado)}</span></p>
      {'<p class="pend">tokens sin resolver: <b>' + escape(', '.join(pend)) + '</b></p>' if pend else ''}
      {'<p class="pend">guardrails: ' + escape('; '.join(avisos)) + '</p>' if avisos else ''}
      <div class="chips">{chips}</div>
      {'<p class="cap"><b>Caption:</b> ' + escape(meta.get('caption','')) + '</p>' if meta.get('caption') else ''}
    </div>"""

    lienzo = (f'<div class="wrap" style="width:{W*escala}px;height:{H*escala*len(paginas)}px;">'
              + "".join(paginas) + "</div>")
    return f'<section class="pieza">{lienzo}{ficha}</section>', font_faces(doc)


def construir(escala=0.42):
    piezas = sorted(p for p in SALIDAS.glob("*.json")
                    if not p.name.endswith("_pieza.json") and not p.name.startswith(("_", "copy_")))
    if not piezas:
        raise SystemExit(f"✗ No hay piezas en {SALIDAS}. Generá una con:\n"
                         f"  python prototipo.py pieza --email <mail> --idea <id> --copy <copy.json>")

    cuerpos, fuentes = [], []
    for f in piezas:
        html, ff = render_pieza(f, escala)
        cuerpos.append(html)
        fuentes.append(ff)

    doc = f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Pulppo Studio · piezas generadas</title>
<style>
{chr(10).join(dict.fromkeys(fuentes))}
*{{box-sizing:border-box}}
body{{margin:0;padding:32px;background:#f4f4f2;font-family:system-ui,-apple-system,sans-serif;color:#212322}}
h1{{font-size:20px;margin:0 0 4px}}
.intro{{color:#6b6b6b;font-size:13px;margin:0 0 28px;max-width:70ch;line-height:1.5}}
.pieza{{display:flex;gap:28px;align-items:flex-start;background:#fff;border:1px solid #e3e3e0;
  border-radius:10px;padding:20px;margin-bottom:20px;flex-wrap:wrap}}
.wrap{{position:relative;flex:0 0 auto;box-shadow:0 2px 12px rgba(0,0,0,.12)}}
.page{{position:absolute;top:0;left:0;transform-origin:top left;overflow:hidden}}
.el{{position:absolute;transform-origin:center}}
.txt{{white-space:pre-wrap;word-break:break-word}}
.img,.fig{{overflow:hidden}}
.slot{{position:absolute;left:4px;top:4px;z-index:5;background:rgba(0,0,0,.62);color:#fff;
  font:600 20px/1 system-ui,sans-serif;padding:5px 8px;border-radius:4px;letter-spacing:0}}
mark.tok{{background:#ffd7d7;color:#b00020;border-radius:3px}}
.ficha{{flex:1;min-width:280px}}
.ficha h2{{font-size:17px;margin:0 0 6px}}
.sub{{color:#6b6b6b;font-size:12px;margin:0 0 12px}}
.est{{padding:2px 8px;border-radius:99px;font-weight:600}}
.est.ok{{background:#dff3e4;color:#1c6b34}} .est.warn{{background:#ffe9d6;color:#8a4b00}}
.pend{{font-size:12px;color:#b00020;margin:6px 0}}
.chips{{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}}
.chip{{font-size:11px;padding:3px 9px;border-radius:99px;background:#eee}}
.chip.ok{{background:#e8f1ff;color:#14508c}} .chip.warn{{background:#ffe9d6;color:#8a4b00}}
.cap{{font-size:13px;line-height:1.5;color:#3a3a38;margin:10px 0 0;max-width:60ch}}
</style></head><body>
<h1>Pulppo Studio · piezas generadas por el prototipo</h1>
<p class="intro">Render local de los JSON de <code>motor/salidas/</code>. Aproximación con las
fuentes embebidas del template: el navegador no usa el mismo motor de texto que Polotno, así que
los saltos de línea pueden variar. Las etiquetas negras marcan los <b>slots de imagen</b> por
nombre y lo rojo son <b>tokens sin resolver</b>.</p>
{"".join(cuerpos)}
</body></html>"""

    PREVIEW.mkdir(exist_ok=True)
    out = PREVIEW / "index.html"
    out.write_text(doc, encoding="utf-8")
    return out, len(piezas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--escala", type=float, default=0.42)
    ap.add_argument("--no-serve", action="store_true")
    a = ap.parse_args()

    out, n = construir(a.escala)
    print(f"✓ {n} pieza(s) renderizada(s) → {out}")
    if a.no_serve:
        return

    h = partial(http.server.SimpleHTTPRequestHandler, directory=str(PREVIEW))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", a.port), h) as srv:
        url = f"http://localhost:{a.port}/"
        print(f"✓ Servido en {url}   (ctrl-C para cortar)")
        webbrowser.open(url)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n✓ server cerrado")


if __name__ == "__main__":
    main()
