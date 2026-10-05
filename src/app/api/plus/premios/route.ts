import { NextResponse } from 'next/server';
import { fetchPremios } from '@/lib/premios';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Barre operaciones con pagos + leads + visitas del año: ~35 s en frío. Cache 1 h por año.
const cache = new Map<number, { at: number; data: unknown }>();
const TTL = 60 * 60 * 1000;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const year = Number(u.searchParams.get('year') ?? new Date().getFullYear());
    if (!(year >= 2023 && year <= 2100)) return NextResponse.json({ error: 'año inválido' }, { status: 400 });
    const hit = cache.get(year);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') return NextResponse.json(hit.data);
    try {
        const data = await fetchPremios(year);
        cache.set(year, { at: Date.now(), data });
        return NextResponse.json(data);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
