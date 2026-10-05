// Render de las plantillas de Polotno del "Ranking Pulppo" sobre Canvas 2D, en el navegador.
// No usamos el SDK de Polotno (licencia + editor completo) porque las piezas sólo traen
// rectángulos, círculos, líneas, texto e imágenes; esto las reproduce pixel a pixel.
//
// Las plantillas salen de herramientas/plus-ranking/normalizar.py, que deja los huecos con
// nombres fijos (mes, broker1..3, inmo1..3, ph/ini/foto1..3, logo1..5) y marca cada página
// con custom.slide.
import type { Level } from '@/lib/plus';

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = Record<string, any>;
export interface PolotnoDoc { width: number; height: number; pages: { background?: string; custom?: { slide?: Slide }; children: El[] }[] }
export type Slide = 'portada' | Level | 'consultoria' | 'onboarding';

export interface SlotBroker { first: string; last: string; inmo: string; photo: string | null }
export interface SlotCompany { name: string; logo: string | null }
export interface RankingFill {
    mes: string;               // "Agosto"
    year: number;
    brokers: Record<Level, (SlotBroker | null)[]>;
    consultoria: (SlotCompany | null)[];
    onboarding: (SlotCompany | null)[];
}

// ── imágenes ───────────────────────────────────────────────────────
// Todo lo externo pasa por /api/plus/img: no todos los hosts de fotos/logos mandan CORS, y
// una sola imagen sin CORS "ensucia" el canvas y bloquea la descarga del PNG.
// images.pulppo.com sí manda CORS (*) y va directo: hay fotos de perfil de >5 MB que el proxy
// no puede devolver (Vercel corta las respuestas de funciones en 4.5 MB).
const viaProxy = (src: string) => {
    if (!/^https?:\/\//.test(src)) return src;
    if (/^https:\/\/images\.pulppo\.com\//.test(src)) return src;
    return `/api/plus/img?u=${encodeURIComponent(src)}`;
};
const cache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImg(src: string): Promise<HTMLImageElement | null> {
    const url = viaProxy(src);
    if (!cache.has(url)) {
        cache.set(url, new Promise((res) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => res(im);
            im.onerror = () => res(null);
            im.src = url;
        }));
    }
    return cache.get(url)!;
}

/** ¿El logo tiene fondo transparente? Muestrea el borde: si es opaco (JPG o PNG con fondo
 *  blanco) no se puede pasar a blanco sin volverlo un rectángulo. */
const transp = new Map<HTMLImageElement, boolean>();
function isTransparent(im: HTMLImageElement): boolean {
    if (transp.has(im)) return transp.get(im)!;
    const c = document.createElement('canvas');
    const w = (c.width = Math.min(200, im.naturalWidth)), h = (c.height = Math.max(1, Math.round((w * im.naturalHeight) / im.naturalWidth)));
    const ctx = c.getContext('2d')!;
    ctx.drawImage(im, 0, 0, w, h);
    let clear = 0, n = 0;
    try {
        const a = ctx.getImageData(0, 0, w, h).data;
        const px = (x: number, y: number) => a[(y * w + x) * 4 + 3];
        for (let x = 0; x < w; x += 2) { n += 2; clear += +(px(x, 0) < 20) + +(px(x, h - 1) < 20); }
        for (let y = 0; y < h; y += 2) { n += 2; clear += +(px(0, y) < 20) + +(px(w - 1, y) < 20); }
    } catch { /* canvas sucio: tratar como opaco */ }
    const r = n > 0 && clear / n > 0.6;
    transp.set(im, r);
    return r;
}

// ── texto ──────────────────────────────────────────────────────────
function htmlLines(t: unknown): string[] {
    let s = String(t ?? '');
    if (/<p[\s>]/i.test(s)) s = s.replace(/<\/p>\s*<p[^>]*>/gi, '\n').replace(/<\/?p[^>]*>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return s.split('\n');
}

function wrap(ctx: CanvasRenderingContext2D, line: string, maxW: number): string[] {
    const out: string[] = [];
    let cur = '';
    for (const w of line.split(/(\s+)/)) {
        const test = cur + w;
        if (cur.trim() && ctx.measureText(test.trimEnd()).width > maxW + 0.5) { out.push(cur.trimEnd()); cur = w.trimStart(); }
        else cur = test;
    }
    out.push(cur.trimEnd());
    return out;
}

function drawText(ctx: CanvasRenderingContext2D, e: El) {
    let fs: number = e.fontSize || 16;
    const weight = e.fontWeight === 'normal' ? '400' : (e.fontWeight || '400');
    const setFont = () => {
        ctx.font = `${e.fontStyle === 'italic' ? 'italic ' : ''}${weight} ${fs}px "${e.fontFamily}"`;
        ctx.letterSpacing = `${(e.letterSpacing || 0) * fs}px`;
    };
    setFont();
    let lines = htmlLines(e.text);
    if (e.textTransform === 'uppercase') lines = lines.map((l) => l.toUpperCase());
    let all: string[];
    if (e.custom?.fit) {
        // Nombres e inmobiliarias: nunca partir el renglón (se encimaría con el de abajo);
        // si no cabe, se achica la letra hasta 55% del tamaño de diseño.
        const min = fs * 0.55;
        while (fs > min && lines.some((l) => ctx.measureText(l).width > e.width)) { fs -= 0.5; setFont(); }
        all = lines;
    } else {
        all = lines.flatMap((l) => wrap(ctx, l, e.width));
    }
    const lh = fs * (e.lineHeight || 1.2);
    let y0: number = e.y;
    if (e.verticalAlign === 'middle') y0 += (e.height - all.length * lh) / 2;
    else if (e.verticalAlign === 'bottom') y0 += e.height - all.length * lh;
    ctx.fillStyle = e.fill || '#000';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    all.forEach((l, i) => {
        const w = ctx.measureText(l).width;
        let x: number = e.x;
        if (e.align === 'center') x += (e.width - w) / 2;
        else if (e.align === 'right') x += e.width - w;
        ctx.fillText(l, x, y0 + i * lh + lh / 2);
    });
    ctx.letterSpacing = '0px';
}

async function drawImage(ctx: CanvasRenderingContext2D, e: El) {
    if (!e.src) return;
    const im = await loadImg(e.src);
    if (!im) return;
    ctx.save();
    if (e.custom?.logo) {
        // Logo de inmobiliaria: "contain" dentro de la caja, alineado a la izquierda y centrado
        // en vertical. En blanco (silueta) para el fondo oscuro, como en la pieza original.
        const k = Math.min(e.width / im.naturalWidth, e.height / im.naturalHeight);
        const w = im.naturalWidth * k, h = im.naturalHeight * k;
        const x = e.x, y = e.y + (e.height - h) / 2;
        if (isTransparent(im)) {
            const c = document.createElement('canvas');
            c.width = Math.ceil(w * 2); c.height = Math.ceil(h * 2);
            const cx = c.getContext('2d')!;
            cx.drawImage(im, 0, 0, c.width, c.height);
            cx.globalCompositeOperation = 'source-in';
            cx.fillStyle = '#fff';
            cx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(c, x, y, w, h);
        } else {
            // Logo con fondo: va en una placa blanca para que no se vea un recorte cuadrado.
            const pad = h * 0.12;
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.roundRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, 4); ctx.fill();
            ctx.drawImage(im, x, y, w, h);
        }
        ctx.restore();
        return;
    }
    let sx = (e.cropX || 0) * im.naturalWidth, sy = (e.cropY || 0) * im.naturalHeight;
    let sw = (e.cropWidth ?? 1) * im.naturalWidth, sh = (e.cropHeight ?? 1) * im.naturalHeight;
    if (/^foto\d$/.test(e.name || '')) {
        // Foto de asesor: recorte "cover" centrado, sesgado hacia arriba (las caras van arriba).
        const r = e.width / e.height;
        if (sw / sh > r) { const nw = sh * r; sx += (sw - nw) / 2; sw = nw; }
        else { const nh = sw / r; sy += (sh - nh) * 0.2; sh = nh; }
    }
    if (e.clipSrc) {
        ctx.beginPath();
        ctx.ellipse(e.x + e.width / 2, e.y + e.height / 2, e.width / 2, e.height / 2, 0, 0, Math.PI * 2);
        ctx.clip();
    } else if (e.cornerRadius) {
        ctx.beginPath(); ctx.roundRect(e.x, e.y, e.width, e.height, e.cornerRadius); ctx.clip();
    }
    ctx.drawImage(im, sx, sy, sw, sh, e.x, e.y, e.width, e.height);
    ctx.restore();
}

function drawFigure(ctx: CanvasRenderingContext2D, e: El) {
    ctx.fillStyle = e.fill || '#000';
    ctx.beginPath();
    if (e.subType === 'circle') ctx.ellipse(e.x + e.width / 2, e.y + e.height / 2, e.width / 2, e.height / 2, 0, 0, Math.PI * 2);
    else if (e.cornerRadius) ctx.roundRect(e.x, e.y, e.width, e.height, e.cornerRadius);
    else ctx.rect(e.x, e.y, e.width, e.height);
    ctx.fill();
}

export async function renderPage(doc: PolotnoDoc, page: PolotnoDoc['pages'][number], scale = 1): Promise<HTMLCanvasElement> {
    const c = document.createElement('canvas');
    c.width = Math.round(doc.width * scale); c.height = Math.round(doc.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.fillStyle = page.background || '#fff';
    ctx.fillRect(0, 0, doc.width, doc.height);
    for (const e of page.children) {
        if (e.visible === false || e.showInExport === false) continue;
        ctx.save();
        ctx.globalAlpha = e.opacity ?? 1;
        if (e.rotation && Math.abs(e.rotation) > 0.01) {
            ctx.translate(e.x, e.y); ctx.rotate((e.rotation * Math.PI) / 180); ctx.translate(-e.x, -e.y);
        }
        if (e.type === 'figure') drawFigure(ctx, e);
        else if (e.type === 'line') { ctx.fillStyle = e.color || '#000'; ctx.fillRect(e.x, e.y, e.width, e.height || 1); }
        else if (e.type === 'text') drawText(ctx, e);
        else if (e.type === 'image') await drawImage(ctx, e);
        ctx.restore();
    }
    return c;
}

// ── llenado ────────────────────────────────────────────────────────
const initials = (b: SlotBroker) => `${b.first.trim()[0] ?? ''}${b.last.trim()[0] ?? ''}`.toUpperCase();

/** Copia de la plantilla con los datos del mes puestos en sus huecos. */
export function fillTemplate(tpl: PolotnoDoc, f: RankingFill): PolotnoDoc {
    const doc: PolotnoDoc = JSON.parse(JSON.stringify(tpl));
    const MES_UP = `${f.mes.toUpperCase()} ${f.year}`;
    for (const page of doc.pages) {
        const slide = page.custom?.slide;
        const by = (n: string) => page.children.find((e) => e.name === n);
        const mes = by('mes'); if (mes) mes.text = MES_UP;
        if (slide === 'portada') {
            const body = by('cuerpo'); if (body) body.text = String(body.text).replace('{{mesNombre}}', f.mes);
        } else if (slide === 'elite' || slide === 'professional' || slide === 'standard') {
            [1, 2, 3].forEach((n) => {
                const b = f.brokers[slide][n - 1];
                const nm = by(`broker${n}`), inmo = by(`inmo${n}`), ph = by(`ph${n}`), ini = by(`ini${n}`), foto = by(`foto${n}`);
                if (!b) { [nm, inmo, ph, ini, foto].forEach((e) => { if (e) e.visible = false; }); return; }
                // El post los parte en dos renglones (<p>nombre</p><p>apellido</p>); la historia
                // en uno. Se respeta lo que traiga la plantilla.
                if (nm) nm.text = /<p/i.test(String(nm.text)) ? `<p>${b.first}</p><p>${b.last}</p>` : `${b.first} ${b.last}`.trim();
                if (inmo) inmo.text = b.inmo ? `/${b.inmo.toUpperCase()}` : '';
                if (foto) { foto.src = b.photo ?? ''; foto.visible = !!b.photo; }
                if (ini) ini.text = b.photo ? '' : initials(b);
            });
        } else if (slide === 'consultoria' || slide === 'onboarding') {
            [1, 2, 3, 4, 5].forEach((n) => {
                const c = f[slide][n - 1], lg = by(`logo${n}`);
                if (!lg) return;
                lg.src = c?.logo ?? ''; lg.visible = !!c?.logo;
                // Sin logo en Mongo: el nombre en texto en la misma caja, para no dejar el hueco.
                if (c && !c.logo && c.name) {
                    page.children.push({
                        type: 'text', name: `logoTxt${n}`, text: c.name, x: lg.x, y: lg.y, width: lg.width, height: lg.height,
                        fontFamily: 'Nunito Sans', fontSize: Math.round(lg.height * 0.3), fontWeight: '700', fill: '#fff',
                        align: 'left', verticalAlign: 'middle', lineHeight: 1.1, letterSpacing: 0.02, custom: { fit: true },
                    });
                }
            });
        }
    }
    return doc;
}

/** Nombre corto para la pieza: primer nombre completo + primer apellido. */
export function shortName(first: string, last: string): [string, string] {
    const f = first.trim().replace(/\s+/g, ' ');
    // "De la Cruz Pérez" → "De la Cruz": las partículas se pegan al apellido que sigue.
    const PART = /^(de|del|la|las|los|y|san|santa|van|von|di|da)$/i;
    const ws = last.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const w of ws) { out.push(w); if (!PART.test(w)) break; }
    return [f, out.join(' ')];
}

export async function ensureFonts() {
    if (!document.fonts) return;
    if (![...document.fonts].some((ff) => ff.family.replace(/"/g, '') === 'HeldaneTextRegular')) {
        const ff = new FontFace('HeldaneTextRegular', 'url(/plus/ranking/HeldaneTextRegular.otf)');
        document.fonts.add(await ff.load());
    }
    await Promise.all([
        document.fonts.load('40px "HeldaneTextRegular"'),
        document.fonts.load('400 20px "Nunito Sans"'),
    ]);
}
