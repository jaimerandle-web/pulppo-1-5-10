import { cookies } from 'next/headers';
import { sinStore } from '@/lib/centro/respuestas';
import { esEfimero, fijarPermiso, fijarPermisos, permisos } from '@/lib/centro/store';
import type { Destinatario, TemaId, ViaId } from '@/lib/centro/tipos';

// Registro de permisos. La clave es la TERNA (asesor, tema, destinatario):
// un asesor puede dejarnos hablar con sus propietarios y no con sus clientes.
//   GET  → todos
//   POST {asesorId | asesorIds[], tema, destinatario | destinatarios[], via}
//        → fija uno o muchos de una (el pedido masivo de Ulises)
export const dynamic = 'force-dynamic';

const VIAS_VALIDAS: ViaId[] = ['sin-preguntar', 'pedido', 'pulppo', 'en-mi-nombre', 'no'];
const DESTINOS: Destinatario[] = ['propietario', 'cliente'];

export async function GET() {
    return Response.json({ permisos: await permisos(), efimero: esEfimero() });
}

export async function POST(req: Request) {
    try {
        const b = await req.json();
        const ids: string[] = (Array.isArray(b.asesorIds) ? b.asesorIds : [b.asesorId])
            .map((x: unknown) => String(x || '').trim()).filter(Boolean);
        const destinos: Destinatario[] = (Array.isArray(b.destinatarios) ? b.destinatarios : [b.destinatario])
            .map((x: unknown) => String(x || '').trim()) as Destinatario[];
        const tema = String(b.tema || '').trim() as TemaId;
        const via = String(b.via || '').trim() as ViaId;

        if (!ids.length || !tema) return Response.json({ error: 'Faltan asesor o tema' }, { status: 400 });
        if (!destinos.length || destinos.some((d) => !DESTINOS.includes(d))) {
            return Response.json({ error: 'Destinatario inválido (propietario | cliente)' }, { status: 400 });
        }
        if (!VIAS_VALIDAS.includes(via)) return Response.json({ error: `Vía inválida: "${via}"` }, { status: 400 });
        if (esEfimero()) return sinStore();

        // Quién lo fijó queda registrado: el permiso es una decisión con dueño.
        const por = (await cookies()).get('cm-user')?.value || 'interno';

        if (ids.length === 1 && destinos.length === 1) {
            return Response.json({ permiso: await fijarPermiso(ids[0], tema, destinos[0], via, por) });
        }
        return Response.json({ fijados: await fijarPermisos(ids, tema, destinos, via, por) });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error guardando el permiso' }, { status: 500 });
    }
}
