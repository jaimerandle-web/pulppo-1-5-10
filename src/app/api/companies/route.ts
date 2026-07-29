import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Lista de TODAS las inmobiliarias con inventario publicado (no solo las exclusivas 1·5·10).
// Es el universo sobre el que corre el análisis ampliado (gen_reporte_plus.py resuelve por nombre).
let cache: { names: string[]; ts: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

export async function GET() {
    if (cache && Date.now() - cache.ts < TTL_MS) {
        return Response.json({ companies: cache.names });
    }
    try {
        const db = await getDb();
        const names = (await db.collection('properties').distinct('company.name', { 'status.last': 'published' })) as string[];
        const list = names.filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
        cache = { names: list, ts: Date.now() };
        return Response.json({ companies: list });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error consultando Mongo';
        return Response.json({ error: msg }, { status: 500 });
    }
}
