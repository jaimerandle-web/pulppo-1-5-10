// Herramienta Master Brokers (borrador): datos a nivel INMOBILIARIA (una company de Mongo).
// Overview + listado con el cruce de mercado (demanda, precio vs. oferta MLS y vs. cierres Pulppo,
// competencia, salud de ficha) + funnel comercial. Cada propiedad linkea a su ficha. Datos en vivo.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';

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
const YTD0 = new Date('2026-01-01T00:00:00Z');
const D24 = new Date(Date.now() - 730 * 864e5);

export interface MBProp {
    id: string; code: string; type: string; op: string; colonia: string; asesor: string;
    precio: number | null; estado: string; demanda: number; vsOferta: number | null; vsCierres: number | null;
    compite: number | null; calidad: string; dias: number | null;
    vistas: number; leads: number; visitas: number; ofertas: number;
}
export interface MBData {
    companyId: string; name: string; nProps: number; nVenta: number; nRenta: number; captaciones90: number;
    vistas: number; leads: number; visitas: number; ofertas: number; sinLeads: number; props: MBProp[];
}

const countBy = async (coll: string, field: string, match: Document): Promise<Map<string, number>> => {
    const db = await getDb();
    const rows = await db.collection(coll).aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return new Map(rows.map((r) => [String(r._id), r.n as number]));
};
// Referencia de zona: mediana con ≥3 muestras en colonia, si no en ciudad, si no null.
const zref = (nb: string | null, ci: string | null, byNb: Map<string, number[]>, byCi: Map<string, number[]>): number | null => {
    if (nb && (byNb.get(nb)?.length ?? 0) >= 3) return median(byNb.get(nb)!);
    if (ci && (byCi.get(ci)?.length ?? 0) >= 3) return median(byCi.get(ci)!);
    return null;
};

export async function fetchInmobiliaria(companyId: string): Promise<MBData | null> {
    let cid: ObjectId;
    try { cid = new ObjectId(companyId); } catch { return null; }
    const db = await getDb();
    const props = await db.collection('properties').find(
        { 'company._id': cid, 'status.last': 'published' },
        { projection: { internalId: 1, type: 1, listing: 1, acm: 1, qualityScore: 1, 'attributes.totalSurface': 1, address: 1, agent: 1, publishedAt: 1, company: 1 } }
    ).toArray();
    if (!props.length) return null;
    const name = (dig(props[0], 'company', 'name') as string) ?? 'Inmobiliaria';
    const ids = props.map((p) => p._id as ObjectId);
    const nbids = [...new Set(props.map((p) => dig(p, 'address', 'neighborhood', 'id')).filter(Boolean))] as string[];
    const ciids = [...new Set(props.map((p) => dig(p, 'address', 'city', 'id')).filter(Boolean))] as string[];

    // --- desempeño por propiedad ---
    const leadsMap = await countBy('leads', 'property._id', { 'property._id': { $in: ids } });
    const visRows = await db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed' } },
        { $unwind: '$steps' }, { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
        { $group: { _id: '$_id.p', n: { $sum: 1 } } }
    ]).toArray();
    const visMap = new Map(visRows.map((r) => [String(r._id), r.n as number]));
    const viewMap = await countBy('metrics', 'property', { property: { $in: ids }, type: 'view' });
    const ofMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: [...ADVANCED] } });

    // --- mercado por zona ---
    const demandNb = new Map<string, number>();
    if (nbids.length) {
        const dr = await db.collection('searches').aggregate([
            { $match: { 'filters.addresses.id': { $in: nbids }, createdAt: { $gte: YTD0 } } },
            { $unwind: '$filters.addresses' }, { $match: { 'filters.addresses.id': { $in: nbids } } },
            { $group: { _id: '$filters.addresses.id', n: { $sum: 1 } } }
        ], { allowDiskUse: true }).toArray();
        for (const r of dr) demandNb.set(String(r._id), r.n as number);
    }
    // oferta $/m² (venta publicada, todas las cías) → mediana + conteo (competencia)
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
    // cierres $/m² (ops closed/paying venta, 24m) — se une a properties para colonia + superficie
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

    const now = Date.now();
    let nVenta = 0, nRenta = 0, captaciones90 = 0, tVistas = 0, tLeads = 0, tVisitas = 0, tOfertas = 0, sinLeads = 0;
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
        const pub = dig(p, 'publishedAt');
        const dias = pub instanceof Date ? Math.max(0, Math.round((now - pub.getTime()) / 864e5)) : null;
        const leads = leadsMap.get(hex) ?? 0, vis = visMap.get(hex) ?? 0, vistas = viewMap.get(hex) ?? 0, ofertas = ofMap.get(hex) ?? 0;
        const ag = dig(p, 'agent') as Document | undefined;
        const asesor = [dig(ag, 'firstName'), dig(ag, 'lastName')].filter(Boolean).join(' ').trim() || '—';
        if (op === 'sale') nVenta++; else if (op === 'rent') nRenta++;
        if (dias != null && dias <= 90) captaciones90++;
        tVistas += vistas; tLeads += leads; tVisitas += vis; tOfertas += ofertas;
        if (leads === 0) sinLeads++;
        return {
            id: hex, code: (p.internalId as string) ?? hex, type: (p.type as string) ?? '—',
            op: op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : '—',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? '—', asesor,
            precio: val, estado: estadoPrecio(sp),
            demanda: nb ? (demandNb.get(nb) ?? 0) : 0,
            vsOferta: ppm && offRef ? (ppm / offRef - 1) * 100 : null,
            vsCierres: ppm && cloRef ? (ppm / cloRef - 1) * 100 : null,
            compite: op === 'sale' && nb ? (supplyNb.get(nb) ?? null) : null,
            calidad: CAL[num(dig(p, 'qualityScore')) ?? 2] ?? 'Media', dias,
            vistas, leads, visitas: vis, ofertas
        };
    });
    rows.sort((a, b) => b.leads - a.leads || b.vistas - a.vistas);
    return { companyId: String(cid), name, nProps: props.length, nVenta, nRenta, captaciones90, vistas: tVistas, leads: tLeads, visitas: tVisitas, ofertas: tOfertas, sinLeads, props: rows };
}
