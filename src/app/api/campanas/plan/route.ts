import { buildAudience } from '@/lib/audience';

// Planeador de calendario (Fase 2, paso 1): POST { codes[], start?, hour? }. Arma la base de cada
// propiedad y reparte en SEMANAS de forma que cada propiedad llegue a TODA su base (no se parte la
// audiencia) SIN que nadie reciba dos la misma semana: dos propiedades comparten semana solo si sus
// bases son DISJUNTAS (no comparten ni una persona). Coloreo greedy. NO toca SendGrid.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

// ¿Las dos bases no comparten NI UNA persona? (recorre la más chica).
function disjoint(a: Set<string>, b: Set<string>): boolean {
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const e of small) if (big.has(e)) return false;
    return true;
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

        // Coloreo greedy: una base entra a una semana solo si es DISJUNTA con TODAS las de esa semana.
        // Así nadie recibe dos correos la misma semana y cada propiedad conserva su base completa. Base
        // más grande primero (heurística estándar de coloreo).
        const ordered = bases.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
        const tandas: Base[][] = [];
        for (const b of ordered) {
            const slot = tandas.find((grp) => grp.every((x) => disjoint(b.set, x.set)));
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
                ? 'Ninguna comparte público: pueden salir la misma semana con su base completa.'
                : `Se reparten en ${schedule.length} semanas para que cada propiedad llegue a TODA su base sin que nadie reciba dos la misma semana.`
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error planeando el calendario' }, { status: 500 });
    }
}
