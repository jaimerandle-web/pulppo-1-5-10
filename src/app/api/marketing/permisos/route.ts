import { cookies } from 'next/headers';
import { sinStore } from '@/lib/centro/respuestas';
import { esEfimero, fijarPermiso, permisos } from '@/lib/centro/store';
import type { PermisoEstado, TemaId, ViaId } from '@/lib/centro/tipos';

// Registro de permisos: qué asesor nos deja hablar con sus clientes, por tema.
//   GET             → todos los permisos fijados
//   POST {asesorId, tema, estado, via} → fija/actualiza uno
export const dynamic = 'force-dynamic';

const ESTADOS: PermisoEstado[] = ['sin-preguntar', 'pedido', 'si', 'no'];

export async function GET() {
    return Response.json({ permisos: await permisos(), efimero: esEfimero() });
}


export async function POST(req: Request) {
    try {
        const b = await req.json();
        const asesorId = String(b.asesorId || '').trim();
        const tema = String(b.tema || '').trim() as TemaId;
        const estado = String(b.estado || '').trim() as PermisoEstado;
        const via = (b.via ? String(b.via) : null) as ViaId | null;

        if (!asesorId || !tema) return Response.json({ error: 'Faltan asesorId o tema' }, { status: 400 });
        if (!ESTADOS.includes(estado)) return Response.json({ error: `Estado inválido: "${estado}"` }, { status: 400 });
        if (esEfimero()) return sinStore();

        // Quién lo fijó queda registrado: el permiso es una decisión con dueño.
        const por = (await cookies()).get('cm-user')?.value || 'interno';
        return Response.json({ permiso: await fijarPermiso(asesorId, tema, estado, via, por) });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error guardando el permiso' }, { status: 500 });
    }
}
