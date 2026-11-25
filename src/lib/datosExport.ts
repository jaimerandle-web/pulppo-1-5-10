// Base de datos de una inmobiliaria en tres juegos, leídos de Mongo en vivo (solo lectura).
// Port de ~/DiamondHouse/datos/exportar.py.
//
//   propiedades  todo el inventario (cualquier estado) SIN NADA del propietario: ni contacto, ni
//                notas, ni contrato, ni archivos, ni el motivo de venta. Fotos, videos, recorrido
//                virtual, portales y los dos asesores: productor (captó) y vendedor.
//   leads        cada lead con la propiedad, el asesor que lo atiende, el productor de la propiedad
//                y en qué va (estatus de la búsqueda + motivo de descarte).
//   asesores     brokers de fuera de la inmobiliaria: contactos marcados como broker que le
//                mandaron leads + asesores de otras inmobiliarias o independientes que estuvieron del
//                otro lado de una operación.
//
// 🔒 Lista blanca de campos: lo que no se nombra aquí no sale. Nunca agregar `contact`, `notes`,
// `files`, `contract.signers`, `capture` ni `address.street/floor/apartment` de la propiedad.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { fotoAsesores } from './datosFoto';

type D = Document;
const g = (o: unknown, ...ks: string[]): unknown => ks.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as D)[k] : undefined), o);
const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v).trim() || null);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : s(v));
const nombre = (o: unknown) => [s(g(o, 'firstName')), s(g(o, 'lastName'))].filter(Boolean).join(' ') || null;

export type Asesor = { id: string | null; nombre: string | null; telefono: string | null; email: string | null; foto: string | null };
function asesor(a: unknown): Asesor | null {
    if (!a || typeof a !== 'object') return null;
    return { id: s(g(a, '_id')), nombre: nombre(a), telefono: s(g(a, 'phone')), email: s(g(a, 'email')), foto: s(g(a, 'profilePicture')) };
}

const OPERACION: Record<string, string> = { sale: 'venta', rent: 'renta' };

// ------------------------------------------------------------------------------- propiedades
function propiedad(p: D) {
    const L = (p.listing || {}) as D, A = (p.attributes || {}) as D, ad = (p.address || {}) as D, mk = (p.marketing || {}) as D;
    const c = g(ad, 'location', 'coordinates');
    const loc = Array.isArray(c) && c.length === 2 ? (c as number[]) : null;
    const pics = (Array.isArray(p.pictures) ? p.pictures : []) as D[];
    const vgen: Record<string, string> = {};
    for (const k of ['Video', 'VideoStory']) { const u = s(g(mk, k, 'videoUrl')); if (u) vgen[k] = u; }
    const piezas: Record<string, string> = {};
    for (const k of ['PostCuadrado', 'PostLargo', 'Story']) { const u = s(g(mk, k, 'url')); if (u) piezas[k] = u; }
    return {
        id: String(p._id), codigo: s(p.internalId), estado: s(g(p, 'status', 'last')),
        operacion: OPERACION[String(L.operation)] ?? s(L.operation), tipo: s(p.type),
        titulo: s(L.title), descripcion: s(L.description),
        titulo_largo: s(g(L, 'extra', 'title')), resumen: s(g(L, 'extra', 'summary')),
        descripcion_en: s(g(L, 'translation', 'en', 'description')),
        precio: (g(L, 'price', 'price') as number) ?? null, moneda: s(g(L, 'price', 'currency')),
        historial_precio: ((Array.isArray(L.priceHistory) ? L.priceHistory : []) as D[])
            .filter((h) => Number(h.price) > 1)
            .map((h) => ({ precio: h.price as number, moneda: s(h.currency), fecha: iso(h.timestamp) })),
        mantenimiento: (A.expenses as number) ?? null,
        recamaras: (A.suites as number) ?? null, banos: (A.bathrooms as number) ?? null, medios_banos: (A.toilettes as number) ?? null,
        estacionamientos: (A.parkings as number) ?? null, m2_construidos: (A.roofedSurface as number) ?? null,
        m2_terreno: (A.totalSurface as number) ?? null, m2_descubiertos: (A.unroofedSurface as number) ?? null,
        antiguedad_anio: (A.yearBuild as number) ?? null, condicion: s(A.condition),
        amenidades: ((Array.isArray(p.services) ? p.services : []) as D[]).map((x) => s(x.name)).filter(Boolean) as string[],
        ubicacion: {
            colonia: s(g(ad, 'neighborhood', 'name')), municipio: s(g(ad, 'city', 'name')), estado: s(g(ad, 'state', 'name')),
            calle_publica: s(ad.publicStreet), cp: s(ad.zip), mostrar_ubicacion: (ad.showLocation as boolean) ?? null,
            lat: loc ? loc[1] : null, lng: loc ? loc[0] : null,
        },
        fotos: pics.filter((f) => f.url && f.public !== false && !f.is_blueprint).map((f) => String(f.url)),
        planos: pics.filter((f) => f.url && f.is_blueprint).map((f) => String(f.url)),
        videos: ((Array.isArray(p.videos) ? p.videos : []) as D[]).filter((v) => v.url)
            .map((v) => ({ url: String(v.url), proveedor: s(v.provider), titulo: s(v.title) })),
        videos_generados: vgen, recorrido_virtual: s(p.virtualTour), piezas_marketing: piezas,
        productor: asesor(p.agent), vendedor: asesor(p.agentSeller),
    };
}
export type Propiedad = ReturnType<typeof propiedad>;

