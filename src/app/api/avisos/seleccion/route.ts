// La respuesta de la inmobiliaria: qué avisos quiere destacar.
//
//   GET  /api/avisos/seleccion?inmo=NOMBRE  → lo guardado (o vacío)
//   POST /api/avisos/seleccion              → { inmo, ids[], nota? }
//
// Si no hay dónde persistir (Vercel sin Blob) el POST responde 503 y lo dice, en vez de
// aceptar la respuesta y perderla en el siguiente request.
import { leer, guardar, esEfimero, type Seleccion } from '@/lib/portales/seleccion';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const inmo = new URL(req.url).searchParams.get('inmo');
    const todo = await leer();
    return Response.json({
        seleccion: inmo ? (todo[inmo] ?? null) : todo,
        efimero: esEfimero(),
    });
}

export async function POST(req: Request) {
    if (esEfimero()) {
        return Response.json({
            error: 'No hay dónde guardar: falta configurar Vercel Blob en el proyecto '
                 + '(Storage → Create → Blob). La respuesta se perdería.',
        }, { status: 503 });
    }
    try {
        const body = await req.json() as { inmo?: string; ids?: string[]; nota?: string };
        if (!body.inmo || !Array.isArray(body.ids)) {
            return Response.json({ error: 'Falta `inmo` o `ids`' }, { status: 400 });
        }
        // quién respondió sale de la cookie de identidad, no del cliente
        const cookie = req.headers.get('cookie') ?? '';
        const por = decodeURIComponent(
            /(?:^|;\s*)cm-user=([^;]+)/.exec(cookie)?.[1] ?? 'desconocido').trim();
        const sel: Seleccion = {
            ids: [...new Set(body.ids.map(String))],
            por, fecha: new Date().toISOString(), nota: body.nota,
        };
        await guardar(body.inmo, sel);
        return Response.json({ ok: true, seleccion: sel });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'No se pudo guardar';
        return Response.json({ error: msg }, { status: 500 });
    }
}
