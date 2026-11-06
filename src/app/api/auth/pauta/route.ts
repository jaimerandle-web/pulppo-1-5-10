import { NextRequest, NextResponse } from 'next/server';
import { PAUTA_EMAILS } from '@/lib/accesoPauta';
import { pautaToken, userToken } from '@/lib/token';

// GET /api/auth/pauta?t=<token> — liga personal de un externo de pauta (Habi). El email no va en la
// liga: se busca cuál de la lista firma ese token. Si alguno cuadra (y sigue en la lista), deja la misma sesión que el login (cm-user + cm-sig) y lo
// manda a /1-5-10/pauta; el middleware lo encierra ahí.
export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const t = q.get('t') || '';
    const firmas = await Promise.all(PAUTA_EMAILS.map(async (e) => [e, await pautaToken(e)] as const));
    const mail = t ? firmas.find(([, f]) => f === t)?.[0] : undefined;
    const url = req.nextUrl.clone();
    url.search = '';
    if (!mail) {
        url.pathname = '/login';
        return NextResponse.redirect(url);
    }
    url.pathname = '/1-5-10/pauta';
    const res = NextResponse.redirect(url);
    const opts = { httpOnly: false, sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 };
    res.cookies.set('cm-user', mail, opts);
    res.cookies.set('cm-name', mail.split('@')[0], opts);
    res.cookies.set('cm-sig', await userToken(mail), opts);
    res.cookies.delete('cm-company');
    res.cookies.delete('cm-asesor');
    return res;
}
