// API de la herramienta de avisos destacados, en vivo desde Mongo.
//
//   GET /api/avisos                → índice de inmobiliarias (con su KAM)
//   GET /api/avisos?inmo=NOMBRE    → el análisis completo de esa cuenta
//   ...&refresh=1                  → salta el caché
//
// El mercado (MLS de i24 + búsquedas guardadas) se carga una vez por instancia y se cachea
// una hora: son ~6 s. Con el caché caliente, una inmobiliaria tarda entre 0.3 y 0.8 s. Por eso
// la primera visita después de un arranque en frío es lenta y las siguientes no.
import { datosDe, listaInmobiliarias, getMercado } from '@/lib/portales/avisos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const url = new URL(req.url);
    const inmo = url.searchParams.get('inmo');
    const forzar = url.searchParams.get('refresh') === '1';
    try {
        if (!inmo) {
            // se precalienta el mercado en paralelo para que la primera cuenta ya lo encuentre
            const [lista] = await Promise.all([listaInmobiliarias(forzar), getMercado(forzar)]);
            return Response.json({ inmobiliarias: lista, calculadoEn: new Date().toISOString() });
        }
        return Response.json(await datosDe(inmo, forzar));
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error consultando Mongo';
        return Response.json({ error: msg }, { status: 500 });
    }
}
