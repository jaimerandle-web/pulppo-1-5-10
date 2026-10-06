import { NextResponse } from 'next/server';
import { agentMaps } from '@/lib/plus';
import { asesoresDeBaja, nuevosDelAño } from '@/lib/premios';
import { esEfimero, leer, marcar, type Campo } from '@/lib/plusSeguimiento';
import { currentUser } from '@/lib/companyAccess';

export const dynamic = 'force-dynamic';

// Nuevos élite / profesionales del año + su seguimiento (contactado, pin entregado).
// Sólo recorre `agents` (≈2 s): no espera el cálculo pesado de los premios.
export async function GET(req: Request) {
    const year = Number(new URL(req.url).searchParams.get('year') ?? new Date().getFullYear());
    if (!(year >= 2023 && year <= 2100)) return NextResponse.json({ error: 'año inválido' }, { status: 400 });
    try {
        const [am, seguimiento, bajas] = await Promise.all([agentMaps(), leer(), asesoresDeBaja()]);
        return NextResponse.json({
            year, efimero: esEfimero(), seguimiento,
            // sin asesores dados de baja ni de inmobiliarias de baja: no hay a quién entregarle pin
            elite: nuevosDelAño(am, year, 'elite', bajas), professional: nuevosDelAño(am, year, 'professional', bajas),
        });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const u = await currentUser();
    if (!u?.internal) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const b = await req.json().catch(() => null) as { clave?: string; campo?: Campo; valor?: boolean } | null;
    if (!b?.clave || !/^\d{4}:(elite|professional):[^:\s]+@[^:\s]+$/.test(b.clave) || !['contactado', 'pin'].includes(b.campo ?? '')) {
        return NextResponse.json({ error: 'petición inválida' }, { status: 400 });
    }
    try {
        const seguimiento = await marcar(b.clave, b.campo!, !!b.valor, u.email);
        return NextResponse.json({ seguimiento });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
    }
}
