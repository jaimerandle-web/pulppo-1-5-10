// API de la herramienta de avisos destacados, en vivo desde Mongo.
//
//   GET /api/avisos                → índice de inmobiliarias (con su KAM)
//   GET /api/avisos?inmo=NOMBRE    → el análisis completo de esa cuenta
//   ...&refresh=1                  → salta el caché
//
// El mercado (MLS de i24 + búsquedas guardadas) se carga una vez por instancia y se cachea
// una hora: son ~6 s. Con el caché caliente, una inmobiliaria tarda entre 0.3 y 0.8 s. Por eso
// la primera visita después de un arranque en frío es lenta y las siguientes no.
import { datosDe, listaInmobiliarias, getMercado, resumenDe } from '@/lib/portales/avisos';
import { leer as leerSeleccion } from '@/lib/portales/seleccion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const url = new URL(req.url);
    const inmo = url.searchParams.get('inmo');
    const forzar = url.searchParams.get('refresh') === '1';
    try {
        // ?kam=NOMBRE → las cuentas de ese KAM + si ya respondieron qué destacar.
        // Es la vista de seguimiento: el detalle caro de cada cuenta se pide aparte
        // (?resumen=NOMBRE) para que la tabla se llene progresiva en vez de colgarse.
        const kam = url.searchParams.get('kam');
        if (kam) {
            const [lista, sel] = await Promise.all([listaInmobiliarias(forzar), leerSeleccion()]);
            const suyas = lista.filter((l) => l.kam === kam);
            return Response.json({
                kam,
                cuentas: suyas.map((l) => ({
                    ...l,
                    respondio: !!sel[l.inmobiliaria],
                    marcados: sel[l.inmobiliaria]?.ids.length ?? 0,
                    respondioPor: sel[l.inmobiliaria]?.por ?? null,
                    respondioEl: sel[l.inmobiliaria]?.fecha ?? null,
                })),
            });
        }
        const resumen = url.searchParams.get('resumen');
        if (resumen) return Response.json(await resumenDe(resumen));

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
