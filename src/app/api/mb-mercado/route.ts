// Mercado: cierres reales de la red, anonimizados.
//
//   GET /api/mb-mercado?company=<id>
//
// Los datos son los mismos para todas las cuentas, pero la pestaña es un PILOTO
// (`lib/mercadoPiloto.ts`): además de `canAccessCompany` se valida que esa inmobiliaria la tenga
// prendida, para que esconder el botón no sea la única barrera.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { mercado, type Mercado } from '@/lib/mercado';
import { tieneMercado } from '@/lib/mercadoPiloto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Una sola entrada para toda la red: los cierres cambian pocas veces al día.
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache: { t: number; d: Mercado } | null = null;

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) {
        return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    }
    if (!tieneMercado(company) || !(await canAccessCompany(company))) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const forzar = req.nextUrl.searchParams.get('refresh') === '1';
    if (cache && !forzar && Date.now() - cache.t < CACHE_MS) {
        return NextResponse.json(cache.d, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    try {
        const d = await mercado();
        cache = { t: Date.now(), d };
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-mercado]', e);
        return NextResponse.json({ error: 'no se pudo calcular el mercado' }, { status: 500 });
    }
}
