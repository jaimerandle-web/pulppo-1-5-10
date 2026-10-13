// Calidad del lead por portal y por mes: quién descarta, por qué, y cuánto de lo que llega
// es broker en vez de cliente final.
//
// Vive aparte de `view.ts` a propósito. El scorecard ya tarda ~20 s recorriendo leads, visitas
// y operaciones; esto suma un join contra `searches` de TODOS los leads del rango. Juntos no
// caben cómodos en una petición, y además no se miran al mismo tiempo: el costo se revisa al
// cerrar el mes, la calidad cuando algo se siente mal.
//
// ⚠️ El descarte MADURA. Un lead de esta semana casi no ha tenido tiempo de cancelarse, así que
// el mes en curso SIEMPRE se ve más limpio de lo que va a terminar siendo. Por eso la vista
// marca el mes parcial y no se debe leer la última columna como una mejora.
import { getDb } from '../data';
import {
    CANALES, KEYS, MESES, NOT, brokerContacts, classifySource, dig, hoyMx, isDate, mesKey,
    monthWindow, oid, utc,
} from './metrics';
import type { Operacion } from './view';

// Los mismos motivos y etiquetas que usa el pulso, para que no haya dos vocabularios.
const RLBL: Record<string, string> = {
    descartado: 'Descartado (genérico)', asesor: 'Cliente era asesor/broker',
    fantasma: 'Fantasma / no contesta', perdido: 'Perdido', incontactable: 'Incontactable',
    inesperado: 'Inesperado', sent_to_ai: 'Enviado a IA', stop_answering: 'Dejó de responder',
    lost_interest: 'Perdió interés', operaton_with_other_broker: 'Cerró con otro broker',
};
// Agrupación en cuatro familias, que es como se decide algo. El detalle fino queda disponible
// en `motivos`, pero para comparar portales mes a mes nadie usa diez columnas.
const FAMILIA: Record<string, 'incontactable' | 'broker' | 'noResponde' | 'perdido'> = {
    incontactable: 'incontactable',
    asesor: 'broker',
    fantasma: 'noResponde', stop_answering: 'noResponde', sent_to_ai: 'noResponde',
};

