// /mb → «Tu 2026»: el cierre de año de la inmobiliaria para la última Master Experience (3-dic-2026).
//
// Dos sub-pestañas:
//   · TU AÑO (para el dueño): sus números contra SÍ MISMA (2025 y 2024) y contra sus PARES (inmobiliarias
//     de tamaño parecido), más «Logros del año» y «Lo que faltó para romperla», armados con reglas.
//   · RECONOCIMIENTOS (para sus asesores): 8 premios DENTRO de la inmobiliaria — el sneak peek de la gala,
//     que premia contra toda la red (/plus → Salón de la fama). Mismas reglas que lib/premios.ts.
//
// Reglas acordadas con Ale (19-nov-2026):
//   · Siempre MISMO CORTE en todos los años: 1-ene → hoy (y desde diciembre, ene–nov completo). Comparar
//     2026 a medias contra 2025 completo haría que todos salieran cayendo.
//   · Comisión COBRADA (payments por paymentDate, como /plus) — la de la inmobiliaria dueña del deal.
//   · Inmobiliaria = la lista canónica de las 102 (opcionesInmobiliarias: junta las compañías con el mismo
//     nombre y los alias). Pares = cuartil de inventario publicado HOY dentro de esa lista.
//   · Leads únicos: contacto + propiedad = 1 lead POR MES, por la compañía del lead, sin «formulario de contacto»
//     (la definición del reporte mensual de las KAMs, 23-nov).
//   · Una sola pasada por año para TODA la red (los pares la necesitan): ~30 s en frío, caché 12 h.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { agentMaps, paymentDate, splitByRole, type AgentMaps } from './plus';
import { asesoresDeBaja } from './premios';
import { opcionesInmobiliarias } from './portales/inmobiliaria';
import { fetchInmobiliaria } from './mb';

export const AÑO = 2026;
const MX = 6 * 3600 * 1000;
const DIA = 86_400_000;
const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ORD: Record<string, number> = { standard: 1, professional: 2, elite: 3 };
const LVL: Record<string, string> = { standard: 'Estándar', professional: 'Profesional', elite: 'Élite' };

const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const num = (v: unknown) => Number(v ?? 0) || 0;
const dig = (d: unknown, ...ks: string[]): unknown => {
    let c: unknown = d;
    for (const k of ks) { if (c == null || typeof c !== 'object') return undefined; c = (c as Document)[k]; }
    return c;
};
const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const enHorario = (d: Date) => { const h = new Date(d.getTime() - MX).getUTCHours(); return h >= 8 && h <= 19; };

/** Corte común a todos los años: [mes, día] del primer día que NO entra. Hoy a las 00:00 MX (ayer completo);
 *  desde diciembre, el 1-dic (ene–nov completo). */
export function corte(hoy = new Date()): [number, number] {
    const x = new Date(hoy.getTime() - MX);
    if (x.getUTCFullYear() > AÑO || x.getUTCMonth() === 11) return [11, 1];
    return [x.getUTCMonth(), x.getUTCDate()];
}
const ventana = (y: number, [m, d]: [number, number]) => ({ A: new Date(Date.UTC(y, 0, 1) + MX), B: new Date(Date.UTC(y, m, d) + MX) });
export function corteTexto([m, d]: [number, number]): string {
    const fin = new Date(Date.UTC(AÑO, m, d) - DIA);
    return `1 de enero al ${fin.getUTCDate()} de ${MES[fin.getUTCMonth()]}`;
}

// ── agregados por inmobiliaria y por asesor ────────────────────────────────────
interface Inmo {
    cobrada: number; opsCobradas: Set<string>; cierresVenta: number; cierresRenta: number; ventas: number[];
    leads: number; respondidos: number; resp: number[]; visitas: number;
    contactos: Set<string>; contactosVisita: Set<string>; contactosCierre: Set<string>;
    captaciones: number; exclusivas: number; firmadas: number; asesoresCobro: Set<string>; ascensos: number;
    ofertas: number; contactosOferta: Set<string>;
    /** por mes (0 = enero) del año de la pasada: para «mes a mes» y para los logros dentro del año */
    mes: Record<SerieKey, number[]>;
}
export type SerieKey = 'leads' | 'visitas' | 'cierres' | 'cobrada' | 'captaciones' | 'firmadas';
const mesDe = (d: Date) => new Date(d.getTime() - MX).getUTCMonth();
interface Asesor { cobrada: number; ops: Set<string>; leads: number; contactos: Set<string>; cierres: Set<string>; resp: number[]; visitas: number; exclusivas: number; firmadas: number; cerradas: Set<string>; captaciones: number }
interface Venta { e: string | null; v: number; codigo: string | null; closed: Date; created: Date | null; cid: string | null; raw: unknown; tipo: string }
interface Red { inmo: Map<string, Inmo>; asesor: Map<string, Asesor>; ventas: Map<string, Venta[]> }

const nuevaInmo = (): Inmo => ({
    cobrada: 0, opsCobradas: new Set(), cierresVenta: 0, cierresRenta: 0, ventas: [], leads: 0, respondidos: 0, resp: [], visitas: 0,
    contactos: new Set(), contactosVisita: new Set(), contactosCierre: new Set(), captaciones: 0, exclusivas: 0, firmadas: 0,
    asesoresCobro: new Set(), ascensos: 0, ofertas: 0, contactosOferta: new Set(),
    mes: { leads: Array(12).fill(0), visitas: Array(12).fill(0), cierres: Array(12).fill(0), cobrada: Array(12).fill(0), captaciones: Array(12).fill(0), firmadas: Array(12).fill(0) },
});
const nuevoAsesor = (): Asesor => ({ cobrada: 0, ops: new Set(), leads: 0, contactos: new Set(), cierres: new Set(), resp: [], visitas: 0, exclusivas: 0, firmadas: 0, cerradas: new Set(), captaciones: 0 });

/** Ascenso que cuenta: subir con un corte del periodo a un nivel que NUNCA había tenido (Ale, 20-nov: si ya fue élite
 *  alguna vez, volver a élite no es «ascenso del año»). El corte del día 1 de M es el desempeño de M−1. */
function ascensoDelPeriodo(hs: [Date, string][], A: Date, B: Date): { de: string; a: string; ts: Date } | null {
    let prev: string | null = null, max = 0, out: { de: string; a: string; ts: Date } | null = null;
    for (const [ts, l] of hs) {
        const o = ORD[l] ?? 0;
        if (prev && o > (ORD[prev] ?? 0) && o > max && ts >= new Date(A.getTime() + 30 * DIA) && ts < new Date(B.getTime() + 2 * DIA)) out = { de: prev, a: l, ts };
        max = Math.max(max, o);
        prev = l;
    }
    return out;
}

/** Para la métrica de la inmobiliaria: ¿termina el periodo en un nivel más alto que con el que lo empezó?
 *  (nivel vigente el 1-ene contra el del último corte del periodo). Sin la regla de «primera vez» del premio:
 *  aquí se mide si el equipo creció, no a quién se reconoce. Sin nivel al arrancar (llegó en el año) no cuenta. */
