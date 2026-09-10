// Pulso semanal + últimos 30 días. Porteo de `pulse_data.compute_pulse` del dashboard local.
//
// Indicadores ADELANTADOS: leads, atención, visitas, calidad. Lo rezagado (cierres, regalía)
// no se mira semana a semana — el ciclo de venta va de 43 a 144 días, así que una semana no
// dice nada de un cierre. Eso vive en «Costo y retorno» y en el histórico.
import { getDb } from '../data';
import {
    CANALES, KEY2NAME, MESES, NOT, RB, RB_ORDER, VB, VB_ORDER, brokerContacts, bucket,
    classifySource, dig, hoyMx, isDate, lunesDe, oid, utc,
} from './metrics';

const DIA = 86400000;
/** Portales que se apilan en la gráfica de visitas; el resto cae en «otros». */
const STACK = ['i24', 'meli', 'easybroker'];

const RLBL: Record<string, string> = {
    descartado: 'Descartado (genérico)', asesor: 'Cliente era asesor/broker',
    fantasma: 'Fantasma / no contesta', perdido: 'Perdido', incontactable: 'Incontactable',
    inesperado: 'Inesperado', sent_to_ai: 'Enviado a IA', stop_answering: 'Dejó de responder',
    lost_interest: 'Perdió interés', operaton_with_other_broker: 'Cerró con otro broker',
};

export interface SerieCanal {
    canal: string; key: string; weeks: number[]; wtd: number;
    wow: number | null; mtd: number; pmtd: number; pace: number | null;
}
export interface RespSemana { tot: number; pctLt60: number; pctAns: number; pctSin: number }
export interface PulseView {
    generado: string; semanaRef: string; wlabels: string[]; p30Label: string;
    series: SerieCanal[];
    resp: RespSemana[];
    visitas: { segs: Array<{ key: string; name: string }>; weeks: Array<Record<string, number>>; total: number[] };
    ticket: { venta: Bloque; renta: Bloque; orderV: string[]; orderR: string[] };
    broker: {
        pctNow: number; pctPrev: number; delta: number; broker: number; cliente: number; total: number;
        porPortal: Array<{ canal: string; pctNow: number; pctPrev: number; delta: number; total: number }>;
    };
    descartes: {
        rows: Array<{ reason: string; now: number; pctNow: number; pctPrev: number; deltaPct: number;
                      portales: Array<{ canal: string; n: number; pct: number; delta: number }> }>;
        totalNow: number; comentarios: string[];
    };
    alerts: Array<{ sev: 'alta' | 'media'; txt: string }>;
}
type Bloque = Record<string, { now: number; prev: number; delta: number }>;

const r1 = (x: number) => Math.round(x * 10) / 10;
const p1 = (b: number, t: number) => (t ? r1((100 * b) / t) : 0);

