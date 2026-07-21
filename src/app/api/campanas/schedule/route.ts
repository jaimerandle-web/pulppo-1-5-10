import { withUnsubFooter } from '@/lib/email';
import { renderDigest } from '@/lib/digest';
import { buildZoneDigests, dedupZoneDigests } from '@/lib/audience';
import { getOrCreateList, addContacts, createSingleSend } from '@/lib/marketing';

// Fase 2, paso 2: POST { sends: [{ key, codes[≤3], sendAt, subject? }] }. Cada "send" es un correo digest
// (una zona + un bloque de máx 3 propiedades). Va a la base de SU zona (dedup entre zonas). Crea la Lista
// por zona (reusada entre bloques de la misma zona) y el Single Send como BORRADOR. NO lo programa.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface SendIn { key?: string; codes?: string[]; sendAt?: string; subject?: string }

export async function POST(req: Request) {
    let body: { sends?: SendIn[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const sendsIn = (body.sends || []).filter((s) => s && s.key && Array.isArray(s.codes) && s.codes.length && s.sendAt).slice(0, 100);
    if (!sendsIn.length) return Response.json({ error: 'No hay correos para crear' }, { status: 400 });

    // Reagrupa TODOS los códigos por zona (grouping canónico) + dedup entre zonas → base por zona.
    const allCodes = [...new Set(sendsIn.flatMap((s) => s.codes || []))];
    const digests = dedupZoneDigests(await buildZoneDigests(allCodes));
    const byKey = new Map(digests.map((d) => [d.key, d]));
    const listOf = new Map<string, string>();   // zonaKey → listId (subir la base una sola vez por zona)

    const out: Array<Record<string, unknown>> = [];
    for (const s of sendsIn) {
        const zonaKey = (s.key || '').split('#')[0];
        const d = byKey.get(zonaKey);
        try {
            if (!d || !d.rows.length) { out.push({ key: s.key, zonaName: d?.zonaName, ok: false, error: 'Base vacía' }); continue; }
            const render = await renderDigest(d.zonaName, s.codes || [], { subject: s.subject });
            if (!render) { out.push({ key: s.key, zonaName: d.zonaName, ok: false, error: 'No se pudo armar el digest' }); continue; }

            let listId = listOf.get(zonaKey);
            if (!listId) {
                listId = await getOrCreateList(`1·5·10 · ${d.zonaName}`);
                await addContacts(listId, d.rows.map((r) => ({ email: r.email, nombre: r.nombre })));
                listOf.set(zonaKey, listId);
            }

            const dateTag = (s.sendAt || '').slice(0, 10);
            const name = `1·5·10 · Exclusivas ${d.zonaName} · ${dateTag}`;
            const html = withUnsubFooter(render.html);
            const send = await createSingleSend({ name, subject: render.subject, html, listId });

            out.push({ key: s.key, zonaName: d.zonaName, ok: true, id: send.id, status: send.status, listId, count: d.count, props: render.codes, sendAt: s.sendAt, subject: render.subject });
        } catch (e) {
            out.push({ key: s.key, zonaName: d?.zonaName, ok: false, error: e instanceof Error ? e.message : 'Error creando el borrador' });
        }
    }

    return Response.json({ items: out });
}
