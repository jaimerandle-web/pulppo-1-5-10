// Desempeño comercial de una inmobiliaria (/mb → Desempeño).
//
//   GET /api/mb-desempeno?company=<id>&desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&asesor=<agentId>]
//
// La barrera es `canAccessCompany`, que recalcula contra Mongo: la cookie `cm-company` sólo
// sirve para rutear. Sin esto una inmobiliaria podría leer los leads y cierres por asesor de
// otra cambiando el parámetro — que es exactamente el agujero que tenía `/api/avisos`.
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany } from '@/lib/companyAccess';
import { desempenoMb } from '@/lib/desempenoMb';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 10 min por cuenta+periodo+asesor: recorre leads, visitas, búsquedas y operaciones.
const CACHE_MS = 10 * 60 * 1000;
const MAX = 60;
const cache = new Map<string, { t: number; d: unknown }>();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-f0-9]{24}$/i;

export async function GET(req: NextRequest) {
    const p = req.nextUrl.searchParams;
    const company = (p.get('company') || '').trim();
    if (!ID.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const desde = p.get('desde') || '', hasta = p.get('hasta') || '';
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta)
        return NextResponse.json({ error: 'periodo inválido (YYYY-MM-DD)' }, { status: 400 });
    if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 400)
        return NextResponse.json({ error: 'periodo máximo de 400 días' }, { status: 400 });
    const asesor = p.get('asesor') || '';
    if (asesor && !ID.test(asesor)) return NextResponse.json({ error: 'asesor inválido' }, { status: 400 });

    const clave = `${company}|${desde}|${hasta}|${asesor}`;
    const hit = cache.get(clave);
    if (hit && p.get('refresh') !== '1' && Date.now() - hit.t < CACHE_MS)
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const d = await desempenoMb(company, desde, hasta, asesor || null);
        if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
        cache.set(clave, { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-desempeno]', e);
        return NextResponse.json({ error: 'no se pudo calcular el desempeño' }, { status: 500 });
    }
}
