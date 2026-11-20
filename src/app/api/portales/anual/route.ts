import { NextResponse } from 'next/server';
import { inventarioMeses, mesCubo, ultimosMeses } from '@/lib/portales/anual';
import { publicacionView } from '@/lib/portales/publicacion';

// La vista nueva de /portales (nov-2026): el año mes a mes y la foto de publicación. Sólo equipo Pulppo (el
// middleware no deja pasar a un master broker a /api/portales).
//
//   ?view=meses                 → la lista de meses que pinta la vista (13: el actual y los 12 anteriores)
//   ?view=mes&mes=YYYY-MM       → el cubo de ese mes (canal × inmobiliaria × operación + cierres)
//   ?view=inventario            → propiedades publicadas por inmobiliaria en cada uno de esos meses
//   ?view=publicacion           → cupo · publicados · con lead, por inmobiliaria × portal × nivel (hoy)
//   …&refresh=1                 → recalcula sin caché
//
// El navegador pide los 13 meses EN PARALELO: cada uno cabe solo en el maxDuration, y los cerrados viven 12 h en
// la caché de datos (compartida entre instancias), así que normalmente sólo el mes en curso se calcula.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
    const u = new URL(req.url);
    const view = u.searchParams.get('view') ?? 'meses';
    const fresco = u.searchParams.get('refresh') === '1';
    try {
        if (view === 'meses') return NextResponse.json({ meses: ultimosMeses() });
        if (view === 'mes') {
            const mes = u.searchParams.get('mes') ?? '';
            if (!MES.test(mes) || !ultimosMeses(25).includes(mes)) return NextResponse.json({ error: 'mes inválido (YYYY-MM, últimos 2 años)' }, { status: 400 });
            return NextResponse.json(await mesCubo(mes, fresco));
        }
        if (view === 'inventario') return NextResponse.json(await inventarioMeses(ultimosMeses(), fresco));
        if (view === 'publicacion') return NextResponse.json(await publicacionView(fresco));
        return NextResponse.json({ error: `vista inválida: ${view}` }, { status: 400 });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
