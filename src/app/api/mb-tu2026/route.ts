// «Tu 2026»: cierre de año de la inmobiliaria.
//
//   GET /api/mb-tu2026?company=<id>&vista=anio|reconocimientos
//
// Barrera doble: `canAccessCompany` y el piloto (`lib/tu2026Piloto.ts`: hasta el 3-dic sólo internos).
// El cálculo barre tres años de toda la red (los pares lo necesitan): ~25 s en frío; lib/tu2026.ts lo
// cachea 12 h por año.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany, currentUser } from '@/lib/companyAccess';
import { reconocimientos, tuAnio } from '@/lib/tu2026';
import { verTu2026 } from '@/lib/tu2026Piloto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    const vista = req.nextUrl.searchParams.get('vista') === 'reconocimientos' ? 'reconocimientos' : 'anio';
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    const u = await currentUser();
    if (!verTu2026(company, !!u?.internal) || !(await canAccessCompany(company))) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    try {
        const d = vista === 'anio' ? await tuAnio(company) : await reconocimientos(company);
        if (!d) return NextResponse.json({ error: 'Esta inmobiliaria no está en la lista de clientes' }, { status: 404 });
        // La comparación con los pares es SÓLO para el equipo Pulppo (preparar las 1:1): a la inmobiliaria no se le
        // muestra (spoiler de la gala y, para las grandes, no dice nada). Ale, 20-nov.
        if (vista === 'anio' && 'metricas' in d && !u?.internal) {
            d.pares = null;
            d.metricas = d.metricas.map((m) => ({ ...m, pares: null, pctl: null }));
        }
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-tu2026]', e);
        return NextResponse.json({ error: 'No se pudo calcular' }, { status: 500 });
    }
}
