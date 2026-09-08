import { BASES, cargarBase, contarBases } from '@/lib/centro/bases';
import type { BaseId } from '@/lib/centro/tipos';

// Bases del Centro de Marketing.
//   GET               → conteos de todas (para el menú)
//   GET ?id=<baseId>  → la base completa (hasta 500 filas + total real)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const id = new URL(req.url).searchParams.get('id')?.trim() as BaseId | undefined;
    try {
        if (!id) return Response.json({ bases: BASES, conteos: await contarBases() });
        if (!BASES.some((b) => b.id === id)) {
            return Response.json({ error: `Base desconocida: "${id}"` }, { status: 404 });
        }
        return Response.json(await cargarBase(id));
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error cargando la base' }, { status: 500 });
    }
}
