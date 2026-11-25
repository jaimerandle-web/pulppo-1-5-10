import { desempenoMeta } from '@/lib/pauta/desempeno';

// Meta vs CRM por campaña B2C y mes (lib/pauta/desempeno.ts). Detrás del middleware, con el mismo acceso que /pauta.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
    try {
        return Response.json(await desempenoMeta());
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error cruzando Meta con el CRM' }, { status: 500 });
    }
}
