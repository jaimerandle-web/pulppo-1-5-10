import { clustersDemanda, opcionesDemanda } from '@/lib/centro/bases';
import type { FiltroDemanda } from '@/lib/centro/tipos';

// Parrilla de demanda: estado × tipo × banda de presupuesto, en vivo.
// Mismo modelo de cluster que el proyecto de campañas por correo
// (zona_tipo_precio), pero sobre `searches` y sin CSV congelado.
//   GET ?operacion=sale|rent [&estado=&colonia=&tipo=]
//   GET ?opciones=1 → valores reales para los selectores
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const p = new URL(req.url).searchParams;
    const operacion = (p.get('operacion') as 'sale' | 'rent') || 'sale';
    try {
        if (p.get('opciones')) return Response.json(await opcionesDemanda(operacion));
        const f: FiltroDemanda = {
            operacion,
            estado: p.get('estado') || undefined,
            colonia: p.get('colonia') || undefined,
            tipo: p.get('tipo') || undefined
        };
        return Response.json({ ...(await clustersDemanda(f)), filtro: f });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error armando clusters' }, { status: 500 });
    }
}
