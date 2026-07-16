// Evaluador de elegibilidad 1·5·10: ¿vale la pena meter una propiedad al programa y superdestacarla?
// Da un % de aceptación (precio competitivo vs mix ACM·oferta·cierres + calidad del aviso + comisión +
// demanda de zona) sobre gates intrínsecos (venta · residencial · no desarrollo) y requisitos de material
// (fotos · video · tour). computeEval() = datos estructurados (usado por scorecard y modo lote);
// renderScorecard() = HTML on-brand imprimible.
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
const pct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? Math.round(((a / b) - 1) * 100) : null);

export interface EvalResult {
    id: string; code: string; title: string; typ: string | null; op: string | null;
    col: string | null; city: string | null; street: string | null;
    val: number | null; acm: number | null; m2: number | null; ppm2: number | null;
    intr: { k: string; ok: boolean }[]; okIntr: boolean;
    mat: { k: string; ok: boolean; v: string }[]; okMat: boolean; faltaMat: string[];
    sPrecio: number; sCalidad: number; sComision: number; sDemanda: number; score: number;
    banda: string; bandaTxt: string;
    sAcm: number | null; sSold: number | null; sOferta: number | null;
    askingMed: number | null; soldMed: number | null;
    vsAcm: number | null; vsOferta: number | null; vsCierre: number | null;
    q: number | null; comm: number | null; tipoOk: boolean; opOk: boolean; zonaOk: boolean; descOk: boolean; words: number;
    dem: number; ofe: number; velocidadMed: number | null; meses: number | null; nuevoPrecio: { pct: number } | null;
    base: number; baseLvl: string; scope: string;
    lev: string[];
}

