// Histórico: tendencia mensual de leads + año contra año y YTD de cierres por fuente.
//
// Aquí sí mandan los indicadores REZAGADOS (cierres y regalía): a 12 meses el ciclo de venta
// ya maduró, así que la comparación contra el año pasado significa algo. Lo contrario de
// «La semana», donde un cierre no dice nada.
//
// Usa el MISMO cálculo que el resto de /portales (oct-2026): los leads se clasifican con
// `canalDeLead` (NURA aparte) y los cierres salen de `cierresEntre`, con la fuente `other`
// atribuida (broker externo, red Pulppo, primer lead, cartera). Antes tenía su propio cálculo
// de cierres que dejaba ~40% en «otros» y no cuadraba con «Funnel y cierres».
import { getDb } from '../data';
import { MESES, NOT, hoyMx, isDate, mesKey, monthWindow, pct, utc } from './metrics';
import { CANALES_TODOS, canalDeLead, cierresEntre, type Cierre } from './inmobiliaria';

export interface FilaYtd {
    canal: string;
    cierresYtd: number; cierresYtdPrev: number;
    regaliaYtd: number; regaliaYtdPrev: number; varRegaliaYtd: number | null;
    cierresMes: number; cierresMesPrev: number;
    regaliaMes: number; regaliaMesPrev: number; varRegaliaMes: number | null;
    ticketYtd: number;
}
export interface HistoricoView {
    operacion: 'todas' | 'sale' | 'rent';
    mlabels: string[];
    leadTrend: Record<string, number[]>;
    ytdRows: FilaYtd[];
    mesCerrado: string; anio: number; anioPrev: number; ytdHasta: string;
    generado: string;
}

type Agg = { n: number; regalia: number; valor: number };
const porFuente = (xs: Cierre[]) => {
    const m = new Map<string, Agg>();
    for (const c of xs) {
        const r = m.get(c.fuente) ?? m.set(c.fuente, { n: 0, regalia: 0, valor: 0 }).get(c.fuente)!;
        r.n += 1; r.regalia += c.regalia; r.valor += c.valor;
    }
    return m;
};

export async function historicoView(opts: { months?: number; operacion?: 'todas' | 'sale' | 'rent' } = {}, now = Date.now()): Promise<HistoricoView> {
    const months = opts.months ?? 12;
    const oper = opts.operacion ?? 'todas';
    const db = await getDb();
    const h = hoyMx(now);

    const seq: Array<[number, number]> = [];
    let y = h.y, m = h.m;
    for (let i = 0; i < months; i++) { seq.push([y, m]); [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1]; }
    seq.reverse();
    const mkeys = seq.map(([yy, mm]) => `${yy}-${String(mm).padStart(2, '0')}`);
    const mlabels = seq.map(([yy, mm]) => `${MESES[mm]} '${String(yy).slice(2)}`);

    // Una sola pasada por todo el rango en vez de una consulta por mes.
    const idx = new Map(mkeys.map((k, i) => [k, i]));
    const trend = new Map<string, number[]>();
    const desde = monthWindow(seq[0][0], seq[0][1])[0];
    const hasta = new Date(utc(h.y, h.m, h.d).getTime() + 86400000);
    const cur = db.collection('leads').find(
        { createdAt: { $gte: desde, $lt: hasta }, ...NOT, ...(oper === 'todas' ? {} : { 'property.listing.operation': oper }) },
        { projection: { source: 1, createdAt: 1, 'company.name': 1 } });
    const tareaLeads = (async () => {
        for await (const l of cur) {
            const ca = l.createdAt;
            if (!isDate(ca)) continue;
            const i = idx.get(mesKey(ca));
            if (i === undefined) continue;
            const k = canalDeLead(l.source, (l.company as { name?: unknown } | undefined)?.name);
            const arr = trend.get(k) ?? trend.set(k, Array(months).fill(0)).get(k)!;
            arr[i] += 1;
        }
    })();

    // Último mes CERRADO contra el mismo mes del año pasado; YTD (1-ene → ayer) contra el mismo tramo.
    const [ly, lm] = h.m === 1 ? [h.y - 1, 12] : [h.y, h.m - 1];
    const [aCur, bCur] = monthWindow(ly, lm);
    const [aPrev, bPrev] = monthWindow(ly - 1, lm);
    const red = { ids: null, operacion: oper };
    const [, mesCur, mesPrev, ytdCur, ytdPrev] = await Promise.all([
        tareaLeads,
        cierresEntre(aCur, bCur, red), cierresEntre(aPrev, bPrev, red),
        cierresEntre(utc(h.y, 1, 1), utc(h.y, h.m, h.d), red),
        cierresEntre(utc(h.y - 1, 1, 1), utc(h.y - 1, h.m, h.d), red),
    ]);

    const leadTrend: Record<string, number[]> = {};
    for (const [name, k] of CANALES_TODOS) {
        const v = trend.get(k);
        if (v && v.some((x) => x > 0)) leadTrend[name] = v;
    }
    const otros = trend.get('otros');
    if (otros && otros.some((x) => x > 0)) leadTrend['Otras fuentes'] = otros;

    const [yc, yp, mc, mp] = [ytdCur, ytdPrev, mesCur, mesPrev].map((r) => porFuente(r.out));
    const cero: Agg = { n: 0, regalia: 0, valor: 0 };
    const ytdRows: FilaYtd[] = [...new Set([...yc.keys(), ...yp.keys(), ...mc.keys()])].map((fuente) => {
        const c = yc.get(fuente) ?? cero, p = yp.get(fuente) ?? cero, cm = mc.get(fuente) ?? cero, pm = mp.get(fuente) ?? cero;
        return {
            canal: fuente,
            cierresYtd: c.n, cierresYtdPrev: p.n,
            regaliaYtd: Math.round(c.regalia), regaliaYtdPrev: Math.round(p.regalia), varRegaliaYtd: pct(c.regalia, p.regalia),
            cierresMes: cm.n, cierresMesPrev: pm.n,
            regaliaMes: Math.round(cm.regalia), regaliaMesPrev: Math.round(pm.regalia), varRegaliaMes: pct(cm.regalia, pm.regalia),
            ticketYtd: c.n ? Math.round(c.valor / c.n) : 0,
        };
    }).sort((a, b) => b.regaliaYtd - a.regaliaYtd);

    return {
        operacion: oper,
        mlabels, leadTrend, ytdRows,
        mesCerrado: `${MESES[lm]} '${String(ly).slice(2)}`,
        anio: h.y, anioPrev: h.y - 1,
        ytdHasta: `${h.d} ${MESES[h.m]}`,
        generado: new Date(now).toISOString(),
    };
}
