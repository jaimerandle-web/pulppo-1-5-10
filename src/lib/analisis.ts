// Motor del "Análisis general" — port de gen_reporte_plus.py (Track B ampliado).
// Fase 1: Inventario (P1) + Precio × calidad (P2). Lee Mongo en vivo (read-only).
// Las secciones YoY / Top 10 / destacados / funnel se irán agregando después.
import { ObjectId, type Db, type Document } from 'mongodb';
import { getDb } from './data';

// ---------- helpers (equivalentes a los del script Python) ----------
const gv = (o: Document | null | undefined, ...path: string[]): unknown => {
    let cur: unknown = o;
    for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    return cur;
};
const num = (v: unknown): number | null => (typeof v === 'number' && !isNaN(v) ? v : null);
const asDt = (v: unknown): Date | null => {
    if (v instanceof Date) return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    return null;
};
const median = (xs: (number | null | undefined)[]): number | null => {
    const s = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
};

type Band = [string, number, number];
const VB: Band[] = [['0–3M', 0, 3e6], ['3–6M', 3e6, 6e6], ['6–10M', 6e6, 10e6], ['+10M', 10e6, 9e15]];
const bandOf = (v: number | null, bands: Band[]): string => {
    const x = v || 0;
    for (const [lab, lo, hi] of bands) if (lo <= x && x < hi) return lab;
    return bands[bands.length - 1][0];
};
const priceCls = (sp: number | null): string =>
    sp == null ? 'Sin ref.' : sp <= 1.05 ? 'Competitivo' : sp <= 1.20 ? 'En línea' : 'Caro';
const tierName = (t: unknown): string | null => {
    if (!t) return null;
    const s = String(t).toUpperCase();
    if (s.startsWith('HOME')) return 'Súper destacado';
    if (s.startsWith('DESTACADO')) return 'Destacado';
    if (s.startsWith('SIMPLE')) return 'Simple';
    if (s.includes('OFFLINE')) return 'Offline';
    return null;
};
const CAL: Record<number, string> = { 3: 'Alta', 2: 'Media', 1: 'Baja' };
const QROWS = ['Alta', 'Media', 'Baja'];
const PCOLS = ['Competitivo', 'En línea', 'Caro', 'Sin ref.'];

// ---------- config de entrada ----------
export interface AnalisisConfig {
    inmo: string;                 // nombre (regex case-insensitive)
    operacion?: string;           // 'Ambas' | 'Venta' | 'Renta'
    ventDemanda?: string;         // 'Últimos 6 meses' | 'Últimos 12 meses' | 'YTD 2026'
}

export interface AnalisisData {
    company: string;
    corte: string;                // ISO de la fecha de corte
    N: number;
    opSplit: { sale: number; rent: number };
    llProp: number;               // leads YTD / N
    zones: { nb: string; n: number; precio: number | null; dem: number; leads: number; cal: string }[];
    invVsDemand: { band: string; invPct: number; demPct: number; inv: number; dem: number }[];
    matrix: { q: string; cells: { p: string; n: number; ll: number }[] }[];
    priceLead: { cls: string; props: number; leads: number; ll: number }[];
    joyas: number; joyasAlta: number; caras: number;
    nSale: number; nCaro: number; pctCaro: number;
    hip: string;
}

async function resolveCompany(db: Db, name: string): Promise<{ id: ObjectId; name: string }> {
    const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const cands = await db.collection('companies').find({ name: rx }, { projection: { name: 1 } }).toArray();
    if (!cands.length) throw new Error(`No encontré inmobiliaria ~ "${name}"`);
    // la de más inventario publicado
    let best = cands[0], bestN = -1;
    for (const c of cands) {
        const n = await db.collection('properties').countDocuments({ 'company._id': c._id, 'status.last': 'published' });
        if (n > bestN) { bestN = n; best = c; }
    }
    return { id: best._id as ObjectId, name: best.name as string };
}

