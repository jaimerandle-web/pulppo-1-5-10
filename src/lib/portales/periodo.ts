// Conteo de leads en un rango LIBRE de fechas (no de meses completos).
//
// Existe porque el scorecard mensual no puede: su inversión sale del Sheet por mes, así que
// con "del 3 al 19" no hay denominador y CPL/CPA/ROI serían inventados. Aquí NO se toca costo
// — sólo volumen, mezcla y atención, que sí se pueden cortar por día.
//
// Sirve para lo que Ale pidió: poder contestar en una junta "¿cuántos leads nos mandaste del
// 12 de agosto al 3 de septiembre?" sin tener que redondear al mes.
import { getDb } from '../data';
import { CANALES, MESES, NOT, classifySource, dig, isDate } from './metrics';

export interface FilaPeriodo {
    canal: string; key: string;
    leads: number; unicos: number;
    venta: number; renta: number;
    pctVenta: number | null;
    lt60: number | null; sinResponder: number | null;
    /** Leads por día del rango: comparable entre rangos de distinto largo. */
    porDia: number;
}
export interface PeriodoView {
    desde: string; hasta: string; dias: number; etiqueta: string;
    filas: FilaPeriodo[];
    total: { leads: number; unicos: number; porDia: number };
    /** Serie diaria del total, para ver la forma del periodo. */
    serie: Array<{ dia: string; n: number }>;
    generado: string;
}

const DIA = 86400000;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** `desde`/`hasta` en 'YYYY-MM-DD'. `hasta` es INCLUSIVO (el día completo). */
export async function periodoView(desde: string, hasta: string, now = Date.now()): Promise<PeriodoView> {
    const db = await getDb();
    const [y0, m0, d0] = desde.split('-').map(Number);
    const [y1, m1, d1] = hasta.split('-').map(Number);
    const A = new Date(Date.UTC(y0, m0 - 1, d0));
    const B = new Date(Date.UTC(y1, m1 - 1, d1) + DIA);   // inclusivo
    if (!(B > A)) throw new Error('el rango termina antes de empezar');
    const dias = Math.round((B.getTime() - A.getTime()) / DIA);
    if (dias > 400) throw new Error('rango máximo de 400 días');

    interface Acc {
        leads: number; venta: number; renta: number; baseLab: number; lt60: number; sin: number;
        unicos: Set<string>;
    }
    const acc = new Map<string, Acc>();
    const unicosGlobal = new Set<string>();
    const mk = (): Acc => ({ leads: 0, venta: 0, renta: 0, baseLab: 0, lt60: 0, sin: 0, unicos: new Set() });
    const serie = new Map<string, number>();
    for (let t = A.getTime(); t < B.getTime(); t += DIA)
        serie.set(new Date(t).toISOString().slice(0, 10), 0);

    const cur = db.collection('leads').find(
        { createdAt: { $gte: A, $lt: B }, ...NOT },
        { projection: { source: 1, createdAt: 1, answeredAt: 1, 'contact._id': 1, 'property.listing.operation': 1 },
          batchSize: 10000 });
    for await (const l of cur) {
        const ca = l.createdAt;
        if (!isDate(ca)) continue;
        const k = classifySource(l.source as string);
        const a = acc.get(k) ?? acc.set(k, mk()).get(k)!;
        a.leads += 1;
        const op = dig(l, 'property', 'listing', 'operation');
        if (op === 'sale') a.venta += 1; else if (op === 'rent') a.renta += 1;
        // Atención sólo en horario laboral de México (9:00–20:59), igual que en el resto.
        const h = new Date(ca.getTime() - 6 * 3600 * 1000).getUTCHours();
        if (h >= 9 && h <= 20) {
            a.baseLab += 1;
            const ans = l.answeredAt;
            if (!isDate(ans)) a.sin += 1;
            else if ((ans.getTime() - ca.getTime()) / 60000 < 60) a.lt60 += 1;
        }
        const cid = dig(l, 'contact', '_id');
        if (cid != null) { a.unicos.add(String(cid)); unicosGlobal.add(String(cid)); }
        const d = ca.toISOString().slice(0, 10);
        if (serie.has(d)) serie.set(d, serie.get(d)! + 1);
    }

    const filas: FilaPeriodo[] = [];
    for (const [name, k] of CANALES) {
        const a = acc.get(k);
        if (!a || !a.leads) continue;
        filas.push({
            canal: name, key: k, leads: a.leads, unicos: a.unicos.size,
            venta: a.venta, renta: a.renta,
            pctVenta: a.leads ? r1((100 * a.venta) / a.leads) : null,
            lt60: a.baseLab ? r1((100 * a.lt60) / a.baseLab) : null,
            sinResponder: a.baseLab ? r1((100 * a.sin) / a.baseLab) : null,
            porDia: r1(a.leads / dias),
        });
    }
    filas.sort((x, z) => z.leads - x.leads);
    const leads = filas.reduce((s, f) => s + f.leads, 0);
    // Único de verdad, no la suma de los únicos por canal: un contacto que llegó por i24 y por
    // MeLi es UNA persona, y sumando las columnas se contaría dos veces.
    const unicos = unicosGlobal.size;

    const fmt = (d: Date) => `${d.getUTCDate()} ${MESES[d.getUTCMonth() + 1]}`;
    return {
        desde, hasta, dias,
        etiqueta: `${fmt(A)} – ${fmt(new Date(B.getTime() - DIA))} (${dias} días)`,
        filas, total: { leads, unicos, porDia: r1(leads / dias) },
        serie: [...serie.entries()].map(([dia, n]) => ({ dia, n })),
        generado: new Date(now).toISOString(),
    };
}
