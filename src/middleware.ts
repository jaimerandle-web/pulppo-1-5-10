import { NextRequest, NextResponse } from 'next/server';
import { isAllowed } from '@/lib/access';

// Enforcea el allowlist en TODAS las rutas/API (no solo en el login): si la cookie
// cm-user no es un email permitido, redirige a /login (páginas) o 401 (API).
export function middleware(req: NextRequest) {
    // Llave temporal hasta autorizar el dominio en Google OAuth: con DISABLE_AUTH=1 no pide login.
    if (process.env.DISABLE_AUTH === '1') return NextResponse.next();
    const email = req.cookies.get('cm-user')?.value;
    if (isAllowed(email)) return NextResponse.next();

    if (req.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
}

export const config = {
    matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico|pulppo-icon.png).*)']
};
