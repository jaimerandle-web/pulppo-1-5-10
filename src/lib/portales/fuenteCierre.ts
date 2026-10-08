// Fuente de un CIERRE — una sola regla para /portales y para Desempeño de /mb (Ale y Lau, oct-2026).
//
// La fuente es el CANAL por el que llegó el comprador (Inmuebles24, MeLi, Lonas…). Quién lo trajo — un
// broker externo u otra inmobiliaria de la red — NO es una fuente: va aparte en `comprador` (Ale: «Broker
// externo no es una fuente, la fuente es inmuebles24 y si es un broker externo es otra cosa»).
//
// Cuando la operación no trae fuente se busca evidencia, en este orden, y cada paso deja escrito QUÉ se
// encontró (`evidencia`), con fecha, para que cualquiera pueda ir a revisarlo:
//   1. capturada: la de la operación, o la de su búsqueda (coinciden en 819 de 820 cierres de 2026)
//   2. el primer lead del COMPRADOR con la inmobiliaria que lo trajo, antes del cierre
//   3. el lead del BROKER EXTERNO (`buyer.broker._id` también es un contacto): sobre esa propiedad, o el
//      más reciente con la inmobiliaria vendedora en el año previo
//   4. la búsqueda que la inmobiliaria vendedora le abrió al broker, si trae fuente («Lonas», «contacto
//      directo»: el asesor sí lo capturó, pero en la búsqueda del broker, no en la operación)
//   5. un lead sobre esa propiedad con el TELÉFONO del broker (el broker escribió desde otro contacto)
//   6. otra operación del mismo inmueble (±60 días) que sí capturó la fuente (operación registrada dos veces)
//   7. tiene búsqueda pero sin fuente → «Búsqueda creada por el asesor»
//   8. nada → «Sin fuente registrada» si lo trajo otra inmobiliaria; «Cartera del asesor» si es de la casa
// Medido en sep-2026 (toda la red): los pasos 3–6 bajan los «sin fuente» de 45 a ~17; los que quedan son
// brokers dados de alta a mano con la búsqueda sin fuente — eso sólo se arregla al capturar.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { KEY2NAME, classifySource, dig, isDate, oid } from './metrics';

const FUENTE_RARA: Record<string, string> = {
    lonas: 'Lonas', tuportalonline: 'TuPortalOnline', contactodirecto: 'Contacto directo', referido: 'Referido',
    'doorvel.com': 'Doorvel', lamudi: 'Lamudi',
};
// «Broker externo» capturado a mano dice QUIÉN trajo al comprador, no el canal: cuenta como sin fuente.
const SIN_FUENTE = new Set(['other', '', 'none', 'null', 'undefined', 'broker externo', 'brokerexternal', 'broker', 'externo', 'otro broker', 'red pulppo']);
export const F_BROKER_EXT = 'Broker externo', F_RED = 'Red Pulppo', F_SIN = 'Sin fuente registrada';
export const F_BUSQ = 'Búsqueda creada por el asesor', F_CARTERA = 'Cartera del asesor';

/** Fuente capturada, o null si vino vacía / `other` / un nombre de quién lo trajo. */
export const fuenteCapturada = (raw: unknown): string | null => {
    const t = String(raw ?? '').trim();
    if (SIN_FUENTE.has(t.toLowerCase())) return null;
    const k = classifySource(t);
    if (k !== 'otros') return KEY2NAME[k] ?? k;
    return FUENTE_RARA[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1);
};

