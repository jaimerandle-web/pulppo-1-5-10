// Herramienta Master Brokers (borrador): datos a nivel INMOBILIARIA (una company de Mongo).
// Overview (atención + KPIs + red flags + prioridades) + listado con el cruce de mercado (demanda,
// precio vs. oferta MLS y vs. cierres Pulppo, competencia, calidad) + funnel comercial. Datos en vivo.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { getKam } from './kam';

const ADVANCED = new Set(['offer', 'offer_blocked', 'contract', 'paying', 'closed']);
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let cur: unknown = d;
    for (const k of ks) { if (cur == null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
    return cur;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const median = (xs: number[]): number | null => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pushMap = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
const estadoPrecio = (sp: number | null): string => (sp == null ? 'Haz ACM' : sp <= 1.05 ? 'Óptimo' : sp <= 1.2 ? 'No competitivo' : 'Fuera de mercado');
const CAL: Record<number, string> = { 3: 'Alta', 2: 'Media', 1: 'Baja' };
// Tier de destacado en Inmuebles24 (portals.inmuebles24.type).
const TIER: Record<string, string> = { HOME_COMBO: 'Super', HOME_COMBO_ZONA_DEMAND: 'Super', DESTACADO_COMBO: 'Destacado', DESTACADO_COMBO_ZONA_DEMAND: 'Destacado', SIMPLE_COMBO: 'Simple', OFFLINE: 'Offline' };
const YTD0 = new Date('2026-01-01T00:00:00Z');
const D24 = new Date(Date.now() - 730 * 864e5);
const D30 = new Date(Date.now() - 30 * 864e5);
const D60 = new Date(Date.now() - 60 * 864e5);
// Rangos de velocidad de 1ª respuesta (minutos): flash ≤5 · rápida ≤1h · media ≤24h · lento >24h.
export type RespKey = 'flash' | 'rapida' | 'media' | 'lento' | 'sin';
const respBucket = (min: number | null): RespKey => (min == null ? 'sin' : min <= 5 ? 'flash' : min <= 60 ? 'rapida' : min <= 1440 ? 'media' : 'lento');

export interface MBProp {
    id: string; code: string; type: string; op: string; colonia: string; asesor: string;
    precio: number | null; estado: string; demanda: number; vsOferta: number | null; vsCierres: number | null;
    compite: number | null; calidad: string; dias: number | null; mesesPub: number | null;
    vistas: number; leads: number; visitas: number; ofertas: number; cierres: number;
    respMedMin: number | null; oppScore: number; diag: string[]; tier: string;
}
export interface MBData {
    companyId: string; name: string; nProps: number; nVenta: number; nRenta: number; captaciones90: number;
    vistas: number; leads: number; visitas: number; ofertas: number; sinLeads: number;
    leads30: number; leads30prev: number; resp: Record<RespKey, number>; respMedMin: number | null;
    calAltaPct: number; benchAltaPct: number; props: MBProp[];
}

const countBy = async (coll: string, field: string, match: Document): Promise<Map<string, number>> => {
    const db = await getDb();
    const rows = await db.collection(coll).aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return new Map(rows.map((r) => [String(r._id), r.n as number]));
};
const zref = (nb: string | null, ci: string | null, byNb: Map<string, number[]>, byCi: Map<string, number[]>): number | null => {
    if (nb && (byNb.get(nb)?.length ?? 0) >= 3) return median(byNb.get(nb)!);
    if (ci && (byCi.get(ci)?.length ?? 0) >= 3) return median(byCi.get(ci)!);
    return null;
};

// Benchmark de comunidad: % de fichas en calidad Alta de las MEJORES inmobiliarias (top 20% con ≥10 props).
// Cacheado 10 min por instancia (cambia lento y es un escaneo global).
let _bench: { pct: number; at: number } | null = null;
async function communityAltaPct(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
    if (_bench && Date.now() - _bench.at < 600000) return _bench.pct;
    const rows = await db.collection('properties').aggregate([
        { $match: { 'status.last': 'published' } },
        { $group: { _id: '$company._id', total: { $sum: 1 }, alta: { $sum: { $cond: [{ $eq: ['$qualityScore', 3] }, 1, 0] } } } },
        { $match: { total: { $gte: 10 } } }
    ], { allowDiskUse: true }).toArray();
    const pcts = rows.map((r) => (r.alta as number) / (r.total as number)).sort((a, b) => b - a);
    const top = pcts.slice(0, Math.max(1, Math.ceil(pcts.length * 0.2)));
    const pct = Math.round((median(top) ?? 0) * 100);
    _bench = { pct, at: Date.now() };
    return pct;
}

export async function fetchInmobiliaria(companyId: string): Promise<MBData | null> {
    let cid: ObjectId;
    try { cid = new ObjectId(companyId); } catch { return null; }
    const db = await getDb();
    const props = await db.collection('properties').find(
        { 'company._id': cid, 'status.last': 'published' },
        { projection: { internalId: 1, type: 1, listing: 1, acm: 1, qualityScore: 1, 'attributes.totalSurface': 1, address: 1, agent: 1, publishedAt: 1, company: 1, 'portals.inmuebles24.type': 1 } }
    ).toArray();
    if (!props.length) return null;
    const name = (dig(props[0], 'company', 'name') as string) ?? 'Inmobiliaria';
    const ids = props.map((p) => p._id as ObjectId);
    const nbids = [...new Set(props.map((p) => dig(p, 'address', 'neighborhood', 'id')).filter(Boolean))] as string[];

    // --- leads: conteo, 30d vs previos, y tiempo de 1ª respuesta (answeredAt - createdAt) ---
    const leadDocs = await db.collection('leads').find({ 'property._id': { $in: ids } }, { projection: { 'property._id': 1, createdAt: 1, answeredAt: 1 } }).toArray();
    const leadsMap = new Map<string, number>();
    const respByProp = new Map<string, number[]>();
    const resp: Record<RespKey, number> = { flash: 0, rapida: 0, media: 0, lento: 0, sin: 0 };
    const allResp: number[] = [];
    let leads30 = 0, leads30prev = 0;
    for (const l of leadDocs) {
        const pid = String(dig(l, 'property', '_id'));
        leadsMap.set(pid, (leadsMap.get(pid) ?? 0) + 1);
        const ca = dig(l, 'createdAt'), aa = dig(l, 'answeredAt');
        const mins = ca instanceof Date && aa instanceof Date ? Math.max(0, (aa.getTime() - ca.getTime()) / 60000) : null;
        resp[respBucket(mins)]++;
        if (mins != null) { pushMap(respByProp, pid, mins); allResp.push(mins); }
        if (ca instanceof Date) { if (ca >= D30) leads30++; else if (ca >= D60) leads30prev++; }
    }

    // --- desempeño por propiedad ---
    const visRows = await db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed' } },
        { $unwind: '$steps' }, { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
        { $group: { _id: '$_id.p', n: { $sum: 1 } } }
    ]).toArray();
    const visMap = new Map(visRows.map((r) => [String(r._id), r.n as number]));
    const viewMap = await countBy('metrics', 'property', { property: { $in: ids }, type: 'view' });
    const ofMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: [...ADVANCED] } });
    const cloMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': 'closed' });

    // --- mercado por zona ---
    // demanda partida por operación: a cada propiedad se le asigna la demanda de SU operación (venta/renta).
    const demandSale = new Map<string, number>(), demandRent = new Map<string, number>();
    if (nbids.length) {
        const dr = await db.collection('searches').aggregate([
            { $match: { 'filters.addresses.id': { $in: nbids }, createdAt: { $gte: YTD0 } } },
            { $unwind: '$filters.addresses' }, { $match: { 'filters.addresses.id': { $in: nbids } } },
            { $group: { _id: '$filters.addresses.id',
                sale: { $sum: { $cond: [{ $eq: ['$filters.operation', 'sale'] }, 1, 0] } },
                rent: { $sum: { $cond: [{ $eq: ['$filters.operation', 'rent'] }, 1, 0] } } } }
        ], { allowDiskUse: true }).toArray();
        for (const r of dr) { demandSale.set(String(r._id), r.sale as number); demandRent.set(String(r._id), r.rent as number); }
    }
    const offNb = new Map<string, number[]>(), offCi = new Map<string, number[]>(), supplyNb = new Map<string, number>();
    if (nbids.length) {
        const ls = await db.collection('properties').find(
            { 'address.neighborhood.id': { $in: nbids }, 'status.last': 'published', 'listing.operation': 'sale', 'attributes.totalSurface': { $gt: 0 } },
            { projection: { 'address.neighborhood.id': 1, 'address.city.id': 1, 'listing.value': 1, 'attributes.totalSurface': 1 } }
        ).toArray();
        for (const p of ls) {
            const v = num(dig(p, 'listing', 'value')), s = num(dig(p, 'attributes', 'totalSurface'));
            const nb = dig(p, 'address', 'neighborhood', 'id') as string, ci = dig(p, 'address', 'city', 'id') as string;
            if (nb) supplyNb.set(nb, (supplyNb.get(nb) ?? 0) + 1);
            if (v && s && s > 0) { const ppm = v / s; if (nb) pushMap(offNb, nb, ppm); if (ci) pushMap(offCi, ci, ppm); }
        }
    }
    const cloNb = new Map<string, number[]>(), cloCi = new Map<string, number[]>();
    const ops = await db.collection('operations').find(
        { 'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: D24 }, 'property.listing.operation': 'sale' },
        { projection: { 'property._id': 1, 'closeValue.value': 1 } }
    ).toArray();
    const opVal = new Map<string, number>();
    for (const o of ops) { const pid = dig(o, 'property', '_id'); const v = num(dig(o, 'closeValue', 'value')); if (pid && v) opVal.set(String(pid), v); }
    if (opVal.size) {
        const opProps = await db.collection('properties').find(
            { _id: { $in: [...opVal.keys()].map((h) => new ObjectId(h)) } },
            { projection: { 'address.neighborhood.id': 1, 'address.city.id': 1, 'attributes.totalSurface': 1 } }
        ).toArray();
        for (const p of opProps) {
            const s = num(dig(p, 'attributes', 'totalSurface')); const v = opVal.get(String(p._id));
            if (s && s > 0 && v) { const ppm = v / s; const nb = dig(p, 'address', 'neighborhood', 'id') as string, ci = dig(p, 'address', 'city', 'id') as string; if (nb) pushMap(cloNb, nb, ppm); if (ci) pushMap(cloCi, ci, ppm); }
        }
    }
    const benchAltaPct = await communityAltaPct(db);

    const now = Date.now();
    let nVenta = 0, nRenta = 0, captaciones90 = 0, tVistas = 0, tLeads = 0, tVisitas = 0, tOfertas = 0, sinLeads = 0, nAlta = 0;
    const rows: MBProp[] = props.map((p) => {
        const hex = String(p._id);
        const op = dig(p, 'listing', 'operation') as string;
        const val = num(dig(p, 'listing', 'value'));
        const acm = num(dig(p, 'acm', 'price', 'value'));
        const surf = num(dig(p, 'attributes', 'totalSurface'));
        const nb = (dig(p, 'address', 'neighborhood', 'id') as string) ?? null, ci = (dig(p, 'address', 'city', 'id') as string) ?? null;
        const sp = val && acm ? val / acm : null;
        const ppm = val && surf && surf > 0 && op === 'sale' ? val / surf : null;
        const offRef = op === 'sale' ? zref(nb, ci, offNb, offCi) : null;
        const cloRef = op === 'sale' ? zref(nb, ci, cloNb, cloCi) : null;
        const vsOferta = ppm && offRef ? (ppm / offRef - 1) * 100 : null;
        const pub = dig(p, 'publishedAt');
        const dias = pub instanceof Date ? Math.max(0, Math.round((now - pub.getTime()) / 864e5)) : null;
        const leads = leadsMap.get(hex) ?? 0, vis = visMap.get(hex) ?? 0, vistas = viewMap.get(hex) ?? 0, ofertas = ofMap.get(hex) ?? 0, cierres = cloMap.get(hex) ?? 0;
        const demanda = nb ? ((op === 'sale' ? demandSale.get(nb) : op === 'rent' ? demandRent.get(nb) : 0) ?? 0) : 0;
        const calidad = CAL[num(dig(p, 'qualityScore')) ?? 2] ?? 'Media';
        const ag = dig(p, 'agent') as Document | undefined;
        const asesor = [dig(ag, 'firstName'), dig(ag, 'lastName')].filter(Boolean).join(' ').trim() || '—';
        const diag: string[] = [];
        if (op === 'sale' && (sp && sp > 1.15 || (vsOferta != null && vsOferta > 15))) diag.push('Bajar precio');
        if (calidad !== 'Alta') diag.push('Mejorar ficha');
        if (op === 'sale') nVenta++; else if (op === 'rent') nRenta++;
        if (dias != null && dias <= 90) captaciones90++;
        if (calidad === 'Alta') nAlta++;
        tVistas += vistas; tLeads += leads; tVisitas += vis; tOfertas += ofertas;
        if (leads === 0) sinLeads++;
        return {
            id: hex, code: (p.internalId as string) ?? hex, type: (p.type as string) ?? '—',
            op: op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : '—',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? '—', asesor,
            precio: val, estado: estadoPrecio(sp), demanda, vsOferta,
            vsCierres: ppm && cloRef ? (ppm / cloRef - 1) * 100 : null,
            compite: op === 'sale' && nb ? (supplyNb.get(nb) ?? null) : null,
            calidad, dias, mesesPub: dias != null ? dias / 30 : null,
            vistas, leads, visitas: vis, ofertas, cierres,
            respMedMin: median(respByProp.get(hex) ?? []),
            oppScore: op === 'sale' ? Math.round(demanda / (1 + leads)) : 0, diag,
            tier: TIER[dig(p, 'portals', 'inmuebles24', 'type') as string] ?? 'Simple'
        };
    });
    rows.sort((a, b) => b.leads - a.leads || b.vistas - a.vistas);
    return {
        companyId: String(cid), name, nProps: props.length, nVenta, nRenta, captaciones90,
        vistas: tVistas, leads: tLeads, visitas: tVisitas, ofertas: tOfertas, sinLeads,
        leads30, leads30prev, resp, respMedMin: median(allResp),
        calAltaPct: props.length ? Math.round((100 * nAlta) / props.length) : 0, benchAltaPct, props: rows
    };
}