export async function pulseView(nweeks = 8, now = Date.now()): Promise<PulseView> {
    const db = await getDb();
    const h = hoyMx(now);
    const hoy = utc(h.y, h.m, h.d);
    const mon = lunesDe(hoy);

    // 8 semanas cerradas que terminan en el lunes de esta semana + la semana en curso aparte.
    const wk: Array<[Date, Date]> = [];
    for (let i = nweeks; i > 0; i--)
        wk.push([new Date(mon.getTime() - i * 7 * DIA), new Date(mon.getTime() - (i - 1) * 7 * DIA)]);
    const wlabels = wk.map(([a]) => `${a.getUTCDate()}/${String(a.getUTCMonth() + 1).padStart(2, '0')}`);
    const wtdA = mon, wtdB = new Date(mon.getTime() + 7 * DIA);

    const mtd0 = utc(h.y, h.m, 1);
    const pmtd0 = h.m === 1 ? utc(h.y - 1, 12, 1) : utc(h.y, h.m - 1, 1);
    // Mismo día del mes pasado; si no existe (31 vs 30), el último día del mes anterior.
    const finPrev = new Date(mtd0.getTime() - DIA);
    const pmtdEnd = new Date(Math.min(
        utc(pmtd0.getUTCFullYear(), pmtd0.getUTCMonth() + 1, h.d).getTime(), finPrev.getTime()));

    const w30End = hoy, w30A = new Date(hoy.getTime() - 30 * DIA), w30B = new Date(hoy.getTime() - 60 * DIA);
    const inicio = new Date(Math.min(wk[0][0].getTime(), pmtd0.getTime(), hoy.getTime() - 61 * DIA));

    const weekly = new Map<string, number[]>();
    const wtdLeads = new Map<string, number>();
    const resp = Array.from({ length: nweeks }, () => ({ tot: 0, ans: 0, sin: 0, lt60: 0 }));
    const mtd = new Map<string, number>(), pmtd = new Map<string, number>();
    const price = { now: { venta: new Map<string, number>(), renta: new Map<string, number>() },
                    prev: { venta: new Map<string, number>(), renta: new Map<string, number>() } };
    const brkBy = { now: new Map<string, string[]>(), prev: new Map<string, string[]>() };
    const descSids = { now: [] as Array<[string, string]>, prev: [] as Array<[string, string]> };
    // Fuente del PRIMER lead de cada contacto: es lo que atribuye su visita a un portal.
    const cEarliest = new Map<string, { at: Date; canal: string }>();
    const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

    const cur = db.collection('leads').find(
        { createdAt: { $gte: inicio, $lt: wtdB }, ...NOT },
        { projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, search: 1,
                        'property.listing.operation': 1, 'property.listing.value': 1 } });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const canal = classifySource(l.source as string);
        const cid = dig(l, 'contact', '_id');
        const cs = cid == null ? null : String(cid);
        if (cs) {
            const pv = cEarliest.get(cs);
            if (!pv || ca < pv.at) cEarliest.set(cs, { at: ca, canal });
        }
        let colocado = false;
        for (let i = 0; i < nweeks; i++) {
            if (ca >= wk[i][0] && ca < wk[i][1]) {
                const arr = weekly.get(canal) ?? weekly.set(canal, Array(nweeks).fill(0)).get(canal)!;
                arr[i] += 1;
                colocado = true;
                // Atención sólo en horario laboral de México (9:00–20:59).
                const hh = new Date(ca.getTime() - 6 * 3600 * 1000).getUTCHours();
                if (hh >= 9 && hh <= 20) {
                    resp[i].tot += 1;
                    const ans = l.answeredAt;
                    if (!isDate(ans)) resp[i].sin += 1;
                    else {
                        resp[i].ans += 1;
                        if ((ans.getTime() - ca.getTime()) / 60000 < 60) resp[i].lt60 += 1;
                    }
                }
                break;
            }
        }
        if (!colocado && ca >= wtdA && ca < wtdB) inc(wtdLeads, canal);
        if (ca >= mtd0 && ca < new Date(hoy.getTime() + DIA)) inc(mtd, canal);
        if (ca >= pmtd0 && ca < new Date(pmtdEnd.getTime() + DIA)) inc(pmtd, canal);

        const win = ca >= w30A && ca < w30End ? 'now' : (ca >= w30B && ca < w30A ? 'prev' : null);
        if (win) {
            const op = dig(l, 'property', 'listing', 'operation');
            const v = dig(l, 'property', 'listing', 'value');
            if (op === 'sale') { const b = bucket(v, VB); if (b) inc(price[win].venta, b); }
            else if (op === 'rent') { const b = bucket(v, RB); if (b) inc(price[win].renta, b); }
            if (cs) (brkBy[win].get(canal) ?? brkBy[win].set(canal, []).get(canal)!).push(cs);
            // Se guarda (canal, search): sin el canal no se puede decir QUÉ portal está
            // detrás de cada motivo de descarte.
            if (op === 'sale' && l.search && canal !== 'otros') descSids[win].push([canal, String(l.search)]);
        }
    }

    // ── visitas por semana, apiladas por el portal del primer lead ──
    const visStack = Array.from({ length: nweeks }, () => new Map<string, number>());
    const cv = db.collection('visits').find(
        { startTime: { $gte: wk[0][0], $lt: wk[nweeks - 1][1] }, 'status.last': { $ne: 'cancelled' } },
        { projection: { startTime: 1, 'contact._id': 1 } });
    for await (const v of cv) {
        const st = v.startTime;
        if (!isDate(st)) continue;
        const cid = dig(v, 'contact', '_id');
        const src = cid == null ? undefined : cEarliest.get(String(cid));
        const k = src?.canal ?? 's/d';
        const seg = STACK.includes(k) ? k : (k === 's/d' ? 's/d' : 'otros');
        for (let i = 0; i < nweeks; i++)
            if (st >= wk[i][0] && st < wk[i][1]) { inc(visStack[i], seg); break; }
    }
    const segs = [...STACK, 'otros', 's/d'];
    const visitas = {
        segs: segs.map((k) => ({ key: k, name: KEY2NAME[k] ?? (k === 'otros' ? 'Otros' : 'Sin dato') })),
        weeks: visStack.map((m) => Object.fromEntries(segs.map((k) => [k, m.get(k) ?? 0]))),
        total: visStack.map((m) => [...m.values()].reduce((a, b) => a + b, 0)),
    };

    // ── broker vs cliente, 30d contra 30d ──────────────────────────
    const todos = new Set<string>();
    for (const w of ['now', 'prev'] as const) for (const arr of brkBy[w].values()) for (const c of arr) todos.add(c);
    const bset = await brokerContacts(todos);
    const cuenta = (ids: string[]) => [ids.filter((c) => bset.has(c)).length, ids.length] as const;
    const porPortal: PulseView['broker']['porPortal'] = [];
    for (const k of new Set([...brkBy.now.keys(), ...brkBy.prev.keys()])) {
        const [bn, tn] = cuenta(brkBy.now.get(k) ?? []);
        const [bp, tp] = cuenta(brkBy.prev.get(k) ?? []);
        // Menos de 50 leads en la ventana no dice nada: un caso mueve el porcentaje entero.
        if (tn < 50) continue;
        porPortal.push({ canal: KEY2NAME[k] ?? (k === 'otros' ? 'Otros' : k),
            pctNow: p1(bn, tn), pctPrev: p1(bp, tp), delta: r1(p1(bn, tn) - p1(bp, tp)), total: tn });
    }
    porPortal.sort((a, b) => b.pctNow - a.pctNow);
    const totNow = [...brkBy.now.values()].flat(), totPrev = [...brkBy.prev.values()].flat();
    const [bnA, tnA] = cuenta(totNow), [bpA, tpA] = cuenta(totPrev);
    const broker = { pctNow: p1(bnA, tnA), pctPrev: p1(bpA, tpA), delta: r1(p1(bnA, tnA) - p1(bpA, tpA)),
                     broker: bnA, cliente: tnA - bnA, total: tnA, porPortal };

    // ── composición de precio (share, no volumen) ──────────────────
    const shares = (m: Map<string, number>, order: string[]) => {
        const t = order.reduce((a, k) => a + (m.get(k) ?? 0), 0) || 1;
        return Object.fromEntries(order.map((k) => [k, Math.round(((m.get(k) ?? 0) / t) * 100)]));
    };
    const bloque = (op: 'venta' | 'renta', order: string[]): Bloque => {
        const sn = shares(price.now[op], order), sp = shares(price.prev[op], order);
        return Object.fromEntries(order.map((k) => [k, { now: sn[k], prev: sp[k], delta: sn[k] - sp[k] }]));
    };
    const ticket = { venta: bloque('venta', VB_ORDER), renta: bloque('renta', RB_ORDER),
                     orderV: VB_ORDER, orderR: RB_ORDER };

    // ── descartes: composición + quién está detrás ─────────────────
    // ⚠️ Multi-touch a propósito: si una búsqueda tuvo leads de 2 portales cuenta en los dos,
    // así que los % por portal de un motivo pueden pasar de 100. La pregunta es "qué portales
    // aparecen detrás de este motivo", no repartir culpa exacta.
    async function motivos(pairs: Array<[string, string]>, conComentarios = false) {
        const sid2can = new Map<string, Set<string>>();
        for (const [canal, sid] of pairs)
            (sid2can.get(sid) ?? sid2can.set(sid, new Set()).get(sid)!).add(canal);
        const ids = [...sid2can.keys()].map(oid).filter((o): o is NonNullable<typeof o> => !!o);
        const reasons = new Map<string, number>();
        const porCanal = new Map<string, Map<string, number>>();
        const comentarios: string[] = [];
        for (let i = 0; i < ids.length; i += 2000) {
            const cs = db.collection('searches').find(
                { _id: { $in: ids.slice(i, i + 2000) }, 'status.last': 'cancelled',
                  'status.reasonToFinish': { $nin: [null, ''] } },
                { projection: { 'status.reasonToFinish': 1, 'status.description': 1 } });
            for await (const s of cs) {
                const r = String(dig(s, 'status', 'reasonToFinish'));
                inc(reasons, r);
                const pc = porCanal.get(r) ?? porCanal.set(r, new Map()).get(r)!;
                for (const c of sid2can.get(String(s._id)) ?? []) inc(pc, c);
                if (conComentarios) {
                    const dd = String(dig(s, 'status', 'description') ?? '').trim();
                    if (dd.length > 3) comentarios.push(dd);
                }
            }
        }
        return { reasons, porCanal, comentarios };
    }
    const N = await motivos(descSids.now, true);
    const P = await motivos(descSids.prev);
    const tN = [...N.reasons.values()].reduce((a, b) => a + b, 0) || 1;
    const tP = [...P.reasons.values()].reduce((a, b) => a + b, 0) || 1;
    const rows = [...N.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => {
        const prevTot = [...(P.porCanal.get(r)?.values() ?? [])].reduce((a, b) => a + b, 0) || 1;
        const portales = [...(N.porCanal.get(r)?.entries() ?? [])]
            .sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([k, cn]) => {
                const p = Math.round((100 * cn) / (n || 1));
                const pp = Math.round((100 * (P.porCanal.get(r)?.get(k) ?? 0)) / prevTot);
                return { canal: KEY2NAME[k] ?? k, n: cn, pct: p, delta: p - pp };
            });
        return { reason: RLBL[r] ?? r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
                 now: n, pctNow: Math.round((100 * n) / tN),
                 pctPrev: Math.round((100 * (P.reasons.get(r) ?? 0)) / tP),
                 deltaPct: Math.round((100 * n) / tN) - Math.round((100 * (P.reasons.get(r) ?? 0)) / tP),
                 portales };
    });
    const vistos = new Set<string>(); const comm: string[] = [];
    for (const c of N.comentarios) {
        const k = c.slice(0, 60).toLowerCase();
        if (vistos.has(k)) continue;
        vistos.add(k); comm.push(c.slice(0, 140));
        if (comm.length >= 6) break;
    }

    // ── series por canal ───────────────────────────────────────────
    const series: SerieCanal[] = [];
    for (const [name, k] of CANALES) {
        const vals = weekly.get(k) ?? Array(nweeks).fill(0);
        if (vals.reduce((a, b) => a + b, 0) === 0 && !(wtdLeads.get(k) ?? 0)) continue;
        const lw = vals[nweeks - 1], pw = nweeks >= 2 ? vals[nweeks - 2] : 0;
        const m = mtd.get(k) ?? 0, pm = pmtd.get(k) ?? 0;
        series.push({ canal: name, key: k, weeks: vals, wtd: wtdLeads.get(k) ?? 0,
            wow: pw ? Math.round(((lw - pw) / pw) * 100) : null,
            mtd: m, pmtd: pm, pace: pm ? Math.round(((m - pm) / pm) * 100) : null });
    }
    series.sort((a, b) => b.weeks.reduce((x, y) => x + y, 0) - a.weeks.reduce((x, y) => x + y, 0));
    const respS: RespSemana[] = resp.map((r) => ({ tot: r.tot,
        pctLt60: p1(r.lt60, r.tot), pctAns: p1(r.ans, r.tot), pctSin: p1(r.sin, r.tot) }));

    // ── alertas ────────────────────────────────────────────────────
    const alerts: PulseView['alerts'] = [];
    for (const s of series) {
        if (s.wow !== null && s.wow <= -25 && s.weeks[nweeks - 1] >= 20)
            alerts.push({ sev: 'alta', txt: `${s.canal}: leads −${Math.abs(s.wow)}% vs semana previa (${s.weeks[nweeks - 2]}→${s.weeks[nweeks - 1]}).` });
        if (s.pace !== null && s.pace <= -20 && s.mtd >= 30)
            alerts.push({ sev: 'media', txt: `${s.canal}: ritmo del mes ${s.pace}% vs mes pasado a la fecha (${s.pmtd}→${s.mtd}).` });
    }
    const ult = respS[nweeks - 1], pen = respS[nweeks - 2];
    if (ult && ult.pctSin >= 5)
        alerts.push({ sev: 'alta', txt: `Sin responder ${ult.pctSin}% en la última semana (meta <5%).` });
    if (ult && pen && ult.pctLt60 < pen.pctLt60 - 5)
        alerts.push({ sev: 'media', txt: `Respuesta <1h cayó a ${ult.pctLt60}% (${pen.pctLt60}% la semana previa).` });
    for (const pp of porPortal)
        if (Math.abs(pp.delta) >= 8 && pp.total >= 100)
            alerts.push({ sev: 'media', txt: `${pp.canal}: broker ${pp.delta > 0 ? 'subió' : 'bajó'} a ${pp.pctNow}% de sus leads (${pp.delta > 0 ? '+' : ''}${pp.delta} pts vs 30d previos).` });

    const [lwA, lwB] = wk[nweeks - 1];
    const finSem = new Date(lwB.getTime() - DIA);
    return {
        generado: new Date(now).toISOString(),
        semanaRef: `${lwA.getUTCDate()}/${String(lwA.getUTCMonth() + 1).padStart(2, '0')}–${finSem.getUTCDate()}/${String(finSem.getUTCMonth() + 1).padStart(2, '0')}`,
        wlabels, p30Label: `últimos 30d (desde ${w30A.getUTCDate()} ${MESES[w30A.getUTCMonth() + 1]})`,
        series, resp: respS, visitas, ticket, broker,
        descartes: { rows, totalNow: [...N.reasons.values()].reduce((a, b) => a + b, 0), comentarios: comm },
        alerts,
    };
}
