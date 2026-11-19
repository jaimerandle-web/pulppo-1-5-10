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
//   · Leads únicos por contacto + propiedad dentro del periodo, sin «formulario de contacto» (spam).
//   · Una sola pasada por año para TODA la red (los pares la necesitan): ~30 s en frío, caché 12 h.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { agentMaps, paymentDate, splitByRole, type AgentMaps } from './plus';
import { asesoresDeBaja } from './premios';
import { opcionesInmobiliarias } from './portales/inmobiliaria';

export const AÑO = 2026;
const MX = 6 * 3600 * 1000;
const DIA = 86_400_000;
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
}
interface Asesor { cobrada: number; ops: Set<string>; leads: number; contactos: Set<string>; cierres: Set<string>; resp: number[]; visitas: number; exclusivas: number; firmadas: number }
interface Venta { e: string | null; v: number; codigo: string | null; closed: Date; created: Date | null; cid: string | null; raw: unknown; tipo: string }
interface Red { inmo: Map<string, Inmo>; asesor: Map<string, Asesor>; ventas: Map<string, Venta[]> }

const nuevaInmo = (): Inmo => ({
    cobrada: 0, opsCobradas: new Set(), cierresVenta: 0, cierresRenta: 0, ventas: [], leads: 0, respondidos: 0, resp: [], visitas: 0,
    contactos: new Set(), contactosVisita: new Set(), contactosCierre: new Set(), captaciones: 0, exclusivas: 0, firmadas: 0,
    asesoresCobro: new Set(), ascensos: 0,
});
const nuevoAsesor = (): Asesor => ({ cobrada: 0, ops: new Set(), leads: 0, contactos: new Set(), cierres: new Set(), resp: [], visitas: 0, exclusivas: 0, firmadas: 0 });

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
                    r.cobrada += v; r.opsCobradas.add(String(o.id ?? o._id));
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
                const raw = dig(o, 'buyer', 'contact', '_id');
                const cid = raw ? String(raw) : null;
                if (cid) r.contactosCierre.add(cid);
                // el asesor de ESTA inmobiliaria en el trato: comprador, vendedor o quien captó
                const e = [dig(o, 'buyer', 'broker', 'email'), dig(o, 'seller', 'broker', 'email'), dig(o, 'property', 'agent', 'email')]
                    .map((x) => String(x ?? '')).find((x) => x && agenteInmo.get(x) === k) ?? null;
                const be = String(dig(o, 'buyer', 'broker', 'email') ?? '');
                if (cid && be && agenteInmo.get(be) === k) S(be).cierres.add(cid);
                if (op === 'sale' && cv > 0) (ventas.get(k) ?? ventas.set(k, []).get(k)!).push({
                    e, v: cv, codigo: (dig(o, 'property', 'internalId') as string) ?? null, closed: o.closedAt as Date,
                    created: isDate(o.createdAt) ? o.createdAt : null, cid, raw, tipo: String(dig(o, 'property', 'type') ?? ''),
                });
            }
        })(),
        // leads únicos (contacto + propiedad) del periodo, respuesta y contactos para las cohortes
        (async () => {
            const vistos = new Set<string>();
            for await (const l of db.collection('leads').find({ createdAt: { $gte: A, $lt: B } },
                { projection: { 'company._id': 1, 'agent.uid': 1, 'contact._id': 1, 'property._id': 1, createdAt: 1, answeredAt: 1, source: 1 } })) {
                if (String(l.source ?? '').trim().toLowerCase() === 'formulario de contacto') continue;
                const cid = dig(l, 'contact', '_id'), pid = dig(l, 'property', '_id');
                const key = cid && pid ? `${String(cid)}|${String(pid)}` : String(l._id);
                if (vistos.has(key)) continue;
                vistos.add(key);
                const e = am.uidEmail.get(String(dig(l, 'agent', 'uid') ?? ''));
                const k = deComp(l.company) ?? (e ? agenteInmo.get(e) : undefined);
                if (!k) continue;
                const r = I(k);
                r.leads += 1;
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
                { projection: { 'agent.email': 1, 'agent.company._id': 1, 'contact._id': 1 } })) {
                const e = String(dig(v, 'agent', 'email') ?? '');
                const k = deComp(dig(v, 'agent', 'company')) ?? agenteInmo.get(e);
                if (!k) continue;
                const r = I(k);
                r.visitas += 1;
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
                if (isDate(p.createdAt) && p.createdAt >= A && p.createdAt < B) r.captaciones += 1;
                const ex = dig(p, 'contract', 'exclusive', 'start');
                if (isDate(ex) && ex >= A && ex < B) {
                    const firm = dig(p, 'contract', 'status') === 'completed';
                    r.exclusivas += 1; if (firm) r.firmadas += 1;
                    const e = String(dig(p, 'agent', 'email') ?? '');
                    if (e && agenteInmo.get(e) === k) { const s = S(e); s.exclusivas += 1; if (firm) s.firmadas += 1; }
                }
            }
        })(),
    ]);
    // cohortes: sólo cuentan los contactos que también fueron lead de la inmobiliaria en el periodo
    for (const r of inmo.values()) {
        r.contactosVisita = new Set([...r.contactosVisita].filter((x) => r.contactos.has(x)));
        r.contactosCierre = new Set([...r.contactosCierre].filter((x) => r.contactos.has(x)));
    }
    for (const s of asesor.values()) s.cierres = new Set([...s.cierres].filter((x) => s.contactos.has(x)));
    // ascensos: subidas de nivel con corte dentro del periodo (el corte del día 1 de M es el desempeño de M−1)
    for (const [e, hs] of am.hist) {
        const k = agenteInmo.get(e);
        if (!k) continue;
        let prev = 0;
        for (const [ts, l] of hs) {
            const o = ORD[l] ?? 0;
            if (o > prev && prev > 0 && ts >= new Date(A.getTime() + 30 * DIA) && ts < new Date(B.getTime() + 2 * DIA)) I(k).ascensos += 1;
            prev = o;
        }
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
export interface Hallazgo { titulo: string; texto: string; metrica: string }
export interface TuAnio {
    inmobiliaria: string; corte: string; años: number[];
    pares: { n: number; desde: number; hasta: number; publicadas: number };
    metricas: Metrica[];
    logros: Hallazgo[]; falto: Hallazgo[];
    generado: string;
}

type Calc = (r: Inmo | undefined) => number | null;
const DEF: Array<{ key: string; label: string; grupo: string; fmt: Fmt; dir: 1 | -1 | 0; peso: number; min?: (r: Inmo) => boolean; f: Calc; ayuda: string; frase?: (v: string) => string }> = [
    { key: 'cobrada', frase: (v) => `${v} de comisión cobrada`,  label: 'Comisión cobrada', grupo: 'Resultados', fmt: 'money', dir: 1, peso: 1.6, f: (r) => r?.cobrada ?? 0,
        ayuda: 'Pagos de comisión registrados en el periodo, de las operaciones de tu inmobiliaria.' },
    { key: 'cierresVenta', frase: (v) => `${v} ventas cerradas`,  label: 'Ventas cerradas', grupo: 'Resultados', fmt: 'int', dir: 1, peso: 1.3, f: (r) => r?.cierresVenta ?? 0,
        ayuda: 'Operaciones de venta cerradas o en pago en el periodo.' },
    { key: 'cierresRenta', frase: (v) => `${v} rentas cerradas`,  label: 'Rentas cerradas', grupo: 'Resultados', fmt: 'int', dir: 1, peso: 1.1, f: (r) => r?.cierresRenta ?? 0,
        ayuda: 'Operaciones de renta cerradas o en pago en el periodo.' },
    { key: 'ticket', label: 'Ticket mediano de venta', grupo: 'Resultados', fmt: 'money', dir: 0, peso: 0, f: (r) => median(r?.ventas ?? []),
        ayuda: 'Precio de cierre mediano de tus ventas. Es descriptivo: ni más alto ni más bajo es mejor.' },
    { key: 'leads', frase: (v) => `${v} leads`,  label: 'Leads', grupo: 'Comercial', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.leads ?? 0,
        ayuda: 'Leads únicos (misma persona + misma propiedad = 1), de todos los canales.' },
    { key: 'pctResp', label: 'Leads respondidos', grupo: 'Comercial', fmt: 'pct', dir: 1, peso: 1, min: (r) => r.leads >= 50,
        f: (r) => (r && r.leads ? r.respondidos / r.leads : null), ayuda: 'Porcentaje de leads con respuesta del asesor en la plataforma.' },
    { key: 'respMin', label: 'Tiempo de 1ª respuesta', grupo: 'Comercial', fmt: 'min', dir: -1, peso: 1, min: (r) => r.resp.length >= 30,
        f: (r) => median(r?.resp ?? []), ayuda: 'Mediana, sólo leads que llegaron de 8 am a 8 pm y sin respuestas automáticas.' },
    { key: 'visitas', frase: (v) => `${v} visitas`,  label: 'Visitas', grupo: 'Comercial', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.visitas ?? 0,
        ayuda: 'Visitas confirmadas o pendientes, por la fecha de la visita.' },
    { key: 'tasaVisita', label: 'Leads que visitan', grupo: 'Comercial', fmt: 'pct', dir: 1, peso: 1.2, min: (r) => r.contactos.size >= 50,
        f: (r) => (r && r.contactos.size ? r.contactosVisita.size / r.contactos.size : null), ayuda: 'De las personas que te escribieron en el periodo, cuántas visitaron con tu inmobiliaria.' },
    { key: 'leadCierre', label: 'Leads que cierran', grupo: 'Comercial', fmt: 'pct', dir: 1, peso: 1.2, min: (r) => r.contactos.size >= 100,
        f: (r) => (r && r.contactos.size ? r.contactosCierre.size / r.contactos.size : null), ayuda: 'De las personas que te escribieron en el periodo, cuántas cerraron contigo en el periodo.' },
    { key: 'captaciones', frase: (v) => `${v} propiedades captadas`,  label: 'Propiedades captadas', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.captaciones ?? 0,
        ayuda: 'Propiedades dadas de alta en el periodo.' },
    { key: 'firmadas', frase: (v) => `${v} exclusivas firmadas`,  label: 'Exclusivas firmadas', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1.1, f: (r) => r?.firmadas ?? 0,
        ayuda: 'Exclusivas que arrancaron en el periodo con el contrato completo en la plataforma.' },
    { key: 'asesoresCobro', frase: (v) => `${v} asesores cobrando`,  label: 'Asesores que cobraron', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 1, f: (r) => r?.asesoresCobro.size ?? 0,
        ayuda: 'Asesores con al menos un pago de comisión en el periodo.' },
    { key: 'ascensos', frase: (v) => `${v} ascensos de nivel`,  label: 'Ascensos de nivel', grupo: 'Inventario y equipo', fmt: 'int', dir: 1, peso: 0.9, f: (r) => r?.ascensos ?? 0,
        ayuda: 'Subidas de nivel (Estándar → Profesional → Élite) de tus asesores en el periodo.' },
];

const fmtVal = (v: number, f: Fmt) => {
    if (f === 'money') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} MDP` : `$${Math.round(v).toLocaleString('es-MX')}`;
    if (f === 'pct') { const p = v * 100; return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`; }
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

    // ── hallazgos: UN veredicto por métrica. Manda la comparación contra sí misma (lo que pidió Ale); los
    //    pares dan contexto, y deciden solos sólo si el año quedó parejo (±10%) o no hay año anterior. ──
    const r26i = R[AÑO].inmo.get(k);
    const cand: Array<Hallazgo & { s: number; tipo: 'logro' | 'falto' }> = [];
    for (const m of metricas) {
        const d = DEF.find((x) => x.key === m.key)!;
        if (m.dir === 0) continue;
        const v = m.valores[AÑO], ant = m.valores[AÑO - 1];
        if (v == null) continue;
        const F = (x: number) => fmtVal(x, m.fmt);
        const dicho = d.frase ? d.frase(F(v)) : `${m.label}: ${F(v)}`;
        const Dicho = dicho.charAt(0).toUpperCase() + dicho.slice(1);
        // tasas: lo que significa la diferencia en personas / leads / cierres
        const base = m.key === 'pctResp' ? r26i?.leads ?? 0 : r26i?.contactos.size ?? 0;
        const enCosas = (ref: number, de: string) => {
            const n = Math.round(Math.abs(ref - v) * base);
            if (n < 1) return '';
            if (m.key === 'tasaVisita') return ` Con la tasa ${de} serían ~${n.toLocaleString('es-MX')} personas más visitando.`;
            if (m.key === 'leadCierre') return ` Con la conversión ${de} serían ~${n} cierres más.`;
            if (m.key === 'pctResp') return ` Con el nivel ${de} serían ~${n.toLocaleString('es-MX')} leads más con respuesta.`;
            return '';
        };
        const contexto = m.pares == null || m.pctl == null ? ''
            : m.pctl >= 60 ? ` Arriba de las inmobiliarias de tu tamaño (su mediana: ${F(m.pares)}).`
                : m.pctl <= 40 ? ` Las inmobiliarias de tu tamaño: ${F(m.pares)}.` : '';
        const cambio = ant != null && ant > 0 && !(m.fmt === 'int' && ant < 5 && v < 5) ? ((v - ant) / ant) * m.dir : null;
        if (cambio != null && Math.abs(cambio) >= 0.1) {
            const sube = cambio > 0;
            let t: string;
            if (m.fmt === 'pct') t = `${m.label}: ${F(v)}, contra ${F(ant!)} en ${AÑO - 1}.${sube ? '' : enCosas(ant!, `de ${AÑO - 1}`)}`;
            else if (m.fmt === 'min') t = sube ? `Tu equipo responde en ${F(v)}; en ${AÑO - 1} tardaba ${F(ant!)}.` : `Tu equipo tarda ${F(v)} en responder; en ${AÑO - 1} eran ${F(ant!)}.`;
            else t = `${Dicho}, ${sigPct((v - ant!) / ant!)} contra el mismo periodo de ${AÑO - 1} (${F(Math.abs(v - ant!))} ${v > ant! ? 'más' : 'menos'}).`;
            cand.push({ tipo: sube ? 'logro' : 'falto', s: Math.min(Math.abs(cambio), 1.5) * d.peso + 0.3, metrica: m.key, titulo: m.label, texto: t + contexto });
        } else if (m.pctl != null && m.pares != null && (m.pctl >= 75 || m.pctl <= 35)) {
            const arriba = m.pctl >= 75;
            const t = m.fmt === 'min'
                ? `Tu equipo responde en ${F(v)}; las inmobiliarias de tu tamaño, en ${F(m.pares)}.`
                : arriba
                    ? `${Dicho}: en el ${100 - m.pctl <= 10 ? '10' : '25'}% más alto de las inmobiliarias de tu tamaño (su mediana: ${F(m.pares)}).`
                    : `${Dicho}, contra ${F(m.pares)} de las inmobiliarias de tu tamaño.${enCosas(m.pares, 'de tus pares')}`;
            const parejo = cambio != null ? ` Parejo con ${AÑO - 1} (${sigPct(((v - ant!) / ant!))}).` : '';
            cand.push({ tipo: arriba ? 'logro' : 'falto', s: (Math.abs(m.pctl - 50) / 50) * d.peso * 0.8, metrica: m.key, titulo: m.label, texto: t + parejo });
        }
    }
    const elegir = (t: 'logro' | 'falto') => {
        const usados = new Set<string>(), out: Hallazgo[] = [];
        for (const h of cand.filter((x) => x.tipo === t).sort((a, b) => b.s - a.s)) {
            if (usados.has(h.metrica) || out.length >= 3) continue;
            usados.add(h.metrica); out.push({ titulo: h.titulo, texto: h.texto, metrica: h.metrica });
        }
        return out;
    };

    return {
        inmobiliaria: k, corte: corteTexto(c), años,
        pares: { n: grupo.length, desde: grupo[0]?.[1] ?? 0, hasta: grupo[grupo.length - 1]?.[1] ?? 0, publicadas: inv.get(k) ?? 0 },
        metricas, logros: elegir('logro'), falto: elegir('falto'), generado: new Date().toISOString(),
    };
}

