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
// Taxonomía del ACM (óptimo / no competitivo / fuera de mercado). Guardrail: ratios
// precio/ACM absurdos (>3× o <0.2×) = ACM roto → "Sin referencia", no distorsionan.
const priceCls = (sp: number | null): string =>
    sp == null || sp > 3 || sp < 0.2 ? 'Sin referencia'
        : sp <= 1.05 ? 'Óptimo' : sp <= 1.20 ? 'No competitivo' : 'Fuera de mercado';
const PL_ORDER = ['Óptimo', 'No competitivo', 'Fuera de mercado'];
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
const PCOLS = ['Óptimo', 'No competitivo', 'Fuera de mercado', 'Sin referencia'];

// ---------- config de entrada ----------
export interface AnalisisConfig {
    inmo: string;                 // nombre (regex case-insensitive)
    operacion?: string;           // 'Ambas' | 'Venta' | 'Renta'
    ventDemanda?: string;         // 'Últimos 6 meses' | 'Últimos 12 meses' | 'YTD 2026'
    ventLeads?: string;           // ventana de leads: 'Últimos 30 días' | '90 días' | '6 meses' | 'YTD 2026' | '12 meses'
    mlsGeneral?: boolean;         // oferta/zona contra el MLS i24 completo en vez de la red Pulppo
}

