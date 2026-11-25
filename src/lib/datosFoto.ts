// Asesores externos NO van en vivo (Ale, 24-nov-2026): foto de toda la red que se renueva cada MES.
//
// Vive en Vercel Blob. La tienda es pública y la foto trae teléfonos y correos de brokers: el archivo lleva sufijo
// aleatorio (no se adivina) y se encuentra con `list()`, que pide el token del servidor. Calcularla son minutos, así
// que nunca bloquea la pestaña: si la foto venció se sirve la anterior y se renueva con `after()`; si no hay ninguna,
// sale `preparando` y se calcula en segundo plano. Sin Blob (local) se calcula en el momento.
import { after } from 'next/server';
import { del, list, put } from '@vercel/blob';
import type { BrokerRed } from './brokersRed';

export const VIGENCIA_DIAS = 30;
const prefijo = (companyId: string) => `datos/${companyId}/brokers-red-`;
const hayBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const enCurso = new Set<string>();

export type Foto = { generado: string | null; datos: BrokerRed[]; preparando: boolean };

async function renovar(companyId: string, calcular: () => Promise<BrokerRed[]>) {
    if (enCurso.has(companyId)) return;
    enCurso.add(companyId);
    try {
        const datos = await calcular();
        const generado = new Date().toISOString();
        const { blobs } = await list({ prefix: prefijo(companyId) });
        await put(`${prefijo(companyId)}${generado.slice(0, 10)}.json`, JSON.stringify({ generado, datos }), {
            access: 'public', contentType: 'application/json', addRandomSuffix: true,
        });
        if (blobs.length) await del(blobs.map((b) => b.url));
    } catch (e) {
        console.error('[datosFoto] no se pudo renovar', e);
    } finally {
        enCurso.delete(companyId);
    }
}

export async function fotoAsesores(companyId: string, calcular: () => Promise<BrokerRed[]>): Promise<Foto> {
    if (!hayBlob()) return { generado: new Date().toISOString(), datos: await calcular(), preparando: false };

    const { blobs } = await list({ prefix: prefijo(companyId) });
    const ultima = [...blobs].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
    if (!ultima || Date.now() - +new Date(ultima.uploadedAt) > VIGENCIA_DIAS * 86400000) after(() => renovar(companyId, calcular));
    if (!ultima) return { generado: null, datos: [], preparando: true };
    const r = await fetch(ultima.url, { cache: 'no-store' });
    if (!r.ok) return { generado: null, datos: [], preparando: true };
    const f = (await r.json()) as { generado: string; datos: BrokerRed[] };
    return { ...f, preparando: false };
}