function subidaNeta(hs: [Date, string][], A: Date, B: Date): boolean {
    let ini: string | null = null, fin: string | null = null;
    for (const [ts, l] of hs) {
        if (ts.getTime() <= A.getTime() + 2 * DIA) ini = l;
        if (ts.getTime() < B.getTime() + 2 * DIA) fin = l;
    }
    return !!ini && !!fin && (ORD[fin] ?? 0) > (ORD[ini] ?? 0);
}

interface Base { am: AgentMaps; bajas: Set<string>; compInmo: Map<string, string>; agenteInmo: Map<string, string> }
let baseCache: { at: number; p: Promise<Base> } | null = null;
function base(): Promise<Base> {
    if (baseCache && Date.now() - baseCache.at < 12 * 3600_000) return baseCache.p;
    const p = (async () => {
        const [am, bajas, ops] = await Promise.all([agentMaps(), asesoresDeBaja(), opcionesInmobiliarias()]);
        const compInmo = new Map<string, string>();
        for (const o of ops) for (const id of o.ids) compInmo.set(id, o.nombre);
        const agenteInmo = new Map<string, string>();
        const db = await getDb();
        for await (const a of db.collection('agents').find({ email: { $exists: true } }, { projection: { email: 1, 'company._id': 1 } })) {
            const k = compInmo.get(String(dig(a, 'company', '_id') ?? ''));
            if (k) agenteInmo.set(a.email as string, k);
        }
        return { am, bajas, compInmo, agenteInmo };
    })();
    baseCache = { at: Date.now(), p };
    p.catch(() => { baseCache = null; });
    return p;
}

async function barrer(y: number, c: [number, number]): Promise<Red> {
    const db = await getDb();
    const { am, compInmo, agenteInmo } = await base();
    const { A, B } = ventana(y, c);
    const inmo = new Map<string, Inmo>(), asesor = new Map<string, Asesor>(), ventas = new Map<string, Venta[]>();
    const I = (k: string) => inmo.get(k) ?? inmo.set(k, nuevaInmo()).get(k)!;
    const S = (e: string) => asesor.get(e) ?? asesor.set(e, nuevoAsesor()).get(e)!;
    const deComp = (co: unknown) => compInmo.get(String(dig(co, '_id') ?? ''));

    await Promise.all([
        // comisión cobrada (pagos por paymentDate, con split por rol para los asesores)
        (async () => {
            for await (const o of db.collection('operations').find(
                { 'payments.0': { $exists: true }, $or: [{ 'payments.createdAt': { $gte: A, $lt: B } }, { closedAt: { $gte: A, $lt: B } }] },
                { projection: { id: 1, company: 1, closedAt: 1, payments: 1, 'buyer.broker.email': 1, 'seller.broker.email': 1, 'property.agent.email': 1 } })) {
                const k = deComp(o.company);
                if (!k) continue;
                for (const p of (o.payments as Document[]) ?? []) {
                    const d = paymentDate(p, o.closedAt);
                    if (!d || d < A || d >= B) continue;
                    const v = num(dig(p, 'comission', 'value'));
                    if (v <= 0) continue;
                    const r = I(k);
                    r.cobrada += v; r.opsCobradas.add(String(o.id ?? o._id)); r.mes.cobrada[mesDe(d)] += v;
                    for (const [e, x] of splitByRole(o, v, am.pulppo)) {
                        if (agenteInmo.get(e) !== k) continue;
                        const s = S(e); s.cobrada += x; s.ops.add(String(o.id ?? o._id));
                        r.asesoresCobro.add(e);
                    }
                }
            }
        })(),
        // cierres del periodo (sin duplicar paying + closed de la misma venta)
        (async () => {
            const uniq = new Map<string, Document>();
            for await (const o of db.collection('operations').find(
                { closedAt: { $gte: A, $lt: B }, 'status.last': { $in: ['closed', 'paying'] } },
                { projection: { id: 1, closedAt: 1, createdAt: 1, company: 1, side: 1, 'property._id': 1, 'property.internalId': 1, 'property.type': 1,
                    'property.listing.operation': 1, 'property.agent.email': 1, 'closeValue.value': 1, 'buyer.contact._id': 1, 'buyer.broker.email': 1, 'seller.broker.email': 1 } })) {
                const p = dig(o, 'property', '_id'), cid = dig(o, 'buyer', 'contact', '_id');
                uniq.set(p && cid ? `${String(p)}|${String(cid)}|${String(o.side)}` : String(o._id), o);
            }
            for (const o of uniq.values()) {
                const k = deComp(o.company);
                if (!k) continue;
                const r = I(k);
                const op = dig(o, 'property', 'listing', 'operation');
                const cv = num(dig(o, 'closeValue', 'value'));
                if (op === 'sale') { r.cierresVenta += 1; if (cv > 0) r.ventas.push(cv); } else if (op === 'rent') r.cierresRenta += 1;
                if (op === 'sale' || op === 'rent') r.mes.cierres[mesDe(o.closedAt as Date)] += 1;
                const raw = dig(o, 'buyer', 'contact', '_id');
                const cid = raw ? String(raw) : null;
                if (cid) r.contactosCierre.add(cid);
                // el asesor de ESTA inmobiliaria en el trato: comprador, vendedor o quien captó
                const e = [dig(o, 'buyer', 'broker', 'email'), dig(o, 'seller', 'broker', 'email'), dig(o, 'property', 'agent', 'email')]
                    .map((x) => String(x ?? '')).find((x) => x && agenteInmo.get(x) === k) ?? null;
                const be = String(dig(o, 'buyer', 'broker', 'email') ?? '');
                if (cid && be && agenteInmo.get(be) === k) S(be).cierres.add(cid);
                for (const x of new Set([dig(o, 'buyer', 'broker', 'email'), dig(o, 'seller', 'broker', 'email'), dig(o, 'property', 'agent', 'email')].map((y) => String(y ?? ''))))
                    if (x && agenteInmo.get(x) === k) S(x).cerradas.add(String(o._id));
                if (op === 'sale' && cv > 0) (ventas.get(k) ?? ventas.set(k, []).get(k)!).push({
                    e, v: cv, codigo: (dig(o, 'property', 'internalId') as string) ?? null, closed: o.closedAt as Date,
                    created: isDate(o.createdAt) ? o.createdAt : null, cid, raw, tipo: String(dig(o, 'property', 'type') ?? ''),
                });
            }
        })(),
        // leads únicos: misma persona + misma propiedad = 1 lead POR MES (definición del reporte mensual de las KAMs,
        // Ale 23-nov: así el total del año es la suma de los meses y la gráfica mes a mes cuadra)
        (async () => {
            const vistos = new Set<string>();
            for await (const l of db.collection('leads').find({ createdAt: { $gte: A, $lt: B } },
                { projection: { 'company._id': 1, 'agent.uid': 1, 'contact._id': 1, 'property._id': 1, createdAt: 1, answeredAt: 1, source: 1 } })) {
                if (String(l.source ?? '').trim().toLowerCase() === 'formulario de contacto') continue;
                const cid = dig(l, 'contact', '_id'), pid = dig(l, 'property', '_id');
                const m = mesDe(l.createdAt as Date);
                const key = cid && pid ? `${String(cid)}|${String(pid)}|${m}` : String(l._id);
                if (vistos.has(key)) continue;
                vistos.add(key);
                const e = am.uidEmail.get(String(dig(l, 'agent', 'uid') ?? ''));
                // sólo por la compañía del lead, como el reporte mensual (Arpa cuadra al lead: 6,998)
                const k = deComp(l.company);
                if (!k) continue;
                const r = I(k);
                r.leads += 1; r.mes.leads[m] += 1;
                if (cid) r.contactos.add(String(cid));
                const s = e && agenteInmo.get(e) === k ? S(e) : null;
                if (s) { s.leads += 1; if (cid) s.contactos.add(String(cid)); }
                if (isDate(l.answeredAt)) {
                    r.respondidos += 1;
                    // tiempo de 1ª respuesta: sólo leads de 8 am a 8 pm (regla de /mb) y sin las automáticas (<10 s)
                    const ms = l.answeredAt.getTime() - (l.createdAt as Date).getTime();
                    if (ms >= 10_000 && enHorario(l.createdAt as Date)) { r.resp.push(ms / 60000); s?.resp.push(ms / 60000); }
                }
            }
        })(),
        // visitas por fecha de la visita (confirmadas + pendientes)
        (async () => {
            for await (const v of db.collection('visits').find({ startTime: { $gte: A, $lt: B }, 'status.last': { $in: ['confirmed', 'pending'] } },
                { projection: { 'agent.email': 1, 'agent.company._id': 1, 'contact._id': 1, startTime: 1 } })) {
                const e = String(dig(v, 'agent', 'email') ?? '');
                const k = deComp(dig(v, 'agent', 'company')) ?? agenteInmo.get(e);
                if (!k) continue;
                const r = I(k);
                r.visitas += 1;
                if (isDate(v.startTime)) r.mes.visitas[mesDe(v.startTime)] += 1;
                const cid = dig(v, 'contact', '_id');
                if (cid) r.contactosVisita.add(String(cid));
                if (e && agenteInmo.get(e) === k) S(e).visitas += 1;
            }
        })(),
        // captaciones (propiedades dadas de alta) y exclusivas (contract.exclusive.start)
        (async () => {
            for await (const p of db.collection('properties').find({ $or: [{ createdAt: { $gte: A, $lt: B } }, { 'contract.exclusive.start': { $gte: A, $lt: B } }] },
                { projection: { company: 1, createdAt: 1, 'agent.email': 1, 'contract.exclusive.start': 1, 'contract.status': 1 } })) {
                const k = deComp(p.company);
                if (!k) continue;
                const r = I(k);
                const ea = String(dig(p, 'agent', 'email') ?? '');
                if (isDate(p.createdAt) && p.createdAt >= A && p.createdAt < B) { r.captaciones += 1; r.mes.captaciones[mesDe(p.createdAt)] += 1; if (ea && agenteInmo.get(ea) === k) S(ea).captaciones += 1; }
                const ex = dig(p, 'contract', 'exclusive', 'start');
                if (isDate(ex) && ex >= A && ex < B) {
                    const firm = dig(p, 'contract', 'status') === 'completed';
                    r.exclusivas += 1; if (firm) { r.firmadas += 1; r.mes.firmadas[mesDe(ex)] += 1; }
                    const e = String(dig(p, 'agent', 'email') ?? '');
                    if (e && agenteInmo.get(e) === k) { const s = S(e); s.exclusivas += 1; if (firm) s.firmadas += 1; }
                }
            }
        })(),
        // ofertas del periodo (una operación nace como oferta): para el embudo leads → visitas → ofertas → cierres
        (async () => {
            const vistas = new Set<string>();
            for await (const o of db.collection('operations').find({ createdAt: { $gte: A, $lt: B } },
                { projection: { company: 1, 'property._id': 1, 'buyer.contact._id': 1 } })) {
                const k = deComp(o.company);
                if (!k) continue;
                const p = dig(o, 'property', '_id'), cid = dig(o, 'buyer', 'contact', '_id');
                const key = `${k}|${p && cid ? `${String(p)}|${String(cid)}` : String(o._id)}`;
                if (vistas.has(key)) continue;
                vistas.add(key);
                const r = I(k);
                r.ofertas += 1;
                if (cid) r.contactosOferta.add(String(cid));
            }
        })(),
    ]);
    // cohortes: sólo cuentan los contactos que también fueron lead de la inmobiliaria en el periodo
    for (const r of inmo.values()) {
        r.contactosOferta = new Set([...r.contactosOferta].filter((x) => r.contactos.has(x)));
        r.contactosVisita = new Set([...r.contactosVisita].filter((x) => r.contactos.has(x)));
        r.contactosCierre = new Set([...r.contactosCierre].filter((x) => r.contactos.has(x)));
    }
    for (const s of asesor.values()) s.cierres = new Set([...s.cierres].filter((x) => s.contactos.has(x)));
    // asesores que terminan el periodo en un nivel más alto que con el que lo empezaron
    for (const [e, hs] of am.hist) {
        const k = agenteInmo.get(e);
        if (!k) continue;
        if (subidaNeta(hs, A, B)) I(k).ascensos += 1;
    }
    return { inmo, asesor, ventas };
}

