import { buildZoneDigests, dedupZoneDigests } from '@/lib/audience';
import { claimedPropertyCodes, scheduledZoneWeeks, isoWeekKey, zoneWeekKey } from '@/lib/marketing';

// Planeador (Fase 2, paso 1): POST { codes[], start?, hour? }. Agrupa por ZONA en digests "Exclusivas de
// la semana" (varias propiedades en un correo). MÁX 3 propiedades por correo: si una zona tiene más de 3,
// las extra pasan a la SIGUIENTE semana (mismo público, otro correo la semana que sigue). Zonas distintas
// (bases casi disjuntas + dedup entre zonas) pueden salir la misma semana. Excluye del calendario las
// propiedades que YA están en un Single Send de SendGrid (borrador/programado/enviado) para no reenviarlas.
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
        // Anti-duplicado de propiedades: quita las que ya están en un envío de SendGrid (dentro de la ventana).
        let claimed = new Map<string, { name: string; status: string; sendAt: string | null }>();
        try { claimed = await claimedPropertyCodes(); } catch { /* si SendGrid falla, se planea sin el filtro */ }
        const alreadySent = codes
            .filter((c) => claimed.has(c.toUpperCase()))
            .map((c) => { const i = claimed.get(c.toUpperCase())!; return { code: c.toUpperCase(), status: i.status, sendAt: i.sendAt }; });
        const fresh = codes.filter((c) => !claimed.has(c.toUpperCase()));

        const digests = dedupZoneDigests(await buildZoneDigests(fresh));
        digests.sort((a, b) => b.count - a.count);

        // Anti-duplicado del LISTADO por semana: no programar dos envíos de la misma zona en la misma semana ISO
        // (misma lista = mismo público). Se saltan las zona×semana ya ocupadas por un envío existente.
        let taken = new Map<string, { zona: string; date: string; week: string; status: string }>();
        try { taken = await scheduledZoneWeeks(); } catch { /* si SendGrid falla, se planea sin el filtro */ }
        const weekOf = (offset: number) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + offset * 7); d.setUTCHours(hourUtc, 0, 0, 0); return d; };

        // Un "envío" = un correo (zona + bloque de máx 3). Cada bloque de la zona toma la SIGUIENTE semana libre.
        const sends = [];
        let shifted = 0;
        for (const d of digests) {
            const chunks: (typeof d.props)[] = [];
            for (let i = 0; i * MAX_PER_MAIL < d.props.length; i++) chunks.push(d.props.slice(i * MAX_PER_MAIL, i * MAX_PER_MAIL + MAX_PER_MAIL));
            let offset = 0;
            for (let ci = 0; ci < chunks.length; ci++) {
                let send = weekOf(offset), wk = isoWeekKey(send);
                while (taken.has(zoneWeekKey(d.zonaName, wk))) { offset++; send = weekOf(offset); wk = isoWeekKey(send); }
                if (offset > ci) shifted++;
                taken.set(zoneWeekKey(d.zonaName, wk), { zona: d.zonaName, date: send.toISOString().slice(0, 10), week: wk, status: 'plan' });
                sends.push({
                    key: `${d.key}#${ci}`, zonaName: d.zonaName, week: offset + 1,
                    sendAt: send.toISOString(), date: send.toISOString().slice(0, 10),
                    count: d.count, props: chunks[ci]
                });
                offset++;
            }
        }
        sends.sort((a, b) => a.week - b.week || b.count - a.count);
        const weeks = sends.reduce((m, s) => Math.max(m, s.week), 0);

        const seen = new Set(digests.flatMap((d) => d.props.map((p) => p.code)));
        const notFound = fresh.filter((c) => !seen.has(c.toUpperCase()) && !seen.has(c));

        return Response.json({
            start: start.toISOString(), hourUtc, sends, notFound, alreadySent,
            nota: `${digests.length} zona(s) · máx ${MAX_PER_MAIL} por correo → ${sends.length} correo(s) en ${weeks} semana(s). Una persona recibe a lo más un correo por semana.${alreadySent.length ? ` ${alreadySent.length} propiedad(es) excluida(s) por ya estar en un envío.` : ''}${shifted ? ` ${shifted} correo(s) recorrido(s) de semana porque esa zona ya tenía envío.` : ''}`
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error planeando el calendario' }, { status: 500 });
    }
}
