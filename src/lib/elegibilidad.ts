// Evaluador de elegibilidad 1·5·10: ¿conviene convertir esta propiedad a exclusiva del programa?
// El veredicto es sobre CONVERTIRLA, no sobre pautarla: si además conviene pagarle un lugar
// destacado en el portal es otra pregunta, la contesta el motor de portales y se mide distinto
// (valor = P(venta 6m) × regalía). Mezclarlas daba dos respuestas a la misma pregunta.
// Da un % de aceptación (precio competitivo vs mix ACM·oferta·cierres + calidad del aviso + comisión +
// demanda de zona) sobre gates intrínsecos (venta · residencial; ser desarrollo NO descalifica: solo
// dispara un disclaimer de "posible rechazo") y requisitos de material
// (fotos · video · tour). computeEval() = datos estructurados (usado por scorecard y modo lote);
// renderScorecard() = HTML on-brand imprimible.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { buildAudience } from './audience';
import { firstPublished, mercadoEval, funnelEval, type MercadoEval, type FunnelEval } from './ficha';

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
    /** comisión 5% + IVA y contrato de exclusiva firmado: no descalifican, pero sin ellos no se activa */
    contrato: { k: string; ok: boolean; v: string }[]; okContrato: boolean; faltaContrato: string[];
    esDesarrollo: boolean;
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
    /** sólo en la evaluación individual (el modo lote no los calcula, para ser rápido) */
    mercado: MercadoEval | null;
    /** null si lleva menos de un mes publicada: todavía no hay funnel que leer */
    funnel: FunnelEval | null;
}

