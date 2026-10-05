"""Convierte los diseños de Polotno del Ranking (originales/post.json, originales/historia.json)
en las plantillas que usa /plus → "Imágenes del ranking" (public/plus/ranking/*.json).

Qué hace:
  · Saca TODAS las imágenes (data: y las de storage.studio.polotno.com, que no mandan CORS y el
    canvas no puede leer) a public/plus/ranking/assets/<hash>.png.
  · Renombra los huecos a nombres fijos que llena la app:
      mes · cuerpo (portada historia) · broker1..3 · inmo1..3 · logo1..5
  · Cada foto de asesor queda como 3 capas en el mismo círculo: ph{n} (círculo de color),
    ini{n} (iniciales) y foto{n} (imagen recortada en círculo). La app enciende foto o iniciales.
  · Marca cada página con su tipo en `custom.slide`: portada · elite · professional · standard ·
    consultoria · onboarding.

Si Ale cambia el diseño en Polotno: exportar el JSON a originales/ y volver a correr esto.
    python3 herramientas/plus-ranking/normalizar.py   (requiere Pillow)
"""
import base64, copy, hashlib, io, json, os, re, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(AQUI, '..', '..'))
OUT = os.path.join(REPO, 'public', 'plus', 'ranking')
ASSETS = os.path.join(OUT, 'assets')
os.makedirs(ASSETS, exist_ok=True)


def bytes_de(src):
    if src.startswith('data:'):
        return base64.b64decode(src.split(',', 1)[1])
    return urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})).read()


def guarda(src):
    b = bytes_de(src)
    ext = 'png' if b[:4] == b'\x89PNG' else 'jpg'
    nombre = hashlib.sha1(b).hexdigest()[:12] + '.' + ext
    p = os.path.join(ASSETS, nombre)
    if not os.path.exists(p):
        open(p, 'wb').write(b)
    return f'/plus/ranking/assets/{nombre}'


def plano(children):
    """Desagrupa (los grupos sólo agrupan en el editor; el render es plano)."""
    out = []
    for e in children:
        if e.get('type') == 'group':
            if e.get('visible', True):
                out += plano(e.get('children', []))
        else:
            out.append(e)
    return out


def bbox(e):
    return e['x'], e['y'], e['width'], e['height']


def centro(e):
    x, y, w, h = bbox(e)
    return x + w / 2, y + h / 2


CIRC = ("data:image/svg+xml;base64," + base64.b64encode(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><path d="M 150 150 m -150, 0 '
    b'a 150,150 0 1,0 300,0 a 150,150 0 1,0 -300,0" fill="lightgray"/></svg>').decode())


def slot_de(e):
    """1/2/3 según la columna del podio (izq=2, centro=1, der=3)."""
    cx = centro(e)[0]
    return 2 if cx < 360 * (e['_W'] / 1080) else (1 if cx < 720 * (e['_W'] / 1080) else 3)


