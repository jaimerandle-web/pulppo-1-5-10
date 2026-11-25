// Foto de Meta para la pestaña «Meta vs CRM» de /1-5-10/pauta (src/lib/pauta/metaFoto.json).
// Mientras Vercel no tenga META_ACCESS_TOKEN, la página lee esta foto; con el token en Vercel la
// pide en vivo y esta foto queda sólo de respaldo.
//
//   node scripts/meta_snapshot.mjs [ruta_del_token]
//
// Token: META_ACCESS_TOKEN o el archivo (default ~/pulppo-automation/creds/meta_token.txt).
// Sólo lectura (ads_read). Guarda las filas tal cual las da Graph: el parseo vive en lib/pauta/meta.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CUENTA = 'act_352522417013101';
const DESDE = '2026-08-01';
const token = process.env.META_ACCESS_TOKEN
    || readFileSync(process.argv[2] || join(homedir(), 'pulppo-automation/creds/meta_token.txt'), 'utf8').trim();

async function todo(url) {
    const out = [];
    for (let u = url; u;) {
        const r = await fetch(u);
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        out.push(...j.data);
        u = j.paging?.next;
    }
    return out;
}

const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
const q = (p) => `https://graph.facebook.com/v21.0/${CUENTA}/${p}&access_token=${encodeURIComponent(token)}`;
const insights = await todo(q(`insights?level=campaign&time_increment=monthly&limit=500`
    + `&time_range=${encodeURIComponent(JSON.stringify({ since: DESDE, until: hoy }))}`
    + `&fields=campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions`));
const campanas = await todo(q('campaigns?limit=500&fields=id,name,effective_status'));

const salida = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/pauta/metaFoto.json');
writeFileSync(salida, JSON.stringify({
    generado: new Date().toISOString(),
    desde: DESDE,
    insights,
    estados: Object.fromEntries(campanas.map((c) => [c.id, c.effective_status]))
}, null, 1) + '\n');
console.log(`${insights.length} filas campaña×mes, ${campanas.length} campañas → ${salida}`);
