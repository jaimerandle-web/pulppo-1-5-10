// Asesores externos NO van en vivo (Ale, 24-nov-2026): se guarda una foto y se renueva cada 3 meses.
//
// Vive en Vercel Blob. La tienda es pública, y la foto trae teléfonos y correos de brokers: por eso el archivo
// lleva sufijo aleatorio (no se adivina) y se encuentra con `list()`, que pide el token del servidor. Al
// renovar se borran las fotos viejas. Sin Blob (local) se calcula en vivo.
import { del, list, put } from '@vercel/blob';
import type { AsesorExterno } from './datosExport';

export const VIGENCIA_DIAS = 90;
const prefijo = (companyId: string) => `datos/${companyId}/asesores-externos-`;
const hayBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type Foto = { generado: string; datos: AsesorExterno[] };

export async function fotoAsesores(companyId: string, calcular: () => Promise<AsesorExterno[]>): Promise<Foto> {
    if (!hayBlob()) return { generado: new Date().toISOString(), datos: await calcular() };

    const { blobs } = await list({ prefix: prefijo(companyId) });
    const ultima = [...blobs].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
    if (ultima && Date.now() - +new Date(ultima.uploadedAt) < VIGENCIA_DIAS * 86400000) {
        const r = await fetch(ultima.url, { cache: 'no-store' });
        if (r.ok) return (await r.json()) as Foto;
    }

    const foto: Foto = { generado: new Date().toISOString(), datos: await calcular() };
    await put(`${prefijo(companyId)}${foto.generado.slice(0, 10)}.json`, JSON.stringify(foto), {
        access: 'public', contentType: 'application/json', addRandomSuffix: true,
    });
    if (blobs.length) await del(blobs.map((b) => b.url));
    return foto;
}