export interface AnalisisData {
    company: string;
    corte: string;                // ISO de la fecha de corte
    N: number;
    opSplit: { sale: number; rent: number };
    llProp: number;               // leads (ventana) / N
    leadsLabel: string;           // etiqueta de la ventana de leads
    ofertaLabel: string;          // "red Pulppo" | "MLS i24"
    leadsComp: { cliente: number; broker: number; incontactables: number; duplicados: number; total: number; totalOp: { sale: number; rent: number } };
    zones: { nb: string; n: number; oferta: number; vsZona: number | null; dem: number; leads: number }[];
    invVsDemand: { band: string; invPct: number; demPct: number; inv: number; dem: number }[];
    matrix: { q: string; cells: { p: string; n: number; ll: number }[] }[];
    priceLead: { cls: string; props: number; leads: number; ll: number }[];
    joyas: number; joyasAlta: number; caras: number;
    nSale: number; nCaro: number; pctCaro: number;
    insightInv: string;           // lectura auto de Inventario
    insightPrecio: string;        // lectura auto de Precio × calidad
    funnel: { title: string; steps: { label: string; value: number; rate: number | null }[] }[];
    funnelReading: string;
    recos: { enfoque: string; title: string; body: string; sev: number }[];
    yoy: { label: string; a: number; b: number; fmt: 'int' | 'dec' | 'pct' | 'pct2' | 'money'; goodUp: boolean }[];
    yoyMix: { year: number; sale: number; rent: number; com: number }[];
    yoyReading: string;
    top10: { code: string; nb: string; val: number; sp: number | null; leads: number; dz: number; lev: string[] }[];
    destacados: {
        sdNow: number; dNow: number; simpleNow: number; pctDest: number;
        splits: { sd: { sale: number; rent: number }; d: { sale: number; rent: number }; simple: { sale: number; rent: number } };
        monthly: { month: string; tiers: { tier: string; n: number }[]; dest: number }[];
        llTier: { tier: string; saleLL: number | null; saleLeads: number; rentLL: number | null; rentLeads: number }[];
        reading: string;
    };
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
    const H1_25: [Date, Date] = [new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 6, 1))];
    const H1_26: [Date, Date] = [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 6, 1))];
    const windowStart = (w: string, fallbackMonths: number): Date => {
        if (w === 'YTD 2026') return YTD0;
        const d = new Date(NOW);
        if (w === 'Últimos 30 días') d.setUTCDate(d.getUTCDate() - 30);
        else if (w === 'Últimos 90 días') d.setUTCDate(d.getUTCDate() - 90);
        else if (w === 'Últimos 6 meses') d.setUTCMonth(d.getUTCMonth() - 6);
        else if (w === 'Últimos 12 meses') d.setUTCMonth(d.getUTCMonth() - 12);
        else d.setUTCMonth(d.getUTCMonth() - fallbackMonths);
        return d;
    };
    const demandStart = windowStart(cfg.ventDemanda || 'Últimos 12 meses', 12);
    const leadsWindow = cfg.ventLeads || 'YTD 2026';
    const leadsStart = windowStart(leadsWindow, 12);
    const leadsLabel = leadsWindow.toLowerCase();

    // --- propiedades publicadas ---
    const pub = await db.collection('properties').find(
        { 'company._id': CID, 'status.last': 'published' },
        { projection: {
            listing: 1, type: 1, 'acm.price.value': 1, qualityScore: 1, pictures: 1, videos: 1,
            virtualTour: 1, 'address.neighborhood': 1, internalId: 1, publishedAt: 1,
            'portals.inmuebles24.type': 1, 'attributes.totalSurface': 1, 'attributes.roofedSurface': 1,
        } }
    ).toArray();

    type Item = { pid: ObjectId; code: string | null; nb: string | null; nbid: string | null; op: string | null;
        val: number; sp: number | null; ppm2: number | null; q3: number | null; tour: boolean; tier: string | null;
        fotos: number; video: boolean; descLen: number };
    const items: Item[] = pub.map((p) => {
        const nb = (gv(p, 'address', 'neighborhood') || {}) as Record<string, unknown>;
        const val = (num(gv(p, 'listing', 'value')) || 0);
        const acm = num(gv(p, 'acm', 'price', 'value'));
        const m2 = num(gv(p, 'attributes', 'totalSurface')) || num(gv(p, 'attributes', 'roofedSurface'));
        return {
            pid: p._id as ObjectId, code: (p.internalId as string) || null,
            nb: (nb.name as string) || null, nbid: (nb.id as string) || null,
            op: (gv(p, 'listing', 'operation') as string) || null,
            val, sp: val && acm ? val / acm : null,
            ppm2: val && m2 ? val / m2 : null,
            q3: num(p.qualityScore), tour: !!p.virtualTour,
            tier: tierName(gv(p, 'portals', 'inmuebles24', 'type')),
            fotos: (p.pictures as unknown[] | undefined)?.length || 0,
            video: !!((p.videos as unknown[] | undefined)?.length),
            descLen: ((gv(p, 'listing', 'description') as string) || '').length,
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
    let leadsWinTotal = 0;
    const invSeen = new Set<string>();   // dedup: mismo contacto en la misma propiedad = 1 lead único
    const leadCur = db.collection('leads').find(
        { 'property._id': { $in: pubIds }, createdAt: { $gte: leadsStart } },
        { projection: { 'property._id': 1, createdAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact._id': 1 } }
    );
    for await (const l of leadCur) {
        const pid = String(gv(l, 'property', '_id'));
        const who = gv(l, 'contact', 'phone') || gv(l, 'contact', 'email') || String(gv(l, 'contact', '_id') || l._id);
        const k = `${pid}|${who}`;
        if (invSeen.has(k)) continue;   // duplicado → no cuenta
        invSeen.add(k);
        leadsByPid[pid] = (leadsByPid[pid] || 0) + 1;
        leadsWinTotal++;
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
    const topZones = [...byNb.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 7);
    const zoneNbids = [...new Set(topZones.map(([, its]) => its[0].nbid).filter(Boolean) as string[])];
    // Fuente de la "oferta" de la zona: red Pulppo (properties) o MLS i24 completo (mls).
    const ofertaColl = cfg.mlsGeneral ? 'mls' : 'properties';
    const ofertaLabel = cfg.mlsGeneral ? 'MLS i24' : 'red Pulppo';
    const ofertaByNbid: Record<string, number> = {};       // # publicadas en la colonia
    const zonePpm2: Record<string, number | null> = {};    // mediana $/m² de venta en la colonia
    if (zoneNbids.length) {
        const aggN = db.collection(ofertaColl).aggregate([
            { $match: { 'status.last': 'published', 'address.neighborhood.id': { $in: zoneNbids } } },
            { $group: { _id: '$address.neighborhood.id', n: { $sum: 1 } } },
        ], { allowDiskUse: true });
        for await (const r of aggN) ofertaByNbid[r._id as string] = r.n as number;
        const aggP = db.collection(ofertaColl).aggregate([
            { $match: { 'status.last': 'published', 'listing.operation': 'sale',
                'address.neighborhood.id': { $in: zoneNbids },
                'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } } },
            { $project: { nbid: '$address.neighborhood.id', ppm2: { $divide: ['$listing.value', '$attributes.totalSurface'] } } },
            { $group: { _id: '$nbid', vals: { $push: '$ppm2' } } },
        ], { allowDiskUse: true });
        for await (const r of aggP) zonePpm2[r._id as string] = median(r.vals as number[]);
    }
    const zones = topZones.map(([nb, its]) => {
        const nbid = its[0].nbid;
        const herPpm2 = median(its.filter((i) => i.op === 'sale').map((i) => i.ppm2));
        const zPpm2 = nbid ? zonePpm2[nbid] : null;
        const vsZona = herPpm2 && zPpm2 ? Math.round((herPpm2 / zPpm2 - 1) * 100) : null;
        return { nb, n: its.length, oferta: (nbid && ofertaByNbid[nbid]) || 0, vsZona,
            dem: (nbid && demandByNb[nbid]) || 0, leads: leadsByNb[nb] || 0 };
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
    const priceLead = PL_ORDER.map((pcl) => {
        const grp = venta.filter((it) => priceCls(it.sp) === pcl);
        const leads = grp.reduce((a, it) => a + (leadsByPid[String(it.pid)] || 0), 0);
        return { cls: pcl, props: grp.length, leads, ll: grp.length ? leads / grp.length : 0 };
    });
    const joyas = (seg[key('Alta', 'Óptimo')] || 0) + (seg[key('Media', 'Óptimo')] || 0);
    const joyasAlta = seg[key('Alta', 'Óptimo')] || 0;
    const caras = QROWS.reduce((a, q) => a + (seg[key(q, 'Fuera de mercado')] || 0), 0);
    const nSale = venta.length;
    const nRef = venta.filter((it) => priceCls(it.sp) !== 'Sin referencia').length;
    const nCaro = venta.filter((it) => priceCls(it.sp) === 'Fuera de mercado').length;
    const pctCaro = nCaro / (nRef || 1);

    // --- lecturas auto por sección ---
    const gap = [...invVsDemand].sort((a, b) => (b.invPct - b.demPct) - (a.invPct - a.demPct))[0];
    const topZone = zones[0];
    const insightInv = topZone
        ? `Tu mayor concentración está en ${topZone.nb} (${topZone.n} de ${topZone.oferta} propiedades de la zona). `
          + (gap && gap.invPct - gap.demPct > 8
              ? `En el rango ${gap.band} tienes ${Math.round(gap.invPct)}% de tu inventario pero la demanda ahí es ${Math.round(gap.demPct)}% — hay sobreoferta.`
              : `Tu mezcla por rango de precio va en línea con la demanda del mercado.`)
        : '';
    const pOpt = priceLead.find((x) => x.cls === 'Óptimo'), pCaro = priceLead.find((x) => x.cls === 'Fuera de mercado');
    const insightPrecio = `${Math.round(pctCaro * 100)}% de tu venta con referencia está fuera de mercado (${nCaro} props). `
        + (pOpt && pCaro
            ? `Las de precio óptimo reciben ${pOpt.ll.toFixed(1)} leads por propiedad vs ${pCaro.ll.toFixed(1)} las que están fuera de mercado.`
            : '');

    // ===================== FUNNEL (venta vs renta) + RECOMENDACIONES =====================
    // El funnel usa TODO el inventario del año (incl. vendido/dado de baja), no solo lo publicado hoy.
    const allprops = await db.collection('properties').find({ 'company._id': CID },
        { projection: { 'listing.operation': 1, qualityScore: 1, publishedAt: 1, 'status.last': 1, 'status.history': 1 } }).toArray();
    const pid2op = new Map(allprops.map((p) => [String(p._id), gv(p, 'listing', 'operation') as string]));
    const allpids = allprops.map((p) => p._id as ObjectId);
    const zero = () => ({ sale: 0, rent: 0 } as Record<string, number>);

    const leadsByOp = zero(), contByOp = zero();
    let ytdLeadsAll = 0, ytdVis = 0, h1Leads25 = 0, h1Leads26 = 0;
    let compCliente = 0, compBroker = 0, compIncont = 0, compDup = 0;
    const dupSet = new Set<string>();   // clave propiedad+contacto → repetición = duplicado
    const lc = db.collection('leads').find({ 'property._id': { $in: allpids }, createdAt: { $gte: H1_25[0] } },
        { projection: { 'property._id': 1, answeredAt: 1, createdAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact.company._id': 1, 'contact._id': 1 } });
    for await (const l of lc) {
        const d = asDt(l.createdAt); if (!d) continue;
        const op = pid2op.get(String(gv(l, 'property', '_id')));
        if (d >= YTD0 && (op === 'sale' || op === 'rent')) {
            const phone = gv(l, 'contact', 'phone'), email = gv(l, 'contact', 'email');
            // duplicado = mismo contacto en la misma propiedad → se descarta de TODO el funnel
            const who = phone || email || String(gv(l, 'contact', '_id') || l._id);
            const dupKey = `${String(gv(l, 'property', '_id'))}|${who}`;
            if (dupSet.has(dupKey)) { compDup++; }
            else {
                dupSet.add(dupKey);
                ytdLeadsAll++;
                leadsByOp[op]++;
                const broker = !!gv(l, 'contact', 'company', '_id');   // el contacto está asociado a una empresa/inmobiliaria
                if (!(phone || email)) compIncont++;                   // sin teléfono ni correo = incontactable
                if (broker) compBroker++; else compCliente++;
                if (l.answeredAt) contByOp[op]++;
            }
        }
        if (d >= H1_25[0] && d < H1_25[1]) h1Leads25++;
        if (d >= H1_26[0] && d < H1_26[1]) h1Leads26++;
    }
    const visByOp = zero();
    const vc = db.collection('visits').find({ 'steps.property._id': { $in: allpids }, 'status.last': { $ne: 'cancelled' }, createdAt: { $gte: YTD0 } }, { projection: { 'steps.property._id': 1 } });
    for await (const v of vc) {
        const steps = (v.steps || []) as Document[];
        const mine = steps.map((s) => String(gv(s, 'property', '_id'))).find((id) => pid2op.has(id));
        if (mine) { ytdVis++; const op = pid2op.get(mine); if (op === 'sale' || op === 'rent') visByOp[op]++; }
    }
    const offersByOp = zero(), closesByOp = zero();
    const opsAll = await db.collection('operations').find({ 'property._id': { $in: allpids } },
        { projection: { 'status.last': 1, closedAt: 1, createdAt: 1, 'property._id': 1, 'closeValue.value': 1, 'comission.value': 1 } }).toArray();
    for (const o of opsAll) {
        const t = pid2op.get(String(gv(o, 'property', '_id')));
        if (t !== 'sale' && t !== 'rent') continue;
        const cd = asDt(o.createdAt), xd = asDt(gv(o, 'closedAt'));
        if ((cd && cd >= YTD0 && cd < NOW) || (xd && xd >= YTD0 && xd < NOW)) offersByOp[t]++;
        const last = gv(o, 'status', 'last');
        if ((last === 'closed' || last === 'paying') && xd && xd >= YTD0) closesByOp[t]++;
    }
    const buildFunnel = (title: string, op: string) => {
        const raw: [string, number][] = [['Únicos', leadsByOp[op]], ['Respuesta', contByOp[op]], ['Visitas', visByOp[op]], ['Ofertas', offersByOp[op]], ['Cierres', closesByOp[op]]];
        let prev: number | null = null;
        return { title, steps: raw.map(([label, value]) => { const rate = prev && prev > 0 ? value / prev : null; prev = value; return { label, value, rate }; }) };
    };
    const funnel = [buildFunnel('Venta', 'sale'), buildFunnel('Renta', 'rent')];
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const visRateV = leadsByOp.sale ? visByOp.sale / leadsByOp.sale : 0;
    const closeV = leadsByOp.sale ? closesByOp.sale / leadsByOp.sale : 0;
    const closeR = leadsByOp.rent ? closesByOp.rent / leadsByOp.rent : 0;
    const funnelReading = `Tu tasa de visita en venta es ${pct(visRateV)} (benchmark Pulppo 14%). `
        + `Cierre: ${(100 * closeV).toFixed(1)}% en venta (meta 1.6%) y ${(100 * closeR).toFixed(1)}% en renta (meta 6%). `
        + `La tasa se lee por operación, nunca mezclando venta y renta.`;

    // --- recomendaciones a nivel cartera (nunca priorizan renta sobre venta) ---
    const altaNow = items.filter((it) => it.q3 === 3).length / (N || 1);
    const nNoTour = items.filter((it) => !it.tour).length;
    const visRate = ytdLeadsAll ? ytdVis / ytdLeadsAll : 0;
    const recos: { enfoque: string; title: string; body: string; sev: number }[] = [];
    if (pctCaro >= 0.30) recos.push({ enfoque: 'Precio', sev: 5, title: 'Ajusta el precio de tu inventario en venta',
        body: `${pct(pctCaro)} de tu venta con referencia (${nCaro} props) está fuera de mercado (+20% sobre ACM). Las de precio óptimo reciben ${pOpt ? pOpt.ll.toFixed(1) : '—'} leads por propiedad vs ${pCaro ? pCaro.ll.toFixed(1) : '—'} las que están fuera de mercado. Empieza por los rangos de mayor ticket.` });
    if (visRate < 0.14) recos.push({ enfoque: 'Ficha', sev: 4, title: 'Sube tu tasa de visita',
        body: `Solo el ${pct(visRate)} de tus leads llega a visita (benchmark Pulppo 14%). Mejora las primeras 3 fotos, el orden de la galería y la descripción — ahí se decide si el interesado agenda.` });
    if (altaNow < 0.25) recos.push({ enfoque: 'Ficha', sev: 3, title: 'Sube la calidad de tus fichas',
        body: `Solo ${pct(altaNow)} de tus fichas son calidad Alta. Fotos profesionales, video y tour virtual (hoy ${nNoTour} sin tour) elevan la exposición y la conversión sin cambiar el precio.` });
    recos.push({ enfoque: 'Visibilidad', sev: 2, title: 'Enfoca la inversión en visibilidad donde rinde',
        body: `Destacar solo rinde cuando la propiedad ya está bien puesta (precio óptimo + ficha completa). Concentra el impulso en tus ${joyas} propiedades listas — no en las que están fuera de mercado.` });

    // ===================== YoY (H1 2025 vs H1 2026) =====================
    const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
    const monthEnd = (y: number, m: number) => new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const terminal = (p: Document): Date | null => {
        if (gv(p, 'status', 'last') === 'published') return null;
        const hist = (gv(p, 'status', 'history') || []) as Document[];
        const ts = hist.map((h) => asDt(h.date || h.timestamp || h.createdAt)).filter(Boolean) as Date[];
        return ts.length ? new Date(Math.max(...ts.map((d) => d.getTime()))) : null;
    };
    const propMeta = allprops.map((p) => ({ pub: asDt(p.publishedAt), term: terminal(p), q3: num(p.qualityScore) }));
    const activeAt = (end: Date) => propMeta.filter((p) => p.pub && p.pub < end && (p.term === null || p.term > end));
    const h1Avg = (year: number, alta: boolean) => {
        let s = 0;
        for (let m = 1; m <= 6; m++) { const act = activeAt(monthEnd(year, m)); s += alta ? act.filter((p) => p.q3 === 3).length : act.length; }
        return s / 6;
    };
    const inv25 = h1Avg(2025, false), inv26 = h1Avg(2026, false);
    const alta25 = h1Avg(2025, true) / (inv25 || 1), alta26 = h1Avg(2026, true) / (inv26 || 1);
    const closeWindow = (a: Date, b: Date) => {
        const r = { n: 0, sale: 0, rent: 0, com: 0, gmv: 0 };
        for (const o of opsAll) {
            const last = gv(o, 'status', 'last'); const xd = asDt(gv(o, 'closedAt'));
            if (!(last === 'closed' || last === 'paying') || !xd || xd < a || xd >= b) continue;
            const t = pid2op.get(String(gv(o, 'property', '_id')));
            r.n++; if (t === 'sale') r.sale++; else r.rent++;
            r.com += num(gv(o, 'comission', 'value')) || 0;
            if (t === 'sale') r.gmv += num(gv(o, 'closeValue', 'value')) || 0;
        }
        return r;
    };
    const cl25 = closeWindow(H1_25[0], H1_25[1]), cl26 = closeWindow(H1_26[0], H1_26[1]);
    const tc25 = cl25.n / (h1Leads25 || 1), tc26 = cl26.n / (h1Leads26 || 1);
    const yoy: AnalisisData['yoy'] = [
        { label: 'Inventario activo (prom.)', a: inv25, b: inv26, fmt: 'int', goodUp: true },
        { label: 'Leads / mes (prom.)', a: h1Leads25 / 6, b: h1Leads26 / 6, fmt: 'int', goodUp: true },
        { label: 'Leads por propiedad', a: (h1Leads25 / 6) / (inv25 || 1), b: (h1Leads26 / 6) / (inv26 || 1), fmt: 'dec', goodUp: true },
        { label: 'Calidad Alta', a: alta25, b: alta26, fmt: 'pct', goodUp: true },
        { label: 'Cierres (6 meses)', a: cl25.n, b: cl26.n, fmt: 'int', goodUp: true },
        { label: 'Comisión total', a: cl25.com, b: cl26.com, fmt: 'money', goodUp: true },
        { label: 'Tasa de cierre (leads→cierre)', a: tc25, b: tc26, fmt: 'pct2', goodUp: true },
    ];
    const yoyMix = [{ year: 2025, sale: cl25.sale, rent: cl25.rent, com: cl25.com }, { year: 2026, sale: cl26.sale, rent: cl26.rent, com: cl26.com }];
    const comDelta = (cl26.com - cl25.com) / (cl25.com || 1);
    const yoyReading = `Comisión total ${money(cl25.com)} → ${money(cl26.com)} (${comDelta >= 0 ? '+' : ''}${Math.round(comDelta * 100)}%). El motor son las ventas: en 2026 se cerraron ${cl26.sale}.`;

    // ===================== Top 10 críticas =====================
    const cand10 = [];
    for (const it of items) {
        if (it.op !== 'sale') continue;
        const leads = leadsByPid[String(it.pid)] || 0;
        const dz = (it.nbid && demandByNb[it.nbid]) || 0;
        const spV = it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null;
        const fueraMercado = spV != null && spV > 1.20;
        const lev: string[] = [];
        if (spV && spV > 1.15) lev.push('Bajar precio');
        // Destacar solo si el precio NO está fuera de mercado (la visibilidad no arregla el sobreprecio).
        if ((it.tier === null || it.tier === 'Simple' || it.tier === 'Offline') && !fueraMercado) lev.push('Destacar');
        // Mejorar ficha: detallar qué falta en vez de decirlo genérico.
        const falta: string[] = [];
        if (it.fotos < 8) falta.push('fotos');
        if (!it.tour) falta.push('tour');
        if (it.descLen < 400) falta.push('descripción');
        if (!it.video) falta.push('video');
        if (((it.q3 || 2) <= 2 || !it.tour || it.fotos < 8) && falta.length) lev.push(`Mejorar ficha: ${falta.join(', ')}`);
        if (!lev.length || dz <= 0) continue;
        cand10.push({ code: it.code || '—', nb: it.nb || '—', val: it.val, sp: spV, leads, dz, lev, score: dz / (1 + leads) });
    }
    const top10 = cand10.sort((a, b) => b.score - a.score).slice(0, 10)
        .map(({ code, nb, val, sp, leads, dz, lev }) => ({ code, nb, val, sp, leads, dz, lev }));

    // ===================== DESTACADOS (nivel de aviso + L/L) =====================
    const MES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const TIER_ORDER = ['Súper destacado', 'Destacado', 'Simple', 'Offline'];
    const MONTHS: [number, number][] = [];
    for (let m = 1; m <= NOW.getUTCMonth() + 1; m++) MONTHS.push([NOW.getUTCFullYear(), m]);
    const mkey = (y: number, m: number) => `${y}-${m}`;

    const histProps = await db.collection('properties').find(
        { 'company._id': CID, 'portals.inmuebles24': { $exists: true } },
        { projection: { 'portals.inmuebles24.history': 1, 'portals.inmuebles24.type': 1, updatedAt: 1 } }
    ).toArray();
    const pid2seq = new Map<string, [Date, string | null][]>();
    const monthTierAll: Record<string, Record<string, number>> = {};
    const monthTierOp: Record<'sale' | 'rent', Record<string, Record<string, number>>> = { sale: {}, rent: {} };
    for (const [y, m] of MONTHS) { monthTierAll[mkey(y, m)] = {}; monthTierOp.sale[mkey(y, m)] = {}; monthTierOp.rent[mkey(y, m)] = {}; }
    for (const p of histProps) {
        const i24 = (gv(p, 'portals', 'inmuebles24') || {}) as Document;
        const seq = ((i24.history as Document[]) || [])
            .map((h) => [asDt(h.timestamp), tierName(h.type)] as [Date | null, string | null])
            .filter((x): x is [Date, string | null] => !!x[0]);
        const cur = tierName(i24.type);
        if (cur) seq.push([asDt(p.updatedAt) || NOW, cur]);
        seq.sort((a, b) => a[0].getTime() - b[0].getTime());
        pid2seq.set(String(p._id), seq);
        const pop = pid2op.get(String(p._id));
        for (const [y, m] of MONTHS) {
            const end = monthEnd(y, m); let st: string | null = null;
            for (const [dd, tt] of seq) { if (dd < end) st = tt; else break; }
            if (st && st !== 'Offline') {
                monthTierAll[mkey(y, m)][st] = (monthTierAll[mkey(y, m)][st] || 0) + 1;
                if (pop === 'sale' || pop === 'rent') monthTierOp[pop][mkey(y, m)][st] = (monthTierOp[pop][mkey(y, m)][st] || 0) + 1;
            }
        }
    }
    const avmOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    for (const op of ['sale', 'rent'] as const) for (const t of TIER_ORDER)
        avmOp[op][t] = MONTHS.reduce((s, [y, m]) => s + (monthTierOp[op][mkey(y, m)][t] || 0), 0);
    const tierAt = (pid: string, d: Date): string | null => {
        let st: string | null = null;
        for (const [t, tt] of (pid2seq.get(pid) || [])) { if (t.getTime() <= d.getTime()) st = tt; else break; }
        return st;
    };
    // leads YTD (únicos) atribuidos al nivel que tenía el aviso cuando llegó el contacto
    const tlYtdOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    const dSeen = new Set<string>();
    const dc = db.collection('leads').find({ 'property._id': { $in: allpids }, createdAt: { $gte: YTD0 } },
        { projection: { 'property._id': 1, createdAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact._id': 1 } });
    for await (const l of dc) {
        const d = asDt(l.createdAt); if (!d) continue;
        const pid = String(gv(l, 'property', '_id')); const op = pid2op.get(pid);
        if (op !== 'sale' && op !== 'rent') continue;
        const who = gv(l, 'contact', 'phone') || gv(l, 'contact', 'email') || String(gv(l, 'contact', '_id') || l._id);
        const k = `${pid}|${who}`; if (dSeen.has(k)) continue; dSeen.add(k);
        const st = tierAt(pid, d);
        if (st && st !== 'Offline') tlYtdOp[op][st] = (tlYtdOp[op][st] || 0) + 1;
    }
    const tierNowOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    for (const it of items) if (it.op === 'sale' || it.op === 'rent') { const t = it.tier || 'Sin i24'; tierNowOp[it.op][t] = (tierNowOp[it.op][t] || 0) + 1; }
    const sdNow = (tierNowOp.sale['Súper destacado'] || 0) + (tierNowOp.rent['Súper destacado'] || 0);
    const dNow = (tierNowOp.sale['Destacado'] || 0) + (tierNowOp.rent['Destacado'] || 0);
    const simpleNow = (tierNowOp.sale['Simple'] || 0) + (tierNowOp.rent['Simple'] || 0);
    const llTier = ['Súper destacado', 'Destacado', 'Simple'].map((t) => ({
        tier: t,
        saleLL: avmOp.sale[t] >= 3 ? (tlYtdOp.sale[t] || 0) / avmOp.sale[t] : null, saleLeads: tlYtdOp.sale[t] || 0,
        rentLL: avmOp.rent[t] >= 3 ? (tlYtdOp.rent[t] || 0) / avmOp.rent[t] : null, rentLeads: tlYtdOp.rent[t] || 0,
    }));
    const boostOp = (op: 'sale' | 'rent'): number | null => {
        const s = avmOp[op]['Simple'] >= 3 ? (tlYtdOp[op]['Simple'] || 0) / avmOp[op]['Simple'] : null;
        const cand = ['Súper destacado', 'Destacado'].filter((t) => avmOp[op][t] >= 3).map((t) => (tlYtdOp[op][t] || 0) / avmOp[op][t]);
        if (!s || !cand.length) return null;
        return Math.max(...cand) / s;
    };
    const bv = boostOp('sale'), br = boostOp('rent');
    const rindeTxt = (op: string, b: number | null) => b === null
        ? `en ${op} casi no has destacado (sin datos para comparar)`
        : b >= 1.15 ? `en ${op} destacar rinde ${b.toFixed(1)}× más` : `en ${op} destacar no rinde más que el simple`;
    let destReading = `Con tus datos, ${rindeTxt('venta', bv)} y ${rindeTxt('renta', br)}.`;
    if (sdNow + dNow === 0) destReading += ` Hoy tienes 0 avisos destacados — enfoca el impulso en tus ${joyas} propiedades competitivas y de buena calidad.`;
    const destacados = {
        sdNow, dNow, simpleNow, pctDest: (sdNow + dNow) / (N || 1),
        splits: {
            sd: { sale: tierNowOp.sale['Súper destacado'] || 0, rent: tierNowOp.rent['Súper destacado'] || 0 },
            d: { sale: tierNowOp.sale['Destacado'] || 0, rent: tierNowOp.rent['Destacado'] || 0 },
            simple: { sale: tierNowOp.sale['Simple'] || 0, rent: tierNowOp.rent['Simple'] || 0 },
        },
        monthly: MONTHS.map(([y, m]) => ({
            month: MES[m], tiers: TIER_ORDER.map((t) => ({ tier: t, n: monthTierAll[mkey(y, m)][t] || 0 })),
            dest: (monthTierAll[mkey(y, m)]['Súper destacado'] || 0) + (monthTierAll[mkey(y, m)]['Destacado'] || 0),
        })),
        llTier, reading: destReading,
    };

    return {
        company: CNAME, corte: NOW.toISOString(), N, opSplit,
        llProp: leadsWinTotal / (N || 1), leadsLabel, ofertaLabel,
        leadsComp: { cliente: compCliente, broker: compBroker, incontactables: compIncont, duplicados: compDup, total: leadsByOp.sale + leadsByOp.rent, totalOp: { sale: leadsByOp.sale, rent: leadsByOp.rent } },
        zones, invVsDemand, matrix, priceLead,
        joyas, joyasAlta, caras, nSale, nCaro, pctCaro,
        insightInv, insightPrecio,
        funnel, funnelReading, recos,
        yoy, yoyMix, yoyReading, top10, destacados,
    };
}
