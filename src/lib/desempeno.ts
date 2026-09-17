// Desempeño comercial por asesor: leads, respuesta, visitas, ofertas y cierres del año.
//
// Port de `andina_pull.py` (el paquete `andina-leads-dashboard`), que hoy vive como un
// Artifact público y se refresca A MANO. Dos cosas cambian al traerlo acá:
//
// 1. **Deja de caducar.** El Artifact lleva un snapshot embebido y su propio README lo dice:
//    "no hay un cron/proceso corriendo solo... cada actualización se ha hecho a mano". Acá se
//    lee de Mongo en el momento.
// 2. **Deja de ser público.** El Artifact está publicado como `public` — cualquiera con el
//    link ve los leads y cierres por asesor de una inmobiliaria. Dentro de la app hereda el
//    login y `canAccessCompany`, así que sólo lo ve quien es de esa casa.
//
// Está parametrizado por `companyId` aunque hoy sólo se muestre en una cuenta: el cálculo no
// tiene nada específico de Andina, y hardcodearlo obligaría a tocar el motor para abrirlo.
//
// ⚠️ Ojo con el ID: existe otra compañía llamada sólo "andina" (`6a545c24ecc8f755fefe2a7d`,
// creada 2026-07-13) que es un duplicado VACÍO. La buena es `62b4b39abd1764a48e09f01f`.
import { ObjectId } from 'mongodb';
import { getDb } from './data';

// Estados del diccionario oficial. "Activa" es una FOTO del pipeline de hoy, no un histórico.
const OFERTA_ACTIVA = new Set(['offer', 'offer_blocked', 'contract']);
// `paying` entra: es cobrando, incluye parcialidades — ya se cerró.
const CERRADA = new Set(['closed', 'paying']);

const OP: Record<string, Tipo> = { rent: 'renta', sale: 'venta' };

export type Tipo = 'renta' | 'venta' | 'otro';

export interface Celda {
    agentId: string; asesor: string; mes: number; tipo: Tipo;
    leads: number; respondidos: number; visitas: number; cierres: number;
}

export interface Desempeno {
    company: string;
    anio: number;
    calculadoEn: string;
    asesores: string[];
    celdas: Celda[];
    /** foto de HOY del pipeline abierto, por asesor y tipo */
    ofertasActivas: { agentId: string; asesor: string; tipo: Tipo; n: number }[];
    /** totales de la EMPRESA: cuentan cualquier operación, aunque su asesor ya no esté activo */
    totales: { ofertasActivas: Record<string, number>; cierres: Record<string, number> };
}

type Doc = Record<string, unknown>;

function pick(o: unknown, ...ruta: string[]): unknown {
    let cur: unknown = o;
    for (const k of ruta) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = (cur as Doc)[k];
    }
    return cur;
}

const tipoDe = (v: unknown): Tipo => OP[String(v ?? '')] ?? 'otro';

