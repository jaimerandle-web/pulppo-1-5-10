// Desempeño comercial de una inmobiliaria para /mb → Desempeño (oct-2026).
//
// Port del «dashboard-inmobiliarias» de Lau (KAM; Flask, nunca se publicó), metido en la app para
// que herede el login con Google y `canAccessCompany`. Se pasa su lógica TAL CUAL salvo una cosa:
// la FUENTE de los cierres usa `atribuirFuente` (la regla única de /portales), para que un cierre
// diga lo mismo en las dos herramientas.
//
// Definiciones (de Lau):
//   · Meses y días en hora de México (UTC−6 fijo).
//   · Leads ÚNICOS: `leads` por `company._id`, deduplicados por contacto + propiedad.
//   · Visitas: por `agent.company._id`, fecha = `startTime` (cuándo ocurre), confirmadas + pendientes.
//   · Funnel comercial | Búsquedas: por CAMBIO DE ETAPA (`searches.status.history`). De las búsquedas
//     abiertas en una etapa durante el periodo, cuántas pasaron a la siguiente dentro del periodo. NO
//     es la cohorte de leads de /portales: es otra pregunta, a propósito.
//   · Cierres: por `closedAt`, sólo el LADO en que participa la inmobiliaria, con el recorrido del
//     comprador (búsqueda → visita → oferta → cierre).
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { atribuirFuente, fuenteCapturada, opcionesInmobiliarias } from './portales/inmobiliaria';

const MX = 6 * 3600 * 1000;
const DIA = 86400000;
const OPS = ['sale', 'rent'] as const;
type Op = typeof OPS[number] | 'otro';
const CERRADA = ['closed', 'paying'];
const OFERTA_ACTIVA = ['offer', 'offer_blocked', 'contract'];
const MADURACION = 90;   // el ciclo de venta va de 43 a 144 días

