import { computeEval } from '@/lib/elegibilidad';

// Modo lote del evaluador 1·5·10. POST { codes: string[] } → corre el análisis de varias propiedades
// a la vez (sin la base de compradores, para que sea rápido) y devuelve un resumen por propiedad.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
    let body: { codes?: string[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }
    const codes = [...new Set((body.codes || []).map((c) => c.trim()).filter(Boolean))].slice(0, 15);
    if (!codes.length) return Response.json({ error: 'Pasa al menos un código' }, { status: 400 });

    const results = await Promise.all(codes.map(async (c) => {
        try {
            const r = await computeEval(c, { withBase: false });
            if (!r) return { code: c, notFound: true };
            return {
                code: r.code, title: r.title, typ: r.typ, col: r.col, city: r.city,
                score: r.score, banda: r.banda, okIntr: r.okIntr, okMat: r.okMat, faltaMat: r.faltaMat,
                val: r.val, ppm2: r.ppm2, vsAcm: r.vsAcm, vsOferta: r.vsOferta, vsCierre: r.vsCierre,
                velocidadMed: r.velocidadMed, meses: r.meses
            };
        } catch (e) {
            return { code: c, error: e instanceof Error ? e.message : 'error' };
        }
    }));
    return Response.json({ results });
}
