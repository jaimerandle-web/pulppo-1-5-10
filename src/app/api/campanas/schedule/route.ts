import { withUnsubFooter } from '@/lib/email';
import { renderDigest } from '@/lib/digest';
import { buildZoneDigests, dedupZoneDigests } from '@/lib/audience';
import { getOrCreateList, addContacts, createSingleSend } from '@/lib/marketing';

// Fase 2, paso 2: POST { zones: [{ key, codes[], sendAt, subject? }] }. Por cada ZONA arma el digest
// "Exclusivas de la semana" (varias propiedades en un correo), crea la Lista, sube la base de la zona
// (dedup entre zonas) y crea el Single Send como BORRADOR. NO lo programa: eso queda para la aprobación.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ZoneIn { key?: string; codes?: string[]; sendAt?: string; subject?: string }

export async function POST(req: Request) {
    let body: { zones?: ZoneIn[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const zonesIn = (body.zones || []).filter((z) => z && Array.isArray(z.codes) && z.codes.length && z.sendAt).slice(0, 40);
    if (!zonesIn.length) return Response.json({ error: 'No hay zonas para crear' }, { status: 400 });

    // Reagrupa TODOS los códigos por zona (grouping canónico) + dedup entre zonas, para que las bases
    // coincidan con lo que vio la persona en el plan.
    const allCodes = [...new Set(zonesIn.flatMap((z) => z.codes || []))];
    const digests = dedupZoneDigests(await buildZoneDigests(allCodes));

    const out: Array<Record<string, unknown>> = [];
    for (const d of digests) {
        const input = zonesIn.find((z) => z.key === d.key);
        const sendAt = input?.sendAt;
        try {
            if (!d.rows.length) { out.push({ key: d.key, zonaName: d.zonaName, ok: false, error: 'Base vacía' }); continue; }
            const render = await renderDigest(d.zonaName, d.props.map((p) => p.code), { subject: input?.subject });
            if (!render) { out.push({ key: d.key, zonaName: d.zonaName, ok: false, error: 'No se pudo armar el digest' }); continue; }

            const dateTag = (sendAt || '').slice(0, 10);
            const name = `1·5·10 · Exclusivas ${d.zonaName} · ${dateTag}`;
            const listId = await getOrCreateList(name);
            const up = await addContacts(listId, d.rows.map((r) => ({ email: r.email, nombre: r.nombre })));

            const html = withUnsubFooter(render.html);
            const send = await createSingleSend({ name, subject: render.subject, html, listId });

            out.push({ key: d.key, zonaName: d.zonaName, ok: true, id: send.id, status: send.status, listId, count: up.uploaded, props: render.codes, sendAt, subject: render.subject });
        } catch (e) {
            out.push({ key: d.key, zonaName: d.zonaName, ok: false, error: e instanceof Error ? e.message : 'Error creando el borrador' });
        }
    }

    return Response.json({ items: out });
}