const redCache = new Map<string, { at: number; p: Promise<Red> }>();
function red(y: number, c: [number, number]): Promise<Red> {
    const key = `${y}:${c.join('-')}`;
    const hit = redCache.get(key);
    if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.p;
    const p = barrer(y, c);
    redCache.set(key, { at: Date.now(), p });
    p.catch(() => redCache.delete(key));
    return p;
}

let invCache: { at: number; p: Promise<Map<string, number>> } | null = null;
function inventarioHoy(): Promise<Map<string, number>> {
    if (invCache && Date.now() - invCache.at < 12 * 3600_000) return invCache.p;
    const p = (async () => {
        const db = await getDb();
        const { compInmo } = await base();
        const out = new Map<string, number>();
        for await (const x of db.collection('properties').aggregate([{ $match: { 'status.last': 'published' } }, { $group: { _id: '$company._id', n: { $sum: 1 } } }])) {
            const k = compInmo.get(String(x._id));
            if (k) out.set(k, (out.get(k) ?? 0) + (x.n as number));
        }
        return out;
    })();
    invCache = { at: Date.now(), p };
    p.catch(() => { invCache = null; });
    return p;
}

// ── TU AÑO ────────────────────────────────────────────────────────────────────
export type Fmt = 'money' | 'int' | 'pct' | 'min';
export interface Metrica {
    key: string; label: string; grupo: string; fmt: Fmt;
    /** +1 = más es mejor, −1 = menos es mejor, 0 = descriptiva (no genera logros ni pendientes) */
    dir: 1 | -1 | 0;
    ayuda: string;
    valores: Record<number, number | null>;
    pares: number | null;
    /** 0–100: qué porcentaje de sus pares queda por debajo (ya orientado: 100 = la mejor) */
    pctl: number | null;
}
export interface Hallazgo {
    titulo: string; texto: string; metrica: string;
    /** contra qué se midió: el año pasado (marca la tarjeta), el arranque del año, o el mejor de los tres años */
    vs: 'año' | 'trimestre' | 'récord';
}
export interface Serie { key: SerieKey; label: string; fmt: Fmt; vals: number[] }
export interface Mensual {
    /** meses que entran (0 = enero … último del corte) y si el último va a medias */
    meses: string[]; parcial: boolean;
    series: Serie[];
    mejorMes: { mes: string; cierres: number; i: number } | null;
    mayor: { valor: number; tipo: string; fecha: string; codigo: string | null } | null;
}
export interface Embudo {
    /** PERSONAS (no leads): quienes escribieron, y de ellas cuántas visitaron, ofertaron y cerraron */
    pasos: { label: string; n: number }[];
    /** tasas contra el promedio de Pulppo: SÓLO tasas (en volumen las grandes siempre ganan y sería spoiler) */
    tasas: { key: string; label: string; yo: number | null; red: number | null }[];
}
export interface Inventario {
    hoy: { venta: number; renta: number }; ene: { venta: number; renta: number };
    /** foto de hoy (Pulppo no guarda su historial): % en calidad Alta y % en precio Óptimo como en Propiedades */
    calidadAlta: number | null; enPrecio: number | null; conPrecio: number;
}
export interface FilaEquipo { nombre: string; nivel: NivelKey; leads: number; visitas: number; cierres: number }
export interface Equipo {
    activos: number; filas: FilaEquipo[];
    /** asesores activos (sin administrativos) sin un solo lead en 90 días o más */
    sinLeads: { nombre: string; ultimo: string | null }[];
    tareasVencidas: number; tareasPendientes: number;
}
export interface TuAnio {
    inmobiliaria: string; corte: string; años: number[];
    /** null para la inmobiliaria: los pares sólo los ve el equipo Pulppo */
    pares: { n: number; desde: number; hasta: number; publicadas: number } | null;
    metricas: Metrica[];
    logros: Hallazgo[]; falto: Hallazgo[];
    mensual: Mensual; embudo: Embudo; inventario: Inventario | null; equipo: Equipo;
    generado: string;
}

