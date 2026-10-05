// Proxy de imágenes para las piezas del Ranking (/plus → Imágenes del ranking).
// El canvas sólo puede exportar a PNG si TODAS sus imágenes son del mismo origen o mandan
// CORS; las fotos de asesores y logos viven en varios hosts (images.pulppo.com, naventcdn,
// Google…) y no todos lo mandan. Detrás del middleware: sólo usuarios internos.
export const dynamic = 'force-dynamic';

// Vercel corta las respuestas de funciones en 4.5 MB.
const MAX = 4 * 1024 * 1024;

export async function GET(req: Request) {
    const u = new URL(req.url).searchParams.get('u') ?? '';
    let target: URL;
    try { target = new URL(u); } catch { return new Response('url inválida', { status: 400 }); }
    if (target.protocol !== 'https:') return new Response('sólo https', { status: 400 });
    try {
        const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (PulppoPlus)' }, redirect: 'follow' });
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || !ct.startsWith('image/')) return new Response('no es imagen', { status: 502 });
        const buf = await r.arrayBuffer();
        if (buf.byteLength > MAX) return new Response('imagen demasiado grande', { status: 413 });
        return new Response(buf, { headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=86400' } });
    } catch {
        return new Response('no se pudo traer la imagen', { status: 502 });
    }
}
