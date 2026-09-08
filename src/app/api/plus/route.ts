import { NextResponse } from 'next/server';
import { fetchPlus, type Metric } from '@/lib/plus';

export const dynamic = 'force-dynamic';

// Cache en memoria: el cálculo recorre todas las operations con pagos, así que repetir el
// mismo (mes, métrica) en la misma sesión no debe volver a pegarle a Mongo.
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const year = Number(u.searchParams.get('year') ?? new Date().getFullYear());
    const month = Number(u.searchParams.get('month') ?? new Date().getMonth() + 1);
    const metric = (u.searchParams.get('metric') ?? 'cobrada') as Metric;
    if (!(month >= 1 && month <= 12) || !['cobrada', 'total'].includes(metric)) {
        return NextResponse.json({ error: 'mes o métrica inválidos' }, { status: 400 });
    }
    const key = `${year}|${month}|${metric}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') {
        return NextResponse.json(hit.data);
    }
    try {
        const data = await fetchPlus(year, month, metric);
        cache.set(key, { at: Date.now(), data });
        return NextResponse.json(data);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
