import { renderCampaign, withUnsubFooter } from '@/lib/email';
import { buildAudience } from '@/lib/audience';
import { getOrCreateList, addContacts, createSingleSend } from '@/lib/marketing';

// Fase 2, paso 2: POST { items: [{ code, sendAt, subject?, hook? }] }. Por cada propiedad: arma la base
// en vivo, crea/actualiza la Lista en SendGrid, sube los contactos y crea el Single Send como BORRADOR
// con el footer de baja. NO lo programa: eso queda para el paso de aprobación (api/campanas/approve).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Item { code?: string; sendAt?: string; subject?: string; hook?: string }

export async function POST(req: Request) {
    let body: { items?: Item[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const items = (body.items || []).filter((i): i is Required<Pick<Item, 'code' | 'sendAt'>> & Item => !!i?.code && !!i?.sendAt).slice(0, 20);
    if (!items.length) return Response.json({ error: 'No hay campañas para crear' }, { status: 400 });

    const out: Array<Record<string, unknown>> = [];
    for (const it of items) {
        const code = it.code.trim();
        try {
            const c = await renderCampaign(code, { subject: it.subject, hook: it.hook });
            if (!c) { out.push({ code, ok: false, error: 'Propiedad no encontrada' }); continue; }

            const a = await buildAudience(code);
            if (!a || !a.count) { out.push({ code, ok: false, error: 'La base salió vacía' }); continue; }

            const dateTag = it.sendAt.slice(0, 10);
            const name = `1·5·10 · ${c.code} · ${dateTag}`;
            const listId = await getOrCreateList(name);
            await addContacts(listId, a.rows.map((r) => ({ email: r.email, nombre: r.nombre })));

            const html = withUnsubFooter(c.html);
            const send = await createSingleSend({ name, subject: c.subject, html, listId });

            out.push({ code: c.code, ok: true, id: send.id, status: send.status, listId, count: a.count, sendAt: it.sendAt, subject: c.subject, level: a.level });
        } catch (e) {
            out.push({ code, ok: false, error: e instanceof Error ? e.message : 'Error creando el borrador' });
        }
    }

    return Response.json({ items: out });
}
