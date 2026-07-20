import { buildAudience } from '@/lib/audience';

// Planeador de calendario (Fase 2, paso 1): POST { codes[], start?, hour? }. Arma la base de cada
// propiedad, detecta empalmes y reparte las que se cruzan en SEMANAS distintas (una "tanda" por semana).
// NO toca SendGrid: es solo el plan para que la persona lo revise y apruebe. Reusa la lógica de overlap.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SEP = 0.15;              // ≥15% de correos compartidos → van en semanas distintas
const DEFAULT_HOUR_UTC = 15;   // 09:00 en México (UTC-6, sin horario de verano)

interface Base {
    code: string; title: string; colonia: string | null; ciudad: string | null;
    type: string | null; level: string; count: number; set: Set<string>;
}

// Próximo lunes a partir de `from` (nunca hoy), en UTC.
function nextMonday(from: Date): Date {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const day = d.getUTCDay();                 // 0 domingo … 6 sábado
    const add = ((8 - day) % 7) || 7;          // días hasta el próximo lunes
    d.setUTCDate(d.getUTCDate() + add);
    return d;
}

// % de cruce sobre la base más chica.
function overlapPct(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;
    for (const e of small) if (big.has(e)) shared++;
    return shared / small.size;
}

export async function POST(req: Request) {
    let body: { codes?: string[]; start?: string; hour?: number };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }

    const codes = [...new Set((body.codes || []).map((c) => c.trim()).filter(Boolean))].slice(0, 20);
    if (!codes.length) return Response.json({ error: 'Pasa al menos un código de propiedad' }, { status: 400 });

    const hourUtc = Number.isFinite(body.hour) ? Number(body.hour) : DEFAULT_HOUR_UTC;
    const start = body.start ? new Date(`${body.start}T00:00:00Z`) : nextMonday(new Date());
    if (isNaN(start.getTime())) return Response.json({ error: 'Fecha de inicio inválida' }, { status: 400 });

    try {
        const bases: Base[] = [];
        for (const c of codes) {
            const a = await buildAudience(c);
            if (!a) { bases.push({ code: c, title: `${c} (no encontrada)`, colonia: null, ciudad: null, type: null, level: '-', count: 0, set: new Set() }); continue; }
            bases.push({ code: a.code, title: a.title, colonia: a.colonia, ciudad: a.ciudad, type: a.type, level: a.level, count: a.count, set: new Set(a.rows.map((r) => r.email)) });
        }

        // Greedy: una base entra a una tanda solo si su cruce con TODAS las de esa tanda es < SEP.
        const ordered = bases.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
        const tandas: Base[][] = [];
        for (const b of ordered) {
            const slot = tandas.find((grp) => grp.every((x) => overlapPct(b.set, x.set) < SEP));
            if (slot) slot.push(b); else tandas.push([b]);
        }

        const schedule = tandas.map((grp, i) => {
            const d = new Date(start);
            d.setUTCDate(d.getUTCDate() + i * 7);
            d.setUTCHours(hourUtc, 0, 0, 0);
            const dedup = new Set<string>();
            for (const b of grp) for (const e of b.set) dedup.add(e);
            return {
                tanda: i + 1,
                sendAt: d.toISOString(),
                date: d.toISOString().slice(0, 10),
                totalDedup: dedup.size,
                props: grp.map((b) => ({ code: b.code, title: b.title, colonia: b.colonia, ciudad: b.ciudad, type: b.type, level: b.level, count: b.count }))
            };
        });

        return Response.json({
            start: start.toISOString(),
            hourUtc,
            tandas: schedule,
            notFound: bases.filter((b) => b.count === 0).map((b) => b.code),
            nota: schedule.length <= 1
                ? 'Las bases casi no se cruzan: pueden salir la misma semana.'
                : `Se reparten en ${schedule.length} semanas para que nadie reciba dos correos empalmados.`
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error planeando el calendario' }, { status: 500 });
    }
}
