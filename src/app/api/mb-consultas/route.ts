// Consultas a detalle (/mb → Consultas): leads del periodo y del periodo anterior, con datos de contacto.
//
//   GET /api/mb-consultas?company=<id>&desde=YYYY-MM-DD&hasta=YYYY-MM-DD   (fechas en hora de México, hasta inclusive)
//
// Barrera: canAccessCompany (la inmobiliaria sólo pide la suya). Sólo empresas con la pestaña (MARKETING_EMPRESAS).
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { consultasDe } from '@/lib/consultas';
import { MARKETING_EMPRESAS } from '@/lib/marketingAcceso';
import { inicioDiaMx } from '@/lib/mbComun';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MX = 6 * 3600 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { t: number; d: unknown }>();
const fecha = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Date.parse(`${s}T00:00:00Z`) + MX) : null);

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const company = (sp.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company) || !MARKETING_EMPRESAS.has(company)) return NextResponse.json({ error: 'No disponible para esta inmobiliaria' }, { status: 404 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    const ahora = Date.now();
    const hasta0 = fecha(sp.get('hasta'));
    // días de calendario (hora México): el periodo puede ir a medias (hoy hasta esta hora); el anterior es el
    // mismo tramo `dias` días antes, cortado a la misma hora (mbComun.periodoAnterior)
    const finDia = hasta0 ? hasta0.getTime() + 86400000 : inicioDiaMx(new Date(ahora), -1).getTime();
    const hasta = new Date(Math.min(finDia, ahora));
    const desde = fecha(sp.get('desde')) ?? inicioDiaMx(new Date(ahora), 29);
    const dias = Math.round((finDia - desde.getTime()) / 86400000);
    if (desde >= hasta || dias > 400) return NextResponse.json({ error: 'Periodo inválido (máximo 400 días)' }, { status: 400 });
    const key = `${company}|${desde.toISOString()}|${hasta0 ? hasta.toISOString() : 'hoy'}`;
    const hit = cache.get(key);
    if (hit && ahora - hit.t < CACHE_MS && sp.get('refresh') !== '1') return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const d = await consultasDe(company, desde, hasta, dias);
        cache.set(key, { t: ahora, d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-consultas]', e);
        return NextResponse.json({ error: 'no se pudieron calcular las consultas' }, { status: 500 });
    }
}
