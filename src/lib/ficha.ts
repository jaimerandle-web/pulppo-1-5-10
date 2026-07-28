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
const nrm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const toDate = (x: unknown): Date | null => {
    if (x instanceof Date) return x;
    if (typeof x === 'string') { const d = new Date(x); return isNaN(+d) ? null : d; }
    return null;
};
const fdate = (d: Date) => `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
// Categoría de promoción i24 a partir de type + status del history/aviso.
type PromoCat = 'Super' | 'Destacado' | 'Simple' | 'Offline' | 'Otro';
const promoCat = (t: string | null | undefined, s: string | null | undefined): PromoCat => {
    if (s && s.toUpperCase() !== 'ONLINE') return 'Offline';
    if (t === 'HOME_COMBO' || t === 'HOME_COMBO_ZONA_DEMAND') return 'Super';
    if (t === 'DESTACADO_COMBO' || t === 'DESTACADO_COMBO_ZONA_DEMAND') return 'Destacado';
    if (t === 'SIMPLE_COMBO') return 'Simple';
    return 'Otro';
};
const PROMOLBL: Record<PromoCat, string> = { Super: 'Super destacado', Destacado: 'Destacado', Simple: 'Simple', Offline: 'Offline', Otro: 'Otro' };
const PROMORD: PromoCat[] = ['Super', 'Destacado', 'Simple', 'Offline', 'Otro'];

interface Comp { precio: number | null; m2: number | null; ppm2: number | null; rec: number | null; ban: number | null; zona: string | null; col: string | null; url: string | null; src: string; street: string | null; dev: string | null; desc: string | null; amen: string[]; lat: number | null; lng: number | null }
// Amenidades = servicios comunes del edificio (services con type===1); type===2 son características
// interiores del depto (sala, comedor…) y no cuentan como amenidad.
const svcAmen = (e: Document | null | undefined): string[] =>
    (((e as Document)?.services as Document[]) || [])
        .filter((s) => (s as Record<string, unknown>).type === 1 && (s as Record<string, unknown>).name)
        .map((s) => String((s as Record<string, unknown>).name));
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
};
// Convierte un doc (properties o mls) a Comp, con desarrollo, amenidades y coordenadas.
const toComp = (e: Document, src: 'Pulppo' | 'MLS'): Comp => {
    const ev = num(dig(e, 'listing', 'value')), em = num(dig(e, 'attributes', 'totalSurface'));
    const loc = (dig(e, 'address', 'location', 'coordinates') as number[]) || [];
    const url = src === 'MLS' ? ((dig(e, 'import', 'url') as string) ?? null) : `https://pulppo.com/propiedades/${String(e._id)}`;
    return {
        precio: ev, m2: em, ppm2: ev && em ? ev / em : null,
        rec: num(dig(e, 'attributes', 'suites')), ban: num(dig(e, 'attributes', 'bathrooms')),
        zona: (dig(e, 'address', 'neighborhood', 'name') as string) ?? (dig(e, 'address', 'city', 'name') as string) ?? null,
        col: (dig(e, 'address', 'neighborhood', 'name') as string) ?? null,
        url, src, street: (dig(e, 'address', 'street') as string) ?? null,
        dev: (dig(e, 'development', 'name') as string)?.trim() || null, desc: (dig(e, 'listing', 'description') as string) ?? null, amen: svcAmen(e),
        lat: typeof loc[1] === 'number' ? loc[1] : null, lng: typeof loc[0] === 'number' ? loc[0] : null
    };
};
const COMP_PROJ = { 'listing.value': 1, 'listing.description': 1, attributes: 1, 'address.neighborhood.name': 1, 'address.city.name': 1, 'address.street': 1, 'address.location': 1, services: 1, 'development.name': 1 };

// Datos del inmueble analizado que necesita la sección "Qué te alcanza" (comparte renderFicha y la
// página de "ver más"). Se deriva del documento de la propiedad.
interface Subj { oid: ObjectId; typ: string | null; city: string | null; state: string | null; val: number | null; m2: number | null; ppm2: number | null; col: string | null; rec: number | null; lat: number | null; lng: number | null; myAmen: string[]; street: string | null }

// Pool de comparables vivos (Pulppo + mercado MLS), con fallback colonia/ciudad→estado y sin la propia.
const buildAlcPool = async (db: Awaited<ReturnType<typeof getDb>>, s: Subj): Promise<Comp[]> => {
    const live = async (geo: Document): Promise<Comp[]> =>
        (await db.collection('properties').find(
            { 'status.last': 'published', 'listing.operation': 'sale', type: s.typ, ...geo, _id: { $ne: s.oid }, 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } },
            { projection: COMP_PROJ, limit: 200 }
        ).toArray()).map((e) => toComp(e, 'Pulppo'));
    const market = async (geo: Document): Promise<Comp[]> =>
        (await db.collection('mls').find(
            { 'listing.operation': 'sale', type: s.typ, 'status.last': 'published', ...geo, 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } },
            { projection: { ...COMP_PROJ, 'import.url': 1 }, limit: 250 }
        ).toArray()).map((e) => toComp(e, 'MLS'));
    let poolC = s.city ? await live({ 'address.city.name': s.city }) : [];
    if (poolC.length < 3 && s.state) poolC = await live({ 'address.state.name': s.state });
    let mls = s.city ? await market({ 'address.city.name': s.city }) : [];
    if (mls.length < 3 && s.state) mls = await market({ 'address.state.name': s.state });
    // Excluir la MISMA propiedad (aunque venga duplicada del MLS): por calle igual o precio+superficie casi idénticos.
    const selfStreet = nrm(s.street);
    const isSelf = (c: Comp) =>
        (!!selfStreet && !!c.street && nrm(c.street) === selfStreet) ||
        (!!s.val && !!c.precio && !!s.m2 && !!c.m2 && Math.abs(c.precio - s.val) / s.val < 0.01 && Math.abs(c.m2 - s.m2) / s.m2 < 0.02);
    return [...poolC, ...mls].filter((c) => !isSelf(c));
};

// Ranking "qué tan ad-hoc es el comparable": misma colonia > cercanía > tamaño > presupuesto > amenidades > recámaras.
const kmOf = (s: Subj, c: Comp): number | null =>
    s.lat != null && s.lng != null && c.lat != null && c.lng != null ? haversineKm(s.lat, s.lng, c.lat, c.lng) : null;
const sameCol = (s: Subj, c: Comp): boolean => {
    const a = nrm(strip(s.col || '')); return !!a && !!c.col && nrm(strip(c.col)) === a;
};
const scoreComp = (s: Subj, c: Comp): number => {
    let sc = 0;
    if (sameCol(s, c)) sc += 60;
    const km = kmOf(s, c); if (km != null) sc += Math.max(0, 30 - km * 6);
    if (s.m2 && c.m2) sc += Math.max(0, 40 - (Math.abs(c.m2 - s.m2) / s.m2) * 100);
    if (s.val && c.precio) sc += Math.max(0, 20 - (Math.abs(c.precio - s.val) / s.val) * 100);
    if (s.myAmen.length && c.amen.length) { const set = new Set(s.myAmen.map(nrm)); sc += Math.min(18, c.amen.filter((a) => set.has(nrm(a))).length * 3); }
    if (s.rec && c.rec && s.rec === c.rec) sc += 8;
    return sc;
};
// Tope de cercanía: si conocemos la distancia y pasa de 1.5 km ya no es comparable (te sales de la zona).
const MAX_KM = 1.5;
const rankAlcance = (pool: Comp[], s: Subj): Comp[] =>
    (s.val ? pool.filter((c) => c.precio != null && c.precio >= 0.9 * s.val! && c.precio <= 1.1 * s.val!) : [])
        .filter((c) => { const k = kmOf(s, c); return k == null || k <= MAX_KM; })
        .sort((a, b) => scoreComp(s, b) - scoreComp(s, a));

