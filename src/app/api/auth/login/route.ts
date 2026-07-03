import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isAllowed } from '@/lib/access';

// POST /api/auth/login { email, name } — identidad simple (sin password) para el scoping.
export async function POST(req: NextRequest) {
    const { email, name } = await req.json().catch(() => ({}));
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) === false) {
        return Response.json({ error: 'Email inválido' }, { status: 400 });
    }
    if (!isAllowed(mail)) {
        return Response.json({ error: 'Tu email no tiene acceso. Pedí que te agreguen al equipo.' }, { status: 403 });
    }
    const store = await cookies();
    const opts = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 };
    store.set('cm-user', mail, opts);
    store.set('cm-name', String(name || mail.split('@')[0]).trim(), opts);
    return Response.json({ ok: true, email: mail });
}

// DELETE limpia la sesión.
export async function DELETE() {
    const store = await cookies();
    store.delete('cm-user');
    store.delete('cm-name');
    return Response.json({ ok: true });
}
