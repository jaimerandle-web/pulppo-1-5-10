// Ficha de desempeño por propiedad (port de gen_ficha.py). Render server-side de una hoja
// imprimible on-brand con salud del anuncio, funnel, mercado/competencia y plan de acción.
import { ObjectId, type Document } from 'mongodb';
import { getDb, classifySource } from './data';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';

const CATLBL: Record<string, string> = {
    HOME_COMBO: 'Super destacado', HOME_COMBO_ZONA_DEMAND: 'Super destacado Zona Demand',
    DESTACADO_COMBO: 'Destacado', DESTACADO_COMBO_ZONA_DEMAND: 'Destacado Zona Demand',
    SIMPLE_COMBO: 'Simple', OFFLINE: 'Offline'
};
const MLLBL: Record<string, string> = {
    gold_premium: 'Oro Premium', gold_pro: 'Oro Pro', gold: 'Oro', silver: 'Plata', bronze: 'Bronce', free: 'Gratuito'
};
const SUPER = new Set(['HOME_COMBO', 'HOME_COMBO_ZONA_DEMAND']);
const ADVANCED = new Set(['offer', 'offer_blocked', 'contract', 'paying', 'closed']);

const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let x: unknown = d;
    for (const k of ks) x = x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined;
    return x;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const strip = (s: string) => s.replace(/\b(fracc\.?|fraccionamiento|colonia|col\.?|residencial|barrio|pueblo)\b/gi, '').trim();

interface Comp { precio: number | null; m2: number | null; ppm2: number | null; rec: number | null; ban: number | null; zona: string | null; url: string | null; src: string }

