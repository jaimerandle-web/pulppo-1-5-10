/* ------------------------------------------------------------------ *
 * Qué avisos quiere destacar la inmobiliaria — la respuesta, guardada.
 *
 * Mongo es READ-ONLY en esta app, así que la selección vive acá. Mismo patrón
 * que el store del Centro de Marketing, por las mismas razones:
 *
 *   · local  → un JSON en disco (.portales/seleccion.json, gitignoreado)
 *   · Vercel → Blob, si existe BLOB_READ_WRITE_TOKEN
 *
 * En Vercel el filesystem es EFÍMERO: escribir en disco "funciona" y el dato
 * desaparece en el siguiente request, que es peor que no guardar. Por eso, si
 * estamos en Vercel y no hay Blob, entra en modo SÓLO LECTURA y lo dice, en vez
 * de fingir que guardó y perder la respuesta del KAM.
 *
 * Para prenderlo en prod: Vercel → Storage → Create → Blob. El token se inyecta
 * solo y esto empieza a persistir sin tocar una línea.
 * ------------------------------------------------------------------ */

export type Seleccion = {
    /** ids internos (DMA-096) que la inmobiliaria quiere destacar */
    ids: string[];
    /** quién respondió y cuándo, para que la decisión quede documentada */
    por: string;
    fecha: string;
    nota?: string;
};
export type Guardado = Record<string, Seleccion>;   // inmobiliaria → selección

const ARCHIVO = 'portales-seleccion.json';
const enVercel = () => !!process.env.VERCEL;
const conBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

/** true cuando escribir no serviría de nada: hay que avisarlo en la UI. */
export function esEfimero(): boolean {
    return enVercel() && !conBlob();
}

// fs/path se importan EN CALIENTE: estáticos hacen que Turbopack trace el proyecto
// entero al bundle serverless (mismo motivo que en centro/store.ts).
async function local() {
    const [{ promises: fs }, path] = await Promise.all([import('fs'), import('path')]);
    const ruta = process.env.PORTALES_STORE_PATH
        || path.join(process.cwd(), '.portales', 'seleccion.json');
    return { fs, dir: path.dirname(ruta), ruta };
}

export async function leer(): Promise<Guardado> {
    try {
        if (conBlob()) {
            const { list } = await import('@vercel/blob');
            const { blobs } = await list({ prefix: ARCHIVO });
            if (!blobs.length) return {};
            const r = await fetch(blobs[0].url, { cache: 'no-store' });
            return r.ok ? (await r.json()) as Guardado : {};
        }
        const { fs, ruta } = await local();
        return JSON.parse(await fs.readFile(ruta, 'utf8')) as Guardado;
    } catch {
        return {};                       // no existe todavía: empieza vacío
    }
}

export async function guardar(inmo: string, sel: Seleccion): Promise<Guardado> {
    if (esEfimero()) throw new Error(
        'No hay dónde guardar: falta configurar Vercel Blob (Storage → Create → Blob). '
        + 'Sin eso la respuesta se perdería en el siguiente request.');
    const todo = await leer();
    todo[inmo] = sel;
    const cuerpo = JSON.stringify(todo, null, 2);
    if (conBlob()) {
        const { put } = await import('@vercel/blob');
        await put(ARCHIVO, cuerpo, {
            access: 'public', contentType: 'application/json', allowOverwrite: true,
        });
    } else {
        const { fs, dir, ruta } = await local();
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(ruta, cuerpo, 'utf8');
    }
    return todo;
}
