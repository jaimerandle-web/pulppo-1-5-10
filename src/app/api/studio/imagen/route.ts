// Sube la imagen de una pieza y devuelve una URL pública.
//
// **Por qué hace falta.** Hoy el PNG se dibuja en el navegador y se descarga; nunca existe en
// un servidor. Pero la API de publicación de Instagram NO recibe bytes: recibe una **URL
// pública** que Meta va a buscar. Sin este paso no hay botón de publicar por ninguna vía.
//
// **Formato.** Instagram pide **JPEG** para la imagen del contenedor de publicación; el PNG
// que hoy se descarga no le sirve. Por eso el cliente manda JPEG cuando la imagen va a
// publicarse y PNG cuando es para bajar. Acá se acepta cualquiera de los dos y se conserva el
// que llegue — la decisión es del cliente, que es quien sabe para qué la quiere.
//
// **Dónde se guarda.** Vercel Blob. Mongo es de sólo lectura y el disco de Vercel es efímero
// (escribir "funciona" y el archivo desaparece al siguiente request, que es peor que no
// guardar). Si el almacén no está creado, esto responde 503 y lo dice: es la misma decisión
// que tomó `lib/centro/store.ts`.
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/companyAccess';

// 8 MB es el tope de Instagram para la imagen de un post. Una pieza de 1080x1350 en JPEG
// ronda 300 KB, así que esto es holgado y sólo corta un envío absurdo.
const MAX_BYTES = 8 * 1024 * 1024;
const TIPOS = new Set(['image/jpeg', 'image/png']);

const hayBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

function nombre(email: string, tipo: string): string {
    const ext = tipo === 'image/png' ? 'png' : 'jpg';
    const dia = new Date().toISOString().slice(0, 10);
    // el usuario va en el nombre para poder barrer por asesor, y el aleatorio hace que la URL
    // no sea adivinable: aunque el Blob es público, nadie llega a ella sin el enlace
    const azar = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const quien = email.split('@')[0].replace(/[^a-z0-9.]/gi, '');
    return `studio/${dia}/${quien}-${azar}.${ext}`;
}

export async function POST(req: NextRequest) {
    const u = await currentUser();
    if (!u) return NextResponse.json({ error: 'sin sesión' }, { status: 401 });

    // Se valida la PETICIÓN antes de mirar nuestra configuración: un envío mal formado es
    // malo exista o no el almacén, y devolver 503 a un content-type inválido manda a
    // depurar al lado equivocado.
    const tipo = (req.headers.get('content-type') || '').split(';')[0].trim();
    if (!TIPOS.has(tipo)) {
        return NextResponse.json(
            { error: `tipo no soportado: ${tipo || 'sin content-type'}` }, { status: 415 });
    }

    const datos = await req.arrayBuffer();
    if (!datos.byteLength) {
        return NextResponse.json({ error: 'imagen vacía' }, { status: 400 });
    }
    if (datos.byteLength > MAX_BYTES) {
        return NextResponse.json(
            { error: `la imagen pesa ${Math.round(datos.byteLength / 1024)} KB y el tope son 8 MB` },
            { status: 413 });
    }

    if (!hayBlob()) {
        return NextResponse.json({
            error: 'almacén no configurado',
            // el mensaje es para quien lo prenda, no para el asesor: la UI muestra otra cosa
            detalle: 'Falta crear el Blob store en Vercel (Storage → Create → Blob). ' +
                'El token se inyecta solo y esto empieza a funcionar sin tocar código.'
        }, { status: 503 });
    }

    try {
        const { put } = await import('@vercel/blob');
        const r = await put(nombre(u.email, tipo), datos, {
            access: 'public',
            contentType: tipo,
            // sin sufijo aleatorio extra: el nombre ya lo trae, y así la URL es predecible
            // para poder borrarla después
            addRandomSuffix: false
        });
        return NextResponse.json({ url: r.url, bytes: datos.byteLength }, {
            status: 200,
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (e) {
        console.error('[studio/imagen]', e);
        return NextResponse.json({ error: 'no se pudo guardar la imagen' }, { status: 500 });
    }
}
