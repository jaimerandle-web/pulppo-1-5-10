// Cliente mínimo de SendGrid vía REST v3 (sin dependencias: usa fetch nativo de Node 18+/Next 16).
// Fase 1: solo envío de PRUEBAS transaccionales (Mail Send). El envío masivo real irá por la API de
// Marketing Campaigns / Single Sends en Fase 2 (maneja listas, bajas y footer CAN-SPAM).

export interface SendArgs {
    to: string;
    subject: string;
    html: string;
}

export async function sendTestEmail({ to, subject, html }: SendArgs): Promise<{ ok: true; messageId: string | null }> {
    const key = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const fromName = process.env.SENDGRID_FROM_NAME || 'Pulppo';
    if (!key) throw new Error('Falta SENDGRID_API_KEY en el entorno');
    if (!fromEmail) throw new Error('Falta SENDGRID_FROM_EMAIL en el entorno');

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: fromEmail, name: fromName },
            subject,
            content: [{ type: 'text/html', value: html }],
            // Etiqueta [PRUEBA] visible y categoría para no ensuciar métricas de campañas reales.
            categories: ['1510-prueba'],
            tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
            mail_settings: { sandbox_mode: { enable: process.env.SENDGRID_SANDBOX === '1' } }
        })
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SendGrid ${res.status}: ${body || res.statusText}`);
    }
    return { ok: true, messageId: res.headers.get('x-message-id') };
}
