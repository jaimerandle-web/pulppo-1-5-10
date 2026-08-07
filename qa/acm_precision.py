# ¿Por qué se equivoca el ACM? Compara las 3 anclas de precio contra ventas REALES cerradas.
#
# Genera los números del reporte de precisión del ACM que se compartió con el equipo de devs
# (ago-2026). Réplica exacta de src/lib/comparables.ts para que los comparables sean los mismos
# que consume el producto, no una versión paralela.
#
# Correr:  ~/Documents/Pulppo/.venv-mongo/bin/python qa/acm_precision.py
# Requiere pymongo y la URI read-only en ~/Downloads/mongo_uri.txt.
#
# Hallazgos principales de la corrida de agosto 2026:
#   - ACM: error mediano 11.9%, 46% de aciertos dentro de +-10%. Es la MEJOR de las 3 anclas.
#   - Comparables de cierres 20.8% y de oferta 30.4%; promediarlas empeora el resultado.
#   - Sesgo sistematico de +5%, que se dispara a +19% en propiedades de mas de 250 m2.
#   - Traer mas comparables NO reduce el error (1-4: 12.7% / 10 o mas: 12.2%).
import statistics as st
from collections import defaultdict
from pymongo import MongoClient
from datetime import datetime

db = MongoClient(open('/Users/alebonilla/Downloads/mongo_uri.txt', encoding='utf-8-sig').read().strip()).pulppo
SURF_TOL, MIN_COMPS, PPM_MIN, PPM_MAX = 0.30, 3, 1_000, 1_500_000
med = lambda xs: sorted(xs)[len(xs)//2] if xs else None

def ref_comps(by_nb, by_ci, s):
    nb_arr = by_nb.get(s['nb'], []) if s['nb'] else []
    not_self = lambda x: x['id'] != s['id']
    band = lambda x: (abs(x['surf']/s['surf'] - 1) <= SURF_TOL) if (s['surf'] and x['surf']) else False
    nb_type = [x for x in nb_arr if not_self(x) and x['type'] == s['type']]
    l1 = [x for x in nb_type if band(x) and x['suites'] == s['suites']] if s['suites'] is not None else []
    if len(l1) >= MIN_COMPS: sel, niv = l1, 'colonia+tipo+m²+rec'
    else:
        l2 = [x for x in nb_type if band(x)]
        if len(l2) >= MIN_COMPS: sel, niv = l2, 'colonia+tipo+m²'
        elif len(nb_type) >= MIN_COMPS: sel, niv = nb_type, 'colonia+tipo'
        else:
            ci_type = [x for x in (by_ci.get(s['ci'], []) if s['ci'] else []) if not_self(x) and x['type'] == s['type']]
            if len(ci_type) >= MIN_COMPS: sel, niv = ci_type, 'ciudad+tipo'
            else:
                nb_any = [x for x in nb_arr if not_self(x)]
                sel, niv = (nb_any, 'colonia') if len(nb_any) >= MIN_COMPS else ([], 'sin comparables')
    return med([x['ppm'] for x in sel]), len(sel), niv

# ---------- universo: ventas cerradas con precio de cierre ----------
cierres = {}
for o in db.operations.find({'status.last': {'$in': ['closed', 'paying']}, 'closeValue.value': {'$gt': 0}},
                            {'property._id': 1, 'closeValue.value': 1, 'closedAt': 1}):
    pid = (o.get('property') or {}).get('_id'); v = (o.get('closeValue') or {}).get('value')
    if pid and v: cierres[pid] = {'val': v, 'at': o.get('closedAt')}

vendidas = list(db.properties.find(
    {'_id': {'$in': list(cierres)}, 'listing.operation': 'sale', 'attributes.totalSurface': {'$gt': 0}},
    {'acm': 1, 'listing.value': 1, 'attributes': 1, 'address': 1, 'type': 1, 'company.name': 1}))
print(f'ventas cerradas con superficie: {len(vendidas):,}')

nbids = list({(p.get('address') or {}).get('neighborhood', {}).get('id') for p in vendidas} - {None})
cids  = list({(p.get('address') or {}).get('city', {}).get('id') for p in vendidas} - {None})

# ---------- pool de OFERTA (lo que se pide hoy: mls + red Pulppo) ----------
off_nb, off_ci = defaultdict(list), defaultdict(list)
for coll in ['mls', 'properties']:
    for p in db[coll].find({'address.neighborhood.id': {'$in': nbids}, 'status.last': 'published',
                            'listing.operation': 'sale', 'attributes.totalSurface': {'$gt': 0},
                            'listing.value': {'$gt': 0}},
                           {'type': 1, 'address.neighborhood.id': 1, 'address.city.id': 1,
                            'listing.value': 1, 'attributes.totalSurface': 1, 'attributes.suites': 1}):
        s = (p.get('attributes') or {}).get('totalSurface'); v = (p.get('listing') or {}).get('value')
        if not s or not v: continue
        ppm = v / s
        if not (PPM_MIN <= ppm <= PPM_MAX): continue
        it = {'id': str(p['_id']), 'nb': (p.get('address') or {}).get('neighborhood', {}).get('id'),
              'ci': (p.get('address') or {}).get('city', {}).get('id'), 'type': p.get('type') or '—',
              'surf': s, 'suites': (p.get('attributes') or {}).get('suites'), 'ppm': ppm}
        if it['nb']: off_nb[it['nb']].append(it)
        if it['ci']: off_ci[it['ci']].append(it)

# ---------- pool de CIERRES (lo que realmente se vendió) ----------
clo_nb, clo_ci = defaultdict(list), defaultdict(list)
for p in vendidas:
    s = (p.get('attributes') or {}).get('totalSurface'); v = cierres[p['_id']]['val']
    ppm = v / s
    if not (PPM_MIN <= ppm <= PPM_MAX): continue
    it = {'id': str(p['_id']), 'nb': (p.get('address') or {}).get('neighborhood', {}).get('id'),
          'ci': (p.get('address') or {}).get('city', {}).get('id'), 'type': p.get('type') or '—',
          'surf': s, 'suites': (p.get('attributes') or {}).get('suites'), 'ppm': ppm}
    if it['nb']: clo_nb[it['nb']].append(it)
    if it['ci']: clo_ci[it['ci']].append(it)

# ---------- evaluar las 3 anclas contra el cierre real ----------
filas = []
for p in vendidas:
    surf = (p.get('attributes') or {}).get('totalSurface')
    real = cierres[p['_id']]['val']
    if not (PPM_MIN <= real/surf <= PPM_MAX): continue
    subj = {'id': str(p['_id']), 'nb': (p.get('address') or {}).get('neighborhood', {}).get('id'),
            'ci': (p.get('address') or {}).get('city', {}).get('id'), 'type': p.get('type') or '—',
            'surf': surf, 'suites': (p.get('attributes') or {}).get('suites')}
    acm = ((p.get('acm') or {}).get('price') or {}).get('value')
    val = (p.get('listing') or {}).get('value')
    o_med, o_n, o_niv = ref_comps(off_nb, off_ci, subj)
    c_med, c_n, c_niv = ref_comps(clo_nb, clo_ci, subj)
    v = (p.get('acm') or {}).get('valuation') or {}
    filas.append({
        'real': real, 'surf': surf, 'ask': val, 'acm': acm if acm and 0.2 < real/acm < 5 else None,
        'oferta': o_med * surf if o_med else None, 'ofertaN': o_n, 'ofertaNiv': o_niv,
        'cierres': c_med * surf if c_med else None, 'cierresN': c_n, 'cierresNiv': c_niv,
        'nComp': len(((p.get('acm') or {}).get('comparables') or [])),
        'method': v.get('method'), 'result': v.get('result'), 'acmAt': v.get('timestamp'),
        'closedAt': cierres[p['_id']]['at'], 'type': p.get('type'), 'city': (p.get('address') or {}).get('city', {}).get('name'),
    })

def err(pred, real): return abs(pred/real - 1)
def resumen(nombre, key):
    v = [(f[key], f['real']) for f in filas if f.get(key)]
    if len(v) < 20: return None
    errs = [err(p, r) for p, r in v]
    sesgo = [p/r for p, r in v]
    return (nombre, len(v), 100*st.median(errs), 100*sum(errs)/len(errs),
            st.median(sesgo), 100*sum(1 for e in errs if e <= .10)/len(errs))

print('\n' + '='*94)
print('LAS 3 ANCLAS CONTRA EL PRECIO REAL DE CIERRE')
print('='*94)
print(f"{'ancla':<26}{'n':>6}{'error mediano':>15}{'error medio':>13}{'sesgo':>9}{'aciertos ±10%':>15}")
for nom, k in [('ACM', 'acm'), ('Comparables de OFERTA', 'oferta'), ('Comparables de CIERRES', 'cierres'), ('Precio de lista (asking)', 'ask')]:
    r = resumen(nom, k)
    if r: print(f"{r[0]:<26}{r[1]:>6}{r[2]:>14.1f}%{r[3]:>12.1f}%{r[4]:>9.2f}{r[5]:>14.0f}%")

# mix: promedio de las anclas disponibles
mix = []
for f in filas:
    xs = [f[k] for k in ('acm', 'oferta', 'cierres') if f.get(k)]
    if len(xs) >= 2: mix.append((sum(xs)/len(xs), f['real']))
if len(mix) >= 20:
    errs = [err(p, r) for p, r in mix]
    print(f"{'MIX (promedio de 2 o 3)':<26}{len(mix):>6}{100*st.median(errs):>14.1f}%{100*sum(errs)/len(errs):>12.1f}%"
          f"{st.median([p/r for p, r in mix]):>9.2f}{100*sum(1 for e in errs if e<=.10)/len(errs):>14.0f}%")

print('\n' + '='*94)
print('¿DE DÓNDE VIENE EL ERROR DEL ACM?')
print('='*94)
def corte(lbl, fn, orden=None):
    g = defaultdict(list)
    for f in filas:
        if not f.get('acm'): continue
        k = fn(f)
        if k is not None: g[k].append(err(f['acm'], f['real']))
    print(f'\n  {lbl}')
    keys = orden or sorted(g, key=lambda k: -len(g[k]))
    for k in keys:
        v = g.get(k, [])
        if len(v) < 12: continue
        print(f"     {str(k):<26}{len(v):>5} ventas   error mediano {100*st.median(v):>5.1f}%   error medio {100*sum(v)/len(v):>5.1f}%")

corte('por CANTIDAD DE COMPARABLES que usó el ACM',
      lambda f: '0 comparables' if f['nComp'] == 0 else '1–4' if f['nComp'] <= 4 else '5–9' if f['nComp'] <= 9 else '10 o más',
      ['0 comparables', '1–4', '5–9', '10 o más'])
corte('por MÉTODO', lambda f: f['method'])
corte('por TIPO de propiedad', lambda f: f['type'])
corte('por TICKET', lambda f: 'hasta $4M' if f['real'] < 4e6 else '$4–8M' if f['real'] < 8e6 else '$8–15M' if f['real'] < 15e6 else '+$15M',
      ['hasta $4M', '$4–8M', '$8–15M', '+$15M'])
corte('por SUPERFICIE', lambda f: '<60 m²' if f['surf'] < 60 else '60–120' if f['surf'] < 120 else '120–250' if f['surf'] < 250 else '+250 m²',
      ['<60 m²', '60–120', '120–250', '+250 m²'])

def antig(f):
    a, c = f.get('acmAt'), f.get('closedAt')
    if not isinstance(a, datetime) or not isinstance(c, datetime): return None
    d = (a - c).days
    return 'ACM previo al cierre' if d < -30 else 'ACM cerca del cierre (±30d)' if d <= 30 else 'ACM posterior al cierre'
corte('por MOMENTO en que se calculó el ACM', antig)
corte('por NIVEL al que bajó el motor de comparables (oferta)', lambda f: f['ofertaNiv'])

print('\n' + '='*94)
print('SESGO: ¿sobreestima o subestima, y dónde?')
print('='*94)
for lbl, fn, orden in [('por ticket', lambda f: 'hasta $4M' if f['real']<4e6 else '$4–8M' if f['real']<8e6 else '$8–15M' if f['real']<15e6 else '+$15M', ['hasta $4M','$4–8M','$8–15M','+$15M']),
                       ('por superficie', lambda f: '<60 m²' if f['surf']<60 else '60–120' if f['surf']<120 else '120–250' if f['surf']<250 else '+250 m²', ['<60 m²','60–120','120–250','+250 m²'])]:
    g = defaultdict(list)
    for f in filas:
        if f.get('acm'): g[fn(f)].append(f['acm']/f['real'])
    print(f'\n  {lbl}   (1.00 = clavado · >1 sobreestima · <1 subestima)')
    for k in orden:
        v = g.get(k, [])
        if len(v) >= 12: print(f'     {k:<14}{len(v):>5} ventas   ACM ÷ cierre real = {st.median(v):.2f}')
