// Marketing de la inmobiliaria (/mb → Marketing): asignación y desempeño de anuncios.
//
//   GET /api/mb-marketing?company=<id>
//
// 🔴 SÓLO equipo interno de Pulppo. El middleware deja pasar /api/mb-* a los master brokers (cada
// ruta valida su inmobiliaria), así que AQUÍ se exige `internal`: un master de la cuenta —o alguien con
// acceso concedido en masterExtra.ts, como Miriam Cojab o informacion.dh de Diamond House— recibe 403
// aunque pida su propia inmobiliaria. Se abrirá a la inmobiliaria cuando Ale lo decida
// (ver MARKETING_VISIBLE_PARA en src/lib/marketingAcceso.ts).
import { NextRequest, NextResponse } from 'next/server';
import { canAccessCompany, currentUser } from '@/lib/companyAccess';
import { marketingDe } from '@/lib/marketingDh';
import { MARKETING_EMPRESAS, puedeVerMarketing } from '@/lib/marketingAcceso';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // el scoring de avisos en frío (mercado + cuenta) puede tardar; luego queda en caché

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { t: number; d: unknown }>();

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company) || !MARKETING_EMPRESAS.has(company))
        return NextResponse.json({ error: 'No disponible para esta inmobiliaria' }, { status: 404 });
    const user = await currentUser();
    if (!puedeVerMarketing(user, company)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    // cuando se abra a la inmobiliaria, un externo sólo puede pedir la suya
    if (!user!.internal && !(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    const hit = cache.get(company + ':v6');
    if (hit && req.nextUrl.searchParams.get('refresh') !== '1' && Date.now() - hit.t < CACHE_MS)
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const d = await marketingDe(company);
        cache.set(company + ':v6', { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-marketing]', e);
        return NextResponse.json({ error: 'no se pudo calcular el reporte de marketing' }, { status: 500 });
    }
}
