import { BASES, cargarBase } from '@/lib/centro/bases';
import { contarBases } from '@/lib/centro/bases';
import { permisos, viaPermiso } from '@/lib/centro/store';
import { DESTINATARIOS, VIAS, type BaseId, type TemaId } from '@/lib/centro/tipos';

// Bases del Centro de Marketing.
//   GET                        → conteos de todas (para el menú)
//   GET ?id=<baseId>           → la base completa (hasta 500 filas + total real)
//   GET ?id=brokers&format=csv → la lista de llamadas, con permisos y contacto
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const csvCampo = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
    const url = new URL(req.url);
    const id = url.searchParams.get('id')?.trim() as BaseId | undefined;
    try {
        if (!id) return Response.json({ bases: BASES, conteos: await contarBases() });
        if (!BASES.some((b) => b.id === id)) {
            return Response.json({ error: `Base desconocida: "${id}"` }, { status: 404 });
        }
        const datos = await cargarBase(id);

        if (url.searchParams.get('format') === 'csv') {
            const tema = (url.searchParams.get('tema') || 'garantia-renta') as TemaId;
            const soloRentas = url.searchParams.get('soloRentas') !== '0';
            const ps = await permisos();
            const etiqueta = (v: string) => VIAS.find((x) => x.id === v)?.label ?? v;

            const filas = (id === 'brokers' && soloRentas)
                ? datos.personas.filter((p) => Number(p.extra.rentas) > 0)
                : datos.personas;

            const cols = ['Asesor', 'Inmobiliaria', 'Email', 'Teléfono',
                ...datos.columnas.map((c) => c.label),
                ...(id === 'brokers' ? DESTINATARIOS.map((d) => d.label) : [])];

            const cuerpo = filas.map((p) => [
                p.nombre, p.inmobiliaria, p.email, p.telefono,
                ...datos.columnas.map((c) => p.extra[c.key]),
                ...(id === 'brokers' ? DESTINATARIOS.map((d) => etiqueta(viaPermiso(ps, p.id, tema, d.id))) : [])
            ].map(csvCampo).join(','));

            // BOM para que Excel en Mac no rompa los acentos.
            const csv = '﻿' + [cols.join(','), ...cuerpo].join('\n');
            return new Response(csv, {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="centro_${id}_${tema}.csv"`
                }
            });
        }

        return Response.json(datos);
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error cargando la base' }, { status: 500 });
    }
}
