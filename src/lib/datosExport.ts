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
import { brokersRed, type BrokerRed } from './brokersRed';
import type { Rango } from './datosPatrones';

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
// Ya no salen de aquí: son los brokers de toda la red (lib/brokersRed.ts), en foto mensual (lib/datosFoto.ts).
export type AsesorExterno = BrokerRed;

// --------------------------------------------------------------------------------- todo junto
export type Base = {
    generado: string; propiedades: Propiedad[]; leads: Lead[];
    asesores: AsesorExterno[]; asesores_generado: string | null; asesores_preparando: boolean;
};

export async function base(companyId: string): Promise<Base> {
    // Asesores externos (toda la red): foto mensual. Va en paralelo y, si no hay foto, se prepara en segundo plano.
    const [P, A] = await Promise.all([propiedades(companyId), fotoAsesores(companyId, () => brokersRed(companyId))]);
    const L = await leads(companyId, P);
    return {
        generado: new Date().toISOString(), propiedades: P, leads: L,
        asesores: A.datos, asesores_generado: A.generado, asesores_preparando: A.preparando,
    };
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
    const rg = (r: Rango | null) => (r ? `${mxnCorto(r.tipico_min)} – ${mxnCorto(r.tipico_max)}` : null);
    return A.map((a) => ({
        'Nombre': a.nombre, 'Inmobiliaria (declarada)': a.inmobiliaria_declarada, 'Teléfonos': lista(a.telefonos), 'Correos': lista(a.emails),
        'Con nosotros': a.contigo.nivel, 'Leads que nos mandó': a.contigo.leads, 'Operaciones con nosotros': a.contigo.operaciones,
        'Cierres con nosotros': a.contigo.cierres, 'Nivel en la red': a.nivel_red, 'Leads a la red': a.leads_a_la_red,
        'Operaciones en la red': a.operaciones_red, 'Cierres en la red': a.cierres_red, 'Inmobiliarias con las que trabaja': a.inmobiliarias_pulppo,
        'Zonas': lista(a.patrones.zonas.map((z) => `${z.colonia}${z.municipio ? `, ${z.municipio}` : ''} (${z.n})`)),
        'Municipios': lista(a.patrones.municipios.map((m) => `${m.municipio} (${m.n})`)),
        'Venta / renta': `${a.patrones.operacion.venta} / ${a.patrones.operacion.renta}`,
        'Tipos': lista(a.patrones.tipos.map((t) => `${t.tipo} (${t.n})`)),
        'Presupuesto venta (mediana)': a.patrones.presupuesto.venta?.mediana ?? null, 'Presupuesto venta típico': rg(a.patrones.presupuesto.venta),
        'Presupuesto renta (mediana)': a.patrones.presupuesto.renta?.mediana ?? null, 'Presupuesto renta típico': rg(a.patrones.presupuesto.renta),
        'Recámaras (mediana)': a.patrones.recamaras_mediana,
        'Primer contacto': a.primer_contacto, 'Último contacto': a.ultimo_contacto, 'ID': a.id,
    }));
}
