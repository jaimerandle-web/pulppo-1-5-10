// Buscador de propiedades + expediente (/propiedad). SOLO interno.
//
// El buscador acepta lo que la gente tiene a la mano: el código de Pulppo (DMA-014, dma014), el _id
// largo, el id de cualquier portal (i24, MeLi, propiedades.com, EasyBroker, Casas y Terrenos,
// Ciencuadras) o directamente la LIGA del aviso. Si el código no es nuestro pero existe en el MLS,
// lo dice y enseña de quién es.
//
// El expediente junta en una pantalla lo operativo: códigos y estado de cada portal, estatus de la
// propiedad y de cada operación, funnel, con qué lead y por qué fuente se cerró (la MISMA regla que
// /portales: resolverFuentes), duplicados en el mercado y una línea de tiempo.
import { ObjectId, type Document, type Filter } from 'mongodb';
import { getDb } from './data';
import { classifySource, KEY2NAME, dig, isDate } from './portales/metrics';
import { resolverFuentes, type FuenteCierre } from './portales/fuenteCierre';
import { canalContacto } from './portales/inmobiliaria';
import { duplicadosDe, esObjectId, portalDe, type Duplicado } from './duplicados';
import { revisarAviso, type ErrorOrto } from './ortografia';

// ── vocabulario ──────────────────────────────────────────────────────────
export const ESTATUS_PROP: Record<string, string> = {
    valuation: 'En valuación', edition: 'En edición', documentation: 'En documentación', published: 'Publicada',
    completed: 'Vendida / rentada', cancelled: 'Cancelada',
};
export const ESTATUS_OP: Record<string, string> = {
    offer: 'Oferta', offer_blocked: 'Oferta aceptada', contract: 'Contrato', paying: 'Cobrando', closed: 'Cerrada · cobrada', cancelled: 'Cancelada',
};
const LADO: Record<string, string> = { both: 'Ambos lados', seller: 'Lado vendedor', buyer: 'Lado comprador' };
const TIER_I24: Record<string, string> = {
    HOME_COMBO: 'Súper destacado', HOME_COMBO_ZONA_DEMAND: 'Súper destacado · zona demand',
    DESTACADO_COMBO: 'Destacado', DESTACADO_COMBO_ZONA_DEMAND: 'Destacado · zona demand',
    SIMPLE_COMBO: 'Simple', GRATIS: 'Gratis', GRATIS_COMBO: 'Gratis', OFFLINE: 'Offline',
};
// precio de lista por aviso al mes (mismos que /portales y Marketing de /mb)
const COSTO_I24: Record<string, number> = {
    HOME_COMBO_ZONA_DEMAND: 785, HOME_COMBO: 523.48, DESTACADO_COMBO_ZONA_DEMAND: 420, DESTACADO_COMBO: 315, SIMPLE_COMBO: 15, OFFLINE: 15,
};
const TIER_ML: Record<string, string> = { gold_premium: 'Oro Premium', gold_pro: 'Oro Pro', gold: 'Oro', silver: 'Plata', bronze: 'Bronce', free: 'Gratuito' };

