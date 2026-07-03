import { fetchRows, fetchProgram } from '@/lib/data';
import type { DataPayload } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cache en memoria 10 min (mismo TTL que el Streamlit original). En Vercel es por instancia,
// suficiente para evitar golpear Mongo en cada navegación. ?refresh=1 fuerza el pull.
let cache: { data: DataPayload; ts: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function GET(req: Request) {
    const force = new URL(req.url).searchParams.get('refresh') === '1';
    if (!force && cache && Date.now() - cache.ts < TTL_MS) {
        return Response.json(cache.data);
    }
    try {
        const [rows, program] = await Promise.all([fetchRows(), fetchProgram()]);
        const data: DataPayload = { rows, program, fetchedAt: new Date().toISOString() };
        cache = { data, ts: Date.now() };
        return Response.json(data);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error consultando Mongo';
        return Response.json({ error: msg }, { status: 500 });
    }
}
