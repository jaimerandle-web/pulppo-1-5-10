// Arte para anuncio de Meta de una exclusiva 1·5·10, en cuatro tamaños.
//   GET ?code=DCI-165&formato=1x1|4x5|9x16|191x1 [&descargar=1]
//
// Foto = la portada de Mongo (la #1). Diseño de marca: foto arriba (o a la izquierda en el
// horizontal) y banda Soft Black con el texto; amarillo sólo en la etiqueta, sin sombras.
// En 9:16 el texto queda fuera del 14% de arriba y el 18% de abajo, que tapan la interfaz de
// Stories y Reels.
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPautaProp } from '@/lib/pauta';
import { FORMATOS, precioLargo, type Formato } from '@/lib/pauta/armado';

export const maxDuration = 60;

const SOFT = '#212322';
const YELLOW = '#F6BE00';
const GRAY = '#B7B7B7';

// Google Fonts devuelve TTF cuando la petición no trae user-agent de navegador; satori no lee woff2.
const fuentes = new Map<string, Promise<ArrayBuffer>>();
function fuente(familia: string, peso: number): Promise<ArrayBuffer> {
    const k = `${familia}:${peso}`;
    if (!fuentes.has(k)) {
        fuentes.set(k, (async () => {
            const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${familia.replace(/ /g, '+')}:wght@${peso}`)).text();
            const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
            if (!url) throw new Error(`No se pudo cargar la fuente ${familia}`);
            return (await fetch(url)).arrayBuffer();
        })());
    }
    return fuentes.get(k)!;
}

let logo: Promise<string> | null = null;
const logoBlanco = () => (logo ??= readFile(path.join(process.cwd(), 'public/pulppo-blanco.png'))
    .then((b) => `data:image/png;base64,${b.toString('base64')}`));

// La foto original pesa ~1.5 MB; el optimizador de pulppo.com la entrega redimensionada. Se pide
// JPEG explícito porque satori no lee webp; si el optimizador falla se usa la original.
async function foto(raw: string, ancho: number): Promise<string | null> {
    const urls = /^https?:\/\/images\.pulppo\.com\//i.test(raw)
        ? [`https://pulppo.com/_next/image?url=${encodeURIComponent(raw)}&w=${ancho > 1080 ? 1920 : 1080}&q=80`, raw]
        : [raw];
    for (const u of urls) {
        try {
            const r = await fetch(u, { headers: { Accept: 'image/jpeg,image/png' } });
            const tipo = r.headers.get('content-type') || '';
            if (!r.ok || !/image\/(jpeg|png)/.test(tipo)) continue;
            return `data:${tipo};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
        } catch { /* siguiente */ }
    }
    return null;
}

export async function GET(req: Request) {
    const q = new URL(req.url).searchParams;
    const code = q.get('code') || '';
    const f = FORMATOS.find((x) => x.id === (q.get('formato') as Formato)) || FORMATOS[0];
    const p = await getPautaProp(code);
    if (!p) return Response.json({ error: `No encontré ${code}` }, { status: 404 });
    if (!p.foto) return Response.json({ error: `${p.code} no tiene foto pública` }, { status: 422 });

    const [img, logoSrc, garamond, nunito, nunitoBold] = await Promise.all([
        foto(p.foto, f.w), logoBlanco(), fuente('EB Garamond', 400), fuente('Nunito Sans', 400), fuente('Nunito Sans', 700)
    ]);
    if (!img) return Response.json({ error: 'No se pudo descargar la foto' }, { status: 502 });

    const horizontal = f.id === '191x1';
    const story = f.id === '9x16';
    // Escala tipográfica por formato (px a 1080 de ancho).
    const t = horizontal
        ? { eyebrow: 16, titulo: 40, precio: 36, dato: 19, pad: 44, logo: 52 }
        : story
            ? { eyebrow: 28, titulo: 76, precio: 68, dato: 34, pad: 72, logo: 84 }
            : { eyebrow: 24, titulo: f.id === '4x5' ? 68 : 62, precio: f.id === '4x5' ? 60 : 54, dato: 30, pad: 64, logo: 72 };

    const tipo = p.tipo ? p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1).toLowerCase() : 'Propiedad';
    const titulo = `${tipo}${p.colonia ? ` en ${p.colonia}` : ''}`;
    const datos = [
        p.rec ? `${p.rec} rec` : null,
        p.banos ? `${Number.isInteger(p.banos) ? p.banos : p.banos.toFixed(1)} baños` : null,
        p.m2 ? `${Math.round(p.m2).toLocaleString('es-MX')} m²` : null,
        p.park ? `${p.park} est.` : null
    ].filter(Boolean).join('   ·   ');
    const fotoAlto = horizontal ? f.h : story ? Math.round(f.h * 0.6) : f.id === '4x5' ? 860 : 640;

    const panel = (
        <div style={{
            display: 'flex', flexDirection: 'column', justifyContent: horizontal ? 'center' : 'flex-start',
            backgroundColor: SOFT, color: 'white', flexGrow: 1,
            width: horizontal ? f.w - 700 : f.w,
            padding: `${t.pad}px ${t.pad}px ${story ? Math.round(f.h * 0.18) : t.pad}px`
        }}>
            <div style={{ display: 'flex', fontFamily: 'Nunito Sans', fontWeight: 700, fontSize: t.eyebrow, letterSpacing: 3, color: YELLOW }}>
                {`EXCLUSIVA EN VENTA${p.ciudad ? ' · ' + p.ciudad.toUpperCase() : ''}`}
            </div>
            <div style={{ display: 'flex', fontFamily: 'EB Garamond', fontSize: t.titulo, lineHeight: 1.08, marginTop: Math.round(t.pad * 0.3) }}>
                {titulo}
            </div>
            <div style={{ display: 'flex', fontFamily: 'EB Garamond', fontSize: t.precio, marginTop: Math.round(t.pad * 0.35) }}>
                {precioLargo(p.precio)}
            </div>
            <div style={{ display: 'flex', fontFamily: 'Nunito Sans', fontSize: t.dato, color: GRAY, marginTop: Math.round(t.pad * 0.2) }}>
                {datos}
            </div>
            <div style={{ display: 'flex', flexGrow: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: Math.round(t.pad * 0.4) }}>
                <img src={logoSrc} height={t.logo} width={Math.round(t.logo * 2.35)} alt="" />
                <div style={{ display: 'flex', fontFamily: 'Nunito Sans', fontSize: Math.round(t.dato * 0.7), color: GRAY }}>{p.code}</div>
            </div>
        </div>
    );

    const res = new ImageResponse(
        (
            <div style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', width: f.w, height: f.h, backgroundColor: SOFT }}>
                <img src={img} alt="" width={horizontal ? 700 : f.w} height={fotoAlto}
                    style={{ objectFit: 'cover', width: horizontal ? 700 : f.w, height: fotoAlto }} />
                {panel}
            </div>
        ),
        {
            width: f.w, height: f.h,
            fonts: [
                { name: 'EB Garamond', data: garamond, weight: 400, style: 'normal' },
                { name: 'Nunito Sans', data: nunito, weight: 400, style: 'normal' },
                { name: 'Nunito Sans', data: nunitoBold, weight: 700, style: 'normal' }
            ]
        }
    );
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'private, max-age=3600');
    if (q.get('descargar')) headers.set('Content-Disposition', `attachment; filename="${p.code}_${f.id}.png"`);
    return new Response(res.body, { status: res.status, headers });
}
