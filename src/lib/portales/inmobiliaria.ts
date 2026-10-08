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
//   · FANTASMA = lead con teléfono inválido, o sin conversación real: su `interaction` sólo trae el evento del portal
//     ("Vio teléfono", "Contactó por WhatsApp") y ni una llamada. La mayoría NO muere: el
//     comprador abre WhatsApp y esa conversación entra por otro lado. «Sin respuesta visible» = ni
//     siquiera eso, en una ventana de −30/+14 días sobre las conversaciones del mismo contacto.
//     NO quiere decir que el lead esté perdido (2-oct-2026, Ale): trae teléfono (96% válido) y el
//     asesor le puede escribir. Es que no hay respuesta del cliente que Pulppo pueda VER: la app
//     marca `answeredAt` cuando el asesor abre su WhatsApp para contestar, pero ese chat no se guarda
//     (DH ago: 0 de 300 con mensaje saliente del número de Pulppo, 18 con autorespuesta).
//     (Medido 1-oct-2026, i24+ML agosto: 83% sin conversación, 59% rescatado, 34% muere.)
//     La regla se evalúa EN MONGO ($regexMatch) y sólo viaja el resultado: bajar los mensajes
//     completos era el 70% del tiempo de la vista.
//   · Excluye Habi y cuentas de prueba siempre.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { CANALES, KEY2NAME, NOT, NOTP, brokerContacts, classifySource, dig, isDate, num, oid } from './metrics';
import { FAM_LBL, FAM_ORDEN, NO_ES_DESCARTE, etiquetaMotivo, familiaDe, motivoDe } from './descarte';
import { ALIAS_IDS, ALIAS_INMO, ORDEN_INMOBILIARIAS, SIN_CUENTA, normInmo } from './ordenInmobiliarias';
import type { Operacion } from './view';

