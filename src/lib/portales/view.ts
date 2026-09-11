// Scorecard mensual por portal. Porteo de `dash_data.portales_view` del dashboard local.
//
// Separa las DOS atribuciones y NO las suma (FUNDAMENTOS §2). Es el error más fácil de cometer
// con estos números, así que la UI las muestra en bloques distintos:
//
//   · ADELANTADO — cohorte del mes: leads que ENTRARON en el mes → su visita y su cierre.
//     Cohorte ESTRICTA: sólo cuenta el evento posterior al lead. Sin ese filtro el join
//     arrastra la historia previa del contacto (clientes que ya estaban en la cartera del
//     broker) e infla visitas y cierres.
//   · REZAGADO — cierres del mes: operaciones cerradas en el mes por `buyer.source`, vengan de
//     leads de cualquier mes. De aquí salen regalía, ticket y ROI.
//
// ⚠️ La tasa de visita de aquí sale MÁS BAJA que la del PDF mensual. No es otro dato: el recap
// todavía usa `metrics_lib.funnel_cohort`, que NO filtra por fecha. Corregirlo allá BAJA los
// números de reportes ya entregados, así que es decisión de Ale y no un cambio silencioso.
//
// ⚠️ El lead→cierre de los últimos ~3 meses está INMADURO por construcción: el ciclo de venta
// va de 43 a 144 días.
import { getDb } from '../data';
import {
    CANALES, KEYS, MESES, NOT, NOTP, brokerContacts, classifySource, dig, hoyMx, isDate,
    mesKey, monthWindow, num, oid, utc,
} from './metrics';
import { GRATIS, NOTA_MELI, inversionMeses, type InversionMes } from './inversion';
import { dealMes, type DealMes } from './deal';

export interface PortalMes {
    mes: string;
    // adelantado
    leads: number; unicos: number;
    pctVenta: number | null; pctBroker: number | null;
    lt60: number | null; sinResponder: number | null;
    visitas: number; tasaVisita: number | null;
    cierresCoh: number; l2c: number | null;
    // rezagado
    cierres: number; comision: number; regalia: number; ticket: number | null;
    /** Mediana de días entre el PRIMER lead de ese portal y el cierre. null = sin dato. */
    cicloDias: number | null;
    /** Cierres del mes cuyo comprador nunca tuvo un lead de ese portal (llegó por otro lado). */
    cierresSinLead: number;
    // costo — null = s/d, NO 0
    inversion: number | null;
    cpl: number | null; cpv: number | null; cpa: number | null; roi: number | null;
}

export interface Portal {
    canal: string; key: string; rows: PortalMes[];
    /** Portal pagado. WhatsApp y Pulppo son canales propios: su ROI en blanco no es un faltante. */
    pagado: boolean;
    /** Gratis ESTRUCTURAL (propiedades.com, mismo grupo que Habi): sin denominador no hay ROI. */
    gratis: boolean;
}

export interface PortalesView {
    /** Filtro aplicado. Si no es 'todas', el costo viene en null a propósito (ver `invDe`). */
    operacion: Operacion;
    meses: Array<{ key: string; label: string; parcial: boolean }>;
    portales: Portal[];
    notaMeli: string;
    /** Meses cuyo tab todavía no está cargado en el Sheet: la UI lo dice en vez de inventar 0. */
    sinInversion: string[];
    /** El deal MeLi del último mes cerrado, con su lista de revisión. */
    deal: DealMes | null;
    /** Diferencia entre lo que dice el Sheet para MeLi y lo que da la fórmula, por mes. */
    meliDiff: Array<{ mes: string; sheet: number | null; calculado: number; usado: number; fuente: string }>;
    generado: string;
}

/** Secuencia de los últimos `months` meses, terminando en el mes en curso. */
function secuencia(months: number, hoy: { y: number; m: number }): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let y = hoy.y, m = hoy.m;
    for (let i = 0; i < months; i++) { out.push([y, m]); [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1]; }
    return out.reverse();
}

/** Secuencia de meses de 'YYYY-MM' a 'YYYY-MM', ambos incluidos. */
function secuenciaEntre(desde: string, hasta: string): Array<[number, number]> {
    const [y0, m0] = desde.split('-').map(Number);
    const [y1, m1] = hasta.split('-').map(Number);
    const out: Array<[number, number]> = [];
    let y = y0, m = m0;
    // Tope de 24 meses: más allá el recorrido de leads no cabe en una sola petición.
    while ((y < y1 || (y === y1 && m <= m1)) && out.length < 24) {
        out.push([y, m]); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
    }
    return out;
}

export type Operacion = 'todas' | 'sale' | 'rent';
export interface RangoMeses { desde?: string; hasta?: string; months?: number; operacion?: Operacion }

