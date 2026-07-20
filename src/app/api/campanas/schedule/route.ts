import { renderCampaign, withUnsubFooter } from '@/lib/email';
import { buildAudience } from '@/lib/audience';
import { extractEmail } from '@/lib/validEmail';
import { getOrCreateList, addContacts, createSingleSend } from '@/lib/marketing';

// Fase 2, paso 2: POST { items: [{ code, sendAt, subject?, hook? }] }. Por cada propiedad arma la base
// en vivo, crea la Lista en SendGrid, sube los contactos y crea el Single Send como BORRADOR con el footer
// de baja. NO lo programa: eso queda para la aprobación (api/campanas/approve).
//
// DEDUP DENTRO DE LA SEMANA: como el título es "exclusiva de la semana", nadie debe recibir dos correos
// la misma semana. Agrupamos las campañas por fecha de envío y, dentro de cada semana, cada persona se
// asigna a UNA sola propiedad. Se procesan las bases de menor a mayor tamaño para que las bases chicas
// (más específicas) conserven a su gente y las grandes cedan a los compartidos. Entre semanas distintas
// sí puede repetir (es lo buscado: una exclusiva por semana).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Item { code?: string; sendAt?: string; subject?: string; hook?: string }
type Ready = Required<Pick<Item, 'code' | 'sendAt'>> & Item;

export async function POST(req: Request) {
    let body: { items?: Item[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const items = (body.items || []).filter((i): i is Ready => !!i?.code && !!i?.sendAt).slice(0, 20);
    if (!items.length) return Response.json({ error: 'No hay campañas para crear' }, { status: 400 });

    // Agrupar por semana (fecha de envío YYYY-MM-DD).
    const byWeek = new Map<string, Ready[]>();
    for (const it of items) {
        const wk = it.sendAt.slice(0, 10);
        byWeek.set(wk, [...(byWeek.get(wk) || []), it]);
    }

    const out: Array<Record<string, unknown>> = [];
    for (const [, group] of byWeek) {
        // 1) Armar la base de cada propiedad de la semana.
        const built: Array<{ it: Ready; c: NonNullable<Awaited<ReturnType<typeof renderCampaign>>>; count: number; rows: { email: string; nombre: string }[] }> = [];
        for (const it of group) {
            const code = it.code.trim();
            try {
                const c = await renderCampaign(code, { subject: it.subject, hook: it.hook });
                if (!c) { out.push({ code, ok: false, error: 'Propiedad no encontrada' }); continue; }
                const a = await buildAudience(code);
                if (!a || !a.count) { out.push({ code, ok: false, error: 'La base salió vacía' }); continue; }
                built.push({ it, c, count: a.count, rows: a.rows.map((r) => ({ email: r.email, nombre: r.nombre })) });
            } catch (e) {
                out.push({ code, ok: false, error: e instanceof Error ? e.message : 'Error armando la base' });
            }
        }

        // 2) Dedup entre propiedades de la semana: base más chica primero se queda con los compartidos.
        built.sort((x, y) => x.count - y.count);
        const usedThisWeek = new Set<string>();

        // 3) Subir la base ya deduplicada y crear el borrador.
        for (const b of built) {
            const code = b.c.code;
            try {
                const rows: { email: string; nombre: string }[] = [];
                for (const r of b.rows) {
                    const email = extractEmail(r.email);
                    if (!email || usedThisWeek.has(email)) continue;
                    usedThisWeek.add(email);
                    rows.push({ email, nombre: r.nombre });
                }
                if (!rows.length) { out.push({ code, ok: false, error: 'Sin correos propios tras dedup de la semana' }); continue; }

                const dateTag = b.it.sendAt.slice(0, 10);
                const name = `1·5·10 · ${code} · ${dateTag}`;
                const listId = await getOrCreateList(name);
                const up = await addContacts(listId, rows);

                const html = withUnsubFooter(b.c.html);
                const send = await createSingleSend({ name, subject: b.c.subject, html, listId });

                out.push({ code, ok: true, id: send.id, status: send.status, listId, count: up.uploaded, skipped: b.count - up.uploaded, sendAt: b.it.sendAt, subject: b.c.subject });
            } catch (e) {
                out.push({ code, ok: false, error: e instanceof Error ? e.message : 'Error creando el borrador' });
            }
        }
    }

    return Response.json({ items: out });
}
