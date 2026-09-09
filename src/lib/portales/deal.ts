// El "deal MeLi": MercadoLibre cobra base fija $152,800 + 6% de la comisión de las operaciones
// que le atribuye. Ese 6% es la parte variable de la inversión del canal, y sin él no hay CPA
// ni ROI de MeLi.
//
// 🛑 ESTO NO SE PUEDE AUTOMATIZAR AL 100%, y el módulo está escrito para no fingir que sí.
// Ninguna regla derivable de Mongo reproduce los tres meses conciliados (hallazgo 9-sep-2026):
//
//   mes   R1 (buyer.source=meli + funnel completed)   R2 (cualquier lead isMeliDeal)   Ale
//   jun            $42,141.91  ✓                              $48,721.21            $42,141.91
//   jul            $32,405.91  ✓                              $50,057.91            $32,405.91
//   ago            $82,651.62                                 $94,154.00  ≈tabla     $48,026.30
//
// R1 clava junio y julio; R2 reproduce la tabla de agosto de MeLi (19 ops = sus 18 + una).
// Se contradicen: o MeLi cambió su atribución, o la tabla de agosto sale de otra consulta
// (trae una columna "Mes Imputación" que las anteriores no tenían). Falta confirmarlo.
//
// Y hay una exclusión que NO es derivable: Ale saca `ABD-JUOZJPIVQ` ($355,000) porque no está
// en la tabla de MeLi, pero en Mongo no hay ninguna señal que lo distinga (lead del mismo mes,
// sin otro portal en medio, misma propiedad anunciada).
//
// Por eso: los meses conciliados MANDAN (`MELI_CONFIRMADO`), y para los demás se calcula la
// base y se entrega una LISTA DE REVISIÓN ordenada por riesgo, para que quien cierre el mes
// decida con los datos enfrente en vez de heredar un número inventado.
import { type Document } from 'mongodb';
import { getDb } from '../data';
import { classifySource, dig, isDate, monthWindow, num, oid, NOTP } from './metrics';
import { MELI_BASE, MELI_CONFIRMADO } from './inversion';

const SRC = { $regex: 'mercadolibre', $options: 'i' } as const;

export interface DealOp {
    id: string | null;
    inmobiliaria: string | null;
    propiedad: string | null;
    operacion: string | null;
    comision: number;
    seis: number;
    /** Meses entre el lead MeLi más antiguo del comprador y el cierre. */
    antiguedadMeses: number;
    /** Último lead de OTRO portal que entró entre el lead de MeLi y el cierre ('' si ninguno). */
    ultimoOtroPortal: string;
    /** El aviso de MeLi apuntaba a otra propiedad que la que se cerró. */
    propiedadDistinta: boolean;
    /** Cumple además la regla estricta R1 (buyer.source meli + ese lead con funnel completed). */
    r1: boolean;
    /** Motivos por los que vale revisarla a mano antes de pagarla. */
    banderas: string[];
}

export interface DealMes {
    mes: string;
    /** Base automática = R2 (la que reproduce la tabla de MeLi). */
    ops: DealOp[];
    comisionR2: number;
    seisR2: number;
    comisionR1: number;
    seisR1: number;
    /** El 6% que Ale ya concilió a mano, si existe para el mes. Manda sobre todo lo demás. */
    seisConfirmado: number | null;
    /** Inversión total del canal en el mes = base fija + el 6% que aplique. */
    inversion: number;
    /** De dónde salió `inversion`. */
    fuente: 'conciliado' | 'calculado';
}

/**
 * Deal MeLi del mes. `mes` en 'YYYY-MM'.
 *
 * R2 = toda operación closed/paying cerrada en el mes cuyo COMPRADOR tenga algún lead de
 * MercadoLibre con `isMeliDeal=true`. Deliberadamente NO filtra por `buyer.source` ni por el
 * estado del funnel: hacerlo tiraba operaciones reales del deal (en agosto se caían 5 por
 * $191,706 sólo por tener el comprador atribuido a i24 o a `other`), y omitir los `paying`
 * tiraba otra de $355K.
 */