// Sólo los subcampos que se usan: `agent`, `portals` y `marketing` completos pesan decenas de MB y la
// primera carga pasaba de 5 min (el límite de la función es 300 s).
const PERSONA = ['_id', 'firstName', 'lastName', 'phone', 'email', 'profilePicture'];
const CAMPOS_P = Object.fromEntries([
    'internalId', 'status.last', 'listing.title', 'listing.description', 'listing.operation', 'listing.price', 'listing.priceHistory',
    'listing.extra.title', 'listing.extra.summary', 'listing.translation.en.description',
    'attributes', 'services.name', 'address.neighborhood.name', 'address.city.name', 'address.state.name', 'address.publicStreet',
    'address.zip', 'address.showLocation', 'address.location', 'pictures.url', 'pictures.public', 'pictures.is_blueprint',
    'videos.url', 'videos.provider', 'videos.title', 'virtualTour',
    ...['Video', 'VideoStory'].map((k) => `marketing.${k}.videoUrl`), ...['PostCuadrado', 'PostLargo', 'Story'].map((k) => `marketing.${k}.url`),
    ...PERSONA.flatMap((k) => [`agent.${k}`, `agentSeller.${k}`]),
    'type',
].map((k) => [k, 1]));
const ORDEN: Record<string, number> = { published: 0, edition: 1, valuation: 2, completed: 3, cancelled: 4 };

export async function propiedades(companyId: string): Promise<Propiedad[]> {
    const db = await getDb();
    const docs = await db.collection('properties').find({ 'company._id': new ObjectId(companyId) }, { projection: CAMPOS_P }).batchSize(2000).toArray();
    // Las coordenadas sueltas en `address.location` no son del dueño, pero el resto de `address` sí puede serlo.
    for (const d of docs) if (d.address) d.address = { neighborhood: d.address.neighborhood, city: d.address.city, state: d.address.state, publicStreet: d.address.publicStreet, zip: d.address.zip, showLocation: d.address.showLocation, location: d.address.location };
    return docs.map(propiedad).sort((a, b) => (ORDEN[a.estado ?? ''] ?? 9) - (ORDEN[b.estado ?? ''] ?? 9) || String(a.codigo).localeCompare(String(b.codigo)));
}

// ------------------------------------------------------------------------------------- leads
export const ESTATUS: Record<string, string> = {
    pending: 'nuevo', searching: 'en búsqueda', visiting: 'visitando', offer_done: 'ofertó',
    closing: 'cerrando', completed: 'cerrado', cancelled: 'descartado',
};

export type Lead = {
    id: string; fecha: string | null; fuente: string | null; medio: string | null; portal: string | null; campana: string | null;
    contacto: { id: string | null; nombre: string | null; telefono: string | null; email: string | null; es_broker: boolean };
    mensaje: string | null;
    propiedad: { id: string; codigo: string | null; titulo: string | null; operacion: string | null } | null;
    asesor: Asesor | null; productor_propiedad: Asesor | null;
    estatus: string; motivo_descarte: string | null; respondido: string | null;
};

async function enLotes<T>(ids: unknown[], fn: (lote: unknown[]) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 5000) out.push(...(await fn(ids.slice(i, i + 5000))));
    return out;
}

