import { buildAnalisis, InputError, type AnalisisConfig } from '@/lib/analisis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { inmo, operacion, ventDemanda } → datos del análisis (Inventario + Precio×calidad).
export async function POST(req: Request) {
    try {
        const body = (await req.json()) as AnalisisConfig;
        if (!body?.inmo || body.inmo === '(todas)') {
            return Response.json({ error: 'Elige una inmobiliaria.' }, { status: 400 });
        }
        const data = await buildAnalisis(body);
        return Response.json(data);
    } catch (e) {
        // dato mal pedido → 400; falla real del servidor → 500
        const msg = e instanceof Error ? e.message : 'Error generando el análisis';
        return Response.json({ error: msg }, { status: e instanceof InputError ? 400 : 500 });
    }
}
