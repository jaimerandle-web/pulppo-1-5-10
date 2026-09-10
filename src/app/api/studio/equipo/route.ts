// El equipo de una inmobiliaria, SÓLO para el interno que revisa Studio.
//
// Es el selector de "¿Quién eres?": el asesor nunca lo ve —entra directo a su perfil— y este
// endpoint lo rechaza si no está en la allowlist. Existe porque con el perfil en vivo el
// bundle ya no lleva a nadie adentro, y sin esto se perdía la forma de revisar el Studio de
// cualquier asesora.
//
// Devuelve nombre, correo y foto: lo mínimo para pintar la lista. NADA de celular ni
// operaciones — justo lo que el archivo estático filtraba.
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/companyAccess';
import { getDb } from '@/lib/data';

const FILTRO_ACTIVOS = {
    type: { $in: ['associate', 'master'] },
    status: 'active',
    deletedAt: null
};

export async function GET(req: NextRequest) {
    const u = await currentUser();
    if (!u) return NextResponse.json({ error: 'sin sesión' }, { status: 401 });
    // la lista de un equipo completo no es de un asesor: sólo interno
    if (!u.internal) return NextResponse.json({ error: 'no autorizado' }, { status: 403 });

    const inmo = (req.nextUrl.searchParams.get('inmobiliaria') || 'DIAMOND HOUSE').trim();
    const db = await getDb();
    const docs = await db.collection('agents').find(
        {
            ...FILTRO_ACTIVOS,
            // se busca por nombre porque es lo que el bundle conoce de su equipo; escapado
            // para que un nombre con paréntesis o punto no se lea como regex
            'company.name': new RegExp(inmo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        },
        { projection: { firstName: 1, lastName: 1, email: 1, profilePicture: 1 } }
    ).toArray();

    const equipo = docs
        .map(a => ({
            nombre: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim(),
            email: String(a.email ?? '').trim().toLowerCase(),
            foto: String(a.profilePicture ?? '')
        }))
        .filter(a => a.email)
        .sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));

    return NextResponse.json({ equipo }, {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' }
    });
}