const dig = (d: unknown, ...ks: string[]): unknown => {
    let c: unknown = d;
    for (const k of ks) { if (c == null || typeof c !== 'object') return undefined; c = (c as Document)[k]; }
    return c;
};
const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const opDe = (v: unknown): Op => (v === 'sale' || v === 'rent' ? v : 'otro');
const nombreDe = (p: unknown) => `${String(dig(p, 'firstName') ?? '')} ${String(dig(p, 'lastName') ?? '')}`.replace(/\s+/g, ' ').trim();
/** fecha civil de México de un instante, YYYY-MM-DD */
const diaMx = (d: Date) => new Date(d.getTime() - MX).toISOString().slice(0, 10);
const ymMx = (d: Date) => diaMx(d).slice(0, 7);
/** ISO local de México con minutos (lo que pinta la UI) */
const isoMx = (d: Date) => new Date(d.getTime() - MX).toISOString().slice(0, 16);
/** días de calendario (México) entre dos fechas: las etapas suman exacto el acumulado */
const dias = (a: Date | null, b: Date | null) => (a && b ? Math.round((Date.parse(diaMx(b)) - Date.parse(diaMx(a))) / DIA) : null);
const inicioDia = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + MX);
const lotes = <T,>(xs: T[], n = 3000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

export interface Tasa { base: number; n: number; tasa: number | null }
export type Funnel = Record<'visita' | 'oferta' | 'cierre', Tasa>;
interface PorOp { leads: number; confirmadas: number; pendientes: number; funnel: Funnel }
export interface MesDesempeno { mes: string; enCurso: boolean; madurando: boolean; sale: PorOp; rent: PorOp; otro: { leads: number; visitas: number } }
export interface VisitaMb {
    id: string; status: 'confirmed' | 'pending'; op: Op; ym: string; fecha: string; cliente: string;
    asesor: string; agentId: string | null; vencida: boolean;
    propiedades: Array<{ codigo: string | null; titulo: string | null; colonia: string | null }>;
}
export interface CierreMb {
    id: string; estado: string; op: Op; lado: string; cliente: string; inmoComprador: string | null; compradorOtraInmo: boolean;
    asesor: string; agentes: string[]; codigo: string | null; tipo: string | null; direccion: string;
    monto: number | null; moneda: string; comision: number | null; fechaCierre: string;
    inicio: string | null; inicioTipo: 'busqueda' | 'visita' | 'oferta';
    fuente: string; inferida: boolean;
    /** quién trajo al comprador si no fue esta inmobiliaria (no es fuente) */
    comprador: string | null;
    etapaVisita: number | null; etapaOferta: number | null; etapaCierre: number | null;
    diasVisita: number | null; diasOferta: number | null; diasCierre: number | null;
}
export interface DesempenoMb {
    inmobiliaria: string; desde: string; hasta: string; agentId: string | null;
    asesores: Array<{ id: string; nombre: string; activo: boolean }>;
    meses: MesDesempeno[];
    totales: Record<'sale' | 'rent', PorOp>;
    sinOperacion: { leads: number; visitas: number };
    /** leads únicos por asesor y mes (mapa de calor), por operación */
    porAsesor: Array<{ id: string; nombre: string; activo: boolean; meses: Record<string, Record<Op, number>> }>;
    /** atención: leads únicos que entraron 9:00–20:59 MX y cuántos quedaron sin respuesta del asesor */
    atencion: Record<Op, { base: number; sin: number }>;
    /** foto de HOY: operaciones en oferta o contrato */
    ofertasActivas: Record<Op, number>;
    visitas: VisitaMb[];
    cierres: CierreMb[];
    madurando: boolean;
    generado: string;
}

// ── etapas de la búsqueda (pendiente y buscando = la misma) ─────────────────────
const ETAPA: Record<string, number> = { pending: 1, searching: 1, visiting: 2, offer_done: 3, closing: 4, completed: 4 };
const PASOS: Array<['visita' | 'oferta' | 'cierre', number]> = [['visita', 1], ['oferta', 2], ['cierre', 3]];
type Busq = { op: Op; hist: Array<[Date, string]> };

function avance(hist: Busq['hist'], t0: Date, t1: Date) {
    const previo = hist.filter(([t]) => t < t0).map(([, s]) => s);
    const estados = [...(previo.length ? [previo[previo.length - 1]] : []), ...hist.filter(([t]) => t >= t0 && t < t1).map(([, s]) => s)];
    const res = {} as Record<'visita' | 'oferta' | 'cierre', [boolean, boolean]>;
    for (const [nombre, n] of PASOS) {
        const i = estados.findIndex((s) => ETAPA[s] === n);
        res[nombre] = [i >= 0, i >= 0 && estados.slice(i + 1).some((s) => (ETAPA[s] ?? 0) > n)];
    }
    return res;
}
function tasas(bs: Busq[], t0: Date, t1: Date): Record<'sale' | 'rent', Funnel> {
    const out = {} as Record<'sale' | 'rent', Funnel>;
    for (const op of OPS) {
        const r = {} as Funnel;
        for (const [nombre] of PASOS) {
            let base = 0, n = 0;
            for (const b of bs) {
                if (b.op !== op) continue;
                const [estuvo, paso] = avance(b.hist, t0, t1)[nombre];
                base += estuvo ? 1 : 0; n += paso ? 1 : 0;
            }
            r[nombre] = { base, n, tasa: base ? n / base : null };
        }
        out[op] = r;
    }
    return out;
}

/** Compañías con el mismo nombre que `companyId` (una inmobiliaria puede estar partida en varias). */
async function grupoDe(companyId: string): Promise<{ nombre: string; ids: string[] }> {
    const ops = await opcionesInmobiliarias();
    const g = ops.find((o) => o.ids.includes(companyId));
    if (g) return { nombre: g.nombre, ids: g.ids };
    const db = await getDb();
    const c = await db.collection('companies').findOne({ _id: new ObjectId(companyId) }, { projection: { name: 1 } });
    return { nombre: String(c?.name ?? ''), ids: [companyId] };
}

export async function desempenoMb(companyId: string, desde: string, hasta: string, agentId: string | null): Promise<DesempenoMb> {
    const db = await getDb();
    const grupo = await grupoDe(companyId);
    const ids = grupo.ids.map((s) => new ObjectId(s));
    const idSet = new Set(grupo.ids);
    const aid = agentId ? new ObjectId(agentId) : null;
    const A = inicioDia(desde), B = new Date(inicioDia(hasta).getTime() + DIA);
    const hoy = new Date();

    // meses del periodo (aunque el rango empiece a medio mes, la tabla va por mes calendario)
    const meses: string[] = [];
    for (let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= hasta.slice(0, 7); m === 12 ? (y++, m = 1) : m++)
        meses.push(`${y}-${String(m).padStart(2, '0')}`);
    // un trimestre en curso no pinta los meses que aún no empiezan (noviembre y diciembre en ceros)
    while (meses.length > 1 && meses[meses.length - 1] > ymMx(hoy)) meses.pop();
    // ventana de un mes, recortada al periodo
    const ventanaMes = (ym: string): [Date, Date] => {
        const a = inicioDia(`${ym}-01`);
        const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
        const b = inicioDia(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
        return [a < A ? A : a, b > B ? B : b];
    };

    // ── asesores (para el filtro y los nombres) ────────────────────────────
    const asesores: DesempenoMb['asesores'] = [];
    const nombreAsesor = new Map<string, string>();
    for await (const a of db.collection('agents').find({ 'company._id': { $in: ids }, deletedAt: null }, { projection: { firstName: 1, lastName: 1, email: 1, status: 1 } })) {
        const n = nombreDe(a) || String(a.email ?? '');
        nombreAsesor.set(String(a._id), n);
        asesores.push({ id: String(a._id), nombre: n, activo: a.status === 'active' });
    }
    asesores.sort((x, y) => (x.activo === y.activo ? x.nombre.localeCompare(y.nombre, 'es') : x.activo ? -1 : 1));

    // ── leads únicos (contacto + propiedad) ────────────────────────────────
    const tareaLeads = (async () => {
        const vistos = new Set<string>();
        const out: Array<{ op: Op; at: Date; agent: string | null; sinResp: boolean | null }> = [];
        const cur = db.collection('leads').find(
            { 'company._id': { $in: ids }, createdAt: { $gte: A, $lt: B }, ...(aid ? { 'agent._id': aid } : {}) },
            { projection: { 'contact._id': 1, 'property._id': 1, 'property.listing.operation': 1, createdAt: 1, answeredAt: 1, 'agent._id': 1 }, batchSize: 10000 },
        ).sort({ createdAt: 1 });
        for await (const l of cur) {
            if (!isDate(l.createdAt)) continue;
            const c = dig(l, 'contact', '_id'), p = dig(l, 'property', '_id');
            const k = c && p ? `${String(c)}|${String(p)}` : String(l._id);
            if (vistos.has(k)) continue;
            vistos.add(k);
            const h = new Date(l.createdAt.getTime() - MX).getUTCHours();
            const ag = dig(l, 'agent', '_id');
            out.push({ op: opDe(dig(l, 'property', 'listing', 'operation')), at: l.createdAt, agent: ag ? String(ag) : null,
                sinResp: h >= 9 && h <= 20 ? !isDate(l.answeredAt) : null });
        }
        return out;
    })();

    // ── visitas confirmadas y pendientes, por fecha de la visita ───────────
    const tareaVisitas = (async () => {
        const vs = await db.collection('visits').find(
            { 'agent.company._id': { $in: ids }, 'status.last': { $in: ['confirmed', 'pending'] }, startTime: { $gte: A, $lt: B }, ...(aid ? { 'agent._id': aid } : {}) },
            { projection: { 'status.last': 1, startTime: 1, search: 1, contact: 1, 'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1,
                'steps.property.listing.operation': 1, 'steps.property.listing.title': 1, 'steps.property.internalId': 1, 'steps.property.address.neighborhood.name': 1 } },
        ).sort({ startTime: 1 }).toArray();
        const sids = [...new Set(vs.map((v) => v.search).filter(Boolean).map(String))].map((s) => new ObjectId(s));
        const bus = new Map<string, Document>();
        for (const l of lotes(sids))
            for await (const s of db.collection('searches').find({ _id: { $in: l } }, { projection: { 'contact.firstName': 1, 'contact.lastName': 1, 'filters.operation': 1 } }))
                bus.set(String(s._id), s);
        return vs.map((v): VisitaMb => {
            const s = bus.get(String(v.search ?? '')) ?? {};
            const pasos = (v.steps as Document[] | undefined) ?? [];
            const opPaso = pasos.map((st) => dig(st, 'property', 'listing', 'operation')).find((o) => o === 'sale' || o === 'rent');
            const status = dig(v, 'status', 'last') as 'confirmed' | 'pending';
            return {
                id: String(v._id), status, op: opDe(opPaso ?? dig(s, 'filters', 'operation')),
                ym: ymMx(v.startTime), fecha: isoMx(v.startTime),
                cliente: nombreDe(dig(s, 'contact') ?? v.contact) || 'Sin nombre',
                asesor: nombreDe(v.agent), agentId: dig(v, 'agent', '_id') ? String(dig(v, 'agent', '_id')) : null,
                vencida: status === 'pending' && v.startTime < hoy,
                propiedades: pasos.map((st) => ({
                    codigo: (dig(st, 'property', 'internalId') as string) ?? null,
                    titulo: (dig(st, 'property', 'listing', 'title') as string) ?? null,
                    colonia: (dig(st, 'property', 'address', 'neighborhood', 'name') as string) ?? null,
                })),
            };
        });
    })();

    // ── búsquedas que pudieron estar abiertas en el periodo (funnel por etapa) ──
    const tareaBusq = (async () => {
        const out: Busq[] = [];
        for await (const s of db.collection('searches').find(
            { 'company._id': { $in: ids }, type: 'client', createdAt: { $lt: B }, ...(aid ? { 'agent._id': aid } : {}),
              $or: [{ updatedAt: { $gte: A } }, { 'status.last': { $nin: ['completed', 'cancelled'] } }] },
            { projection: { 'filters.operation': 1, 'status.history': 1 } })) {
            const op = opDe(dig(s, 'filters', 'operation'));
            const hist = (((dig(s, 'status', 'history') as Document[] | undefined) ?? [])
                .filter((h) => isDate(h.timestamp) && h.status).map((h) => [h.timestamp as Date, String(h.status)] as [Date, string]))
                .sort((a, b) => a[0].getTime() - b[0].getTime());
            if (op !== 'otro' && hist.length) out.push({ op, hist });
        }
        return out;
    })();

    // ── ofertas activas (foto de hoy) ──────────────────────────────────────
    const tareaOfertas = (async () => {
        const r: Record<Op, number> = { sale: 0, rent: 0, otro: 0 };
        for await (const o of db.collection('operations').find(
            { 'status.last': { $in: OFERTA_ACTIVA }, $or: [{ 'seller.company._id': { $in: ids } }, { 'buyer.company._id': { $in: ids } }],
              ...(aid ? { $and: [{ $or: [{ 'seller.broker._id': aid }, { 'buyer.broker._id': aid }] }] } : {}) },
            { projection: { 'property.listing.operation': 1 } })) r[opDe(dig(o, 'property', 'listing', 'operation'))] += 1;
        return r;
    })();

    const [leads, visitas, busq, ofertasActivas, cierres] = await Promise.all([tareaLeads, tareaVisitas, tareaBusq, tareaOfertas, cierresMb(ids, idSet, A, B, aid)]);

    const funTot = tasas(busq, A, B);
    const vacio = (): PorOp => ({ leads: 0, confirmadas: 0, pendientes: 0, funnel: { visita: { base: 0, n: 0, tasa: null }, oferta: { base: 0, n: 0, tasa: null }, cierre: { base: 0, n: 0, tasa: null } } });
    const filas: MesDesempeno[] = meses.map((ym) => {
        const [a, b] = ventanaMes(ym);
        const f = tasas(busq, a, b);
        const fila: MesDesempeno = {
            mes: ym, enCurso: ym === ymMx(hoy), madurando: (hoy.getTime() - b.getTime()) / DIA < MADURACION,
            sale: { ...vacio(), funnel: f.sale }, rent: { ...vacio(), funnel: f.rent }, otro: { leads: 0, visitas: 0 },
        };
        return fila;
    });
    const fm = new Map(filas.map((f) => [f.mes, f]));
    for (const l of leads) { const f = fm.get(ymMx(l.at)); if (!f) continue; if (l.op === 'otro') f.otro.leads += 1; else f[l.op].leads += 1; }
    for (const v of visitas) {
        const f = fm.get(v.ym); if (!f) continue;
        if (v.op === 'otro') f.otro.visitas += 1; else if (v.status === 'confirmed') f[v.op].confirmadas += 1; else f[v.op].pendientes += 1;
    }
    const totales = Object.fromEntries(OPS.map((op) => [op, {
        leads: filas.reduce((s, f) => s + f[op].leads, 0),
        confirmadas: filas.reduce((s, f) => s + f[op].confirmadas, 0),
        pendientes: filas.reduce((s, f) => s + f[op].pendientes, 0),
        funnel: funTot[op],
    }])) as Record<'sale' | 'rent', PorOp>;

    // mapa de calor: leads únicos por asesor y mes. Un lead puede seguir asignado a un asesor que ya
    // no está (borrado o movido de inmobiliaria): se busca su nombre igual y sale marcado inactivo.
    const activos = new Set(asesores.filter((a) => a.activo).map((a) => a.id));
    const faltan = [...new Set(leads.map((l) => l.agent).filter((x): x is string => !!x && !nombreAsesor.has(x)))];
    for (const l of lotes(faltan.map((s) => new ObjectId(s))))
        for await (const a of db.collection('agents').find({ _id: { $in: l } }, { projection: { firstName: 1, lastName: 1, email: 1 } }))
            nombreAsesor.set(String(a._id), nombreDe(a) || String(a.email ?? ''));
    const pa = new Map<string, DesempenoMb['porAsesor'][number]>();
    for (const l of leads) {
        const k = l.agent ?? 'sin';
        const e = pa.get(k) ?? pa.set(k, { id: k, nombre: l.agent ? nombreAsesor.get(l.agent) || 'Asesor sin nombre' : 'Sin asesor asignado',
            activo: !l.agent || activos.has(l.agent), meses: {} }).get(k)!;
        const ym = ymMx(l.at);
        const c = e.meses[ym] ?? (e.meses[ym] = { sale: 0, rent: 0, otro: 0 });
        c[l.op] += 1;
    }
    const atencion: DesempenoMb['atencion'] = { sale: { base: 0, sin: 0 }, rent: { base: 0, sin: 0 }, otro: { base: 0, sin: 0 } };
    for (const l of leads) if (l.sinResp !== null) { atencion[l.op].base += 1; if (l.sinResp) atencion[l.op].sin += 1; }

    return {
        inmobiliaria: grupo.nombre, desde, hasta, agentId,
        asesores, meses: filas, totales,
        sinOperacion: { leads: filas.reduce((s, f) => s + f.otro.leads, 0), visitas: filas.reduce((s, f) => s + f.otro.visitas, 0) },
        porAsesor: [...pa.values()],
        atencion, ofertasActivas, visitas, cierres,
        madurando: filas.some((f) => f.madurando),
        generado: new Date().toISOString(),
    };
}

/** Cierres del periodo, del lado en que participa la inmobiliaria, con el recorrido del comprador. */
async function cierresMb(ids: ObjectId[], idSet: Set<string>, A: Date, B: Date, aid: ObjectId | null): Promise<CierreMb[]> {
    const db = await getDb();
    const q: Document = {
        'status.last': { $in: CERRADA }, closedAt: { $gte: A, $lt: B },
        // una venta entre dos inmobiliarias de la red son 2 operaciones (lado comprador y lado vendedor):
        // sólo cuenta el lado en que participa ésta
        $or: [
            { side: { $in: ['buyer', 'both'] }, 'buyer.company._id': { $in: ids } },
            { side: { $in: ['seller', 'both'] }, 'seller.company._id': { $in: ids } },
            { side: { $nin: ['buyer', 'seller', 'both'] }, $or: [{ 'buyer.company._id': { $in: ids } }, { 'seller.company._id': { $in: ids } }] },
        ],
    };
    if (aid) q.$and = [{ $or: ['buyer.broker._id', 'seller.broker._id', 'seller.producer._id', 'property.agent._id', 'user._id'].map((r) => ({ [r]: aid })) }];
    let ops: Document[] = await db.collection('operations').find(q, { projection: {
        id: 1, status: 1, createdAt: 1, closedAt: 1, side: 1, closeValue: 1, 'comission.value': 1, 'payments.comission.value': 1,
        'property._id': 1, 'property.internalId': 1, 'property.type': 1, 'property.listing.operation': 1,
        'property.address.street': 1, 'property.address.neighborhood.name': 1, 'property.address.city.name': 1,
        'buyer.contact': 1, 'buyer.company': 1, 'buyer.broker': 1, 'buyer.search': 1, 'buyer.source': 1,
        'seller.producer._id': 1, 'property.agent._id': 1, 'user._id': 1, 'seller.company._id': 1, 'seller.broker': 1,
    } }).sort({ closedAt: 1 }).toArray();

    // Lado vendedor sin comprador: se toma de la operación espejo del lado comprador (misma propiedad)
    const sinComprador = [...new Set(ops.filter((o) => !dig(o, 'buyer', 'contact', '_id') && dig(o, 'property', '_id')).map((o) => String(dig(o, 'property', '_id'))))];
    const espejo = new Map<string, Document[]>();
    for (const l of lotes(sinComprador.map((s) => new ObjectId(s))))
        for await (const e of db.collection('operations').find({ 'property._id': { $in: l }, side: 'buyer', 'status.last': { $ne: 'cancelled' }, 'buyer.contact._id': { $exists: true } },
            { projection: { 'property._id': 1, 'buyer.contact': 1, 'buyer.company': 1, 'buyer.search': 1, 'buyer.source': 1, closedAt: 1 } }))
            (espejo.get(String(dig(e, 'property', '_id'))) ?? espejo.set(String(dig(e, 'property', '_id')), []).get(String(dig(e, 'property', '_id')))!).push(e);
    for (const o of ops) {
        if (dig(o, 'buyer', 'contact', '_id')) continue;
        const cands = espejo.get(String(dig(o, 'property', '_id') ?? '')) ?? [];
        const ref = (o.closedAt as Date).getTime();
        const e = cands.sort((a, b) => Math.abs(((a.closedAt as Date | undefined)?.getTime() ?? ref) - ref) - Math.abs(((b.closedAt as Date | undefined)?.getTime() ?? ref) - ref))[0];
        if (e) o.buyer = { ...((o.buyer as Document) ?? {}), contact: dig(e, 'buyer', 'contact'), company: dig(e, 'buyer', 'company'), search: dig(e, 'buyer', 'search'), source: dig(e, 'buyer', 'source') };
    }
    // Duplicados (paying + closed de la misma venta): una por propiedad + comprador + lado
    const uniq = new Map<string, Document>();
    for (const o of ops) {
        const p = dig(o, 'property', '_id'), c = dig(o, 'buyer', 'contact', '_id');
        uniq.set(p && c ? `${String(p)}|${String(c)}|${String(o.side)}` : String(o._id), o);
    }
    ops = [...uniq.values()].sort((a, b) => (a.closedAt as Date).getTime() - (b.closedAt as Date).getTime());

    // Búsquedas del comprador (inicio y fuente), sus visitas, y los leads del comprador (fuente inferida)
    const sids = [...new Set(ops.map((o) => dig(o, 'buyer', 'search')).filter(Boolean).map(String))].map((s) => new ObjectId(s));
    const busq = new Map<string, Document>(); const visBus = new Map<string, Date[]>();
    for (const l of lotes(sids)) {
        for await (const s of db.collection('searches').find({ _id: { $in: l } }, { projection: { createdAt: 1, source: 1 } })) busq.set(String(s._id), s);
        for await (const v of db.collection('visits').find({ search: { $in: l }, 'status.last': { $ne: 'cancelled' } }, { projection: { search: 1, startTime: 1 } }))
            if (isDate(v.startTime)) (visBus.get(String(v.search)) ?? visBus.set(String(v.search), []).get(String(v.search))!).push(v.startTime);
    }
    const cids = [...new Set(ops.map((o) => dig(o, 'buyer', 'contact', '_id')).filter(Boolean).map(String))].map((s) => new ObjectId(s));
    const visCon = new Map<string, Array<{ t: Date; comp: string }>>();
    const leadsCon = new Map<string, Array<{ t: Date; src: unknown; comp: string }>>();
    for (const l of lotes(cids)) {
        for await (const v of db.collection('visits').find({ 'contact._id': { $in: l }, 'status.last': { $ne: 'cancelled' } }, { projection: { 'contact._id': 1, 'agent.company._id': 1, startTime: 1 } }))
            if (isDate(v.startTime)) (visCon.get(String(dig(v, 'contact', '_id'))) ?? visCon.set(String(dig(v, 'contact', '_id')), []).get(String(dig(v, 'contact', '_id')))!)
                .push({ t: v.startTime, comp: String(dig(v, 'agent', 'company', '_id') ?? '') });
        for await (const x of db.collection('leads').find({ 'contact._id': { $in: l } }, { projection: { 'contact._id': 1, source: 1, createdAt: 1, 'company._id': 1 } }))
            if (isDate(x.createdAt)) (leadsCon.get(String(dig(x, 'contact', '_id'))) ?? leadsCon.set(String(dig(x, 'contact', '_id')), []).get(String(dig(x, 'contact', '_id')))!)
                .push({ t: x.createdAt, src: x.source, comp: String(dig(x, 'company', '_id') ?? '') });
    }

    return ops.map((o): CierreMb => {
        const cid = dig(o, 'buyer', 'contact', '_id') ? String(dig(o, 'buyer', 'contact', '_id')) : null;
        const bc = String(dig(o, 'buyer', 'company', '_id') ?? '');
        const nuestra = idSet.has(bc);
        // compañías "del comprador": la elegida si compró por ella; otra de la red, la suya; externa, ninguna
        const bcos = nuestra ? idSet : (dig(o, 'buyer', 'company', 'external') === true || !bc ? new Set<string>() : new Set([bc]));
        const closed = o.closedAt as Date;
        const sid = dig(o, 'buyer', 'search') ? String(dig(o, 'buyer', 'search')) : null;
        const bq = sid ? busq.get(sid) : undefined;
        const busqueda = bq && isDate(bq.createdAt) && bq.createdAt <= closed ? bq.createdAt : null;
        const enRango = (t: Date) => t <= closed && (!busqueda || t >= busqueda);
        const vs = (sid ? visBus.get(sid) ?? [] : []).filter(enRango);
        const vis = vs.length ? vs : (cid ? visCon.get(cid) ?? [] : []).filter((v) => bcos.has(v.comp) && enRango(v.t)).map((v) => v.t);
        const visita = vis.length ? new Date(Math.min(...vis.map((t) => t.getTime()))) : null;
        const hist = (dig(o, 'status', 'history') as Document[] | undefined) ?? [];
        const ofertas = [...hist.filter((h) => (h.status === 'offer' || h.status === 'offer_blocked') && isDate(h.timestamp)).map((h) => h.timestamp as Date),
            ...(isDate(o.createdAt) ? [o.createdAt] : [])];
        const oferta = ofertas.length ? new Date(Math.min(...ofertas.map((t) => t.getTime()))) : null;
        const [base, baseTipo]: [Date | null, CierreMb['inicioTipo']] = busqueda ? [busqueda, 'busqueda'] : visita ? [visita, 'visita'] : [oferta, 'oferta'];

        // fuente: la regla única de /portales (capturada → primer lead con la inmobiliaria que trajo al comprador → búsqueda del asesor → cartera / sin fuente)
        const otra = !nuestra ? (dig(o, 'buyer', 'company', 'external') === true || !bc ? 'externo' : 'red') as 'externo' | 'red' : null;
        const compsLead = nuestra ? idSet : new Set([bc]);
        const primero = cid ? (leadsCon.get(cid) ?? []).filter((l) => l.t <= closed && compsLead.has(l.comp) && fuenteCapturada(l.src))
            .sort((a, b) => a.t.getTime() - b.t.getTime())[0] : undefined;
        const f = atribuirFuente({
            capturada: fuenteCapturada(dig(o, 'buyer', 'source')) ?? (busqueda ? fuenteCapturada(bq?.source) : null),
            otra, primerLead: primero ? fuenteCapturada(primero.src) : null,
            // búsqueda válida = creada antes del cierre (si se creó después, no es el inicio de este trato)
            tieneBusqueda: !!busqueda,
        });

        const pagos = (o.payments as Document[] | undefined) ?? [];
        const comision = pagos.length ? pagos.reduce((s, p) => s + (Number(dig(p, 'comission', 'value')) || 0), 0) : (dig(o, 'comission', 'value') as number | undefined) ?? null;
        const vende = idSet.has(String(dig(o, 'seller', 'company', '_id') ?? ''));
        const lado = ({ buyer: 'Comprador', seller: 'Vendedor', both: 'Ambos' } as Record<string, string>)[String(o.side)]
            ?? (nuestra && vende ? 'Ambos' : nuestra ? 'Comprador' : vende ? 'Vendedor' : '—');
        const asesor = lado === 'Comprador' || lado === 'Ambos' ? dig(o, 'buyer', 'broker') : dig(o, 'seller', 'broker');
        const op = opDe(dig(o, 'property', 'listing', 'operation'));
        return {
            id: String(o.id ?? o._id), estado: String(dig(o, 'status', 'last') ?? ''), op, lado,
            cliente: nombreDe(dig(o, 'buyer', 'contact')) || 'Sin nombre',
            inmoComprador: String(dig(o, 'buyer', 'company', 'name') ?? '').trim() || null, compradorOtraInmo: !nuestra,
            asesor: nombreDe(asesor),
            agentes: [...new Set(['buyer.broker._id', 'seller.broker._id', 'seller.producer._id', 'property.agent._id', 'user._id']
                .map((r) => dig(o, ...r.split('.'))).filter(Boolean).map(String))],
            codigo: (dig(o, 'property', 'internalId') as string) ?? null, tipo: (dig(o, 'property', 'type') as string) ?? null,
            direccion: [dig(o, 'property', 'address', 'street'), dig(o, 'property', 'address', 'neighborhood', 'name'), dig(o, 'property', 'address', 'city', 'name')].filter(Boolean).join(', '),
            monto: (dig(o, 'closeValue', 'value') as number | undefined) ?? null, moneda: String(dig(o, 'closeValue', 'currency') ?? 'MXN'),
            comision, fechaCierre: isoMx(closed),
            inicio: base ? isoMx(base) : null, inicioTipo: baseTipo,
            fuente: f.fuente, inferida: !!f.inferida, comprador: f.comprador,
            etapaVisita: baseTipo === 'busqueda' && visita ? dias(base, visita) : null,
            etapaOferta: visita && oferta && oferta >= visita ? dias(visita, oferta) : null,
            etapaCierre: dias(oferta, closed),
            diasVisita: baseTipo !== 'oferta' ? dias(base, visita) : null,
            diasOferta: dias(base, oferta), diasCierre: dias(base, closed),
        };
    });
}
