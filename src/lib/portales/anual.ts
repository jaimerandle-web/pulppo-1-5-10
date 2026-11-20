// /portales → el año mes a mes (nov-2026). La base de Tablero, Portal, Inmobiliarias y Focos rojos.
//
// Ale: «poder verlo por portal y filtrar por inmobiliaria, ver el desempeño a través del año y detectar focos
// rojos reales a primera vista». Las pestañas viejas calculan un periodo a la vez (YTD de la red: ~2 min); aquí
// cada MES se calcula una sola vez como un CUBO (canal × inmobiliaria × operación) y el navegador corta lo que
// quiera sin volver a preguntar. Un mes cerrado se guarda 12 h en la caché de datos de Next (compartida entre
// instancias de Vercel); el mes en curso, 30 min.
//
// MISMO CÁLCULO QUE /mb (Ale, 20-nov-2026 — ver CLAUDE.md «UN SOLO CÁLCULO»):
//   · Leads = únicos: la primera vez del par contacto + propiedad en 400 días (`claveLead` de mbComun), sin
//     «formulario de contacto». De la red: sin Habi ni cuentas de prueba (NOT).
//   · Meses en días de calendario hora México.
//   · Respondidos = `answeredAt` a cualquier hora; respuesta en menos de 1 h sólo con leads de 8 am a 8 pm.
//   · Visitaron / ofertaron = de los leads del mes, cuántos visitaron (confirmada o pendiente, por `startTime`)
//     u ofertaron DESPUÉS del lead CON ESA inmobiliaria (Consultas de /mb). Cerraron = la oferta llegó a
//     cobrando o cerrada. Es cohorte: los meses recientes todavía maduran.
//   · Cierres del mes = `cierresEntre` (actividad por `closedAt`, fuente atribuida), con las dos inmobiliarias.
//   · Inventario = propiedades publicadas en Pulppo el día 15 del mes a mediodía (hoy, en el mes en curso), para
//     separar «bajó el inventario» de «bajó el desempeño» (iElement oct-2026: la caída era inventario).
import { unstable_cache } from 'next/cache';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { claveLead, enHorario, VISITA_OK } from '../mbComun';
import { NOT, dig, isDate } from './metrics';
import { canalDeLead, cierresEntre, cuentaI24DeLead, opcionesInmobiliarias } from './inmobiliaria';

const MX = 6 * 3600 * 1000;
const DIA = 86400000;
const HISTORIA = 400;
const CERRADA = new Set(['closed', 'paying']);

/** fila del cubo: canal · inmobiliaria ('' = fuera de la lista) · operación ('s' venta, 'r' renta, '' sin dato) ·
 *  leads · leads en horario · respondidos en <1 h (de los de horario) · respondidos · visitaron · ofertaron · cerraron */
export type CeldaMes = [string, string, 's' | 'r' | '', number, number, number, number, number, number, number];
export const C = { canal: 0, inmo: 1, op: 2, leads: 3, hor: 4, r1h: 5, resp: 6, vis: 7, ofe: 8, clo: 9 } as const;
/** cierre del mes: fuente · inmobiliaria vendedora · compradora · operación · regalía · comisión */
export type CierreMes = [string, string, string, 's' | 'r' | '', number, number];
export interface MesCubo {
    mes: string; desde: string; hasta: string; parcial: boolean; generado: string;
    celdas: CeldaMes[]; cierres: CierreMes[];
}
/** inventario publicado en Pulppo: inmobiliaria · operación · propiedades, por mes */
export type InvFila = [string, 's' | 'r' | '', number];
export interface InventarioMeses { generado: string; meses: Record<string, InvFila[]> }

