/* ------------------------------------------------------------------ *
 * El borrador de la asignación: lo que Ale escribe en /portales → Asignación
 * y lo que las KAMs ven. Mismo patrón que seleccion.ts (Mongo es read-only):
 *
 *   · local  → .portales/asignacion.json (gitignoreado)
 *   · Vercel → Blob, si existe BLOB_READ_WRITE_TOKEN
 *
 * Sin Blob en Vercel entra en SÓLO LECTURA y lo dice (escribir en disco ahí
 * "funciona" y se pierde en el siguiente request). Es UN borrador compartido:
 * el último que guarda gana, y queda quién y cuándo.
 * ------------------------------------------------------------------ */
import type { Cuenta } from './asignacion';
import type { Reglas } from './asignacionReglas';

export interface Borrador {
    /** inmobiliaria → los niveles que se movieron (lo que no está, se queda como el cupo de hoy) */
    valores: Record<string, Partial<Cuenta>>;
    notas: Record<string, string>;
    reglas: Reglas | null;
    por: string;
    fecha: string;
    /** los últimos guardados, para saber quién movió qué */
    historial: Array<{ por: string; fecha: string; cambios: number }>;
}
export const VACIO: Borrador = { valores: {}, notas: {}, reglas: null, por: '', fecha: '', historial: [] };

const ARCHIVO = 'portales-asignacion.json';
const enVercel = () => !!process.env.VERCEL;
const conBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const esEfimero = () => enVercel() && !conBlob();

async function local() {
    const [{ promises: fs }, path] = await Promise.all([import('fs'), import('path')]);
    const ruta = path.join(process.cwd(), '.portales', 'asignacion.json');
    return { fs, dir: path.dirname(ruta), ruta };
}

export async function leerBorrador(): Promise<Borrador> {
    try {
        if (conBlob()) {
            const { list } = await import('@vercel/blob');
            const { blobs } = await list({ prefix: ARCHIVO });
            if (!blobs.length) return VACIO;
            const r = await fetch(blobs[0].url, { cache: 'no-store' });
            return r.ok ? { ...VACIO, ...((await r.json()) as Borrador) } : VACIO;
        }
        const { fs, ruta } = await local();
        return { ...VACIO, ...(JSON.parse(await fs.readFile(ruta, 'utf8')) as Borrador) };
    } catch {
        return VACIO;
    }
}

export async function guardarBorrador(b: Omit<Borrador, 'historial'>): Promise<Borrador> {
    if (esEfimero()) throw new Error('No hay dónde guardar: falta configurar Vercel Blob (Storage → Create → Blob).');
    const antes = await leerBorrador();
    const cambios = Object.values(b.valores).reduce((a, v) => a + Object.keys(v).length, 0);
    const todo: Borrador = { ...b, historial: [{ por: b.por, fecha: b.fecha, cambios }, ...antes.historial].slice(0, 30) };
    const cuerpo = JSON.stringify(todo);
    if (conBlob()) {
        const { put } = await import('@vercel/blob');
        await put(ARCHIVO, cuerpo, { access: 'public', contentType: 'application/json', allowOverwrite: true });
    } else {
        const { fs, dir, ruta } = await local();
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(ruta, cuerpo, 'utf8');
    }
    return todo;
}
