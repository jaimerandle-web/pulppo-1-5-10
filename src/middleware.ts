import { NextRequest, NextResponse } from 'next/server';
import { isAllowed } from '@/lib/access';
import { fichaToken, userToken } from '@/lib/token';

// Enforcea el acceso en TODAS las rutas/API (no solo en el login). Dos tipos de usuario:
//  - Interno (equipo Pulppo, allowlist) → acceso total.
//  - Externo (master broker) → SOLO el panel de su inmobiliaria /mb/{company} + sus APIs.
// La identidad (cookie cm-user) se valida con su firma cm-sig para que no sea suplantable. Edge-safe:
// solo isAllowed (lista estática) + userToken (Web Crypto); la verificación contra Mongo vive en el server.
export async function middleware(req: NextRequest) {
    const email = (req.cookies.get('cm-user')?.value || '').trim().toLowerCase();
    const sig = req.cookies.get('cm-sig')?.value || '';
    const validId = !!email && !!sig && sig === (await userToken(email));

    // Interno con identidad válida → acceso total.
    if (validId && isAllowed(email)) return NextResponse.next();

    // Acceso público a una ficha (y su "ver más" de comparables) con token válido (link para brokers, sin login).
    const m = req.nextUrl.pathname.match(/^\/ficha\/([^/]+)(?:\/comparables)?\/?$/);
    if (m) {
        const token = req.nextUrl.searchParams.get('token');
        if (token && token === (await fichaToken(decodeURIComponent(m[1])))) return NextResponse.next();
    }

    // Externo (master broker) con identidad válida → encerrado en su panel. cm-company es solo para
    // rutear acá; la barrera real (canAccessCompany) se recalcula server-side en la página y las APIs.
    const company = req.cookies.get('cm-company')?.value || '';
    if (validId && company) {
        const p = req.nextUrl.pathname;
        const ownPanel = p === `/mb/${company}` || p.startsWith(`/mb/${company}/`);
        const mbApi = p.startsWith('/api/mb-analisis') || p.startsWith('/api/mb-metrics');
        if (ownPanel || mbApi) return NextResponse.next();
        if (p.startsWith('/api')) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        const url = req.nextUrl.clone();
        url.pathname = `/mb/${company}`;
        url.search = '';
        return NextResponse.redirect(url);
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
