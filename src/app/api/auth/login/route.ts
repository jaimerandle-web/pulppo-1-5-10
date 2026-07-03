import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isAllowed } from '@/lib/access';

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
    if (!isAllowed(mail)) {
        return Response.json({ error: 'Tu email no tiene acceso. Pedí que te agreguen al equipo.' }, { status: 403 });
    }

    const store = await cookies();
    const opts = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 };
    store.set('cm-user', mail, opts);
    store.set('cm-name', String(user?.displayName || mail.split('@')[0]).trim(), opts);
    return Response.json({ ok: true, email: mail });
}

// DELETE limpia la sesión.
export async function DELETE() {
    const store = await cookies();
    store.delete('cm-user');
    store.delete('cm-name');
    return Response.json({ ok: true });
}
