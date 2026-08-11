import { buildAnalisis, InputError, type AnalisisConfig } from '@/lib/analisis';
import { canAccessCompany } from '@/lib/companyAccess';

// Análisis por inmobiliaria para Master Brokers: scoped por companyId (la liga), audiencia 'mb'
// (sin destacados ni metas OKR internas). Datos en vivo, read-only.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as AnalisisConfig;
        if (!body?.companyId) return Response.json({ error: 'Falta companyId' }, { status: 400 });
        // Interno: cualquier company. Externo: solo la suya (evita pedir datos de un competidor por API).
        if (!(await canAccessCompany(body.companyId))) return Response.json({ error: 'No autorizado' }, { status: 403 });
        const data = await buildAnalisis({ ...body, audiencia: 'mb' });
        return Response.json(data);
    } catch (e) {
        // dato mal pedido → 400; falla real del servidor → 500
        const status = e instanceof InputError ? 400 : 500;
        return Response.json({ error: e instanceof Error ? e.message : 'Error generando el análisis' }, { status });
    }
}