export async function leads(companyId: string, props?: Propiedad[]): Promise<Lead[]> {
    const db = await getDb();
    const P = props ?? (await propiedades(companyId));
    const porId = new Map(P.map((p) => [p.id, p]));
    const company = new ObjectId(companyId);
    const docs = await db.collection('leads').find(
        { $or: [{ 'company._id': company }, { 'property._id': { $in: P.map((p) => new ObjectId(p.id)) } }] },
        { projection: { source: 1, medium: 1, campaign: 1, ...Object.fromEntries(PERSONA.map((k) => [`contact.${k}`, 1])), 'agent._id': 1, 'property._id': 1, 'property.internalId': 1, 'property.listing.title': 1, 'property.listing.operation': 1, search: 1, answeredAt: 1, createdAt: 1, message: 1, 'propertyPublishPortals.portal': 1 } },
    ).batchSize(10000).toArray();

    // El asesor se repite en miles de leads: se trae una vez de `agents` en vez de copiarlo en cada lead.
    const aids = [...new Set(docs.map((l) => g(l, 'agent', '_id')).filter(Boolean).map(String))].map((x) => new ObjectId(x));
    const agentes = new Map((await enLotes(aids, (lote) => db.collection('agents').find({ _id: { $in: lote as ObjectId[] } }, { projection: Object.fromEntries(PERSONA.map((k) => [k, 1])) }).toArray())).map((a) => [String(a._id), a]));

    const sids = [...new Set(docs.map((l) => l.search).filter(Boolean).map(String))].map((x) => new ObjectId(x));
    const busq = new Map<string, D>();
    for (const x of await enLotes(sids, (lote) => db.collection('searches').find({ _id: { $in: lote as ObjectId[] } }, { projection: { 'status.last': 1, 'status.reasonToFinish': 1 } }).toArray())) busq.set(String(x._id), (x.status || {}) as D);

    const cids = [...new Set(docs.map((l) => g(l, 'contact', '_id')).filter(Boolean).map(String))].map((x) => new ObjectId(x));
    const brokers = new Set((await enLotes(cids, (lote) => db.collection('contacts').find({ _id: { $in: lote as ObjectId[] }, tags: { $regex: 'broker', $options: 'i' } }, { projection: { _id: 1 } }).toArray())).map((c) => String(c._id)));

    return docs.map((l): Lead => {
        const st = busq.get(String(l.search)) || {};
        const pid = s(g(l, 'property', '_id'));
        const cid = s(g(l, 'contact', '_id'));
        return {
            id: String(l._id), fecha: iso(l.createdAt), fuente: s(l.source), medio: s(l.medium),
            portal: s(g(l, 'propertyPublishPortals', 'portal')), campana: s(l.campaign),
            contacto: { id: cid, nombre: nombre(l.contact), telefono: s(g(l, 'contact', 'phone')), email: s(g(l, 'contact', 'email')), es_broker: !!cid && brokers.has(cid) },
            mensaje: s(l.message),
            propiedad: pid ? {
                id: pid, codigo: s(g(l, 'property', 'internalId')) ?? porId.get(pid)?.codigo ?? null,
                titulo: s(g(l, 'property', 'listing', 'title')),
                operacion: OPERACION[String(g(l, 'property', 'listing', 'operation'))] ?? null,
            } : null,
            asesor: asesor(agentes.get(String(g(l, 'agent', '_id'))) ?? l.agent), productor_propiedad: (pid && porId.get(pid)?.productor) || null,
            estatus: ESTATUS[String(st.last)] ?? s(st.last) ?? 'sin seguimiento',
            motivo_descarte: s(st.reasonToFinish), respondido: iso(l.answeredAt),
        };
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ------------------------------------------------------------------------- asesores externos
export type AsesorExterno = {
    id: string; nombre: string | null; inmobiliaria: string | null; telefonos: string[]; emails: string[];
    nivel: string; leads_a_la_inmobiliaria: number; operaciones: number; cierres: number;
    propiedades: string[]; asesor_interno_principal: string | null; primer_contacto: string | null; ultimo_contacto: string | null;
    patrones: Patrones;
};

// Qué mueve cada broker, sacado de las propiedades por las que preguntó o con las que operó.
// Precios en MXN (USD × USD_MXN). Rango típico = percentil 25 a 75.
export type Rango = { n: number; mediana: number; tipico_min: number; tipico_max: number };
export type Patrones = {
    zonas: { colonia: string; municipio: string | null; n: number }[];
    municipios: { municipio: string; n: number }[];
    operacion: { venta: number; renta: number };
    tipos: { tipo: string; n: number }[];
    presupuesto: { venta: Rango | null; renta: Rango | null };
    recamaras_mediana: number | null;
};
const USD_MXN = 18.5;
const pct = (xs: number[], q: number) => { const a = [...xs].sort((x, y) => x - y); const i = (a.length - 1) * q, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const rango = (xs: number[]): Rango | null => xs.length ? { n: xs.length, mediana: Math.round(pct(xs, 0.5)), tipico_min: Math.round(pct(xs, 0.25)), tipico_max: Math.round(pct(xs, 0.75)) } : null;
const top = <T extends string>(xs: (T | null)[], k: number) => {
    const m = new Map<T, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
};

function patrones(ps: Propiedad[]): Patrones {
    const mxn = (p: Propiedad) => (p.precio && p.precio > 1 ? p.precio * (String(p.moneda).toUpperCase() === 'USD' ? USD_MXN : 1) : null);
    const precios = (op: string) => ps.filter((p) => p.operacion === op).map(mxn).filter((x): x is number => x != null);
    const zonas = top(ps.map((p) => (p.ubicacion.colonia ? `${p.ubicacion.colonia}|${p.ubicacion.municipio ?? ''}` : null)), 5)
        .map(([k, n]) => { const [colonia, municipio] = k.split('|'); return { colonia, municipio: municipio || null, n }; });
    const rec = ps.map((p) => p.recamaras).filter((x): x is number => typeof x === 'number' && x > 0);
    return {
        zonas,
        municipios: top(ps.map((p) => p.ubicacion.municipio), 3).map(([municipio, n]) => ({ municipio, n })),
        operacion: { venta: ps.filter((p) => p.operacion === 'venta').length, renta: ps.filter((p) => p.operacion === 'renta').length },
        tipos: top(ps.map((p) => p.tipo), 3).map(([tipo, n]) => ({ tipo, n })),
        presupuesto: { venta: rango(precios('venta')), renta: rango(precios('renta')) },
        recamaras_mediana: rec.length ? pct(rec, 0.5) : null,
    };
}
export const NIVELES = ['cerró con nosotros', 'ofertó con nosotros', 'recurrente (3+ leads)', 'ocasional'];
const digitos = (t: string) => t.replace(/\D/g, '').slice(-10);

export async function asesoresExternos(companyId: string, ls?: Lead[], props?: Propiedad[]): Promise<AsesorExterno[]> {
    const db = await getDb();
    const company = new ObjectId(companyId);
    const L = ls ?? (await leads(companyId));
    const P = props ?? (await propiedades(companyId));
    const porId = new Map(P.map((p) => [p.id, p])), porCodigo = new Map(P.map((p) => [p.codigo, p]));
    type B = { vistas: Propiedad[]; nombre: string | null; inmobiliaria: string | null; tels: Set<string>; mails: Set<string>; leads: number; ops: number; cierres: number; props: Set<string>; internos: Map<string, number>; ini: string | null; fin: string | null };
    const M = new Map<string, B>();
    const get = (id: string) => {
        let b = M.get(id);
        if (!b) { b = { vistas: [], nombre: null, inmobiliaria: null, tels: new Set(), mails: new Set(), leads: 0, ops: 0, cierres: 0, props: new Set(), internos: new Map(), ini: null, fin: null }; M.set(id, b); }
        return b;
    };
    const toca = (b: B, f: string | null) => { if (f) { if (!b.ini || f < b.ini) b.ini = f; if (!b.fin || f > b.fin) b.fin = f; } };

    for (const l of L) {
        if (!l.contacto.es_broker || !l.contacto.id) continue;
        const b = get(l.contacto.id);
        b.nombre ||= l.contacto.nombre; b.leads++;
        if (l.propiedad?.codigo) b.props.add(l.propiedad.codigo);
        const pv = l.propiedad && porId.get(l.propiedad.id);
        if (pv) b.vistas.push(pv);
        if (l.contacto.telefono) b.tels.add(l.contacto.telefono);
        if (l.contacto.email) b.mails.add(l.contacto.email);
        if (l.asesor?.nombre) b.internos.set(l.asesor.nombre, (b.internos.get(l.asesor.nombre) || 0) + 1);
        toca(b, l.fecha);
    }
    for (const c of await enLotes([...M.keys()].map((x) => new ObjectId(x)), (lote) => db.collection('contacts').find({ _id: { $in: lote as ObjectId[] } }, { projection: { 'company.name': 1 } }).toArray())) {
        const n = s(g(c, 'company', 'name'));
        if (n) get(String(c._id)).inmobiliaria = n;
    }
    const ops = await db.collection('operations').find(
        { $or: [{ 'seller.company._id': company }, { 'buyer.company._id': company }] },
        { projection: { seller: 1, buyer: 1, 'status.last': 1, closedAt: 1, createdAt: 1, 'property.internalId': 1 } },
    ).toArray();
    for (const o of ops) {
        for (const lado of ['buyer', 'seller']) {
            const co = g(o, lado, 'company') as D | undefined, br = g(o, lado, 'broker') as D | undefined;
            if (!br?._id || String(co?._id) === companyId) continue;
            const b = get(String(br._id));
            b.nombre ||= nombre(br);
            b.inmobiliaria = s(co?.name) ?? b.inmobiliaria;
            if (s(br.phone)) b.tels.add(String(br.phone));
            if (s(br.email)) b.mails.add(String(br.email));
            b.ops++;
            if (['closed', 'paying'].includes(String(g(o, 'status', 'last')))) b.cierres++;
            const cod = s(g(o, 'property', 'internalId'));
            if (cod) b.props.add(cod);
            const pv = cod ? porCodigo.get(cod) : undefined;
            if (pv) b.vistas.push(pv);
            toca(b, iso(o.closedAt || o.createdAt));
        }
    }
    // Fuera: los asesores de la propia inmobiliaria marcados como broker y las cuentas de prueba.
    const propios = new Set<string>();
    for (const a of await db.collection('agents').find({ 'company._id': company }, { projection: { phone: 1, email: 1 } }).toArray()) {
        if (s(a.phone)) propios.add(digitos(String(a.phone)));
        if (s(a.email)) propios.add(String(a.email).toLowerCase());
    }
    const nombreCo = s(g(await db.collection('companies').findOne({ _id: company }, { projection: { name: 1 } }), 'name'))?.toLowerCase();

    const out: AsesorExterno[] = [];
    for (const [id, b] of M) {
        const inm = (b.inmobiliaria || '').toLowerCase();
        if (inm === nombreCo || inm === 'inmobiliaria demo') continue;
        if ([...b.tels].some((t) => propios.has(digitos(t))) || [...b.mails].some((m) => propios.has(m.toLowerCase()))) continue;
        const nivel = b.cierres ? NIVELES[0] : b.ops ? NIVELES[1] : b.leads >= 3 ? NIVELES[2] : NIVELES[3];
        const masInterno = [...b.internos].sort((x, y) => y[1] - x[1])[0];
        out.push({
            id, nombre: b.nombre, inmobiliaria: b.inmobiliaria, telefonos: [...b.tels].sort(), emails: [...b.mails].sort(),
            nivel, leads_a_la_inmobiliaria: b.leads, operaciones: b.ops, cierres: b.cierres, propiedades: [...b.props].sort(),
            asesor_interno_principal: masInterno ? masInterno[0] : null, primer_contacto: b.ini, ultimo_contacto: b.fin,
            patrones: patrones(b.vistas),
        });
    }
    return out.sort((a, b) => NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel) || b.cierres - a.cierres || b.leads_a_la_inmobiliaria - a.leads_a_la_inmobiliaria);
}

// --------------------------------------------------------------------------------- todo junto
export type Base = { generado: string; propiedades: Propiedad[]; leads: Lead[]; asesores: AsesorExterno[]; asesores_generado: string };

export async function base(companyId: string): Promise<Base> {
    const P = await propiedades(companyId);
    const L = await leads(companyId, P);
    // Asesores externos: foto que se renueva cada 3 meses (lib/datosFoto.ts), no en vivo.
    const A = await fotoAsesores(companyId, () => asesoresExternos(companyId, L, P));
    return { generado: new Date().toISOString(), propiedades: P, leads: L, asesores: A.datos, asesores_generado: A.generado };
}

// Para Excel: una fila plana por registro, con encabezados en español.
type Fila = Record<string, string | number | boolean | null>;
const lista = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' | ') || null;
const mxnCorto = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export function filasPropiedades(P: Propiedad[]): Fila[] {
    return P.map((p) => ({
        'Código': p.codigo, 'Estado': p.estado, 'Operación': p.operacion, 'Tipo': p.tipo, 'Título': p.titulo,
        'Precio': p.precio, 'Moneda': p.moneda, 'Mantenimiento': p.mantenimiento, 'Recámaras': p.recamaras, 'Baños': p.banos,
        'Medios baños': p.medios_banos, 'Estacionamientos': p.estacionamientos, 'm² construidos': p.m2_construidos, 'm² terreno': p.m2_terreno,
        'Colonia': p.ubicacion.colonia, 'Municipio': p.ubicacion.municipio, 'Estado (ubicación)': p.ubicacion.estado, 'Calle pública': p.ubicacion.calle_publica,
        'Lat': p.ubicacion.lat, 'Lng': p.ubicacion.lng, 'Productor': p.productor?.nombre ?? null, 'Vendedor': p.vendedor?.nombre ?? null,
 'Nº fotos': p.fotos.length, 'Foto portada': p.fotos[0] ?? null,
        'Fotos': lista(p.fotos), 'Videos': lista(p.videos.map((v) => v.url)), 'Video generado': p.videos_generados.Video ?? null,
        'Recorrido virtual': p.recorrido_virtual, 'Amenidades': lista(p.amenidades), 'Descripción': p.descripcion, 'ID': p.id,
    }));
}

export function filasLeads(L: Lead[]): Fila[] {
    return L.map((l) => ({
        'Fecha': l.fecha, 'Fuente': l.fuente, 'Medio': l.medio, 'Portal': l.portal, 'Campaña': l.campana,
        'Contacto': l.contacto.nombre, 'Teléfono': l.contacto.telefono, 'Correo': l.contacto.email, 'Es broker': l.contacto.es_broker,
        'Código propiedad': l.propiedad?.codigo ?? null, 'Propiedad': l.propiedad?.titulo ?? null, 'Operación': l.propiedad?.operacion ?? null,
        'Asesor que atiende': l.asesor?.nombre ?? null, 'Productor de la propiedad': l.productor_propiedad?.nombre ?? null,
        'Estatus': l.estatus, 'Motivo de descarte': l.motivo_descarte, 'Respondido': l.respondido, 'Mensaje': l.mensaje, 'ID': l.id,
    }));
}

export function filasAsesores(A: AsesorExterno[]): Fila[] {
    return A.map((a) => ({
        'Nombre': a.nombre, 'Inmobiliaria': a.inmobiliaria, 'Teléfonos': lista(a.telefonos), 'Correos': lista(a.emails), 'Nivel': a.nivel,
        'Leads que nos mandó': a.leads_a_la_inmobiliaria, 'Operaciones': a.operaciones, 'Cierres': a.cierres,
        'Zonas': lista(a.patrones.zonas.map((z) => `${z.colonia}${z.municipio ? `, ${z.municipio}` : ''} (${z.n})`)),
        'Municipios': lista(a.patrones.municipios.map((m) => `${m.municipio} (${m.n})`)),
        'Venta / renta': `${a.patrones.operacion.venta} / ${a.patrones.operacion.renta}`,
        'Tipos': lista(a.patrones.tipos.map((t) => `${t.tipo} (${t.n})`)),
        'Presupuesto venta (mediana)': a.patrones.presupuesto.venta?.mediana ?? null,
        'Presupuesto venta típico': a.patrones.presupuesto.venta ? `${mxnCorto(a.patrones.presupuesto.venta.tipico_min)} – ${mxnCorto(a.patrones.presupuesto.venta.tipico_max)}` : null,
        'Presupuesto renta (mediana)': a.patrones.presupuesto.renta?.mediana ?? null,
        'Presupuesto renta típico': a.patrones.presupuesto.renta ? `${mxnCorto(a.patrones.presupuesto.renta.tipico_min)} – ${mxnCorto(a.patrones.presupuesto.renta.tipico_max)}` : null,
        'Recámaras (mediana)': a.patrones.recamaras_mediana,
        'Propiedades': lista(a.propiedades), 'Asesor interno principal': a.asesor_interno_principal,
        'Primer contacto': a.primer_contacto, 'Último contacto': a.ultimo_contacto, 'ID': a.id,
    }));
}
