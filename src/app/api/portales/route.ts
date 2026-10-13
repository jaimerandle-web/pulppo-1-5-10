import { NextResponse } from 'next/server';
import type { Operacion } from '@/lib/portales/metrics';
import { pulseView } from '@/lib/portales/pulse';
import { historicoView } from '@/lib/portales/historico';
import { inversionRango } from '@/lib/portales/inversion';
import { dealMes } from '@/lib/portales/deal';

export const dynamic = 'force-dynamic';

// Vistas propias de esta ruta: la semana, el histórico, la inversión del Sheet y el deal de MeLi. Las
// demás pestañas de /portales salen de /api/portales/inmobiliarias (un solo cálculo). Las vistas viejas
// (costo, periodo, calidad) se borraron en oct-2026: ya ninguna pantalla las usaba.
// ⚠️ Tiempos medidos (10-sep-2026), en caliente: pulso 9 s · histórico 3 s.
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

const VISTAS = ['pulso', 'historico', 'inversion', 'deal'] as const;
type Vista = (typeof VISTAS)[number];
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const vista = (u.searchParams.get('view') ?? 'pulso') as Vista;
    if (!VISTAS.includes(vista)) {
        return NextResponse.json({ error: `vista inválida: ${vista}` }, { status: 400 });
    }
    const desde = u.searchParams.get('desde') ?? '';
    const hasta = u.searchParams.get('hasta') ?? '';
    const opParam = u.searchParams.get('operacion') ?? 'todas';
    const operacion = (['todas', 'sale', 'rent'].includes(opParam) ? opParam : 'todas') as Operacion;

    if ((vista === 'inversion' && (!MES.test(desde) || !MES.test(hasta) || desde > hasta)) || (vista === 'deal' && !MES.test(desde))) {
        return NextResponse.json({ error: 'la inversión va en meses completos (YYYY-MM)' }, { status: 400 });
    }

    const key = `${vista}|${desde}|${hasta}|${operacion}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1') {
        return NextResponse.json({ ...(hit.data as object), cacheAt: hit.at });
    }
    try {
        const data = vista === 'pulso' ? await pulseView({ operacion })
            : vista === 'historico' ? await historicoView({ operacion })
            : vista === 'deal' ? await dealMes(desde)
            : await (async () => {
                const ms: string[] = [];
                let [y, m] = desde.split('-').map(Number);
                const [y1, m1] = hasta.split('-').map(Number);
                while ((y < y1 || (y === y1 && m <= m1)) && ms.length < 24) { ms.push(`${y}-${String(m).padStart(2, '0')}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1]; }
                return inversionRango(ms);
            })();
        const at = Date.now();
        if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at, data });
        return NextResponse.json({ ...data, cacheAt: at });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
