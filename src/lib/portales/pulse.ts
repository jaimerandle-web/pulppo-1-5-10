// «La semana»: volumen por fuente, atención y alertas, semana a semana.
//
// Desde oct-2026 es corta a propósito: brokers, descartes y ticket se fueron a «Leads y calidad»,
// que los mide con cualquier periodo y con la taxonomía única de descarte.ts (aquí tenían su propia
// ventana de 30 días y sus propias etiquetas, y no cuadraban). Las fuentes se clasifican con
// `canalDeLead` (NURA aparte), igual que en el resto de /portales.
//
// Indicadores ADELANTADOS: leads, atención, visitas. Lo rezagado (cierres, regalía)
// no se mira semana a semana — el ciclo de venta va de 43 a 144 días, así que una semana no
// dice nada de un cierre. Eso vive en «Costo y retorno» y en el histórico.
import { getDb } from '../data';
import { KEY2NAME, NOT, dig, hoyMx, isDate, lunesDe, oid, utc } from './metrics';
import { CANALES_TODOS, I24_NURA, canalDeLead } from './inmobiliaria';

const DIA = 86400000;
/** Portales que se apilan en la gráfica de visitas; el resto cae en «otros». */
const STACK = ['i24', 'meli', 'easybroker'];

export interface SerieCanal {
    canal: string; key: string; weeks: number[]; wtd: number;
    wow: number | null; mtd: number; pmtd: number; pace: number | null;
}
export interface RespGrupo { tot: number; pctLt60: number; pctSin: number }
export interface RespSemana {
    tot: number; pctLt60: number; pctAns: number; pctSin: number;
    /** asesor con WhatsApp vinculado / sin vincular. Sin vincular, `answeredAt` queda vacío aunque
     *  el asesor sí conteste (lo hace por fuera): su «sin responder» es en buena parte artefacto. */
    vinc: RespGrupo; noVinc: RespGrupo;
    /** leads sin asesor asignado (no entran en ninguno de los dos grupos) */
    sinAsesor: number;
}
export interface PulseView {
    operacion: 'todas' | 'sale' | 'rent';
    generado: string; semanaRef: string; wlabels: string[];
    series: SerieCanal[];
    resp: RespSemana[];
    visitas: { segs: Array<{ key: string; name: string }>; weeks: Array<Record<string, number>>; total: number[] };
    alerts: Array<{ sev: 'alta' | 'media'; txt: string }>;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const p1 = (b: number, t: number) => (t ? r1((100 * b) / t) : 0);

export async function pulseView(opts: { operacion?: 'todas' | 'sale' | 'rent'; nweeks?: number } = {}, now = Date.now()): Promise<PulseView> {
    const nweeks = opts.nweeks ?? 8;
    const oper = opts.operacion ?? 'todas';
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

    const inicio = new Date(Math.min(wk[0][0].getTime(), pmtd0.getTime()));

    const weekly = new Map<string, number[]>();
    const wtdLeads = new Map<string, number>();
    const resp = Array.from({ length: nweeks }, () => ({ tot: 0, ans: 0, sin: 0, lt60: 0 }));
    // Para partir la atención por WhatsApp vinculado: (semana, asesor, sin responder, <1h).
    const respLeads: Array<{ i: number; aid: string | null; sin: boolean; lt60: boolean }> = [];
    const mtd = new Map<string, number>(), pmtd = new Map<string, number>();
    // Fuente del PRIMER lead de cada contacto: es lo que atribuye su visita a un portal.
    const cEarliest = new Map<string, { at: Date; canal: string }>();
    const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

    const cur = db.collection('leads').find(
        { createdAt: { $gte: inicio, $lt: wtdB }, ...NOT,
          ...(oper === 'todas' ? {} : { 'property.listing.operation': oper }) },
        { projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, 'agent._id': 1, 'company.name': 1 } });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const canal = canalDeLead(l.source, dig(l, 'company', 'name'));
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
                    const sinR = !isDate(ans);
                    const r60 = !sinR && (ans.getTime() - ca.getTime()) / 60000 < 60;
                    if (sinR) resp[i].sin += 1;
                    else { resp[i].ans += 1; if (r60) resp[i].lt60 += 1; }
                    const aid = dig(l, 'agent', '_id');
                    respLeads.push({ i, aid: aid != null ? String(aid) : null, sin: sinR, lt60: r60 });
                }
                break;
            }
        }
        if (!colocado && ca >= wtdA && ca < wtdB) inc(wtdLeads, canal);
        if (ca >= mtd0 && ca < new Date(hoy.getTime() + DIA)) inc(mtd, canal);
        if (ca >= pmtd0 && ca < new Date(pmtdEnd.getTime() + DIA)) inc(pmtd, canal);

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
        // Con un filtro de operación, sólo cuentan las visitas de personas con un lead de esa operación.
        if (oper !== 'todas' && !src) continue;
        const k = src?.canal ?? 's/d';
        const seg = STACK.includes(k) ? k : (k === 's/d' ? 's/d' : 'otros');
        for (let i = 0; i < nweeks; i++)
            if (st >= wk[i][0] && st < wk[i][1]) { inc(visStack[i], seg); break; }
    }
    const segs = [...STACK, 'otros', 's/d'];
    const visitas = {
        segs: segs.map((k) => ({ key: k, name: k === 'i24nura' ? I24_NURA : KEY2NAME[k] ?? (k === 'otros' ? 'Resto de fuentes' : 'Sin dato') })),
        weeks: visStack.map((m) => Object.fromEntries(segs.map((k) => [k, m.get(k) ?? 0]))),
        total: visStack.map((m) => [...m.values()].reduce((a, b) => a + b, 0)),
    };

    // ── series por canal ───────────────────────────────────────────
    const series: SerieCanal[] = [];
    for (const [name, k] of [...CANALES_TODOS, ['Otras fuentes', 'otros'] as [string, string]]) {
        const vals = weekly.get(k) ?? Array(nweeks).fill(0);
        if (vals.reduce((a, b) => a + b, 0) === 0 && !(wtdLeads.get(k) ?? 0)) continue;
        const lw = vals[nweeks - 1], pw = nweeks >= 2 ? vals[nweeks - 2] : 0;
        const m = mtd.get(k) ?? 0, pm = pmtd.get(k) ?? 0;
        series.push({ canal: name, key: k, weeks: vals, wtd: wtdLeads.get(k) ?? 0,
            wow: pw ? Math.round(((lw - pw) / pw) * 100) : null,
            mtd: m, pmtd: pm, pace: pm ? Math.round(((m - pm) / pm) * 100) : null });
    }
    series.sort((a, b) => b.weeks.reduce((x, y) => x + y, 0) - a.weeks.reduce((x, y) => x + y, 0));
    // WhatsApp vinculado de cada asesor (agents.whatsapp, booleano).
    const aids = [...new Set(respLeads.map((x) => x.aid).filter((x): x is string => !!x))]
        .map(oid).filter((o): o is NonNullable<typeof o> => !!o);
    const vinculado = new Map<string, boolean>();
    for (let i = 0; i < aids.length; i += 2000)
        for await (const a of db.collection('agents').find({ _id: { $in: aids.slice(i, i + 2000) } }, { projection: { whatsapp: 1 } }))
            vinculado.set(String(a._id), a.whatsapp === true);
    const grupo = () => ({ tot: 0, sin: 0, lt60: 0 });
    const porGrupo = Array.from({ length: nweeks }, () => ({ v: grupo(), n: grupo(), sa: 0 }));
    for (const x of respLeads) {
        const g = porGrupo[x.i];
        if (!x.aid) { g.sa += 1; continue; }
        const b = vinculado.get(x.aid) ? g.v : g.n;
        b.tot += 1; if (x.sin) b.sin += 1; if (x.lt60) b.lt60 += 1;
    }
    const fin = (b: { tot: number; sin: number; lt60: number }): RespGrupo => ({ tot: b.tot, pctLt60: p1(b.lt60, b.tot), pctSin: p1(b.sin, b.tot) });
    const respS: RespSemana[] = resp.map((r, i) => ({ tot: r.tot,
        pctLt60: p1(r.lt60, r.tot), pctAns: p1(r.ans, r.tot), pctSin: p1(r.sin, r.tot),
        vinc: fin(porGrupo[i].v), noVinc: fin(porGrupo[i].n), sinAsesor: porGrupo[i].sa }));

    // ── alertas ────────────────────────────────────────────────────
    const alerts: PulseView['alerts'] = [];
    for (const s of series) {
        if (s.wow !== null && s.wow <= -25 && s.weeks[nweeks - 1] >= 20)
            alerts.push({ sev: 'alta', txt: `${s.canal}: leads −${Math.abs(s.wow)}% vs semana previa (${s.weeks[nweeks - 2]}→${s.weeks[nweeks - 1]}).` });
        // Picos también: «entraron el doble de MeLi» es tan importante como una caída (¿hay quién los conteste?).
        if (s.wow !== null && s.wow >= 50 && s.weeks[nweeks - 1] >= 100) {
            const prev4 = s.weeks.slice(-5, -1), base = prev4.reduce((x, y) => x + y, 0) / (prev4.length || 1);
            alerts.push({ sev: 'media', txt: `${s.canal}: leads +${s.wow}% vs semana previa (${s.weeks[nweeks - 2]}→${s.weeks[nweeks - 1]}; promedio de las 4 anteriores ${Math.round(base)}). Revisa que se estén contestando.` });
        }
        if (s.pace !== null && s.pace <= -20 && s.mtd >= 30)
            alerts.push({ sev: 'media', txt: `${s.canal}: el mes va ${s.pace}% contra el mes pasado al mismo día (${s.pmtd}→${s.mtd}).` });
    }
    const ult = respS[nweeks - 1], pen = respS[nweeks - 2];
    if (ult && ult.pctSin >= 5)
        alerts.push({ sev: 'alta', txt: `Sin responder ${ult.pctSin}% en la última semana (meta <5%) — asesores con WhatsApp vinculado ${ult.vinc.pctSin}%, sin vincular ${ult.noVinc.pctSin}%.` });
    if (ult && pen && ult.pctLt60 < pen.pctLt60 - 5)
        alerts.push({ sev: 'media', txt: `Respuesta <1h cayó a ${ult.pctLt60}% (${pen.pctLt60}% la semana previa).` });
    const [lwA, lwB] = wk[nweeks - 1];
    const finSem = new Date(lwB.getTime() - DIA);
    return {
        operacion: oper,
        generado: new Date(now).toISOString(),
        semanaRef: `${lwA.getUTCDate()}/${String(lwA.getUTCMonth() + 1).padStart(2, '0')}–${finSem.getUTCDate()}/${String(finSem.getUTCMonth() + 1).padStart(2, '0')}`,
        wlabels, series, resp: respS, visitas, alerts,
    };
}
