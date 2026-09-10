// Perfil en vivo del asesor para Studio.
//
// Reemplaza al bundle estático como fuente de los datos del asesor. Dos cosas que el archivo
// no podía hacer y esto sí: no caduca (se lee de Mongo al abrir) y no filtra (devuelve SÓLO
// el perfil de quien inició sesión, no los 22).
//
// La identidad NO la dice el cliente: sale de `currentUser()`, que valida la firma `cm-sig`
// de la cookie. Un asesor no puede pedir el perfil de otro — no hay parámetro para eso.
// Los internos (allowlist) sí pueden, con `?email=`, porque necesitan probar el archivo del
// piloto con la cuenta de cualquier asesora.
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/companyAccess';
import { perfilDeAsesor } from '@/lib/studio/perfil';

// Lo que el cliente manda: por cada idea de operación, su clase y los tokens que su
// plantilla pide. Es metadata pública (sale de los templates, ya vive en el bundle); el
// endpoint la usa para saber qué resolver, y filtra las rutas contra una allowlist.
interface Cuerpo {
    tokens?: Record<string, { clase?: string; tokens?: string[] }>;
}

const MAX_IDEAS = 40;

export async function POST(req: NextRequest) {
    const u = await currentUser();
    if (!u) return NextResponse.json({ error: 'sin sesión' }, { status: 401 });

    // el interno puede pedir el de otro para probar; el asesor, sólo el suyo
    const pedido = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
    const email = u.internal && pedido ? pedido : u.email;

    let cuerpo: Cuerpo = {};
    try {
        cuerpo = (await req.json()) as Cuerpo;
    } catch {
        cuerpo = {};
    }

    const crudo = cuerpo.tokens ?? {};
    const tokens: Record<string, { clase: string; tokens: string[] }> = {};
    for (const [id, cfg] of Object.entries(crudo).slice(0, MAX_IDEAS)) {
        if (!cfg?.clase) continue;
        tokens[id] = {
            clase: String(cfg.clase),
            tokens: Array.isArray(cfg.tokens) ? cfg.tokens.map(String).slice(0, 60) : []
        };
    }

    try {
        const perfil = await perfilDeAsesor(email, tokens);
        if (!perfil) {
            // no es un error: es un email que pasó la puerta pero no es asesor activo con
            // inmobiliaria. La app ya sabe mostrar la pantalla de "todavía no te toca".
            return NextResponse.json({ perfil: null, interno: u.internal }, { status: 200 });
        }
        // `interno` va acá para que el bundle NO tenga que llevar la allowlist del equipo
        // Pulppo adentro: eran 13 correos internos viajando al dispositivo de cada asesor.
        return NextResponse.json({ perfil, interno: u.internal }, {
            status: 200,
            // el perfil es por persona y cambia con sus operaciones: nunca en caché compartida
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (e) {
        console.error('[studio/perfil]', e);
        return NextResponse.json({ error: 'no se pudo leer el perfil' }, { status: 500 });
    }
}