export async function desempenoDe(companyId: string, anio: number): Promise<Desempeno> {
    const db = await getDb();
    const cid = new ObjectId(companyId);
    const desde = new Date(Date.UTC(anio, 0, 1));
    const hasta = new Date(Date.UTC(anio + 1, 0, 1));

    // La CARTERA ACTIVA de hoy. Las tablas por asesor sólo atribuyen a quien sigue activo, así
    // que pueden sumar un poco menos que el total de la empresa — es esperado, no un error, y
    // por eso los totales se calculan aparte.
    const agentes = await db.collection('agents').find(
        { 'company._id': cid, status: 'active' },
        { projection: { firstName: 1, lastName: 1, 'company.name': 1 } }
    ).toArray() as Doc[];

    const nombre = new Map<string, string>();
    for (const a of agentes) {
        const n = `${String(a.firstName ?? '').trim()} ${String(a.lastName ?? '').trim()}`.trim();
        if (n) nombre.set(String(a._id), n);
    }

    const celdas = new Map<string, Celda>();
    const celda = (aid: string, mes: number, tipo: Tipo): Celda => {
        const k = `${aid}|${mes}|${tipo}`;
        let c = celdas.get(k);
        if (!c) {
            c = { agentId: aid, asesor: nombre.get(aid) ?? '', mes, tipo,
                  leads: 0, respondidos: 0, visitas: 0, cierres: 0 };
            celdas.set(k, c);
        }
        return c;
    };

    // ── LEADS. El mes sale de `createdAt` y el tipo, de la operación del aviso que lo generó.
    const leads = await db.collection('leads').find(
        { 'company._id': cid, createdAt: { $gte: desde, $lt: hasta } },
        { projection: { 'agent._id': 1, createdAt: 1, answeredAt: 1,
                        'property.listing.operation': 1 } }
    ).toArray() as Doc[];

    for (const l of leads) {
        const aid = String(pick(l, 'agent', '_id') ?? '');
        if (!nombre.has(aid)) continue;   // asignado a alguien fuera de la cartera activa
        const c = celda(aid, (l.createdAt as Date).getUTCMonth() + 1,
                        tipoDe(pick(l, 'property', 'listing', 'operation')));
        c.leads += 1;
        // la tasa de respuesta sale de `answeredAt`: NO existe `contactedAt` en esta colección
        if (l.answeredAt) c.respondidos += 1;
    }

    // ── VISITAS. El tipo se toma de la PRIMERA propiedad visitada: una visita puede recorrer
    // varias y no hay un campo de operación propio de la visita.
    const visitas = await db.collection('visits').find(
        { 'agent.company._id': cid, createdAt: { $gte: desde, $lt: hasta } },
        { projection: { 'agent._id': 1, createdAt: 1, 'steps.property.listing.operation': 1 } }
    ).toArray() as Doc[];

    for (const v of visitas) {
        const aid = String(pick(v, 'agent', '_id') ?? '');
        if (!nombre.has(aid)) continue;
        const pasos = (v.steps ?? []) as Doc[];
        const tipo = pasos.length
            ? tipoDe(pick(pasos[0], 'property', 'listing', 'operation')) : 'otro';
        celda(aid, (v.createdAt as Date).getUTCMonth() + 1, tipo).visitas += 1;
    }

    // ── OPERACIONES.
    //
    // La atribución NO usa `operations.user`: se midió que viene vacío en operaciones reales y
    // activas (por ejemplo tratos con `side: seller` donde sólo se llenó `seller.broker`). La
    // fuente son `seller.broker._id` y `buyer.broker._id`.
    //
    // Un mismo trato puede contar para DOS asesores si los dos lados son de la casa — y para
    // uno solo si la misma persona trabajó ambos lados, por eso se juntan en un Set.
    //
    // Cierres: operaciones creadas EN EL AÑO que llegaron a cerrada, contadas en el mes en que
    // se CREARON (cohorte), no en el que cerraron.
    const ops = await db.collection('operations').find(
        { $or: [{ 'seller.company._id': cid }, { 'buyer.company._id': cid }] },
        { projection: { 'seller.broker._id': 1, 'seller.company._id': 1,
                        'buyer.broker._id': 1, 'buyer.company._id': 1,
                        status: 1, 'property.listing.operation': 1, createdAt: 1 } }
    ).toArray() as Doc[];

    const activas = new Map<string, { agentId: string; asesor: string; tipo: Tipo; n: number }>();
    const totOfertas: Record<string, number> = {};
    const totCierres: Record<string, number> = {};

    for (const op of ops) {
        const ladoV = String(pick(op, 'seller', 'company', '_id') ?? '') === companyId;
        const ladoC = String(pick(op, 'buyer', 'company', '_id') ?? '') === companyId;
        if (!ladoV && !ladoC) continue;

        const tipo = tipoDe(pick(op, 'property', 'listing', 'operation'));
        const estado = String(pick(op, 'status', 'last') ?? '');
        const creada = op.createdAt as Date | undefined;
        const esDelAnio = creada instanceof Date && creada >= desde && creada < hasta;

        if (OFERTA_ACTIVA.has(estado)) totOfertas[tipo] = (totOfertas[tipo] ?? 0) + 1;
        if (CERRADA.has(estado) && esDelAnio) totCierres[tipo] = (totCierres[tipo] ?? 0) + 1;

        const suyos = new Set<string>();
        if (ladoV) {
            const s = String(pick(op, 'seller', 'broker', '_id') ?? '');
            if (nombre.has(s)) suyos.add(s);
        }
        if (ladoC) {
            const b = String(pick(op, 'buyer', 'broker', '_id') ?? '');
            if (nombre.has(b)) suyos.add(b);
        }

        for (const aid of suyos) {
            if (OFERTA_ACTIVA.has(estado)) {
                const k = `${aid}|${tipo}`;
                const a = activas.get(k)
                    ?? { agentId: aid, asesor: nombre.get(aid) ?? '', tipo, n: 0 };
                a.n += 1; activas.set(k, a);
            }
            if (CERRADA.has(estado) && esDelAnio) {
                celda(aid, creada!.getUTCMonth() + 1, tipo).cierres += 1;
            }
        }
    }

    return {
        company: String(pick(agentes[0], 'company', 'name') ?? ''),
        anio,
        calculadoEn: new Date().toISOString(),
        asesores: [...nombre.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        celdas: [...celdas.values()],
        ofertasActivas: [...activas.values()],
        totales: { ofertasActivas: totOfertas, cierres: totCierres }
    };
}
