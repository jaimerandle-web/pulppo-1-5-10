// Seguimiento de los ascensos de Pulppo Plus: ¿ya se le avisó al asesor? ¿ya recibió su pin?
// Mongo es READ-ONLY en esta app, así que vive aparte, con el mismo patrón que
// lib/portales/seleccion.ts: Vercel Blob en prod, un JSON en .plus/ en local. En Vercel sin Blob
// no se escribe (se perdería en el siguiente request) y la UI lo avisa.
export type Campo = 'contactado' | 'pin';
export interface Marca { at: string; by: string }
/** clave = `${año}:${nivel}:${email}` → qué se marcó, cuándo y quién. */
export type Seguimiento = Record<string, Partial<Record<Campo, Marca>>>;

const ARCHIVO = 'plus-seguimiento.json';
const enVercel = () => !!process.env.VERCEL;
const conBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function esEfimero(): boolean {
    return enVercel() && !conBlob();
}

// fs/path en caliente: estáticos hacen que Turbopack trace el proyecto entero al bundle.
async function local() {
    const [{ promises: fs }, path] = await Promise.all([import('fs'), import('path')]);
    const ruta = path.join(process.cwd(), '.plus', 'seguimiento.json');
    return { fs, dir: path.dirname(ruta), ruta };
}

export async function leer(): Promise<Seguimiento> {
    try {
        if (conBlob()) {
            const { list } = await import('@vercel/blob');
            const { blobs } = await list({ prefix: ARCHIVO });
            if (!blobs.length) return {};
            // no-store: el Blob se cachea en CDN y devolvería una versión vieja.
            const r = await fetch(blobs[0].url, { cache: 'no-store' });
            return r.ok ? (await r.json()) as Seguimiento : {};
        }
        const { fs, ruta } = await local();
        return JSON.parse(await fs.readFile(ruta, 'utf8')) as Seguimiento;
    } catch {
        return {};
    }
}

/** Marca o desmarca un campo. Lee-modifica-escribe: con un puñado de personas usándolo basta. */
export async function marcar(clave: string, campo: Campo, valor: boolean, by: string): Promise<Seguimiento> {
    if (esEfimero()) throw new Error('No hay dónde guardar: falta configurar Vercel Blob (Storage → Create → Blob).');
    const todo = await leer();
    const r = { ...(todo[clave] ?? {}) };
    if (valor) r[campo] = { at: new Date().toISOString(), by };
    else delete r[campo];
    if (Object.keys(r).length) todo[clave] = r; else delete todo[clave];
    const cuerpo = JSON.stringify(todo, null, 2);
    if (conBlob()) {
        const { put } = await import('@vercel/blob');
        await put(ARCHIVO, cuerpo, { access: 'public', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false });
    } else {
        const { fs, dir, ruta } = await local();
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(ruta, cuerpo, 'utf8');
    }
    return todo;
}
