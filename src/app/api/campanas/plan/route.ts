import { buildZoneDigests, dedupZoneDigests } from '@/lib/audience';

// Planeador de calendario (Fase 2, paso 1): POST { codes[], start?, hour? }. Agrupa las propiedades por
// ZONA y arma un digest "Exclusivas de la semana" por zona (varias propiedades en un solo correo). Así una
// persona recibe un solo correo aunque le toquen varias, sin perder relevancia. Las zonas casi no se cruzan
// (dedup entre zonas para el que compre en dos), así que TODAS pueden salir la misma semana. NO toca SendGrid.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_HOUR_UTC = 15;   // 09:00 en México (UTC-6, sin horario de verano)

function nextMonday(from: Date): Date {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const add = ((8 - d.getUTCDay()) % 7) || 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d;
}

export async function POST(req: Request) {
    let body: { codes?: string[]; start?: string; hour?: number };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const codes = [...new Set((body.codes || []).map((c) => c.trim()).filter(Boolean))].slice(0, 40);
    if (!codes.length) return Response.json({ error: 'Pasa al menos un código de propiedad' }, { status: 400 });

    const hourUtc = Number.isFinite(body.hour) ? Number(body.hour) : DEFAULT_HOUR_UTC;
    const start = body.start ? new Date(`${body.start}T00:00:00Z`) : nextMonday(new Date());
    if (isNaN(start.getTime())) return Response.json({ error: 'Fecha de inicio inválida' }, { status: 400 });

    try {
        const digests = dedupZoneDigests(await buildZoneDigests(codes));
        digests.sort((a, b) => b.count - a.count);

        const send = new Date(start);
        send.setUTCHours(hourUtc, 0, 0, 0);
        const sendAt = send.toISOString();
        const date = send.toISOString().slice(0, 10);

        const zones = digests.map((d) => ({
            key: d.key,
            zonaName: d.zonaName,
            count: d.count,
            sendAt,           // por defecto todas la misma semana; editable por zona en la UI
            date,
            props: d.props
        }));

        const seen = new Set(digests.flatMap((d) => d.props.map((p) => p.code)));
        const notFound = codes.filter((c) => !seen.has(c.toUpperCase()) && !seen.has(c));

        return Response.json({
            start: start.toISOString(), hourUtc, zones, notFound,
            nota: zones.length <= 1
                ? 'Una sola zona: un correo con todas sus exclusivas.'
                : `${zones.length} zonas → ${zones.length} correos, todos pueden salir la misma semana (uno por zona, sin empalmes).`
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error planeando el calendario' }, { status: 500 });
    }
}
