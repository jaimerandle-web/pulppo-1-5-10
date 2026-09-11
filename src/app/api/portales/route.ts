import { NextResponse } from 'next/server';
import { portalesView } from '@/lib/portales/view';
import { pulseView } from '@/lib/portales/pulse';
import { historicoView } from '@/lib/portales/historico';
import { periodoView } from '@/lib/portales/periodo';

export const dynamic = 'force-dynamic';

// ⚠️ Tiempos medidos (10-sep-2026), en caliente: costo 20 s · pulso 9 s · histórico 3 s.
// En FRÍO la primera consulta del proceso paga muchísimo más (se midió pulso en 228 s con el
// working set de Atlas fuera de RAM). Por eso el límite va explícito y generoso, y por eso la
// caché importa: quien entra después no vuelve a pagarlo.
export const maxDuration = 300;

// Cada vista y cada rango se cachean aparte: abrir la página cuesta UNA vista, no las cuatro.
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;
// Tope del mapa: con rangos libres las llaves son infinitas y sin esto la memoria del proceso
// crece sin freno. Se tira la más vieja.
const MAX = 40;

const VISTAS = ['costo', 'pulso', 'historico', 'periodo'] as const;
type Vista = (typeof VISTAS)[number];
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const vista = (u.searchParams.get('view') ?? 'costo') as Vista;
    if (!VISTAS.includes(vista)) {
        return NextResponse.json({ error: `vista inválida: ${vista}` }, { status: 400 });
    }
    const desde = u.searchParams.get('desde') ?? '';
    const hasta = u.searchParams.get('hasta') ?? '';
    const months = Math.min(Math.max(Number(u.searchParams.get('months') ?? 6), 1), 24);

    if (vista === 'costo' && (desde || hasta)) {
        if (!MES.test(desde) || !MES.test(hasta))
            return NextResponse.json({ error: 'el rango de costo va en meses completos (YYYY-MM)' }, { status: 400 });
        if (desde > hasta)
            return NextResponse.json({ error: 'el rango termina antes de empezar' }, { status: 400 });
    }
    if (vista === 'periodo' && (!FECHA.test(desde) || !FECHA.test(hasta))) {
        return NextResponse.json({ error: 'el periodo va en fechas YYYY-MM-DD' }, { status: 400 });
    }

    const key = `${vista}|${desde}|${hasta}|${months}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') {
        return NextResponse.json({ ...(hit.data as object), cacheAt: hit.at });
    }
    try {
        const data = vista === 'costo'
                ? await portalesView(desde && hasta ? { desde, hasta } : { months })
            : vista === 'pulso' ? await pulseView()
            : vista === 'historico' ? await historicoView()
            : await periodoView(desde, hasta);
        const at = Date.now();
        if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at, data });
        return NextResponse.json({ ...data, cacheAt: at });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