// --- Índice para KAMs: recap de todas las inmobiliarias, con su KAM y liga a /mb/[companyId] ---
export interface MBIndexRow { companyId: string; name: string; kam: string; nProps: number; nVenta: number; nRenta: number; calAltaPct: number; leads30: number }
export async function fetchIndex(): Promise<MBIndexRow[]> {
    const db = await getDb();
    const pc = await db.collection('properties').aggregate([
        { $match: { 'status.last': 'published', 'company._id': { $exists: true } } },
        { $group: { _id: '$company._id', name: { $first: '$company.name' }, email: { $first: '$company.email' },
            total: { $sum: 1 },
            venta: { $sum: { $cond: [{ $eq: ['$listing.operation', 'sale'] }, 1, 0] } },
            renta: { $sum: { $cond: [{ $eq: ['$listing.operation', 'rent'] }, 1, 0] } },
            alta: { $sum: { $cond: [{ $eq: ['$qualityScore', 3] }, 1, 0] } } } }
    ], { allowDiskUse: true }).toArray();
    const cids = pc.map((r) => r._id as ObjectId);
    const masters = await db.collection('agents').aggregate([
        { $match: { type: 'master', 'company._id': { $in: cids } } },
        { $group: { _id: '$company._id', n: { $sum: 1 } } }
    ]).toArray();
    const masterSet = new Set(masters.map((m) => String(m._id)));
    const l30 = await db.collection('leads').aggregate([
        { $match: { 'company._id': { $in: cids }, createdAt: { $gte: D30 } } },
        { $group: { _id: '$company._id', n: { $sum: 1 } } }
    ], { allowDiskUse: true }).toArray();
    const l30Map = new Map(l30.map((r) => [String(r._id), r.n as number]));
    const excl = (s: string) => /tuhabi|habi|prueba|test|demo/i.test(s);
    const rows: MBIndexRow[] = [];
    for (const r of pc) {
        const id = String(r._id), name = (r.name as string) ?? '';
        if (!masterSet.has(id) || excl(`${name} ${r.email ?? ''}`)) continue;
        const total = r.total as number;
        rows.push({ companyId: id, name, kam: getKam(name), nProps: total, nVenta: r.venta as number, nRenta: r.renta as number,
            calAltaPct: total ? Math.round((100 * (r.alta as number)) / total) : 0, leads30: l30Map.get(id) ?? 0 });
    }
    rows.sort((a, b) => a.kam.localeCompare(b.kam) || b.nProps - a.nProps);
    return rows;
}
