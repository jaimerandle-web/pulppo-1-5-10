// Herramienta Master Brokers (primer borrador): datos a nivel INMOBILIARIA (una company de Mongo).
// Overview (salud + funnel comercial) + listado de propiedades, cada una con link a su ficha (/ficha/[id]).
// Datos en vivo, read-only. Alcance de acceso: por ahora detrás del allowlist general del app.
import { ObjectId, type Document } from 'mongodb';
import { getDb, classifySource } from './data';

const ADVANCED = new Set(['offer', 'offer_blocked', 'contract', 'paying', 'closed']);
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let cur: unknown = d;
    for (const k of ks) { if (cur == null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
    return cur;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const estadoPrecio = (sp: number | null): string =>
    sp == null ? 'Sin ACM' : sp <= 1.05 ? 'Óptimo' : sp <= 1.2 ? 'No competitivo' : 'Fuera de mercado';

export interface MBProp {
    id: string; code: string; type: string; op: string; colonia: string; asesor: string;
    precio: number | null; estado: string; sobreprecio: number | null; dias: number | null;
    vistas: number; leads: number; leadsI24: number; visitas: number; ofertas: number;
}
export interface MBData {
    companyId: string; name: string; nProps: number; nVenta: number; nRenta: number; captaciones90: number;
    vistas: number; leads: number; visitas: number; ofertas: number; sinLeads: number; props: MBProp[];
}

// Cuenta agrupada por propiedad → mapa id(hex)→n, para $in sobre un solo campo.
const countBy = async (coll: string, field: string, match: Document): Promise<Map<string, number>> => {
    const db = await getDb();
    const rows = await db.collection(coll).aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return new Map(rows.map((r) => [String(r._id), r.n as number]));
};

export async function fetchInmobiliaria(companyId: string): Promise<MBData | null> {
    let cid: ObjectId;
    try { cid = new ObjectId(companyId); } catch { return null; }
    const db = await getDb();
    const props = await db.collection('properties').find(
        { 'company._id': cid, 'status.last': 'published' },
        { projection: { internalId: 1, type: 1, listing: 1, acm: 1, 'address.neighborhood.name': 1, agent: 1, publishedAt: 1, company: 1 } }
    ).toArray();
    if (!props.length) return null;
    const name = (dig(props[0], 'company', 'name') as string) ?? 'Inmobiliaria';
    const ids = props.map((p) => p._id as ObjectId);

    // Leads por propiedad (total + Inmuebles24) — se traen sources para clasificar en JS.
    const leadRows = await db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: ids } } },
        { $group: { _id: '$property._id', total: { $sum: 1 }, srcs: { $push: '$source' } } }
    ]).toArray();
    const leadsMap = new Map<string, { total: number; i24: number }>();
    for (const r of leadRows) {
        const i24 = (r.srcs as string[]).filter((s) => classifySource(s) === 'Inmuebles24').length;
        leadsMap.set(String(r._id), { total: r.total as number, i24 });
    }

    // Visitas = visitantes ÚNICOS confirmados por propiedad (mismo criterio que la ficha).
    const visRows = await db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed' } },
        { $unwind: '$steps' },
        { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
        { $group: { _id: '$_id.p', n: { $sum: 1 } } }
    ]).toArray();
    const visMap = new Map(visRows.map((r) => [String(r._id), r.n as number]));

    const viewMap = await countBy('metrics', 'property', { property: { $in: ids }, type: 'view' });
    const ofMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: [...ADVANCED] } });

    const now = Date.now();
    let nVenta = 0, nRenta = 0, captaciones90 = 0, tVistas = 0, tLeads = 0, tVisitas = 0, tOfertas = 0, sinLeads = 0;
    const rows: MBProp[] = props.map((p) => {
        const hex = String(p._id);
        const op = dig(p, 'listing', 'operation') as string;
        const val = num(dig(p, 'listing', 'value'));
        const acm = num(dig(p, 'acm', 'price', 'value'));
        const sp = val && acm ? val / acm : null;
        const pub = dig(p, 'publishedAt');
        const dias = pub instanceof Date ? Math.max(0, Math.round((now - pub.getTime()) / 864e5)) : null;
        const ld = leadsMap.get(hex) || { total: 0, i24: 0 };
        const vis = visMap.get(hex) || 0, vistas = viewMap.get(hex) || 0, ofertas = ofMap.get(hex) || 0;
        const ag = dig(p, 'agent') as Document | undefined;
        const asesor = [dig(ag, 'firstName'), dig(ag, 'lastName')].filter(Boolean).join(' ').trim() || '—';
        if (op === 'sale') nVenta++; else if (op === 'rent') nRenta++;
        if (dias != null && dias <= 90) captaciones90++;
        tVistas += vistas; tLeads += ld.total; tVisitas += vis; tOfertas += ofertas;
        if (ld.total === 0) sinLeads++;
        return {
            id: hex, code: (p.internalId as string) ?? hex, type: (p.type as string) ?? '—',
            op: op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : '—',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? '—', asesor,
            precio: val, estado: estadoPrecio(sp), sobreprecio: sp ? (sp - 1) * 100 : null, dias,
            vistas, leads: ld.total, leadsI24: ld.i24, visitas: vis, ofertas
        };
    });
    rows.sort((a, b) => b.leads - a.leads || b.vistas - a.vistas);
    return { companyId: String(cid), name, nProps: props.length, nVenta, nRenta, captaciones90, vistas: tVistas, leads: tLeads, visitas: tVisitas, ofertas: tOfertas, sinLeads, props: rows };
}
