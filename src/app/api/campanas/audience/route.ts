import { buildAudience, audienceCsv } from '@/lib/audience';

// Base (audiencia) en vivo de una propiedad. ?id=<ObjectId|codigo>.
// &format=csv → descarga la lista completa; default → JSON con conteo y nivel (sin emails, por peso).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const url = new URL(req.url);
    const id = url.searchParams.get('id')?.trim();
    if (!id) return Response.json({ error: 'Falta el parámetro id' }, { status: 400 });
    try {
        const a = await buildAudience(id);
        if (!a) return Response.json({ error: `No se encontró la propiedad "${id}"` }, { status: 404 });
        if (url.searchParams.get('format') === 'csv') {
            return new Response(audienceCsv(a), {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="base_${a.code}_${a.level}.csv"`
                }
            });
        }
        return Response.json({ id: a.id, code: a.code, title: a.title, type: a.type, colonia: a.colonia, ciudad: a.ciudad, zona: a.zona, level: a.level, count: a.count });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error generando la base';
        return Response.json({ error: msg }, { status: 500 });
    }
}
