// Buscador de propiedades + expediente (/propiedad). SOLO interno.
//
// El buscador acepta lo que la gente tiene a la mano: el código de Pulppo (DMA-014, dma014), el _id
// largo, el id de cualquier portal (i24, MeLi, propiedades.com, EasyBroker, Casas y Terrenos)
// o directamente la LIGA del aviso. Si el código no es nuestro pero existe en el MLS,
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
import { contratoDe, duplicadosDe, esObjectId, portalDe, type ContratoResumen, type Duplicado } from './duplicados';
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
/** Línea de tiempo: sólo PRECIO y OPERACIONES (ofertas, aceptadas, cierres, caídas) — Ale, oct-2026. */
export interface Evento { t: string; tipo: 'Operación' | 'Precio'; texto: string; tono?: 'ok' | 'mal' | 'neutro' }
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
    /** el contrato de ESTA propiedad, para compararlo con los duplicados de Pulppo */
    miContrato: Omit<ContratoResumen, 'mismoPropietario'>;
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
    // Lamudi, Trovit y los feeds (iCasas, Mitula, Nuroa, Nestoria) NO se muestran: la presencia se canceló hace
    // ~un año y la llave quedó colgada (las nuevas la traen vacía, las viejas con la URL de entonces; 0 leads
    // en 90 días). Ciencuadras tampoco: es un portal de Colombia, una prueba de integración de sep-2026 que
    // nunca publicó (100 avisos, todos «pending · dry-run: sin credenciales»).

    // ── leads ──
    const leads = (await db.collection('leads').find({ 'property._id': oid }, { projection: { source: 1, medium: 1, message: 1, createdAt: 1, 'contact._id': 1, phone: 1, 'contact.phone': 1, interaction: 1, 'agent.firstName': 1, 'agent.lastName': 1 } }).toArray())
        .filter((l) => s(l.source).toLowerCase() !== 'formulario de contacto' && isDate(l.createdAt));
    const porFuente = new Map<string, number>();
    for (const l of leads) { const k = classifySource(l.source as string); const f = KEY2NAME[k] ?? 'Otros'; porFuente.set(f, (porFuente.get(f) ?? 0) + 1); }
    const door = leads.filter((l) => /doorvel/i.test(s(l.source))).sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
    if (door.length) portales.push({ portal: 'Doorvel', id: null, estatus: 'Recibe leads', nivel: null, costoMes: null, url: null, error: null,
        nota: `${door.length} lead${door.length === 1 ? '' : 's'} · último ${(door[door.length - 1].createdAt as Date).toISOString().slice(0, 10)}. Doorvel no guarda el código del aviso en Pulppo.` });
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
    // `listing.priceHistory` guarda el precio ANTERIOR a cada cambio, con la fecha del cambio (DHA-014:
    // 8.5M · 8.1M · 8.0M · 7.9M y hoy vale 7.7M). Así que cada entrada es «de ese precio al siguiente», y la
    // última va al precio actual. Algunas entradas vienen en USD: el % sólo se calcula en la misma moneda.
    const monedaHoy = s(dig(P, 'listing', 'price', 'currency')) || 'MXN';
    const precios = ((dig(P, 'listing', 'priceHistory') as Document[]) ?? []).map((p) => ({ v: n(p?.price), t: fecha(p?.timestamp), cur: s(p?.currency) || 'MXN' }))
        .filter((p): p is { v: number; t: Date; cur: string } => p.v != null && !!p.t).sort((a, b) => a.t.getTime() - b.t.getTime());
    const fmtP = (v: number, cur: string) => `$${Math.round(v).toLocaleString('en-US')}${cur !== 'MXN' ? ` ${cur}` : ''}`;
    for (let i = 0; i < precios.length; i++) {
        const de = precios[i];
        const a = i + 1 < precios.length ? precios[i + 1] : { v: n(dig(P, 'listing', 'value')), cur: monedaHoy };
        if (a.v == null || (a.v === de.v && a.cur === de.cur)) continue;
        const pct = a.cur === de.cur ? ((a.v / de.v) - 1) * 100 : null;
        linea.push({ t: de.t.toISOString(), tipo: 'Precio', texto: `${fmtP(de.v, de.cur)} → ${fmtP(a.v, a.cur)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`, tono: pct != null && pct < 0 ? 'ok' : 'neutro' });
    }
    for (const o of operaciones) for (const h of o.historia) linea.push({ t: h.t, tipo: 'Operación', texto: `${o.codigo} · ${h.estatus}`, tono: /cancel/i.test(h.estatus) ? 'mal' : /cerrada|cobrando|aceptada/i.test(h.estatus) ? 'ok' : 'neutro' });
    const en1510 = fecha(dig(P, 'contract', 'exclusive', 'pulppo'));
    const ordLeads = [...leads].sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
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
        operaciones, duplicados, miContrato: contratoDe(P), ortografia, linea,
        links: { ficha: `/ficha/${encodeURIComponent((P.internalId as string) || String(oid))}`, publica: `https://pulppo.com/propiedades/${String(oid)}`, mb: companyId ? `/mb/${companyId}` : null },
    };
}
