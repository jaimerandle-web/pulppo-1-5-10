import { listSingleSends, singleSendStats, parseCodesFromName } from '@/lib/marketing';

// Estado de las campañas 1·5·10 en SendGrid (Single Sends que arma este tool, por prefijo de nombre):
// borrador / programado / enviado, con métricas (entregados, aperturas, clics, bajas) para los ya enviados.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
    try {
        const all = await listSingleSends();
        const mine = all.filter((s) => typeof s.name === 'string' && s.name.startsWith('1·5·10'));

        const items = await Promise.all(mine.map(async (s) => {
            const id = String(s.id);
            const sent = s.status === 'triggered' || s.status === 'sent';
            let stats = null;
            if (sent) { try { stats = await singleSendStats(id); } catch { stats = null; } }
            const codes = parseCodesFromName(s.name);
            const name = (s.name || '').replace(/\s*\[[^\]]+\]\s*$/, ''); // ocultar el sufijo de códigos
            return { id, name, codes, status: s.status, send_at: s.send_at ?? null, stats };
        }));

        items.sort((a, b) => String(b.send_at || '').localeCompare(String(a.send_at || '')));
        return Response.json({ items });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error leyendo los envíos' }, { status: 500 });
    }
}