const s = (x: unknown) => String(x ?? '').trim();
const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const nombre = (o: unknown) => [dig(o, 'firstName'), dig(o, 'lastName')].map(s).filter(Boolean).join(' ').replace(/\s+/g, ' ');
const fecha = (x: unknown): Date | null => (x instanceof Date && !isNaN(x.getTime()) ? x : typeof x === 'string' && !isNaN(Date.parse(x)) ? new Date(x) : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const DIA = 86400000;

// ── búsqueda ─────────────────────────────────────────────────────────────
export interface Coincidencia {
    id: string; internalId: string | null; titulo: string; inmobiliaria: string; estatus: string;
    operacion: string; precio: number | null; colonia: string; campo: string;
}
export interface AvisoMercado { portal: string; quien: string; precio: number | null; titulo: string; colonia: string; url: string | null; operacion: string }
export interface ResultadoBusqueda { q: string; interpretado: string; coincidencias: Coincidencia[]; mercado: AvisoMercado[] }

type Intento = { campo: string; filtro: Filter<Document> };

/** Qué buscar a partir de lo que se pegó: un código, un id de portal o una URL. */
function interpretar(raw: string): { texto: string; intentos: Intento[]; mls: Filter<Document>[] } {
    const q = raw.trim();
    const intentos: Intento[] = [], mls: Filter<Document>[] = [];
    const numInt = (d: string) => [d, Number(d)];
    const porNumero = (d: string) => {
        intentos.push({ campo: 'ID Inmuebles24', filtro: { 'portals.inmuebles24.id': { $in: numInt(d) } } });
        intentos.push({ campo: 'ID Propiedades.com', filtro: { 'portals.propiedadesDotCom.id': { $in: numInt(d) } } });
        intentos.push({ campo: 'ID Casas y Terrenos', filtro: { 'portals.casas-y-terrenos.id': { $in: numInt(d) } } });
        intentos.push({ campo: 'ID Ciencuadras', filtro: { 'portals.ciencuadras.id': { $in: numInt(d) } } });
        intentos.push({ campo: 'ID Mercado Libre', filtro: { 'portals.mercadolibre.id': `MLM${d}` } });
        // los avisos de i24 cambian de id al republicarse: el viejo queda en el historial
        intentos.push({ campo: 'ID Inmuebles24 (aviso anterior)', filtro: { 'portals.inmuebles24.history.idAvisoNavplat': { $in: numInt(d) } } });
        mls.push({ 'import.id': { $in: numInt(d) } });
    };

    if (/^https?:\/\/|www\.|\.com|\.mx/i.test(q)) {
        let u = q;
        try { u = decodeURIComponent(q); } catch { /* tal cual */ }
        const sinQuery = u.split(/[?#]/)[0];
        mls.push({ 'import.url': { $in: [u, sinQuery, sinQuery.replace(/^http:/, 'https:'), sinQuery.replace(/^https:/, 'http:')] } });
        const pulppo = sinQuery.match(/(?:pulppo\.com|pulppo-inmobiliarias[^/]*|localhost[^/]*)\/(?:propiedades?|ficha)\/([^/?#]+)/i);
        const ml = u.match(/MLM-?(\d{6,})/i);
        const eb = u.match(/\b(EB-[A-Z0-9]{3,})\b/i);
        if (pulppo) return { ...interpretar(pulppo[1]), mls };
        if (ml) return { texto: `ID Mercado Libre MLM${ml[1]}`, intentos: [{ campo: 'ID Mercado Libre', filtro: { 'portals.mercadolibre.id': `MLM${ml[1]}` } }], mls: [...mls, { 'import.id': { $in: [`MLM${ml[1]}`, ml[1]] } }] };
        if (eb) return { ...interpretar(eb[1].toUpperCase()), mls };
        if (/inmuebles24/i.test(u)) { const m = sinQuery.match(/-(\d{6,})\.html/i) ?? sinQuery.match(/(\d{7,})/); if (m) { porNumero(m[1]); return { texto: `ID Inmuebles24 ${m[1]}`, intentos, mls }; } }
        if (/casasyterrenos/i.test(u)) { const m = sinQuery.match(/propiedad\/(\d+)/i); if (m) { porNumero(m[1]); return { texto: `ID Casas y Terrenos ${m[1]}`, intentos, mls }; } }
        // propiedades.com y cualquier otra: el número largo al final
        const m = sinQuery.match(/(\d{6,})(?!.*\d{6,})/);
        if (m) { porNumero(m[1]); return { texto: `número ${m[1]} de la liga`, intentos, mls }; }
        return { texto: 'liga', intentos, mls };
    }
    if (esObjectId(q)) return { texto: 'ID de Pulppo', intentos: [{ campo: 'ID de Pulppo', filtro: { _id: new ObjectId(q) } }], mls };
    const cod = q.toUpperCase().replace(/\s+/g, '').match(/^([A-Z][A-Z0-9][A-Z])-?(\d{3})$/);
    if (cod) return { texto: `código ${cod[1]}-${cod[2]}`, intentos: [{ campo: 'Código Pulppo', filtro: { internalId: `${cod[1]}-${cod[2]}` } }], mls };
    const ml = q.match(/^MLM-?(\d+)$/i);
    if (ml) return { texto: `ID Mercado Libre MLM${ml[1]}`, intentos: [{ campo: 'ID Mercado Libre', filtro: { 'portals.mercadolibre.id': `MLM${ml[1]}` } }], mls: [{ 'import.id': { $in: [`MLM${ml[1]}`, ml[1]] } }] };
    if (/^EB-[A-Z0-9]+$/i.test(q)) {
        const v = q.toUpperCase();
        return { texto: `ID EasyBroker ${v}`, intentos: [{ campo: 'ID EasyBroker', filtro: { $or: [{ 'portals.easybroker.id': v }, { 'portals.companyEasybroker.id': v }] } }], mls: [{ referenceCode: v }, { 'import.id': v }] };
    }
    const d = q.replace(/\D/g, '');
    if (d.length >= 5 && d.length === q.replace(/[\s-]/g, '').length) { porNumero(d); return { texto: `número ${d}`, intentos, mls }; }
    return { texto: 'texto', intentos: [{ campo: 'Código Pulppo', filtro: { internalId: q.toUpperCase() } }], mls };
}

const PROJ_LISTA = { internalId: 1, 'listing.title': 1, 'listing.operation': 1, 'listing.value': 1, 'company.name': 1, 'status.last': 1, 'address.neighborhood.name': 1 };

export async function buscarPropiedad(raw: string): Promise<ResultadoBusqueda> {
    const { texto, intentos, mls } = interpretar(raw);
    const db = await getDb();
    const vistos = new Map<string, Coincidencia>();
    // los indexados primero; el historial de i24 (sin índice) sólo si nada más pegó
    const [rapidos, lentos] = [intentos.filter((i) => !i.campo.includes('anterior')), intentos.filter((i) => i.campo.includes('anterior'))];
    const corre = async (xs: Intento[]) => {
        const res = await Promise.all(xs.map((i) => db.collection('properties').find(i.filtro, { projection: PROJ_LISTA, limit: 20 }).toArray().then((ds) => ds.map((d) => [i.campo, d] as const)).catch(() => [])));
        for (const [campo, d] of res.flat()) {
            const id = String(d._id);
            if (vistos.has(id)) continue;
            vistos.set(id, {
                id, internalId: (d.internalId as string) || null, titulo: s(dig(d, 'listing', 'title')), inmobiliaria: s(dig(d, 'company', 'name')),
                estatus: ESTATUS_PROP[s(dig(d, 'status', 'last'))] ?? s(dig(d, 'status', 'last')), operacion: dig(d, 'listing', 'operation') === 'rent' ? 'Renta' : 'Venta',
                precio: n(dig(d, 'listing', 'value')), colonia: s(dig(d, 'address', 'neighborhood', 'name')), campo,
            });
        }
    };
    await corre(rapidos);
    if (!vistos.size && lentos.length) await corre(lentos);

    // ¿no es nuestra? búscala en el MLS para decir de quién es
    const mercado: AvisoMercado[] = [];
    if (!vistos.size && mls.length) {
        const ds = await db.collection('mls').find({ $or: mls }, { projection: { 'import.source': 1, 'import.url': 1, 'company.name': 1, agent: 1, 'listing.value': 1, 'listing.title': 1, 'listing.operation': 1, 'address.neighborhood.name': 1 }, limit: 10 }).toArray().catch(() => []);
        for (const d of ds) {
            const empresa = s(dig(d, 'company', 'name')), asesor = nombre(d.agent);
            mercado.push({
                portal: portalDe(dig(d, 'import', 'source')), quien: [empresa, asesor && asesor.toLowerCase() !== empresa.toLowerCase() ? asesor : ''].filter(Boolean).join(' · ') || '—',
                precio: n(dig(d, 'listing', 'value')), titulo: s(dig(d, 'listing', 'title')), colonia: s(dig(d, 'address', 'neighborhood', 'name')),
                url: s(dig(d, 'import', 'url')) || null, operacion: dig(d, 'listing', 'operation') === 'rent' ? 'Renta' : 'Venta',
            });
        }
    }
    return { q: raw, interpretado: texto, coincidencias: [...vistos.values()], mercado };
}

// ── expediente ───────────────────────────────────────────────────────────
export interface PortalFila { portal: string; id: string | null; estatus: string | null; nivel: string | null; costoMes: number | null; url: string | null; error: string | null; nota: string | null }
export interface OperacionFila {
    id: string; codigo: string; estatus: string; estatusKey: string; lado: string; creada: string | null; cerrada: string | null;
    valor: number | null; comision: number | null; regalia: number | null;
    comprador: string; asesorComprador: string; inmoComprador: string; asesorVendedor: string; inmoVendedora: string;
    fuente: FuenteCierre | null;
    lead: { fecha: string; fuente: string; asesor: string; mismaPropiedad: boolean } | null;
    historia: Array<{ estatus: string; t: string }>;
}
export interface Evento { t: string; tipo: 'Propiedad' | 'Operación' | 'Precio' | 'Inmuebles24' | 'Contrato' | 'Funnel'; texto: string; tono?: 'ok' | 'mal' | 'neutro' }
export interface Expediente {
    id: string; internalId: string | null; titulo: string; tipo: string; operacion: 'Venta' | 'Renta';
    precio: number | null; moneda: string; m2: number | null; rec: number | null; banos: number | null; foto: string | null;
    direccion: { calle: string; colonia: string; ciudad: string; estado: string };
    inmobiliaria: { id: string | null; nombre: string };
    asesor: { nombre: string; correo: string; telefono: string; activo: boolean | null; whatsapp: boolean | null };
    estatus: { key: string; label: string; activa: boolean; desde: string | null; primeraPublicacion: string | null; diasPublicada: number | null };
    /** la operación más avanzada viva (o la última cerrada) */
    estatusOperacion: { key: string; label: string; codigo: string } | null;
    contrato: { comision: number | null; ivaIncluido: boolean; estatus: string | null; exclusiva: { inicio: string; fin: string | null; vigente: boolean; firmada: boolean } | null; en1510: string | null };
    material: { fotos: number; video: boolean; tour: boolean; calidad: string | null };
    portales: PortalFila[];
    funnel: {
        vistas: number; leads: number; leadsUnicos: number; leads30: number; leads90: number; ultimoLead: string | null;
        porFuente: Array<{ fuente: string; n: number }>;
        wa: { base: number; sinRespuesta: number };
        visitas: number; visitasPendientes: number; ofertas: number;
    };
    operaciones: OperacionFila[];
    duplicados: Duplicado[];
    ortografia: ErrorOrto[];
    linea: Evento[];
    links: { ficha: string; publica: string; mb: string | null };
}

const PLACEHOLDER = /^(el cliente )?(vio|ver) (el )?tel[eé]fono\.?$|^vio el anuncio\.?$|^contact[oó] por whats?app\.?$|^es un lead de (tel[eé]fono|whats?app)\.?$/i;
const msgReal = (m: string) => ({ $and: [
    { $eq: [`${m}.from`, 'client'] },
    { $gt: [{ $strLenCP: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } } }, 0] },
    { $not: [{ $regexMatch: { input: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } }, regex: PLACEHOLDER.source, options: 'i' } }] },
] });
const telValido = (p: unknown) => { const d = s(p).replace(/\D/g, '').slice(-10); return d.length === 10 && !/^(\d)\1{9}$/.test(d); };

const errorTxt = (e: unknown): string | null => {
    if (e == null || e === '' || (Array.isArray(e) && !e.length)) return null;
    let t = typeof e === 'string' ? e : s(dig(e, 'message')) || JSON.stringify(e);
    try { const j = JSON.parse(t); t = s(dig(j, 'error')) || s(dig(j, 'message')) || t; } catch { /* no es JSON */ }
    return t.length > 180 ? `${t.slice(0, 180)}…` : t;
};
const ESTATUS_PORTAL: Record<string, string> = { online: 'En línea', offline: 'Fuera de línea', pending: 'Pendiente', error: 'Con error', paused: 'Pausado', closed: 'Cerrado', active: 'En línea', inactive: 'Fuera de línea' };
const estatusPortal = (x: unknown) => { const v = s(x); return v ? ESTATUS_PORTAL[v.toLowerCase()] ?? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : null; };

export async function expediente(idRaw: string): Promise<Expediente | null> {
    const db = await getDb();
    const id = decodeURIComponent(idRaw).trim();
    const P = esObjectId(id)
        ? await db.collection('properties').findOne({ _id: new ObjectId(id) })
        : await db.collection('properties').findOne({ internalId: id.toUpperCase() });
    if (!P) return null;
    const oid = P._id as ObjectId;
    const now = Date.now();

    // ── portales ──
    const pt = (P.portals ?? {}) as Record<string, Document>;
    const portales: PortalFila[] = [];
    const i24 = pt.inmuebles24;
    if (i24 && (i24.id || i24.status || i24.type)) {
        const t = s(i24.type);
        const hist = ((i24.history as Document[]) ?? []).filter((h) => h?.idAvisoNavplat && String(h.idAvisoNavplat) !== s(i24.id));
        const viejos = [...new Set(hist.map((h) => String(h.idAvisoNavplat)))];
        portales.push({ portal: 'Inmuebles24', id: s(i24.id) || null, estatus: estatusPortal(i24.status), nivel: TIER_I24[t] ?? (t || null),
            costoMes: COSTO_I24[t] ?? null, url: s(i24.url) || null, error: errorTxt(i24.lastError) ?? errorTxt(i24.errors),
            nota: [n(i24.quality) != null ? `Calidad ${Math.round(i24.quality as number)}/100` : '', viejos.length ? `Avisos anteriores: ${viejos.slice(-4).join(', ')}` : ''].filter(Boolean).join(' · ') || null });
    }
    const ml = pt.mercadolibre;
    if (ml && (ml.id || ml.status)) {
        const fin = fecha(ml.endTime);
        portales.push({ portal: 'Mercado Libre', id: s(ml.id) || null, estatus: estatusPortal(ml.status), nivel: TIER_ML[s(ml.type)] ?? (s(ml.type) || null),
            costoMes: null, url: s(ml.url) || null, error: errorTxt(ml.lastError), nota: fin ? `Vence ${fin.toISOString().slice(0, 10)}` : null });
    }
    const pc = pt.propiedadesDotCom;
    if (pc && (pc.id || pc.status)) portales.push({ portal: 'Propiedades.com', id: s(pc.id) || null, estatus: estatusPortal(pc.status), nivel: null, costoMes: null, url: s(pc.url) || null, error: errorTxt(pc.lastError) ?? errorTxt(pc.error), nota: null });
    const eb = pt.easybroker;
    if (eb && (eb.id || eb.status)) portales.push({ portal: 'EasyBroker', id: s(eb.id) || null, estatus: estatusPortal(eb.status), nivel: null, costoMes: null, url: s(eb.url) && s(eb.url) !== 'None' ? s(eb.url) : null, error: errorTxt(eb.lastError), nota: pt.companyEasybroker?.id ? `Cuenta de la inmobiliaria: ${s(pt.companyEasybroker.id)}` : null });
    const cyt = pt['casas-y-terrenos'];
    if (cyt && (cyt.id || cyt.status)) portales.push({ portal: 'Casas y Terrenos', id: s(cyt.id) || null, estatus: estatusPortal(cyt.status), nivel: null, costoMes: null, url: s(cyt.url) || null, error: errorTxt(cyt.lastError) ?? errorTxt(cyt.error), nota: null });
    const cc = pt.ciencuadras;
    if (cc && (cc.id || cc.status)) portales.push({ portal: 'Ciencuadras', id: s(cc.id) || null, estatus: estatusPortal(cc.status), nivel: null, costoMes: null, url: s(cc.url) || null, error: errorTxt(cc.error), nota: null });
    const la = pt.lamudi;
    if (la && la.url) portales.push({ portal: 'Lamudi', id: null, estatus: la.publish === false ? 'No publica' : 'Feed', nivel: s(la.status) ? s(la.status).charAt(0) + s(la.status).slice(1).toLowerCase() : null, costoMes: null, url: s(la.url), error: null, nota: null });
    const feeds = ['trovit', 'icasas', 'mitula', 'nuroa', 'nestoria'].filter((k) => pt[k]?.url);
    if (feeds.length) portales.push({ portal: 'Feeds', id: null, estatus: 'Feed', nivel: null, costoMes: null, url: null, error: null, nota: feeds.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ') });

    // ── leads ──
    const leads = (await db.collection('leads').find({ 'property._id': oid }, { projection: { source: 1, medium: 1, message: 1, createdAt: 1, 'contact._id': 1, phone: 1, 'contact.phone': 1, interaction: 1, 'agent.firstName': 1, 'agent.lastName': 1 } }).toArray())
        .filter((l) => s(l.source).toLowerCase() !== 'formulario de contacto' && isDate(l.createdAt));
    const porFuente = new Map<string, number>();
    for (const l of leads) { const k = classifySource(l.source as string); const f = KEY2NAME[k] ?? 'Otros'; porFuente.set(f, (porFuente.get(f) ?? 0) + 1); }
    const unicos = new Set(leads.map((l) => s(dig(l, 'contact', '_id')) || String(l._id)));
    // «Sin respuesta · WhatsApp»: misma regla que /portales — lead por WhatsApp con teléfono válido y sin
    // conversación real en su interacción ni en otra del mismo contacto de −30 a +14 días.
    const wa = leads.filter((l) => canalContacto({ medium: l.medium, message: l.message }) === 'whatsapp' && telValido(s(l.phone) || s(dig(l, 'contact', 'phone'))));
    let sinResp = 0;
    if (wa.length) {
        const cids = [...new Set(wa.map((l) => dig(l, 'contact', '_id')).filter((x): x is ObjectId => x instanceof ObjectId))];
        const conv = new Map<string, number[]>();
        for (let i = 0; i < cids.length; i += 500) {
            const cur = db.collection('interactions').aggregate([
                { $match: { 'contact._id': { $in: cids.slice(i, i + 500) } } },
                { $project: { c: '$contact._id', t: '$createdAt', real: { $or: [
                    { $gt: [{ $size: { $ifNull: ['$calls', []] } }, 0] },
                    { $anyElementTrue: [{ $map: { input: { $ifNull: ['$messages', []] }, as: 'm', in: msgReal('$$m') } }] },
                ] } } },
                { $match: { real: true } },
            ]);
            for await (const it of cur) if (isDate(it.t)) (conv.get(String(it.c)) ?? conv.set(String(it.c), []).get(String(it.c))!).push(it.t.getTime());
        }
        for (const l of wa) {
            const t = (l.createdAt as Date).getTime();
            const ts = conv.get(s(dig(l, 'contact', '_id'))) ?? [];
            if (!ts.some((x) => x >= t - 30 * DIA && x <= t + 14 * DIA)) sinResp++;
        }
    }

    // ── vistas, visitas, operaciones ──
    const [vistasAgg, visAgg, opsRaw, agente] = await Promise.all([
        db.collection('metrics').aggregate([{ $match: { property: { $in: [oid, String(oid)] }, type: 'view' } }, { $count: 'n' }]).toArray(),
        db.collection('visits').aggregate([
            { $match: { 'steps.property._id': oid, 'status.last': { $ne: 'cancelled' } } },
            { $group: { _id: { $ifNull: ['$contact._id', '$_id'] }, conf: { $max: { $cond: [{ $eq: ['$status.last', 'confirmed'] }, 1, 0] } }, t: { $min: '$startTime' } } },
        ]).toArray(),
        db.collection('operations').find({ 'property._id': oid }, { projection: {
            id: 1, side: 1, status: 1, createdAt: 1, closedAt: 1, cancelledAt: 1, 'closeValue.value': 1, 'comission.value': 1, 'pulppoComission.value': 1,
            'property._id': 1, 'buyer.source': 1, 'buyer.search': 1, 'buyer.contact': 1, 'buyer.broker': 1, 'buyer.company._id': 1, 'buyer.company.name': 1,
            'buyer.company.external': 1, 'seller.company._id': 1, 'seller.company.name': 1, 'seller.company.external': 1, 'seller.broker.firstName': 1, 'seller.broker.lastName': 1,
        } }).sort({ createdAt: -1 }).toArray(),
        P.agent && dig(P, 'agent', '_id') ? db.collection('agents').findOne({ _id: dig(P, 'agent', '_id') as ObjectId }, { projection: { status: 1, deletedAt: 1, whatsapp: 1 } }) : null,
    ]);
    const OFERTA = new Set(['offer', 'offer_blocked', 'contract', 'paying', 'closed']);
    const ofertas = opsRaw.filter((o) => OFERTA.has(s(dig(o, 'status', 'last'))) || ((dig(o, 'status', 'history') as Document[]) ?? []).some((h) => OFERTA.has(s(h?.status)))).length;

    // fuente de los cierres: la misma regla que /portales (vista de red)
    const conCierre = opsRaw.filter((o) => ['closed', 'paying'].includes(s(dig(o, 'status', 'last'))) && isDate(o.closedAt));
    const fuentes = conCierre.length ? await resolverFuentes(conCierre, {
        esNuestra: (o) => {
            const bc = s(dig(o, 'buyer', 'company', '_id'));
            const sExt = dig(o, 'seller', 'company', 'external') === true || !dig(o, 'seller', 'company', '_id');
            return !!bc && (bc === s(dig(o, 'seller', 'company', '_id')) || (sExt && dig(o, 'buyer', 'company', 'external') !== true));
        },
        compsComprador: (o) => new Set([s(dig(o, 'buyer', 'company', '_id'))]),
        compsVendedora: (o) => new Set([s(dig(o, 'seller', 'company', '_id'))]),
    }) : new Map<string, FuenteCierre>();

    // con qué lead llegó el comprador: primero sobre ESTA propiedad; si no, su primer lead con la inmobiliaria que lo trajo
    const compradores = [...new Set(opsRaw.map((o) => dig(o, 'buyer', 'contact', '_id')).filter((x): x is ObjectId => x instanceof ObjectId))];
    const leadsComprador = compradores.length
        ? await db.collection('leads').find({ 'contact._id': { $in: compradores } }, { projection: { 'contact._id': 1, 'property._id': 1, 'company._id': 1, source: 1, createdAt: 1, 'agent.firstName': 1, 'agent.lastName': 1 } }).sort({ createdAt: 1 }).toArray()
        : [];
    const fuenteLead = (src: unknown) => { const k = classifySource(src as string); return KEY2NAME[k] ?? (s(src) || 'Sin fuente'); };

    const operaciones: OperacionFila[] = opsRaw.map((o) => {
        const key = s(dig(o, 'status', 'last'));
        const fin = fecha(o.closedAt) ?? fecha(o.cancelledAt);
        const cid = s(dig(o, 'buyer', 'contact', '_id')), bc = s(dig(o, 'buyer', 'company', '_id'));
        const tope = fin ?? new Date();
        const suyos = leadsComprador.filter((l) => s(dig(l, 'contact', '_id')) === cid && (l.createdAt as Date) <= tope);
        const l = suyos.find((x) => s(dig(x, 'property', '_id')) === String(oid)) ?? suyos.find((x) => s(dig(x, 'company', '_id')) === bc) ?? suyos[0];
        return {
            id: String(o._id), codigo: s(o.id) || String(o._id).slice(-8), estatus: ESTATUS_OP[key] ?? key, estatusKey: key, lado: LADO[s(o.side)] ?? s(o.side),
            creada: iso(fecha(o.createdAt)), cerrada: iso(fecha(o.closedAt)),
            valor: n(dig(o, 'closeValue', 'value')), comision: n(dig(o, 'comission', 'value')), regalia: n(dig(o, 'pulppoComission', 'value')),
            comprador: nombre(dig(o, 'buyer', 'contact')) || '—', asesorComprador: nombre(dig(o, 'buyer', 'broker')) || '—',
            inmoComprador: s(dig(o, 'buyer', 'company', 'name')) || (dig(o, 'buyer', 'company', 'external') === true ? 'Externa' : '—'),
            asesorVendedor: nombre(dig(o, 'seller', 'broker')) || '—', inmoVendedora: s(dig(o, 'seller', 'company', 'name')) || '—',
            fuente: fuentes.get(String(o._id)) ?? null,
            lead: l ? { fecha: (l.createdAt as Date).toISOString(), fuente: fuenteLead(l.source), asesor: nombre(l.agent) || '—', mismaPropiedad: s(dig(l, 'property', '_id')) === String(oid) } : null,
            historia: ((dig(o, 'status', 'history') as Document[]) ?? []).map((h) => ({ estatus: ESTATUS_OP[s(h?.status)] ?? s(h?.status), t: iso(fecha(h?.timestamp)) ?? '' }))
                .filter((h) => h.t).sort((a, b) => a.t.localeCompare(b.t)),
        };
    });
    const ORDEN_OP = ['contract', 'offer_blocked', 'offer', 'paying', 'closed'];
    const viva = [...operaciones].filter((o) => o.estatusKey !== 'cancelled').sort((a, b) => ORDEN_OP.indexOf(a.estatusKey) - ORDEN_OP.indexOf(b.estatusKey))[0];

    // ── estatus de la propiedad ──
    const hist = ((dig(P, 'status', 'history') as Document[]) ?? []).map((h) => ({ st: s(h?.status), t: fecha(h?.timestamp) })).filter((h): h is { st: string; t: Date } => !!h.t).sort((a, b) => a.t.getTime() - b.t.getTime());
    const stKey = s(dig(P, 'status', 'last'));
    const desde = [...hist].reverse().find((h) => h.st === stKey)?.t ?? null;
    const primeraPub = hist.find((h) => h.st === 'published')?.t ?? fecha(P.publishedAt);

    // ── contrato ──
    const exIni = fecha(dig(P, 'contract', 'exclusive', 'start'));
    const exDur = n(dig(P, 'contract', 'exclusive', 'durationMonths'));
    const exFin = exIni && exDur ? new Date(Date.UTC(exIni.getUTCFullYear(), exIni.getUTCMonth() + exDur, exIni.getUTCDate())) : null;
    const cStatus = s(dig(P, 'contract', 'status')) || null;

    // ── duplicados y ortografía ──
    const [duplicados, ortografia] = await Promise.all([
        duplicadosDe(P).catch(() => [] as Duplicado[]),
        revisarAviso({ titulo: dig(P, 'listing', 'title') as string, descripcion: dig(P, 'listing', 'description') as string, calle: dig(P, 'address', 'street') }).catch(() => [] as ErrorOrto[]),
    ]);

    // ── línea de tiempo ──
    const linea: Evento[] = [];
    for (const h of hist) linea.push({ t: h.t.toISOString(), tipo: 'Propiedad', texto: ESTATUS_PROP[h.st] ?? h.st, tono: h.st === 'cancelled' ? 'mal' : h.st === 'completed' ? 'ok' : 'neutro' });
    const precios = ((dig(P, 'listing', 'priceHistory') as Document[]) ?? []).map((p) => ({ v: n(p?.price), t: fecha(p?.timestamp), cur: s(p?.currency) || 'MXN' }))
        .filter((p): p is { v: number; t: Date; cur: string } => p.v != null && !!p.t).sort((a, b) => a.t.getTime() - b.t.getTime());
    for (let i = 0; i < precios.length; i++) {
        const prev = precios[i - 1];
        if (prev && prev.v === precios[i].v) continue;
        const fmt = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
        linea.push({ t: precios[i].t.toISOString(), tipo: 'Precio', texto: prev ? `${fmt(prev.v)} → ${fmt(precios[i].v)} (${precios[i].v < prev.v ? '' : '+'}${(((precios[i].v / prev.v) - 1) * 100).toFixed(1)}%)` : `Precio inicial ${fmt(precios[i].v)}`, tono: prev && precios[i].v < prev.v ? 'ok' : 'neutro' });
    }
    // Nivel en i24: OFFLINE se ignora (bug de la API key de i24: el aviso sigue publicado y se cobra como
    // Simple) y cuenta sólo el ÚLTIMO estado de cada día — el reordenamiento lo mueve varias veces al día.
    const porDia = new Map<string, { t: Date; lbl: string }>();
    for (const h of ((i24?.history as Document[]) ?? []).map((x) => ({ t: fecha(x?.timestamp), type: s(x?.type).toUpperCase(), st: s(x?.status) })).filter((x) => x.t).sort((a, b) => a.t!.getTime() - b.t!.getTime())) {
        if (h.type === 'OFFLINE' || (h.st && !/^online$/i.test(h.st))) continue;
        const lbl = TIER_I24[h.type] ?? TIER_I24[`${h.type}_COMBO`] ?? h.type;
        if (lbl) porDia.set(new Date(h.t!.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10), { t: h.t!, lbl });
    }
    let ultimoTier = '';
    for (const { t: tt, lbl } of porDia.values()) {
        if (lbl === ultimoTier) continue;
        ultimoTier = lbl;
        linea.push({ t: tt.toISOString(), tipo: 'Inmuebles24', texto: lbl, tono: 'neutro' });
    }
    for (const o of operaciones) for (const h of o.historia) linea.push({ t: h.t, tipo: 'Operación', texto: `${o.codigo} · ${h.estatus}`, tono: /cancel/i.test(h.estatus) ? 'mal' : /cerrada|cobrando|aceptada/i.test(h.estatus) ? 'ok' : 'neutro' });
    if (exIni) linea.push({ t: exIni.toISOString(), tipo: 'Contrato', texto: `Inicia exclusiva${exDur ? ` · ${exDur} meses` : ''}`, tono: 'neutro' });
    if (exFin && exFin.getTime() <= now) linea.push({ t: exFin.toISOString(), tipo: 'Contrato', texto: 'Vence la exclusiva', tono: 'mal' });
    const en1510 = fecha(dig(P, 'contract', 'exclusive', 'pulppo'));
    if (en1510) linea.push({ t: en1510.toISOString(), tipo: 'Contrato', texto: 'Entra al programa 1·5·10', tono: 'ok' });
    const ordLeads = [...leads].sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
    if (ordLeads.length) linea.push({ t: (ordLeads[0].createdAt as Date).toISOString(), tipo: 'Funnel', texto: `Primer lead · ${fuenteLead(ordLeads[0].source)}`, tono: 'neutro' });
    const visFechas = visAgg.map((v) => fecha(v.t)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
    if (visFechas.length) linea.push({ t: visFechas[0].toISOString(), tipo: 'Funnel', texto: 'Primera visita', tono: 'neutro' });
    linea.sort((a, b) => b.t.localeCompare(a.t));

    const fotos = ((P.pictures as Document[]) ?? []).filter((x) => x?.public !== false);
    const foto = fotos.length ? s(fotos[0].url ?? fotos[0].src ?? fotos[0].original) || null : null;
    const companyId = s(dig(P, 'company', '_id')) || null;
    const ultimo = ordLeads.length ? (ordLeads[ordLeads.length - 1].createdAt as Date) : null;
    const dentro = (d: number) => leads.filter((l) => now - (l.createdAt as Date).getTime() <= d * DIA).length;
    const qs = n(P.qualityScore);

    return {
        id: String(oid), internalId: (P.internalId as string) || null, titulo: s(dig(P, 'listing', 'title')), tipo: s(P.type),
        operacion: dig(P, 'listing', 'operation') === 'rent' ? 'Renta' : 'Venta',
        precio: n(dig(P, 'listing', 'value')), moneda: s(dig(P, 'listing', 'price', 'currency')) || 'MXN',
        m2: n(dig(P, 'attributes', 'totalSurface')) ?? n(dig(P, 'attributes', 'roofedSurface')), rec: n(dig(P, 'attributes', 'suites')), banos: n(dig(P, 'attributes', 'bathrooms')), foto,
        direccion: { calle: s(dig(P, 'address', 'street')), colonia: s(dig(P, 'address', 'neighborhood', 'name')), ciudad: s(dig(P, 'address', 'city', 'name')), estado: s(dig(P, 'address', 'state', 'name')) },
        inmobiliaria: { id: companyId, nombre: s(dig(P, 'company', 'name')) || '—' },
        asesor: { nombre: nombre(P.agent) || '—', correo: s(dig(P, 'agent', 'email')), telefono: s(dig(P, 'agent', 'phone')),
            activo: agente ? s(agente.status) === 'active' && !agente.deletedAt : null, whatsapp: agente ? agente.whatsapp === true : null },
        estatus: { key: stKey, label: ESTATUS_PROP[stKey] ?? stKey, activa: stKey === 'published', desde: iso(desde), primeraPublicacion: iso(primeraPub),
            diasPublicada: stKey === 'published' && primeraPub ? Math.floor((now - primeraPub.getTime()) / DIA) : null },
        estatusOperacion: viva ? { key: viva.estatusKey, label: viva.estatus, codigo: viva.codigo } : null,
        contrato: {
            comision: n(dig(P, 'contract', 'comission')) ?? (Number(dig(P, 'contract', 'comission')) || null), ivaIncluido: dig(P, 'contract', 'ivaIncluded') === true, estatus: cStatus,
            exclusiva: exIni ? { inicio: exIni.toISOString(), fin: iso(exFin), vigente: !exFin || exFin.getTime() >= now, firmada: cStatus === 'completed' } : null,
            en1510: iso(en1510),
        },
        material: { fotos: fotos.length, video: Boolean((P.videos as unknown[])?.length) || Boolean(dig(P, 'marketing', 'Video', 'videoUrl')), tour: Boolean(P.virtualTour),
            calidad: qs === 3 ? 'Alta' : qs === 2 ? 'Media' : qs === 1 ? 'Baja' : null },
        portales,
        funnel: {
            vistas: (vistasAgg[0]?.n as number) ?? 0, leads: leads.length, leadsUnicos: unicos.size, leads30: dentro(30), leads90: dentro(90), ultimoLead: iso(ultimo),
            porFuente: [...porFuente.entries()].map(([fuente, k]) => ({ fuente, n: k })).sort((a, b) => b.n - a.n),
            wa: { base: wa.length, sinRespuesta: sinResp },
            visitas: visAgg.filter((v) => v.conf === 1).length, visitasPendientes: visAgg.filter((v) => v.conf !== 1).length, ofertas,
        },
        operaciones, duplicados, ortografia, linea,
        links: { ficha: `/ficha/${encodeURIComponent((P.internalId as string) || String(oid))}`, publica: `https://pulppo.com/propiedades/${String(oid)}`, mb: companyId ? `/mb/${companyId}` : null },
    };
}
