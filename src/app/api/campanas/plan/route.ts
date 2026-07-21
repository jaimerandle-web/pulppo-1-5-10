import { buildZoneDigests, dedupZoneDigests } from '@/lib/audience';

// Planeador (Fase 2, paso 1): POST { codes[], start?, hour? }. Agrupa por ZONA en digests "Exclusivas de
// la semana" (varias propiedades en un correo). MÁX 3 propiedades por correo: si una zona tiene más de 3,
// las extra pasan a la SIGUIENTE semana (mismo público, otro correo la semana que sigue). Zonas distintas
// (bases casi disjuntas + dedup entre zonas) pueden salir la misma semana. NO toca SendGrid.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_HOUR_UTC = 15;   // 09:00 en México (UTC-6, sin horario de verano)
const MAX_PER_MAIL = 3;

function nextMonday(from: Date): Date {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const add = ((8 - d.getUTCDay()) % 7) || 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d;
}

export async function POST(req: Request) {
    let body: { codes?: string[]; start?: string; hour?: number };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const codes = [...new Set((body.codes || []).map((c) => c.trim()).filter(Boolean))].slice(0, 100);
    if (!codes.length) return Response.json({ error: 'Pasa al menos un código de propiedad' }, { status: 400 });

    const hourUtc = Number.isFinite(body.hour) ? Number(body.hour) : DEFAULT_HOUR_UTC;
    const start = body.start ? new Date(`${body.start}T00:00:00Z`) : nextMonday(new Date());
    if (isNaN(start.getTime())) return Response.json({ error: 'Fecha de inicio inválida' }, { status: 400 });

    try {
        const digests = dedupZoneDigests(await buildZoneDigests(codes));
        digests.sort((a, b) => b.count - a.count);

        // Un "envío" = un correo (zona + bloque de máx 3). El bloque i de cada zona va a la semana i.
        const sends = [];
        for (const d of digests) {
            for (let i = 0; i * MAX_PER_MAIL < d.props.length; i++) {
                const chunk = d.props.slice(i * MAX_PER_MAIL, i * MAX_PER_MAIL + MAX_PER_MAIL);
                const send = new Date(start);
                send.setUTCDate(send.getUTCDate() + i * 7);
                send.setUTCHours(hourUtc, 0, 0, 0);
                sends.push({
                    key: `${d.key}#${i}`, zonaName: d.zonaName, week: i + 1,
                    sendAt: send.toISOString(), date: send.toISOString().slice(0, 10),
                    count: d.count, props: chunk
                });
            }
        }
        sends.sort((a, b) => a.week - b.week || b.count - a.count);
        const weeks = sends.reduce((m, s) => Math.max(m, s.week), 0);

        const seen = new Set(digests.flatMap((d) => d.props.map((p) => p.code)));
        const notFound = codes.filter((c) => !seen.has(c.toUpperCase()) && !seen.has(c));

        return Response.json({
            start: start.toISOString(), hourUtc, sends, notFound,
            nota: `${digests.length} zona(s) · máx ${MAX_PER_MAIL} por correo → ${sends.length} correo(s) en ${weeks} semana(s). Una persona recibe a lo más un correo por semana.`
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error planeando el calendario' }, { status: 500 });
    }
}
