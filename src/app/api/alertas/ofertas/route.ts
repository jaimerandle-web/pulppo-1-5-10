import { NextRequest } from 'next/server';
import { fetchAlertasOfertas } from '@/lib/alertasOfertas';

// Feed de alertas de ofertas 1·5·10 que consume el Apps Script del Sheet de Control (ver
// lib/alertasOfertas.ts). Va FUERA del middleware de login (matcher) porque lo llama un script,
// no una persona: se protege con `ALERTAS_TOKEN` en el header Authorization: Bearer <token>.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const token = process.env.ALERTAS_TOKEN;
    if (!token) return Response.json({ error: 'Falta ALERTAS_TOKEN en el servidor' }, { status: 500 });
    if (req.headers.get('authorization') !== `Bearer ${token}`) {
        return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
    // ventana hacia atrás; amplia a propósito para que una corrida caída no pierda avisos (el log deduplica)
    const horas = Math.min(Math.max(Number(req.nextUrl.searchParams.get('horas')) || 72, 1), 24 * 30);
    try {
        const alertas = await fetchAlertasOfertas(horas);
        return Response.json({ horas, alertas });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error consultando Mongo';
        return Response.json({ error: msg }, { status: 500 });
    }
}