type Calc = (r: Inmo | undefined) => number | null;
const DEF: Array<{ key: string; label: string; grupo: string; fmt: Fmt; dir: 1 | -1 | 0; peso: number; min?: (r: Inmo) => boolean; f: Calc; ayuda: string; frase?: (v: string) => string }> = [
    { key: 'cobrada', frase: (v) => `${v} de comisión cobrada`,  label: 'Comisión cobrada', grupo: 'Resultados', fmt: 'money', dir: 1, peso: 1.6, f: (r) => r?.cobrada ?? 0,
        ayuda: 'La comisión que ya te pagaron en el periodo (no cuenta la que está por cobrar).' },
    { key: 'cierresVenta', frase: (v) => `${v} ventas cerradas`,  label: 'Ventas cerradas', grupo: 'Resultados', fmt: 'int', dir: 1, peso: 1.3, f: (r) => r?.cierresVenta ?? 0,
        ayuda: 'Ventas que tu inmobiliaria cerró en el periodo.' },
    { key: 'cierresRenta', frase: (v) => `${v} rentas cerradas`,  label: 'Rentas cerradas', grupo: 'Resultados', fmt: 'int', dir: 1, peso: 1.1, f: (r) => r?.cierresRenta ?? 0,
        ayuda: 'Rentas que tu inmobiliaria cerró en el periodo.' },
    { key: 'ticket', label: 'Ticket mediano de venta', grupo: 'Resultados', fmt: 'money', dir: 1, peso: 0.8, f: (r) => median(r?.ventas ?? []),
        ayuda: 'El precio de cierre de la venta de en medio: la mitad de tus ventas se cerró arriba de este precio y la mitad abajo.' },
    { key: 'leads', frase: (v) => `${v} leads`,  label: 'Leads', grupo: 'Comercial', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.leads ?? 0,
        ayuda: 'Personas que preguntaron por alguna de tus propiedades. Si la misma persona pregunta varias veces por la misma propiedad, cuenta una sola vez.' },
    // Sin «leads respondidos» ni «tiempo de 1ª respuesta»: en 2026 hubo muchos problemas con WhatsApp y
    // `answeredAt` depende de que el asesor lo tenga vinculado; comparar contra 2025 sería injusto (Ale, 20-nov).
    { key: 'visitas', frase: (v) => `${v} visitas`,  label: 'Visitas', grupo: 'Comercial', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.visitas ?? 0,
        ayuda: 'Visitas del periodo, confirmadas o por confirmar, contadas por el día de la visita.' },
    { key: 'tasaVisita', label: 'Leads que visitan', grupo: 'Comercial', fmt: 'pct', dir: 1, peso: 1.2, min: (r) => r.contactos.size >= 50,
        f: (r) => (r && r.contactos.size ? r.contactosVisita.size / r.contactos.size : null), ayuda: 'De cada 100 personas que te escribieron en el periodo, cuántas fueron a ver una propiedad con tu equipo.' },
    { key: 'leadCierre', label: 'Leads que cierran', grupo: 'Comercial', fmt: 'pct', dir: 1, peso: 1.2, min: (r) => r.contactos.size >= 100,
        f: (r) => (r && r.contactos.size ? r.contactosCierre.size / r.contactos.size : null), ayuda: 'De cada 100 personas que te escribieron en el periodo, cuántas terminaron comprando o rentando con tu equipo.' },
    { key: 'captaciones', frase: (v) => `${v} propiedades captadas`,  label: 'Propiedades captadas', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.captaciones ?? 0,
        ayuda: 'Propiedades nuevas que tu equipo dio de alta en Pulppo en el periodo.' },
    { key: 'firmadas', frase: (v) => `${v} exclusivas firmadas`,  label: 'Exclusivas firmadas', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1.1, f: (r) => r?.firmadas ?? 0,
        ayuda: 'Exclusivas nuevas del periodo con el contrato firmado y cargado en Pulppo.' },
    { key: 'asesoresCobro', frase: (v) => `${v} asesores cobrando`,  label: 'Asesores que cobraron', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.asesoresCobro.size ?? 0,
        ayuda: 'Cuántos de tus asesores cobraron al menos una comisión en el periodo.' },
    { key: 'ascensos', frase: (v) => (v === '1' ? '1 asesor subió de nivel' : `${v} asesores subieron de nivel`),  label: 'Asesores que subieron de nivel', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 0.9, f: (r) => r?.ascensos ?? 0,
        ayuda: 'Asesores que terminan el periodo en un nivel más alto (Estándar → Profesional → Élite) que el que tenían el 1 de enero.' },
];

const fmtVal = (v: number, f: Fmt) => {
    if (f === 'money') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} MDP` : `$${Math.round(v).toLocaleString('es-MX')}`;
    if (f === 'pct') { const p = v * 100; return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`; }
    if (f === 'min') return v >= 90 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
    return Math.round(v).toLocaleString('es-MX');
};
const sigPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;

