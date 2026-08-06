# QA del análisis contra PRODUCCIÓN + cruce independiente contra Mongo.
#
# Este repo no se puede compilar en la mac de Ale (no hay Node), así que este script es la
# verificación automática del proyecto: pega a los endpoints reales y comprueba invariantes
# (el inventario contra Mongo, que el funnel cuadre con los asesores, que los swaps cumplan sus
# reglas, casos borde, rendimiento contra el límite de 60s de la función).
#
# Correr:
#   PULPPO_QA_EMAIL=tu@pulppo.com ~/Documents/Pulppo/.venv-mongo/bin/python qa/qa_analisis.py
#
# Requiere: pymongo + la URI read-only en ~/Downloads/mongo_uri.txt, y que el email esté en el
# allowlist de src/lib/access.ts (la cookie de sesión es el email en texto plano).
import json, subprocess
from pymongo import MongoClient
from bson import ObjectId

URL = 'https://pulppo-1-5-10.vercel.app'
import os
CK = 'cm-user=' + os.environ.get('PULPPO_QA_EMAIL', 'alejandra@pulppo.com')
db = MongoClient(open('/Users/alebonilla/Downloads/mongo_uri.txt', encoding='utf-8-sig').read().strip()).pulppo

CASOS = [
    ('grande',     '', 'NURA'),
    ('mediana',    '', 'Andina Real Estate'),
    ('chica',      '', 'The Property Hub'),
    ('solo-venta', '', 'Grupo Solare Inmobiliaria'),
    ('conocida',   '66f42e98c777e9e33ec3ca6d', 'Arpa'),
    ('grande-2',   '62bf49012367c77fc24d9220', 'Diamond House'),
]
for i, (tag, cid, nm) in enumerate(CASOS):
    if not cid:
        c = db.properties.find_one({'company.name': nm}, {'company._id': 1})
        CASOS[i] = (tag, str(c['company']['_id']), nm)

fails, warns, notes = [], [], []
def chk(cond, msg, hard=True):
    if not cond:
        (fails if hard else warns).append(msg)

def api(path, body, t=120):
    r = subprocess.run(['curl', '-s', '-X', 'POST', f'{URL}{path}', '-H', 'Content-Type: application/json',
                        '-H', f'Cookie: {CK}', '-d', json.dumps(body), '--max-time', str(t),
                        '-w', '\n%{http_code} %{time_total}'], capture_output=True, text=True)
    *rest, last = r.stdout.rsplit('\n', 1)
    code, secs = last.split()
    try: d = json.loads('\n'.join(rest))
    except Exception: d = {'error': 'json inválido'}
    return d, int(code), float(secs)

def num_ok(v):
    return v is None or (isinstance(v, (int, float)) and v == v and abs(v) != float('inf'))

