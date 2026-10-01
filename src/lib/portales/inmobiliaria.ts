// Desempeño por INMOBILIARIA: leads y funnel comercial por fuente, por asesor, descartados,
// leads fantasma y cierres — filtrable por inmobiliaria, asesor, venta/renta y periodo, con
// comparación contra el periodo anterior o contra el mismo periodo del año pasado.
//
// Mismas reglas que el resto de /portales (FUNDAMENTOS §2), para que los números cuadren:
//   · FUNNEL = COHORTE ESTRICTA (decisión de Ale, 1-oct-2026). Leads que ENTRARON en el periodo
//     → su visita, oferta y cierre, contando sólo lo que pasó DESPUÉS del lead. Los últimos ~3
//     meses salen bajos en cierre por construcción (el ciclo de venta va de 43 a 144 días).
//     Con una inmobiliaria elegida, la visita/oferta/cierre tiene que ser con ESA inmobiliaria:
//     si el comprador terminó comprando con otra, no es su funnel.
//   · CIERRES = ACTIVIDAD del periodo (closedAt en el rango), de AMBOS lados: donde la
//     inmobiliaria vende la propiedad y donde trae al comprador, con el lado marcado. La fuente
//     es `buyer.source`, igual que el scorecard.
//   · DESCARTE = `searches.status.reasonToFinish` del lead (ver calidad.ts). Madura: un lead de
//     esta semana todavía no ha tenido tiempo de cancelarse.
//   · FANTASMA = lead sin conversación real: su `interaction` sólo trae el evento del portal
//     ("Vio teléfono", "Contactó por WhatsApp") y ni una llamada. La mayoría NO muere: el
//     comprador abre WhatsApp y esa conversación entra por otro lado. "Muere de verdad" = ni
//     siquiera eso, en una ventana de −1/+14 días sobre las conversaciones del mismo contacto.
//     (Medido 1-oct-2026, i24+ML agosto: 83% sin conversación, 59% rescatado, 34% muere.)
//     La regla se evalúa EN MONGO ($regexMatch) y sólo viaja el resultado: bajar los mensajes
//     completos era el 70% del tiempo de la vista.
//   · Excluye Habi y cuentas de prueba siempre.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { CANALES, KEY2NAME, NOT, NOTP, classifySource, dig, isDate, num, oid } from './metrics';
import { RLBL } from './calidad';
import { ALIAS_IDS, ALIAS_INMO, ORDEN_INMOBILIARIAS, SIN_CUENTA, normInmo } from './ordenInmobiliarias';
import type { Operacion } from './view';

const DIA = 86400000;
const MX_MS = 6 * 3600 * 1000;
const OFERTA = ['offer', 'offer_blocked', 'contract', 'paying', 'closed'];
const CIERRE = ['closed', 'paying'];
// El evento del portal se guarda como si fuera un mensaje del cliente: no es conversación.
const PLACEHOLDER = /^(vio (el )?tel[eé]fono|ver tel[eé]fono|vio el anuncio|contact[oó] por whats?app)$/i;

export type Comparar = 'ninguno' | 'anterior' | 'anio';
export interface FiltroInmo {
    /** nombre canónico de la inmobiliaria; null = todas (vista general) */
    inmobiliaria: string | null;
    asesorId: string | null;
    operacion: Operacion;
    /** YYYY-MM-DD, `hasta` inclusivo */
    desde: string; hasta: string;
    comparar: Comparar;
}

export interface Fila {
    key: string; nombre: string;
    leads: number; unicos: number; venta: number; renta: number;
    /** % contestado en <60 min, sólo leads que entraron en horario laboral (9–20 h MX) */
    pctLt60: number | null; pctSinResp: number | null;
    /** mediana de minutos a la primera respuesta, horario laboral */
    respMed: number | null;
    visitas: number; ofertas: number; cierres: number;
    pVisita: number | null; pOferta: number | null; pCierre: number | null;
    /** sobre leads: sin conversación real / de esos, rescatados en otra conversación / mueren */
    fantasmas: number; rescatados: number; mueren: number;
    pctFantasma: number | null; pctMueren: number | null;
    descartados: number; pctDescartado: number | null;
    /** fuente que más leads trae (sólo en filas de asesor / inmobiliaria) */
    topFuente?: string;
    nota?: string;
}
export interface Cierre {
    fecha: string; id: string; codigo: string | null; operacion: string; tipo: string | null;
    colonia: string | null; valor: number; comision: number;
    fuente: string; lado: 'vendedor' | 'comprador' | 'ambos'; asesor: string;
    /** la fuente no venía en la operación: se dedujo del primer lead del comprador */
    inferida?: boolean;
}
export interface Bloque {
    desde: string; hasta: string; etiqueta: string; dias: number;
    total: Fila;
    fuentes: Fila[];
    asesores: Fila[];
    /** sólo en la vista general (sin inmobiliaria), en el orden canónico de las 102 */
    inmobiliarias: Fila[];
    descarte: {
        total: number;
        familias: Array<{ key: string; label: string; n: number; pct: number }>;
        motivos: Array<{ motivo: string; n: number; pct: number }>;
    };
    cierres: {
        n: number; venta: number; renta: number; valor: number; comision: number;
        porFuente: Array<{ fuente: string; n: number; venta: number; renta: number; comision: number; inferidas: number }>;
        /** cuántos cierres venían sin fuente (`other`) y cuántos quedaron sin poder atribuir */
        sinFuenteOriginal: number; sinAtribuir: number;
        lista: Cierre[];
    };
}
export interface InmoView {
    filtro: FiltroInmo;
    inmobiliaria: { nombre: string; kam: string | null; tier: string | null; cuentas: number } | null;
    actual: Bloque;
    comparado: Bloque | null;
    generado: string;
}