export async function tuAnio(companyId: string): Promise<TuAnio | null> {
    const { compInmo } = await base();
    const k = compInmo.get(companyId);
    if (!k) return null;
    const c = corte();
    const años = [AÑO - 2, AÑO - 1, AÑO];
    const [r24, r25, r26, inv] = await Promise.all([red(años[0], c), red(años[1], c), red(años[2], c), inventarioHoy()]);
    const R: Record<number, Red> = { [años[0]]: r24, [años[1]]: r25, [años[2]]: r26 };

    // pares: cuartil de inventario publicado hoy entre las inmobiliarias de la lista con inventario
    const orden = [...inv.entries()].filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
    const pos = orden.findIndex(([x]) => x === k);
    const q = pos < 0 ? 0 : Math.min(3, Math.floor((pos * 4) / orden.length));
    const grupo = orden.filter((_, i) => Math.min(3, Math.floor((i * 4) / orden.length)) === q);
    const pares = grupo.map(([x]) => x).filter((x) => x !== k);

    const metricas: Metrica[] = DEF.map((d) => {
        const valores: Record<number, number | null> = {};
        for (const y of años) {
            const r = R[y].inmo.get(k);
            valores[y] = d.min && r && !d.min(r) ? null : d.min && !r ? null : d.f(r);
        }
        const pv = pares.map((x) => R[AÑO].inmo.get(x)).filter((r) => !d.min || (r && d.min(r))).map((r) => d.f(r)).filter((v): v is number => v != null);
        const yo = valores[AÑO];
        let pctl: number | null = null;
        if (yo != null && pv.length >= 4 && d.dir !== 0) {
            const peor = pv.filter((v) => (d.dir === 1 ? v < yo : v > yo)).length, igual = pv.filter((v) => v === yo).length;
            pctl = Math.round((100 * (peor + igual / 2)) / pv.length);
        }
        return { key: d.key, label: d.label, grupo: d.grupo, fmt: d.fmt, dir: d.dir, ayuda: d.ayuda, valores, pares: median(pv), pctl };
    });

    // ── hallazgos: SÓLO contra sí misma (Ale, 20-nov): contra los pares sería spoiler de la gala y, para las grandes,
    //    no dice nada (Diamond House está lejísimos de las de su cuartil). Un veredicto por métrica, ±5% o más
    //    (el mismo umbral que pinta de verde/rojo las tarjetas). ──
    const r26i = R[AÑO].inmo.get(k);

    // ── mes a mes (sólo el año en curso) ──
    const finCorte = new Date(Date.UTC(AÑO, c[0], c[1]) - DIA);
    const ultimo = finCorte.getUTCMonth();
    const parcial = new Date(finCorte.getTime() + DIA).getUTCDate() !== 1;
    const SER: Array<[SerieKey, string, Fmt]> = [['leads', 'Leads', 'int'], ['visitas', 'Visitas', 'int'], ['cierres', 'Cierres', 'int'],
        ['cobrada', 'Comisión cobrada', 'money'], ['captaciones', 'Propiedades captadas', 'int'], ['firmadas', 'Exclusivas firmadas', 'int']];
    const series: Serie[] = SER.map(([key, label, fmt]) => ({ key, label, fmt, vals: (r26i?.mes[key] ?? Array(12).fill(0)).slice(0, ultimo + 1) }));
    const cier = series.find((x) => x.key === 'cierres')!.vals, cob = series.find((x) => x.key === 'cobrada')!.vals;
    let mm = -1;
    cier.forEach((x, i) => { if (x > 0 && (mm < 0 || x > cier[mm] || (x === cier[mm] && cob[i] > cob[mm]))) mm = i; });
    const vs26 = R[AÑO].ventas.get(k) ?? [];
    const big = vs26.reduce<Venta | null>((a, b) => (!a || b.v > a.v ? b : a), null);
    const fecha = (d: Date) => { const x = new Date(d.getTime() - MX); return `${x.getUTCDate()} ${MES_C[x.getUTCMonth()]}`; };
    const mensual: Mensual = {
        meses: MES_C.slice(0, ultimo + 1), parcial, series,
        mejorMes: mm >= 0 ? { mes: MES[mm].charAt(0).toUpperCase() + MES[mm].slice(1), cierres: cier[mm], i: mm } : null,
        mayor: big ? { valor: big.v, tipo: big.tipo, fecha: fecha(big.closed), codigo: big.codigo } : null,
    };

    // ── embudo por personas y tasas contra el promedio de Pulppo (muestra mínima: 30 personas / 10 que visitaron) ──
    const visCierre = (r: Inmo) => [...r.contactosCierre].filter((x) => r.contactosVisita.has(x)).length;
    let sc = 0, sv = 0, scc = 0, svv = 0, svc = 0;
    for (const r of R[AÑO].inmo.values()) {
        if (r.contactos.size >= 30) { sc += r.contactos.size; sv += r.contactosVisita.size; scc += r.contactosCierre.size; }
        if (r.contactosVisita.size >= 10) { svv += r.contactosVisita.size; svc += visCierre(r); }
    }
    const tasas: Embudo['tasas'] = [
        { key: 'tasaVisita', label: 'Lead → visita', yo: r26i && r26i.contactos.size >= 30 ? r26i.contactosVisita.size / r26i.contactos.size : null, red: sc ? sv / sc : null },
        { key: 'visitaCierre', label: 'Visita → cierre', yo: r26i && r26i.contactosVisita.size >= 10 ? visCierre(r26i) / r26i.contactosVisita.size : null, red: svv ? svc / svv : null },
        { key: 'leadCierre', label: 'Lead → cierre', yo: r26i && r26i.contactos.size >= 30 ? r26i.contactosCierre.size / r26i.contactos.size : null, red: sc ? scc / sc : null },
    ];
    const embudo: Embudo = {
        pasos: [
            { label: 'Te escribieron', n: r26i?.contactos.size ?? 0 }, { label: 'Visitaron', n: r26i?.contactosVisita.size ?? 0 },
            { label: 'Hicieron una oferta', n: r26i?.contactosOferta.size ?? 0 }, { label: 'Compraron o rentaron', n: r26i?.contactosCierre.size ?? 0 },
        ],
        tasas,
    };

    const UMBRAL = 0.05;
    const cand: Array<Hallazgo & { s: number; tipo: 'logro' | 'falto' }> = [];
    for (const m of metricas) {
        const d = DEF.find((x) => x.key === m.key)!;
        if (m.dir === 0) continue;
        const v = m.valores[AÑO], ant = m.valores[AÑO - 1], ant2 = m.valores[AÑO - 2];
        if (v == null || ant == null || ant <= 0 || (m.fmt === 'int' && ant < 5 && v < 5)) continue;
        const cambio = ((v - ant) / ant) * m.dir;
        const F = (x: number) => fmtVal(x, m.fmt);
        const dicho = d.frase ? d.frase(F(v)) : `${m.label}: ${F(v)}`;
        const Dicho = dicho.charAt(0).toUpperCase() + dicho.slice(1);
        if (Math.round(Math.abs(cambio) * 100) < UMBRAL * 100) {
            // sin cambio claro contra el año pasado, pero el mejor de los tres años: también es logro (con menos peso)
            if (ant2 != null && ant2 > 0 && v * m.dir > Math.max(ant, ant2) * m.dir && ((v - ant2) / ant2) * m.dir >= UMBRAL)
                cand.push({ tipo: 'logro', vs: 'récord', s: 0.02 * d.peso, metrica: m.key, titulo: m.label,
                    texto: `${Dicho}: tu mejor cifra de los tres años, ${sigPct((v - ant2) / ant2)} contra ${AÑO - 2}.` });
            continue;
        }
        const sube = cambio > 0;
        let t: string;
        if (m.fmt === 'pct') {
            t = `${m.label}: ${F(v)}, contra ${F(ant)} en ${AÑO - 1}.`;
            const n = Math.round(Math.abs(ant - v) * (r26i?.contactos.size ?? 0));
            if (n >= 1) t += m.key === 'tasaVisita'
                ? (sube ? ` Son ~${n.toLocaleString('es-MX')} personas más visitando que con la tasa de ${AÑO - 1}.` : ` Con la tasa de ${AÑO - 1} serían ~${n.toLocaleString('es-MX')} personas más visitando.`)
                : (sube ? ` Son ~${n} cierres más que con la conversión de ${AÑO - 1}.` : ` Con la conversión de ${AÑO - 1} serían ~${n} cierres más.`);
            // bajó contra sí misma pero sigue arriba de la red: se dice, para que el mensaje sea justo (feedback de Karen)
            const rd = tasas.find((x) => x.key === m.key)?.red;
            if (!sube && rd != null && v > rd) t += ` Aun así, sigue arriba del promedio de Pulppo (${F(rd)}).`;
        } else t = `${Dicho}, ${sigPct((v - ant) / ant)} contra el mismo periodo de ${AÑO - 1} (${F(Math.abs(v - ant))} ${v > ant ? 'más' : 'menos'}).`;
        cand.push({ tipo: sube ? 'logro' : 'falto', vs: 'año', s: Math.min(Math.abs(cambio), 1.5) * d.peso, metrica: m.key, titulo: m.label, texto: t });
    }
    // Logros DENTRO del año (Ale, 23-nov): los últimos 3 meses completos contra los 3 primeros (o los 3 primeros con
    // actividad, para las que llegaron a media año). Así hay logros aunque no haya año pasado contra qué medir.
    // Umbral más alto (+15%) porque un trimestre es más ruidoso que un año. Sin respuesta: en 2026 hubo problemas de WhatsApp.
    if (r26i) {
        const nComp = mensual.parcial ? mensual.meses.length - 1 : mensual.meses.length;
        const ini = r26i.mes.leads.findIndex((x, i) => x > 0 || r26i.mes.cierres[i] > 0);
        if (ini >= 0 && nComp - ini >= 6) {
            const q0 = [ini, ini + 1, ini + 2], q1 = [nComp - 3, nComp - 2, nComp - 1];
            const rango = (q: number[]) => `${MES_C[q[0]]}–${MES_C[q[2]]}`;
            for (const se of mensual.series) {
                const a = q0.reduce((x, i) => x + se.vals[i], 0), b = q1.reduce((x, i) => x + se.vals[i], 0);
                if (a <= 0 || (se.fmt === 'int' && b < 6)) continue;
                const ch = (b - a) / a;
                if (ch < 0.15) continue;
                const peso = DEF.find((x) => x.key === se.key)?.peso ?? 1.2;
                const F = (x: number) => fmtVal(x, se.fmt);
                cand.push({ tipo: 'logro', vs: 'trimestre', s: Math.min(ch, 1.5) * peso * 0.5, metrica: se.key, titulo: `${se.label}: cerraste más fuerte`,
                    texto: `${F(b)} en ${rango(q1)} contra ${F(a)} en ${rango(q0)} (${sigPct(ch)}). El equipo terminó el año con más ritmo del que lo empezó.` });
            }
        }
    }
    const elegir = (t: 'logro' | 'falto', max: number) => {
        const usados = new Set<string>(), out: Hallazgo[] = [];
        // primero lo que se mide contra el año pasado; lo del trimestre y el récord sólo completan (Ale, 23-nov)
        const orden = (h: Hallazgo) => (h.vs === 'año' ? 0 : 1);
        for (const h of cand.filter((x) => x.tipo === t).sort((a, b) => orden(a) - orden(b) || b.s - a.s)) {
            if (usados.has(h.metrica) || out.length >= max) continue;
            usados.add(h.metrica); out.push({ titulo: h.titulo, texto: h.texto, metrica: h.metrica, vs: h.vs });
        }
        return out;
    };
    // parejos: tantos pendientes como logros (Ale no quería 1 logro contra 3 pendientes); al menos uno si lo hay
    const logros = elegir('logro', 3);
    const falto = elegir('falto', Math.max(1, logros.length));
    const [inventario, equipo] = await Promise.all([inventarioDe(k, companyId), equipoDe(k)]);
    return {
        inmobiliaria: k, corte: corteTexto(c), años,
        pares: { n: grupo.length, desde: grupo[0]?.[1] ?? 0, hasta: grupo[grupo.length - 1]?.[1] ?? 0, publicadas: inv.get(k) ?? 0 },
        metricas, logros, falto, mensual, embudo, inventario, equipo, generado: new Date().toISOString(),
    };
}