const opDe = (x: unknown): 's' | 'r' | '' => (x === 'sale' ? 's' : x === 'rent' ? 'r' : '');
/** 00:00 hora México del día 1 del mes YYYY-MM */
const inicioMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1) + MX); };
const sigMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
export const mesActual = (now = Date.now()) => new Date(now - MX).toISOString().slice(0, 7);
/** los últimos `n` meses terminando en el actual, del más viejo al más nuevo */
export function ultimosMeses(n = 13, now = Date.now()): string[] {
    const out = [mesActual(now)];
    while (out.length < n) { const [y, m] = out[0].split('-').map(Number); out.unshift(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`); }
    return out;
}
const lotes = <T,>(xs: T[], n = 3000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** compañía → nombre canónico de la lista de 102 (con sus cuentas hermanas) */
async function mapaInmo(): Promise<{ nombreDe: Map<string, string>; idsDe: Map<string, Set<string>> }> {
    const nombreDe = new Map<string, string>(), idsDe = new Map<string, Set<string>>();
    for (const o of await opcionesInmobiliarias()) {
        idsDe.set(o.nombre, new Set(o.ids));
        for (const id of o.ids) nombreDe.set(id, o.nombre);
    }
    return { nombreDe, idsDe };
}

async function calcularMes(mes: string): Promise<MesCubo> {
    const db = await getDb();
    const A = inicioMes(mes);
    const B = new Date(Math.min(inicioMes(sigMes(mes)).getTime(), Date.now()));
    const { nombreDe, idsDe } = await mapaInmo();

    // 1) leads del mes (sin Habi, pruebas ni formulario de contacto), en orden
    const crudos = await db.collection('leads').find({ createdAt: { $gte: A, $lt: B }, ...NOT }, {
        projection: { createdAt: 1, answeredAt: 1, source: 1, 'contact._id': 1, 'property._id': 1, 'property.listing.operation': 1,
            'company._id': 1, 'company.name': 1, 'propertyPublishPortals.portals.inmuebles24.company': 1 },
    }).sort({ createdAt: 1 }).toArray();

    // 2) únicos: fuera los pares contacto + propiedad que ya habían escrito en los 400 días anteriores (o antes en el mes)
    const vistos = new Set<string>();
    const contactos = [...new Set(crudos.map((l) => dig(l, 'contact', '_id')).filter((x): x is ObjectId => x instanceof ObjectId).map(String))];
    await Promise.all(lotes(contactos).map(async (cs) => {
        for await (const l of db.collection('leads').find(
            { 'contact._id': { $in: cs.map((s) => new ObjectId(s)) }, createdAt: { $gte: new Date(A.getTime() - HISTORIA * DIA), $lt: A } },
            { projection: { 'contact._id': 1, 'property._id': 1, source: 1 } }))
            if (String(l.source ?? '').trim().toLowerCase() !== 'formulario de contacto') vistos.add(claveLead(l));
    }));
    const leads: Document[] = [];
    for (const l of crudos) {
        if (!isDate(l.createdAt)) continue;
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        leads.push(l);
    }

    // 3) inmobiliaria del lead: su compañía o, si no trae (~2% de WhatsApp), la de la propiedad
    const sinComp = [...new Set(leads.filter((l) => !dig(l, 'company', '_id')).map((l) => dig(l, 'property', '_id')).filter((x): x is ObjectId => x instanceof ObjectId).map(String))];
    const compDeProp = new Map<string, string>();
    for (const ps of lotes(sinComp))
        for await (const p of db.collection('properties').find({ _id: { $in: ps.map((s) => new ObjectId(s)) } }, { projection: { 'company._id': 1 } }))
            if (dig(p, 'company', '_id')) compDeProp.set(String(p._id), String(dig(p, 'company', '_id')));

    // 4) visitas y ofertas posteriores de esos contactos (con la compañía de quien atendió)
    type Ev = { t: number; comps: string[]; cerrada?: boolean };
    const visitas = new Map<string, Ev[]>(), ofertas = new Map<string, Ev[]>();
    const push = (m: Map<string, Ev[]>, k: string, e: Ev) => (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    const cids = [...new Set(leads.map((l) => dig(l, 'contact', '_id')).filter((x): x is ObjectId => x instanceof ObjectId).map(String))];
    await Promise.all(lotes(cids).flatMap((cs) => {
        const oids = cs.map((s) => new ObjectId(s));
        return [
            (async () => {
                for await (const v of db.collection('visits').find({ 'contact._id': { $in: oids }, 'status.last': { $in: VISITA_OK } },
                    { projection: { 'contact._id': 1, startTime: 1, createdAt: 1, 'agent.company._id': 1 } })) {
                    const t = isDate(v.startTime) ? v.startTime : isDate(v.createdAt) ? v.createdAt : null;
                    if (t) push(visitas, String(dig(v, 'contact', '_id')), { t: t.getTime(), comps: [String(dig(v, 'agent', 'company', '_id') ?? '')] });
                }
            })(),
            (async () => {
                for await (const o of db.collection('operations').find({ 'buyer.contact._id': { $in: oids } },
                    { projection: { 'buyer.contact._id': 1, createdAt: 1, 'status.last': 1, 'buyer.company._id': 1, 'seller.company._id': 1 } }))
                    if (isDate(o.createdAt)) push(ofertas, String(dig(o, 'buyer', 'contact', '_id')), {
                        t: o.createdAt.getTime(), cerrada: CERRADA.has(String(dig(o, 'status', 'last'))),
                        comps: [String(dig(o, 'buyer', 'company', '_id') ?? ''), String(dig(o, 'seller', 'company', '_id') ?? '')],
                    });
            })(),
        ];
    }));

    // 5) al cubo
    const cubo = new Map<string, CeldaMes>();
    for (const l of leads) {
        const comp = String(dig(l, 'company', '_id') ?? compDeProp.get(String(dig(l, 'property', '_id') ?? '')) ?? '');
        const inmo = nombreDe.get(comp) ?? '';
        const canal = canalDeLead(l.source, dig(l, 'company', 'name'), cuentaI24DeLead(l));
        const op = opDe(dig(l, 'property', 'listing', 'operation'));
        const k = `${canal}|${inmo}|${op}`;
        const c = cubo.get(k) ?? cubo.set(k, [canal, inmo, op, 0, 0, 0, 0, 0, 0, 0]).get(k)!;
        const t = (l.createdAt as Date).getTime();
        const ans = l.answeredAt;
        c[C.leads] += 1;
        if (isDate(ans)) c[C.resp] += 1;
        if (enHorario(l.createdAt as Date)) {
            c[C.hor] += 1;
            if (isDate(ans) && ans.getTime() - t < 3600_000) c[C.r1h] += 1;
        }
        const cid = String(dig(l, 'contact', '_id') ?? '');
        if (!cid || !comp) continue;
        const suyas = inmo ? idsDe.get(inmo)! : new Set([comp]);
        const conElla = (e: Ev) => e.t >= t && e.comps.some((x) => suyas.has(x));
        if ((visitas.get(cid) ?? []).some(conElla)) c[C.vis] += 1;
        const ofs = (ofertas.get(cid) ?? []).filter(conElla);
        if (ofs.length) c[C.ofe] += 1;
        if (ofs.some((e) => e.cerrada)) c[C.clo] += 1;
    }

    // 6) cierres del mes (actividad), con la inmobiliaria de cada lado
    const { out } = await cierresEntre(A, B, { ids: null, operacion: 'todas' });
    const cierres: CierreMes[] = out.map((x) => [
        x.fuente, nombreDe.get(x.vendeId ?? '') ?? '', nombreDe.get(x.compraId ?? '') ?? '',
        x.operacion === 'Venta' ? 's' : x.operacion === 'Renta' ? 'r' : '', Math.round(x.regalia), Math.round(x.comision),
    ]);

    return {
        mes, desde: A.toISOString(), hasta: B.toISOString(), parcial: B.getTime() < inicioMes(sigMes(mes)).getTime(),
        generado: new Date().toISOString(), celdas: [...cubo.values()], cierres,
    };
}

/** El cubo de un mes. Cerrado: caché de datos 12 h; en curso: 30 min. `fresco` lo recalcula. */
export async function mesCubo(mes: string, fresco = false): Promise<MesCubo> {
    if (fresco) return calcularMes(mes);
    const enCurso = mes >= mesActual();
    return unstable_cache(() => calcularMes(mes), ['portales-anual-mes-v1', mes], { revalidate: enCurso ? 1800 : 43200, tags: ['portales-anual'] })();
}

// ── inventario publicado en Pulppo por mes ────────────────────────────────────────────────────────
const fechaH = (e: Document): number | null => {
    const v = e.timestamp ?? e.date ?? e.createdAt;
    const d = v instanceof Date ? v : v ? new Date(String(v)) : null;
    return d && !isNaN(d.getTime()) ? d.getTime() : null;
};
async function calcularInventario(meses: string[]): Promise<InventarioMeses> {
    const db = await getDb();
    const { nombreDe } = await mapaInmo();
    const ahora = Date.now();
    // el día 15 a mediodía hora México (el mes en curso: ahora, si todavía no llega el 15)
    const cortes = meses.map((m) => Math.min(inicioMes(m).getTime() + 14 * DIA + 12 * 3600_000, ahora));
    const acc = meses.map(() => new Map<string, InvFila>());
    for await (const p of db.collection('properties').find({ 'status.history.status': 'published' },
        { projection: { 'company._id': 1, 'listing.operation': 1, 'status.history.status': 1, 'status.history.timestamp': 1, 'status.history.date': 1, 'status.history.createdAt': 1 } })) {
        const inmo = nombreDe.get(String(dig(p, 'company', '_id') ?? ''));
        if (!inmo) continue;
        const hist = ((dig(p, 'status', 'history') as Document[]) ?? [])
            .map((e) => ({ t: fechaH(e), s: String(e.status ?? '') })).filter((e): e is { t: number; s: string } => e.t != null)
            .sort((a, b) => a.t - b.t);
        if (!hist.length) continue;
        const op = opDe(dig(p, 'listing', 'operation'));
        cortes.forEach((corte, i) => {
            let st = '';
            for (const e of hist) { if (e.t > corte) break; st = e.s; }
            if (st !== 'published') return;
            const k = `${inmo}|${op}`;
            const f = acc[i].get(k) ?? acc[i].set(k, [inmo, op, 0]).get(k)!;
            f[2] += 1;
        });
    }
    return { generado: new Date().toISOString(), meses: Object.fromEntries(meses.map((m, i) => [m, [...acc[i].values()]])) };
}
/** Inventario publicado de los últimos meses (caché 12 h). */
export async function inventarioMeses(meses: string[], fresco = false): Promise<InventarioMeses> {
    if (fresco) return calcularInventario(meses);
    return unstable_cache(() => calcularInventario(meses), ['portales-anual-inv-v1', meses.join(',')], { revalidate: 43200, tags: ['portales-anual'] })();
}