// Identidad del edificio. Pulppo trae desarrollo/calle limpios; el MLS no: su address.street es el
// título de marketing del anuncio ("DEPARTAMENTO EN VENTA EN..."), así que hay que extraer el nombre
// propio (edificio/desarrollo/colonia) del título y, si no sale limpio, caer a la colonia.
const SMALL = new Set(['de', 'la', 'las', 'del', 'los', 'y', 'en', 'a', 'el']);
const GEN_RE = /renta\s*[-/]\s*venta|venta\s*[-/]\s*renta|se\s+vende\s+o\s+renta|se\s+vende|se\s+renta|preventa|en\s+venta|en\s+renta|\bventa\b|\brenta\b|\bvendo\b|\bvende\b|\brento\b|departamentos?|deptos?|dpto|penthouses?|\bph\b|garden\s+house|garden|\bloft\b|estudio|oportunidad|exclusivos?|lujosos?|de\s+lujo|espl[eé]ndidos?|espectaculares?|hermosos?|amplios?|nuevos?|para\s+estrenar|amueblados?|equipados?|incre[ií]bles?|inigualables?|roof\s+privado|con\s+roof/gi;
const NOISE_TAIL = new Set(['cuajimalpa', 'cdmx', 'cuajimalpa de morelos', 'ciudad de mexico', 'mexico', 'morelos', 'col']);
const titleCase = (s: string) => s.split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
const cleanStreet = (s: string) => s.split('(')[0].replace(/\bdepto\.?\b.*/i, '').trim();
// Paso 1: intentar sacar el nombre propio del título de marketing del MLS. null si no sale limpio.
const nameFromTitle = (title: string | null): string | null => {
    const t0 = (title || '').trim();
    if (!t0) return null;
    const t = t0.split(/[|(]/)[0];
    const ens = [...t.toLowerCase().matchAll(/\ben\b/g)];
    let cand = ens.length ? t.slice((ens[ens.length - 1].index ?? 0) + 2) : t;
    cand = cand.split(/[,–]| a \d+ ?min| con | para /i)[0];
    cand = cand.replace(GEN_RE, ' ').replace(/\b\d+\s*(m2|mts|m²|recamaras?|rec)\b/gi, ' ').replace(/\(?m2d\d+\)?/gi, ' ').replace(/[¡!¿?.:;"']/g, ' ').replace(/^\s*\d+\s*/, ' ');
    let parts = cand.replace(/\s+/g, ' ').trim().replace(/^[-,\s]+|[-,\s]+$/g, '').split(' ').filter(Boolean);
    while (parts.length >= 2 && NOISE_TAIL.has(nrm(parts.slice(-2).join(' ')))) parts = parts.slice(0, -2);
    while (parts.length && NOISE_TAIL.has(nrm(parts[parts.length - 1]))) parts = parts.slice(0, -1);
    // quitar colas sueltas de un solo carácter / número / puntuación (ej. "... 3 R", '... : "')
    while (parts.length && /^([^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+|\d+|[A-Za-zÁÉÍÓÚÑáéíóúñ])$/.test(parts[parts.length - 1])) parts = parts.slice(0, -1);
    cand = strip(parts.join(' '));
    if (cand.replace(/\s/g, '').length < 3 || ['venta', 'renta', 'cuajimalpa', 'cdmx'].includes(nrm(cand))) return null;
    return titleCase(cand).slice(0, 26);
};
// Paso 2: si el título no dio nombre, buscar en la descripción tras una señal fuerte (residencial/edificio/
// torre/desarrollo/condominio...) un nombre propio limpio que ADEMÁS aporte algo distinto a la colonia.
const saLower = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const DESC_KEY = /(?:residencial|edificio|torre|desarrollo|condominio|conjunto|complejo|privada)\s+([^,.\n;:]+)/gi;
const DESC_STOP = new Set(['esta', 'situado', 'situada', 'ubicado', 'ubicada', 'cuenta', 'con', 'dispone', 'es', 'muy', 'exclusivo', 'exclusiva', 'lujoso', 'lujosa', 'amplio', 'amplia', 'nuevo', 'nueva', 'solo', 'sola', 'sobre', 'para', 'tiene', 'ofrece', 'se', 'un', 'una', 'gran', 'hermoso', 'hermosa', 'moderno', 'moderna', 'ideal', 'excelente', 'excelentes', 'magnifico', 'precioso', 'bonito', 'mas', 'menos', 'rodeado', 'tranquilo', 'cerca', 'frente', 'pequeno', 'residencial', 'edificio', 'torre', 'departamento', 'depto', 'penthouse', 'en', 'a', 'el', 'que', 'tipo', 'estilo', 'zona', 'col', 'colonia', 'ph', 'loft', 'casa', 'venta', 'renta', 'desarrollo', 'condominio', 'conjunto', 'complejo', 'privada', 'ubicacion', 'dos', 'tres', 'entrada', 'entradas', 'club', 'golf', 'tower', 'towers', 'park', 'hospital', 'av', 'avenida', 'calle', 'blvd', 'boulevard', 'paseo', 'carretera', 'carr', 'parque']);
const nameFromDesc = (desc: string | null, col: string | null): string | null => {
    if (!desc) return null;
    const coln = nrm(col);
    for (const m of desc.matchAll(DESC_KEY)) {
        const out: string[] = [];
        for (const w of m[1].trim().split(/\s+/)) {
            const wl = saLower(w).replace(/[.,]/g, '');
            if (SMALL.has(wl)) { if (out.length) { out.push(w); continue; } else break; }
            if (DESC_STOP.has(wl) || !/^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(w) || w.charAt(0) !== w.charAt(0).toUpperCase()) break;
            out.push(w);
            if (out.length >= 3) break;
        }
        while (out.length && SMALL.has(saLower(out[out.length - 1]))) out.pop();
        const cand = strip(out.join(' ').trim());
        const cn = nrm(cand);
        if (cn.replace(/\s/g, '').length < 3 || (coln && (coln.includes(cn) || cn.includes(coln)))) continue;
        return titleCase(cand).slice(0, 26);
    }
    return null;
};
// Mapa de colonias conocidas del área (nrm → display), para no confundir una colonia con un edificio.
type ColMap = Map<string, string>;
const knownColsOf = (pool: Comp[], s: Subj): ColMap => {
    const map: ColMap = new Map();
    const add = (raw?: string | null) => { const d = raw ? strip(raw) : ''; const k = nrm(d); if (k && !map.has(k)) map.set(k, d); };
    for (const c of pool) add(c.col);
    add(s.col);
    return map;
};
// Si el nombre ES o EMPIEZA con una colonia conocida, no identifica un edificio; devuelve el display de esa colonia.
const matchColonia = (name: string, cols: ColMap): string | null => {
    const n = nrm(name); if (!n) return null;
    for (const [k, disp] of cols) if (n === k || n.startsWith(k + ' ')) return disp;
    return null;
};
// Resuelve la identidad del comparable. named=false cuando NO se pudo identificar el edificio y solo
// queda la colonia: esos van al FINAL de la tabla y el broker abre el link del aviso para ubicar cuál es.
// MLS: nombre propio del título → de la descripción → colonia (del campo, o la que venga en el título).
const resolveBuilding = (c: Comp, cols: ColMap): { name: string; named: boolean } => {
    if (c.dev) return { name: strip(c.dev).slice(0, 26), named: true };
    if (c.src === 'Pulppo') { const st = cleanStreet(c.street || ''); return st ? { name: st, named: true } : { name: c.zona ?? '—', named: false }; }
    const titleName = nameFromTitle(c.street);
    const titleCol = titleName ? matchColonia(titleName, cols) : null;
    if (titleName && !titleCol) return { name: titleName, named: true };
    const descName = nameFromDesc(c.desc, c.col);
    if (descName && !matchColonia(descName, cols)) return { name: descName, named: true };
    const colLbl = (c.col ? strip(c.col) : '') || titleCol || (c.zona ?? '');
    return { name: colLbl || '—', named: false };
};
const buildingId = (c: Comp, cols: ColMap): { main: string; sub: string } => {
    const main = resolveBuilding(c, cols).name;
    const colLbl = c.col ? strip(c.col) : c.zona || '';
    const startsCol = !!colLbl && nrm(main).startsWith(nrm(colLbl));
    const sub = (startsCol ? [c.src] : [colLbl, c.src]).filter(Boolean).join(' · ');
    return { main, sub };
};
// Ordena poniendo primero los comparables con edificio identificado; los "solo colonia" al final (rank estable).
const orderNamedFirst = (ranked: Comp[], cols: ColMap): Comp[] => {
    const named: Comp[] = [], rest: Comp[] = [];
    for (const c of ranked) (resolveBuilding(c, cols).named ? named : rest).push(c);
    return [...named, ...rest];
};

// Insight por fila: por qué es comparable (zona/cercanía) + qué tiene mejor tu depto o el suyo (tamaño, precio, $/m², amenidades).
const pctDiff = (a: number, b: number) => Math.round(((a - b) / b) * 100);
const alcInsightFor = (s: Subj, c: Comp): string => {
    const parts: string[] = [];
    const km = kmOf(s, c);
    if (sameCol(s, c)) parts.push('misma colonia');
    else if (km != null) parts.push(`a ${km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km'}${c.col ? ` · ${esc(strip(c.col))}` : ''}`);
    else if (c.col) parts.push(esc(strip(c.col)));
    if (s.m2 && c.m2) { const d = pctDiff(c.m2, s.m2); parts.push(Math.abs(d) < 3 ? 'mismo tamaño' : d > 0 ? `+${d}% de superficie` : `${d}% (más chico)`); }
    if (s.val && c.precio) { const d = pctDiff(c.precio, s.val); parts.push(Math.abs(d) < 2 ? 'mismo presupuesto' : d > 0 ? `${money(c.precio - s.val)} más caro` : `${money(s.val - c.precio)} más barato`); }
    if (s.ppm2 && c.ppm2) { const d = pctDiff(c.ppm2, s.ppm2); if (Math.abs(d) >= 5) parts.push(`$/m² ${d > 0 ? d + '% más alto' : Math.abs(d) + '% más bajo'}`); }
    if (s.myAmen.length || c.amen.length) { const dif = c.amen.length - s.myAmen.length; if (dif > 0) parts.push(`+${dif} amenidades`); else if (dif < 0) parts.push(`${dif} amenidades`); }
    return parts.join(' · ');
};
const alcGeneralInsights = (ranked: Comp[], s: Subj): string[] => {
    if (!ranked.length) return [];
    const out: string[] = [];
    const sc = ranked.filter((c) => sameCol(s, c)).length;
    out.push(`${ranked.length} opción${ranked.length === 1 ? '' : 'es'} en tu mismo rango de presupuesto (±10%)${sc ? `, ${sc} en tu misma colonia` : ''}.`);
    if (s.m2) {
        const big = ranked.filter((c) => c.m2 && c.m2 > s.m2! * 1.05).length, small = ranked.filter((c) => c.m2 && c.m2 < s.m2! * 0.95).length;
        out.push(`Por tu presupuesto: ${big} son más grandes y ${small} más chicas que tus ${s.m2} m².`);
        const bigger = ranked.filter((c) => c.m2).sort((a, b) => (b.m2 as number) - (a.m2 as number))[0];
        if (bigger && bigger.m2 && bigger.m2 > s.m2) out.push(`Con lo mismo se alcanza hasta ${bigger.m2} m² (${esc(String(strip(bigger.dev || '') || bigger.street || bigger.zona || '—'))}), ${pctDiff(bigger.m2, s.m2)}% más grande — úsalo para justificar tu precio o resaltar ubicación/estado.`);
    }
    if (s.ppm2) { const cheaper = ranked.filter((c) => c.ppm2 && c.ppm2 < s.ppm2! * 0.95).length; if (cheaper) out.push(`${cheaper} comparable${cheaper === 1 ? '' : 's'} ofrece${cheaper === 1 ? '' : 'n'} mejor $/m² que el tuyo (${money(s.ppm2)}): anticipa objeciones de precio con tus diferenciadores.`); }
    return out;
};

// Fila de la tabla "qué te alcanza": Inmueble (calle+número · desarrollo) · Precio · Sup. · Rec/Baños · Insight.
const alcTblRows = (rows: Comp[], s: Subj, knownCols: ColMap): string => {
    if (!rows.length) return '<tr><td colspan="5" style="color:#B7B7B7">Sin resultados en el rango de presupuesto.</td></tr>';
    return rows.map((r) => {
        const { main, sub } = buildingId(r, knownCols);
        const name = esc(String(main).slice(0, 46));
        const link = r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer" style="color:${SEA}">${name}</a>` : name;
        return `<tr><td>${link}${sub ? `<br><span style="color:${GRY};font-size:9px">${esc(sub)}</span>` : ''}</td><td class="nw">${money(r.precio)}</td><td class="nw">${r.m2 ?? '—'} m²</td><td class="nw">${r.rec ?? '—'} rec · ${r.ban ?? '—'} b</td><td style="font-size:10px;line-height:1.4">${alcInsightFor(s, r)}</td></tr>`;
    }).join('');
};
// Comparación de amenidades: matriz edificios×amenidades. Presente = punto de color, ausente = gris.
// Se lee de un vistazo qué tiene cada edificio y dónde gana o pierde el tuyo. '' si no aplica.
const amenCompareHtml = (top: Comp[], s: Subj, knownCols: ColMap): string => {
    if (s.myAmen.length < 2) return '';
    const comps = top.filter((c) => c.amen.length).slice(0, 5); // hasta 5 comparables con amenidades
    if (!comps.length) return '';
    const buildings = [{ label: 'Tu edificio', amen: s.myAmen }, ...comps.map((c) => ({ label: buildingId(c, knownCols).main, amen: c.amen }))];
    // universo de amenidades (unión), ordenado por cuántos edificios la tienen (desc)
    const uni = new Map<string, string>(); // clave normalizada → nombre a mostrar
    for (const b of buildings) for (const a of b.amen) if (!uni.has(nrm(a))) uni.set(nrm(a), a);
    const has = (amen: string[], k: string) => amen.some((a) => nrm(a) === k);
    const count = (k: string) => buildings.filter((b) => has(b.amen, k)).length;
    const rows = [...uni.entries()].sort((a, b) => count(b[0]) - count(a[0])).slice(0, 16);
    const dotY = `<span style="color:${SEA};font-weight:700">●</span>`, dotN = '<span style="color:#D8D8D8">·</span>';
    const head = `<tr><th style="width:148px">Amenidad</th>${buildings.map((b, i) => `<th style="text-align:center;font-size:10px;white-space:normal;line-height:1.25;${i === 0 ? `color:${BLK}` : ''}">${esc(String(b.label).slice(0, 38))}</th>`).join('')}</tr>`;
    const body = rows.map(([k, name]) => `<tr><td>${esc(name)}</td>${buildings.map((b) => `<td style="text-align:center">${has(b.amen, k) ? dotY : dotN}</td>`).join('')}</tr>`).join('');
    const totals = `<tr><td style="font-weight:700;color:${GRY}">Total amenidades</td>${buildings.map((b) => `<td style="text-align:center;font-weight:700">${b.amen.length}</td>`).join('')}</tr>`;
    return `<div style="margin-top:22px"><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Amenidades: tu edificio vs. comparables</div>
      <div style="font-size:10px;color:${GRY};margin-bottom:4px">${dotY} tiene la amenidad · ${dotN} no la tiene. Tu edificio es la primera columna.</div>
      <table>${head}${body}${totals}</table></div>`;
};

export async function renderFicha(id: string, opts?: { token?: string }): Promise<{ code: string; html: string } | null> {
    const moreHref = `/ficha/${encodeURIComponent(id)}/comparables${opts?.token ? `?token=${encodeURIComponent(opts.token)}` : ''}`;
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
    const street = (dig(P, 'address', 'street') as string)?.trim() || null;
    const city = (dig(P, 'address', 'city', 'name') as string) ?? null;
    const state = (dig(P, 'address', 'state', 'name') as string) ?? null;
    const typ = (P.type as string) ?? null;
    const ppm2 = val && m2 ? val / m2 : null;
    const code = (P.internalId as string) ?? id;
    const rec = num(dig(P, 'attributes', 'suites'));
    const myLoc = (dig(P, 'address', 'location', 'coordinates') as number[]) || [];
    const myLat = typeof myLoc[1] === 'number' ? myLoc[1] : null, myLng = typeof myLoc[0] === 'number' ? myLoc[0] : null;
    const myAmen = svcAmen(P);
    const devName = (dig(P, 'development', 'name') as string)?.trim() || null;
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

    // contrato de exclusividad: vencimiento = start + durationMonths
    const exStart = toDate(dig(P, 'contract', 'exclusive', 'start'));
    const exDur = num(dig(P, 'contract', 'exclusive', 'durationMonths'));
    let exExpiry: Date | null = null;
    if (exStart && exDur) { exExpiry = new Date(exStart); exExpiry.setMonth(exExpiry.getMonth() + exDur); }
    const mesesRest = exExpiry ? (exExpiry.getTime() - now) / (30.44 * 86400000) : null;

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
    // fuente × (cliente vs asesor): qué medio trae más clientes vs brokers (clientes primero, son lo importante)
    const fuenteSplit = new Map<string, { cli: number; ase: number }>();
    for (const l of leads) {
        const c = classifySource(l.source as string);
        const cur = fuenteSplit.get(c) || { cli: 0, ase: 0 };
        if (asesorSet.has(String(dig(l, 'contact', '_id')))) cur.ase++; else cur.cli++;
        fuenteSplit.set(c, cur);
    }

    // ---- Promoción i24 en el tiempo: spans por categoría + leads generados en cada temporada ----
    const i24hist = ((dig(P, 'portals', 'inmuebles24', 'history') as Document[]) || [])
        .map((e) => ({ t: toDate(e.timestamp), type: e.type as string, status: e.status as string }))
        .filter((e): e is { t: Date; type: string; status: string } => e.t != null)
        .sort((a, b) => a.t.getTime() - b.t.getTime());
    interface PSpan { a: number; b: number; cat: PromoCat }
    const pspans: PSpan[] = i24hist.map((e, i) => ({
        a: e.t.getTime(), b: i + 1 < i24hist.length ? i24hist[i + 1].t.getTime() : now, cat: promoCat(e.type, e.status)
    }));
    const pT0 = pspans.length ? pspans[0].a : now;
    const pTotal = Math.max(1, now - pT0);
    const catMs = new Map<PromoCat, number>();
    const catLeads = new Map<PromoCat, number>();
    for (const s of pspans) catMs.set(s.cat, (catMs.get(s.cat) || 0) + (s.b - s.a));
    // Solo leads originados en Inmuebles24: la categoría de promoción es un concepto de i24, así que
    // los leads de otras fuentes (redes, WhatsApp, otros portales) NO se atribuyen a estas categorías.
    const i24Leads = leads.filter((l) => classifySource(l.source as string) === 'Inmuebles24');
    let leadsMedidos = 0;
    for (const l of i24Leads) {
        const c = l.createdAt instanceof Date ? (l.createdAt as Date).getTime() : null;
        if (c == null || c < pT0) continue;
        for (const s of pspans) { if (c >= s.a && c < s.b) { catLeads.set(s.cat, (catLeads.get(s.cat) || 0) + 1); leadsMedidos++; break; } }
    }
    // ¿en Super destacado hoy? ¿desde cuándo (racha contigua actual)?
    const enSuper = pspans.length > 0 && pspans[pspans.length - 1].cat === 'Super';
    let superSince: number | null = null;
    if (enSuper) { superSince = pspans[pspans.length - 1].a; for (let i = pspans.length - 2; i >= 0 && pspans[i].cat === 'Super'; i--) superSince = pspans[i].a; }
    const pctSuper = Math.round(((catMs.get('Super') || 0) / pTotal) * 100);

    const vis = await db.collection('visits').countDocuments({ 'steps.property._id': oid, 'status.last': { $ne: 'cancelled' } });
    const ofertas = await db.collection('operations').countDocuments({ 'property._id': oid, 'status.last': { $in: [...ADVANCED] } });

    // ---- Comportamiento en el tiempo: vistas del anuncio (metrics type='view', TODAS las fuentes) + leads, por mes ----
    // metrics.property viene como ObjectId (avisos nuevos) o string (viejos): matchear ambos. Cada evento = 1 vista.
    const viewAgg = await db.collection('metrics').aggregate([
        { $match: { property: { $in: [oid, id] }, type: 'view' } },
        { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m' } }, n: { $sum: 1 } } }
    ]).toArray();
    const viewsByMonth = new Map<string, number>();
    for (const r of viewAgg) if (r._id) viewsByMonth.set(r._id as string, r.n as number);
    const leadsByMonth = new Map<string, number>();
    for (const l of leads) {
        const d = l.createdAt instanceof Date ? (l.createdAt as Date) : null;
        if (!d) continue;
        const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        leadsByMonth.set(k, (leadsByMonth.get(k) || 0) + 1);
    }
    // rango mensual desde la publicación (o la primera actividad) hasta hoy, rellenando con 0
    const actKeys = [...viewsByMonth.keys(), ...leadsByMonth.keys()].sort();
    const serieStart = pub ?? (actKeys.length ? new Date(`${actKeys[0]}-01T00:00:00Z`) : new Date(now));
    const serieMeses: { m: string; v: number; l: number }[] = [];
    for (const d = new Date(Date.UTC(serieStart.getUTCFullYear(), serieStart.getUTCMonth(), 1)); d.getTime() <= now; d.setUTCMonth(d.getUTCMonth() + 1)) {
        const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        serieMeses.push({ m: k, v: viewsByMonth.get(k) || 0, l: leadsByMonth.get(k) || 0 });
    }

    // cierres reales de la comunidad (mismo tipo), ampliando colonia→ciudad→estado hasta n>=5
    const cierres = async (geo: Document): Promise<{ price: number; ppm2: number | null; m2: number | null }[]> => {
        const ps = await db.collection('properties').aggregate([
            { $match: { 'status.last': 'completed', 'listing.operation': 'sale', type: typ, ...geo } },
            { $lookup: { from: 'operations', localField: '_id', foreignField: 'property._id', as: 'op' } },
            { $limit: 400 }
        ]).toArray();
        const out: { price: number; ppm2: number | null; m2: number | null }[] = [];
        for (const p of ps) {
            const sm2 = num(dig(p, 'attributes', 'totalSurface'));
            for (const o of (p.op as Document[]) || []) { const v = num(dig(o, 'closeValue', 'value')); if (v) out.push({ price: v, ppm2: sm2 && sm2 > 0 ? v / sm2 : null, m2: sm2 }); }
        }
        return out;
    };
    let scope = col ?? '', cz = col ? await cierres({ 'address.neighborhood.name': col }) : [];
    if (cz.length < 5 && city) { scope = city; cz = await cierres({ 'address.city.name': city }); }
    if (cz.length < 5 && state) { scope = state; cz = await cierres({ 'address.state.name': state }); }

    // comparables vivos (Pulppo + mercado MLS) + "qué te alcanza"
    const subj: Subj = { oid, typ, city, state, val, m2, ppm2, col, rec, lat: myLat, lng: myLng, myAmen, street };
    const alcPool = await buildAlcPool(db, subj);
    const knownCols = knownColsOf(alcPool, subj);
    const dist = (c: Comp) => (val && c.precio ? Math.abs(c.precio - val) / val : 0) + (m2 && c.m2 ? Math.abs(c.m2 - m2) / m2 : 0);
    const comps = alcPool.filter((c) => c.src === 'Pulppo').sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    // "Qué te alcanza por el mismo presupuesto": ranking por qué tan ad-hoc es, con los "solo colonia" al final → top 10 en la ficha, resto en /comparables.
    const alcRanked = orderNamedFirst(rankAlcance(alcPool, subj), knownCols);
    const alcTop = alcRanked.slice(0, 10);
    const alcMore = Math.max(0, alcRanked.length - 10);
    const alcInsights = alcGeneralInsights(alcRanked, subj);
    // "$/m² similar" queda como referencia secundaria.
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
    const zppms = alcPool.map((c) => c.ppm2).filter((x): x is number => x != null);
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
    // contrato → fila de salud (semáforo por meses restantes)
    let cstat: 'ok' | 'warn' | 'bad' | 'na' = 'na', cval = '—', cnote = 'sin fecha registrada';
    if (mesesRest != null && exExpiry) {
        cnote = `vence ${fdate(exExpiry)}${exDur ? ` · ${exDur} meses` : ''}`;
        if (mesesRest < 0) { cstat = 'bad'; cval = `vencido hace ${Math.max(1, Math.round(-mesesRest))} mes${Math.round(-mesesRest) === 1 ? '' : 'es'} — renovar`; }
        else if (mesesRest <= 2) { cstat = 'warn'; cval = `${Math.max(0, Math.round(mesesRest))} mes${Math.round(mesesRest) === 1 ? '' : 'es'} — renovar pronto`; }
        else { cstat = 'ok'; cval = `${Math.round(mesesRest)} meses restantes`; }
    }
    const mm = `${pics} fotos · video ${video ? '✓' : '—'} · tour ${tour ? '✓' : '—'}`;
    const tcheck = `tipo ${tipoOk ? '✓' : '✗'} · operación ${opOk ? '✓' : '✗'} · zona ${zonaOk ? '✓' : '✗'}`;
    const health = [
        rowH('Calidad del anuncio', q != null ? `${q.toFixed(0)}/100` : '—', q != null && q >= 85 ? 'ok' : 'warn'),
        rowH('Valuación', `${money(val)} vs estimado ${money(acm)}`, vstat, (dval != null ? `${dval >= 0 ? '+' : ''}${dval.toFixed(0)}% · ` : '') + vnote),
        rowH('Título', esc(title.slice(0, 60)) || '—', tipoOk && opOk && zonaOk ? 'ok' : 'warn', tcheck),
        rowH('Descripción', `${words} palabras`, words >= 40 && words <= 200 ? 'ok' : 'warn', words >= 40 && words <= 200 ? 'longitud adecuada' : 'revisar extensión'),
        rowH('Ubicación', 'completa', 'ok', ''),
        rowH('Multimedia', mm, pics >= 12 && video ? 'ok' : 'warn'),
        rowH('Categoría del anuncio', `${catLbl} · ${mlLbl}`, SUPER.has(cat ?? '') ? 'ok' : 'warn'),
        rowH('Contrato exclusividad', cval, cstat, cnote)
    ].join('');

    const tv = leads.length ? vis / leads.length : 0;
    const to = vis ? ofertas / vis : 0;
    const vcolor = tv >= 0.2 ? SEA : tv >= 0.1 ? YEL : RED;
    const vtxt = tv >= 0.2 ? '¡wow!' : tv >= 0.1 ? 'tasa ok' : 'tasa baja';
    const fstage = (lbl: string, n: number, w: number, inside = '') => `<div class="fstage"><span class="fslbl">${lbl}</span><span class="fstrack"><span class="fsbar" style="width:${Math.max(w, 0.6)}%"></span>${inside}</span><span class="fsn">${n}</span></div>`;
    const convInline = `<span class="fconvinline"><b style="color:${vcolor}">${(tv * 100).toFixed(0)}%</b> · ${vtxt}</span>`;
    const funnel = fstage('Leads', leads.length, 100) + fstage('Visitas', vis, (100 * vis) / Math.max(leads.length, 1), convInline) + fstage('Ofertas', ofertas, (100 * ofertas) / Math.max(leads.length, 1));
    const maxF = Math.max(1, ...fuenteRows.map(([, v]) => v));
    const fuenteHtml = fuenteRows.map(([k, v]) => {
        const sp = fuenteSplit.get(k) || { cli: 0, ase: 0 };
        const totW = Math.round((100 * v) / maxF), cliW = v ? Math.round((100 * sp.cli) / v) : 0;
        return `<div class="frow"><span>${k}</span><span class="fbarwrap"><span class="fcomp" style="width:${totW}%"><span class="fcli" style="width:${cliW}%">${sp.cli || ''}</span><span class="fase" style="width:${100 - cliW}%">${sp.ase || ''}</span></span></span><span class="fn">${v}</span></div>`;
    }).join('');
    const compTbl = (rows: Comp[]) => {
        if (!rows.length) return '<tr><td colspan="5" style="color:#B7B7B7">Sin resultados en el rango.</td></tr>';
        const zc = (r: Comp) => {
            const z = esc(String(r.zona ?? '—').slice(0, 24));
            const tag = r.src === 'MLS' ? ` <span style="color:${GRY};font-size:8px">MLS</span>` : '';
            return (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer" style="color:${SEA}">${z}</a>` : z) + tag;
        };
        return rows.map((r) => `<tr><td>${zc(r)}</td><td class="nw">${money(r.precio)}</td><td class="nw">${r.m2 ?? '—'} m²</td><td class="nw">${r.ppm2 ? money(r.ppm2) + '/m²' : '—'}</td><td class="nw">${r.rec ?? '—'} rec<br>${r.ban ?? '—'} baños</td></tr>`).join('');
    };
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const czPrices = cz.map((c) => c.price);
    const czN = czPrices.length;
    const czAvg = avg(czPrices);
    const czM2s = cz.map((c) => c.m2).filter((x): x is number => x != null && x > 0);
    const soldPpms = cz.map((c) => c.ppm2).filter((x): x is number => x != null);
    const soldMed = soldPpms.length ? median(soldPpms) : null;
    const soldAvg = avg(soldPpms);
    const soldRead = soldMed && ppm2 ? `Tu $/m² (${money(ppm2)}) está ${Math.abs(Math.round((ppm2 / soldMed - 1) * 100))}% ${ppm2 >= soldMed ? 'arriba' : 'abajo'} de la mediana de cierre de la zona.` : '';
    const opTxt = dig(P, 'listing', 'operation') === 'sale' ? 'Venta' : (dig(P, 'listing', 'operation') as string) ?? '';

    // ---- Difusión y promoción: timeline i24 + leads por categoría + estado ML ----
    const PCOL: Record<PromoCat, string> = { Super: YEL, Destacado: SEA, Simple: GRY, Offline: RED, Otro: '#E3E3E3' };
    const dayMs = 86400000;
    const promoBar = pspans.map((s) => `<span style="position:absolute;left:${(((s.a - pT0) / pTotal) * 100).toFixed(2)}%;width:${Math.max(((s.b - s.a) / pTotal) * 100, 0.3).toFixed(2)}%;top:0;bottom:0;background:${PCOL[s.cat]}"></span>`).join('');
    const promoLegend = PROMORD.filter((c) => (catMs.get(c) || 0) > 0).map((c) => `<span style="margin-right:12px;white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;background:${PCOL[c]};margin-right:4px;vertical-align:middle"></span>${PROMOLBL[c]}</span>`).join('');
    const catRows = PROMORD.filter((c) => (catMs.get(c) || 0) > 0 || (catLeads.get(c) || 0) > 0).map((c) => {
        const d = (catMs.get(c) || 0) / dayMs, lc = catLeads.get(c) || 0, lm = d ? (lc / d) * 30.44 : 0;
        return `<tr><td><span class="dt" style="background:${PCOL[c]}"></span>${PROMOLBL[c]}</td><td class="nw">${Math.round(d)} días</td><td class="nw">${lc}</td><td class="nw"><b>${lm.toFixed(1)}</b></td></tr>`;
    }).join('');
    const i24Head = pspans.length
        ? `<b>${pctSuper}%</b> de los días en Super destacado · ${enSuper && superSince ? `en Super destacado desde ${fdate(new Date(superSince))} (${Math.round((now - superSince) / dayMs)} días)` : 'hoy NO está en Super destacado'}`
        : 'Sin historial de promoción registrado en i24.';
    const mlPromB = dig(P, 'portals', 'mercadolibre', 'promoted') === true || String(dig(P, 'portals', 'mercadolibre', 'promoted')).toLowerCase() === 'true';
    const mlEnd = toDate(dig(P, 'portals', 'mercadolibre', 'endTime'));
    const mlLine = `${mlLbl}${mlStatus ? ` · ${mlStatus.toUpperCase() === 'ONLINE' ? 'en línea' : esc(mlStatus)}` : ''} · ${mlPromB ? `promovido${mlEnd ? ` hasta ${fdate(mlEnd)}` : ''}` : 'sin promoción activa'}`;
    const promoHtml = `
  <div class="sec"><div class="eyebrow">Difusión y promoción</div><div class="accent"></div>
    <div class="eyebrow" style="color:${BLK};margin-bottom:2px">Inmuebles24 — historial de categoría</div>
    <div style="font-size:12px;margin-bottom:6px">${i24Head}</div>
    ${pspans.length ? `<div style="position:relative;height:16px;background:${LGT}">${promoBar}</div>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:${GRY};margin-top:3px"><span>${fdate(new Date(pT0))}</span><span>hoy</span></div>
    <div style="font-size:10px;color:${BLK};margin-top:6px">${promoLegend}</div>
    <table style="margin-top:8px"><tr><th>Categoría</th><th>Tiempo</th><th>Leads i24</th><th>Leads i24/mes</th></tr>${catRows}</table>
    <div style="font-size:9px;color:${GRY};margin-top:2px">Solo leads originados en Inmuebles24 (${leadsMedidos} de ${leads.length} históricos) desde ${fdate(new Date(pT0))}; leads de redes, WhatsApp u otros portales no se atribuyen a estas categorías. Leads/mes normaliza por los días en cada categoría.</div>` : ''}
    <div class="eyebrow" style="color:${BLK};margin:14px 0 2px">MercadoLibre — estado actual</div>
    <div style="font-size:12px">${mlLine}</div>
  </div>`;

    // ---- Comportamiento en el tiempo (general): vistas + leads por mes desde la publicación ----
    const mlabel = (k: string) => { const [y, mo] = k.split('-'); return `${MES[+mo - 1]} ${y.slice(2)}`; };
    const maxV = Math.max(1, ...serieMeses.map((x) => x.v));
    const maxL = Math.max(1, ...serieMeses.map((x) => x.l));
    const totalV = serieMeses.reduce((a, b) => a + b.v, 0);
    const peakV = serieMeses.reduce((a, b) => (b.v > a.v ? b : a), { m: '', v: 0, l: 0 });
    const peakL = serieMeses.reduce((a, b) => (b.l > a.l ? b : a), { m: '', v: 0, l: 0 });
    // Gráfica de LÍNEAS (SVG inline, imprimible): dos series con eje de meses marcado con ticks.
    const CW = 728, CH = 168, PADL = 12, PADR = 14, PADT = 12, PADB = 26;
    const plotW = CW - PADL - PADR, plotH = CH - PADT - PADB, baseY = PADT + plotH;
    const N = serieMeses.length;
    const xOf = (i: number) => (N <= 1 ? PADL + plotW / 2 : PADL + (i / (N - 1)) * plotW);
    const yOf = (v: number, max: number) => PADT + (1 - (max ? v / max : 0)) * plotH;
    const linePath = (key: 'v' | 'l', max: number) =>
        serieMeses.map((x, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(x[key], max).toFixed(1)}`).join(' ');
    const dots = (key: 'v' | 'l', max: number, color: string) =>
        serieMeses.map((x, i) => (x[key] > 0 ? `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(x[key], max).toFixed(1)}" r="2.1" fill="${color}"/>` : '')).join('');
    const step = Math.max(1, Math.ceil(N / 8));
    const ticks = serieMeses.map((x, i) => {
        if (!(i % step === 0 || i === N - 1)) return '';
        const xx = xOf(i).toFixed(1);
        const anchor = i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle';
        return `<line x1="${xx}" y1="${baseY}" x2="${xx}" y2="${baseY + 4}" stroke="${GRY}"/><text x="${xx}" y="${CH - 8}" font-size="10" font-weight="700" fill="${BLK}" text-anchor="${anchor}">${mlabel(x.m)}</text>`;
    }).join('');
    const svg = `<svg viewBox="0 0 ${CW} ${CH}" width="100%" preserveAspectRatio="none" style="display:block;height:${CH}px">
    <line x1="${PADL}" y1="${baseY}" x2="${PADL + plotW}" y2="${baseY}" stroke="${LGT}"/>
    ${ticks}
    <path d="${linePath('v', maxV)}" fill="none" stroke="${SEA}" stroke-width="2"/>
    <path d="${linePath('l', maxL)}" fill="none" stroke="${YEL}" stroke-width="2"/>
    ${dots('v', maxV, SEA)}${dots('l', maxL, YEL)}
  </svg>`;
    const legend = `<div style="font-size:10px;color:${BLK};margin-bottom:4px">
      <span style="display:inline-block;width:16px;height:3px;background:${SEA};vertical-align:middle;margin-right:5px"></span>Vistas (máx ${maxV}/mes)
      <span style="display:inline-block;width:16px;height:3px;background:${YEL};vertical-align:middle;margin:0 5px 0 16px"></span>Leads (máx ${maxL}/mes)</div>`;
    const comportHtml = serieMeses.length ? `
  <div class="sec"><div class="eyebrow">Comportamiento en el tiempo</div><div class="accent"></div>
    <div style="font-size:12px;margin-bottom:8px">Vistas del anuncio y leads por mes desde que se publicó${pub ? ` (${fdate(pub)})` : ''}, para ver los momentos de más interés.</div>
    ${legend}
    ${svg}
    <div style="font-size:9px;color:${GRY};margin-top:6px">${totalV.toLocaleString('en-US')} vistas y ${leads.length} leads en total · pico de vistas ${peakV.v ? `en ${mlabel(peakV.m)} (${peakV.v})` : '—'} · pico de leads ${peakL.l ? `en ${mlabel(peakL.m)} (${peakL.l})` : '—'}. Cada línea usa su propia escala (vistas y leads difieren mucho). Vistas = eventos de vista de todas las fuentes.</div>
  </div>` : '';

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
.ficha-root .fbarwrap{flex:1;background:${LGT};height:16px;margin:0 8px}.ficha-root .fbar{display:block;height:16px;background:${BLK}}.ficha-root .fn{width:20px;text-align:right;font-weight:700}
.ficha-root .fcomp{display:flex;height:16px}.ficha-root .fcli,.ficha-root .fase{display:flex;align-items:center;justify-content:center;height:16px;color:#fff;font-size:9px;font-weight:700;overflow:hidden}.ficha-root .fcli{background:${SEA}}.ficha-root .fase{background:${BLK}}
.ficha-root .srow2{display:flex;font-size:11px;padding:4px 0;border-bottom:1px solid ${LGT}}.ficha-root .srow2 .l2{width:130px;color:${GRY};font-weight:700}.ficha-root .srow2 .v2{flex:1}
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
    <div class="eyebrow" style="color:${YEL}">Ficha de desempeño · ${esc(code)}</div>
    <h1>${esc(street || code)}</h1>
    <div class="sub">${esc(typ)} · ${esc(opTxt)} · ${esc(col)}, ${esc(city)}${devName ? ` · ${esc(devName)}` : ''}</div>
    <div class="price">${money(val)} · ${m2 ?? '—'} m² · ${money(ppm2)}/m²</div>
    <div>${broker ? `<span class="tag">${esc(broker)}</span>` : ''}<span class="tag">${esc(dig(P, 'company', 'name'))}</span><span class="tag">${catLbl}</span><span class="tag">Publicada ${pub ? pub.toISOString().slice(0, 10) : '—'}${meses != null ? ` (${meses} meses)` : ''}</span></div>
  </div>
  <img class="plogo" src="/pulppo-blanco.png" alt="Pulppo"></div>

  <div class="sec"><div class="eyebrow">Salud del anuncio</div><div class="accent"></div>${health}</div>
${promoHtml}
${comportHtml}

  <div class="sec"><div class="eyebrow">Demanda y funnel</div><div class="accent"></div>
    <div class="grid2">
      <div>${funnel}
        <div class="recap"><div><div class="n">${l30}</div><div class="l">leads · 30 días</div></div><div><div class="n">${l90}</div><div class="l">leads · 90 días</div></div><div><div class="n">${leads.length}</div><div class="l">leads · histórico</div></div></div>
      </div>
      <div><div class="eyebrow" style="margin-bottom:2px;color:${BLK}">Leads por fuente</div>
        <div style="font-size:9px;color:${GRY};margin-bottom:6px"><span style="color:${SEA}">■</span> clientes · <span style="color:${BLK}">■</span> asesores</div>${fuenteHtml}</div>
    </div>
    <div style="margin-top:16px;color:${BLK}" class="eyebrow">Leads: clientes vs. asesores</div>
    <div class="split"><div class="c" style="width:${Math.round((100 * cliente) / Math.max(leads.length, 1))}%">${cliente} clientes</div><div class="a" style="width:${Math.round((100 * asesor) / Math.max(leads.length, 1))}%">${asesor} asesores</div></div>
  </div>

  <div class="sec"><div class="eyebrow">Mercado y competencia</div><div class="accent"></div>
    <div class="kpi"><div><div class="n">${money(ppm2)}</div><div class="l">$/m² de esta propiedad</div></div><div><div class="n">${comps.length}</div><div class="l">comparables en zona</div></div>${soldMed ? `<div><div class="n">${money(soldMed)}</div><div class="l">$/m² mediana de cierres (vendido)</div></div>` : ''}${zoneMed ? `<div><div class="n">${money(zoneMed)}</div><div class="l">$/m² mediana en venta (oferta)</div></div>` : ''}</div>
    ${czN ? `<div style="margin-top:14px;font-size:11px;line-height:1.7">
      <div style="font-weight:700;color:${BLK}">Cierres reales de la comunidad (${esc(typ)} · ${esc(scope)}):</div>
      <div>– ${czN} operaciones — mediana ${money(median(czPrices))} · promedio ${money(czAvg)}</div>
      <div>– Rango de operaciones — ${money(Math.min(...czPrices))}–${money(Math.max(...czPrices))}${czM2s.length ? ` | ${Math.min(...czM2s)} m² – ${Math.max(...czM2s)} m² totales` : ''}</div>
      ${soldMed ? `<div>– $/m² de cierre — mediana ${money(soldMed)} · promedio ${money(soldAvg)}.</div>` : ''}
      ${soldRead ? `<div style="margin-top:10px;font-size:12px;color:${BLK}">${soldRead}</div>` : ''}
    </div>` : `<div style="margin-top:10px;font-size:11px;color:${GRY}">Sin ventas cerradas registradas en ${esc(scope)}.</div>`}
    <div style="margin-top:24px"><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Con qué compite en la zona</div>
      <table><tr><th>Ubicación</th><th>Precio</th><th>Sup.</th><th>$/m²</th><th>Rec/Baños</th></tr>${compTbl(comps)}</table></div>
    <div style="margin-top:22px"><div class="eyebrow" style="color:${BLK};margin-bottom:4px">Qué te alcanza por el mismo presupuesto</div>
      <div style="font-size:10px;color:${GRY};margin-bottom:4px">Comparables vivos en tu mismo rango de precio (±10%) y hasta 1.5 km, ordenados de más a menos parecidos a tu inmueble (colonia, cercanía, tamaño, presupuesto y amenidades).</div>
      <table><tr><th>Inmueble</th><th>Precio</th><th>Sup.</th><th>Rec/Baños</th><th>Por qué es comparable</th></tr>${alcTblRows(alcTop, subj, knownCols)}</table>
      ${alcMore ? `<div style="font-size:10px;margin-top:4px"><a href="${moreHref}" style="color:${SEA};font-weight:700">Ver los ${alcRanked.length} comparables →</a></div>` : ''}
      ${amenCompareHtml(alcTop, subj, knownCols)}
      ${alcInsights.length ? `<div class="box" style="margin-top:16px"><div class="eyebrow">Insights de comparables</div><ul>${alcInsights.map((i) => `<li>${i}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div style="margin-top:20px;opacity:.7"><div class="eyebrow" style="color:${GRY};margin-bottom:4px">Referencia · qué te alcanza por $/m² similar</div>
      <div style="font-size:10px;color:${GRY};margin-bottom:4px">Menos relevante: mismo $/m² (±15%), como referencia de mercado.</div>
      <table><tr><th>Zona</th><th>Precio</th><th>Sup.</th><th>$/m²</th><th>Rec/Baños</th></tr>${compTbl(alcPpm2)}</table></div>
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

// "Ver más": lista COMPLETA de comparables por el mismo presupuesto (ranking ad-hoc), página propia.
export async function renderComparables(id: string, opts?: { token?: string }): Promise<{ code: string; html: string } | null> {
    let oid: ObjectId;
    try { oid = new ObjectId(id); } catch { return null; }
    const db = await getDb();
    const P = await db.collection('properties').findOne({ _id: oid });
    if (!P) return null;
    const val = num(dig(P, 'listing', 'value'));
    const m2 = num(dig(P, 'attributes', 'totalSurface')) ?? num(dig(P, 'attributes', 'surface'));
    const col = (dig(P, 'address', 'neighborhood', 'name') as string) ?? null;
    const street = (dig(P, 'address', 'street') as string)?.trim() || null;
    const city = (dig(P, 'address', 'city', 'name') as string) ?? null;
    const state = (dig(P, 'address', 'state', 'name') as string) ?? null;
    const typ = (P.type as string) ?? null;
    const ppm2 = val && m2 ? val / m2 : null;
    const code = (P.internalId as string) ?? id;
    const myLoc = (dig(P, 'address', 'location', 'coordinates') as number[]) || [];
    const subj: Subj = {
        oid, typ, city, state, val, m2, ppm2, col,
        rec: num(dig(P, 'attributes', 'suites')),
        lat: typeof myLoc[1] === 'number' ? myLoc[1] : null, lng: typeof myLoc[0] === 'number' ? myLoc[0] : null,
        myAmen: svcAmen(P), street
    };
    const alcPool = await buildAlcPool(db, subj);
    const knownCols = knownColsOf(alcPool, subj);
    const alcRanked = orderNamedFirst(rankAlcance(alcPool, subj), knownCols);
    const alcInsights = alcGeneralInsights(alcRanked, subj);
    const backHref = `/ficha/${encodeURIComponent(id)}${opts?.token ? `?token=${encodeURIComponent(opts.token)}` : ''}`;
    const html = `
<style>
.ficha-root{width:816px;margin:0 auto;background:#fff;padding:40px 44px;color:${BLK};font-family:'Nunito Sans',sans-serif;font-size:12px;line-height:1.45;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.ficha-root h1{font-family:'EB Garamond',serif;font-weight:400;font-size:30px;line-height:1;margin:0}
.ficha-root .eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${GRY}}
.ficha-root .accent{width:50px;height:1px;background:${YEL};margin:8px 0 14px}
.ficha-root table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}.ficha-root th,.ficha-root td{text-align:left;padding:5px 6px;border-bottom:1px solid ${LGT};vertical-align:top}
.ficha-root td.nw{white-space:nowrap}.ficha-root th{font-weight:700;color:${GRY};text-transform:uppercase;font-size:9px;letter-spacing:.06em}
.ficha-root .box{background:${LGT};padding:16px 18px;margin-top:16px}.ficha-root ul{margin-left:16px}.ficha-root li{margin:4px 0;list-style:disc}
@media print{.ficha-root{margin:0;padding:24px 30px}.fx-noprint{display:none!important}@page{size:Letter;margin:0}}
</style>
<div class="ficha-root">
  <div class="eyebrow" style="color:${SEA}">Qué te alcanza por el mismo presupuesto · ${esc(code)}</div>
  <h1>${esc(street || code)}</h1>
  <div style="font-size:12px;color:${GRY};margin-top:6px">${esc(typ)} · ${esc(col)}, ${esc(city)} · ${money(val)} · ${m2 ?? '—'} m² · ${money(ppm2)}/m²</div>
  <div class="fx-noprint" style="margin-top:8px"><a href="${backHref}" style="color:${SEA};font-weight:700;font-size:11px">← Volver a la ficha</a></div>
  <div class="accent" style="margin-top:14px"></div>
  <div style="font-size:11px;color:${GRY};margin-bottom:4px">${alcRanked.length} comparables vivos en tu mismo rango de precio (±10%) y hasta 1.5 km, ordenados de más a menos parecidos a tu inmueble.</div>
  <table><tr><th>Inmueble</th><th>Precio</th><th>Sup.</th><th>Rec/Baños</th><th>Por qué es comparable</th></tr>${alcTblRows(alcRanked, subj, knownCols)}</table>
  ${amenCompareHtml(alcRanked, subj, knownCols)}
  ${alcInsights.length ? `<div class="box"><div class="eyebrow">Insights de comparables</div><ul>${alcInsights.map((i) => `<li>${i}</li>`).join('')}</ul></div>` : ''}
</div>`;
    return { code, html };
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
