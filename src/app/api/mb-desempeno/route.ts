// Desempeño comercial por asesor de una inmobiliaria.
//
//   GET /api/mb-desempeno?company=<id>[&anio=2026]
//
// La barrera es `canAccessCompany`, que recalcula contra Mongo: la cookie `cm-company` sólo
// sirve para rutear. Sin esto una inmobiliaria podría leer los leads y cierres por asesor de
// otra cambiando el parámetro — que es exactamente el agujero que tenía `/api/avisos`.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { desempenoDe } from '@/lib/desempeno';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Se cachea por cuenta+año: la consulta recorre leads, visitas y operaciones del año entero y
// tarda segundos. 10 min es el mismo criterio que usa /api/data.
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

    const anio = Number(req.nextUrl.searchParams.get('anio')) || new Date().getFullYear();
    if (anio < 2020 || anio > 2100) {
        return NextResponse.json({ error: 'año fuera de rango' }, { status: 400 });
    }

    const clave = `${company}:${anio}`;
    const hit = cache.get(clave);
    const forzar = req.nextUrl.searchParams.get('refresh') === '1';
    if (hit && !forzar && Date.now() - hit.t < CACHE_MS) {
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    try {
        const d = await desempenoDe(company, anio);
        cache.set(clave, { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-desempeno]', e);
        return NextResponse.json({ error: 'no se pudo calcular el desempeño' }, { status: 500 });
    }
}
