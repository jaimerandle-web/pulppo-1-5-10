import { NextResponse } from 'next/server';
import { asignacionView } from '@/lib/portales/asignacion';
import { esEfimero, guardarBorrador, leerBorrador, type Borrador } from '@/lib/portales/asignacionStore';
import { NIVELES } from '@/lib/portales/asignacion';

// /portales → Asignación (fase 3, nov-2026). Sólo equipo Pulppo (el middleware no deja pasar a externos a /api/portales).
//   GET               → datos (Sheet + Mongo) + el borrador compartido
//   GET ?refresh=1    → recalcula sin caché
//   POST {valores, notas, reglas} → guarda el borrador (último que guarda gana; queda quién y cuándo)
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
    const fresco = new URL(req.url).searchParams.get('refresh') === '1';
    try {
        const [datos, borrador] = await Promise.all([asignacionView(fresco), leerBorrador()]);
        return NextResponse.json({ ...datos, borrador, soloLectura: esEfimero() });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const b = (await req.json()) as Partial<Borrador>;
        const valores: Borrador['valores'] = {};
        for (const [inmo, v] of Object.entries(b.valores ?? {})) {
            const limpio: Record<string, number> = {};
            for (const k of NIVELES) { const n = Number((v as Record<string, unknown>)?.[k]); if (Number.isFinite(n) && n >= 0) limpio[k] = Math.round(n); }
            if (Object.keys(limpio).length) valores[inmo] = limpio;
        }
        const notas: Record<string, string> = {};
        for (const [inmo, t] of Object.entries(b.notas ?? {})) if (typeof t === 'string' && t.trim()) notas[inmo] = t.trim().slice(0, 500);
        const cookie = req.headers.get('cookie') ?? '';
        const por = decodeURIComponent(/(?:^|;\s*)cm-user=([^;]+)/.exec(cookie)?.[1] ?? 'desconocido').trim();
        const guardado = await guardarBorrador({ valores, notas, reglas: b.reglas ?? null, por, fecha: new Date().toISOString() });
        return NextResponse.json({ borrador: guardado });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
}
