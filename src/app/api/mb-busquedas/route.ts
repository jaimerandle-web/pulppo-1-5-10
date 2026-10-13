// Búsquedas de NURA para /mb → Búsquedas.
//
//   GET /api/mb-busquedas?company=<id>
//
// Sólo NURA: la pestaña es suya (hand-over de Sofía). Expone nombre, teléfono y correo de los
// clientes, así que va detrás de `canAccessCompany` como el resto de /mb y cualquier otro id se rechaza.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { busquedasNura, NURA_ID } from '@/lib/nuraBusquedas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Los datos no cambian minuto a minuto: 1 h, como pide el hand-over.
const CACHE_MS = 60 * 60 * 1000;
let cache: { t: number; d: unknown } | null = null;

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    if (company !== NURA_ID) return NextResponse.json({ error: 'Sólo disponible para NURA' }, { status: 404 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    if (cache && Date.now() - cache.t < CACHE_MS && req.nextUrl.searchParams.get('refresh') !== '1')
        return NextResponse.json(cache.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const d = { busquedas: await busquedasNura(), generado: new Date().toISOString() };
        cache = { t: Date.now(), d };
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-busquedas]', e);
        return NextResponse.json({ error: 'no se pudieron leer las búsquedas' }, { status: 500 });
    }
}
