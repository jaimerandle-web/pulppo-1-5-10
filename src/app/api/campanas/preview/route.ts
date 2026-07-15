import { renderCampaign } from '@/lib/email';

// Preview del email de una campaña. ?id=<ObjectId|codigo> → HTML renderizado para el iframe.
// &format=json → { id, code, title, subject, zona } para prellenar la UI. &hook= override opcional.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const url = new URL(req.url);
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
