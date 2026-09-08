/* ------------------------------------------------------------------ *
 * Centro de Marketing — el estado que Mongo no puede guardar.
 *
 * Mongo es READ-ONLY en esta app, así que permisos y envíos viven acá.
 * (El módulo /campanas resolvió lo mismo escondiendo estado en el `name`
 * de los Single Sends de SendGrid; eso no escala a WhatsApp ni a permisos,
 * de ahí este store propio.)
 *
 * DOS BACKENDS, elegidos solos:
 *   · local  → un JSON en disco (.centro/store.json, gitignoreado).
 *   · Vercel → Blob, si existe BLOB_READ_WRITE_TOKEN.
 *
 * En Vercel el filesystem es EFÍMERO: escribir en disco "funciona" y el
 * dato desaparece en el siguiente request, que es peor que no guardar. Por
 * eso, si estamos en Vercel y no hay Blob configurado, el store entra en
 * modo SÓLO LECTURA y avisa (esEfimero) en vez de fingir que guardó.
 *
 * Para prender el guardado en prod: crear un Blob store en el proyecto de
 * Vercel (Storage → Create → Blob). El token se inyecta solo y esto empieza
 * a persistir sin tocar una línea de código.
 * ------------------------------------------------------------------ */

import type { Envio, Permiso, PermisoEstado, Store, TemaId, ViaId } from './tipos';

// fs/path se importan en caliente y sólo en el camino local: estáticos hacen
// que Turbopack trace el proyecto entero al bundle serverless.
const fsLocal = async () => {
    const [{ promises: fs }, path] = await Promise.all([import('fs'), import('path')]);
    const ruta = process.env.CENTRO_STORE_PATH || path.join(process.cwd(), '.centro', 'store.json');
    return { fs, dir: path.dirname(ruta), ruta };
};

const BLOB_PATH = 'centro/store.json';
const VACIO: Store = { permisos: [], envios: [] };

const hayBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const enVercel = () => !!process.env.VERCEL;

/** ¿Los cambios se van a perder? La UI lo muestra en vez de mentir. */
export function esEfimero(): boolean {
    return enVercel() && !hayBlob();
}

const normalizar = (s: Partial<Store> | null): Store =>
    ({ permisos: s?.permisos ?? [], envios: s?.envios ?? [] });

async function leer(): Promise<Store> {
    if (hayBlob()) {
        try {
            const { list } = await import('@vercel/blob');
            const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
            if (!blobs.length) return { ...VACIO };
            // no-store: el Blob se cachea en CDN y nos devolvería una versión vieja.
            const r = await fetch(blobs[0].url, { cache: 'no-store' });
            return normalizar(r.ok ? await r.json() : null);
        } catch {
            return { ...VACIO };
        }
    }
    try {
        const { fs, ruta } = await fsLocal();
        return normalizar(JSON.parse(await fs.readFile(ruta, 'utf8')));
    } catch {
        return { ...VACIO }; // primera corrida
    }
}

async function escribir(s: Store): Promise<void> {
    if (hayBlob()) {
        const { put } = await import('@vercel/blob');
        await put(BLOB_PATH, JSON.stringify(s, null, 2), {
            access: 'public', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false
        });
        return;
    }
    // En Vercel sin Blob no se escribe: se perdería en silencio.
    if (esEfimero()) throw new Error('EFIMERO');
    const { fs, dir, ruta } = await fsLocal();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(ruta, JSON.stringify(s, null, 2), 'utf8');
}

/* ------------------------------ permisos ------------------------------ */

export async function permisos(): Promise<Permiso[]> {
    return (await leer()).permisos;
}

/** Estado del permiso de un asesor para un tema. Sin registro = sin preguntar. */
export function estadoPermiso(ps: Permiso[], asesorId: string | null, tema: TemaId): PermisoEstado {
    if (!asesorId) return 'sin-preguntar';
    return ps.find((p) => p.asesorId === asesorId && p.tema === tema)?.estado ?? 'sin-preguntar';
}

export async function fijarPermiso(
    asesorId: string, tema: TemaId, estado: PermisoEstado, via: ViaId | null, por: string
): Promise<Permiso> {
    const s = await leer();
    const nuevo: Permiso = { asesorId, tema, estado, via, actualizadoEn: new Date().toISOString(), actualizadoPor: por };
    const i = s.permisos.findIndex((p) => p.asesorId === asesorId && p.tema === tema);
    if (i >= 0) s.permisos[i] = nuevo; else s.permisos.push(nuevo);
    await escribir(s);
    return nuevo;
}

/* ------------------------------- envíos ------------------------------- */

export async function envios(): Promise<Envio[]> {
    return (await leer()).envios;
}

export async function guardarEnvios(nuevos: Envio[]): Promise<number> {
    const s = await leer();
    s.envios.push(...nuevos);
    await escribir(s);
    return nuevos.length;
}

export async function cambiarEstadoEnvio(id: string, estado: Envio['estado']): Promise<boolean> {
    const s = await leer();
    const e = s.envios.find((x) => x.id === id);
    if (!e) return false;
    e.estado = estado;
    await escribir(s);
    return true;
}

/* -------------------------- techo de frecuencia -------------------------- */

/**
 * La regla anti-spam, que es la razón de que el calendario sea la pantalla
 * principal: una lista de campañas nunca te muestra que tres mensajes
 * distintos caen sobre la misma persona la misma semana.
 *
 * Devuelve las personas que YA tienen algo programado o enviado dentro de
 * `dias` alrededor de la fecha propuesta, sin importar de qué tema.
 */
export const VENTANA_DIAS = 14;

export function personasSaturadas(todos: Envio[], fecha: string, dias = VENTANA_DIAS): Set<string> {
    const t = new Date(fecha).getTime();
    const ms = dias * 864e5;
    const out = new Set<string>();
    for (const e of todos) {
        if (e.estado === 'cancelado' || e.estado === 'bloqueado') continue;
        if (Math.abs(new Date(e.fecha).getTime() - t) <= ms) out.add(e.personaId);
    }
    return out;
}

/** Id estable de envío: mismo mensaje + misma persona + mismo día = mismo id. */
export function idEnvio(mensajeId: string, personaId: string, fecha: string): string {
    return `${mensajeId}:${personaId}:${fecha.slice(0, 10)}`;
}