/**
 * Scorecard por portal.
 *
 * ⚠️ El rango es de MESES COMPLETOS a propósito, no de días sueltos: la inversión vive en el
 * Sheet por mes, así que un rango "del 3 al 19" no tendría denominador y CPL/CPA/ROI saldrían
 * inventados. Para contar leads en un rango libre de fechas está `periodo.ts`, que no toca costo.
 */
export async function portalesView(opts: number | RangoMeses = 6, now = Date.now()): Promise<PortalesView> {
    const db = await getDb();
    const hoy = hoyMx(now);
    const o: RangoMeses = typeof opts === 'number' ? { months: opts } : opts;
    const oper: Operacion = o.operacion ?? 'todas';
    const seq = o.desde && o.hasta ? secuenciaEntre(o.desde, o.hasta) : secuencia(o.months ?? 6, hoy);
    if (!seq.length) throw new Error('rango de meses vacío');
    const mkeys = seq.map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`);
    const meses = seq.map(([y, m]) => ({
        key: `${y}-${String(m).padStart(2, '0')}`,
        label: `${MESES[m]} '${String(y).slice(2)}`,
        parcial: y === hoy.y && m === hoy.m,
    }));
    const A = monthWindow(seq[0][0], seq[0][1])[0];
    // Fin del rango: el cierre del último mes pedido, o mañana si ese mes sigue corriendo.
    // Sin el mínimo, un rango que termina en un mes pasado seguiría barriendo hasta hoy.
    const finUltimo = monthWindow(seq[seq.length - 1][0], seq[seq.length - 1][1])[1];
    const manana = new Date(utc(hoy.y, hoy.m, hoy.d).getTime() + 86400000);
    const B = new Date(Math.min(finUltimo.getTime(), manana.getTime()));

    // ── celdas canal × mes ─────────────────────────────────────────
    interface Celda {
        leads: number; venta: number; renta: number; baseLab: number; lt60: number; sin: number;
        unicos: Set<string>; t0: Map<string, Date>; vis: Set<string>; clo: Set<string>;
    }
    const cells = new Map<string, Celda>();
    const ck = (k: string, mk: string) => `${k}|${mk}`;
    for (const k of KEYS) for (const mk of mkeys) cells.set(ck(k, mk), {
        leads: 0, venta: 0, renta: 0, baseLab: 0, lt60: 0, sin: 0,
        unicos: new Set(), t0: new Map(), vis: new Set(), clo: new Set(),
    });

    // ── 1 pasada de leads ──────────────────────────────────────────
    const curL = db.collection('leads').find(
        { createdAt: { $gte: A, $lt: B }, ...NOT,
          ...(oper === 'todas' ? {} : { 'property.listing.operation': oper }) },
        { projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, 'property.listing.operation': 1 } });
    for await (const l of curL) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const k = classifySource(l.source as string);
        const c = cells.get(ck(k, mesKey(ca)));
        if (!c) continue;                       // canal 'otros' o mes fuera de rango
        c.leads += 1;
        const op = dig(l, 'property', 'listing', 'operation');
        if (op === 'sale') c.venta += 1; else if (op === 'rent') c.renta += 1;
        // Atención sólo en horario laboral de México (9:00–20:59). Sin este filtro el
        // "sin responder" se dispara con los leads que entran de madrugada.
        const h = new Date(ca.getTime() - 6 * 3600 * 1000).getUTCHours();
        if (h >= 9 && h <= 20) {
            c.baseLab += 1;
            const ans = l.answeredAt;
            if (!isDate(ans)) c.sin += 1;
            else if ((ans.getTime() - ca.getTime()) / 60000 < 60) c.lt60 += 1;
        }
        const cid = dig(l, 'contact', '_id');
        if (cid != null) {
            const s = String(cid);
            c.unicos.add(s);
            const prev = c.t0.get(s);
            if (!prev || ca < prev) c.t0.set(s, ca);
        }
    }

    // Índice contacto → celdas donde aparece, con su primer lead. Evita recorrer las 48 celdas
    // por cada visita y cada operación (el Python lo hacía y era O(eventos × celdas)).
    const porContacto = new Map<string, Array<{ c: Celda; t0: Date }>>();
    for (const c of cells.values())
        for (const [s, t0] of c.t0) {
            const arr = porContacto.get(s) ?? porContacto.set(s, []).get(s)!;
            arr.push({ c, t0 });
        }
    const allc = [...porContacto.keys()];
    const oids = allc.map(oid).filter((o): o is NonNullable<typeof o> => !!o);

    // ── 2 joins batcheados: visitas y operaciones de esos contactos ─
    const LOTE = 5000;
    for (let i = 0; i < oids.length; i += LOTE) {
        const chunk = oids.slice(i, i + LOTE);
        const cv = db.collection('visits').find(
            { 'contact._id': { $in: chunk }, 'status.last': { $ne: 'cancelled' } },
            { projection: { 'contact._id': 1, createdAt: 1 } });
        for await (const v of cv) {
            const at = v.createdAt;
            if (!isDate(at)) continue;
            const s = String(dig(v, 'contact', '_id'));
            for (const { c, t0 } of porContacto.get(s) ?? []) if (at >= t0) c.vis.add(s);
        }
        const co = db.collection('operations').find(
            { 'buyer.contact._id': { $in: chunk }, 'status.last': { $in: ['closed', 'paying'] } },
            { projection: { 'buyer.contact._id': 1, closedAt: 1 } });
        for await (const o of co) {
            const at = o.closedAt;
            if (!isDate(at)) continue;
            const s = String(dig(o, 'buyer', 'contact', '_id'));
            for (const { c, t0 } of porContacto.get(s) ?? []) if (at >= t0) c.clo.add(s);
        }
    }

    const bset = await brokerContacts(allc);

    // ── cierres del mes por buyer.source (rezagado) ────────────────
    interface Atras { n: number; comision: number; regalia: number; gmv: number; dias: number[]; sinLead: number }
    const back = new Map<string, Atras>();
    for (const k of KEYS) for (const mk of mkeys)
        back.set(ck(k, mk), { n: 0, comision: 0, regalia: 0, gmv: 0, dias: [], sinLead: 0 });
    // Se guardan los cierres para, después, medir el ciclo con UNA consulta de leads en vez de
    // una por operación.
    const cierresCiclo: Array<{ cell: string; canal: string; cid: string; cerr: Date }> = [];
    const curO = db.collection('operations').find(
        { 'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: A, $lt: B }, ...NOTP,
          ...(oper === 'todas' ? {} : { 'property.listing.operation': oper }) },
        { projection: { 'buyer.source': 1, 'buyer.contact._id': 1, closedAt: 1, 'comission.value': 1, 'pulppoComission.value': 1, 'closeValue.value': 1 } });
    for await (const o of curO) {
        const cl = o.closedAt;
        if (!isDate(cl)) continue;
        const canal = classifySource(dig(o, 'buyer', 'source') as string);
        const cell = ck(canal, mesKey(cl));
        const r = back.get(cell);
        if (!r) continue;
        r.n += 1;
        r.comision += num(dig(o, 'comission', 'value'));
        r.regalia += num(dig(o, 'pulppoComission', 'value'));
        r.gmv += num(dig(o, 'closeValue', 'value'));
        const bc = dig(o, 'buyer', 'contact', '_id');
        if (bc != null) cierresCiclo.push({ cell, canal, cid: String(bc), cerr: cl });
        else r.sinLead += 1;
    }

    // ── ciclo de venta: del PRIMER lead de ese portal al cierre ─────
    // Se mide contra el lead más antiguo DE ESE MISMO PORTAL anterior al cierre. Si el
    // comprador nunca tuvo uno (llegó por otro lado y la atribución lo puso ahí), no se
    // inventa un cero: se cuenta aparte en `cierresSinLead`, que por sí solo dice algo.
    if (cierresCiclo.length) {
        const cids = [...new Set(cierresCiclo.map((x) => x.cid))]
            .map(oid).filter((o): o is NonNullable<typeof o> => !!o);
        const primerLead = new Map<string, Date>();   // `${cid}|${canal}` → fecha más antigua
        for (let i = 0; i < cids.length; i += 3000) {
            const cur = db.collection('leads').find(
                { 'contact._id': { $in: cids.slice(i, i + 3000) } },
                { projection: { 'contact._id': 1, source: 1, createdAt: 1 }, batchSize: 10000 });
            for await (const l of cur) {
                const ca = l.createdAt;
                if (!isDate(ca)) continue;
                const key = `${String(dig(l, 'contact', '_id'))}|${classifySource(l.source as string)}`;
                const pv = primerLead.get(key);
                if (!pv || ca < pv) primerLead.set(key, ca);
            }
        }
        for (const x of cierresCiclo) {
            const t0 = primerLead.get(`${x.cid}|${x.canal}`);
            const r = back.get(x.cell)!;
            if (t0 && t0 <= x.cerr) r.dias.push(Math.round((x.cerr.getTime() - t0.getTime()) / 86400000));
            else r.sinLead += 1;
        }
    }
    const mediana = (xs: number[]): number | null => {
        if (!xs.length) return null;
        const v = [...xs].sort((a, b) => a - b), m = v.length >> 1;
        return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
    };

    // ── inversión (Sheet) + deal MeLi ──────────────────────────────
    const inv = await inversionMeses(mkeys);
    // El deal se calcula para todos los meses del rango: es lo que define la inversión de MeLi.
    const deals = new Map<string, DealMes>();
    for (const mk of mkeys) deals.set(mk, await dealMes(mk));

    /** Inversión del canal en el mes. null = no sé (mostrar s/d), 0 sólo si es gratis real. */
    const invDe = (mk: string, k: string): number | null => {
        // ⚠️ Los portales NO facturan por operación: se paga el aviso, no la venta o la renta.
        // Con el filtro puesto, el denominador correcto no existe — dividir la inversión total
        // entre los leads de venta daría un CPL inflado (y entre los de renta, otro). Se
        // devuelve null y la UI dice por qué, en vez de imprimir un número que parece real.
        if (oper !== 'todas') return null;
        if (GRATIS.has(k)) return 0;
        const im: InversionMes | undefined = inv[mk];
        // MeLi no se lee del Sheet: es base fija + 6% del deal (conciliado si lo hay).
        if (k === 'meli') return deals.get(mk)?.inversion ?? null;
        if (!im || im.faltante) return null;
        const v = im.canales[k];
        return v === undefined ? null : v;
    };

    // ── armar salida ───────────────────────────────────────────────
    const portales: Portal[] = [];
    for (const [name, k] of CANALES) {
        const rows: PortalMes[] = mkeys.map((mk) => {
            const c = cells.get(ck(k, mk))!;
            const bk = back.get(ck(k, mk))!;
            const n = c.leads, u = c.unicos.size, vis = c.vis.size;
            const nb = [...c.unicos].filter((s) => bset.has(s)).length;
            const invm = invDe(mk, k);
            // Redondeo a 1 decimal. ⚠️ Difiere del Python en los empates exactos en .x5:
            // `round()` de Python es bancario (31.25 → 31.2) y `Math.round` es medio-arriba
            // (31.25 → 31.3). Verificado contra los 6 meses: pasa en 1 de 480 celdas
            // (Casas y Terrenos, mayo, 55/176 brokers). Se deja medio-arriba, que es lo que
            // espera cualquiera que rehaga la división a mano.
            const r1 = (x: number) => Math.round(x * 10) / 10;
            return {
                mes: mk,
                leads: n, unicos: u,
                pctVenta: n ? r1((100 * c.venta) / n) : null,
                pctBroker: u ? r1((100 * nb) / u) : null,
                lt60: c.baseLab ? r1((100 * c.lt60) / c.baseLab) : null,
                sinResponder: c.baseLab ? r1((100 * c.sin) / c.baseLab) : null,
                visitas: vis,
                tasaVisita: u ? r1((100 * vis) / u) : null,
                cierresCoh: c.clo.size,
                l2c: u ? Math.round((100 * c.clo.size) / u * 100) / 100 : null,
                cierres: bk.n, comision: Math.round(bk.comision), regalia: Math.round(bk.regalia),
                // Ticket = valor de cierre promedio (GMV ÷ cierres), no la comisión.
                ticket: bk.n ? Math.round(bk.gmv / bk.n) : null,
                cicloDias: mediana(bk.dias),
                cierresSinLead: bk.sinLead,
                inversion: invm,
                cpl: invm !== null && n ? Math.round(invm / n) : null,
                cpv: invm !== null && vis ? Math.round(invm / vis) : null,
                cpa: invm !== null && bk.n ? Math.round(invm / bk.n) : null,
                // ROI = regalía / inversión. Con inversión 0 (gratis) no hay denominador.
                roi: invm ? Math.round((bk.regalia / invm) * 100) / 100 : null,
            };
        });
        if (!rows.some((r) => r.leads || r.cierres)) continue;
        portales.push({
            canal: name, key: k, rows,
            pagado: k !== 'whatsapp' && k !== 'pulppo',
            gratis: GRATIS.has(k),
        });
    }
    portales.sort((a, b2) => b2.rows.reduce((s, r) => s + r.leads, 0) - a.rows.reduce((s, r) => s + r.leads, 0));

    // Último mes CERRADO: es el que tiene sentido conciliar con MeLi.
    const cerrado = mkeys[mkeys.length - 2] ?? mkeys[mkeys.length - 1];

    return {
        operacion: oper,
        meses, portales, notaMeli: NOTA_MELI,
        sinInversion: mkeys.filter((mk) => inv[mk]?.faltante),
        deal: deals.get(cerrado) ?? null,
        meliDiff: mkeys.map((mk) => {
            const d = deals.get(mk)!;
            return {
                mes: mk, sheet: inv[mk]?.meliSheet ?? null,
                calculado: d.inversion, usado: d.inversion, fuente: d.fuente,
            };
        }),
        generado: new Date(now).toISOString(),
    };
}
