import { scheduleSingleSend, unscheduleSingleSend } from '@/lib/marketing';

// Fase 2, paso 3 (aprobación humana): POST { sends: [{ id, sendAt }] } agenda cada borrador en SendGrid.
// Este es el ÚNICO punto que hace que un correo salga. DELETE ?id=<id> desprograma (vuelve a borrador),
// válido solo antes de la hora de envío.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Send { id?: string; sendAt?: string }

export async function POST(req: Request) {
    let body: { sends?: Send[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const sends = (body.sends || []).filter((s): s is Required<Send> => !!s?.id && !!s?.sendAt).slice(0, 50);
    if (!sends.length) return Response.json({ error: 'Nada que aprobar' }, { status: 400 });

    const out: Array<Record<string, unknown>> = [];
    for (const s of sends) {
        try {
            const r = await scheduleSingleSend(s.id, s.sendAt);
            out.push({ id: s.id, ok: true, status: r.status, sendAt: r.send_at });
        } catch (e) {
            out.push({ id: s.id, ok: false, error: e instanceof Error ? e.message : 'Error programando' });
        }
    }
    return Response.json({ items: out });
}

export async function DELETE(req: Request) {
    const id = new URL(req.url).searchParams.get('id')?.trim();
    if (!id) return Response.json({ error: 'Falta el id del envío' }, { status: 400 });
    try {
        await unscheduleSingleSend(id);
        return Response.json({ ok: true });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error cancelando' }, { status: 500 });
    }
}