export async function computeEval(id: string, opts: { withBase?: boolean } = {}): Promise<EvalResult | null> {
    const db = await getDb();
    let P: Document | null = null;
    try { P = await db.collection('properties').findOne({ _id: new ObjectId(id) }); } catch { /* no ObjectId */ }
    if (!P) P = await db.collection('properties').findOne({ internalId: id.trim().toUpperCase() });
    if (!P) return null;
    const now = Date.now();
    const code = (P.internalId as string) ?? String(P._id);
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
    const pub = P.publishedAt instanceof Date ? (P.publishedAt as Date) : null;
    const meses = pub ? Math.floor((now - pub.getTime()) / (30.44 * 86400000)) : null;

    // rebaja de precio (best-effort: listing.prices con historial)
    const prices = (dig(P, 'listing', 'prices') as Document[]) || [];
    let nuevoPrecio: { pct: number } | null = null;
    if (prices.length > 1) {
        const a = num(prices[prices.length - 1]?.price), b = num(prices[prices.length - 2]?.price);
        if (a && b && a < b) nuevoPrecio = { pct: Math.round(((a / b) - 1) * 100) };
    }

    const title = ((dig(P, 'listing', 'title') as string) ?? '').toLowerCase();
    const desc = (dig(P, 'listing', 'extra', 'description') as string) ?? (dig(P, 'listing', 'description') as string) ?? '';
    const words = desc.trim() ? desc.trim().split(/\s+/).length : 0;
    const descOk = words >= 40 && words <= 200;
    const tipoOk = !!(typ && title.includes(typ.toLowerCase().split(' ')[0]));
    const opOk = /venta|renta/i.test(title);
    const zonaOk = !!(col && strip(col).split(/\s+/).some((w) => w.length > 3 && title.includes(w.toLowerCase())));

    // cierres (solo venta) → $/m² vendido de la zona
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
    let scope = col ?? '', cz = col ? await cierres({ 'address.neighborhood.name': col }) : [];
    if (cz.length < 5 && city) { scope = city; cz = await cierres({ 'address.city.name': city }); }
    if (cz.length < 5 && state) { scope = state; cz = await cierres({ 'address.state.name': state }); }
    const soldMed = cz.length >= 5 ? median(cz) : null;

    // oferta (pedido) → mediana $/m² de lo publicado (pulppo + mls) por colonia→ciudad
    const askingPpm = async (geoField: string, geoVal: string): Promise<number[]> => {
        const proj = { projection: { 'listing.value': 1, 'attributes.totalSurface': 1 }, limit: 250 } as const;
        const base = { 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 }, [geoField]: geoVal };
        const rows = [...await db.collection('mls').find(base, proj).toArray(), ...await db.collection('properties').find({ ...base, _id: { $ne: P!._id } }, proj).toArray()];
        return rows.map((r) => { const v = num(dig(r, 'listing', 'value')), mm = num(dig(r, 'attributes', 'totalSurface')); return v && mm ? v / mm : null; }).filter((x): x is number => x != null);
    };
    let ask = nid ? await askingPpm('address.neighborhood.id', nid) : [];
    if (ask.length < 8 && cid) ask = await askingPpm('address.city.id', cid);
    const askingMed = ask.length >= 5 ? median(ask) : null;

    // velocidad de venta de la zona (días publicado → vendido)
    const velocidad = async (geo: Document): Promise<number[]> => {
        const ps = await db.collection('properties').aggregate([
            { $match: { 'status.last': 'completed', 'listing.operation': 'sale', type: typ, ...geo } },
            { $project: { publishedAt: 1, hist: '$status.history' } }, { $limit: 300 }
        ]).toArray();
        const out: number[] = [];
        for (const p of ps) {
            const pb = p.publishedAt instanceof Date ? (p.publishedAt as Date) : null;
            const comps = ((p.hist as Document[]) || []).filter((h) => (h.last ?? h.status) === 'completed').map((h) => h.date ?? h.timestamp).filter((d): d is Date => d instanceof Date);
            if (pb && comps.length) { const d = (Math.max(...comps.map((c) => c.getTime())) - pb.getTime()) / 86400000; if (d > 0 && d < 2000) out.push(d); }
        }
        return out;
    };
    let vel = col ? await velocidad({ 'address.neighborhood.name': col }) : [];
    if (vel.length < 8 && city) vel = await velocidad({ 'address.city.name': city });
    const velocidadMed = vel.length >= 8 ? median(vel) : null;

    // demanda de zona: búsquedas 6m vs oferta MLS
    const SIX = new Date(now - 182 * 86400000);
    let dem = col ? await db.collection('searches').countDocuments({ 'filters.addresses.neighborhood.name': col, createdAt: { $gte: SIX } }, { maxTimeMS: 8000 }) : 0;
    let ofe = nid ? await db.collection('mls').countDocuments({ 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'address.neighborhood.id': nid }, { maxTimeMS: 8000 }) : 0;
    if (dem < 15 && cid) {
        dem = await db.collection('searches').countDocuments({ 'filters.addresses.city.name': city, createdAt: { $gte: SIX } }, { maxTimeMS: 8000 });
        ofe = await db.collection('mls').countDocuments({ 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'address.city.id': cid }, { maxTimeMS: 8000 });
    }
    const ratio = ofe ? dem / ofe : (dem ? 2 : 0);

    // sub-scores: precio = mix ACM 0.5 · cierres 0.35 · oferta 0.15
    const sAcm = acm && val ? clamp(1 - Math.max(0, (val - acm) / acm) / 0.15) : null;
    const sSold = soldMed && ppm2 ? clamp(1 - Math.max(0, (ppm2 - soldMed) / soldMed) / 0.15) : null;
    const sOferta = askingMed && ppm2 ? clamp(1 - Math.max(0, (ppm2 - askingMed) / askingMed) / 0.15) : null;
    const refs: [number, number][] = [];
    if (sAcm != null) refs.push([sAcm, 0.5]);
    if (sSold != null) refs.push([sSold, 0.35]);
    if (sOferta != null) refs.push([sOferta, 0.15]);
    const wsum = refs.reduce((a, [, w]) => a + w, 0);
    const sPrecio = wsum ? refs.reduce((a, [s, w]) => a + s * w, 0) / wsum : 0.5;
    const sCalidad = 0.7 * clamp((q ?? 0) / 100) + 0.15 * (tipoOk && opOk && zonaOk ? 1 : 0) + 0.15 * (descOk ? 1 : 0);
    const sComision = clamp((comm ?? 0) / 5);
    const sDemanda = dem >= 15 ? clamp(0.3 + 0.7 * clamp(ratio)) : clamp(dem / 15) * 0.4;
    const score = Math.round(40 * sPrecio + 25 * sCalidad + 20 * sComision + 15 * sDemanda);

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
    const banda = !okIntr ? 'No aplica' : score >= 75 ? 'Alta' : score >= 55 ? 'Media' : 'Baja';
    const bandaTxt = !okIntr ? 'No cumple un requisito intrínseco del programa.'
        : score >= 75 ? 'Buena candidata: vale la pena invertir y superdestacarla.'
            : score >= 55 ? 'Candidata media: conviene mejorar precio/aviso antes de invertir.'
                : 'Candidata baja: hoy no conviene superdestacarla.';

    let base = 0, baseLvl = '';
    if (opts.withBase !== false) { try { const a = await buildAudience(code); if (a) { base = a.count; baseLvl = a.level; } } catch { /* opcional */ } }

    const vsAcm = pct(val, acm), vsOferta = pct(ppm2, askingMed), vsCierre = pct(ppm2, soldMed);
    const lev: string[] = [];
    if (sAcm != null && sAcm < 1 && vsAcm != null) lev.push(`Precio ${vsAcm}% por encima del estimado (ACM ${money(acm)}): ajuste a la baja.`);
    if (sSold != null && sSold < 1 && vsCierre != null) lev.push(`Tu $/m² (${money(ppm2)}) está ${vsCierre}% arriba del m² que se CIERRA en la zona (${money(soldMed)}).`);
    if (velocidadMed != null && meses != null && meses * 30.44 > velocidadMed * 1.5) lev.push(`Lleva ${meses} meses publicada y la zona vende en ~${Math.round(velocidadMed)} días: revisar precio/difusión.`);
    if (q != null && q < 85) lev.push(`Mejorar la calidad del aviso (${q.toFixed(0)}/100).`);
    if (!(tipoOk && opOk && zonaOk)) lev.push(`Completar el título: falta ${[['tipo', tipoOk], ['operación', opOk], ['zona', zonaOk]].filter(([, o]) => !o).map(([x]) => x).join(', ')}.`);
    if (!descOk) lev.push(`Ajustar la descripción (${words} palabras; ideal 40–200).`);
    if ((comm ?? 0) < 5) lev.push(`Negociar la comisión a 5%${comm != null ? ` (actual ${comm}%)` : ''}.`);
    if (faltaMat.length) lev.push(`Completar material para activar: falta ${faltaMat.join(', ').toLowerCase()}.`);
    if (!lev.length) lev.push('Lista para superdestacar: precio, aviso, comisión y material en orden.');

    return {
        id: String(P._id), code, title: (dig(P, 'listing', 'title') as string) ?? code, typ, op, col, city, street,
        val, acm, m2, ppm2, intr, okIntr, mat, okMat, faltaMat,
        sPrecio, sCalidad, sComision, sDemanda, score, banda, bandaTxt,
        sAcm, sSold, sOferta, askingMed, soldMed, vsAcm, vsOferta, vsCierre,
        q, comm, tipoOk, opOk, zonaOk, descOk, words, dem, ofe, velocidadMed, meses, nuevoPrecio,
        base, baseLvl, scope, lev
    };
}