// El programa pide 5% + IVA. `contract.comission` guarda el % SIN IVA, salvo cuando
// `contract.ivaIncluded` es true (59 de ~7,200 publicadas): ahí el 5 cargado es 4.31 + IVA y no cumple.
const COMISION_META = 5, IVA = 1.16;
// Ventana a partir de la cual la propiedad "ya lleva tiempo" y el funnel dice algo.
const MESES_FUNNEL = 1;
// `contract.status`: pending (sin documento) → revision → approved → contract_sent (enviado a firma)
// → completed (firmado). La exclusiva es `contract.exclusive.start` + `durationMonths`.
const ESTADO_CONTRATO: Record<string, string> = {
    pending: 'sin contrato cargado', revision: 'contrato en revisión', approved: 'aprobado, falta enviarlo a firma',
    contract_sent: 'enviado a firma, sin firmar', rejected: 'contrato rechazado'
};
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fdate = (d: Date) => `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// `contract.comission` viene en float crudo (3.4799999999999995): sin esto se imprime entero.
const redondo = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-MX');

export async function computeEval(id: string, opts: { withBase?: boolean; detalle?: boolean } = {}): Promise<EvalResult | null> {
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
    // primera publicación real: publishedAt se reinicia al republicar y daba "0 meses" a una de un año
    const pub = firstPublished(P);
    const meses = pub ? Math.floor((now - pub.getTime()) / (30.44 * 86400000)) : null;

    // Contexto de mercado + funnel: mismas funciones que la ficha individual. Arrancan ya, en paralelo
    // con el resto de las consultas, y se esperan al final.
    const detalle = opts.detalle !== false;
    const detalleP: Promise<[MercadoEval | null, FunnelEval | null]> = detalle
        ? Promise.all([
            mercadoEval(P).catch(() => null),
            meses != null && meses >= MESES_FUNNEL ? funnelEval(P).catch(() => null) : Promise.resolve(null)
        ])
        : Promise.resolve([null, null]);

    // ---- comisión 5% + IVA ----
    const ivaIncluido = dig(P, 'contract', 'ivaIncluded') === true;
    const commNeta = comm == null ? null : ivaIncluido ? comm / IVA : comm;
    const okComision = commNeta != null && commNeta >= COMISION_META - 0.005;
    const vComision = comm == null ? 'sin comisión cargada'
        : ivaIncluido ? `${redondo(comm)}% IVA incluido = ${redondo(commNeta!)}% + IVA`
            : `${redondo(comm)}% + IVA`;

    // ---- contrato de exclusiva firmado ----
    const cStatus = (dig(P, 'contract', 'status') as string) ?? 'pending';
    const exRaw = dig(P, 'contract', 'exclusive', 'start');
    const exStart = exRaw instanceof Date ? exRaw : typeof exRaw === 'string' && !isNaN(Date.parse(exRaw)) ? new Date(exRaw) : null;
    const exDur = num(dig(P, 'contract', 'exclusive', 'durationMonths'));
    let exVence: Date | null = null;
    if (exStart && exDur) { exVence = new Date(exStart); exVence.setMonth(exVence.getMonth() + exDur); }
    let okExclusiva = false, vExclusiva: string;
    if (!exStart) vExclusiva = cStatus === 'completed' ? 'contrato firmado, pero sin exclusiva' : 'sin exclusiva cargada';
    else if (cStatus !== 'completed') vExclusiva = ESTADO_CONTRATO[cStatus] ?? cStatus;
    else if (exVence && exVence.getTime() < now) vExclusiva = `vencida el ${fdate(exVence)}`;
    else { okExclusiva = true; vExclusiva = exVence ? `firmada · vence ${fdate(exVence)}` : 'firmada'; }

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

    // oferta (pedido) → mediana $/m² de lo publicado (pulppo + mls) por colonia→ciudad.
    // Sobre TODO lo publicado de la zona, calculado en Mongo: antes se tomaban los primeros 250 del
    // `mls` en orden natural y ese orden no es aleatorio — en Polanco (deptos) los primeros 250 daban
    // $6,846/m² contra $90,569 del conjunto completo (3,802 avisos), y el "vs. oferta" salía +201%.
    const askingPpm = async (geoField: string, geoVal: string): Promise<number[]> => {
        const base = { 'listing.operation': 'sale', type: typ, 'status.last': 'published', 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 }, [geoField]: geoVal };
        const ppm = (m: Document) => [{ $match: m }, { $limit: 8000 }, { $project: { _id: 0, p: { $divide: ['$listing.value', '$attributes.totalSurface'] } } }];
        const [a, b] = await Promise.all([
            db.collection('mls').aggregate(ppm(base), { maxTimeMS: 15000 }).toArray(),
            db.collection('properties').aggregate(ppm({ ...base, _id: { $ne: P!._id } }), { maxTimeMS: 15000 }).toArray()
        ]);
        return [...a, ...b].map((r) => num(r.p)).filter((x): x is number => x != null);
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
    const sComision = clamp((commNeta ?? 0) / COMISION_META);
    const sDemanda = dem >= 15 ? clamp(0.3 + 0.7 * clamp(ratio)) : clamp(dem / 15) * 0.4;
    const score = Math.round(40 * sPrecio + 25 * sCalidad + 20 * sComision + 15 * sDemanda);

    // Ser desarrollo NO descalifica: solo dispara un disclaimer de "posible rechazo" (se revisa caso a
    // caso). Los gates intrínsecos que sí descalifican son venta y residencial.
    const intr = [
        { k: 'En venta', ok: op === 'sale' },
        { k: 'Residencial (casa/depto)', ok: !!typ && RESIDENCIAL.has(typ) }
    ];
    const mat = [
        { k: '12+ fotos', ok: pics >= 12, v: `${pics} fotos` },
        { k: 'Video', ok: video, v: video ? '✓' : 'falta' },
        { k: 'Tour virtual', ok: tour, v: tour ? '✓' : 'falta' }
    ];
    const contrato = [
        { k: 'Comisión 5% + IVA', ok: okComision, v: vComision },
        { k: 'Contrato de exclusiva firmado', ok: okExclusiva, v: vExclusiva }
    ];
    const okContrato = contrato.every((x) => x.ok);
    const faltaContrato = contrato.filter((x) => !x.ok).map((x) => x.k);
    const okIntr = intr.every((x) => x.ok);
    const okMat = mat.every((x) => x.ok);
    const faltaMat = mat.filter((x) => !x.ok).map((x) => x.k);
    const banda = !okIntr ? 'No aplica' : score >= 75 ? 'Alta' : score >= 55 ? 'Media' : 'Baja';
    const bandaTxt = !okIntr ? 'No cumple un requisito intrínseco del programa.'
        : score >= 75 ? 'Buena candidata: conviértela a exclusiva 1·5·10.'
            : score >= 55 ? 'Candidata media: conviene mejorar precio/aviso antes de invertir.'
                : 'Candidata baja: hoy no conviene convertirla; primero precio y aviso.';

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
    if (!okComision) lev.push(`Negociar la comisión a 5% + IVA${comm != null ? ` (hoy ${vComision})` : ''}.`);
    if (!okExclusiva) lev.push(`Firmar el contrato de exclusiva (hoy: ${vExclusiva}).`);
    if (faltaMat.length) lev.push(`Completar material para activar: falta ${faltaMat.join(', ').toLowerCase()}.`);
    if (!lev.length) lev.push('Lista para convertir: precio, aviso, comisión, contrato y material en orden.');

    const [mercado, funnel] = await detalleP;

    return {
        id: String(P._id), code, title: (dig(P, 'listing', 'title') as string) ?? code, typ, op, col, city, street,
        val, acm, m2, ppm2, intr, okIntr, contrato, okContrato, faltaContrato, esDesarrollo, mat, okMat, faltaMat,
        sPrecio, sCalidad, sComision, sDemanda, score, banda, bandaTxt,
        sAcm, sSold, sOferta, askingMed, soldMed, vsAcm, vsOferta, vsCierre,
        q, comm, tipoOk, opOk, zonaOk, descOk, words, dem, ofe, velocidadMed, meses, nuevoPrecio,
        base, baseLvl, scope, lev, mercado, funnel
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
    // Gráfica de la ficha individual: tu $/m² vs. oferta vs. cierres (los mismos números que alimentan el puntaje).
    const ppmRef = ([['Tu propiedad', r.ppm2, BLK], ['Oferta mediana', r.askingMed, GRY], ['Cierres mediana', r.soldMed, SEA]] as [string, number | null, string][])
        .filter((x): x is [string, number, string] => (x[1] ?? 0) > 0);
    const maxPpm = Math.max(1, ...ppmRef.map((x) => x[1]));
    const posTxt = (d: number) => (d > 2 ? `<b>${d}% arriba</b>` : d < -2 ? `<b>${Math.abs(d)}% abajo</b>` : '<b>en línea</b>');
    const ppmChart = ppmRef.length > 1 ? `<div class="ppmbars">${ppmRef.map(([l, v, c]) => `<div class="ppmrow"><span class="ppml">${l}</span><span class="ppmtrack"><span class="ppmbar" style="width:${Math.max((100 * v) / maxPpm, 2)}%;background:${c}"></span></span><span class="ppmv">${money(v)}/m²</span></div>`).join('')}</div>
      <div style="margin-top:8px;font-size:11px">Tu $/m² está ${r.vsOferta != null ? `${posTxt(r.vsOferta)} de lo que se pide` : 'sin referencia de oferta'}${r.vsCierre != null ? ` y ${posTxt(r.vsCierre)} de lo que se cierra` : ''} en ${esc(r.scope || r.col || 'la zona')}.${r.acm ? ` Estimado ACM: ${money(r.acm)}${r.vsAcm != null ? ` (tu precio ${r.vsAcm >= 0 ? '+' : ''}${r.vsAcm}%)` : ''}.` : ''}</div>`
        : `<div style="font-size:11px;color:${GRY}">Sin oferta ni cierres suficientes en la zona para comparar el $/m².</div>`;

    // Herramientas para negociar el precio con el propietario: sólo lo que dicen los datos.
    const neg: string[] = [];
    const m = r.mercado;
    if (r.soldMed && r.m2 && r.vsCierre != null && r.vsCierre > 2) neg.push(`Al $/m² que de verdad se cierra en ${esc(r.scope)} (${money(r.soldMed)}), esta propiedad valdría <b>${money(r.soldMed * r.m2)}</b>${r.val ? `, ${Math.round((1 - (r.soldMed * r.m2) / r.val) * 100)}% menos de lo que pide` : ''}.`);
    if (r.askingMed && r.m2 && r.vsOferta != null && r.vsOferta > 2) neg.push(`Hasta la competencia pide menos: a la mediana de oferta (${money(r.askingMed)}/m²) serían <b>${money(r.askingMed * r.m2)}</b>.`);
    if (m && m.compN) neg.push(`Compite con <b>${m.compN}</b> ${m.compN === 1 ? 'propiedad' : 'propiedades'} del mismo tipo publicad${m.compN === 1 ? 'a' : 'as'} en Pulppo en ${esc(r.col)}${m.compMasBaratas ? `; <b>${m.compMasBaratas}</b> piden menos por m²` : ''}.`);
    if (m && m.alcN) neg.push(`Por el mismo precio el comprador tiene <b>${m.alcN}</b> ${m.alcN === 1 ? 'opción' : 'opciones'} cerca${m.alcMasGrandes ? `, y <b>${m.alcMasGrandes}</b> son más grandes` : ''}.`);
    if (r.velocidadMed != null && r.meses != null && r.meses * 30.44 > r.velocidadMed * 1.5) neg.push(`Lleva ${r.meses} meses publicada y en la zona se vende en ~${Math.round(r.velocidadMed)} días.`);
    if (r.funnel && r.funnel.visitas >= 3 && r.funnel.ofertas === 0) neg.push(`Tuvo ${r.funnel.visitas} visitas y ninguna oferta: los compradores la vieron y no la compraron a ese precio.`);
    if (r.funnel && r.funnel.leads === 0 && (r.meses ?? 0) >= 2) neg.push(`${r.meses} meses sin un solo lead: a este precio el mercado no la está buscando.`);

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
.elg-root .sub2{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BLK};margin:18px 0 6px}
.elg-root .ppmbars{display:flex;flex-direction:column;gap:6px;margin:4px 0}.elg-root .ppmrow{display:flex;align-items:center;font-size:11px}.elg-root .ppml{width:130px}.elg-root .ppmtrack{flex:1;background:${LGT};height:16px;margin:0 8px}.elg-root .ppmbar{display:block;height:16px}.elg-root .ppmv{width:104px;text-align:right;font-weight:700;white-space:nowrap}
.elg-root .fx-t{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}.elg-root .fx-t th,.elg-root .fx-t td{text-align:left;padding:5px 6px;border-bottom:1px solid ${LGT};vertical-align:top}.elg-root .fx-t th{font-weight:700;color:${GRY};text-transform:uppercase;font-size:9px;letter-spacing:.06em}.elg-root .fx-t td.nw{white-space:nowrap}
.elg-root .fx-g2{display:grid;grid-template-columns:1fr 1fr;gap:26px}.elg-root .fx-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
.elg-root .fx-st{display:flex;align-items:center;margin:6px 0}.elg-root .fx-sl{width:60px;font-weight:700}.elg-root .fx-tr{position:relative;flex:1;background:${LGT};height:18px}.elg-root .fx-bar{position:absolute;left:0;top:0;height:18px;background:${SEA}}.elg-root .fx-sn{width:48px;text-align:right;font-weight:700;margin-left:8px}.elg-root .fx-conv{position:absolute;right:6px;top:0;height:18px;display:flex;align-items:center;font-size:10px}
.elg-root .foot{margin-top:22px;border-top:1px solid ${LGT};padding-top:8px;font-size:9px;color:${GRY}}
@media print{.elg-root .box,.elg-root .fx-t tr,.elg-root .ppmbars{break-inside:avoid}.elg-root{margin:0;padding:24px 30px}.fx-noprint{display:none!important}@page{size:Letter;margin:0}}
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
  ${r.okIntr && !r.okContrato ? `<div class="banner" style="background:${YEL};color:${BLK}">Para activarla falta: ${esc(r.faltaContrato.map((k) => k === 'Comisión 5% + IVA' ? 'subir la comisión a 5% + IVA' : 'firmar el contrato de exclusiva').join(' y '))}.</div>` : ''}
  ${r.esDesarrollo ? `<div class="banner" style="background:${YEL};color:${BLK}">⚠️ Es un desarrollo: posible rechazo. Revisar caso a caso con el equipo del programa antes de activar.</div>` : ''}

  <div class="sec"><div class="eyebrow">¿Aplica al programa?</div><div class="accent"></div>
    <div class="grid2">
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Requisitos intrínsecos</div>${r.intr.map((x) => gate(x.k, x.ok)).join('')}
        <div class="eyebrow" style="color:${BLK};margin:12px 0 4px">Contrato (para activar)</div>${r.contrato.map((x) => gate(x.k, x.ok, x.v)).join('')}
      </div>
      <div><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Material (para activar)</div>${r.mat.map((x) => gate(x.k, x.ok, x.v)).join('')}
        <div style="margin-top:8px;font-size:11px;color:${r.okMat ? SEA : '#A5700a'}">${r.okMat ? `✓ Material completo${r.okContrato ? ': lista para activar' : ''}.` : `Requiere material antes de activarla: falta ${esc(r.faltaMat.join(', ').toLowerCase())}.`}</div>
      </div>
    </div>
  </div>

  <div class="sec"><div class="eyebrow">Puntaje de aceptación</div><div class="accent"></div>
    <p style="margin:0 0 10px;font-size:12px">${r.bandaTxt}</p>
    ${bar('Precio competitivo', r.sPrecio, `ACM ${r.sAcm != null ? Math.round(r.sAcm * 100) + '%' : 'n/d'} · cierres ${r.sSold != null ? Math.round(r.sSold * 100) + '%' : 'n/d'} · oferta ${r.sOferta != null ? Math.round(r.sOferta * 100) + '%' : 'n/d'}`)}
    ${bar('Calidad del aviso', r.sCalidad, `i24 ${r.q != null ? r.q.toFixed(0) + '/100' : 'n/d'} · título ${r.tipoOk && r.opOk && r.zonaOk ? 'ok' : 'incompleto'}`)}
    ${bar('Comisión', r.sComision, r.contrato[0].v)}
    ${bar('Demanda de zona', r.sDemanda, `${r.dem.toLocaleString('es-MX')} búsquedas · ${r.ofe.toLocaleString('es-MX')} en venta (6m)`)}
    <div style="font-size:9px;color:${GRY};margin-top:6px">Pesos: precio 40% · calidad 25% · comisión 20% · demanda 15%. Ajustables.</div>
  </div>

  <div class="sec"><div class="eyebrow">Contexto de mercado y demanda</div><div class="accent"></div>
    <div class="kpi">
      ${r.velocidadMed != null ? `<div><div class="n">${Math.round(r.velocidadMed)} días</div><div class="l">velocidad de venta zona</div></div>` : ''}
      ${r.meses != null ? `<div><div class="n">${r.meses} mes${r.meses === 1 ? '' : 'es'}</div><div class="l">antigüedad publicada</div></div>` : ''}
      ${r.nuevoPrecio ? `<div><div class="n">${r.nuevoPrecio.pct}%</div><div class="l">rebaja de precio reciente</div></div>` : ''}
      ${m ? `<div><div class="n">${m.compN.toLocaleString('es-MX')}</div><div class="l">compiten en la colonia</div></div>
      <div><div class="n">${m.alcN.toLocaleString('es-MX')}</div><div class="l">opciones por el mismo precio</div></div>` : ''}
      <div><div class="n">${r.base.toLocaleString('es-MX')}</div><div class="l">compradores potenciales${r.baseLvl ? ` (${r.baseLvl})` : ''}</div></div>
    </div>

    <div class="sub2">Precio $/m²: tú vs. oferta vs. cierres</div>
    ${ppmChart}

    ${neg.length ? `<div class="box" style="border-left:3px solid ${YEL};margin-top:16px"><div class="eyebrow" style="color:${BLK}">Herramientas para negociar el precio</div><ul>${neg.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}

    ${m ? `<div class="sub2">¿Qué te alcanza por el mismo precio?</div>
    <div style="font-size:10px;color:${GRY}">Comparables vivos en tu mismo rango de precio (±10%) y hasta 1.5 km, de más a menos parecidos.${m.alcInsights.length ? ' ' + m.alcInsights.slice(0, 2).join(' ') : ''}</div>
    ${m.alcanzaHtml}

    <div class="sub2">Con qué compite en ${esc(r.col || 'la zona')} · ${m.compN} ${m.compN === 1 ? 'propiedad' : 'propiedades'}</div>
    ${m.compiteHtml}` : ''}
  </div>

  ${r.funnel ? `<div class="sec"><div class="eyebrow">Desempeño en Pulppo · ${r.meses} mes${r.meses === 1 ? '' : 'es'} publicada</div><div class="accent"></div>${r.funnel.html}</div>` : ''}

  <div class="sec"><div class="eyebrow">Qué mejorar para acelerar la venta</div><div class="accent"></div>
    <div class="box"><ul>${r.lev.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  </div>

  <div class="foot">Pulppo · 1·5·10 — Evaluación de elegibilidad generada ${new Date().toISOString().slice(0, 10)}. Datos en vivo. Requiere venta y residencial; si es desarrollo hay posible rechazo (revisar caso a caso); para activar: comisión 5% + IVA, contrato de exclusiva firmado y material (foto+video+tour).</div>
</div>`;
}

export async function evaluarElegibilidad(id: string): Promise<{ code: string; html: string } | null> {
    const r = await computeEval(id);
    if (!r) return null;
    return { code: r.code, html: renderScorecard(r) };
}