export interface FuenteCierre {
    fuente: string;
    /** «Broker externo» / «Red Pulppo» si al comprador lo trajo otra inmobiliaria (no es fuente) */
    comprador: string | null;
    /** no la capturó el asesor en la operación: se dedujo de la evidencia */
    inferida: boolean;
    /** qué se encontró, con fecha («El broker escribió desde Inmuebles24 el 2 jun 26 sobre esta propiedad») */
    evidencia: string | null;
}
export interface ContextoFuente {
    /** el comprador lo trajo la propia inmobiliaria (no un externo ni otra de la red) */
    esNuestra: (o: Document) => boolean;
    /** compañías de la inmobiliaria que trajo al comprador / de la vendedora */
    compsComprador: (o: Document) => Set<string>;
    compsVendedora: (o: Document) => Set<string>;
}

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = (d: Date) => { const m = new Date(d.getTime() - 6 * 3600 * 1000); return `${m.getUTCDate()} ${MES[m.getUTCMonth()]} ${String(m.getUTCFullYear()).slice(2)}`; };
const DIA = 86400000;
const lotes = <T,>(xs: T[], n = 3000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
const s = (v: unknown) => String(v ?? '');
const ids = (xs: unknown[]) => [...new Set(xs.filter(Boolean).map(String))].map(oid).filter((x): x is ObjectId => !!x);

type Lead = { t: Date; src: unknown; comp: string; pid: string };
type Busq = { t: Date; src: unknown; comp: string };

/** Resuelve la fuente de cada operación (clave: `String(o._id)`). Las operaciones necesitan: _id, closedAt,
 *  property._id, buyer.source, buyer.search, buyer.contact._id, buyer.broker._id, buyer.broker.phone,
 *  buyer.company._id, buyer.company.external, seller.company._id. */
export async function resolverFuentes(ops: Document[], ctx: ContextoFuente): Promise<Map<string, FuenteCierre>> {
    const db = await getDb();
    const out = new Map<string, FuenteCierre>();

    // 1. búsquedas de las operaciones (fuente y fecha)
    const busOp = new Map<string, Document>();
    for (const l of lotes(ids(ops.map((o) => dig(o, 'buyer', 'search')))))
        for await (const b of db.collection('searches').find({ _id: { $in: l } }, { projection: { source: 1, createdAt: 1 } })) busOp.set(s(b._id), b);
    const busquedaValida = (o: Document) => {
        const b = busOp.get(s(dig(o, 'buyer', 'search')));
        return b && isDate(b.createdAt) && b.createdAt <= (o.closedAt as Date) ? b : null;
    };
    const comprador = (o: Document) => {
        if (ctx.esNuestra(o)) return null;
        const bc = s(dig(o, 'buyer', 'company', '_id'));
        return dig(o, 'buyer', 'company', 'external') === true || !bc ? F_BROKER_EXT : F_RED;
    };

    const pend: Document[] = [];
    for (const o of ops) {
        const cap = fuenteCapturada(dig(o, 'buyer', 'source')) ?? fuenteCapturada(busquedaValida(o)?.source);
        if (cap) out.set(s(o._id), { fuente: cap, comprador: comprador(o), inferida: false, evidencia: null });
        else pend.push(o);
    }
    if (!pend.length) return out;

    // 2–4. leads y búsquedas del comprador y del broker
    const leads = new Map<string, Lead[]>(), busq = new Map<string, Busq[]>();
    for (const l of lotes(ids(pend.flatMap((o) => [dig(o, 'buyer', 'contact', '_id'), dig(o, 'buyer', 'broker', '_id')])))) {
        for await (const x of db.collection('leads').find({ 'contact._id': { $in: l } }, { projection: { 'contact._id': 1, source: 1, createdAt: 1, 'company._id': 1, 'property._id': 1 } }))
            if (isDate(x.createdAt)) (leads.get(s(dig(x, 'contact', '_id'))) ?? leads.set(s(dig(x, 'contact', '_id')), []).get(s(dig(x, 'contact', '_id')))!)
                .push({ t: x.createdAt, src: x.source, comp: s(dig(x, 'company', '_id')), pid: s(dig(x, 'property', '_id')) });
        for await (const x of db.collection('searches').find({ 'contact._id': { $in: l } }, { projection: { 'contact._id': 1, source: 1, createdAt: 1, 'company._id': 1 } }))
            if (isDate(x.createdAt)) (busq.get(s(dig(x, 'contact', '_id'))) ?? busq.set(s(dig(x, 'contact', '_id')), []).get(s(dig(x, 'contact', '_id')))!)
                .push({ t: x.createdAt, src: x.source, comp: s(dig(x, 'company', '_id')) });
    }
    const resto: Document[] = [];
    for (const o of pend) {
        const cl = o.closedAt as Date, pid = s(dig(o, 'property', '_id'));
        const con = (fuente: string, evidencia: string) => out.set(s(o._id), { fuente, comprador: comprador(o), inferida: true, evidencia });
        const cid = s(dig(o, 'buyer', 'contact', '_id')), bid = s(dig(o, 'buyer', 'broker', '_id'));
        const okL = (xs: Lead[]) => xs.filter((l) => l.t <= cl && fuenteCapturada(l.src)).sort((a, b) => a.t.getTime() - b.t.getTime());
        // 2. primer lead del comprador con la inmobiliaria que lo trajo
        const compC = ctx.compsComprador(o);
        const lc = cid ? okL(leads.get(cid) ?? []).find((l) => compC.has(l.comp)) : undefined;
        if (lc) { con(fuenteCapturada(lc.src)!, `El comprador escribió desde ${fuenteCapturada(lc.src)} el ${fecha(lc.t)}`); continue; }
        // 3. lead del broker: sobre esa propiedad, o el más reciente con la vendedora en el año previo
        const compV = ctx.compsVendedora(o);
        const lb = bid ? okL(leads.get(bid) ?? []) : [];
        const lbMisma = lb.find((l) => l.pid === pid);
        if (lbMisma) { con(fuenteCapturada(lbMisma.src)!, `El broker escribió desde ${fuenteCapturada(lbMisma.src)} el ${fecha(lbMisma.t)} sobre esta propiedad`); continue; }
        const lbV = lb.filter((l) => compV.has(l.comp) && cl.getTime() - l.t.getTime() <= 365 * DIA).pop();
        if (lbV) { con(fuenteCapturada(lbV.src)!, `El broker escribió desde ${fuenteCapturada(lbV.src)} el ${fecha(lbV.t)} a la inmobiliaria`); continue; }
        // 4. búsqueda que la vendedora le abrió al broker, con fuente
        const bb = bid ? (busq.get(bid) ?? []).filter((b) => b.t <= cl && compV.has(b.comp) && cl.getTime() - b.t.getTime() <= 365 * DIA && fuenteCapturada(b.src))
            .sort((a, b) => a.t.getTime() - b.t.getTime()).pop() : undefined;
        if (bb) { con(fuenteCapturada(bb.src)!, `La búsqueda que se le abrió al broker el ${fecha(bb.t)} dice «${fuenteCapturada(bb.src)}»`); continue; }
        resto.push(o);
    }

    // 5. lead sobre esa propiedad con el teléfono del broker (uno por operación: son pocas)
    const resto2: Document[] = [];
    for (const o of resto) {
        const tel = s(dig(o, 'buyer', 'broker', 'phone')).replace(/\D/g, '').slice(-10);
        const pid = dig(o, 'property', '_id');
        if (tel.length === 10 && pid) {
            const fin = tel.slice(-8) + '$';
            const ls = await db.collection('leads').find({ 'property._id': pid, createdAt: { $lte: o.closedAt },
                $or: [{ phone: { $regex: fin } }, { 'contact.phone': { $regex: fin } }] }, { projection: { source: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
            const l = ls.find((x) => fuenteCapturada(x.source));
            if (l) {
                out.set(s(o._id), { fuente: fuenteCapturada(l.source)!, comprador: comprador(o), inferida: true,
                    evidencia: `Lead desde ${fuenteCapturada(l.source)} con el teléfono del broker el ${fecha(l.createdAt)} sobre esta propiedad` });
                continue;
            }
        }
        resto2.push(o);
    }

    // 6. otra operación del mismo inmueble (±60 días) que sí capturó la fuente
    const espejo = new Map<string, Document[]>();
    for (const l of lotes(ids(resto2.map((o) => dig(o, 'property', '_id')))))
        for await (const e of db.collection('operations').find({ 'property._id': { $in: l }, 'status.last': { $ne: 'cancelled' } },
            { projection: { id: 1, 'property._id': 1, 'buyer.source': 1, 'buyer.search': 1, closedAt: 1, createdAt: 1 } }))
            (espejo.get(s(dig(e, 'property', '_id'))) ?? espejo.set(s(dig(e, 'property', '_id')), []).get(s(dig(e, 'property', '_id')))!).push(e);
    const busEsp = new Map<string, unknown>();
    for (const l of lotes(ids([...espejo.values()].flat().map((e) => dig(e, 'buyer', 'search')))))
        for await (const b of db.collection('searches').find({ _id: { $in: l } }, { projection: { source: 1 } })) busEsp.set(s(b._id), b.source);
    for (const o of resto2) {
        const cl = (o.closedAt as Date).getTime();
        const e = (espejo.get(s(dig(o, 'property', '_id'))) ?? []).find((x) => s(x._id) !== s(o._id)
            && Math.abs(((isDate(x.closedAt) ? x.closedAt : x.createdAt) as Date).getTime() - cl) <= 60 * DIA
            && (fuenteCapturada(dig(x, 'buyer', 'source')) || fuenteCapturada(busEsp.get(s(dig(x, 'buyer', 'search'))))));
        if (e) {
            const f = fuenteCapturada(dig(e, 'buyer', 'source')) ?? fuenteCapturada(busEsp.get(s(dig(e, 'buyer', 'search'))))!;
            out.set(s(o._id), { fuente: f, comprador: comprador(o), inferida: true, evidencia: `Otra operación del mismo inmueble (${s(e.id) || 'sin ID'}) capturó «${f}»` });
            continue;
        }
        // 7–8. sin evidencia
        out.set(s(o._id), { fuente: busquedaValida(o) ? F_BUSQ : ctx.esNuestra(o) ? F_CARTERA : F_SIN, comprador: comprador(o), inferida: false, evidencia: null });
    }
    return out;
}
