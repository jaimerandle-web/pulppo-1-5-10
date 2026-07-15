import { buildAudience } from '@/lib/audience';

// Solapamiento entre bases: POST { codes: string[] }. Arma la base de cada propiedad y mide cuántos
// correos comparten, para calendarizar. Alto cruce → separar en semanas distintas; bajo → mismo día OK.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SEP = 0.15;   // ≥15% de cruce (sobre la base más chica) → recomendar semanas distintas

export async function POST(req: Request) {
    let body: { codes?: string[] };
    try { body = await req.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }
    const codes = [...new Set((body.codes || []).map((c) => c.trim()).filter(Boolean))].slice(0, 20);
    if (codes.length < 2) return Response.json({ error: 'Pasa al menos 2 códigos de propiedad' }, { status: 400 });

    try {
        // Base de cada propiedad → set de emails.
        const bases: { code: string; label: string; set: Set<string>; count: number }[] = [];
        for (const c of codes) {
            const a = await buildAudience(c);
            if (!a) { bases.push({ code: c, label: `${c} (no encontrada)`, set: new Set(), count: 0 }); continue; }
            bases.push({ code: a.code, label: `${a.code} · ${a.colonia ?? a.ciudad ?? ''} · ${a.type ?? ''}`.trim(), set: new Set(a.rows.map((r) => r.email)), count: a.count });
        }

        // Cruce por pares.
        const pairs: { a: string; b: string; shared: number; pct: number; verdict: 'mismo-dia' | 'moderado' | 'separar' }[] = [];
        for (let i = 0; i < bases.length; i++) {
            for (let j = i + 1; j < bases.length; j++) {
                const A = bases[i], B = bases[j];
                if (!A.set.size || !B.set.size) continue;
                let shared = 0;
                const [small, big] = A.set.size <= B.set.size ? [A.set, B.set] : [B.set, A.set];
                for (const e of small) if (big.has(e)) shared++;
                const pct = shared / small.size;
                const verdict = pct >= SEP ? 'separar' : pct >= 0.05 ? 'moderado' : 'mismo-dia';
                pairs.push({ a: A.code, b: B.code, shared, pct: Math.round(pct * 1000) / 10, verdict });
            }
        }

        // Agrupar por "día de envío": greedy, dos bases van juntas solo si su cruce < SEP con TODAS las del grupo.
        const over = new Map<string, number>();
        for (const p of pairs) over.set(`${p.a}|${p.b}`, p.pct / 100);
        const pxy = (x: string, y: string) => over.get(`${x}|${y}`) ?? over.get(`${y}|${x}`) ?? 0;
        const ordered = [...bases].filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
        const days: string[][] = [];
        for (const b of ordered) {
            const slot = days.find((grp) => grp.every((c) => pxy(b.code, c) < SEP));
            if (slot) slot.push(b.code); else days.push([b.code]);
        }

        return Response.json({
            bases: bases.map((b) => ({ code: b.code, label: b.label, count: b.count })),
            pairs: pairs.sort((a, b) => b.pct - a.pct),
            days,
            nota: days.length === 1
                ? 'Las bases casi no se cruzan: se pueden enviar el mismo día.'
                : `Se recomiendan ${days.length} tandas para no repetir destinatarios en la misma semana.`
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error calculando solapamiento';
        return Response.json({ error: msg }, { status: 500 });
    }
}