/** Compañías de la inmobiliaria (lista canónica) y su equipo activo, sin bajas ni cuentas de servicio. */
async function activosDe(k: string) {
    const { compInmo, bajas } = await base();
    const db = await getDb();
    const comps = [...compInmo.entries()].filter(([, n]) => n === k).map(([id]) => new ObjectId(id));
    const todos = await db.collection('agents').find({ 'company._id': { $in: comps }, status: 'active', email: { $exists: true } },
        { projection: { email: 1, type: 1, firstName: 1, lastName: 1, uid: 1 } }).toArray();
    // fuera cuentas de servicio que no son brokers («Operaciones Temp» en DH)
    const servicio = (a: Document) => /\b(temp|prueba|test|operaciones|demo)\b/i.test(`${a.firstName ?? ''} ${a.lastName ?? ''}`);
    return { comps, todos, equipo: todos.filter((a) => !bajas.has(a.email as string) && !servicio(a)) };
}

/** Inventario publicado hoy contra el 1-ene (reconstruido con el historial de status), y calidad/precio de hoy con
 *  el mismo cálculo de la pestaña Propiedades de /mb (para que el dueño vea el mismo número en los dos lados). */
async function inventarioDe(k: string, companyId: string): Promise<Inventario | null> {
    try {
        const db = await getDb();
        const { comps } = await activosDe(k);
        const ene = new Date(Date.UTC(AÑO, 0, 1) + MX).getTime();
        const hoy = { venta: 0, renta: 0 }, alIni = { venta: 0, renta: 0 };
        for await (const p of db.collection('properties').find({ 'company._id': { $in: comps }, 'status.history.status': 'published' },
            { projection: { 'status.last': 1, 'status.history': 1, 'listing.operation': 1 } })) {
            const op = dig(p, 'listing', 'operation') === 'sale' ? 'venta' : dig(p, 'listing', 'operation') === 'rent' ? 'renta' : null;
            if (!op) continue;
            if (dig(p, 'status', 'last') === 'published') hoy[op] += 1;
            let st: string | null = null, t0 = -Infinity;
            for (const h of (dig(p, 'status', 'history') as Document[] | undefined) ?? []) {
                const t = new Date(h?.timestamp as string | Date).getTime();
                if (!isNaN(t) && t <= ene && t >= t0) { t0 = t; st = String(h.status); }
            }
            if (st === 'published') alIni[op] += 1;
        }
        const mb = await fetchInmobiliaria(companyId).catch(() => null);
        const props = mb?.props ?? [];
        const conPrecio = props.filter((x) => x.estado !== 'Haz ACM');
        return {
            hoy, ene: alIni,
            calidadAlta: props.length ? props.filter((x) => x.calidad === 'Alta').length / props.length : null,
            enPrecio: conPrecio.length ? conPrecio.filter((x) => x.estado === 'Óptimo').length / conPrecio.length : null,
            conPrecio: conPrecio.length,
        };
    } catch { return null; }
}

