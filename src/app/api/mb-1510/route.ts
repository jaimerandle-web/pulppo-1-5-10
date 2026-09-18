// Historial de una inmobiliaria en el programa 1·5·10.
//
//   GET /api/mb-1510?company=<id>
//
// La barrera es `canAccessCompany`, que recalcula contra Mongo: la cookie `cm-company` sólo
// sirve para rutear. Sin esto una inmobiliaria leería el historial de otra cambiando el
// parámetro — el mismo agujero que tenía `/api/avisos`.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { historialDe } from '@/lib/historial1510';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Son pocas propiedades por cuenta (5 a 26) pero el barrido de leads y visitas cuesta; se
// cachea con el mismo criterio que /api/mb-desempeno.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { t: number; d: unknown }>();

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) {
        return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    }
    if (!(await canAccessCompany(company))) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const hit = cache.get(company);
    const forzar = req.nextUrl.searchParams.get('refresh') === '1';
    if (hit && !forzar && Date.now() - hit.t < CACHE_MS) {
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    try {
        const d = await historialDe(company);
        cache.set(company, { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-1510]', e);
        return NextResponse.json({ error: 'no se pudo calcular el historial' }, { status: 500 });
    }
}