// ── RECONOCIMIENTOS ───────────────────────────────────────────────────────────
export interface Ganador {
    email: string; nombre: string; first: string; last: string; photo: string | null; nivel: string | null;
    valor: string; detalle: string;
}
export interface Premio { key: string; titulo: string; porque: string; regla: string; podio: Ganador[]; varios?: boolean }
export interface Reconocimientos { inmobiliaria: string; logo: string | null; corte: string; año: number; premios: Premio[]; generado: string }

export async function reconocimientos(companyId: string): Promise<Reconocimientos | null> {
    const { am, bajas, compInmo, agenteInmo } = await base();
    const k = compInmo.get(companyId);
    if (!k) return null;
    const c = corte();
    const r = await red(AÑO, c);
    const { A, B } = ventana(AÑO, c);
    const mios = [...r.asesor.entries()].filter(([e]) => agenteInmo.get(e) === k && !bajas.has(e));
    const persona = (e: string, valor: string, detalle: string): Ganador => {
        const [first, last] = am.parts.get(e) ?? [am.name.get(e) ?? e, ''];
        const limpio = (s: string) => s.replace(/\s+/g, ' ').trim();
        return { email: e, nombre: limpio(am.name.get(e) ?? e), first: limpio(first), last: limpio(last), photo: am.photo.get(e) ?? null, nivel: LVL[am.level.get(e) ?? ''] ?? null, valor, detalle };
    };
    const top = <T,>(xs: T[], n = 3) => xs.slice(0, n);
    const money = (v: number) => fmtVal(v, 'money');
    const ops = (n: number) => `${n} ${n === 1 ? 'operación' : 'operaciones'}`;

    const premios: Premio[] = [];
    premios.push({ key: 'asesor', titulo: 'Asesor del año', porque: 'Por ser quien más comisión cobró este año.',
        regla: 'Comisión cobrada en el año, repartida por rol en cada operación (como en los premios de la gala).',
        podio: top(mios.filter(([, s]) => s.cobrada > 0).sort((a, b) => b[1].cobrada - a[1].cobrada))
            .map(([e, s]) => persona(e, money(s.cobrada), ops(s.ops.size))) });
    premios.push({ key: 'captador', titulo: 'Gran captador', porque: 'Por firmar más exclusivas que nadie en el equipo.',
        regla: 'Exclusivas que arrancaron en el año con contrato completo en la plataforma; desempata el total de exclusivas.',
        podio: top(mios.filter(([, s]) => s.firmadas > 0).sort((a, b) => b[1].firmadas - a[1].firmadas || b[1].exclusivas - a[1].exclusivas))
            .map(([e, s]) => persona(e, `${s.firmadas} ${s.firmadas === 1 ? 'exclusiva firmada' : 'exclusivas firmadas'}`, `de ${s.exclusivas} exclusivas`)) });
    premios.push({ key: 'relampago', titulo: 'Respuesta relámpago', porque: 'Por ser quien más rápido le contesta a sus clientes.',
        regla: 'Mediana del tiempo de 1ª respuesta con al menos 20 leads respondidos de 8 am a 8 pm; sin respuestas automáticas (<10 s).',
        podio: top(mios.filter(([, s]) => s.resp.length >= 20).map(([e, s]) => [e, median(s.resp)!, s.resp.length] as const).sort((a, b) => a[1] - b[1]))
            .map(([e, m, n]) => persona(e, fmtVal(m, 'min'), `${n} leads respondidos`)) });
    premios.push({ key: 'visitas', titulo: 'Rey de las visitas', porque: 'Por ser quien más visitas hizo en el año.',
        regla: 'Visitas confirmadas o pendientes con fecha en el año (mínimo 5).',
        podio: top(mios.filter(([, s]) => s.visitas >= 5).sort((a, b) => b[1].visitas - a[1].visitas))
            .map(([e, s]) => persona(e, `${s.visitas.toLocaleString('es-MX')} visitas`, `${s.leads.toLocaleString('es-MX')} leads atendidos`)) });
    premios.push({ key: 'conversion', titulo: 'Mejor conversión', porque: 'Por convertir en cierre la mayor parte de sus leads.',
        regla: 'De las personas que le escribieron en el año (mínimo 40), cuántas compraron o rentaron con él o ella.',
        podio: top(mios.filter(([, s]) => s.contactos.size >= 40 && s.cierres.size > 0)
            .sort((a, b) => b[1].cierres.size / b[1].contactos.size - a[1].cierres.size / a[1].contactos.size || b[1].cierres.size - a[1].cierres.size))
            .map(([e, s]) => persona(e, fmtVal(s.cierres.size / s.contactos.size, 'pct'), `${s.cierres.size} de ${s.contactos.size} personas`)) });

    const ventas = (r.ventas.get(k) ?? []).filter((v) => v.e && !bajas.has(v.e));
    premios.push({ key: 'ventaMayor', titulo: 'Venta del año', porque: 'Por cerrar la venta de mayor valor de la inmobiliaria.',
        regla: 'Precio de cierre de las ventas cerradas en el año.',
        podio: top([...ventas].sort((a, b) => b.v - a.v).filter((v, i, xs) => xs.findIndex((x) => x.e === v.e) === i)).map((v) => persona(v.e!, money(v.v), v.codigo ?? '')) });

    // venta más rápida: primer lead del comprador → cierre; ventas de $2M+ sin terrenos, lead anterior a la operación (reglas de la gala)
    const db = await getDb();
    const rapidas = ventas.filter((v) => v.cid && v.v >= 2_000_000 && !/terreno|lote/i.test(v.tipo));
    const primer = new Map<string, number>();
    if (rapidas.length) for await (const l of db.collection('leads').find({ 'contact._id': { $in: rapidas.map((v) => v.raw as ObjectId) } }, { projection: { 'contact._id': 1, createdAt: 1 } })) {
        const cid = String(dig(l, 'contact', '_id') ?? '');
        if (isDate(l.createdAt)) primer.set(cid, Math.min(primer.get(cid) ?? Infinity, l.createdAt.getTime()));
    }
    premios.push({ key: 'ventaRapida', titulo: 'Venta más rápida', porque: 'Por llevar a un cliente del primer contacto al cierre en tiempo récord.',
        regla: 'Días del primer lead del comprador al cierre. Ventas de $2 MDP o más, sin terrenos, con el lead anterior a la operación.',
        podio: top(rapidas.map((v) => {
            const l = primer.get(v.cid!);
            const ok = l != null && (!v.created || l <= v.created.getTime());
            return { v, d: ok ? (v.closed.getTime() - l!) / DIA : null };
        }).filter((x) => x.d != null && x.d >= 1).sort((a, b) => a.d! - b.d!))
            .map(({ v, d }) => persona(v.e!, `${Math.round(d!)} días`, `${v.codigo ?? ''} · ${money(v.v)}`)) });

    // ascenso del año: TODOS los que subieron de nivel con un corte del periodo (cada uno se lleva su reconocimiento)
    const asc: Ganador[] = [];
    for (const [e, hs] of am.hist) {
        if (agenteInmo.get(e) !== k || bajas.has(e)) continue;
        let prev: string | null = null, sube: { de: string; a: string; ts: Date } | null = null;
        for (const [ts, l] of hs) {
            if (prev && ORD[l] > ORD[prev] && ts >= new Date(A.getTime() + 30 * DIA) && ts < new Date(B.getTime() + 2 * DIA)) sube = { de: prev, a: l, ts };
            prev = l;
        }
        if (sube) asc.push(persona(e, `${LVL[sube.de]} → ${LVL[sube.a]}`, `desde ${MES[new Date(sube.ts.getTime() - DIA).getUTCMonth()]}`));
    }
    premios.push({ key: 'ascenso', titulo: 'Ascenso del año', porque: 'Por subir de nivel gracias a su desempeño.', varios: true,
        regla: 'Asesores que subieron de nivel (Estándar → Profesional → Élite) en algún corte del año. Lo recibe cada uno.',
        podio: asc.sort((a, b) => b.valor.localeCompare(a.valor)) });

    // logo de la inmobiliaria (7,800 companies traen el placeholder de i24: eso no es logo)
    const co = await db.collection('companies').findOne({ _id: new ObjectId(companyId) }, { projection: { 'logo.default': 1 } });
    const lg = String(dig(co, 'logo', 'default') ?? '');
    const logo = lg && !/placeholder-img/.test(lg) ? lg : null;
    return { inmobiliaria: k, logo, corte: corteTexto(c), año: AÑO, premios, generado: new Date().toISOString() };
}