export async function dealMes(mes: string): Promise<DealMes> {
    const db = await getDb();
    const [y, m] = mes.split('-').map(Number);
    const [a, b] = monthWindow(y, m);

    const cand = await db.collection('operations').find({
        'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: a, $lt: b }, ...NOTP,
    }, {
        projection: {
            id: 1, closedAt: 1, 'comission.value': 1, 'buyer.source': 1, 'buyer.contact._id': 1,
            'property.internalId': 1, 'property.company.name': 1, 'property.listing.operation': 1,
        },
    }).toArray();

    // ⚠️ Batchear no es optimización cosmética: una consulta por operación (159 × 3) tarda
    // más de 2 minutos y no cabe en el límite de una función serverless. Se hace en 4 pasadas
    // sobre conjuntos, y sólo las ~20 operaciones que ya calificaron pagan consultas extra.
    const compradores = cand
        .map((o) => oid(dig(o, 'buyer', 'contact', '_id')))
        .filter((c): c is NonNullable<typeof c> => !!c);

    // 1) todos los leads del deal de esos compradores, agrupados por contacto
    const porContacto = new Map<string, Document[]>();
    const curL = db.collection('leads').find(
        { 'contact._id': { $in: compradores }, source: SRC, isMeliDeal: true },
        { projection: { createdAt: 1, search: 1, 'contact._id': 1, 'property.internalId': 1 } },
    );
    for await (const L of curL) {
        const k = String(dig(L, 'contact', '_id'));
        (porContacto.get(k) ?? porContacto.set(k, []).get(k)!).push(L);
    }
    for (const ls of porContacto.values())
        ls.sort((x, z) => (x.createdAt as Date).getTime() - (z.createdAt as Date).getTime());

    // 2) de esos leads, cuáles tienen su propio funnel en `completed` (para R1)
    const sids = [...porContacto.values()].flat().map((L) => oid(L.search))
        .filter((s): s is NonNullable<typeof s> => !!s);
    const completos = new Set<string>();
    if (sids.length) {
        const curS = db.collection('searches').find(
            { _id: { $in: sids }, 'status.last': 'completed' }, { projection: { _id: 1 } });
        for await (const s of curS) completos.add(String(s._id));
    }

    // 3) leads de OTROS portales de esos compradores (para la regla de último toque)
    const conDeal = [...porContacto.keys()].map(oid)
        .filter((c): c is NonNullable<typeof c> => !!c);
    const otrosPorContacto = new Map<string, Document[]>();
    if (conDeal.length) {
        const curO = db.collection('leads').find(
            { 'contact._id': { $in: conDeal }, source: { $not: SRC } },
            { projection: { source: 1, createdAt: 1, 'contact._id': 1 } });
        for await (const L of curO) {
            const k = String(dig(L, 'contact', '_id'));
            (otrosPorContacto.get(k) ?? otrosPorContacto.set(k, []).get(k)!).push(L);
        }
    }

    const ops: DealOp[] = [];
    for (const o of cand) {
        const cid = oid(dig(o, 'buyer', 'contact', '_id'));
        const cerr = o.closedAt;
        if (!cid || !isDate(cerr)) continue;
        const meli = porContacto.get(String(cid));
        if (!meli?.length) continue;

        const primero = meli[0].createdAt as Date;
        // R1 = buyer.source meli Y alguno de sus leads del deal con funnel completed.
        const r1 = classifySource(dig(o, 'buyer', 'source') as string) === 'meli'
            && meli.some((L) => { const s = oid(L.search); return !!s && completos.has(String(s)); });

        // El último lead de otro PORTAL entre el de MeLi y el cierre.
        // Sólo canales reconocidos: un `source` de "teléfono principal" o similar no compite
        // por la atribución del cierre y sólo mete ruido en la lista de revisión.
        const otro = (otrosPorContacto.get(String(cid)) ?? [])
            .filter((L) => {
                const at = L.createdAt;
                const c = classifySource(L.source as string);
                return isDate(at) && at > primero && at <= cerr && c !== 'otros' && c !== 'meli';
            })
            .sort((x, z) => (z.createdAt as Date).getTime() - (x.createdAt as Date).getTime())
            .slice(0, 1);

        const propAviso = dig(meli[meli.length - 1], 'property', 'internalId') as string | null;
        const propCerrada = dig(o, 'property', 'internalId') as string | null;
        const distinta = !!propAviso && !!propCerrada && propAviso !== propCerrada;
        const meses = Math.round((cerr.getTime() - primero.getTime()) / (30.4 * 86400000));
        const com = num(dig(o, 'comission', 'value'));

        const banderas: string[] = [];
        // 12 meses es el corte que separa el único caso que Ale sacó por último toque
        // (017-QIRQJFZCD, 24 meses) del resto del universo de agosto (máximo 6).
        if (meses >= 12) banderas.push(`lead de MeLi de ${meses} meses`);
        if (otro.length) {
            const src = String(otro[0].source ?? '');
            const at = otro[0].createdAt as Date;
            banderas.push(`entró ${src} en ${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`);
        }
        if (distinta) banderas.push(`se anunció ${propAviso} y cerró ${propCerrada}`);

        ops.push({
            id: (o.id as string) ?? null,
            inmobiliaria: dig(o, 'property', 'company', 'name') as string | null,
            propiedad: propCerrada, operacion: dig(o, 'property', 'listing', 'operation') as string | null,
            comision: com, seis: com * 0.06,
            antiguedadMeses: meses,
            ultimoOtroPortal: otro.length ? String(otro[0].source ?? '') : '',
            propiedadDistinta: distinta, r1, banderas,
        });
    }

    // Más grande primero: es donde se decide el número.
    ops.sort((x, z) => z.comision - x.comision);
    const comisionR2 = ops.reduce((s, o) => s + o.comision, 0);
    const comisionR1 = ops.filter((o) => o.r1).reduce((s, o) => s + o.comision, 0);
    const conf = MELI_CONFIRMADO[mes] ?? null;

    return {
        mes, ops,
        comisionR2, seisR2: comisionR2 * 0.06,
        comisionR1, seisR1: comisionR1 * 0.06,
        seisConfirmado: conf,
        inversion: MELI_BASE + (conf ?? comisionR2 * 0.06),
        fuente: conf === null ? 'calculado' : 'conciliado',
    };
}