export interface CalidadMes {
    mes: string;
    leads: number;
    /** Leads cuyo funnel terminó cancelado con motivo. */
    descartados: number;
    pctDescartado: number | null;
    pctIncontactable: number | null;
    pctBroker: number | null;       // motivo "era asesor/broker"
    pctNoResponde: number | null;
    pctPerdido: number | null;
    /** % de contactos únicos etiquetados como broker (distinto del motivo de descarte). */
    pctBrokerTag: number | null;
}
export interface CalidadPortal { canal: string; key: string; rows: CalidadMes[] }
export interface CalidadView {
    operacion: Operacion;
    meses: Array<{ key: string; label: string; parcial: boolean }>;
    portales: CalidadPortal[];
    /** Top motivos del último mes cerrado, por portal. */
    motivos: Array<{ canal: string; filas: Array<{ motivo: string; n: number; pct: number }> }>;
    mesCerrado: string;
    generado: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const p1 = (a: number, b: number) => (b ? r1((100 * a) / b) : null);

export async function calidadView(
    opts: { desde?: string; hasta?: string; months?: number; operacion?: Operacion } = {},
    now = Date.now(),
): Promise<CalidadView> {
    const db = await getDb();
    const hoy = hoyMx(now);
    const oper: Operacion = opts.operacion ?? 'todas';

    const seq: Array<[number, number]> = [];
    if (opts.desde && opts.hasta) {
        const [y0, m0] = opts.desde.split('-').map(Number);
        const [y1, m1] = opts.hasta.split('-').map(Number);
        let y = y0, m = m0;
        while ((y < y1 || (y === y1 && m <= m1)) && seq.length < 24) {
            seq.push([y, m]); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
        }
    } else {
        let y = hoy.y, m = hoy.m;
        for (let i = 0; i < (opts.months ?? 6); i++) { seq.push([y, m]); [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1]; }
        seq.reverse();
    }
    if (!seq.length) throw new Error('rango de meses vacío');

    const mkeys = seq.map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`);
    const meses = seq.map(([y, m]) => ({
        key: `${y}-${String(m).padStart(2, '0')}`,
        label: `${MESES[m]} '${String(y).slice(2)}`,
        parcial: y === hoy.y && m === hoy.m,
    }));
    const A = monthWindow(seq[0][0], seq[0][1])[0];
    const fin = monthWindow(seq[seq.length - 1][0], seq[seq.length - 1][1])[1];
    const B = new Date(Math.min(fin.getTime(), utc(hoy.y, hoy.m, hoy.d).getTime() + 86400000));

    interface Celda {
        leads: number; unicos: Set<string>;
        searches: string[];
        motivos: Map<string, number>;
    }
    const cells = new Map<string, Celda>();
    const ck = (k: string, mk: string) => `${k}|${mk}`;
    for (const k of KEYS) for (const mk of mkeys)
        cells.set(ck(k, mk), { leads: 0, unicos: new Set(), searches: [], motivos: new Map() });

    const cur = db.collection('leads').find(
        { createdAt: { $gte: A, $lt: B }, ...NOT,
          ...(oper === 'todas' ? {} : { 'property.listing.operation': oper }) },
        { projection: { source: 1, createdAt: 1, search: 1, 'contact._id': 1 }, batchSize: 10000 });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const c = cells.get(ck(classifySource(l.source as string), mesKey(ca)));
        if (!c) continue;
        c.leads += 1;
        const cid = dig(l, 'contact', '_id');
        if (cid != null) c.unicos.add(String(cid));
        if (l.search) c.searches.push(String(l.search));
    }

    // ── motivos de descarte: una consulta por lotes sobre `searches` ─
    // Se arma el índice search → celdas ANTES de consultar: una misma búsqueda puede venir de
    // leads de dos portales distintos, y en ese caso cuenta en los dos (multi-touch, igual que
    // en el pulso). No se reparte culpa: la pregunta es qué portales aparecen detrás del motivo.
    const sid2cells = new Map<string, Set<string>>();
    for (const [cellKey, c] of cells)
        for (const sid of c.searches)
            (sid2cells.get(sid) ?? sid2cells.set(sid, new Set()).get(sid)!).add(cellKey);
    const ids = [...sid2cells.keys()].map(oid).filter((o): o is NonNullable<typeof o> => !!o);
    for (let i = 0; i < ids.length; i += 2000) {
        const cs = db.collection('searches').find(
            { _id: { $in: ids.slice(i, i + 2000) }, 'status.last': 'cancelled',
              'status.reasonToFinish': { $nin: [null, ''] } },
            { projection: { 'status.reasonToFinish': 1 }, batchSize: 5000 });
        for await (const sdoc of cs) {
            const motivo = String(dig(sdoc, 'status', 'reasonToFinish'));
            for (const cellKey of sid2cells.get(String(sdoc._id)) ?? []) {
                const c = cells.get(cellKey)!;
                c.motivos.set(motivo, (c.motivos.get(motivo) ?? 0) + 1);
            }
        }
    }

    // ── tag de broker sobre los contactos del rango ────────────────
    const todos = new Set<string>();
    for (const c of cells.values()) for (const u of c.unicos) todos.add(u);
    const bset = await brokerContacts(todos);

    const portales: CalidadPortal[] = [];
    for (const [name, k] of CANALES) {
        const rows: CalidadMes[] = mkeys.map((mk) => {
            const c = cells.get(ck(k, mk))!;
            let desc = 0, inc = 0, brk = 0, nor = 0, per = 0;
            for (const [motivo, n] of c.motivos) {
                desc += n;
                const fam = FAMILIA[motivo];
                if (fam === 'incontactable') inc += n;
                else if (fam === 'broker') brk += n;
                else if (fam === 'noResponde') nor += n;
                else per += n;
            }
            const u = c.unicos.size;
            const nb = [...c.unicos].filter((x) => bset.has(x)).length;
            return {
                mes: mk, leads: c.leads, descartados: desc,
                pctDescartado: p1(desc, c.leads),
                pctIncontactable: p1(inc, c.leads),
                pctBroker: p1(brk, c.leads),
                pctNoResponde: p1(nor, c.leads),
                pctPerdido: p1(per, c.leads),
                pctBrokerTag: p1(nb, u),
            };
        });
        if (!rows.some((r) => r.leads)) continue;
        portales.push({ canal: name, key: k, rows });
    }
    portales.sort((a, b) => b.rows.reduce((s, r) => s + r.leads, 0) - a.rows.reduce((s, r) => s + r.leads, 0));

    const cerrado = mkeys[mkeys.length - 2] ?? mkeys[mkeys.length - 1];
    const motivos = portales.map((p) => {
        const c = cells.get(ck(p.key, cerrado))!;
        const tot = [...c.motivos.values()].reduce((a, b) => a + b, 0) || 1;
        return {
            canal: p.canal,
            filas: [...c.motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([m, n]) => ({ motivo: RLBL[m] ?? m.replace(/_/g, ' '), n, pct: Math.round((100 * n) / tot) })),
        };
    });

    return { operacion: oper, meses, portales, motivos, mesCerrado: cerrado, generado: new Date(now).toISOString() };
}