export async function buildAnalisis(cfg: AnalisisConfig): Promise<AnalisisData> {
    const db = await getDb();
    const { id: CID, name: CNAME } = await resolveCompany(db, cfg.inmo);

    const NOW = new Date();
    const YTD0 = new Date(Date.UTC(NOW.getUTCFullYear(), 0, 1));
    const demandStart = (() => {
        const w = cfg.ventDemanda || 'Últimos 12 meses';
        if (w === 'YTD 2026') return YTD0;
        const d = new Date(NOW);
        d.setUTCMonth(d.getUTCMonth() - (w === 'Últimos 6 meses' ? 6 : 12));
        return d;
    })();

    // --- propiedades publicadas ---
    const pub = await db.collection('properties').find(
        { 'company._id': CID, 'status.last': 'published' },
        { projection: {
            listing: 1, type: 1, 'acm.price.value': 1, qualityScore: 1, pictures: 1,
            virtualTour: 1, 'address.neighborhood': 1, internalId: 1, publishedAt: 1,
            'portals.inmuebles24.type': 1,
        } }
    ).toArray();

    type Item = { pid: ObjectId; nb: string | null; nbid: string | null; op: string | null;
        val: number; sp: number | null; q3: number | null; tour: boolean; tier: string | null };
    const items: Item[] = pub.map((p) => {
        const nb = (gv(p, 'address', 'neighborhood') || {}) as Record<string, unknown>;
        const val = (num(gv(p, 'listing', 'value')) || 0);
        const acm = num(gv(p, 'acm', 'price', 'value'));
        return {
            pid: p._id as ObjectId,
            nb: (nb.name as string) || null, nbid: (nb.id as string) || null,
            op: (gv(p, 'listing', 'operation') as string) || null,
            val, sp: val && acm ? val / acm : null,
            q3: num(p.qualityScore), tour: !!p.virtualTour,
            tier: tierName(gv(p, 'portals', 'inmuebles24', 'type')),
        };
    });
    const N = items.length;
    const pid2nb = new Map(items.map((it) => [String(it.pid), it.nb]));
    const pubIds = items.map((it) => it.pid);
    const nbids = [...new Set(items.map((it) => it.nbid).filter(Boolean) as string[])];

    // --- demanda por zona y por ticket ---
    const demandByNb: Record<string, number> = {};
    if (nbids.length) {
        const agg = db.collection('searches').aggregate([
            { $match: { 'filters.addresses.id': { $in: nbids }, createdAt: { $gte: demandStart } } },
            { $unwind: '$filters.addresses' },
            { $match: { 'filters.addresses.id': { $in: nbids } } },
            { $group: { _id: '$filters.addresses.id', n: { $sum: 1 } } },
        ], { allowDiskUse: true });
        for await (const r of agg) demandByNb[r._id as string] = r.n as number;
    }
    const demandTicket: Record<string, number> = {};
    await Promise.all(VB.map(async ([lab, lo, hi]) => {
        demandTicket[lab] = nbids.length ? await db.collection('searches').countDocuments({
            'filters.addresses.id': { $in: nbids }, 'filters.operation': 'sale',
            createdAt: { $gte: demandStart }, 'filters.price.max': { $gte: lo, $lt: hi },
        }) : 0;
    }));

    // --- leads YTD por propiedad y por zona ---
    const leadsByPid: Record<string, number> = {};
    const leadsByNb: Record<string, number> = {};
    let ytdLeads = 0;
    const leadCur = db.collection('leads').find(
        { 'property._id': { $in: pubIds }, createdAt: { $gte: YTD0 } },
        { projection: { 'property._id': 1, createdAt: 1 } }
    );
    for await (const l of leadCur) {
        const pid = String(gv(l, 'property', '_id'));
        leadsByPid[pid] = (leadsByPid[pid] || 0) + 1;
        ytdLeads++;
        const nb = pid2nb.get(pid);
        if (nb) leadsByNb[nb] = (leadsByNb[nb] || 0) + 1;
    }

    // --- inventario hoy ---
    const opSplit = { sale: items.filter((it) => it.op === 'sale').length, rent: items.filter((it) => it.op === 'rent').length };
    const venta = items.filter((it) => it.op === 'sale');
    const pbV: Record<string, number> = {};
    for (const it of venta) { const b = bandOf(it.val, VB); pbV[b] = (pbV[b] || 0) + 1; }

    // --- zonas (top 7 por # de props) ---
    const byNb = new Map<string, Item[]>();
    for (const it of items) if (it.nb) { const a = byNb.get(it.nb) || []; a.push(it); byNb.set(it.nb, a); }
    const zones = [...byNb.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 7).map(([nb, its]) => {
        const nbid = its[0].nbid;
        const precio = median(its.filter((i) => i.op === 'sale').map((i) => i.val)) ?? median(its.map((i) => i.val));
        const cal = median(its.map((i) => i.q3));
        return { nb, n: its.length, precio, dem: (nbid && demandByNb[nbid]) || 0, leads: leadsByNb[nb] || 0, cal: cal != null ? (CAL[Math.round(cal)] || '—') : '—' };
    });

    // --- inventario vs demanda por ticket ---
    const svTot = venta.length || 1;
    const demTot = Object.values(demandTicket).reduce((a, b) => a + b, 0) || 1;
    const invVsDemand = VB.map(([lab]) => ({
        band: lab,
        inv: pbV[lab] || 0, dem: demandTicket[lab] || 0,
        invPct: 100 * (pbV[lab] || 0) / svTot, demPct: 100 * (demandTicket[lab] || 0) / demTot,
    }));

    // --- segmentación precio × calidad + leads por celda (SOLO VENTA) ---
    const seg: Record<string, number> = {}; const segLeads: Record<string, number> = {};
    const key = (q: string, p: string) => `${q}|${p}`;
    for (const it of venta) {
        const q = CAL[it.q3 as number] || 'Media'; const pcl = priceCls(it.sp);
        seg[key(q, pcl)] = (seg[key(q, pcl)] || 0) + 1;
        segLeads[key(q, pcl)] = (segLeads[key(q, pcl)] || 0) + (leadsByPid[String(it.pid)] || 0);
    }
    const matrix = QROWS.map((q) => ({
        q, cells: PCOLS.map((p) => {
            const n = seg[key(q, p)] || 0; const lp = segLeads[key(q, p)] || 0;
            return { p, n, ll: n ? lp / n : 0 };
        }),
    }));
    const priceLead = ['Competitivo', 'En línea', 'Caro'].map((pcl) => {
        const grp = venta.filter((it) => priceCls(it.sp) === pcl);
        const leads = grp.reduce((a, it) => a + (leadsByPid[String(it.pid)] || 0), 0);
        return { cls: pcl, props: grp.length, leads, ll: grp.length ? leads / grp.length : 0 };
    });
    const joyas = (seg[key('Alta', 'Competitivo')] || 0) + (seg[key('Media', 'Competitivo')] || 0);
    const joyasAlta = seg[key('Alta', 'Competitivo')] || 0;
    const caras = (seg[key('Alta', 'Caro')] || 0) + (seg[key('Media', 'Caro')] || 0) + (seg[key('Baja', 'Caro')] || 0);
    const nSale = venta.length;
    const nRef = venta.filter((it) => it.sp != null).length;
    const nCaro = venta.filter((it) => it.sp != null && (it.sp as number) > 1.20).length;
    const pctCaro = nCaro / (nRef || 1);
    const pl = Object.fromEntries(priceLead.map((d) => [d.cls, d.ll]));
    const hip = (pl['Competitivo'] >= pl['En línea'] && pl['En línea'] >= pl['Caro']) ? 'SÍ se cumple' : 'se cumple parcialmente';

    return {
        company: CNAME, corte: NOW.toISOString(), N, opSplit,
        llProp: ytdLeads / (N || 1),
        zones, invVsDemand, matrix, priceLead,
        joyas, joyasAlta, caras, nSale, nCaro, pctCaro, hip,
    };
}
