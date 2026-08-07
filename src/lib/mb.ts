// Herramienta Master Brokers (borrador): datos a nivel INMOBILIARIA (una company de Mongo).
// Overview (atención + KPIs + red flags + prioridades) + listado con el cruce de mercado (demanda,
// precio vs. oferta MLS y vs. cierres Pulppo, competencia, calidad) + funnel comercial. Datos en vivo.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { getKam } from './kam';
import { refComps, idxPool, type PoolItem, type Subj } from './comparables';

const ADVANCED = new Set(['offer', 'offer_blocked', 'contract', 'paying', 'closed']);
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let cur: unknown = d;
    for (const k of ks) { if (cur == null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
    return cur;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const asDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v) : null);
// Primera publicación real (status.history), no la última republicación (publishedAt se reinicia al republicar).
const firstPublished = (p: Document): Date | null => {
    const h = (dig(p, 'status', 'history') as { status?: string; timestamp?: unknown }[] | undefined) || [];
    const ds = h.filter((x) => x?.status === 'published').map((x) => asDate(x?.timestamp)).filter((d): d is Date => !!d);
    return ds.length ? ds.reduce((a, b) => (a < b ? a : b)) : (asDate(dig(p, 'publishedAt')) ?? asDate(dig(p, 'createdAt')));
};
const median = (xs: number[]): number | null => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pushMap = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
const estadoPrecio = (sp: number | null): string => (sp == null ? 'Haz ACM' : sp <= 1.05 ? 'Óptimo' : sp <= 1.2 ? 'No competitivo' : 'Fuera de mercado');
const CAL: Record<number, string> = { 3: 'Alta', 2: 'Media', 1: 'Baja' };
// Tier de destacado en Inmuebles24 (portals.inmuebles24.type).
const TIER: Record<string, string> = { HOME_COMBO: 'Super', HOME_COMBO_ZONA_DEMAND: 'Super', DESTACADO_COMBO: 'Destacado', DESTACADO_COMBO_ZONA_DEMAND: 'Destacado', SIMPLE_COMBO: 'Simple', OFFLINE: 'Offline' };
const D24 = new Date(Date.now() - 730 * 864e5);
const D30 = new Date(Date.now() - 30 * 864e5);
const D60 = new Date(Date.now() - 60 * 864e5);
// Demanda = búsquedas de los últimos 3 meses (estándar acordado con Ale: mínimo 1 mes, 3 por
// default). Antes era YTD, que en enero medía 3 semanas y en diciembre 12 meses.
const D90 = new Date(Date.now() - 90 * 864e5);
const DEMANDA_LABEL = 'últimos 3 meses';
// Nombre completo de un agente, o null si no es usable.
const agName = (a: Document | null | undefined): string | null => {
    if (!a || !dig(a, '_id')) return null;
    const n = [dig(a, 'firstName'), dig(a, 'lastName')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return n || null;
};
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
// Rangos de velocidad de 1ª respuesta (minutos): flash ≤5 · rápida ≤1h · media ≤24h · lento >24h.
export type RespKey = 'flash' | 'rapida' | 'media' | 'lento' | 'sin';
const respBucket = (min: number | null): RespKey => (min == null ? 'sin' : min <= 5 ? 'flash' : min <= 60 ? 'rapida' : min <= 1440 ? 'media' : 'lento');

export interface MBProp {
    id: string; code: string; type: string; op: string; colonia: string; calle: string; asesor: string;
    precio: number | null; estado: string; demanda: number; vsOferta: number | null; vsCierres: number | null;
    compite: number | null; calidad: string; dias: number | null; mesesPub: number | null;
    vistas: number; leads: number; respondidos: number; visitas: number; ofertas: number; cierres: number;
    respMedMin: number | null; oppScore: number; diag: string[]; tier: string;
    // qué le falta a la ficha (para los insights de calidad del overview)
    fotos: number; video: boolean; tour: boolean; amenidades: number;
    // errores de captura evidentes (precio de $30, superficie de 7 millones de m²…)
    errores: string[];
}
// Desempeño por asesor para el recap de flags del overview. Solo asesores de la inmobiliaria.
export interface MBAsesor {
    name: string; leads: number; respondidos: number; fueraSla: number; respMedMin: number | null;
    visitas: number; cierres: number; comision: number; busquedas: number; clientes: number; propsCompartidas: number;
    green: string[]; red: string[];
}
export type PorOpCal = { alta: number; media: number; baja: number; total: number };
export type PorOpFalta = { video: number; fotos: number; amenidades: number; tour: number; acm: number; total: number };

// Errores de captura: lo que está mal escrito, no mal vendido. Umbrales elegidos midiendo la red
// completa (9,211 publicadas): sin superficie es el más común con 8.3%, y hay ventas de $1 y
// superficies de 7,710,000 m². Son "revisa esto", no "esto está roto".
const erroresDe = (op: string, val: number | null, surf: number | null, suites: number | null, fotos: number): string[] => {
    const e: string[] = [];
    if (!val || val <= 0) e.push('Sin precio');
    else if (op === 'sale' && val < 100000) e.push('Precio irrisorio');
    else if (op === 'rent' && val < 1000) e.push('Precio irrisorio');
    else if (op === 'rent' && val > 500000) e.push('Renta con precio de venta');
    if (!surf || surf <= 0) e.push('Sin superficie');
    else if (surf > 5000) e.push('Superficie imposible');
    else if (surf < 20) e.push('Superficie imposible');
    else if (op === 'sale' && val) {
        const ppm = val / surf;
        if (ppm < 3000 || ppm > 300000) e.push('$/m² imposible');
    }
    if ((suites ?? 0) > 15) e.push('Recámaras imposibles');
    if (!fotos) e.push('Sin fotos');
    return e;
};
const ERROR_NOTA: Record<string, string> = {
    'Sin precio': 'no se puede publicar ni comparar sin precio',
    'Precio irrisorio': 'un cero de menos: nadie vende ni renta en ese monto',
    'Renta con precio de venta': 'parece el precio de venta capturado como renta mensual',
    'Sin superficie': 'sin m² no se puede calcular $/m² ni comparar contra el mercado',
    'Superficie imposible': 'los m² capturados no corresponden al tipo de propiedad',
    '$/m² imposible': 'el precio y la superficie no cuadran entre sí',
    'Recámaras imposibles': 'el número de recámaras está fuera de lo real',
    'Sin fotos': 'una publicación sin fotos no recibe contactos',
};

export interface MBZona {
    nb: string; n: number; leads: number; demanda: number; oferta: number;
    vsOferta: number | null; vsCierres: number | null;
}
export interface MBData {
    companyId: string; name: string; nProps: number; nVenta: number; nRenta: number; captaciones90: number;
    vistas: number; leads: number; respondidos: number; visitas: number; ofertas: number; cierres: number; sinLeads: number;
    leads30: number; leads30prev: number; resp: Record<RespKey, number>; respMedMin: number | null;
    calAltaPct: number; benchAltaPct: number; props: MBProp[];
    // split venta/renta para los KPIs del overview
    calAltaVenta: number; calAltaRenta: number;
    leads30V: number; leads30R: number; leads30prevV: number; leads30prevR: number;
    respV: Record<RespKey, number>; respR: Record<RespKey, number>;
    // --- calidad de ficha: # por nivel y qué falta para subir de nivel ---
    // Medido en toda la red: el ÚNICO factor que separa Media de Alta es el VIDEO (100% de las
    // Alta lo tienen vs 32% de las Media). Fotos, descripción, tour y planos son planos entre
    // niveles, así que recomendar un tour para "subir la calidad" es mal consejo.
    // calidad y huecos de ficha, partidos venta/renta: en la red la renta trae mucho mejor ficha
    // que la venta, y un total los promedia y esconde el problema.
    calidad: PorOpCal; calidadVenta: PorOpCal; calidadRenta: PorOpCal;
    falta: PorOpFalta; faltaVenta: PorOpFalta; faltaRenta: PorOpFalta;
    // propiedades con errores de captura evidentes, agrupadas por tipo de error
    errores: { tipo: string; n: number; nota: string }[]; nErrores: number;
    // --- zonas (la sección que más le gusta a Ale, ahora también en el overview) ---
    zonas: MBZona[]; demandaLabel: string;
    // --- asesores con sus flags, para el recap del overview ---
    asesores: MBAsesor[];
}

const countBy = async (coll: string, field: string, match: Document): Promise<Map<string, number>> => {
    const db = await getDb();
    const rows = await db.collection(coll).aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    return new Map(rows.map((r) => [String(r._id), r.n as number]));
};
// Comparables ($/m² vs oferta y vs cierres, competencia) → src/lib/comparables.ts (compartido con analisis.ts).

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
        { projection: { internalId: 1, type: 1, listing: 1, acm: 1, qualityScore: 1, 'attributes.totalSurface': 1, 'attributes.suites': 1, address: 1, agent: 1, publishedAt: 1, createdAt: 1, 'status.history': 1, company: 1, 'portals.inmuebles24.type': 1 } }
    ).toArray();
    if (!props.length) return null;
    const name = (dig(props[0], 'company', 'name') as string) ?? 'Inmobiliaria';
    const ids = props.map((p) => p._id as ObjectId);
    const nbids = [...new Set(props.map((p) => dig(p, 'address', 'neighborhood', 'id')).filter(Boolean))] as string[];

    // --- leads: conteo, 30d vs previos, y tiempo de 1ª respuesta (answeredAt - createdAt) ---
    const leadDocs = await db.collection('leads').find({ 'property._id': { $in: ids } },
        { projection: { 'property._id': 1, createdAt: 1, answeredAt: 1, agent: 1 } }).toArray();
    const pidOp = new Map(props.map((p) => [String(p._id), dig(p, 'listing', 'operation') as string]));
    // asesores DE la inmobiliaria (por el inventario que traen). Un broker de otra inmobiliaria
    // puede atender un lead sobre tu inventario y no debe aparecer como si fuera de tu equipo.
    const internos = new Map<string, string>();
    for (const p of props) { const a = dig(p, 'agent') as Document | undefined; const n = agName(a); if (a && n) internos.set(String(dig(a, '_id')), n); }

    // UNIVERSO DE LOS ASESORES: todas las propiedades de la inmobiliaria, no solo las publicadas
    // hoy. Juzgar cómo trabaja una persona ignorando los leads de lo que ya vendió o pausó la
    // deja mal medida (en pruebas, un asesor pasaba de 50% a 67% de leads fuera de SLA).
    const allProps = await db.collection('properties').find({ 'company._id': cid },
        { projection: { agent: 1 } }).toArray();
    const allIds = allProps.map((p) => p._id as ObjectId);
    const allAgent = new Map(allProps.map((p) => [String(p._id), dig(p, 'agent') as Document | undefined]));
    for (const p of allProps) { const a = dig(p, 'agent') as Document | undefined; const n = agName(a); if (a && n && !internos.has(String(dig(a, '_id')))) internos.set(String(dig(a, '_id')), n); }

    const leadsMap = new Map<string, number>();
    const ansMap = new Map<string, number>();       // leads RESPONDIDOS por propiedad
    const respByProp = new Map<string, number[]>();
    const zero = (): Record<RespKey, number> => ({ flash: 0, rapida: 0, media: 0, lento: 0, sin: 0 });
    const resp = zero(), respV = zero(), respR = zero();
    const allResp: number[] = [];
    let leads30 = 0, leads30prev = 0, leads30V = 0, leads30R = 0, leads30prevV = 0, leads30prevR = 0;
    // acumulador por asesor, en los últimos 90 días (ventana con volumen suficiente y aún accionable)
    type Ac = { name: string; leads: number; resp: number; fueraSla: number; mins: number[];
        visitas: number; cierres: number; comision: number; busquedas: number; clientes: number; props: number };
    const ases = new Map<string, Ac>();
    const accA = (name: string | null): Ac | null => {
        if (!name) return null;
        const k = normName(name);
        let e = ases.get(k);
        if (!e) { e = { name, leads: 0, resp: 0, fueraSla: 0, mins: [], visitas: 0, cierres: 0, comision: 0, busquedas: 0, clientes: 0, props: 0 }; ases.set(k, e); }
        return e;
    };
    for (const [, n] of internos) accA(n);          // todo asesor con inventario aparece
    for (const l of leadDocs) {
        const pid = String(dig(l, 'property', '_id'));
        leadsMap.set(pid, (leadsMap.get(pid) ?? 0) + 1);
        const lop = pidOp.get(pid);
        const ca = dig(l, 'createdAt'), aa = dig(l, 'answeredAt');
        const mins = ca instanceof Date && aa instanceof Date ? Math.max(0, (aa.getTime() - ca.getTime()) / 60000) : null;
        const b = respBucket(mins);
        resp[b]++; if (lop === 'sale') respV[b]++; else if (lop === 'rent') respR[b]++;
        if (aa instanceof Date) ansMap.set(pid, (ansMap.get(pid) ?? 0) + 1);
        if (mins != null) { pushMap(respByProp, pid, mins); allResp.push(mins); }
        if (ca instanceof Date) {
            if (ca >= D30) { leads30++; if (lop === 'sale') leads30V++; else if (lop === 'rent') leads30R++; }
            else if (ca >= D60) { leads30prev++; if (lop === 'sale') leads30prevV++; else if (lop === 'rent') leads30prevR++; }
        }
    }

    // --- por asesor (90d) sobre TODO el inventario de la inmobiliaria, no solo lo publicado ---
    for (const l of await db.collection('leads').find(
        { 'property._id': { $in: allIds }, createdAt: { $gte: D90 } },
        { projection: { 'property._id': 1, createdAt: 1, answeredAt: 1, agent: 1 } }
    ).toArray()) {
        const pid = String(dig(l, 'property', '_id'));
        const ca = dig(l, 'createdAt'), aa = dig(l, 'answeredAt');
        if (!(ca instanceof Date)) continue;
        // el responsable de atenderlo; si ese es de otra inmobiliaria, el dueño del inventario
        const la = dig(l, 'agent') as Document | undefined;
        const usable = la && internos.has(String(dig(la, '_id'))) ? la : allAgent.get(pid);
        const e = accA(agName(usable));
        if (!e) continue;
        e.leads++;
        if (aa instanceof Date) {
            const mins = Math.max(0, (aa.getTime() - ca.getTime()) / 60000);
            e.resp++; e.mins.push(mins);
            if (mins > 1440) e.fueraSla++;
        } else e.fueraSla++;   // nunca respondido: peor que respondido tarde
    }

    // --- desempeño por propiedad ---
    const visRows = await db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed' } },
        { $unwind: '$steps' }, { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
        { $group: { _id: '$_id.p', n: { $sum: 1 } } }
    ]).toArray();
    const visMap = new Map(visRows.map((r) => [String(r._id), r.n as number]));
    // elementos de la ficha por propiedad. Se cuentan con $size en el servidor: traer `pictures`
    // completo (url + descripción de cada foto) sería carísimo y solo necesitamos el número.
    const fichaRows = await db.collection('properties').aggregate([
        { $match: { 'company._id': cid, 'status.last': 'published' } },
        { $project: {
            fotos: { $size: { $ifNull: ['$pictures', []] } },
            video: { $gt: [{ $size: { $ifNull: ['$videos', []] } }, 0] },
            tour: { $in: [{ $type: '$virtualTour' }, ['string', 'object']] },
            amen: { $size: { $ifNull: ['$services', []] } },
        } },
    ]).toArray();
    const fichaMap = new Map(fichaRows.map((r) => [String(r._id), r]));
    // visitas y cierres por ASESOR en los últimos 90 días (para las flags del overview)
    const visAgRows = await db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: allIds }, 'status.last': 'confirmed', createdAt: { $gte: D90 } } },
        { $group: { _id: '$agent._id', n: { $sum: 1 } } },
    ]).toArray();
    for (const r of visAgRows) {
        const n = internos.get(String(r._id));
        const e = n ? accA(n) : null;
        if (e) e.visitas += r.n as number;
    }
    // búsquedas abiertas en 90d y propiedades compartidas por cliente (mide trabajo, no suerte)
    const busqRows = await db.collection('searches').aggregate([
        { $match: { 'company._id': cid, createdAt: { $gte: D90 } } },
        { $group: { _id: '$agent._id', busq: { $sum: 1 },
            props: { $sum: { $size: { $ifNull: ['$properties', []] } } },
            clientes: { $addToSet: '$contact._id' } } },
    ], { allowDiskUse: true }).toArray();
    for (const r of busqRows) {
        const n = internos.get(String(r._id));
        const e = n ? accA(n) : null;
        if (!e) continue;
        e.busquedas += r.busq as number;
        e.props += r.props as number;
        e.clientes += ((r.clientes as unknown[]) || []).filter(Boolean).length;
    }
    const viewMap = await countBy('metrics', 'property', { property: { $in: ids }, type: 'view' });
    const ofMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: [...ADVANCED] } });
    const cloMap = await countBy('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': 'closed' });

    // --- mercado por zona ---
    // demanda partida por operación: a cada propiedad se le asigna la demanda de SU operación (venta/renta).
    const demandSale = new Map<string, number>(), demandRent = new Map<string, number>();
    if (nbids.length) {
        const dr = await db.collection('searches').aggregate([
            { $match: { 'filters.addresses.id': { $in: nbids }, createdAt: { $gte: D90 } } },
            { $unwind: '$filters.addresses' }, { $match: { 'filters.addresses.id': { $in: nbids } } },
            { $group: { _id: '$filters.addresses.id',
                sale: { $sum: { $cond: [{ $eq: ['$filters.operation', 'sale'] }, 1, 0] } },
                rent: { $sum: { $cond: [{ $eq: ['$filters.operation', 'rent'] }, 1, 0] } } } }
        ], { allowDiskUse: true }).toArray();
        for (const r of dr) { demandSale.set(String(r._id), r.sale as number); demandRent.set(String(r._id), r.rent as number); }
    }
    // Oferta = MLS completo (todas las fuentes) + red Pulppo. La guarda de extremos (comparables.ts)
    // neutraliza la basura de portales; los comparables se filtran por tipo/tamaño/recámaras.
    const offByNb = new Map<string, PoolItem[]>(), offByCi = new Map<string, PoolItem[]>();
    if (nbids.length) {
        for (const coll of ['mls', 'properties']) {
            const cur = db.collection(coll).find(
                { 'address.neighborhood.id': { $in: nbids }, 'status.last': 'published', 'listing.operation': 'sale', 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } },
                { projection: { type: 1, 'address.neighborhood.id': 1, 'address.city.id': 1, 'listing.value': 1, 'attributes.totalSurface': 1, 'attributes.suites': 1 } }
            );
            for await (const p of cur) {
                const v = num(dig(p, 'listing', 'value')), s = num(dig(p, 'attributes', 'totalSurface'));
                if (!v || !s || s <= 0) continue;
                const it: PoolItem = { id: String(p._id), nb: (dig(p, 'address', 'neighborhood', 'id') as string) ?? null, ci: (dig(p, 'address', 'city', 'id') as string) ?? null, type: (p.type as string) ?? '—', surf: s, suites: num(dig(p, 'attributes', 'suites')), ppm: v / s };
                idxPool(offByNb, offByCi, it);
            }
        }
    }
    const cloByNb = new Map<string, PoolItem[]>(), cloByCi = new Map<string, PoolItem[]>();
    const ops = await db.collection('operations').find(
        { 'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: D24 }, 'property.listing.operation': 'sale' },
        { projection: { 'property._id': 1, 'closeValue.value': 1 } }
    ).toArray();
    const opVal = new Map<string, number>();
    for (const o of ops) { const pid = dig(o, 'property', '_id'); const v = num(dig(o, 'closeValue', 'value')); if (pid && v) opVal.set(String(pid), v); }
    if (opVal.size) {
        const opProps = await db.collection('properties').find(
            { _id: { $in: [...opVal.keys()].map((h) => new ObjectId(h)) } },
            { projection: { type: 1, 'address.neighborhood.id': 1, 'address.city.id': 1, 'attributes.totalSurface': 1, 'attributes.suites': 1 } }
        ).toArray();
        for (const p of opProps) {
            const s = num(dig(p, 'attributes', 'totalSurface')); const v = opVal.get(String(p._id));
            if (!s || s <= 0 || !v) continue;
            const it: PoolItem = { id: String(p._id), nb: (dig(p, 'address', 'neighborhood', 'id') as string) ?? null, ci: (dig(p, 'address', 'city', 'id') as string) ?? null, type: (p.type as string) ?? '—', surf: s, suites: num(dig(p, 'attributes', 'suites')), ppm: v / s };
            idxPool(cloByNb, cloByCi, it);
        }
    }
    const benchAltaPct = await communityAltaPct(db);

    // comisión y cierres por asesor (90d) para las flags
    const closeAg = await db.collection('operations').find(
        { 'property._id': { $in: allIds }, 'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: D90 } },
        { projection: { 'property._id': 1, 'comission.value': 1, 'seller.broker': 1, 'buyer.broker': 1 } }
    ).toArray();
    for (const o of closeAg) {
        const cands = [dig(o, 'seller', 'broker'), dig(o, 'buyer', 'broker')] as (Document | undefined)[];
        const dentro = cands.find((c) => c && internos.has(String(dig(c, '_id'))));
        const e = accA(agName(dentro ?? allAgent.get(String(dig(o, 'property', '_id')))));
        if (e) { e.cierres++; e.comision += num(dig(o, 'comission', 'value')) ?? 0; }
    }

    const now = Date.now();
    let nVenta = 0, nRenta = 0, captaciones90 = 0, tVistas = 0, tLeads = 0, tResp = 0, tVisitas = 0, tOfertas = 0, tCierres = 0, sinLeads = 0, nAlta = 0, nAltaV = 0, nAltaR = 0;
    // calidad y huecos, contados en total y por operación
    const mkCal = (): PorOpCal => ({ alta: 0, media: 0, baja: 0, total: 0 });
    const mkFal = (): PorOpFalta => ({ video: 0, fotos: 0, amenidades: 0, tour: 0, acm: 0, total: 0 });
    const cal = mkCal(), calV = mkCal(), calR = mkCal();
    const falta = mkFal(), faltaV = mkFal(), faltaR = mkFal();
    const errCount: Record<string, number> = {};
    const rows: MBProp[] = props.map((p) => {
        const hex = String(p._id);
        const op = dig(p, 'listing', 'operation') as string;
        const val = num(dig(p, 'listing', 'value'));
        const acm = num(dig(p, 'acm', 'price', 'value'));
        const surf = num(dig(p, 'attributes', 'totalSurface'));
        const nb = (dig(p, 'address', 'neighborhood', 'id') as string) ?? null, ci = (dig(p, 'address', 'city', 'id') as string) ?? null;
        const sp = val && acm ? val / acm : null;
        const ppm = val && surf && surf > 0 && op === 'sale' ? val / surf : null;
        const subj: Subj = { id: hex, nb, ci, type: (p.type as string) ?? '—', surf, suites: num(dig(p, 'attributes', 'suites')) };
        const offR = op === 'sale' ? refComps(offByNb, offByCi, subj) : { med: null, n: 0 };
        const cloR = op === 'sale' ? refComps(cloByNb, cloByCi, subj) : { med: null, n: 0 };
        const vsOferta = ppm && offR.med ? (ppm / offR.med - 1) * 100 : null;
        const pub = firstPublished(p);
        const dias = pub ? Math.max(0, Math.round((now - pub.getTime()) / 864e5)) : null;
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
        if (calidad === 'Alta') { nAlta++; if (op === 'sale') nAltaV++; else if (op === 'rent') nAltaR++; }
        const calle = (dig(p, 'address', 'street') as string)?.trim() || (dig(p, 'address', 'neighborhood', 'name') as string) || '—';
        const respondidos = ansMap.get(hex) ?? 0;
        const fi = fichaMap.get(hex);
        const fotos = (fi?.fotos as number) ?? 0, video = !!fi?.video, tour = !!fi?.tour, amenidades = (fi?.amen as number) ?? 0;
        tVistas += vistas; tLeads += leads; tResp += respondidos; tVisitas += vis; tOfertas += ofertas; tCierres += cierres;
        if (leads === 0) sinLeads++;
        const cs = op === 'sale' ? [cal, calV] : op === 'rent' ? [cal, calR] : [cal];
        const fs = op === 'sale' ? [falta, faltaV] : op === 'rent' ? [falta, faltaR] : [falta];
        for (const c of cs) { c.total++; if (calidad === 'Alta') c.alta++; else if (calidad === 'Baja') c.baja++; else c.media++; }
        // qué le falta a la ficha. El video es EL factor que separa Media de Alta en toda la red;
        // el tour se cuenta solo como referencia porque NO mueve la calificación.
        for (const fa of fs) {
            fa.total++;
            if (!video) fa.video++;
            if (fotos < 8) fa.fotos++;
            if (!amenidades) fa.amenidades++;
            if (!tour) fa.tour++;
            if (!acm) fa.acm++;
        }
        const errores = erroresDe(op, val, surf, num(dig(p, 'attributes', 'suites')), fotos);
        for (const er of errores) errCount[er] = (errCount[er] || 0) + 1;
        return {
            id: hex, code: (p.internalId as string) ?? hex, type: (p.type as string) ?? '—',
            op: op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : '—',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? '—', calle, asesor,
            precio: val, estado: estadoPrecio(sp), demanda, vsOferta,
            vsCierres: ppm && cloR.med ? (ppm / cloR.med - 1) * 100 : null,
            compite: op === 'sale' ? (offR.n || null) : null,
            calidad, dias, mesesPub: dias != null ? dias / 30 : null,
            vistas, leads, respondidos, visitas: vis, ofertas, cierres,
            respMedMin: median(respByProp.get(hex) ?? []),
            oppScore: op === 'sale' ? Math.round(demanda / (1 + leads)) : 0, diag,
            tier: TIER[dig(p, 'portals', 'inmuebles24', 'type') as string] ?? 'Simple',
            fotos, video, tour, amenidades, errores
        };
    });
    rows.sort((a, b) => b.leads - a.leads || b.vistas - a.vistas);

    // --- zonas: se agrega desde las propias propiedades (ya traen vsOferta/vsCierres/demanda) ---
    const byNb = new Map<string, MBProp[]>();
    for (const r of rows) if (r.colonia && r.colonia !== '—') { const a = byNb.get(r.colonia) ?? []; a.push(r); byNb.set(r.colonia, a); }
    const nbidOf = new Map<string, string>();
    for (const p of props) {
        const nm = dig(p, 'address', 'neighborhood', 'name') as string, id = dig(p, 'address', 'neighborhood', 'id') as string;
        if (nm && id && !nbidOf.has(nm)) nbidOf.set(nm, id);
    }
    const zonas: MBZona[] = [...byNb.entries()]
        .sort((a, b) => b[1].length - a[1].length).slice(0, 8)
        .map(([nb, ps]) => {
            const nbid = nbidOf.get(nb);
            const vo = median(ps.map((x) => x.vsOferta).filter((x): x is number => x != null));
            const vc = median(ps.map((x) => x.vsCierres).filter((x): x is number => x != null));
            return {
                nb, n: ps.length,
                leads: ps.reduce((a, x) => a + x.leads, 0),
                demanda: Math.max(...ps.map((x) => x.demanda), 0),
                oferta: nbid ? (offByNb.get(nbid)?.length ?? 0) : 0,
                vsOferta: vo == null ? null : Math.round(vo),
                vsCierres: vc == null ? null : Math.round(vc),
            };
        });

    // --- asesores + flags (últimos 90 días). Umbrales acordados con Ale, con mínimo de volumen
    //     para no señalar a alguien por 3 leads. ---
    const MIN_LEADS = 10, MIN_BUSQ = 5;
    const asesores: MBAsesor[] = [...ases.values()].map((e) => {
        const med = median(e.mins);
        const pxc = e.clientes ? e.props / e.clientes : null;
        const green: string[] = [], red: string[] = [];
        if (e.leads >= MIN_LEADS) {
            if (e.fueraSla / e.leads >= 0.25) red.push(`${Math.round((100 * e.fueraSla) / e.leads)}% de sus leads fuera de 24 h`);
            const sin = e.leads - e.resp;
            if (sin / e.leads >= 0.15) red.push(`abandona ${Math.round((100 * sin) / e.leads)}% de sus leads`);
            if (e.visitas / e.leads < 0.07 && e.leads >= 20) red.push('casi no convierte a visita');
            if (med != null && med <= 15 && sin === 0) green.push('responde en minutos y no abandona');
            if (e.visitas / e.leads >= 0.14) green.push(`${Math.round((100 * e.visitas) / e.leads)}% de sus leads llega a visita`);
        }
        if (e.busquedas >= MIN_BUSQ && pxc != null) {
            if (pxc <= 1.2) red.push(`comparte solo ${pxc.toFixed(1)} propiedades por cliente`);
            if (pxc >= 3) green.push(`comparte ${pxc.toFixed(1)} propiedades por cliente`);
        }
        if (e.cierres >= 1) green.push(`${e.cierres} ${e.cierres === 1 ? 'cierre' : 'cierres'} en 90 días`);
        return { name: e.name, leads: e.leads, respondidos: e.resp, fueraSla: e.fueraSla, respMedMin: med,
            visitas: e.visitas, cierres: e.cierres, comision: e.comision, busquedas: e.busquedas,
            clientes: e.clientes, propsCompartidas: e.props, green, red };
    }).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, 'es'));

    return {
        companyId: String(cid), name, nProps: props.length, nVenta, nRenta, captaciones90,
        vistas: tVistas, leads: tLeads, respondidos: tResp, visitas: tVisitas, ofertas: tOfertas, cierres: tCierres, sinLeads,
        leads30, leads30prev, resp, respMedMin: median(allResp),
        calAltaPct: props.length ? Math.round((100 * nAlta) / props.length) : 0, benchAltaPct, props: rows,
        calAltaVenta: nVenta ? Math.round((100 * nAltaV) / nVenta) : 0, calAltaRenta: nRenta ? Math.round((100 * nAltaR) / nRenta) : 0,
        leads30V, leads30R, leads30prevV, leads30prevR, respV, respR,
        calidad: cal, calidadVenta: calV, calidadRenta: calR,
        falta, faltaVenta: faltaV, faltaRenta: faltaR,
        errores: Object.entries(errCount).map(([tipo, n]) => ({ tipo, n, nota: ERROR_NOTA[tipo] ?? '' })).sort((a, b) => b.n - a.n),
        nErrores: rows.filter((r) => r.errores.length).length,
        zonas, demandaLabel: DEMANDA_LABEL, asesores
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