const DIA = 86400000;
const MX_MS = 6 * 3600 * 1000;
const OFERTA = ['offer', 'offer_blocked', 'contract', 'paying', 'closed'];
const CIERRE = ['closed', 'paying'];
// El evento del portal se guarda como si fuera un mensaje del cliente: no es conversación.
// Variantes revisadas el 2-oct-2026 sobre los mensajes cortos más comunes del «cliente»: además de los
// clásicos, el sistema escribe «es un lead de teléfono / WhatsApp» y «el cliente vio el teléfono».
const PLACEHOLDER = /^(el cliente )?(vio|ver) (el )?tel[eé]fono\.?$|^vio el anuncio\.?$|^contact[oó] por whats?app\.?$|^es un lead de (tel[eé]fono|whats?app)\.?$/i;

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
    /** cada lead cae en UNA: con conversación · sin respuesta visible · fantasma (suman leads) */
    conConversacion: number; pctConConversacion: number | null;
    sinRespuesta: number; pctSinRespuesta: number | null;
    /** teléfono inválido y sin conversación: no hay cómo contactarlo */
    fantasmas: number; pctFantasma: number | null;
    /** el portal mandó sólo el evento («Vio teléfono»…): dato del portal, no del lead */
    soloClic: number; pctSoloClic: number | null;
    descartados: number; pctDescartado: number | null;
    /** de los descartados, cuántos sin un solo seguimiento registrado por el asesor antes del descarte */
    descSinSeg: number; pctDescSinSeg: number | null;
    /** teléfono que no sirve (menos de 10 dígitos, todos iguales o una secuencia) */
    telInvalido: number; pctTelInvalido: number | null;
    /** leads cuyo contacto está etiquetado como broker (`contacts.tags ~ /broker/i`) */
    brokerLeads: number; pctBroker: number | null;
    /** descartados por familia (claves de FAM_ORDEN) */
    descFam: Record<string, number>;
    /** fuente que más leads trae (sólo en filas de asesor / inmobiliaria) */
    topFuente?: string;
    nota?: string;
}
export interface Cierre {
    fecha: string; id: string; codigo: string | null; operacion: string; tipo: string | null;
    colonia: string | null; valor: number; comision: number; regalia: number;
    fuente: string; lado: 'vendedor' | 'comprador' | 'ambos'; asesor: string;
    /** la fuente no venía en la operación: se dedujo del primer lead del comprador */
    inferida?: boolean;
    /** quién trajo al comprador si no fue la inmobiliaria: «Broker externo» / «Red Pulppo» (no es fuente) */
    comprador?: string | null;
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
        motivos: Array<{ motivo: string; familia: string; n: number; pct: number; segMediana: number | null; segProm: number | null; pctSinSeg: number | null }>;
        /** búsquedas descartadas con seguimiento medido (una por búsqueda, no por lead) */
        busquedas: number;
    };
    cierres: {
        n: number; venta: number; renta: number; valor: number; comision: number; regalia: number;
        porFuente: Array<{ fuente: string; n: number; venta: number; renta: number; comision: number; regalia: number; inferidas: number }>;
        /** cuántos cierres venían sin fuente (`other`) y cuántos quedaron sin poder atribuir */
        sinFuenteOriginal: number; sinAtribuir: number;
        lista: Cierre[];
    };
    /** Leads por día y por fuente (la gráfica del Resumen y las banderas de día raro). Días en UTC,
     *  igual que los cortes del periodo, para que la suma cuadre con el total. */
    porDia: {
        dias: string[];
        /** n = leads del día · lab = de ellos, los que entraron 9:00–20:59 MX · sin = de esos, sin respuesta del asesor */
        series: Array<{ key: string; nombre: string; n: number[]; lab: number[]; sin: number[] }>;
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
//     contacto directo del asesor: hoy se parte en «Búsqueda creada por el asesor» (tiene búsqueda sin
//     fuente) y «Cartera del asesor» (ni búsqueda). Ver atribuirFuente.
// Las fuentes chicas con nombre (Lonas, TuPortalOnline…) se muestran tal cual.
const FUENTE_RARA: Record<string, string> = {
    lonas: 'Lonas', tuportalonline: 'TuPortalOnline', contactodirecto: 'Contacto directo', referido: 'Referido',
    'doorvel.com': 'Doorvel', lamudi: 'Lamudi', brokerexternal: 'Broker externo',
};
// «Broker externo» capturado a mano en la fuente dice QUIÉN trajo al comprador, no el canal (Ale,
// 8-oct-2026): cuenta como sin fuente y la regla sigue buscando el canal.
const SIN_FUENTE = new Set(['other', '', 'none', 'null', 'undefined', 'broker externo', 'broker', 'externo', 'otro broker', 'red pulppo']);
export const F_BROKER_EXT = 'Broker externo', F_RED = 'Red Pulppo', F_SIN = 'Sin fuente registrada';
export const F_BUSQ = 'Búsqueda creada por el asesor', F_CARTERA = 'Cartera del asesor';

/**
 * Fuente de un cierre — UNA regla para /portales y para Desempeño de /mb (Ale y Lau, 8-oct-2026).
 * La fuente es el CANAL por el que llegó el comprador. Quién lo trajo (un broker externo u otra
 * inmobiliaria de la red) NO es una fuente: va aparte, en `comprador` (Ale: «Broker externo no es una
 * fuente, la fuente es inmuebles24 y si es un broker externo es otra cosa»).
 * Medido en 2026: la fuente de la operación (`buyer.source`) y la de la búsqueda coinciden en 819 de
 * 820 cierres; la diferencia está sólo en los que llegan sin ninguna.
 *   1. la capturada (operación, o la búsqueda si la operación no la trae)
 *   2. el primer lead del comprador CON LA INMOBILIARIA QUE LO TRAJO, antes del cierre (inferida).
 *      Un lead que dejó meses antes con otra inmobiliaria no dice cómo llegó a ésta.
 *   3. tiene búsqueda pero sin fuente → el asesor dio de alta al contacto: «Búsqueda creada por el asesor»
 *   4. nada: si lo trajo otra inmobiliaria → «Sin fuente registrada» (no es cartera de nadie de la casa);
 *      si es de la casa → «Cartera del asesor»
 */
export function atribuirFuente(x: {
    capturada: string | null; otra: 'externo' | 'red' | null; primerLead: string | null; tieneBusqueda: boolean;
}): { fuente: string; inferida?: boolean; comprador: string | null } {
    const comprador = x.otra === 'externo' ? F_BROKER_EXT : x.otra === 'red' ? F_RED : null;
    if (x.capturada) return { fuente: x.capturada, comprador };
    if (x.primerLead) return { fuente: x.primerLead, inferida: true, comprador };
    if (x.tieneBusqueda) return { fuente: F_BUSQ, comprador };
    return { fuente: x.otra ? F_SIN : F_CARTERA, comprador };
}
/** Fuente capturada, o null si vino vacía / `other` (entonces se deduce, ver arriba). */
export const fuenteCapturada = (raw: unknown): string | null => {
    const t = String(raw ?? '').trim();
    if (SIN_FUENTE.has(t.toLowerCase())) return null;
    const k = classifySource(t);
    if (k !== 'otros') return KEY2NAME[k] ?? k;
    return FUENTE_RARA[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1);
};

/** Teléfono que no sirve para contactar. Medido jul–ago 2026: 1.5% de los leads (casi todos traen correo). */
function telInvalido(p: unknown): boolean {
    const d = String(p ?? '').replace(/\D/g, '');
    const u = d.slice(-10);
    if (u.length < 10) return true;
    if (new Set(u).size <= 2) return true;
    return '01234567890123456789'.includes(u) || '98765432109876543210'.includes(u);
}

/** NURA tiene contrato propio con i24 (la línea «I24 Mérida» del Sheet): se reporta aparte. */
export const I24_NURA = 'Inmuebles24 · NURA';
const esNura = (name: unknown) => /\bnura\b/i.test(String(name ?? ''));

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
    soloClic: number; conv: number; sinResp: number; fantTel: number; desc: number; descSinSeg: number; telInv: number;
    brk: number; descFam: Map<string, number>;
    fuentes: Map<string, number>;
}
const nuevaCelda = (key: string, nombre: string, req: Set<string> | null): Celda => ({
    key, nombre, req, leads: 0, venta: 0, renta: 0, baseLab: 0, lt60: 0, sin: 0, resp: [],
    t0: new Map(), vis: new Set(), ofe: new Set(), clo: new Set(), soloClic: 0, conv: 0, sinResp: 0, fantTel: 0, desc: 0, descSinSeg: 0, telInv: 0, brk: 0, descFam: new Map(), fuentes: new Map(),
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
    cel('f:i24nura', I24_NURA, reqInmo);
    cel('f:otros', 'Otras fuentes', reqInmo);

    // leads → celdas; se guardan para los joins de después
    type LeadRef = { id: ObjectId; cells: Celda[]; t: Date; cid: string | null; inter: ObjectId | null; search: string | null; telMalo: boolean };
    const refs: LeadRef[] = [];
    const nDias = Math.round((B.getTime() - A.getTime()) / DIA);
    const serie = new Map<string, { n: number[]; lab: number[]; sin: number[] }>();
    const filtro: Document = {
        createdAt: { $gte: A, $lt: B }, ...NOT,
        ...(idsInmo ? { 'company._id': { $in: idsInmo } } : {}),
        ...(f.asesorId ? { 'agent._id': new ObjectId(f.asesorId) } : {}),
        ...(f.operacion === 'todas' ? {} : { 'property.listing.operation': f.operacion }),
    };
    const cur = db.collection('leads').find(filtro, {
        projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, 'property.listing.operation': 1,
            'company._id': 1, 'company.name': 1, 'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, interaction: 1, search: 1,
            phone: 1, 'contact.phone': 1 },
        batchSize: 10000,
    });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        // i24 de NURA va aparte: tiene su propio paquete con i24 («I24 Mérida» en el Sheet).
        const canal = canalDeLead(l.source, dig(l, 'company', 'name'));
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
        // `||` y no `??`: hay leads con phone = '' y el teléfono bueno en el contacto.
        const telMalo = telInvalido(l.phone || dig(l, 'contact', 'phone'));
        const di = Math.floor((ca.getTime() - A.getTime()) / DIA);
        if (di >= 0 && di < nDias) {
            const sr = serie.get(canal) ?? serie.set(canal, { n: Array(nDias).fill(0), lab: Array(nDias).fill(0), sin: Array(nDias).fill(0) }).get(canal)!;
            sr.n[di] += 1;
            if (lab) { sr.lab[di] += 1; if (mins == null) sr.sin[di] += 1; }
        }
        for (const c of mis) {
            c.leads += 1;
            if (telMalo) c.telInv += 1;
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
            search: l.search ? String(l.search) : null, telMalo,
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
                // También las ofertas que después se cayeron: en 2026 hay 752 operaciones canceladas que sí
                // llegaron a oferta (vs 1,491 vigentes). Contar sólo `status.last` dejaba «ofertaron» corto.
                { 'buyer.contact._id': { $in: chunk }, $or: [{ 'status.last': { $in: OFERTA } }, { 'status.history.status': { $in: OFERTA } }] },
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
        // Cada lead cae en UNA de tres (Ale, 2-oct-2026: «no son rescatados, simplemente son leads»):
        //   · CON CONVERSACIÓN — plática real en su interacción, o en otra del mismo contacto de −30 a
        //     +14 días (el comprador abrió WhatsApp y entró por otro lado, o ya venía platicando).
        //   · SIN RESPUESTA VISIBLE — teléfono válido, se le puede escribir, pero no vemos respuesta: el
        //     asesor contesta desde su WhatsApp y ese chat no se guarda.
        //   · FANTASMA — teléfono inválido y sin conversación: no hay cómo contactarlo.
        // Aparte, «sólo el clic» = el portal mandó únicamente el evento (dato del portal, no del lead).
        const sinAqui = refs.filter((r) => !r.inter || !real.has(String(r.inter)));
        for (const r of sinAqui) for (const c of r.cells) c.soloClic += 1;

        // ¿ese contacto conversó de verdad en OTRA interacción?
        const vent = new Map<string, Date[]>();   // contacto → fechas de mensajes reales del cliente
        const cids = [...new Set(sinAqui.map((r) => r.cid).filter((x): x is string => !!x))].map(oid).filter((o): o is ObjectId => !!o);
        // Ventana: de 30 días ANTES (ya estaba en plática y volvió a dar clic a un anuncio) a 14 después.
        const w0 = new Date(A.getTime() - 30 * DIA), w1 = new Date(B.getTime() + 14 * DIA);
        const propias = new Set(sinAqui.map((r) => (r.inter ? String(r.inter) : '')).filter(Boolean));
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
        const enSinAqui = new Set(sinAqui);
        for (const r of refs) {
            let conv = !enSinAqui.has(r);
            if (!conv) {
                const ds = r.cid ? vent.get(r.cid) : undefined;
                const t = r.t.getTime();
                conv = !!ds?.some((d) => d.getTime() >= t - 30 * DIA && d.getTime() <= t + 14 * DIA);
            }
            for (const c of r.cells) {
                if (conv) c.conv += 1;
                else if (r.telMalo) c.fantTel += 1;
                else c.sinResp += 1;
            }
        }
    })();

    // ── descartados: la búsqueda del lead terminó cancelada ─────────────
    // TODAS las cancelaciones, no sólo las que traen motivo: 7.6% viene sin motivo (null) y antes
    // quedaba fuera del conteo. Se excluyen las que no son descarte (`success`/`Ganada` = terminó
    // bien) y las cancelaciones del sistema van en su propia familia.
    const motivosTot = new Map<string, number>();
    // seguimientos por motivo: una entrada por BÚSQUEDA descartada (varios leads pueden compartirla)
    const segPorMotivo = new Map<string, number[]>();
    const tareaDescarte = (async () => {
        const porSearch = new Map<string, LeadRef[]>();
        for (const r of refs) if (r.search) (porSearch.get(r.search) ?? porSearch.set(r.search, []).get(r.search)!).push(r);
        const ids = [...porSearch.keys()].map(oid).filter((o): o is ObjectId => !!o);
        const descartadas: Array<{ id: ObjectId; motivo: string; fin: Date | null }> = [];
        for (let i = 0; i < ids.length; i += 5000) {
            const cs = db.collection('searches').find(
                { _id: { $in: ids.slice(i, i + 5000) }, 'status.last': 'cancelled' },
                { projection: { 'status.reasonToFinish': 1, 'status.description': 1, 'status.history': 1 } });
            for await (const s of cs) {
                const crudo = String(dig(s, 'status', 'reasonToFinish') ?? '').trim();
                if (NO_ES_DESCARTE.has(crudo)) continue;
                const motivo = motivoDe(crudo, dig(s, 'status', 'description'));
                const fin = ((dig(s, 'status', 'history') as Document[]) ?? [])
                    .filter((h) => h?.status === 'cancelled' && isDate(h.timestamp)).map((h) => h.timestamp as Date)
                    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
                descartadas.push({ id: s._id as ObjectId, motivo, fin });
                const famM = familiaDe(motivo);
                for (const r of porSearch.get(String(s._id)) ?? []) {
                    for (const c of r.cells) { c.desc += 1; c.descFam.set(famM, (c.descFam.get(famM) ?? 0) + 1); }
                    motivosTot.set(motivo, (motivosTot.get(motivo) ?? 0) + 1);
                }
            }
        }
        // TOQUES REGISTRADOS antes del descarte = lo que el ASESOR hizo en Pulppo sobre esa búsqueda:
        //   · seguimientos que marcó como hechos (`tasks`, finishedBy ≠ System: el sistema crea
        //     SEGUIMIENTO-FANTASMA/-BUSCANDO… y cierra muchas solo, ésas no son un toque);
        //   · propiedades que le sugirió, búsqueda que le compartió, notas (`logs` de la API).
        // Los WhatsApp del asesor NO están en la base (`messages` dejó de llenarse; `interactions` sólo
        // trae al cliente y al número de Pulppo), así que esto es lo REGISTRADO, no todo lo que hizo.
        const hechos = new Map<string, Date[]>();
        await Promise.all(Array.from({ length: Math.ceil(descartadas.length / 5000) }, async (_, j) => {
            const cur = db.collection('tasks').find(
                { 'metadata.search': { $in: descartadas.slice(j * 5000, (j + 1) * 5000).map((d) => d.id) }, status: 'done', finishedBy: { $ne: 'System' } },
                { projection: { 'metadata.search': 1, finishedAt: 1 } });
            for await (const t of cur) {
                if (!isDate(t.finishedAt)) continue;
                const k = String(dig(t, 'metadata', 'search'));
                (hechos.get(k) ?? hechos.set(k, []).get(k)!).push(t.finishedAt);
            }
        }));
        // `logs.message` está indexado: se pide el texto EXACTO de cada acción por búsqueda (1.8 s por mes).
        const ACCIONES = ['[PATCH] /search/{}/properties/add', '[POST] /search/{}/share', '[PATCH] /search/{}/properties/add-note'];
        const textos = descartadas.flatMap((d) => ACCIONES.map((a) => a.replace('{}', String(d.id))));
        await Promise.all(Array.from({ length: Math.ceil(textos.length / 6000) }, async (_, j) => {
            const cur = db.collection('logs').find({ message: { $in: textos.slice(j * 6000, (j + 1) * 6000) } }, { projection: { message: 1, createdAt: 1 } });
            for await (const l of cur) {
                const m = /\/search\/([0-9a-f]{24})/.exec(String(l.message));
                if (!m || !isDate(l.createdAt)) continue;
                (hechos.get(m[1]) ?? hechos.set(m[1], []).get(m[1])!).push(l.createdAt);
            }
        }));
        for (const d of descartadas) {
            const n = (hechos.get(String(d.id)) ?? []).filter((t) => !d.fin || t <= d.fin).length;
            (segPorMotivo.get(d.motivo) ?? segPorMotivo.set(d.motivo, []).get(d.motivo)!).push(n);
            if (n === 0) for (const r of porSearch.get(String(d.id)) ?? []) for (const c of r.cells) c.descSinSeg += 1;
        }
    })();

    // ── cierres del periodo (actividad), ambos lados ──────────────────
    const tareaCierres = cierresEntre(A, B, { ids: op ? op.ids : null, asesorId: f.asesorId ?? null, operacion: f.operacion });

    // ── leads de brokers (contacto etiquetado broker), el mismo criterio del resto de /portales ──
    const tareaBroker = (async () => {
        const bset = await brokerContacts(new Set(refs.map((r) => r.cid).filter((x): x is string => !!x)));
        for (const r of refs) if (r.cid && bset.has(r.cid)) for (const c of r.cells) c.brk += 1;
    })();

    const [, , , cierresRes] = await Promise.all([Promise.all(tareasJoin), tareaFantasma, tareaDescarte, tareaCierres, tareaBroker]);
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
            conConversacion: c.conv, pctConConversacion: p1(c.conv, c.leads),
            sinRespuesta: c.sinResp, pctSinRespuesta: p1(c.sinResp, c.leads),
            fantasmas: c.fantTel, pctFantasma: p1(c.fantTel, c.leads),
            soloClic: c.soloClic, pctSoloClic: p1(c.soloClic, c.leads),
            descartados: c.desc, pctDescartado: p1(c.desc, c.leads),
            descSinSeg: c.descSinSeg, pctDescSinSeg: p1(c.descSinSeg, c.desc),
            brokerLeads: c.brk, pctBroker: p1(c.brk, c.leads), descFam: Object.fromEntries(c.descFam),
            telInvalido: c.telInv, pctTelInvalido: p1(c.telInv, c.leads),
            ...(top ? { topFuente: top[0] === 'i24nura' ? I24_NURA : KEY2NAME[top[0]] ?? 'Otras fuentes' } : {}),
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
    for (const [m, n] of motivosTot) { const k = familiaDe(m); fam.set(k, (fam.get(k) ?? 0) + n); }

    const porFuente = new Map<string, { fuente: string; n: number; venta: number; renta: number; comision: number; regalia: number; inferidas: number }>();
    for (const x of lista) {
        const r = porFuente.get(x.fuente) ?? porFuente.set(x.fuente, { fuente: x.fuente, n: 0, venta: 0, renta: 0, comision: 0, regalia: 0, inferidas: 0 }).get(x.fuente)!;
        r.n += 1; r.comision += x.comision; r.regalia += x.regalia; if (x.inferida) r.inferidas += 1;
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
                // se juntan las grafías del mismo motivo ('Perdido' / 'perdido') bajo una etiqueta
                const m2 = new Map<string, { familia: string; n: number; seg: number[] }>();
                for (const [m, n] of motivosTot) {
                    const l = etiquetaMotivo(m);
                    const e = m2.get(l) ?? m2.set(l, { familia: FAM_LBL[familiaDe(m)], n: 0, seg: [] }).get(l)!;
                    e.n += n; e.seg.push(...(segPorMotivo.get(m) ?? []));
                }
                return [...m2.entries()].sort((a, b) => b[1].n - a[1].n).map(([motivo, e]) => ({
                    motivo, familia: e.familia, n: e.n, pct: totDesc ? Math.round((100 * e.n) / totDesc) : 0,
                    segMediana: mediana(e.seg), segProm: e.seg.length ? r1(e.seg.reduce((a, b) => a + b, 0) / e.seg.length) : null,
                    pctSinSeg: p1(e.seg.filter((x) => x === 0).length, e.seg.length),
                }));
            })(),
            busquedas: [...segPorMotivo.values()].reduce((a, x) => a + x.length, 0),
        },
        cierres: {
            n: lista.length, venta: lista.filter((x) => x.operacion === 'Venta').length, renta: lista.filter((x) => x.operacion === 'Renta').length,
            valor: lista.reduce((a, x) => a + x.valor, 0), comision: lista.reduce((a, x) => a + x.comision, 0), regalia: lista.reduce((a, x) => a + x.regalia, 0),
            porFuente: [...porFuente.values()].sort((a, b) => b.n - a.n),
            sinFuenteOriginal: cierresRes.sinFuenteOrig, sinAtribuir: lista.filter((x) => x.fuente === F_SIN).length,
            lista: lista.slice(0, 60),
        },
        porDia: {
            dias: Array.from({ length: nDias }, (_, i) => ymd(new Date(A.getTime() + i * DIA))),
            series: [...serie.entries()].map(([k, x]) => ({ key: `f:${k}`, nombre: cells.get(`f:${k}`)?.nombre ?? k, ...x }))
                .sort((a, b) => b.n.reduce((s, v) => s + v, 0) - a.n.reduce((s, v) => s + v, 0)),
        },
    };
}

