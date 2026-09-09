import { NextResponse } from 'next/server';
import { portalesView } from '@/lib/portales/view';

export const dynamic = 'force-dynamic';

// ⚠️ El cálculo tarda ~17 s: recorre TODOS los leads de 6 meses y hace el join contra visitas
// y operaciones de cada contacto. El default de Vercel corta bastante antes, así que el límite
// va explícito. No bajarlo sin medir de nuevo.
export const maxDuration = 120;

// Caché en memoria con "actualizado hace X": esto es lo que hace que se sienta en vivo sin que
// cada persona que entra pague los 17 s. `refresh=1` la salta (el botón de recargar de la UI).
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const months = Math.min(Math.max(Number(u.searchParams.get('months') ?? 6), 1), 12);
    const key = `portales|${months}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') {
        return NextResponse.json({ ...(hit.data as object), cacheAt: hit.at });
    }
    try {
        const data = await portalesView(months);
        const at = Date.now();
        cache.set(key, { at, data });
        return NextResponse.json({ ...data, cacheAt: at });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
