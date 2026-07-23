import { fetchCampaignPerf } from '@/lib/campaigns';
import { listSingleSends, singleSendStats } from '@/lib/marketing';
import type { CampaignPayload, SendItem } from '@/types';

// Desempeño de campañas: leads atribuidos (Mongo) + engagement real de los envíos (SendGrid).
// Cache en memoria 10 min (mismo criterio que /api/data). ?refresh=1 fuerza el pull.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let cache: { data: CampaignPayload; ts: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

// Engagement de los Single Sends 1·5·10 (por prefijo de nombre). SendGrid puede fallar (sin key/scope):
// en ese caso devolvemos sends=[] + el mensaje, sin tumbar el resto de la pestaña.
async function loadSends(): Promise<{ sends: SendItem[]; sendsError: string | null }> {
    try {
        const all = await listSingleSends();
        const mine = all.filter((s) => typeof s.name === 'string' && s.name.startsWith('1·5·10'));
        const sends = await Promise.all(mine.map(async (s): Promise<SendItem> => {
            const id = String(s.id);
            const sent = s.status === 'triggered' || s.status === 'sent';
            let stats = null;
            if (sent) { try { stats = await singleSendStats(id); } catch { stats = null; } }
            return { id, name: s.name ?? null, status: s.status ?? null, send_at: s.send_at ?? null, stats };
        }));
        sends.sort((a, b) => String(b.send_at || '').localeCompare(String(a.send_at || '')));
        return { sends, sendsError: null };
    } catch (e) {
        return { sends: [], sendsError: e instanceof Error ? e.message : 'Error leyendo SendGrid' };
    }
}

export async function GET(req: Request) {
    const force = new URL(req.url).searchParams.get('refresh') === '1';
    if (!force && cache && Date.now() - cache.ts < TTL_MS) {
        return Response.json(cache.data);
    }
    try {
        const [perf, sg] = await Promise.all([fetchCampaignPerf(), loadSends()]);
        const data: CampaignPayload = { perf, sends: sg.sends, sendsError: sg.sendsError };
        cache = { data, ts: Date.now() };
        return Response.json(data);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error consultando el desempeño de campañas';
        return Response.json({ error: msg }, { status: 500 });
    }
}