/** Canal de un lead: el de su `source`, salvo el i24 de NURA, que va aparte (su propio paquete,
 *  «I24 Mérida» en el Sheet). Lo usan todas las pestañas de /portales. */
export const canalDeLead = (source: unknown, companyName: unknown): string => {
    const k = classifySource(source as string);
    return k === 'i24' && esNura(companyName) ? 'i24nura' : k;
};
/** Canales en el orden de las tablas, con NURA justo después de Inmuebles24. */
export const CANALES_TODOS: Array<[string, string]> = CANALES.flatMap((c) => (c[1] === 'i24' ? [c, [I24_NURA, 'i24nura'] as [string, string]] : [c]));

/** Cierres de [A, B) con su fuente atribuida — el MISMO cálculo en «Inmobiliarias», el Resumen y el
 *  Histórico. `ids` = compañías de una inmobiliaria (ambos lados); null = toda la red. */
export async function cierresEntre(
    A: Date, B: Date, opc: { ids: string[] | null; asesorId?: string | null; operacion: 'todas' | 'sale' | 'rent' },
): Promise<{ out: Cierre[]; sinFuenteOrig: number }> {
    const db = await getDb();
    const idsInmo = opc.ids ? opc.ids.map((s) => new ObjectId(s)) : null;
    const reqInmo = opc.ids ? new Set(opc.ids) : null;
    const lado: Document[] = [];
    if (idsInmo) lado.push({ 'seller.company._id': { $in: idsInmo } }, { 'buyer.company._id': { $in: idsInmo } });
    const asesor = opc.asesorId ? new ObjectId(opc.asesorId) : null;
    const q: Document = {
        'status.last': { $in: CIERRE }, closedAt: { $gte: A, $lt: B }, ...NOTP,
        ...(lado.length ? { $or: lado } : {}),
        ...(opc.operacion === 'todas' ? {} : { 'property.listing.operation': opc.operacion }),
    };
    const ops = await db.collection('operations').find(q, { projection: {
        id: 1, closedAt: 1, 'property.internalId': 1, 'property.listing.operation': 1, 'property.type': 1,
        'property.address.neighborhood.name': 1, 'closeValue.value': 1, 'comission.value': 1, 'pulppoComission.value': 1, 'buyer.source': 1,
        'seller.company._id': 1, 'buyer.company._id': 1, 'buyer.company.external': 1, 'buyer.contact._id': 1, 'property._id': 1,
        'seller.company.name': 1, 'buyer.company.name': 1,
        'seller.broker._id': 1, 'seller.broker.firstName': 1, 'seller.broker.lastName': 1,
        'buyer.broker._id': 1, 'buyer.broker.firstName': 1, 'buyer.broker.lastName': 1,
        'seller.company.external': 1, 'buyer.search': 1,
    } }).sort({ closedAt: -1 }).toArray();
    // Una misma venta a veces tiene DOS operaciones (paying + closed): 8 de 1,364 en 2026. Se queda
    // la más reciente por propiedad + comprador.
    const vistos = new Set<string>();
    const opsU = ops.filter((o) => {
        const k = `${String(dig(o, 'property', '_id') ?? o._id)}|${String(dig(o, 'buyer', 'contact', '_id') ?? o._id)}`;
        if (vistos.has(k)) return false; vistos.add(k); return true;
    });
    const nombre = (o: Document, k: 'seller' | 'buyer') =>
        [dig(o, k, 'broker', 'firstName'), dig(o, k, 'broker', 'lastName')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    // Sin fuente en la operación: la de su búsqueda, y si tampoco, el primer lead del comprador con SU
    // inmobiliaria. Consultas por lotes (searches por _id, leads por contact._id, los dos indexados).
    const porDeducir = opsU.filter((o) => !fuenteCapturada(dig(o, 'buyer', 'source')));
    const fuenteBusq = new Map<string, string>();
    const sidsB = [...new Set(porDeducir.map((o) => dig(o, 'buyer', 'search')).filter(Boolean).map(String))].map(oid).filter((x): x is ObjectId => !!x);
    for (let i = 0; i < sidsB.length; i += 3000)
        for await (const sx of db.collection('searches').find({ _id: { $in: sidsB.slice(i, i + 3000) } }, { projection: { source: 1 } })) {
            const f = fuenteCapturada(sx.source);
            if (f) fuenteBusq.set(String(sx._id), f);
        }
    const leadsDe = new Map<string, Array<{ t: Date; src: string; comp: string }>>();
    const cidsB = [...new Set(porDeducir.map((o) => dig(o, 'buyer', 'contact', '_id')).filter(Boolean).map(String))].map(oid).filter((x): x is ObjectId => !!x);
    for (let i = 0; i < cidsB.length; i += 3000) {
        for await (const l of db.collection('leads').find({ 'contact._id': { $in: cidsB.slice(i, i + 3000) } },
            { projection: { 'contact._id': 1, source: 1, createdAt: 1, 'company._id': 1 } })) {
            if (!isDate(l.createdAt)) continue;
            const k = String(dig(l, 'contact', '_id'));
            (leadsDe.get(k) ?? leadsDe.set(k, []).get(k)!).push({ t: l.createdAt, src: String(l.source ?? ''), comp: String(dig(l, 'company', '_id') ?? '') });
        }
    }
    const fuenteDe = (o: Document): { fuente: string; inferida?: boolean; comprador: string | null } => {
        const sc = String(dig(o, 'seller', 'company', '_id') ?? ''), bc = String(dig(o, 'buyer', 'company', '_id') ?? '');
        const sid = dig(o, 'buyer', 'search');
        // «otra» = el comprador lo trajo una inmobiliaria que no es la nuestra: con inmobiliaria elegida,
        // una que no es ella; en la vista de red, una distinta a la del vendedor.
        // Sin inmobiliaria del comprador cuenta como externo (mismo criterio que el reporte de Lau).
        const nuestra = reqInmo ? reqInmo.has(bc) : !!bc && bc === sc;
        const otra = !nuestra ? (dig(o, 'buyer', 'company', 'external') === true || !bc ? 'externo' : 'red') : null;
        const cid = dig(o, 'buyer', 'contact', '_id');
        const cl = o.closedAt as Date;
        // sólo leads con fuente útil: si el primero también vino `other`, se busca el siguiente
        const primero = cid ? (leadsDe.get(String(cid)) ?? [])
            .filter((l) => l.t <= cl && l.comp === bc && fuenteCapturada(l.src)).sort((a, b) => a.t.getTime() - b.t.getTime())[0] : undefined;
        return atribuirFuente({
            capturada: fuenteCapturada(dig(o, 'buyer', 'source')) ?? (sid ? fuenteBusq.get(String(sid)) ?? null : null),
            otra, primerLead: primero ? fuenteCapturada(primero.src) : null, tieneBusqueda: !!sid,
        });
    };
    const out: Cierre[] = [];
    let sinFuenteOrig = 0;
    for (const o of opsU) {
        const sc = String(dig(o, 'seller', 'company', '_id') ?? ''), bc = String(dig(o, 'buyer', 'company', '_id') ?? '');
        const vende = reqInmo ? reqInmo.has(sc) : true, compra = reqInmo ? reqInmo.has(bc) : true;
        let ladoX: Cierre['lado'] = vende && compra ? 'ambos' : vende ? 'vendedor' : 'comprador';
        // Vista general: el lado es el de la RED. Comprador externo → vendimos; vendedor externo →
        // trajimos al comprador; las dos inmobiliarias de la red (iguales o no) → ambos.
        if (!reqInmo) {
            const bExt = !bc || dig(o, 'buyer', 'company', 'external') === true;
            const sExt = !sc || dig(o, 'seller', 'company', 'external') === true;
            ladoX = bExt && !sExt ? 'vendedor' : sExt && !bExt ? 'comprador' : 'ambos';
        }
        const sb = String(dig(o, 'seller', 'broker', '_id') ?? ''), bb = String(dig(o, 'buyer', 'broker', '_id') ?? '');
        if (asesor) {
            const a = String(asesor);
            const deEl = (vende && sb === a) || (compra && bb === a);
            if (!deEl) continue;
        }
        const conVendedor = reqInmo ? vende : ladoX !== 'comprador', conComprador = reqInmo ? compra : ladoX !== 'vendedor';
        const nombres = [...new Set([
            ...(conVendedor ? [nombre(o, 'seller')] : []),
            ...(conComprador ? [nombre(o, 'buyer')] : []),
        ].filter(Boolean))];
        const opx = String(dig(o, 'property', 'listing', 'operation') ?? '');
        out.push({
            fecha: ymd(o.closedAt as Date), id: String(o.id ?? o._id), codigo: (dig(o, 'property', 'internalId') as string) ?? null,
            operacion: opx === 'sale' ? 'Venta' : opx === 'rent' ? 'Renta' : opx || '—',
            tipo: (dig(o, 'property', 'type') as string) ?? null,
            colonia: (dig(o, 'property', 'address', 'neighborhood', 'name') as string) ?? null,
            valor: num(dig(o, 'closeValue', 'value')), comision: num(dig(o, 'comission', 'value')), regalia: num(dig(o, 'pulppoComission', 'value')),
            ...(() => {
                const r = fuenteDe(o);
                // cierre de i24 en el que participa NURA → su propio canal, igual que sus leads
                const nura = esNura(dig(o, 'seller', 'company', 'name')) || esNura(dig(o, 'buyer', 'company', 'name'));
                return r.fuente === 'Inmuebles24' && nura ? { ...r, fuente: I24_NURA } : r;
            })(),
            lado: ladoX, asesor: nombres.join(' / ') || '—',
        });
        if (!fuenteCapturada(dig(o, 'buyer', 'source'))) sinFuenteOrig += 1;
    }
    return { out, sinFuenteOrig };
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
        // Mes en curso (del 1 a hoy) → los MISMOS días del mes anterior: 1–2 oct contra 1–2 sep, no
        // contra 29–30 sep.
        const ultimo = new Date(B.getTime() - DIA);
        if (A.getUTCDate() === 1 && ultimo.getUTCMonth() === A.getUTCMonth() && ultimo.getUTCFullYear() === A.getUTCFullYear()) {
            const cA = new Date(Date.UTC(A.getUTCFullYear(), A.getUTCMonth() - 1, 1));
            const finMesAnt = new Date(Date.UTC(A.getUTCFullYear(), A.getUTCMonth(), 0)).getUTCDate();
            const cB = new Date(Date.UTC(cA.getUTCFullYear(), cA.getUTCMonth(), Math.min(ultimo.getUTCDate(), finMesAnt)) + DIA);
            return { A, B, cA, cB };
        }
        const len = B.getTime() - A.getTime();
        return { A, B, cA: new Date(A.getTime() - len), cB: A };
    }
    if (f.comparar === 'anio') {
        // 29-feb menos un año → 28-feb (Date.UTC lo rodaría al 1-mar)
        const menos1 = (d: Date) => {
            const y = d.getUTCFullYear() - 1, m = d.getUTCMonth();
            return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
        };
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