// Fuente del CIERRE (`buyer.source`). En 2026, 544 de 1,341 cierres (41%) vienen como `other`. No es
// un solo hueco — medido 1-oct-2026:
//   · 276 lado vendedor con el comprador de una inmobiliaria EXTERNA (fuera de Pulppo) → «Broker
//     externo». Ni siquiera hay contacto del comprador: no hay fuente que registrar.
//   · 31 lado vendedor con el comprador de OTRA inmobiliaria de la red → «Red Pulppo».
//   · ~82 con un lead previo del comprador → se INFIERE el canal de su primer lead antes del cierre
//     (marcado como inferido: es una aproximación, no lo que capturó el asesor).
//   · ~153 con contacto pero sin un solo lead antes del cierre → cliente de cartera, referido o
//     contacto directo del asesor: «Cartera / sin lead».
// Las fuentes chicas con nombre (Lonas, TuPortalOnline…) se muestran tal cual.
const FUENTE_RARA: Record<string, string> = {
    lonas: 'Lonas', tuportalonline: 'TuPortalOnline', contactodirecto: 'Contacto directo', referido: 'Referido',
    'doorvel.com': 'Doorvel', lamudi: 'Lamudi', brokerexternal: 'Broker externo',
};
const SIN_FUENTE = new Set(['other', '', 'none', 'null', 'undefined']);
export const F_BROKER_EXT = 'Broker externo', F_RED = 'Red Pulppo (otra inmobiliaria)', F_CARTERA = 'Cartera / sin lead', F_SIN = 'Sin registrar';
/** Fuente capturada, o null si vino vacía / `other` (entonces se deduce, ver arriba). */
const fuenteCapturada = (raw: unknown): string | null => {
    const t = String(raw ?? '').trim();
    if (SIN_FUENTE.has(t.toLowerCase())) return null;
    const k = classifySource(t);
    if (k !== 'otros') return KEY2NAME[k] ?? k;
    return FUENTE_RARA[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1);
};