export async function renderFicha(id: string): Promise<{ code: string; html: string } | null> {
    let oid: ObjectId;
    try { oid = new ObjectId(id); } catch { return null; }
    const db = await getDb();
    const P = await db.collection('properties').findOne({ _id: oid });
    if (!P) return null;
    const now = Date.now();

    const val = num(dig(P, 'listing', 'value'));
    const m2 = num(dig(P, 'attributes', 'totalSurface')) ?? num(dig(P, 'attributes', 'surface'));
    const acm = num(dig(P, 'acm', 'price', 'value'));
    const col = (dig(P, 'address', 'neighborhood', 'name') as string) ?? null;
    const city = (dig(P, 'address', 'city', 'name') as string) ?? null;
    const state = (dig(P, 'address', 'state', 'name') as string) ?? null;
    const typ = (P.type as string) ?? null;
    const ppm2 = val && m2 ? val / m2 : null;
    const code = (P.internalId as string) ?? id;
    const broker = [dig(P, 'agent', 'firstName'), dig(P, 'agent', 'lastName')].filter(Boolean).map(String).join(' ').trim();
    const cat = (dig(P, 'portals', 'inmuebles24', 'type') as string) ?? null;
    const mlt = (dig(P, 'portals', 'mercadolibre', 'type') as string) ?? null;
    const catLbl = cat ? (CATLBL[cat] ?? cat) : '—';
    const mlLbl = mlt ? (MLLBL[mlt] ?? mlt.replace(/_/g, ' ')) : '—';
    const q = num(dig(P, 'portals', 'inmuebles24', 'quality'));
    const i24Status = dig(P, 'portals', 'inmuebles24', 'status') as string | null;
    const mlStatus = dig(P, 'portals', 'mercadolibre', 'status') as string | null;
    const dval = acm && val ? ((val - acm) / acm) * 100 : null;
    const title = (dig(P, 'listing', 'title') as string) ?? '';
    const desc = (dig(P, 'listing', 'extra', 'description') as string) ?? '';
    const words = desc.trim() ? desc.trim().split(/\s+/).length : 0;
    const zonaOk = !!(col && strip(col) && strip(col).split(/\s+/).some((w) => w.length > 3 && title.toLowerCase().includes(w.toLowerCase())));
    const tipoOk = !!(typ && title.toLowerCase().includes(typ.toLowerCase()));
    const opOk = /venta|renta/i.test(title);
    const pics = ((P.pictures as Document[]) || []).filter((x) => x.public !== false).length;
    const video = Boolean((P.videos as unknown[])?.length) || Boolean(dig(P, 'marketing', 'Video', 'videoUrl'));
    const tour = Boolean(P.virtualTour);
    const pub = P.publishedAt instanceof Date ? (P.publishedAt as Date) : null;
    const meses = pub ? Math.floor((now - pub.getTime()) / (30.44 * 86400000)) : null;

    // leads (con fuente, contacto y fecha)
    const leads = await db.collection('leads').find({ 'property._id': oid }, { projection: { source: 1, 'contact._id': 1, createdAt: 1 } }).toArray();
    const within = (days: number) => leads.filter((l) => l.createdAt instanceof Date && now - (l.createdAt as Date).getTime() <= days * 86400000).length;
    const l30 = within(30), l90 = within(90);
    const fuentes = new Map<string, number>();
    for (const l of leads) { const c = classifySource(l.source as string); fuentes.set(c, (fuentes.get(c) || 0) + 1); }
    const fuenteRows = [...fuentes.entries()].sort((a, b) => b[1] - a[1]);
    // asesor vs cliente vía contacts.role / tags
    const cids: ObjectId[] = [];
    for (const l of leads) { const c = dig(l, 'contact', '_id'); if (c) { try { cids.push(new ObjectId(String(c))); } catch { /* ignora */ } } }
    const asesorSet = new Set<string>();
    if (cids.length) {
        const cs = await db.collection('contacts').find({ _id: { $in: cids } }, { projection: { role: 1, tags: 1 } }).toArray();
        for (const c of cs) {
            const role = c.role as string;
            const tags = ((c.tags as string[]) || []).join(' ');
            if (role === 'asesor inmobiliaria' || role === 'asesor independiente' || /broker/i.test(tags)) asesorSet.add(String(c._id));
        }
    }
    const asesor = leads.filter((l) => asesorSet.has(String(dig(l, 'contact', '_id')))).length;
    const cliente = leads.length - asesor;

    const vis = await db.collection('visits').countDocuments({ 'steps.property._id': oid, 'status.last': { $ne: 'cancelled' } });
    const ofertas = await db.collection('operations').countDocuments({ 'property._id': oid, 'status.last': { $in: [...ADVANCED] } });

    // cierres reales de la comunidad (mismo tipo), ampliando colonia→ciudad→estado hasta n>=5
    const cierres = async (geo: Document): Promise<number[]> => {
        const ps = await db.collection('properties').aggregate([
            { $match: { 'status.last': 'completed', type: typ, ...geo } },
            { $lookup: { from: 'operations', localField: '_id', foreignField: 'property._id', as: 'op' } },
            { $limit: 400 }
        ]).toArray();
        const out: number[] = [];
        for (const p of ps) for (const o of (p.op as Document[]) || []) { const v = num(dig(o, 'closeValue', 'value')); if (v) out.push(v); }
        return out;
    };
    let scope = col ?? '', cz = col ? await cierres({ 'address.neighborhood.name': col }) : [];
    if (cz.length < 5 && city) { scope = city; cz = await cierres({ 'address.city.name': city }); }
    if (cz.length < 5 && state) { scope = state; cz = await cierres({ 'address.state.name': state }); }

    // comparables vivos + "qué te alcanza" (todos con link al aviso)
    const fetchLive = async (geo: Document): Promise<Document[]> =>
        db.collection('properties').find(
            { 'status.last': 'published', 'listing.operation': 'sale', type: typ, ...geo, _id: { $ne: oid }, 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } },
            { projection: { 'listing.value': 1, attributes: 1, 'address.neighborhood.name': 1, 'address.city.name': 1 }, limit: 200 }
        ).toArray();
    const toComp = (e: Document): Comp => {
        const ev = num(dig(e, 'listing', 'value')), em = num(dig(e, 'attributes', 'totalSurface'));
        return { precio: ev, m2: em, ppm2: ev && em ? ev / em : null, rec: num(dig(e, 'attributes', 'suites')), ban: num(dig(e, 'attributes', 'bathrooms')), zona: (dig(e, 'address', 'neighborhood', 'name') as string) ?? (dig(e, 'address', 'city', 'name') as string) ?? null, url: `https://pulppo.com/propiedades/${String(e._id)}`, src: 'Pulppo' };
    };
    let pool = city ? await fetchLive({ 'address.city.name': city }) : [];
    if (pool.length < 3 && state) pool = await fetchLive({ 'address.state.name': state });
    const poolC = pool.map(toComp);
    // "Qué te alcanza" también contra el mercado (MLS): solo publicados, con link al portal (import.url).
    const fetchMls = async (geo: Document): Promise<Comp[]> => {
        const rows = await db.collection('mls').find(
            { 'listing.operation': 'sale', type: typ, 'status.last': 'published', ...geo, 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } },
            { projection: { 'listing.value': 1, attributes: 1, 'address.neighborhood.name': 1, 'address.city.name': 1, 'import.url': 1 }, limit: 250 }
        ).toArray();
        return rows.map((e) => {
            const ev = num(dig(e, 'listing', 'value')), em = num(dig(e, 'attributes', 'totalSurface'));
            return { precio: ev, m2: em, ppm2: ev && em ? ev / em : null, rec: num(dig(e, 'attributes', 'suites')), ban: num(dig(e, 'attributes', 'bathrooms')), zona: (dig(e, 'address', 'neighborhood', 'name') as string) ?? (dig(e, 'address', 'city', 'name') as string) ?? null, url: (dig(e, 'import', 'url') as string) ?? null, src: 'MLS' };
        });
    };
    let mls = city ? await fetchMls({ 'address.city.name': city }) : [];
    if (mls.length < 3 && state) mls = await fetchMls({ 'address.state.name': state });
    const alcPool = [...poolC, ...mls]; // Pulppo + mercado, para "qué te alcanza"
    const dist = (c: Comp) => (val && c.precio ? Math.abs(c.precio - val) / val : 0) + (m2 && c.m2 ? Math.abs(c.m2 - m2) / m2 : 0);
    const comps = [...poolC].sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    const alcPrecio = val ? alcPool.filter((c) => c.precio && c.precio >= 0.9 * val && c.precio <= 1.1 * val).sort((a, b) => Math.abs((a.precio as number) - val) - Math.abs((b.precio as number) - val)).slice(0, 6) : [];
    const alcPpm2 = ppm2 ? alcPool.filter((c) => c.ppm2 && c.ppm2 >= 0.85 * ppm2 && c.ppm2 <= 1.15 * ppm2).sort((a, b) => Math.abs((a.ppm2 as number) - ppm2) - Math.abs((b.ppm2 as number) - ppm2)).slice(0, 6) : [];
    const compPpm = comps.map((c) => c.ppm2).filter((x): x is number => x != null);
    const avgPpm = compPpm.length ? compPpm.reduce((a, b) => a + b, 0) / compPpm.length : null;
    const zonaComp = col ? await db.collection('properties').countDocuments({ 'status.last': 'published', 'listing.operation': 'sale', type: typ, 'address.neighborhood.name': col, _id: { $ne: oid } }) : 0;

    // ---- Insights de la zona: demanda (búsquedas 6m) vs oferta (mercado MLS). Colonia→ciudad; se oculta si es flaca. ----
    const SIX = new Date(now - 182 * 86400000);
    const nid = (dig(P, 'address', 'neighborhood', 'id') as string) ?? null;
    const cityId = (dig(P, 'address', 'city', 'id') as string) ?? null;
    const zoneStats = async (demField: string, demVal: string, ofeField: string, ofeVal: string) => {
        const [dem, ofe] = await Promise.all([
            db.collection('searches').countDocuments({ [demField]: demVal, createdAt: { $gte: SIX } }),
            db.collection('mls').countDocuments({ 'listing.operation': 'sale', type: typ, 'status.last': 'published', [ofeField]: ofeVal })
        ]);
        return { dem, ofe };
    };
    let zonaLbl: string | null = null, zdem = 0, zofe = 0;
    if (col && nid) { const s = await zoneStats('filters.addresses.neighborhood.name', col, 'address.neighborhood.id', nid); if (s.dem >= 15 && s.ofe >= 3) { zonaLbl = col; zdem = s.dem; zofe = s.ofe; } }
    if (!zonaLbl && city && cityId) { const s = await zoneStats('filters.addresses.city.name', city, 'address.city.id', cityId); if (s.dem >= 15 && s.ofe >= 3) { zonaLbl = city; zdem = s.dem; zofe = s.ofe; } }
    const zratio = zofe ? zdem / zofe : 0;
    const zppms = [...mls, ...poolC].map((c) => c.ppm2).filter((x): x is number => x != null);
    const zoneMed = zppms.length ? median(zppms) : null;
    let zread = '';
    if (zonaLbl) {
        if (zratio >= 1) zread = 'Alta demanda y oferta limitada: buen momento para vender, debería moverse rápido.';
        else if (zratio >= 0.3) zread = 'Demanda y oferta equilibradas: cuida precio y calidad del anuncio para destacar.';
        else zread = 'Oferta amplia frente a la demanda: diferénciate en precio o multimedia para acelerar la venta.';
        if (zoneMed && ppm2) zread += ` Tu $/m² (${money(ppm2)}) está ${Math.abs(Math.round((ppm2 / zoneMed - 1) * 100))}% ${ppm2 >= zoneMed ? 'arriba' : 'abajo'} de la mediana de la zona.`;
    }

    // insights + plan de acción
    const insights: string[] = [
        `${leads.length} leads históricos · ${cliente} de clientes directos (${Math.round((100 * cliente) / Math.max(leads.length, 1))}%) y ${asesor} de asesores.`,
        `Actividad reciente: ${l30} leads en los últimos 30 días, ${l90} en los últimos 90.`,
        `Fuentes principales: ${fuenteRows.slice(0, 2).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}.`
    ];
    if (dval != null && dval < 0) insights.push(`Precio ${Math.abs(dval).toFixed(0)}% por debajo del estimado (${money(acm)}).`);

    const conv = leads.length ? (100 * vis) / leads.length : 0;
    const cand: [number, string][] = [];
    if (!zonaOk || !tipoOk || !opOk) {
        const falta = [['tipo', tipoOk], ['operación', opOk], ['zona', zonaOk]].filter(([, ok]) => !ok).map(([x]) => x).join(', ');
        cand.push([1, `Corregir el título: debe incluir tipo, operación y zona (falta ${falta}).`]);
    }
    if (leads.length && conv < 15) cand.push([2, `Empujar visitas: solo ${vis} de ${leads.length} leads agendaron (${conv.toFixed(0)}%). Reforzar 1ª respuesta y seguimiento.`]);
    if (dval != null && dval > 10) cand.push([3, `Precio ${dval.toFixed(0)}% por encima del estimado: ajuste moderado a la baja hacia ${money(acm)} (usar ACM como palanca).`]);
    if (ppm2 && avgPpm && ppm2 > avgPpm * 1.1) cand.push([3, `Tu $/m² (${money(ppm2)}) está ${Math.round((ppm2 / avgPpm - 1) * 100)}% arriba del promedio de comparables (${money(avgPpm)}): considerar ajuste a la baja.`]);
    if (meses != null && meses >= 6 && ofertas === 0) {
        if (dval != null && dval <= 0) cand.push([4, `${meses} meses publicada, precio competitivo y sin ofertas: el freno no es precio. Revisar difusión/geolocalización, republicar para refrescar ranking y validar seguimiento.`]);
        else cand.push([4, `${meses} meses publicada sin ofertas: probable precio fuera de mercado. Usar ACM y cierres de la zona como palanca con el propietario.`]);
    }
    if (vis >= 3 && ofertas === 0) cand.push([5, 'Visitas sin ofertas: reforzar seguimiento post-visita y manejo de objeciones; acordar precio con el propietario antes de mostrar.']);
    if (!SUPER.has(cat ?? '')) cand.push([6, 'Subir el anuncio a Super destacado para más exposición.']);
    if (q != null && q < 85) cand.push([7, `Mejorar la calidad del anuncio (${q.toFixed(0)}/100): i24 penaliza en ranking los anuncios incompletos.`]);
    if (words > 200) cand.push([8, 'Descripción muy larga: simplificar para no confundir al comprador.']);
    if (pics < 12) cand.push([9, `Subir más fotos: hay ${pics}, se recomiendan 12+.`]);
    if (!video) cand.push([9, 'Agregar video de la propiedad.']);
    if ((i24Status && i24Status !== 'ONLINE') || (mlStatus && mlStatus.toUpperCase() !== 'ONLINE')) cand.push([10, `Verificar difusión: i24 ${i24Status || '—'} · ML ${mlStatus || '—'}. Reactivar portales apagados.`]);
    if (zonaComp >= 20) cand.push([11, `Alta competencia en la zona (${zonaComp} publicadas del mismo tipo): diferenciar con mejor multimedia o precio.`]);
    const plan = cand.sort((a, b) => a[0] - b[0]).slice(0, 6).map(([, t]) => t);
    if (!plan.length) plan.push('Anuncio saludable. Mantener seguimiento de leads y visitas.');

    // ---------- HTML ----------
    const dot = (s: 'ok' | 'warn' | 'bad' | 'na') => `<span class="dt" style="background:${{ ok: SEA, warn: YEL, bad: RED, na: GRY }[s]}"></span>`;
    const rowH = (lbl: string, v: string, s: 'ok' | 'warn' | 'bad' | 'na', note = '') => `<div class="srow">${dot(s)}<span class="slbl">${lbl}</span><span class="sval">${v}</span><span class="snote">${note}</span></div>`;
    let vstat: 'ok' | 'warn' | 'bad' | 'na' = 'na', vnote = '';
    if (dval == null) { vstat = 'na'; } else if (dval <= 0) { vstat = 'ok'; vnote = 'por debajo del mercado'; } else if (dval <= 10) { vstat = 'warn'; vnote = 'ligeramente por encima'; } else { vstat = 'bad'; vnote = 'por encima del mercado'; }
    const mm = `${pics} fotos · video ${video ? '✓' : '—'} · tour ${tour ? '✓' : '—'}`;
    const tcheck = `tipo ${tipoOk ? '✓' : '✗'} · operación ${opOk ? '✓' : '✗'} · zona ${zonaOk ? '✓' : '✗'}`;
    const health = [
        rowH('Calidad del anuncio', q != null ? `${q.toFixed(0)}/100` : '—', q != null && q >= 85 ? 'ok' : 'warn'),
        rowH('Valuación', `${money(val)} vs estimado ${money(acm)}`, vstat, (dval != null ? `${dval >= 0 ? '+' : ''}${dval.toFixed(0)}% · ` : '') + vnote),
        rowH('Título', esc(title.slice(0, 60)) || '—', tipoOk && opOk && zonaOk ? 'ok' : 'warn', tcheck),
        rowH('Descripción', `${words} palabras`, words >= 40 && words <= 200 ? 'ok' : 'warn', words >= 40 && words <= 200 ? 'longitud adecuada' : 'revisar extensión'),
        rowH('Ubicación', 'completa', 'ok', ''),
        rowH('Multimedia', mm, pics >= 12 && video ? 'ok' : 'warn'),
        rowH('Categoría del anuncio', `${catLbl} · ${mlLbl}`, SUPER.has(cat ?? '') ? 'ok' : 'warn')
    ].join('');

    const tv = leads.length ? vis / leads.length : 0;
    const to = vis ? ofertas / vis : 0;
    const vcolor = tv >= 0.2 ? SEA : tv >= 0.1 ? YEL : RED;
    const vtxt = tv >= 0.2 ? '¡wow!' : tv >= 0.1 ? 'tasa ok' : 'tasa baja';
    const fstage = (lbl: string, n: number, w: number, inside = '') => `<div class="fstage"><span class="fslbl">${lbl}</span><span class="fstrack"><span class="fsbar" style="width:${Math.max(w, 0.6)}%"></span>${inside}</span><span class="fsn">${n}</span></div>`;
    const convInline = `<span class="fconvinline"><b style="color:${vcolor}">${(tv * 100).toFixed(0)}%</b> · ${vtxt}</span>`;
    const funnel = fstage('Leads', leads.length, 100) + fstage('Visitas', vis, (100 * vis) / Math.max(leads.length, 1), convInline) + fstage('Ofertas', ofertas, (100 * ofertas) / Math.max(leads.length, 1));
    const maxF = Math.max(1, ...fuenteRows.map(([, v]) => v));
    const fuenteHtml = fuenteRows.map(([k, v]) => `<div class="frow"><span>${k}</span><span class="fbarwrap"><span class="fbar" style="width:${Math.round((100 * v) / maxF)}%"></span></span><span class="fn">${v}</span></div>`).join('');
    const compTbl = (rows: Comp[]) => {
        if (!rows.length) return '<tr><td colspan="5" style="color:#B7B7B7">Sin resultados en el rango.</td></tr>';
        const zc = (r: Comp) => {
            const z = esc(String(r.zona ?? '—').slice(0, 24));
            const tag = r.src === 'MLS' ? ` <span style="color:${GRY};font-size:8px">MLS</span>` : '';
            return (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer" style="color:${SEA}">${z}</a>` : z) + tag;
        };
        return rows.map((r) => `<tr><td>${zc(r)}</td><td class="nw">${money(r.precio)}</td><td class="nw">${r.m2 ?? '—'} m²</td><td class="nw">${r.ppm2 ? money(r.ppm2) + '/m²' : '—'}</td><td class="nw">${r.rec ?? '—'} rec<br>${r.ban ?? '—'} baños</td></tr>`).join('');
    };
    const czTxt = cz.length ? `${cz.length} cierres · mediana ${money(median(cz))} · rango ${money(Math.min(...cz))}–${money(Math.max(...cz))}` : 'sin cierres registrados';
    const opTxt = dig(P, 'listing', 'operation') === 'sale' ? 'Venta' : (dig(P, 'listing', 'operation') as string) ?? '';

    const html = `
<style>
.ficha-root{width:816px;margin:0 auto;background:#fff;padding:40px 44px;color:${BLK};font-family:'Nunito Sans',sans-serif;font-size:12px;line-height:1.45;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ficha-root *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ficha-root .dt{display:inline-block;width:8px;height:8px;margin-right:6px;vertical-align:middle}
.ficha-root h1{font-family:'EB Garamond',serif;font-weight:400;font-size:34px;line-height:1;margin:0}
.ficha-root .eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${GRY}}
.ficha-root .accent{width:50px;height:1px;background:${YEL};margin:8px 0 14px}
.ficha-root .header{background:${BLK};color:#fff;padding:22px 30px 26px;display:flex;justify-content:space-between;align-items:flex-start}
.ficha-root .header .sub{font-size:13px;color:#dcdcdc;margin-top:8px}.ficha-root .header .price{font-size:22px;margin-top:12px}
.ficha-root .plogo{height:32px}
.ficha-root .tag{display:inline-block;border:1px solid #4a4c4b;color:#eee;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;margin:12px 6px 0 0}
.ficha-root .sec{margin-top:24px}.ficha-root .grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.ficha-root .srow{display:flex;align-items:baseline;padding:6px 0;border-bottom:1px solid ${LGT}}
.ficha-root .slbl{width:150px}.ficha-root .sval{flex:1;font-weight:700}.ficha-root .snote{color:${GRY};font-size:11px;text-align:right;max-width:210px}
.ficha-root .fstage{display:flex;align-items:center;margin:6px 0}.ficha-root .fslbl{width:60px;font-weight:700}
.ficha-root .fstrack{position:relative;width:180px;background:${LGT};height:18px}.ficha-root .fsbar{position:absolute;left:0;top:0;height:18px;background:${SEA}}
.ficha-root .fsn{width:22px;text-align:right;font-weight:700;margin:0 8px}
.ficha-root .fconvinline{position:absolute;right:6px;top:0;height:18px;display:flex;align-items:center;font-size:10px;color:${BLK};white-space:nowrap}
.ficha-root .recap{display:flex;gap:20px;margin-top:14px}.ficha-root .recap .n{font-family:'EB Garamond',serif;font-size:22px}.ficha-root .recap .l{font-size:9px;color:${GRY};text-transform:uppercase;letter-spacing:.05em}
.ficha-root .frow{display:flex;align-items:center;font-size:11px;margin:3px 0}.ficha-root .frow span:first-child{width:96px}
.ficha-root .fbarwrap{flex:1;background:${LGT};height:9px;margin:0 8px}.ficha-root .fbar{display:block;height:9px;background:${BLK}}.ficha-root .fn{width:20px;text-align:right;font-weight:700}
.ficha-root .split{display:flex;height:24px;margin-top:6px;font-size:11px;color:#fff}.ficha-root .split .a,.ficha-root .split .c{display:flex;align-items:center;padding:0 8px;white-space:nowrap;overflow:hidden}.ficha-root .split .a{background:${BLK}}.ficha-root .split .c{background:${SEA}}
.ficha-root table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}.ficha-root th,.ficha-root td{text-align:left;padding:5px 6px;border-bottom:1px solid ${LGT};vertical-align:top}
.ficha-root td.nw{white-space:nowrap}.ficha-root th{font-weight:700;color:${GRY};text-transform:uppercase;font-size:9px;letter-spacing:.06em}
.ficha-root .kpi{display:flex;gap:24px;margin-top:4px}.ficha-root .kpi .n{font-family:'EB Garamond',serif;font-size:26px}.ficha-root .kpi .l{font-size:10px;color:${GRY};text-transform:uppercase;letter-spacing:.06em}
.ficha-root ul{margin-left:16px;list-style:disc}.ficha-root li{margin:4px 0;list-style:disc}.ficha-root .two{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:8px}.ficha-root .box{background:${LGT};padding:16px 18px}
.ficha-root .foot{margin-top:22px;border-top:1px solid ${LGT};padding-top:8px;font-size:9px;color:${GRY}}
@media print{.ficha-root{margin:0;padding:24px 30px}.fx-noprint{display:none!important}@page{size:Letter;margin:0}}
</style>
<div class="ficha-root">
  <div class="header"><div>
    <div class="eyebrow" style="color:${YEL}">Ficha de desempeño</div>
    <h1>${esc(code)}</h1>
    <div class="sub">${esc(typ)} · ${esc(opTxt)} · ${esc(col)}, ${esc(city)}</div>
    <div class="price">${money(val)} · ${m2 ?? '—'} m² · ${money(ppm2)}/m²</div>
    <div>${broker ? `<span class="tag">${esc(broker)}</span>` : ''}<span class="tag">${esc(dig(P, 'company', 'name'))}</span><span class="tag">${catLbl}</span><span class="tag">Publicada ${pub ? pub.toISOString().slice(0, 10) : '—'}${meses != null ? ` (${meses} meses)` : ''}</span></div>
  </div>
  <img class="plogo" src="/pulppo-blanco.png" alt="Pulppo"></div>

  <div class="sec"><div class="eyebrow">Salud del anuncio</div><div class="accent"></div>${health}</div>

  <div class="sec"><div class="eyebrow">Demanda y funnel</div><div class="accent"></div>
    <div class="grid2">
      <div>${funnel}
        <div class="recap"><div><div class="n">${l30}</div><div class="l">leads · 30 días</div></div><div><div class="n">${l90}</div><div class="l">leads · 90 días</div></div><div><div class="n">${leads.length}</div><div class="l">leads · histórico</div></div></div>
      </div>
      <div><div class="eyebrow" style="margin-bottom:6px;color:${BLK}">Leads por fuente</div>${fuenteHtml}</div>
    </div>
    <div style="margin-top:16px;color:${BLK}" class="eyebrow">Leads: asesores vs. clientes</div>
    <div class="split"><div class="a" style="width:${Math.round((100 * asesor) / Math.max(leads.length, 1))}%">${asesor} asesores</div><div class="c" style="width:${Math.round((100 * cliente) / Math.max(leads.length, 1))}%">${cliente} clientes</div></div>
  </div>

  <div class="sec"><div class="eyebrow">Mercado y competencia</div><div class="accent"></div>
    <div class="kpi"><div><div class="n">${money(ppm2)}</div><div class="l">$/m² de esta propiedad</div></div><div><div class="n">${comps.length}</div><div class="l">comparables en zona</div></div></div>
    <div style="margin-top:6px;font-size:11px;color:${GRY}">Cierres reales de la comunidad (${esc(typ)} · ${esc(scope)}): ${czTxt}</div>
    <div style="margin-top:10px"><div class="eyebrow" style="color:${BLK}">Con qué compite en la zona</div>
      <table><tr><th>Ubicación</th><th>Precio</th><th>Sup.</th><th>$/m²</th><th>Rec/Baños</th></tr>${compTbl(comps)}</table></div>
    <div class="two">
      <div><div class="eyebrow" style="margin:12px 0 2px;color:${BLK}">Qué te alcanza por el mismo presupuesto</div>
        <table><tr><th>Zona</th><th>Precio</th><th>Sup.</th><th>$/m²</th><th>Rec/Baños</th></tr>${compTbl(alcPrecio)}</table></div>
      <div><div class="eyebrow" style="margin:12px 0 2px;color:${BLK}">Qué te alcanza por $/m² similar</div>
        <table><tr><th>Zona</th><th>Precio</th><th>Sup.</th><th>$/m²</th><th>Rec/Baños</th></tr>${compTbl(alcPpm2)}</table></div>
    </div>
  </div>

  ${zonaLbl ? `<div class="sec"><div class="eyebrow">Insights de la zona · ${esc(zonaLbl)}</div><div class="accent"></div>
    <div class="kpi">
      <div><div class="n">${zdem.toLocaleString('en-US')}</div><div class="l">búsquedas · 6 meses</div></div>
      <div><div class="n">${zofe.toLocaleString('en-US')}</div><div class="l">${esc(typ)}s en venta (mercado)</div></div>
      <div><div class="n">${zratio >= 1 ? zratio.toFixed(1) : zratio.toFixed(2)}</div><div class="l">búsquedas por propiedad</div></div>
      ${zoneMed ? `<div><div class="n">${money(zoneMed)}</div><div class="l">$/m² mediana de la zona</div></div>` : ''}
    </div>
    <p style="margin-top:8px;font-size:12px">${zread}</p>
  </div>` : ''}

  <div class="sec"><div class="eyebrow">Análisis y oportunidades</div><div class="accent"></div>
    <div class="two"><div class="box"><div class="eyebrow">Insights</div><ul>${insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div><div class="box"><div class="eyebrow">Plan de acción</div><ul>${plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div></div>
  </div>
  <div class="foot">Pulppo · 1·5·10 — Ficha generada ${new Date().toISOString().slice(0, 10)}. Datos en vivo de la comunidad Pulppo. Valuación del motor ACM.</div>
</div>`;
    return { code, html };
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
