import { NextRequest, NextResponse } from 'next/server';
import { isAllowed } from '@/lib/access';
import { fichaToken } from '@/lib/token';

// Enforcea el allowlist en TODAS las rutas/API (no solo en el login): si la cookie
// cm-user no es un email permitido, redirige a /login (páginas) o 401 (API).
export async function middleware(req: NextRequest) {
    const email = req.cookies.get('cm-user')?.value;
    if (isAllowed(email)) return NextResponse.next();

    // Acceso público a una ficha (y su "ver más" de comparables) con token válido (link para brokers, sin login).
    const m = req.nextUrl.pathname.match(/^\/ficha\/([^/]+)(?:\/comparables)?\/?$/);
    if (m) {
        const token = req.nextUrl.searchParams.get('token');
        if (token && token === (await fichaToken(decodeURIComponent(m[1])))) return NextResponse.next();
    }

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