/** Equipo: tabla del año por asesor, red flags (sin leads 90+ días, sin administrativos) y tareas vencidas hoy. */
async function equipoDe(k: string): Promise<Equipo> {
    const { am } = await base();
    const db = await getDb();
    const { equipo } = await activosDe(k);
    const r = await red(AÑO, corte());
    const emailUid = new Map([...am.uidEmail.entries()].map(([u, e]) => [e, u]));
    const nombre = (a: Document) => limpio(am.name.get(a.email as string) ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`);
    const nivel = (e: string): NivelKey => { const l = am.level.get(e); return l === 'elite' || l === 'professional' ? l : 'standard'; };
    const filas: FilaEquipo[] = equipo.map((a) => {
        const e = a.email as string, s = r.asesor.get(e);
        return { nombre: nombre(a), nivel: nivel(e), leads: s?.leads ?? 0, visitas: s?.visitas ?? 0, cierres: s?.cerradas.size ?? 0 };
    }).sort((a, b) => b.cierres - a.cierres || b.leads - a.leads);

    // sin leads: los que atienden clientes (no master ni staff: ésos pueden ser administrativos)
    const brokers = equipo.filter((a) => a.type !== 'master' && a.type !== 'staff');
    const uids = brokers.map((a) => (a.uid as string) ?? emailUid.get(a.email as string)).filter(Boolean) as string[];
    const ult = new Map<string, Date>();
    for (const x of await db.collection('leads').aggregate([
        { $match: { 'agent.uid': { $in: uids }, createdAt: { $gte: new Date(Date.now() - 400 * DIA) } } },
        { $group: { _id: '$agent.uid', u: { $max: '$createdAt' } } },
    ]).toArray()) ult.set(String(x._id), x.u as Date);
    const lim = Date.now() - 90 * DIA;
    const sinLeads = brokers.map((a) => {
        const u = ult.get((a.uid as string) ?? emailUid.get(a.email as string) ?? '');
        return { nombre: nombre(a), u };
    }).filter((x) => !x.u || x.u.getTime() < lim)
        .map((x) => ({ nombre: x.nombre, ultimo: x.u ? `${MES[mesDe(x.u)]} ${new Date(x.u.getTime() - MX).getUTCFullYear()}` : null }));

    const emails = equipo.map((a) => a.email as string);
    const [tareasPendientes, tareasVencidas] = await Promise.all([
        db.collection('tasks').countDocuments({ 'agent.email': { $in: emails }, status: 'pending' }),
        db.collection('tasks').countDocuments({ 'agent.email': { $in: emails }, status: 'pending', dueDate: { $lt: new Date() } }),
    ]);
    return { activos: equipo.length, filas, sinLeads, tareasVencidas, tareasPendientes };
}

// ── RECONOCIMIENTOS ───────────────────────────────────────────────────────────
// Títulos neutros («Broker del año», no «Asesor/Asesora»): la base no guarda el género y no lo adivinamos por el nombre.
export interface Ganador {
    email: string; nombre: string; first: string; last: string; photo: string | null; nivel: string | null;
    /** 1, 2 o 3 en el podio (en «Ascenso del año» todos son 1) */
    lugar: number;
    /** para la carta (interna): puede llevar montos */
    valor: string; detalle: string;
    /** para redes: SIN montos, para no exponer a nadie (Ale, 20-nov). Vacío = no se pone dato. */
    valorRed: string; detalleRed: string;
    /** «Ascenso del año»: el nivel al que llegó, para ponerle su badge */
    badge?: NivelKey;
}
export interface Premio { key: string; titulo: string; porque: string; regla: string; podio: Ganador[]; varios?: boolean }
export type NivelKey = 'elite' | 'professional' | 'standard';
/** Diploma de cierre de año para TODO el equipo activo: su nivel de hoy y lo que hizo en el año (sin montos). */
export interface Diploma {
    email: string; nombre: string; first: string; last: string; photo: string | null; nivel: NivelKey;
    cierres: number; visitas: number; captaciones: number; exclusivas: number; subio: string | null;
}
export interface Reconocimientos {
    inmobiliaria: string; logo: string | null; corte: string; año: number; premios: Premio[];
    /** master brokers activos: firman por la inmobiliaria */
    masters: string[];
    equipo: Diploma[];
    generado: string;
}

const limpio = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function reconocimientos(companyId: string): Promise<Reconocimientos | null> {
    const { am, bajas, compInmo, agenteInmo } = await base();
    const k = compInmo.get(companyId);
    if (!k) return null;
    const c = corte();
    const r = await red(AÑO, c);
    const { A, B } = ventana(AÑO, c);
    const db = await getDb();
    const mios = [...r.asesor.entries()].filter(([e]) => agenteInmo.get(e) === k && !bajas.has(e));
    const persona = (e: string, lugar: number, valor: string, detalle: string, valorRed = valor, detalleRed = detalle): Ganador => {
        const [first, last] = am.parts.get(e) ?? [am.name.get(e) ?? e, ''];
        return { email: e, nombre: limpio(am.name.get(e) ?? e), first: limpio(first), last: limpio(last), photo: am.photo.get(e) ?? null,
            nivel: LVL[am.level.get(e) ?? ''] ?? null, lugar, valor, detalle, valorRed, detalleRed };
    };
    const top3 = <T,>(xs: T[]) => xs.slice(0, 3);
    const money = (v: number) => fmtVal(v, 'money');
    const ops = (n: number) => `${n} ${n === 1 ? 'operación' : 'operaciones'}`;

    const premios: Premio[] = [];
    premios.push({ key: 'broker', titulo: 'Broker del año', porque: 'Por ser quien más comisión cobró este año.',
        regla: 'Comisión cobrada en el año, repartida por rol en cada operación (como en los premios de la gala). En redes no va el monto.',
        podio: top3(mios.filter(([, s]) => s.cobrada > 0).sort((a, b) => b[1].cobrada - a[1].cobrada))
            .map(([e, s], i) => persona(e, i + 1, money(s.cobrada), ops(s.ops.size), i ? '' : 'Mayor comisión', i ? '' : `cobrada en ${k} este año`)) });
    premios.push({ key: 'captacion', titulo: 'Captación del año', porque: 'Por firmar más exclusivas que nadie en el equipo.',
        regla: 'Exclusivas que arrancaron en el año con contrato completo en la plataforma; desempata el total de exclusivas.',
        podio: top3(mios.filter(([, s]) => s.firmadas > 0).sort((a, b) => b[1].firmadas - a[1].firmadas || b[1].exclusivas - a[1].exclusivas))
            .map(([e, s], i) => persona(e, i + 1, `${s.firmadas} ${s.firmadas === 1 ? 'exclusiva firmada' : 'exclusivas firmadas'}`, `de ${s.exclusivas} exclusivas`)) });
    premios.push({ key: 'relampago', titulo: 'Respuesta relámpago', porque: 'Por ser quien más rápido le contesta a sus clientes.',
        regla: 'Mediana del tiempo de 1ª respuesta con al menos 20 leads respondidos de 8 am a 8 pm; sin respuestas automáticas (<10 s).',
        podio: top3(mios.filter(([, s]) => s.resp.length >= 20).map(([e, s]) => [e, median(s.resp)!, s.resp.length] as const).sort((a, b) => a[1] - b[1]))
            .map(([e, m, n], i) => persona(e, i + 1, fmtVal(m, 'min'), `${n} leads respondidos`, fmtVal(m, 'min'), 'para contestar a sus clientes')) });
    premios.push({ key: 'visitas', titulo: 'Récord de visitas', porque: 'Por ser quien más visitas hizo en el año.',
        regla: 'Visitas confirmadas o pendientes con fecha en el año (mínimo 5).',
        podio: top3(mios.filter(([, s]) => s.visitas >= 5).sort((a, b) => b[1].visitas - a[1].visitas))
            .map(([e, s], i) => persona(e, i + 1, `${s.visitas.toLocaleString('es-MX')} visitas`, `${s.leads.toLocaleString('es-MX')} leads atendidos`, `${s.visitas.toLocaleString('es-MX')} visitas`, 'en el año')) });
    premios.push({ key: 'conversion', titulo: 'Mejor conversión', porque: 'Por convertir en cierre la mayor parte de sus leads.',
        regla: 'De las personas que le escribieron en el año (mínimo 40), cuántas compraron o rentaron con esa persona.',
        podio: top3(mios.filter(([, s]) => s.contactos.size >= 40 && s.cierres.size > 0)
            .sort((a, b) => b[1].cierres.size / b[1].contactos.size - a[1].cierres.size / a[1].contactos.size || b[1].cierres.size - a[1].cierres.size))
            .map(([e, s], i) => persona(e, i + 1, fmtVal(s.cierres.size / s.contactos.size, 'pct'), `${s.cierres.size} de ${s.contactos.size} personas`, `${s.cierres.size} de ${s.contactos.size}`, 'personas que le escribieron cerraron')) });

    const ventas = (r.ventas.get(k) ?? []).filter((v) => v.e && !bajas.has(v.e));
    premios.push({ key: 'ventaMayor', titulo: 'Venta del año', porque: 'Por cerrar la venta de mayor valor de la inmobiliaria.',
        regla: 'Precio de cierre de las ventas cerradas en el año (la mejor de cada broker). En redes no se muestra el monto.',
        podio: top3([...ventas].sort((a, b) => b.v - a.v).filter((v, i, xs) => xs.findIndex((x) => x.e === v.e) === i))
            .map((v, i) => persona(v.e!, i + 1, money(v.v), v.codigo ?? '', '', '')) });

    // venta más rápida: primer lead del comprador → cierre; ventas de $2M+ sin terrenos, lead anterior a la operación (reglas de la gala)
    const rapidas = ventas.filter((v) => v.cid && v.v >= 2_000_000 && !/terreno|lote/i.test(v.tipo));
    const primer = new Map<string, number>();
    if (rapidas.length) for await (const l of db.collection('leads').find({ 'contact._id': { $in: rapidas.map((v) => v.raw as ObjectId) } }, { projection: { 'contact._id': 1, createdAt: 1 } })) {
        const cid = String(dig(l, 'contact', '_id') ?? '');
        if (isDate(l.createdAt)) primer.set(cid, Math.min(primer.get(cid) ?? Infinity, l.createdAt.getTime()));
    }
    premios.push({ key: 'ventaRapida', titulo: 'Venta más rápida', porque: 'Por llevar a un cliente del primer contacto al cierre en tiempo récord.',
        regla: 'Días del primer lead del comprador al cierre. Ventas de $2 MDP o más, sin terrenos, con el lead anterior a la operación.',
        podio: top3(rapidas.map((v) => {
            const l = primer.get(v.cid!);
            const ok = l != null && (!v.created || l <= v.created.getTime());
            return { v, d: ok ? (v.closed.getTime() - l!) / DIA : null };
        }).filter((x) => x.d != null && x.d >= 1).sort((a, b) => a.d! - b.d!).filter((x, i, xs) => xs.findIndex((y) => y.v.e === x.v.e) === i))
            .map(({ v, d }, i) => persona(v.e!, i + 1, `${Math.round(d!)} días`, `${v.codigo ?? ''} · ${money(v.v)}`, `${Math.round(d!)} días`, 'del primer contacto al cierre')) });

    // ascenso del año: TODOS los que llegaron por PRIMERA VEZ a un nivel (cada uno se lleva su reconocimiento)
    const asc: Ganador[] = [];
    const subio = new Map<string, string>();
    for (const [e, hs] of am.hist) {
        if (agenteInmo.get(e) !== k || bajas.has(e)) continue;
        const x = ascensoDelPeriodo(hs, A, B);
        if (!x) continue;
        const t = `${LVL[x.de]} → ${LVL[x.a]}`;
        subio.set(e, t);
        const badge = x.a === 'elite' || x.a === 'professional' ? (x.a as NivelKey) : undefined;
        asc.push({ ...persona(e, 1, t, `desde ${MES[new Date(x.ts.getTime() - DIA).getUTCMonth()]}`), badge });
    }
    premios.push({ key: 'ascenso', titulo: 'Ascenso del año', porque: 'Por subir de nivel gracias a su desempeño.', varios: true,
        regla: 'Brokers que llegaron por primera vez a un nivel (Profesional o Élite) en algún corte del año; si ya lo habían tenido antes, no cuenta. Lo recibe cada uno.',
        podio: asc.sort((a, b) => b.valor.localeCompare(a.valor)) });

    // diplomas: todo el equipo activo, con su nivel de HOY
    const { todos: activos, equipo: eqActivo } = await activosDe(k);
    const masters = activos.filter((a) => a.type === 'master').map((a) => limpio(`${a.firstName ?? ''} ${a.lastName ?? ''}`)).filter(Boolean);
    const equipo: Diploma[] = eqActivo.map((a) => {
        const e = a.email as string, s = r.asesor.get(e);
        const g = persona(e, 1, '', '');
        const lv = am.level.get(e);
        return { email: e, nombre: g.nombre, first: g.first, last: g.last, photo: g.photo,
            nivel: (lv === 'elite' || lv === 'professional' ? lv : 'standard') as NivelKey,
            cierres: s?.cerradas.size ?? 0, visitas: s?.visitas ?? 0, captaciones: s?.captaciones ?? 0, exclusivas: s?.exclusivas ?? 0,
            subio: subio.get(e) ?? null };
    }).sort((a, b) => (ORD[b.nivel] - ORD[a.nivel]) || a.nombre.localeCompare(b.nombre, 'es'));

    // logo de la inmobiliaria (7,800 companies traen el placeholder de i24: eso no es logo)
    const co = await db.collection('companies').findOne({ _id: new ObjectId(companyId) }, { projection: { 'logo.default': 1 } });
    const lg = String(dig(co, 'logo', 'default') ?? '');
    const logo = lg && !/placeholder-img/.test(lg) ? lg : null;
    return { inmobiliaria: k, logo, corte: corteTexto(c), año: AÑO, premios, masters, equipo, generado: new Date().toISOString() };
}
