// Cron mensual (vercel.json, día 1 a las 6 am MX): renueva la foto de asesores externos de cada inmobiliaria con Datos.
// No devuelve datos, sólo qué hizo. Con CRON_SECRET exige `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo);
// sin él, sólo acepta la llamada del cron de Vercel. Es idempotente: si la foto ya es de este mes no recalcula.
import { NextRequest, NextResponse } from 'next/server';
import { brokersRed } from '@/lib/brokersRed';
import { renovarSiToca } from '@/lib/datosFoto';
import { CON_DATOS } from '@/lib/datosPiloto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
    const secreto = process.env.CRON_SECRET;
    const ok = secreto
        ? req.headers.get('authorization') === `Bearer ${secreto}`
        : (req.headers.get('user-agent') || '').startsWith('vercel-cron');
    if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const hecho: Record<string, string> = {};
    for (const company of CON_DATOS) hecho[company] = await renovarSiToca(company, () => brokersRed(company));
    return NextResponse.json({ ok: true, hecho });
}