def walk_nums(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items(): yield from walk_nums(v, f'{path}.{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o[:40]): yield from walk_nums(v, f'{path}[{i}]')
    else:
        if isinstance(o, float) and (o != o or abs(o) == float('inf')): yield path, o

print('=' * 96)
print('QA · análisis en producción')
print('=' * 96)

for tag, cid, nm in CASOS:
    body = {'companyId': cid, 'desempeno': 'Mes anterior', 'comparar': 'Período anterior',
            'ventDemanda': 'Últimos 3 meses', 'ventCierres': 'Últimos 12 meses'}
    d, code, secs = api('/api/mb-analisis', body)
    if code != 200 or 'error' in d:
        fails.append(f'[{nm}] la API falló: http={code} {str(d.get("error"))[:70]}')
        print(f'\n■ {nm:<26} http={code}  ← FALLA')
        continue
    P = f'[{nm}]'
    print(f'\n■ {nm:<26} http=200  {secs:.1f}s  N={d["N"]}  asesores={len(d["asesores"])}  swaps={len(d.get("swaps",[]))}')
    if secs > 25: warns.append(f'{P} tardó {secs:.0f}s (límite de la función: 60s)')

    # 1) inventario contra Mongo
    real = db.properties.count_documents({'company._id': ObjectId(cid), 'status.last': 'published'})
    chk(abs(d['N'] - real) <= 2, f'{P} N={d["N"]} pero Mongo dice {real} publicadas')
    chk(d['opSplit']['sale'] + d['opSplit']['rent'] == d['N'], f'{P} opSplit no suma N')

    # 2) funnel coherente
    tot = {'Leads': 0, 'Respondidos': 0, 'Visitas': 0, 'Ofertas': 0, 'Cierres': 0}
    for col in d['funnel']:
        st = {s['label']: s['value'] for s in col['steps']}
        chk(list(st) == ['Leads', 'Respondidos', 'Visitas', 'Ofertas', 'Cierres'], f'{P} pasos del funnel inesperados: {list(st)}')
        chk(st['Respondidos'] <= st['Leads'], f'{P} {col["title"]}: respondidos {st["Respondidos"]} > leads {st["Leads"]}')
        for k in tot: tot[k] += st.get(k, 0)

    # 3) asesores cuadran con el funnel y son internos
    aL = sum(a['leads']['sale'] + a['leads']['rent'] for a in d['asesores'])
    chk(aL + d['externo']['leads'] == tot['Leads'],
        f'{P} asesores({aL}) + externos({d["externo"]["leads"]}) != funnel({tot["Leads"]})')
    for a in d['asesores']:
        L = a['leads']['sale'] + a['leads']['rent']
        R = a['resp']['sale'] + a['resp']['rent']
        S = a['fueraSla']['sale'] + a['fueraSla']['rent']
        chk(R <= L, f'{P} {a["name"]}: respondidos {R} > leads {L}')
        chk(S <= L, f'{P} {a["name"]}: fuera de SLA {S} > leads {L}')
        chk(a['clientes'] <= a['busquedas'] or a['busquedas'] == 0, f'{P} {a["name"]}: clientes {a["clientes"]} > búsquedas {a["busquedas"]}', hard=False)
    nrm = lambda x: ' '.join((x or '').lower().split())
    internos = {n for n in (nrm(' '.join(y for y in [g.get('firstName'), g.get('lastName')] if y))
        for g in db.agents.find({'company._id': ObjectId(cid)}, {'firstName': 1, 'lastName': 1})) if n}
    prop_ag = {nrm(' '.join(y for y in [(p.get('agent') or {}).get('firstName'), (p.get('agent') or {}).get('lastName')] if y))
               for p in db.properties.find({'company._id': ObjectId(cid)}, {'agent': 1})}
    for a in d['asesores']:
        k = ' '.join(a['name'].lower().split())
        chk(k in internos or k in prop_ag, f'{P} "{a["name"]}" no es asesor de la inmobiliaria (broker externo colado)')

    # 4) zonas
    zl = sum(z['leads'] for z in d['zones'])
    chk(zl <= tot['Leads'] + 1, f'{P} leads de zonas={zl} > funnel={tot["Leads"]}')
    for z in d['zones']:
        chk(z['n'] > 0, f'{P} zona {z["nb"]} con 0 props')
        chk(z['demPrev'] >= 0, f'{P} zona {z["nb"]} demPrev negativo')
        if d['hasComp']: chk(z['leadsPrev'] is not None, f'{P} zona {z["nb"]} sin leadsPrev con comparación activa')

    # 5) benchmark
    b = d['bench']
    chk(b['nInmos'] > 0, f'{P} benchmark sin inmobiliarias')
    chk(b['tasaVisita'] is None or 0.02 < b['tasaVisita'] < 0.40, f'{P} benchmark tasaVisita fuera de rango: {b["tasaVisita"]}')

    # 6) externo
    e = d['externo']
    chk(0 <= e['pctLeads'] <= 1 and 0 <= e['pctVisitas'] <= 1, f'{P} porcentajes de red externa fuera de [0,1]')

    # 7) swaps
    DEST = {'Súper destacado', 'Destacado'}
    porcol = {}
    for sw in d.get('swaps', []):
        s, en = sw['sale'], sw['entra']
        chk(s['tier'] in DEST, f'{P} swap: sale {s["code"]} con tier "{s["tier"]}" (no estaba destacada)')
        chk(en['tier'] not in DEST, f'{P} swap: entra {en["code"]} que YA estaba destacada')
        chk(en['sp'] is not None, f'{P} swap: entra {en["code"]} sin ACM')
        chk(en['sp'] is None or en['sp'] <= 1.2001, f'{P} swap: entra {en["code"]} fuera de mercado (sp={en["sp"]})')
        chk(en['calidad'] != 'Baja', f'{P} swap: entra {en["code"]} con ficha Baja')
        porcol[en['nb']] = porcol.get(en['nb'], 0) + 1
    if porcol: chk(max(porcol.values()) <= 2, f'{P} swaps: {max(porcol.values())} entradas en la misma colonia (tope 2)')

    # 8) comparación
    chk(bool(d['yoy']) == d['hasComp'], f'{P} hasComp={d["hasComp"]} pero yoy tiene {len(d["yoy"])} filas')
    # 9) composición de leads
    lc = d['leadsComp']
    chk(lc['cliente'] + lc['broker'] == lc['total'], f'{P} composición: cliente+broker != total')
    # 10) top10
    for t in d['top10']:
        chk(bool(t['lev']), f'{P} top10 {t["code"]} sin palanca')
        chk(t['dz'] > 0, f'{P} top10 {t["code"]} con demanda 0')
    # 11) NaN / Infinity
    for path, v in walk_nums(d):
        fails.append(f'{P} valor no numérico en {path}: {v}')

print('\n' + '=' * 96)
print('CASOS BORDE')
print('=' * 96)
CID = CASOS[4][1]
for lbl, body in [
    ('sin comparación',   {'companyId': CID, 'desempeno': 'Mes anterior', 'comparar': 'Sin comparación'}),
    ('mes viejo (2025)',  {'companyId': CID, 'desempeno': 'Mes específico', 'desempenoMes': '2025-02', 'comparar': 'Período anterior'}),
    ('12 meses',          {'companyId': CID, 'desempeno': 'Últimos 12 meses', 'comparar': 'Mismo período del año pasado'}),
    ('solo renta',        {'companyId': CID, 'desempeno': 'Mes anterior', 'operacion': 'Renta'}),
    ('mes en curso',      {'companyId': CID, 'desempeno': 'Mes actual', 'comparar': 'Período anterior'}),
    ('asesor inexistente',{'companyId': CID, 'desempeno': 'Mes anterior', 'asesor': 'Fulano De Tal'}),
]:
    d, code, secs = api('/api/mb-analisis', body)
    if lbl == 'asesor inexistente':
        ok = code >= 400 and 'error' in d
        print(f'  {lbl:<22} http={code} {secs:.1f}s → {"rechaza con mensaje" if ok else "NO rechaza"}')
        chk(ok, 'un asesor inexistente debería devolver error, no un reporte vacío')
        continue
    if code != 200 or 'error' in d:
        fails.append(f'[borde:{lbl}] http={code} {str(d.get("error"))[:70]}')
        print(f'  {lbl:<22} http={code} ← FALLA: {str(d.get("error"))[:60]}')
        continue
    print(f'  {lbl:<22} http=200 {secs:.1f}s  N={d["N"]} leads={sum(s["value"] for c in d["funnel"] for s in c["steps"] if s["label"]=="Leads")} '
          f'hasComp={d["hasComp"]} funnelCols={[c["title"] for c in d["funnel"]]}')
    if lbl == 'sin comparación':
        chk(not d['hasComp'] and not d['yoy'], 'sin comparación debería dar hasComp=false y yoy vacío')
        chk(all(s['prev'] is None for c in d['funnel'] for s in c['steps']), 'sin comparación no debería traer prev en el funnel')
        chk(all(a['prev'] is None for a in d['asesores']), 'sin comparación no debería traer prev en asesores')
    if lbl == 'solo renta':
        chk([c['title'] for c in d['funnel']] == ['Renta'], 'con operacion=Renta el funnel debería traer solo Renta')

print('\n' + '=' * 96)
print('KAM /api/analisis')
print('=' * 96)
d, code, secs = api('/api/analisis', {'inmo': 'Andina Real Estate', 'desempeno': 'Mes anterior', 'comparar': 'Período anterior'})
print(f'  por nombre           http={code} {secs:.1f}s  {"destacados+swaps ok" if code==200 and "swaps" in d else "REVISAR"}')
chk(code == 200 and 'swaps' in d, 'el endpoint del KAM debería traer swaps')
d2, code2, _ = api('/api/analisis', {'inmo': '(todas)'})
chk(code2 >= 400, 'inmo=(todas) debería rechazarse')
print(f'  inmo=(todas)         http={code2} → {"rechaza" if code2>=400 else "NO rechaza"}')

print('\n' + '=' * 96)
print(f'RESULTADO: {len(fails)} fallas · {len(warns)} advertencias')
print('=' * 96)
for f in fails: print('  ✗', f)
for w in warns: print('  ⚠', w)
if not fails and not warns: print('  sin hallazgos')
