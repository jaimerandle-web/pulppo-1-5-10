import { cookies } from 'next/headers';
import { isAllowed } from '@/lib/access';
import { PAUTA_EMAILS } from '@/lib/accesoPauta';
import { pautaToken, userToken } from '@/lib/token';

// GET /api/pauta/acceso — ligas personales de los externos de pauta, SÓLO para internos. El
// middleware deja pasar /api/pauta/* también a los externos, por eso se revisa aquí.
export async function GET(req: Request) {
    const store = await cookies();
    const mail = (store.get('cm-user')?.value || '').trim().toLowerCase();
    const sig = store.get('cm-sig')?.value || '';
    if (!isAllowed(mail) || sig !== (await userToken(mail))) return Response.json({ error: 'No autorizado' }, { status: 403 });
    const base = new URL(req.url).origin;
    const ligas = await Promise.all(PAUTA_EMAILS.map(async (e) => ({
        email: e, url: `${base}/api/auth/pauta?t=${await pautaToken(e)}`
    })));
    return Response.json({ ligas });
}