def normaliza_brokers(page, W):
    els = plano(page['children'])
    for e in els:
        e['_W'] = W
    fotos = [e for e in els if re.match(r'^FOTO\s*\d', e.get('name', ''))]
    inis = [e for e in els if e['type'] == 'text' and re.fullmatch(r'[A-ZÁÉÍÓÚÑ]{2}', (e.get('text') or '').strip())]
    circ_fill = next((e['fill'] for e in fotos if e['type'] == 'figure'), 'rgba(34,34,34,1)')
    # geometría de cada círculo por slot
    geo = {}
    for e in fotos:
        geo.setdefault(slot_de(e), bbox(e))
    ini_tpl = inis[0] if inis else None
    quitar = set(map(id, fotos + inis))
    nuevos = []
    for e in els:
        if id(e) in quitar:
            continue
        nm = e.get('name', '')
        if e['type'] == 'text':
            m = re.match(r'^broker\s*(\d)$', nm)
            if m:
                e['name'] = f'broker{m.group(1)}'
            m = re.match(r'^inmo\s*(\d)$', nm)
            if m:
                e['name'] = f'inmo{m.group(1)}'
            if re.fullmatch(r'[A-ZÁÉÍÓÚÑ]+ \d{4}', (e.get('text') or '').strip()):
                e['name'] = 'mes'
        nuevos.append(e)
    # insertar las 3 capas por slot, justo antes del texto del nombre (orden de dibujo)
    for n in (1, 2, 3):
        x, y, w, h = geo[n]
        s = min(w, h)
        base = {k: v for k, v in (ini_tpl or {}).items() if k not in ('id', 'x', 'y', 'width', 'height', 'text', 'name')}
        ph = {'type': 'figure', 'subType': 'circle', 'name': f'ph{n}', 'x': x, 'y': y, 'width': s, 'height': s,
              'fill': circ_fill, 'opacity': 1, 'visible': True}
        ini = dict(base, type='text', name=f'ini{n}', text='', x=x, y=y, width=s, height=s,
                   align='center', verticalAlign='middle', visible=True)
        if not ini_tpl:
            ini.update(fontFamily='HeldaneTextRegular', fontSize=round(s * 0.2), fill='rgba(255,255,255,1)', lineHeight=1.2)
        foto = {'type': 'image', 'name': f'foto{n}', 'x': x, 'y': y, 'width': s, 'height': s, 'src': '',
                'cropX': 0, 'cropY': 0, 'cropWidth': 1, 'cropHeight': 1, 'clipSrc': CIRC, 'opacity': 1, 'visible': True}
        i = next(i for i, e in enumerate(nuevos) if e.get('name') == f'broker{n}')
        nuevos[i:i] = [ph, ini, foto]
    for e in nuevos:
        e.pop('_W', None)
        nm = e.get('name', '')
        if nm.startswith(('broker', 'inmo')):
            # Huecos de datos: siempre visibles (en la historia élite el inmo1 venía oculto en
            # Polotno y Mercedes Rivas salía sin inmobiliaria). fitGroup = los tres del mismo
            # tipo comparten tamaño de letra.
            e['visible'] = True
            e['custom'] = {'fit': True, 'fitGroup': 'broker' if nm.startswith('broker') else 'inmo'}
    page['children'] = nuevos


