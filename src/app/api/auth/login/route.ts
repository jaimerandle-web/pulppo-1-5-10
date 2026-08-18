import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isAllowed } from '@/lib/access';
import { userToken } from '@/lib/token';
import { asesorIdForEmail, masterCompanyForEmail } from '@/lib/companyAccess';

// POST /api/auth/login { idToken } — SOLO Google: verifica el idToken de Firebase
// contra Google (accounts:lookup) y recién ahí valida allowlist + setea cookies.
export async function POST(req: NextRequest) {
    const { idToken } = await req.json().catch(() => ({}));
    if (!idToken || typeof idToken !== 'string') {
        return Response.json({ error: 'Falta el token de Google.' }, { status: 400 });
    }

    const apiKey = JSON.parse(process.env.NEXT_PUBLIC_FIREBASE || '{}').apiKey;
    if (!apiKey) return Response.json({ error: 'Firebase no configurado en el servidor.' }, { status: 500 });

    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const info = await r.json().catch(() => ({}));
    const user = info?.users?.[0];
    const mail = String(user?.email || '').trim().toLowerCase();
    if (!r.ok || !mail) {
        return Response.json({ error: 'Token de Google inválido.' }, { status: 401 });
    }
    // Interno (equipo Pulppo) por allowlist, o externo (master broker de una inmobiliaria). Un email
    // que es ambas cosas se trata como interno (acceso total, sin redirect a su panel).
    const internal = isAllowed(mail);
    const companyId = internal ? null : await masterCompanyForEmail(mail);
    // Tercer tipo: asesor (type:'associate'). Solo se prueba si no es interno ni master, así que
    // ni el equipo ni los master brokers cambian de comportamiento. Único acceso: /studio.
    const asesorId = internal || companyId ? null : await asesorIdForEmail(mail);
    if (!internal && !companyId && !asesorId) {
        return Response.json({ error: 'Tu email no tiene acceso. Pedí que te agreguen al equipo.' }, { status: 403 });
    }

    const store = await cookies();
    const opts = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 };
    store.set('cm-user', mail, opts);
    store.set('cm-name', String(user?.displayName || mail.split('@')[0]).trim(), opts);
    // Firma anti-falsificación de la identidad (sin esto la cookie cm-user sería suplantable).
    store.set('cm-sig', await userToken(mail), opts);
    // cm-company: solo para externos → el middleware la usa para rutearlos a su panel. La barrera de
    // seguridad real igual recalcula la company server-side (canAccessCompany), no confía en esta cookie.
    if (companyId) store.set('cm-company', companyId, opts);
    else store.delete('cm-company');
    // cm-asesor: igual que cm-company, solo para rutear en el middleware. La barrera real
    // (currentAsesorId) se recalcula server-side y no confía en esta cookie.
    if (asesorId) store.set('cm-asesor', asesorId, opts);
    else store.delete('cm-asesor');
    return Response.json({ ok: true, email: mail, companyId, asesorId });
}

// DELETE limpia la sesión.
export async function DELETE() {
    const store = await cookies();
    store.delete('cm-user');
    store.delete('cm-name');
    store.delete('cm-sig');
    store.delete('cm-company');
    store.delete('cm-asesor');
    return Response.json({ ok: true });
}
