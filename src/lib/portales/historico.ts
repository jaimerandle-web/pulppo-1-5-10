// Histórico: tendencia mensual de leads + año contra año y YTD por canal.
// Porteo de `dash_data.historico_view`.
//
// Aquí sí mandan los indicadores REZAGADOS (cierres y regalía): a 12 meses el ciclo de venta
// ya maduró, así que la comparación contra el año pasado significa algo. Lo contrario del
// pulso, donde un cierre no dice nada.
import { getDb } from '../data';
import { CANALES, MESES, NOT, cierresPorCanal, classifySource, hoyMx, isDate, mesKey, monthWindow, pct, utc } from './metrics';

export interface FilaYtd {
    canal: string;
    cierresYtd: number; cierresYtdPrev: number;
    regaliaYtd: number; regaliaYtdPrev: number; varRegaliaYtd: number | null;
    cierresMes: number; cierresMesPrev: number;
    regaliaMes: number; regaliaMesPrev: number; varRegaliaMes: number | null;
    ticketYtd: number;
}
export interface HistoricoView {
    mlabels: string[];
    leadTrend: Record<string, number[]>;
    ytdRows: FilaYtd[];
    mesCerrado: string; anio: number; anioPrev: number; ytdHasta: string;
    generado: string;
}

export async function historicoView(months = 12, now = Date.now()): Promise<HistoricoView> {
    const db = await getDb();
    const h = hoyMx(now);

    const seq: Array<[number, number]> = [];
    let y = h.y, m = h.m;
    for (let i = 0; i < months; i++) { seq.push([y, m]); [y, m] = m === 1 ? [y - 1, 12] : [y, m - 1]; }
    seq.reverse();
    const mkeys = seq.map(([yy, mm]) => `${yy}-${String(mm).padStart(2, '0')}`);
    const mlabels = seq.map(([yy, mm]) => `${MESES[mm]} '${String(yy).slice(2)}`);

    // Una sola pasada por todo el rango en vez de una consulta por mes: son ~12 meses de
    // leads y el original hacía 12 recorridos completos de la colección.
    const idx = new Map(mkeys.map((k, i) => [k, i]));
    const trend = new Map<string, number[]>();
    const desde = monthWindow(seq[0][0], seq[0][1])[0];
    const hasta = new Date(utc(h.y, h.m, h.d).getTime() + 86400000);
    const cur = db.collection('leads').find(
        { createdAt: { $gte: desde, $lt: hasta }, ...NOT }, { projection: { source: 1, createdAt: 1 } });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const i = idx.get(mesKey(ca));
        if (i === undefined) continue;
        const k = classifySource(l.source as string);
        const arr = trend.get(k) ?? trend.set(k, Array(months).fill(0)).get(k)!;
        arr[i] += 1;
    }
    const leadTrend: Record<string, number[]> = {};
    for (const [name, k] of CANALES) {
        const v = trend.get(k);
        if (v && v.some((x) => x > 0)) leadTrend[name] = v;
    }

    // Último mes CERRADO: el mes en curso no se compara contra nada.
    const [ly, lm] = h.m === 1 ? [h.y - 1, 12] : [h.y, h.m - 1];
    const [aCur, bCur] = monthWindow(ly, lm);
    const [aPrev, bPrev] = monthWindow(ly - 1, lm);
    const ccCur = await cierresPorCanal(aCur, bCur);
    const ccPrev = await cierresPorCanal(aPrev, bPrev);

    // YTD: 1-ene → hoy, contra el mismo tramo del año pasado.
    const ytdCur = await cierresPorCanal(utc(h.y, 1, 1), utc(h.y, h.m, h.d));
    const ytdPrev = await cierresPorCanal(utc(h.y - 1, 1, 1), utc(h.y - 1, h.m, h.d));

    const ytdRows: FilaYtd[] = [];
    for (const [name, k] of CANALES) {
        const c = ytdCur[k], p = ytdPrev[k], cm = ccCur[k], pm = ccPrev[k];
        if (!c || !p || !cm || !pm) continue;
        if (c.n === 0 && p.n === 0 && cm.n === 0) continue;
        ytdRows.push({
            canal: name,
            cierresYtd: c.n, cierresYtdPrev: p.n,
            regaliaYtd: c.regalia, regaliaYtdPrev: p.regalia, varRegaliaYtd: pct(c.regalia, p.regalia),
            cierresMes: cm.n, cierresMesPrev: pm.n,
            regaliaMes: cm.regalia, regaliaMesPrev: pm.regalia, varRegaliaMes: pct(cm.regalia, pm.regalia),
            ticketYtd: c.ticket,
        });
    }
    ytdRows.sort((a, b) => b.regaliaYtd - a.regaliaYtd);

    return {
        mlabels, leadTrend, ytdRows,
        mesCerrado: `${MESES[lm]} '${String(ly).slice(2)}`,
        anio: h.y, anioPrev: h.y - 1,
        ytdHasta: `${h.d} ${MESES[h.m]}`,
        generado: new Date(now).toISOString(),
    };
}