export function renderScorecard(r: EvalResult): string {
    const bandaColor = r.banda === 'No aplica' ? RED : r.banda === 'Alta' ? SEA : r.banda === 'Media' ? YEL : RED;
    const bar = (lbl: string, s: number, w: string) => {
        const p = Math.round(s * 100);
        return `<div class="pbar"><span class="pl">${lbl}</span><span class="pt"><span class="pf" style="width:${p}%;background:${p >= 70 ? SEA : p >= 50 ? YEL : RED}"></span></span><span class="pn">${p}%</span><span class="pw">${w}</span></div>`;
    };
    const chk = (ok: boolean) => `<span style="color:${ok ? SEA : RED};font-weight:700">${ok ? '✓' : '✗'}</span>`;
    const gate = (k: string, ok: boolean, v = '') => `<div class="grow">${chk(ok)} <span class="gk">${esc(k)}</span>${v ? `<span class="gv">${esc(v)}</span>` : ''}</div>`;
    const refRow = (k: string, medd: number | null, delta: number | null, note: string) =>
        `<div class="grow"><span class="gk" style="margin-left:0"><b>${esc(k)}</b> ${note}</span><span class="gv">${medd != null ? money(medd) + '/m²' : '—'}${delta != null ? ` · tú ${delta >= 0 ? '+' : ''}${delta}%` : ''}</span></div>`;

    return `
<style>
.elg-root{width:816px;margin:0 auto;background:#fff;padding:40px 44px;color:${BLK};font-family:'Nunito Sans',sans-serif;font-size:12px;line-height:1.5;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.elg-root *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.elg-root h1{font-family:'EB Garamond',serif;font-weight:400;font-size:32px;line-height:1;margin:0}
.elg-root .header{background:${BLK};color:#fff;padding:24px 30px;display:flex;justify-content:space-between;align-items:center}
.elg-root .eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${GRY}}
.elg-root .sub{font-size:13px;color:#dcdcdc;margin-top:8px}
.elg-root .gauge{text-align:center;min-width:150px}.elg-root .gauge .big{font-family:'EB Garamond',serif;font-size:52px;line-height:1;color:#fff}
.elg-root .badge{display:inline-block;margin-top:6px;padding:4px 14px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#fff}
.elg-root .accent{width:50px;height:1px;background:${YEL};margin:8px 0 14px}
.elg-root .sec{margin-top:24px}.elg-root .grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.elg-root .grow{padding:5px 0;border-bottom:1px solid ${LGT};display:flex;align-items:baseline}
.elg-root .gk{margin-left:6px;flex:1}.elg-root .gv{color:${GRY};font-size:11px;text-align:right;white-space:nowrap}
.elg-root .pbar{display:flex;align-items:center;margin:7px 0}
.elg-root .pl{width:120px;font-weight:700}.elg-root .pt{position:relative;width:150px;height:14px;background:${LGT}}.elg-root .pf{position:absolute;left:0;top:0;height:14px}
.elg-root .pn{width:40px;text-align:right;font-weight:700;margin:0 10px}.elg-root .pw{color:${GRY};font-size:11px;flex:1}
.elg-root .box{background:${LGT};padding:16px 18px;margin-top:8px}
.elg-root .kpi{display:flex;flex-wrap:wrap;gap:22px;margin-top:6px}.elg-root .kpi .n{font-family:'EB Garamond',serif;font-size:22px}.elg-root .kpi .l{font-size:10px;color:${GRY};text-transform:uppercase;letter-spacing:.05em}
.elg-root ul{margin-left:16px}.elg-root li{margin:5px 0;list-style:disc}
.elg-root .banner{padding:10px 14px;font-size:12px;font-weight:700;color:#fff;margin-top:8px}
.elg-root .foot{margin-top:22px;border-top:1px solid ${LGT};padding-top:8px;font-size:9px;color:${GRY}}
@media print{.elg-root{margin:0;padding:24px 30px}.fx-noprint{display:none!important}@page{size:Letter;margin:0}}
</style>
<div class="elg-root">
  <div class="header">
    <div>
      <div class="eyebrow" style="color:${YEL}">Evaluación 1·5·10 · ${esc(r.code)}</div>
      <h1>${esc(r.street || r.col || r.code)}</h1>
      <div class="sub">${esc(r.typ)} · ${esc(r.op === 'sale' ? 'Venta' : r.op)} · ${esc(r.col)}, ${esc(r.city)} · ${money(r.val)} · ${money(r.ppm2)}/m²</div>
    </div>
    <div class="gauge"><div class="big">${r.okIntr ? `${r.score}%` : 'N/A'}</div><div class="badge" style="background:${bandaColor}">${r.banda}</div></div>
  </div>

  ${!r.okIntr ? `<div class="banner" style="background:${RED}">No aplica al programa: ${esc(r.intr.filter((x) => !x.ok).map((x) => x.k.toLowerCase()).join(', '))}.</div>` : ''}

  <div class="sec"><div class="eyebrow">¿Aplica al programa?</div><div class="accent"></div>
    <div class="grid2">
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Requisitos intrínsecos</div>${r.intr.map((x) => gate(x.k, x.ok)).join('')}</div>
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Material (para activar y superdestacar)</div>${r.mat.map((x) => gate(x.k, x.ok, x.v)).join('')}
        <div style="margin-top:8px;font-size:11px;color:${r.okMat ? SEA : '#A5700a'}">${r.okMat ? '✓ Material completo: lista para activar.' : `Requiere material antes de superdestacar: falta ${esc(r.faltaMat.join(', ').toLowerCase())}.`}</div>
      </div>
    </div>
  </div>

  <div class="sec"><div class="eyebrow">Puntaje de aceptación</div><div class="accent"></div>
    <p style="margin:0 0 10px;font-size:12px">${r.bandaTxt}</p>
    ${bar('Precio competitivo', r.sPrecio, `ACM ${r.sAcm != null ? Math.round(r.sAcm * 100) + '%' : 'n/d'} · cierres ${r.sSold != null ? Math.round(r.sSold * 100) + '%' : 'n/d'} · oferta ${r.sOferta != null ? Math.round(r.sOferta * 100) + '%' : 'n/d'}`)}
    ${bar('Calidad del aviso', r.sCalidad, `i24 ${r.q != null ? r.q.toFixed(0) + '/100' : 'n/d'} · título ${r.tipoOk && r.opOk && r.zonaOk ? 'ok' : 'incompleto'}`)}
    ${bar('Comisión', r.sComision, r.comm != null ? `${r.comm}% + IVA` : 'sin dato')}
    ${bar('Demanda de zona', r.sDemanda, `${r.dem.toLocaleString('es-MX')} búsquedas · ${r.ofe.toLocaleString('es-MX')} en venta (6m)`)}
    <div style="font-size:9px;color:${GRY};margin-top:6px">Pesos: precio 40% · calidad 25% · comisión 20% · demanda 15%. Ajustables.</div>
  </div>

  <div class="sec"><div class="eyebrow">Referencia de precio · mix ACM · oferta · cierres</div><div class="accent"></div>
    ${refRow('Estimado (ACM)', r.acm && r.m2 ? r.acm / r.m2 : null, r.vsAcm, `valor ${money(r.acm)}`)}
    ${refRow('Oferta (lo que se pide)', r.askingMed, r.vsOferta, `mediana de publicados · ${esc(r.scope)}`)}
    ${refRow('Cierres (lo que se vende)', r.soldMed, r.vsCierre, `mediana de ventas · ${esc(r.scope)}`)}
    <div style="margin-top:8px;font-size:11px;color:${BLK}">${
        r.vsCierre != null
            ? `Estás a ${money(r.ppm2)}/m²: ${r.vsCierre <= 0 ? 'por debajo o en línea con lo que se cierra' : `${r.vsCierre}% arriba de lo que se cierra`}${r.vsOferta != null ? ` y ${r.vsOferta <= 0 ? `${Math.abs(r.vsOferta)}% por debajo de lo que se pide (competitivo)` : `${r.vsOferta}% arriba de lo que se pide`}` : ''}.`
            : 'Sin cierres suficientes para validar el precio contra ventas reales.'
    }</div>
  </div>

  <div class="sec"><div class="eyebrow">Contexto de mercado y demanda</div><div class="accent"></div>
    <div class="kpi">
      ${r.velocidadMed != null ? `<div><div class="n">${Math.round(r.velocidadMed)} días</div><div class="l">velocidad de venta zona</div></div>` : ''}
      ${r.meses != null ? `<div><div class="n">${r.meses} mes${r.meses === 1 ? '' : 'es'}</div><div class="l">antigüedad publicada</div></div>` : ''}
      ${r.nuevoPrecio ? `<div><div class="n">${r.nuevoPrecio.pct}%</div><div class="l">rebaja de precio reciente</div></div>` : ''}
      <div><div class="n">${r.base.toLocaleString('es-MX')}</div><div class="l">compradores potenciales${r.baseLvl ? ` (${r.baseLvl})` : ''}</div></div>
    </div>
  </div>

  <div class="sec"><div class="eyebrow">Qué mejorar para acelerar la venta</div><div class="accent"></div>
    <div class="box"><ul>${r.lev.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  </div>

  <div class="foot">Pulppo · 1·5·10 — Evaluación de elegibilidad generada ${new Date().toISOString().slice(0, 10)}. Datos en vivo. Requiere venta, residencial y no desarrollo; material (foto+video+tour) para activar.</div>
</div>`;
}

export async function evaluarElegibilidad(id: string): Promise<{ code: string; html: string } | null> {
    const r = await computeEval(id);
    if (!r) return null;
    return { code: r.code, html: renderScorecard(r) };
}
