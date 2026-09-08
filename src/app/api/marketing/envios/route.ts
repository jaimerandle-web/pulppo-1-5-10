import { sinStore } from '@/lib/centro/respuestas';
import { cambiarEstadoEnvio, envios, esEfimero, guardarEnvios } from '@/lib/centro/store';
import type { Envio } from '@/lib/centro/tipos';

// Envíos = la tabla que el calendario dibuja.
//   GET                       → todos
//   POST   {envios: Envio[]}  → programa (nada sale sin este paso explícito)
//   PATCH  {id, estado}       → marcar enviado / cancelar
//
// Ojo: programar NO manda nada todavía. El disparo real (WhatsApp) es la
// siguiente fase; hoy esto deja la agenda armada y auditable.
export const dynamic = 'force-dynamic';

export async function GET() {
    return Response.json({ envios: await envios(), efimero: esEfimero() });
}

export async function POST(req: Request) {
    try {
        const b = await req.json();
        const nuevos = (Array.isArray(b.envios) ? b.envios : []) as Envio[];
        if (!nuevos.length) return Response.json({ error: 'No mandaste envíos' }, { status: 400 });
        if (esEfimero()) return sinStore();

        // Malla de seguridad: aunque la UI ya filtró, nunca se persiste algo
        // bloqueado ni un id que ya existe.
        const existentes = new Set((await envios()).map((e) => e.id));
        const limpios = nuevos.filter((e) => e.estado === 'programado' && e.id && !existentes.has(e.id));
        const n = limpios.length ? await guardarEnvios(limpios) : 0;
        return Response.json({ programados: n, descartados: nuevos.length - n });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error programando' }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const { id, estado } = await req.json();
        if (!id || !estado) return Response.json({ error: 'Faltan id o estado' }, { status: 400 });
        if (esEfimero()) return sinStore();
        const ok = await cambiarEstadoEnvio(String(id), estado as Envio['estado']);
        return ok ? Response.json({ ok: true }) : Response.json({ error: 'No existe ese envío' }, { status: 404 });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error actualizando' }, { status: 500 });
    }
}
