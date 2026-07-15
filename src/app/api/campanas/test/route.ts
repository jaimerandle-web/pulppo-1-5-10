import { cookies } from 'next/headers';
import { renderCampaign } from '@/lib/email';
import { sendTestEmail } from '@/lib/sendgrid';

// Envío de PRUEBA de una campaña. POST { id, to?, subject?, hook? }.
// Guardrail Fase 1: el destinatario DEBE ser @pulppo.com (nunca leads reales hasta Fase 2).
// Si no se pasa "to", se usa el correo del usuario logueado (cookie cm-user).
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
    let payload: { id?: string; to?: string; subject?: string; hook?: string };
    try { payload = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const id = payload.id?.trim();
    if (!id) return Response.json({ error: 'Falta el id de la propiedad' }, { status: 400 });

    const me = (await cookies()).get('cm-user')?.value || '';
    const to = (payload.to?.trim() || me).toLowerCase();
    if (!to) return Response.json({ error: 'No se pudo determinar el destinatario' }, { status: 400 });
    if (!/^[^@\s]+@pulppo\.com$/.test(to)) {
        return Response.json(
            { error: `Fase 1: las pruebas solo pueden enviarse a correos @pulppo.com (intentaste: ${to})` },
            { status: 403 }
        );
    }

    try {
        const c = await renderCampaign(id, { hook: payload.hook, subject: payload.subject });
        if (!c) return Response.json({ error: `No se encontró la propiedad "${id}"` }, { status: 404 });
        const r = await sendTestEmail({ to, subject: `[PRUEBA] ${c.subject}`, html: c.html });
        return Response.json({ ok: true, to, code: c.code, messageId: r.messageId });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error enviando la prueba';
        return Response.json({ error: msg }, { status: 500 });
    }
}
