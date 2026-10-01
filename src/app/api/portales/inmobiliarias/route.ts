import { NextResponse } from 'next/server';
import { asesoresDe, inmobiliariaView, opcionesInmobiliarias, type Comparar } from '@/lib/portales/inmobiliaria';
import type { Operacion } from '@/lib/portales/view';

// Pestaña "Inmobiliarias" de /portales. Sólo equipo Pulppo: el middleware no deja pasar a un master
// broker a /api/portales (no está en su lista de APIs), así que no hace falta otra barrera aquí.
//
//   ?view=opciones                    → las 102 inmobiliarias en su orden + sus cuentas
//   ?view=asesores&inmo=NOMBRE        → asesores de esa inmobiliaria
//   ?view=datos&inmo=&asesor=&operacion=&desde=&hasta=&comparar=   → el análisis
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000;
const MAX = 60;
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const view = u.searchParams.get('view') ?? 'datos';
    try {
        if (view === 'opciones') {
            const ops = await opcionesInmobiliarias();
            return NextResponse.json({ inmobiliarias: ops.map(({ nombre, kam, tier, ids, nota }) => ({ nombre, kam, tier, cuentas: ids.length, nota })) });
        }
        if (view === 'asesores') {
            const inmo = u.searchParams.get('inmo') ?? '';
            return NextResponse.json({ asesores: inmo ? await asesoresDe(inmo) : [] });
        }
        const desde = u.searchParams.get('desde') ?? '', hasta = u.searchParams.get('hasta') ?? '';
        if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: 'el periodo va en fechas YYYY-MM-DD' }, { status: 400 });
        const opP = u.searchParams.get('operacion') ?? 'todas';
        const operacion = (['todas', 'sale', 'rent'].includes(opP) ? opP : 'todas') as Operacion;
        const cmpP = u.searchParams.get('comparar') ?? 'ninguno';
        const comparar = (['ninguno', 'anterior', 'anio'].includes(cmpP) ? cmpP : 'ninguno') as Comparar;
        const inmobiliaria = u.searchParams.get('inmo') || null;
        const asesorId = (inmobiliaria && u.searchParams.get('asesor')) || null;

        const key = [inmobiliaria, asesorId, operacion, desde, hasta, comparar].join('|');
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL && u.searchParams.get('refresh') !== '1')
            return NextResponse.json({ ...(hit.data as object), cacheAt: hit.at });
        const data = await inmobiliariaView({ inmobiliaria, asesorId, operacion, desde, hasta, comparar });
        const at = Date.now();
        if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at, data });
        return NextResponse.json({ ...data, cacheAt: at });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