// ── motivos de descarte (`searches.status.reasonToFinish`) ─────────
// Valores reales medidos 1-oct-2026 sobre 12 meses (391k cancelaciones): descartado 30% · asesor 26%
// · fantasma 13% · perdido 13% · SIN MOTIVO 8% · incontactable 5% · cancelado 4% · inesperado 1% ·
// Agent inactive / automatico (sistema) <1% · y restos con grafías distintas del mismo motivo.
// 'fantasma' aquí es lo que MARCÓ EL ASESOR — distinto del lead fantasma técnico (sin conversación).
const NO_ES_DESCARTE = new Set(['success', 'Ganada', 'still_interested', 'test']);
type FamDesc = 'noResponde' | 'incontactable' | 'broker' | 'perdido' | 'generico' | 'sistema';
const FAM_DESC: Record<string, FamDesc> = {
    fantasma: 'noResponde', stop_answering: 'noResponde', sent_to_ai: 'noResponde',
    incontactable: 'incontactable',
    asesor: 'broker',
    perdido: 'perdido', Perdido: 'perdido', lost: 'perdido', lost_interest: 'perdido', inesperado: 'perdido', operaton_with_other_broker: 'perdido',
    descartado: 'generico', cancelado: 'generico', '': 'generico',
    'Agent inactive': 'sistema', automatico: 'sistema', 'Cancelado de forma automática': 'sistema',
};
const FAM_ORDEN: FamDesc[] = ['noResponde', 'incontactable', 'broker', 'perdido', 'generico', 'sistema'];
const FAM_LBL: Record<FamDesc, string> = {
    noResponde: 'No responde (marcado por el asesor)', incontactable: 'Incontactable', broker: 'Era asesor/broker',
    perdido: 'Perdido / ya no le interesa', generico: 'Sin motivo específico', sistema: 'Cerrado por el sistema',
};
const MOTIVO_LBL: Record<string, string> = {
    '': 'Sin motivo', cancelado: 'Cancelado (sin detalle)', Perdido: 'Perdido', lost: 'Perdido',
    'Agent inactive': 'Asesor inactivo', automatico: 'Cancelado automático', 'Cancelado de forma automática': 'Cancelado automático',
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const p1 = (a: number, b: number) => (b ? r1((100 * a) / b) : null);
const mediana = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const v = [...xs].sort((a, b) => a - b), m = v.length >> 1;
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaDe = (a: Date, bIncl: Date) => {
    const f = (d: Date) => `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return `${f(a)} – ${f(bIncl)}`;
};

// ── inmobiliarias: lista canónica → ids de `companies` ────────────
// Una misma inmobiliaria puede estar PARTIDA en varias compañías con el mismo nombre (Talavera y
// Mercatecnia en 5, The Property Hub en 2). Se juntan todas: filtrar por una sola perdía leads.
export interface InmoOpcion { nombre: string; kam: string | null; tier: string | null; ids: string[]; enLista: boolean; nota?: string }
let opcionesCache: { at: number; data: InmoOpcion[] } | null = null;
export async function opcionesInmobiliarias(): Promise<InmoOpcion[]> {
    if (opcionesCache && Date.now() - opcionesCache.at < 3600_000) return opcionesCache.data;
    const db = await getDb();
    const porNombre = new Map<string, string[]>();
    for await (const c of db.collection('companies').find({}, { projection: { name: 1, email: 1 } })) {
        if (/tuhabi/i.test(String(c.email ?? ''))) continue;
        const k = normInmo(c.name);
        if (!k) continue;
        (porNombre.get(k) ?? porNombre.set(k, []).get(k)!).push(String(c._id));
    }
    const out: InmoOpcion[] = ORDEN_INMOBILIARIAS.map((x) => {
        const nombres = [x.nombre, ...(ALIAS_INMO[x.nombre] ?? [])];
        const ids = [...new Set([...nombres.flatMap((n) => porNombre.get(normInmo(n)) ?? []), ...(ALIAS_IDS[x.nombre] ?? [])])];
        return {
            nombre: x.nombre, kam: x.kam || null, tier: x.tier || null, ids, enLista: true,
            ...(ids.length ? {} : { nota: SIN_CUENTA.has(x.nombre) ? 'sin cuenta identificable en Pulppo' : 'sin cuenta en Pulppo' }),
        };
    });
    opcionesCache = { at: Date.now(), data: out };
    return out;
}

/** Asesores de una inmobiliaria (todas sus cuentas), activos primero. */
export async function asesoresDe(inmobiliaria: string): Promise<Array<{ id: string; nombre: string; activo: boolean }>> {
    const op = (await opcionesInmobiliarias()).find((x) => x.nombre === inmobiliaria);
    if (!op || !op.ids.length) return [];
    const db = await getDb();
    const ids = op.ids.map((s) => new ObjectId(s));
    const ags = await db.collection('agents').find(
        { 'company._id': { $in: ids } },
        { projection: { firstName: 1, lastName: 1, status: 1 } }).toArray();
    return ags.map((a) => ({
        id: String(a._id),
        nombre: [a.firstName, a.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || '(sin nombre)',
        activo: a.status === 'active',
    })).sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
}

// ── un periodo ─────────────────────────────────────────────────────
interface Celda {
    key: string; nombre: string;
    /** compañías con que TIENE que ser la visita/oferta/cierre (null = cualquiera) */
    req: Set<string> | null;
    leads: number; venta: number; renta: number; baseLab: number; lt60: number; sin: number; resp: number[];
    t0: Map<string, Date>; vis: Set<string>; ofe: Set<string>; clo: Set<string>;
    fant: number; resc: number; desc: number;
    fuentes: Map<string, number>;
}
const nuevaCelda = (key: string, nombre: string, req: Set<string> | null): Celda => ({
    key, nombre, req, leads: 0, venta: 0, renta: 0, baseLab: 0, lt60: 0, sin: 0, resp: [],
    t0: new Map(), vis: new Set(), ofe: new Set(), clo: new Set(), fant: 0, resc: 0, desc: 0, fuentes: new Map(),
});

async function bloque(
    A: Date, B: Date, f: FiltroInmo, op: InmoOpcion | null, todas: InmoOpcion[],
): Promise<Bloque> {
    const db = await getDb();
    const idsInmo = op ? op.ids.map((s) => new ObjectId(s)) : null;
    const reqInmo = op ? new Set(op.ids) : null;
    // compañía → nombre canónico (para la tabla general)
    const idANombre = new Map<string, InmoOpcion>();
    for (const o of todas) for (const id of o.ids) idANombre.set(id, o);

    const cells = new Map<string, Celda>();
    const cel = (key: string, nombre: string, req: Set<string> | null) =>
        cells.get(key) ?? cells.set(key, nuevaCelda(key, nombre, req)).get(key)!;
    const total = cel('total', 'Total', reqInmo);
    for (const [n, k] of CANALES) cel(`f:${k}`, n, reqInmo);
    cel('f:otros', 'Otras fuentes', reqInmo);

    // leads → celdas; se guardan para los joins de después
    type LeadRef = { id: ObjectId; cells: Celda[]; t: Date; cid: string | null; inter: ObjectId | null; search: string | null };
    const refs: LeadRef[] = [];
    const filtro: Document = {
        createdAt: { $gte: A, $lt: B }, ...NOT,
        ...(idsInmo ? { 'company._id': { $in: idsInmo } } : {}),
        ...(f.asesorId ? { 'agent._id': new ObjectId(f.asesorId) } : {}),
        ...(f.operacion === 'todas' ? {} : { 'property.listing.operation': f.operacion }),
    };
    const cur = db.collection('leads').find(filtro, {
        projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, 'property.listing.operation': 1,
            'company._id': 1, 'company.name': 1, 'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, interaction: 1, search: 1 },
        batchSize: 10000,
    });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const canal = classifySource(l.source as string);
        const mis: Celda[] = [total, cells.get(`f:${canal}`)!];
        if (op) {
            const aid = dig(l, 'agent', '_id');
            const an = [dig(l, 'agent', 'firstName'), dig(l, 'agent', 'lastName')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            mis.push(cel(`a:${aid ?? 'sin'}`, aid ? an || '(sin nombre)' : 'Sin asesor asignado', reqInmo));
        } else {
            const cid = String(dig(l, 'company', '_id') ?? '');
            const o = idANombre.get(cid);
            if (o) mis.push(cel(`i:${o.nombre}`, o.nombre, new Set(o.ids)));
            else {
                const nm = String(dig(l, 'company', 'name') ?? '').trim() || 'Sin inmobiliaria';
                mis.push(cel(`x:${normInmo(nm) || 'sin'}`, nm, cid ? new Set([cid]) : null));
            }
        }
        const oper = dig(l, 'property', 'listing', 'operation');
        const h = new Date(ca.getTime() - MX_MS).getUTCHours();
        const lab = h >= 9 && h <= 20;
        const ans = l.answeredAt;
        const mins = isDate(ans) ? (ans.getTime() - ca.getTime()) / 60000 : null;
        const cidRaw = dig(l, 'contact', '_id');
        const cid = cidRaw != null ? String(cidRaw) : null;
        for (const c of mis) {
            c.leads += 1;
            if (oper === 'sale') c.venta += 1; else if (oper === 'rent') c.renta += 1;
            if (lab) {
                c.baseLab += 1;
                if (mins == null) c.sin += 1;
                else { if (mins < 60) c.lt60 += 1; if (mins >= 0) c.resp.push(mins); }
            }
            if (cid) { const p = c.t0.get(cid); if (!p || ca < p) c.t0.set(cid, ca); }
            c.fuentes.set(canal, (c.fuentes.get(canal) ?? 0) + 1);
        }
        refs.push({
            id: l._id as ObjectId, cells: mis, t: ca, cid,
            inter: l.interaction instanceof ObjectId ? l.interaction : null,
            search: l.search ? String(l.search) : null,
        });
    }

    // índice contacto → (celda, primer lead) para los joins
    const porContacto = new Map<string, Array<{ c: Celda; t0: Date }>>();
    for (const c of cells.values())
        for (const [s, t0] of c.t0) (porContacto.get(s) ?? porContacto.set(s, []).get(s)!).push({ c, t0 });
    const oids = [...porContacto.keys()].map(oid).filter((o): o is ObjectId => !!o);
    const marca = (s: string, at: Date, comp: string | null, k: 'vis' | 'ofe' | 'clo') => {
        for (const { c, t0 } of porContacto.get(s) ?? []) {
            if (at < t0) continue;                                  // cohorte estricta
            if (c.req && (!comp || !c.req.has(comp))) continue;     // con ESA inmobiliaria
            c[k].add(s);
        }
    };

    const LOTE = 5000;
    const tareasJoin: Promise<void>[] = [];
    for (let i = 0; i < oids.length; i += LOTE) {
        const chunk = oids.slice(i, i + LOTE);
        tareasJoin.push((async () => {
            const cv = db.collection('visits').find(
                { 'contact._id': { $in: chunk }, 'status.last': { $ne: 'cancelled' } },
                { projection: { 'contact._id': 1, createdAt: 1, 'agent.company._id': 1 } });
            for await (const v of cv) {
                if (!isDate(v.createdAt)) continue;
                const comp = dig(v, 'agent', 'company', '_id');
                marca(String(dig(v, 'contact', '_id')), v.createdAt, comp != null ? String(comp) : null, 'vis');
            }
        })());
        tareasJoin.push((async () => {
            const co = db.collection('operations').find(
                { 'buyer.contact._id': { $in: chunk }, 'status.last': { $in: OFERTA } },
                { projection: { 'buyer.contact._id': 1, createdAt: 1, closedAt: 1, 'status.last': 1, 'buyer.company._id': 1 } });
            for await (const o of co) {
                const s = String(dig(o, 'buyer', 'contact', '_id'));
                const comp = dig(o, 'buyer', 'company', '_id');
                const cs = comp != null ? String(comp) : null;
                if (isDate(o.createdAt)) marca(s, o.createdAt, cs, 'ofe');
                if (CIERRE.includes(String(dig(o, 'status', 'last'))) && isDate(o.closedAt)) marca(s, o.closedAt, cs, 'clo');
            }
        })());
    }

    // ── fantasmas: la interacción del lead, por _id (indexado) ─────────
    // Se decide EN MONGO si hubo conversación real y sólo viaja el resultado: bajar los mensajes
    // completos para revisarlos aquí era el 70% del tiempo de la vista (12 de 18 s en un mes).
    const msgReal = (m: string) => ({ $and: [
        { $eq: [`${m}.from`, 'client'] },
        { $gt: [{ $strLenCP: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } } }, 0] },
        { $not: [{ $regexMatch: { input: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } }, regex: PLACEHOLDER.source, options: 'i' } }] },
    ] });
    const tareaFantasma = (async () => {
        const conInter = refs.filter((r) => r.inter);
        const real = new Set<string>();
        await Promise.all(Array.from({ length: Math.ceil(conInter.length / LOTE) }, async (_, j) => {
            const cur = db.collection('interactions').aggregate([
                { $match: { _id: { $in: conInter.slice(j * LOTE, (j + 1) * LOTE).map((r) => r.inter!) } } },
                { $project: { _id: 1, real: { $or: [
                    { $gt: [{ $size: { $ifNull: ['$calls', []] } }, 0] },
                    { $anyElementTrue: [{ $map: { input: { $ifNull: ['$messages', []] }, as: 'm', in: msgReal('$$m') } }] },
                ] } } },
                { $match: { real: true } },
            ]);
            for await (const it of cur) real.add(String(it._id));
        }));
        // Sin interacción también es fantasma: el registro no tiene conversación en absoluto.
        const fant = refs.filter((r) => !r.inter || !real.has(String(r.inter)));
        for (const r of fant) for (const c of r.cells) c.fant += 1;

        // Rescate: ¿ese contacto conversó de verdad en otra interacción, de −1 a +14 días?
        const vent = new Map<string, Date[]>();   // contacto → fechas de mensajes reales del cliente
        const cids = [...new Set(fant.map((r) => r.cid).filter((x): x is string => !!x))].map(oid).filter((o): o is ObjectId => !!o);
        const w0 = new Date(A.getTime() - DIA), w1 = new Date(B.getTime() + 14 * DIA);
        const propias = new Set(fant.map((r) => (r.inter ? String(r.inter) : '')).filter(Boolean));
        await Promise.all(Array.from({ length: Math.ceil(cids.length / 2000) }, async (_, j) => {
            const cur = db.collection('interactions').aggregate([
                { $match: { 'contact._id': { $in: cids.slice(j * 2000, (j + 1) * 2000) }, updatedAt: { $gte: w0 } } },
                { $project: {
                    contact: '$contact._id', createdAt: 1, ncalls: { $size: { $ifNull: ['$calls', []] } },
                    ds: { $map: { input: { $filter: { input: { $ifNull: ['$messages', []] }, as: 'm', cond: { $and: [
                        msgReal('$$m'), { $gte: ['$$m.createdAt', w0] }, { $lt: ['$$m.createdAt', w1] }] } } }, as: 'm', in: '$$m.createdAt' } },
                } },
                { $match: { $or: [{ 'ds.0': { $exists: true } }, { ncalls: { $gt: 0 } }] } },
            ], { allowDiskUse: true });
            for await (const it of cur) {
                if (propias.has(String(it._id))) continue;
                const ds = ((it.ds as unknown[]) ?? []).filter(isDate);
                if (!ds.length && num(it.ncalls) > 0 && isDate(it.createdAt)) ds.push(it.createdAt);
                if (!ds.length) continue;
                const k = String(it.contact);
                (vent.get(k) ?? vent.set(k, []).get(k)!).push(...ds);
            }
        }));
        for (const r of fant) {
            const ds = r.cid ? vent.get(r.cid) : undefined;
            const t = r.t.getTime();
            if (ds?.some((d) => d.getTime() >= t - DIA && d.getTime() <= t + 14 * DIA))
                for (const c of r.cells) c.resc += 1;
        }
    })();

    // ── descartados: la búsqueda del lead terminó cancelada ─────────────
    // TODAS las cancelaciones, no sólo las que traen motivo: 7.6% viene sin motivo (null) y antes
    // quedaba fuera del conteo. Se excluyen las que no son descarte (`success`/`Ganada` = terminó
    // bien) y las cancelaciones del sistema van en su propia familia.
    const motivosTot = new Map<string, number>();
    const tareaDescarte = (async () => {
        const porSearch = new Map<string, LeadRef[]>();
        for (const r of refs) if (r.search) (porSearch.get(r.search) ?? porSearch.set(r.search, []).get(r.search)!).push(r);
        const ids = [...porSearch.keys()].map(oid).filter((o): o is ObjectId => !!o);
        for (let i = 0; i < ids.length; i += 5000) {
            const cs = db.collection('searches').find(
                { _id: { $in: ids.slice(i, i + 5000) }, 'status.last': 'cancelled' },
                { projection: { 'status.reasonToFinish': 1 } });
            for await (const s of cs) {
                const motivo = String(dig(s, 'status', 'reasonToFinish') ?? '').trim();
                if (NO_ES_DESCARTE.has(motivo)) continue;
                for (const r of porSearch.get(String(s._id)) ?? []) {
                    for (const c of r.cells) c.desc += 1;
                    motivosTot.set(motivo, (motivosTot.get(motivo) ?? 0) + 1);
                }
            }
        }
    })();

    // ── cierres del periodo (actividad), ambos lados ──────────────────
    const tareaCierres = (async () => {
        const lado: Document[] = [];
        if (idsInmo) lado.push({ 'seller.company._id': { $in: idsInmo } }, { 'buyer.company._id': { $in: idsInmo } });
        const asesor = f.asesorId ? new ObjectId(f.asesorId) : null;
        const q: Document = {
            'status.last': { $in: CIERRE }, closedAt: { $gte: A, $lt: B }, ...NOTP,
            ...(lado.length ? { $or: lado } : {}),
            ...(f.operacion === 'todas' ? {} : { 'property.listing.operation': f.operacion }),
        };
        const ops = await db.collection('operations').find(q, { projection: {
            id: 1, closedAt: 1, 'property.internalId': 1, 'property.listing.operation': 1, 'property.type': 1,
            'property.address.neighborhood.name': 1, 'closeValue.value': 1, 'comission.value': 1, 'buyer.source': 1,
            'seller.company._id': 1, 'buyer.company._id': 1, 'buyer.company.external': 1, 'buyer.contact._id': 1, 'property._id': 1,
            'seller.broker._id': 1, 'seller.broker.firstName': 1, 'seller.broker.lastName': 1,
            'buyer.broker._id': 1, 'buyer.broker.firstName': 1, 'buyer.broker.lastName': 1,
        } }).sort({ closedAt: -1 }).toArray();
        const nombre = (o: Document, k: 'seller' | 'buyer') =>
            [dig(o, k, 'broker', 'firstName'), dig(o, k, 'broker', 'lastName')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        // Para los que vienen sin fuente y sí traen contacto: el primer lead de ese comprador antes del
        // cierre (de la misma propiedad si lo hay). Una consulta por lotes, indexada por contact._id.
        const porDeducir = ops.filter((o) => !fuenteCapturada(dig(o, 'buyer', 'source')) && dig(o, 'buyer', 'contact', '_id'));
        const leadsDe = new Map<string, Array<{ t: Date; src: string; pid: string }>>();
        const cidsB = [...new Set(porDeducir.map((o) => String(dig(o, 'buyer', 'contact', '_id'))))].map(oid).filter((x): x is ObjectId => !!x);
        for (let i = 0; i < cidsB.length; i += 3000) {
            for await (const l of db.collection('leads').find({ 'contact._id': { $in: cidsB.slice(i, i + 3000) } },
                { projection: { 'contact._id': 1, source: 1, createdAt: 1, 'property._id': 1 } })) {
                if (!isDate(l.createdAt)) continue;
                const k = String(dig(l, 'contact', '_id'));
                (leadsDe.get(k) ?? leadsDe.set(k, []).get(k)!).push({ t: l.createdAt, src: String(l.source ?? ''), pid: String(dig(l, 'property', '_id') ?? '') });
            }
        }
        const deducir = (o: Document): { fuente: string; inferida?: boolean } => {
            const sc = String(dig(o, 'seller', 'company', '_id') ?? ''), bc = String(dig(o, 'buyer', 'company', '_id') ?? '');
            const cid = dig(o, 'buyer', 'contact', '_id');
            if (cid) {
                const cl = o.closedAt as Date, pid = String(dig(o, 'property', '_id') ?? '');
                const previos = (leadsDe.get(String(cid)) ?? []).filter((l) => l.t <= cl);
                const misma = previos.filter((l) => l.pid === pid);
                const primero = (misma.length ? misma : previos).sort((a, b) => a.t.getTime() - b.t.getTime())[0];
                if (primero) return { fuente: fuenteCapturada(primero.src) ?? F_SIN, inferida: true };
            }
            if (bc && bc !== sc) return { fuente: dig(o, 'buyer', 'company', 'external') === true ? F_BROKER_EXT : F_RED };
            return { fuente: cid ? F_CARTERA : F_SIN };
        };
        const out: Cierre[] = [];
        let sinFuenteOrig = 0;
        for (const o of ops) {
            const sc = String(dig(o, 'seller', 'company', '_id') ?? ''), bc = String(dig(o, 'buyer', 'company', '_id') ?? '');
            const vende = reqInmo ? reqInmo.has(sc) : true, compra = reqInmo ? reqInmo.has(bc) : true;
            let ladoX: Cierre['lado'] = vende && compra ? 'ambos' : vende ? 'vendedor' : 'comprador';
            if (!reqInmo) ladoX = sc && sc === bc ? 'ambos' : 'vendedor';
            const sb = String(dig(o, 'seller', 'broker', '_id') ?? ''), bb = String(dig(o, 'buyer', 'broker', '_id') ?? '');
            if (asesor) {
                const a = String(asesor);
                const deEl = (vende && sb === a) || (compra && bb === a);
                if (!deEl) continue;
            }
            const nombres = [...new Set([
                ...(vende || !reqInmo ? [nombre(o, 'seller')] : []),
                ...(compra && reqInmo ? [nombre(o, 'buyer')] : []),
            ].filter(Boolean))];
            const opx = String(dig(o, 'property', 'listing', 'operation') ?? '');
            out.push({
                fecha: ymd(o.closedAt as Date), id: String(o.id ?? o._id), codigo: (dig(o, 'property', 'internalId') as string) ?? null,
                operacion: opx === 'sale' ? 'Venta' : opx === 'rent' ? 'Renta' : opx || '—',
                tipo: (dig(o, 'property', 'type') as string) ?? null,
                colonia: (dig(o, 'property', 'address', 'neighborhood', 'name') as string) ?? null,
                valor: num(dig(o, 'closeValue', 'value')), comision: num(dig(o, 'comission', 'value')),
                ...(() => { const fc = fuenteCapturada(dig(o, 'buyer', 'source')); return fc ? { fuente: fc } : deducir(o); })(),
                lado: ladoX, asesor: nombres.join(' / ') || '—',
            });
            if (!fuenteCapturada(dig(o, 'buyer', 'source'))) sinFuenteOrig += 1;
        }
        return { out, sinFuenteOrig };
    })();

    const [, , , cierresRes] = await Promise.all([Promise.all(tareasJoin), tareaFantasma, tareaDescarte, tareaCierres]);
    const lista = cierresRes.out;

    const fila = (c: Celda): Fila => {
        const u = c.t0.size;
        const top = [...c.fuentes.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
            key: c.key, nombre: c.nombre,
            leads: c.leads, unicos: u, venta: c.venta, renta: c.renta,
            pctLt60: p1(c.lt60, c.baseLab), pctSinResp: p1(c.sin, c.baseLab), respMed: mediana(c.resp.map((x) => Math.round(x))),
            visitas: c.vis.size, ofertas: c.ofe.size, cierres: c.clo.size,
            pVisita: p1(c.vis.size, u), pOferta: p1(c.ofe.size, u), pCierre: p1(c.clo.size, u),
            fantasmas: c.fant, rescatados: c.resc, mueren: c.fant - c.resc,
            pctFantasma: p1(c.fant, c.leads), pctMueren: p1(c.fant - c.resc, c.leads),
            descartados: c.desc, pctDescartado: p1(c.desc, c.leads),
            ...(top ? { topFuente: KEY2NAME[top[0]] ?? 'Otras fuentes' } : {}),
        };
    };
    const celdas = [...cells.values()];
    const fuentes = celdas.filter((c) => c.key.startsWith('f:') && c.leads > 0).map(fila).sort((a, b) => b.leads - a.leads);
    const asesores = celdas.filter((c) => c.key.startsWith('a:')).map(fila).sort((a, b) => b.leads - a.leads);

    // Vista general: las 102 SIEMPRE completas y en su orden; las de fuera, al final con nota.
    let inmobiliarias: Fila[] = [];
    if (!op) {
        const vacia = (o: InmoOpcion): Fila => ({ ...fila(nuevaCelda(`i:${o.nombre}`, o.nombre, null)), ...(o.nota ? { nota: o.nota } : {}) });
        inmobiliarias = todas.map((o) => { const c = cells.get(`i:${o.nombre}`); return c ? fila(c) : vacia(o); });
        const fuera = celdas.filter((c) => c.key.startsWith('x:') && c.leads > 0).map((c) => ({ ...fila(c), nota: 'fuera de la lista de 102' }))
            .sort((a, b) => b.leads - a.leads);
        inmobiliarias.push(...fuera);
    }

    // composición del descarte
    const totDesc = [...motivosTot.values()].reduce((a, b) => a + b, 0);
    const fam = new Map<string, number>();
    for (const [m, n] of motivosTot) { const k = FAM_DESC[m] ?? 'perdido'; fam.set(k, (fam.get(k) ?? 0) + n); }

    const porFuente = new Map<string, { fuente: string; n: number; venta: number; renta: number; comision: number; inferidas: number }>();
    for (const x of lista) {
        const r = porFuente.get(x.fuente) ?? porFuente.set(x.fuente, { fuente: x.fuente, n: 0, venta: 0, renta: 0, comision: 0, inferidas: 0 }).get(x.fuente)!;
        r.n += 1; r.comision += x.comision; if (x.inferida) r.inferidas += 1;
        if (x.operacion === 'Venta') r.venta += 1; else if (x.operacion === 'Renta') r.renta += 1;
    }
    const bIncl = new Date(B.getTime() - DIA);
    return {
        desde: ymd(A), hasta: ymd(bIncl), etiqueta: etiquetaDe(A, bIncl), dias: Math.round((B.getTime() - A.getTime()) / DIA),
        total: fila(total), fuentes, asesores, inmobiliarias,
        descarte: {
            total: totDesc,
            familias: FAM_ORDEN.map((k) => ({ key: k, label: FAM_LBL[k], n: fam.get(k) ?? 0, pct: totDesc ? Math.round((100 * (fam.get(k) ?? 0)) / totDesc) : 0 })),
            // Todos los motivos, no un top: se agrupan las grafías del mismo motivo ('Perdido' y 'perdido').
            motivos: (() => {
                const m2 = new Map<string, number>();
                for (const [m, n] of motivosTot) { const l = MOTIVO_LBL[m] ?? RLBL[m] ?? (m ? m.replace(/_/g, ' ') : 'Sin motivo'); m2.set(l, (m2.get(l) ?? 0) + n); }
                return [...m2.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n, pct: totDesc ? Math.round((100 * n) / totDesc) : 0 }));
            })(),
        },
        cierres: {
            n: lista.length, venta: lista.filter((x) => x.operacion === 'Venta').length, renta: lista.filter((x) => x.operacion === 'Renta').length,
            valor: lista.reduce((a, x) => a + x.valor, 0), comision: lista.reduce((a, x) => a + x.comision, 0),
            porFuente: [...porFuente.values()].sort((a, b) => b.n - a.n),
            sinFuenteOriginal: cierresRes.sinFuenteOrig, sinAtribuir: lista.filter((x) => x.fuente === F_SIN).length,
            lista: lista.slice(0, 60),
        },
    };
}

/** Ventana [A, B) del periodo y, si se pide, la del periodo con que se compara. */
export function ventanas(f: FiltroInmo): { A: Date; B: Date; cA: Date | null; cB: Date | null } {
    const A = parseYmd(f.desde), B = new Date(parseYmd(f.hasta).getTime() + DIA);
    if (!(B > A)) throw new Error('el rango termina antes de empezar');
    if ((B.getTime() - A.getTime()) / DIA > 400) throw new Error('rango máximo de 400 días');
    if (f.comparar === 'anterior') {
        // Meses completos (un mes, un trimestre, ene–sep) → los N meses de calendario anteriores:
        // septiembre se compara contra agosto completo, no contra "los 30 días previos" (2–31 ago).
        const mesesCompletos = A.getUTCDate() === 1 && B.getUTCDate() === 1;
        if (mesesCompletos) {
            const n = (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth());
            return { A, B, cA: new Date(Date.UTC(A.getUTCFullYear(), A.getUTCMonth() - n, 1)), cB: A };
        }
        const len = B.getTime() - A.getTime();
        return { A, B, cA: new Date(A.getTime() - len), cB: A };
    }
    if (f.comparar === 'anio') {
        const menos1 = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
        return { A, B, cA: menos1(A), cB: menos1(B) };
    }
    return { A, B, cA: null, cB: null };
}

export async function inmobiliariaView(f: FiltroInmo, now = Date.now()): Promise<InmoView> {
    const todas = await opcionesInmobiliarias();
    const op = f.inmobiliaria ? todas.find((x) => x.nombre === f.inmobiliaria) ?? null : null;
    if (f.inmobiliaria && !op) throw new Error(`inmobiliaria no encontrada: ${f.inmobiliaria}`);
    if (op && !op.ids.length) throw new Error(`${op.nombre}: ${op.nota ?? 'sin cuenta en Pulppo'}`);
    if (f.asesorId && !/^[a-f0-9]{24}$/i.test(f.asesorId)) throw new Error('asesor inválido');
    const { A, B, cA, cB } = ventanas(f);
    const [actual, comparado] = await Promise.all([
        bloque(A, B, f, op, todas),
        cA && cB ? bloque(cA, cB, f, op, todas) : Promise.resolve(null),
    ]);
    return {
        filtro: f,
        inmobiliaria: op ? { nombre: op.nombre, kam: op.kam, tier: op.tier, cuentas: op.ids.length } : null,
        actual, comparado, generado: new Date(now).toISOString(),
    };
}
