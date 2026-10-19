// Exclusivas de la inmobiliaria que alguien más está publicando (/mb → Resumen).
//
//   GET /api/mb-exclusivas?company=<id>
//
// Va aparte de /api/mb-metrics porque son varias consultas por exclusiva: la pantalla pinta y la sección
// aparece después, sólo si hay casos.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { exclusivasEnConflicto } from '@/lib/exclusivas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { t: number; d: unknown }>();

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    const hit = cache.get(company);
    if (hit && Date.now() - hit.t < CACHE_MS && req.nextUrl.searchParams.get('refresh') !== '1')
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const d = { exclusivas: await exclusivasEnConflicto(company), generado: new Date().toISOString() };
        cache.set(company, { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-exclusivas]', e);
        return NextResponse.json({ error: 'no se pudieron revisar las exclusivas' }, { status: 500 });
    }
}
