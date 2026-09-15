// Quién puede ver qué en la herramienta de avisos destacados.
//
// **Por qué existe.** `/api/avisos` y `/api/avisos/seleccion` no tenían ninguna verificación
// propia: estaban protegidas sólo porque el middleware no dejaba pasar a un master broker a
// esas rutas. Eso tenía dos consecuencias, y la primera tapaba a la segunda:
//
// 1. La pestaña **Destacados** de `/mb/{companyId}` no funcionaba para la inmobiliaria — que
//    es justo a quien está dirigida. Casane veía "No se pudo calcular. No autorizado".
// 2. El día que se abriera la ruta en el middleware, cualquier master broker podría leer los
//    avisos de OTRA inmobiliaria cambiando `?inmo=`, listar la cartera entera de un KAM con
//    `?kam=`, o sobrescribir la selección ajena con un POST.
//
// Abrir la ruta sin esto habría cambiado un error visible por una fuga silenciosa. El
// criterio es el mismo que ya usa el resto de la app: la cookie sólo sirve para rutear, y la
// barrera real se recalcula contra Mongo.
import { getDb } from '../data';
import { currentUser, masterCompanyForEmail } from '../companyAccess';

export interface Alcance {
    /** equipo Pulppo: ve el índice, cualquier cuenta y la vista del KAM */
    interno: boolean;
    /** master broker: SÓLO esta inmobiliaria. null si es interno. */
    inmobiliaria: string | null;
}

// Los nombres llegan de dos sitios —`companies.name` y `properties.company.name`— y conviven
// grafías con espacios de más. Se comparan normalizados para no rechazar a alguien por un
// espacio doble o un acento en mayúscula.
function normalizar(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** null = sin sesión válida. */
export async function alcanceDeAvisos(): Promise<Alcance | null> {
    const u = await currentUser();
    if (!u) return null;
    if (u.internal) return { interno: true, inmobiliaria: null };

    const companyId = await masterCompanyForEmail(u.email);
    if (!companyId) return { interno: false, inmobiliaria: null };

    const db = await getDb();
    const { ObjectId } = await import('mongodb');
    let doc = null;
    try {
        doc = await db.collection('companies').findOne(
            { _id: new ObjectId(companyId) }, { projection: { name: 1 } });
    } catch {
        doc = null;
    }
    const nombre = String(doc?.name ?? '').trim();
    return { interno: false, inmobiliaria: nombre || null };
}

/** ¿Este alcance permite consultar esta inmobiliaria? */
export function puedeVer(a: Alcance | null, inmo: string | null | undefined): boolean {
    if (!a) return false;
    if (a.interno) return true;
    if (!inmo || !a.inmobiliaria) return false;
    return normalizar(inmo) === normalizar(a.inmobiliaria);
}