def normaliza_logos(page, W):
    els = plano(page['children'])
    for e in els:
        m = re.match(r'^logo\s*(\d)$', e.get('name', ''))
        if m:
            e['name'] = f'logo{m.group(1)}'
        if e['type'] == 'text' and re.fullmatch(r'[A-ZÁÉÍÓÚÑ]+ \d{4}', (e.get('text') or '').strip()):
            e['name'] = 'mes'
    # caja uniforme por posición: misma x/alto máximo para que logos de distinta proporción
    # queden alineados (en el original cada logo se acomodó a mano).
    logos = sorted([e for e in els if re.match(r'^logo\d$', e.get('name', ''))], key=lambda e: e['name'])
    x0 = min(e['x'] for e in logos)
    maxW = max(e['width'] for e in logos) * 1.0
    maxH = max(e['height'] for e in logos) * 0.85
    for e in logos:
        cy = e['y'] + e['height'] / 2
        e.update(x=x0, y=cy - maxH / 2, width=maxW, height=maxH, src='',
                 cropX=0, cropY=0, cropWidth=1, cropHeight=1, custom={'logo': True})
    # El número de cada posición viene dibujado en la imagen de fondo. Para poder quitarlo
    # cuando el lugar queda vacío (p. ej. sólo 4 inmobiliarias en onboarding), se agrega un
    # parche oculto num{n} del color del fondo encima del círculo; la app lo enciende.
    fondo = next((e for e in els if e['type'] == 'image' and not e.get('custom', {}).get('logo')
                  and e['width'] >= W * 0.95), None)
    if fondo:
        from PIL import Image
        im = Image.open(io.BytesIO(bytes_de(fondo['src']))).convert('RGB')
        kx, ky = im.width / fondo['width'], im.height / fondo['height']
        nuevos = []
        for e in logos:
            cy = e['y'] + e['height'] / 2
            def extension(y):
                """Extremos (x1, x2) de lo que no es fondo en el renglón y, a la izquierda del logo.
                Fondo = el pixel justo antes de la caja del logo (dentro del panel). Se recorre hacia
                la izquierda y se para al topar con una franja larga distinta: es el borde del panel
                (el post tiene margen blanco)."""
                fila = [im.getpixel((min(im.width - 1, int(x * kx)), min(im.height - 1, int(y * ky)))) for x in range(0, int(x0))]
                bgc = fila[-3]
                dif = lambda c: sum(abs(a - b) for a, b in zip(c, bgc)) > 60
                claros, racha = [], 0
                for x in range(len(fila) - 1, -1, -1):
                    if dif(fila[x]):
                        racha += 1
                        if racha > 25:
                            claros = claros[:-25]
                            break
                        claros.append(x)
                    else:
                        racha = 0
                return (min(claros), max(claros), bgc) if claros else None
            # El logo no siempre está centrado con su número (se acomodaron a mano): se barre una
            # banda de renglones y el más ancho es el que pasa por el centro del círculo.
            banda = [(y, extension(y)) for y in range(int(cy - 45), int(cy + 46), 2)]
            banda = [(y, ex) for y, ex in banda if ex]
            if not banda:
                continue
            ancho = max(ex[1] - ex[0] for _, ex in banda)
            centro_y = [y for y, ex in banda if ex[1] - ex[0] >= ancho - 2]
            cyc = sum(centro_y) / len(centro_y)
            x1, x2, bgc = next(ex for _, ex in banda if ex[1] - ex[0] == ancho)
            r = (x2 - x1) / 2 + 5
            cx = (x1 + x2) / 2
            nuevos.append({'type': 'figure', 'subType': 'circle', 'name': f"num{e['name'][-1]}", 'visible': False,
                           'x': cx - r, 'y': cyc - r, 'width': 2 * r, 'height': 2 * r,
                           'fill': 'rgba(%d,%d,%d,1)' % bgc, 'opacity': 1})
        i = els.index(fondo) + 1
        els[i:i] = nuevos
    page['children'] = els


def externaliza(o):
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if k in ('src', 'background') and isinstance(v, str) and (v.startswith('data:image/png') or v.startswith('data:image/jp') or v.startswith('http')):
                o[k] = guarda(v)
            elif k == 'id' or k == 'animations':
                o.pop(k)
            else:
                externaliza(v)
    elif isinstance(o, list):
        for x in o:
            externaliza(x)


ORDEN = {
    'historia': ['portada', 'elite', 'professional', 'standard', 'consultoria', 'onboarding'],
    'post': ['elite', 'professional', 'standard', 'consultoria', 'onboarding'],
}

for fmt, tipos in ORDEN.items():
    d = json.load(open(os.path.join(AQUI, 'originales', f'{fmt}.json')))
    assert len(d['pages']) == len(tipos), (fmt, len(d['pages']))
    for page, tipo in zip(d['pages'], tipos):
        page['custom'] = {'slide': tipo}
        if tipo in ('elite', 'professional', 'standard'):
            normaliza_brokers(page, d['width'])
        elif tipo in ('consultoria', 'onboarding'):
            normaliza_logos(page, d['width'])
        else:
            els = plano(page['children'])
            for e in els:
                if e.get('name') == 'BODY':
                    e['name'] = 'cuerpo'
                    e['text'] = re.sub(r'mes de \w+\.', 'mes de {{mesNombre}}.', e['text'])
                if e.get('name') == 'MES':
                    e['name'] = 'mes'
            page['children'] = els
        # elementos invisibles fuera (p. ej. la imagen de referencia oculta del post)
        page['children'] = [e for e in page['children'] if e.get('visible', True) or re.match(r'^num\d$', e.get('name', ''))]
    externaliza(d)
    d.pop('audios', None)
    json.dump(d, open(os.path.join(OUT, f'{fmt}.json'), 'w'), ensure_ascii=False)
    print(fmt, 'ok', os.path.getsize(os.path.join(OUT, f'{fmt}.json')) // 1024, 'KB')
print('assets:', len(os.listdir(ASSETS)))
