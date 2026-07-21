import { renderCampaign } from '@/lib/email';
import { renderDigest } from '@/lib/digest';

// Preview del email. Individual: ?id=<ObjectId|codigo> → HTML (o &format=json para prellenar la UI).
// Digest por zona: ?zona=<nombre>&codes=CTA-422,DSJ-888 → HTML del correo multi-propiedad de la zona.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const url = new URL(req.url);

    // Preview del digest por zona
    const codesParam = url.searchParams.get('codes');
    if (codesParam) {
        const codes = codesParam.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
        const zona = url.searchParams.get('zona')?.trim() || 'tu zona';
        try {
            const d = await renderDigest(zona, codes);
            if (!d) return Response.json({ error: 'No se pudo armar el digest' }, { status: 404 });
            return new Response(d.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (e) {
            return Response.json({ error: e instanceof Error ? e.message : 'Error generando el preview' }, { status: 500 });
        }
    }

    const id = url.searchParams.get('id')?.trim();
    if (!id) return Response.json({ error: 'Falta el parámetro id' }, { status: 400 });
    const hook = url.searchParams.get('hook') || undefined;
    const subject = url.searchParams.get('subject') || undefined;

    try {
        const c = await renderCampaign(id, { hook, subject });
        if (!c) return Response.json({ error: `No se encontró la propiedad "${id}"` }, { status: 404 });
        if (url.searchParams.get('format') === 'json') {
            return Response.json({ id: c.id, code: c.code, title: c.title, subject: c.subject, zona: c.zona });
        }
        return new Response(c.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error generando el preview';
        return Response.json({ error: msg }, { status: 500 });
    }
}
