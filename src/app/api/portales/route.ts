import { NextResponse } from 'next/server';
import { portalesView } from '@/lib/portales/view';
import { pulseView } from '@/lib/portales/pulse';
import { historicoView } from '@/lib/portales/historico';

export const dynamic = 'force-dynamic';

// ⚠️ Tiempos medidos (10-sep-2026), en caliente: costo 20 s · pulso 9 s · histórico 3 s.
// En FRÍO la primera consulta del proceso paga muchísimo más (se midió pulso en 228 s con el
// working set de Atlas fuera de RAM). Por eso el límite va explícito y generoso, y por eso la
// caché importa: quien entra después no vuelve a pagarlo.
export const maxDuration = 300;

// Cada vista se cachea aparte para que abrir la página cueste UNA vista, no las tres (32 s).
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;

const VISTAS = ['costo', 'pulso', 'historico'] as const;
type Vista = (typeof VISTAS)[number];

export async function GET(req: Request) {
    const u = new URL(req.url);
    const vista = (u.searchParams.get('view') ?? 'costo') as Vista;
    if (!VISTAS.includes(vista)) {
        return NextResponse.json({ error: `vista inválida: ${vista}` }, { status: 400 });
    }
    const months = Math.min(Math.max(Number(u.searchParams.get('months') ?? 6), 1), 12);
    const key = `${vista}|${months}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') {
        return NextResponse.json({ ...(hit.data as object), cacheAt: hit.at });
    }
    try {
        const data = vista === 'costo' ? await portalesView(months)
            : vista === 'pulso' ? await pulseView()
            : await historicoView();
        const at = Date.now();
        cache.set(key, { at, data });
        return NextResponse.json({ ...data, cacheAt: at });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
