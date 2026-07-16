// Evaluador de elegibilidad 1·5·10: ¿vale la pena meter una propiedad al programa y superdestacarla?
// Da un % de aceptación (precio competitivo + calidad del aviso + comisión + demanda de zona) sobre
// gates intrínsecos (venta · residencial · no desarrollo) y requisitos de material (fotos · video · tour).
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { buildAudience } from './audience';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const RESIDENCIAL = new Set(['Casa', 'Departamento', 'Casa en condominio', 'PH']);

const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let x: unknown = d;
    for (const k of ks) x = x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined;
    return x;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const strip = (s: string) => s.replace(/\b(fracc\.?|fraccionamiento|colonia|col\.?|residencial|barrio|pueblo)\b/gi, '').trim();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export async function evaluarElegibilidad(id: string): Promise<{ code: string; html: string } | null> {
    const db = await getDb();
    let P: Document | null = null;
    try { P = await db.collection('properties').findOne({ _id: new ObjectId(id) }); } catch { /* no ObjectId */ }
    if (!P) P = await db.collection('properties').findOne({ internalId: id.trim().toUpperCase() });
    if (!P) return null;
    const oid = P._id as ObjectId;
    const code = (P.internalId as string) ?? String(oid);

    const typ = (P.type as string) ?? null;
    const op = (dig(P, 'listing', 'operation') as string) ?? null;
    const val = num(dig(P, 'listing', 'value'));
    const acm = num(dig(P, 'acm', 'price', 'value'));
    const m2 = num(dig(P, 'attributes', 'totalSurface')) ?? num(dig(P, 'attributes', 'surface'));
    const ppm2 = val && m2 ? val / m2 : null;
    const col = (dig(P, 'address', 'neighborhood', 'name') as string) ?? null;
    const nid = (dig(P, 'address', 'neighborhood', 'id') as string) ?? null;
    const city = (dig(P, 'address', 'city', 'name') as string) ?? null;
    const cid = (dig(P, 'address', 'city', 'id') as string) ?? null;
    const state = (dig(P, 'address', 'state', 'name') as string) ?? null;
    const street = (dig(P, 'address', 'street') as string)?.trim() || null;
    const q = num(dig(P, 'portals', 'inmuebles24', 'quality'));
    const comm = num(dig(P, 'contract', 'comission'));
    const devObj = P.development;
    const esDesarrollo = !!(devObj && typeof devObj === 'object' && Object.keys(devObj as object).length > 0);
    const pics = ((P.pictures as Document[]) || []).filter((x) => x.public !== false).length;
    const video = Boolean((P.videos as unknown[])?.length) || Boolean(dig(P, 'marketing', 'Video', 'videoUrl'));
    const tour = Boolean(P.virtualTour);

    // título y descripción (mismo criterio que la ficha)
    const title = ((dig(P, 'listing', 'title') as string) ?? '').toLowerCase();
    const desc = (dig(P, 'listing', 'extra', 'description') as string) ?? (dig(P, 'listing', 'description') as string) ?? '';
    const words = desc.trim() ? desc.trim().split(/\s+/).length : 0;
    const descOk = words >= 40 && words <= 200;
    const tipoOk = !!(typ && title.includes(typ.toLowerCase().split(' ')[0]));
    const opOk = /venta|renta/i.test(title);
    const zonaOk = !!(col && strip(col).split(/\s+/).some((w) => w.length > 3 && title.includes(w.toLowerCase())));

    // ---- cierres de la zona (solo venta) para $/m² vendido ----
    const cierres = async (geo: Document): Promise<number[]> => {
        const ps = await db.collection('properties').aggregate([
            { $match: { 'status.last': 'completed', 'listing.operation': 'sale', type: typ, ...geo } },
            { $lookup: { from: 'operations', localField: '_id', foreignField: 'property._id', as: 'op' } },
            { $limit: 400 }
        ]).toArray();
        const out: number[] = [];
        for (const p of ps) { const sm2 = num(dig(p, 'attributes', 'totalSurface')); for (const o of (p.op as Document[]) || []) { const v = num(dig(o, 'closeValue', 'value')); if (v && sm2 && sm2 > 0) out.push(v / sm2); } }
        return out;
    };
    let cz = col ? await cierres({ 'address.neighborhood.name': col }) : [];
    if (cz.length < 5 && city) cz = await cierres({ 'address.city.name': city });
    if (cz.length < 5 && state) cz = await cierres({ 'address.state.name': state });
    const soldMed = cz.length >= 5 ? median(cz) : null;

    // ---- demanda de zona: búsquedas 6m vs oferta MLS ----
    const SIX = new Date(Date.now() - 182 * 86400000);
    let dem = col ? await db.collection('searches').countDocuments({ 'filters.addresses.neighborhood.name': col, createdAt: { $gte: SIX } }, { maxTimeMS: 8000 }) : 0;
    let ofe = nid ? await db.collection('mls').countDocuments({ 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'address.neighborhood.id': nid }, { maxTimeMS: 8000 }) : 0;
    if (dem < 15 && cid) {
        dem = await db.collection('searches').countDocuments({ 'filters.addresses.city.name': city, createdAt: { $gte: SIX } }, { maxTimeMS: 8000 });
        ofe = await db.collection('mls').countDocuments({ 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'address.city.id': cid }, { maxTimeMS: 8000 });
    }
    const ratio = ofe ? dem / ofe : (dem ? 2 : 0);

    // ---- sub-scores (0-1) ----
    const sAcm = acm && val ? clamp(1 - Math.max(0, (val - acm) / acm) / 0.15) : null;
    const sSold = soldMed && ppm2 ? clamp(1 - Math.max(0, (ppm2 - soldMed) / soldMed) / 0.15) : null;
    const sPrecio = sAcm != null && sSold != null ? 0.6 * sAcm + 0.4 * sSold : (sAcm ?? sSold ?? 0.5);
    const sCalidad = 0.7 * clamp((q ?? 0) / 100) + 0.15 * (tipoOk && opOk && zonaOk ? 1 : 0) + 0.15 * (descOk ? 1 : 0);
    const sComision = clamp((comm ?? 0) / 5);
    const sDemanda = dem >= 15 ? clamp(0.3 + 0.7 * clamp(ratio)) : clamp(dem / 15) * 0.4;
    const score = Math.round(40 * sPrecio + 25 * sCalidad + 20 * sComision + 15 * sDemanda);

    // ---- gates ----
    const intr = [
        { k: 'En venta', ok: op === 'sale' },
        { k: 'Residencial (casa/depto)', ok: !!typ && RESIDENCIAL.has(typ) },
        { k: 'No es desarrollo', ok: !esDesarrollo }
    ];
    const mat = [
        { k: '12+ fotos', ok: pics >= 12, v: `${pics} fotos` },
        { k: 'Video', ok: video, v: video ? '✓' : 'falta' },
        { k: 'Tour virtual', ok: tour, v: tour ? '✓' : 'falta' }
    ];
    const okIntr = intr.every((x) => x.ok);
    const okMat = mat.every((x) => x.ok);
    const faltaMat = mat.filter((x) => !x.ok).map((x) => x.k);

    // base de compradores potenciales (mismo motor que las campañas)
    let base = 0, baseLvl = '';
    try { const a = await buildAudience(code); if (a) { base = a.count; baseLvl = a.level; } } catch { /* opcional */ }

    // ---- veredicto ----
    const banda = !okIntr ? 'No aplica' : score >= 75 ? 'Alta' : score >= 55 ? 'Media' : 'Baja';
    const bandaColor = !okIntr ? RED : score >= 75 ? SEA : score >= 55 ? YEL : RED;
    const bandaTxt = !okIntr ? 'No cumple un requisito intrínseco del programa.'
        : score >= 75 ? 'Buena candidata: vale la pena invertir y superdestacarla.'
            : score >= 55 ? 'Candidata media: conviene mejorar precio/aviso antes de invertir.'
                : 'Candidata baja: hoy no conviene superdestacarla.';

    // ---- qué mejorar (palancas) ----
    const lev: string[] = [];
    if (sAcm != null && sAcm < 1 && val && acm) lev.push(`Precio ${Math.round(((val - acm) / acm) * 100)}% por encima del estimado (ACM ${money(acm)}): ajuste a la baja.`);
    if (sSold != null && sSold < 1 && ppm2 && soldMed) lev.push(`Tu $/m² (${money(ppm2)}) está ${Math.round(((ppm2 / soldMed) - 1) * 100)}% arriba del m² de cierre de la zona (${money(soldMed)}).`);
    if (q != null && q < 85) lev.push(`Mejorar la calidad del aviso (${q.toFixed(0)}/100).`);
    if (!(tipoOk && opOk && zonaOk)) lev.push(`Completar el título: falta ${[['tipo', tipoOk], ['operación', opOk], ['zona', zonaOk]].filter(([, o]) => !o).map(([x]) => x).join(', ')}.`);
    if (!descOk) lev.push(`Ajustar la descripción (${words} palabras; ideal 40–200).`);
    if ((comm ?? 0) < 5) lev.push(`Negociar la comisión a 5%${comm != null ? ` (actual ${comm}%)` : ''}.`);
    if (faltaMat.length) lev.push(`Completar material para activar: falta ${faltaMat.join(', ').toLowerCase()}.`);
    if (!lev.length) lev.push('Lista para superdestacar: precio, aviso, comisión y material en orden.');

    // ---------- HTML ----------
    const bar = (lbl: string, s: number, w: string) => {
        const pct = Math.round(s * 100);
        return `<div class="pbar"><span class="pl">${lbl}</span><span class="pt"><span class="pf" style="width:${pct}%;background:${pct >= 70 ? SEA : pct >= 50 ? YEL : RED}"></span></span><span class="pn">${pct}%</span><span class="pw">${w}</span></div>`;
    };
    const chk = (ok: boolean) => `<span style="color:${ok ? SEA : RED};font-weight:700">${ok ? '✓' : '✗'}</span>`;
    const gateRow = (k: string, ok: boolean, v = '') => `<div class="grow">${chk(ok)} <span class="gk">${esc(k)}</span>${v ? `<span class="gv">${esc(v)}</span>` : ''}</div>`;

    const html = `
<style>
.elg-root{width:816px;margin:0 auto;background:#fff;padding:40px 44px;color:${BLK};font-family:'Nunito Sans',sans-serif;font-size:12px;line-height:1.5;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.elg-root *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.elg-root h1{font-family:'EB Garamond',serif;font-weight:400;font-size:32px;line-height:1;margin:0}
.elg-root .header{background:${BLK};color:#fff;padding:24px 30px;display:flex;justify-content:space-between;align-items:center}
.elg-root .eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${GRY}}
.elg-root .sub{font-size:13px;color:#dcdcdc;margin-top:8px}
.elg-root .gauge{text-align:center;min-width:150px}
.elg-root .gauge .big{font-family:'EB Garamond',serif;font-size:52px;line-height:1;color:#fff}
.elg-root .badge{display:inline-block;margin-top:6px;padding:4px 14px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#fff}
.elg-root .accent{width:50px;height:1px;background:${YEL};margin:8px 0 14px}
.elg-root .sec{margin-top:24px}
.elg-root .grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.elg-root .grow{padding:5px 0;border-bottom:1px solid ${LGT};display:flex;align-items:baseline}
.elg-root .gk{margin-left:6px;flex:1}.elg-root .gv{color:${GRY};font-size:11px}
.elg-root .pbar{display:flex;align-items:center;margin:7px 0}
.elg-root .pl{width:120px;font-weight:700}.elg-root .pt{position:relative;width:150px;height:14px;background:${LGT}}.elg-root .pf{position:absolute;left:0;top:0;height:14px}
.elg-root .pn{width:40px;text-align:right;font-weight:700;margin:0 10px}.elg-root .pw{color:${GRY};font-size:11px;flex:1}
.elg-root .box{background:${LGT};padding:16px 18px;margin-top:8px}
.elg-root .kpi{display:flex;gap:24px;margin-top:6px}.elg-root .kpi .n{font-family:'EB Garamond',serif;font-size:24px}.elg-root .kpi .l{font-size:10px;color:${GRY};text-transform:uppercase;letter-spacing:.05em}
.elg-root ul{margin-left:16px}.elg-root li{margin:5px 0;list-style:disc}
.elg-root .banner{padding:10px 14px;font-size:12px;font-weight:700;color:#fff;margin-top:8px}
.elg-root .foot{margin-top:22px;border-top:1px solid ${LGT};padding-top:8px;font-size:9px;color:${GRY}}
@media print{.elg-root{margin:0;padding:24px 30px}.fx-noprint{display:none!important}@page{size:Letter;margin:0}}
</style>
<div class="elg-root">
  <div class="header">
    <div>
      <div class="eyebrow" style="color:${YEL}">Evaluación 1·5·10 · ${esc(code)}</div>
      <h1>${esc(street || col || code)}</h1>
      <div class="sub">${esc(typ)} · ${esc(op === 'sale' ? 'Venta' : op)} · ${esc(col)}, ${esc(city)} · ${money(val)} · ${money(ppm2)}/m²</div>
    </div>
    <div class="gauge">
      <div class="big">${okIntr ? `${score}%` : 'N/A'}</div>
      <div class="badge" style="background:${bandaColor}">${banda}</div>
    </div>
  </div>

  ${!okIntr ? `<div class="banner" style="background:${RED}">No aplica al programa: ${esc(intr.filter((x) => !x.ok).map((x) => x.k.toLowerCase()).join(', '))}.</div>` : ''}

  <div class="sec"><div class="eyebrow">¿Aplica al programa?</div><div class="accent"></div>
    <div class="grid2">
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Requisitos intrínsecos</div>${intr.map((x) => gateRow(x.k, x.ok)).join('')}</div>
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Material (para activar y superdestacar)</div>${mat.map((x) => gateRow(x.k, x.ok, x.v)).join('')}
        <div style="margin-top:8px;font-size:11px;color:${okMat ? SEA : '#A5700a'}">${okMat ? '✓ Material completo: lista para activar.' : `Requiere material antes de superdestacar: falta ${esc(faltaMat.join(', ').toLowerCase())}.`}</div>
      </div>
    </div>
  </div>

  <div class="sec"><div class="eyebrow">Puntaje de aceptación</div><div class="accent"></div>
    <p style="margin:0 0 10px;font-size:12px">${bandaTxt}</p>
    ${bar('Precio competitivo', sPrecio, `vs ACM ${sAcm != null ? Math.round(sAcm * 100) + '%' : 'n/d'} · vs cierres ${sSold != null ? Math.round(sSold * 100) + '%' : 'n/d'}`)}
    ${bar('Calidad del aviso', sCalidad, `i24 ${q != null ? q.toFixed(0) + '/100' : 'n/d'} · título ${tipoOk && opOk && zonaOk ? 'ok' : 'incompleto'}`)}
    ${bar('Comisión', sComision, comm != null ? `${comm}% + IVA` : 'sin dato')}
    ${bar('Demanda de zona', sDemanda, `${dem.toLocaleString('es-MX')} búsquedas · ${ofe.toLocaleString('es-MX')} en venta (6m)`)}
    <div style="font-size:9px;color:${GRY};margin-top:6px">Pesos: precio 40% · calidad 25% · comisión 20% · demanda 15%. Ajustables.</div>
  </div>

  <div class="sec"><div class="eyebrow">Contexto de mercado y demanda</div><div class="accent"></div>
    <div class="kpi">
      <div><div class="n">${money(ppm2)}</div><div class="l">$/m² de esta propiedad</div></div>
      ${soldMed ? `<div><div class="n">${money(soldMed)}</div><div class="l">$/m² mediana de cierres</div></div>` : ''}
      ${acm ? `<div><div class="n">${val && acm ? `${((val - acm) / acm * 100 >= 0 ? '+' : '')}${Math.round((val - acm) / acm * 100)}%` : '—'}</div><div class="l">precio vs ACM (${money(acm)})</div></div>` : ''}
      <div><div class="n">${base.toLocaleString('es-MX')}</div><div class="l">compradores potenciales${baseLvl ? ` (${baseLvl})` : ''}</div></div>
    </div>
  </div>

  <div class="sec"><div class="eyebrow">Qué mejorar para acelerar la venta</div><div class="accent"></div>
    <div class="box"><ul>${lev.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  </div>

  <div class="foot">Pulppo · 1·5·10 — Evaluación de elegibilidad generada ${new Date().toISOString().slice(0, 10)}. Datos en vivo. Requiere venta, residencial y no desarrollo; material (foto+video+tour) para activar.</div>
</div>`;
    return { code, html };
}
