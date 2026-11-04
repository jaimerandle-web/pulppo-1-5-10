// Pauta de Meta para exclusivas 1·5·10: qué propiedades se pueden pautar, en qué cluster caen
// (zona × rango de precio), de qué inmobiliaria son y el paquete completo para que el equipo
// que monta las campañas (Habi) sólo suba: artes, video, copies, segmentación y UTMs.
//
// Fuentes que NO son Mongo (fotos fijas, se refrescan a mano):
// · videos.json   — cortes editados en Drive por código (carpeta de multimedia). Los videos de
//                   Mongo son ligas de YouTube y Meta no los acepta para anunciar.
// · historial.json — lo que ya se gastó en Meta por propiedad y lo que dio en el CRM.
import type { Document, ObjectId } from 'mongodb';
import { classifySource, getDb } from '../data';
import zonaMap from '../zona_map.json';
import videosSnap from './videos.json';
import historialSnap from './historial.json';
import { excluidaPor, type Excluida } from './excluidas';
import {
    armarCopies, armarSegmentacion, bandaDe, nombreCampana, urlConUtm,
    type Copies, type DatosProp, type Segmentacion
} from './armado';

// zona_map.json es el mapa de junio (lo comparte el generador de bases); aquí se completan las
// alcaldías y municipios que no traía, para que ninguna propiedad caiga en "Ciudad de México".
const ZONA: Record<string, string> = {
    ...(zonaMap as Record<string, string>),
    iztapalapa: 'Oriente', iztacalco: 'Oriente', 'venustiano carranza': 'Oriente', tlahuac: 'Oriente',
    xochimilco: 'Sur', 'milpa alta': 'Sur', azcapotzalco: 'Norte',
    toluca: 'Toluca y Valle de Bravo', metepec: 'Toluca y Valle de Bravo', 'valle de bravo': 'Toluca y Valle de Bravo'
};
const VIDEOS = (videosSnap as { videos: Record<string, Partial<Record<string, string>>> }).videos;
const HIST = (historialSnap as { props: Record<string, Historial> }).props;
export const CORTE_VIDEOS = (videosSnap as { corte: string }).corte;
export const CARPETA_VIDEOS = (videosSnap as { carpeta: string }).carpeta;
export const CORTE_HISTORIAL = (historialSnap as { corte: string }).corte;

// Tipos que sí entran a pauta B2C (mismo gate que el Evaluador: venta residencial).
const RESIDENCIAL = new Set(['departamento', 'casa', 'casa en condominio', 'ph', 'penthouse']);

const norm = (s: unknown) =>
    (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);

export interface Historial { gasto: number; clicsWa: number; leads: number; visitas: number }

// Demanda de los últimos 60 días, en vivo: personas únicas que preguntaron por la propiedad fuera
// de Meta (portales, WhatsApp, correo…) y cuántas visitaron después de su primer lead.
export interface Demanda { leads: number; leadsMeta: number; visitas: number; porCanal: Record<string, number> }
export const DIAS_DEMANDA = 60;

// Estrella = la demanda ya probó que la propiedad jala (precio y producto resuenan): va en campaña
// propia. Medido el 3-nov-2026: con ≥10 personas y ≥3 visitas en 60 días salen 7 de las vivas, todas
// abajo de $15M. Sin el piso de visitas se colaban avisos con ráfagas de leads de MeLi que nadie
// visita (DTJ-191: 254 leads, 0 visitas).
export const esEstrella = (d: Demanda | null) => !!d && d.leads >= 10 && d.visitas >= 3;
export interface VideoCorte { formato: string; url: string }

export interface PautaProp extends DatosProp {
    inmobiliaria: string;
    titulo: string;
    zona: string;
    banda: string;
    cluster: string;
    foto: string | null;
    url: string;
    campana: string;
    urlUtm: string;
    excluida: Excluida | { inmobiliaria: string; motivo: string; desde: string } | null;
    avisos: string[];
    videos: VideoCorte[];
    youtube: string | null;
    historial: Historial | null;
    demanda: Demanda | null;
    estrella: boolean;
    copies: Copies;
    seg: Segmentacion;
}

// La portada (#1) es la mejor foto por decisión del equipo. Sólo se brinca si no es pública o es un plano.
function portada(P: Document): string | null {
    const pics = ((P.pictures as Document[]) || []).filter((x) => x.public !== false && !x.is_blueprint);
    return (pics[0]?.url as string) ?? (pics[0]?.src as string) ?? null;
}

const PROJ = {
    internalId: 1, type: 1, 'company.name': 1, 'listing.title': 1, 'listing.value': 1,
    'address.neighborhood.name': 1, 'address.city.name': 1, 'address.state.name': 1, 'address.location': 1,
    attributes: 1, services: 1, pictures: 1, videos: 1, 'marketing.Video.videoUrl': 1
};

function mapear(P: Document): PautaProp {
    const a = (P.attributes || {}) as Document;
    const full = num(a.bathrooms), half = num(a.toilettes);
    const banos = full == null && half == null ? null : (full ?? 0) + 0.5 * (half ?? 0);
    const roofed = num(a.roofedSurface), total = num(a.totalSurface) ?? num(a.surface);
    const tipo = String(P.type || '');
    const coords = (P.address?.location?.coordinates as number[] | undefined) || [];
    const ciudad = (P.address?.city?.name as string) || null;
    const estado = (P.address?.state?.name as string) || null;
    const zona = ZONA[norm(ciudad)] || estado || 'Sin zona';

    const d: DatosProp = {
        id: String(P._id),
        code: String(P.internalId || ''),
        tipo,
        colonia: (P.address?.neighborhood?.name as string) || null,
        ciudad,
        estado,
        precio: num(P.listing?.value),
        m2: roofed ?? total,
        terreno: total != null && roofed != null && total > roofed * 1.05 ? total : null,
        rec: num(a.suites),
        banos: banos || null,
        park: num(a.parkings),
        amenidades: ((P.services as Document[]) || []).map((s) => String(s?.name || '')).filter(Boolean),
        lat: typeof coords[1] === 'number' ? coords[1] : null,
        lng: typeof coords[0] === 'number' ? coords[0] : null
    };

    const inmobiliaria = (P.company?.name as string) || 'Sin inmobiliaria';
    const banda = bandaDe(d.precio);
    const campana = nombreCampana(d, zona);
    const cortes = VIDEOS[d.code] || {};
    const videos = Object.entries(cortes)
        .filter(([, id]) => !!id)
        .map(([formato, id]) => ({ formato, url: `https://drive.google.com/file/d/${id}/view` }));
    const yt = [
        ...(((P.videos as Document[]) || []).map((v) => (typeof v === 'string' ? v : v?.url))),
        P.marketing?.Video?.videoUrl
    ].find((u) => typeof u === 'string' && u) as string | undefined;
    const historial = HIST[d.code] ?? null;

    let excluida: PautaProp['excluida'] = excluidaPor(inmobiliaria);
    if (!excluida && !RESIDENCIAL.has(norm(tipo))) {
        excluida = { inmobiliaria, motivo: `${tipo || 'Tipo sin capturar'}: la pauta B2C es sólo vivienda`, desde: '' };
    }

    const avisos: string[] = [];
    if (!portada(P)) avisos.push('Sin foto pública: no se puede armar el arte.');
    if (d.precio == null) avisos.push('Sin precio cargado: los copies salen sin precio.');
    if ((d.precio ?? 0) >= 15e6) avisos.push('Arriba de $15M el lead de Meta casi no llega a visita (5% en may–sep). Presupuesto bajo, como pauta de marca.');
    if (norm(estado) === 'yucatan') avisos.push('Yucatán: 21 leads de Meta y 0 visitas en may–sep. Pautar sólo con radio local y revisar a los 7 días.');
    if (!videos.length) avisos.push('Sin corte de video en Drive: sale sólo con artes (o pedir el corte a multimedia).');
    if (historial && historial.gasto >= 1500 && historial.visitas === 0) {
        avisos.push(`Ya se pautó ($${historial.gasto.toLocaleString('es-MX')}, ${historial.leads} leads) y no dio visitas: revisar precio antes de volver a invertir.`);
    }

    return {
        ...d,
        inmobiliaria,
        titulo: (P.listing?.title as string) || `${tipo} en ${d.colonia || ''}`,
        zona,
        banda,
        cluster: `${zona} · ${banda}`,
        foto: portada(P),
        url: `https://pulppo.com/propiedades/${d.id}`,
        campana,
        urlUtm: urlConUtm(d, campana),
        excluida,
        avisos,
        videos,
        youtube: yt ?? null,
        historial,
        demanda: null,
        estrella: false,
        copies: armarCopies(d),
        seg: armarSegmentacion(d)
    };
}

// Cohorte estricta: la visita cuenta sólo si es posterior al primer lead de esa persona en la propiedad.
async function demanda(db: Awaited<ReturnType<typeof getDb>>, ids: ObjectId[]): Promise<Map<string, Demanda>> {
    const desde = new Date(Date.now() - DIAS_DEMANDA * 86400000);
    const [leads, visitas] = await Promise.all([
        db.collection('leads').find(
            { 'property._id': { $in: ids }, createdAt: { $gte: desde } },
            { projection: { 'property._id': 1, 'contact._id': 1, source: 1, createdAt: 1 } }
        ).toArray(),
        db.collection('visits').find(
            { 'steps.property._id': { $in: ids }, createdAt: { $gte: desde }, 'status.last': { $ne: 'cancelled' } },
            { projection: { 'steps.property._id': 1, 'contact._id': 1, createdAt: 1 } }
        ).toArray()
    ]);
    const primero = new Map<string, Date>(); // prop|contacto → primer lead
    const canal = new Map<string, Map<string, string>>(); // prop → contacto → canal
    for (const l of leads) {
        if (norm(l.source) === 'formulario de contacto') continue; // spam de bots
        const pid = String(l.property?._id), cid = String(l.contact?._id ?? l._id);
        const k = `${pid}|${cid}`;
        if (!primero.has(k) || l.createdAt < primero.get(k)!) primero.set(k, l.createdAt);
        if (!canal.has(pid)) canal.set(pid, new Map());
        const c = classifySource(l.source as string);
        const prev = canal.get(pid)!.get(cid);
        if (!prev || prev === 'Redes sociales') canal.get(pid)!.set(cid, c); // si llegó por portal y por Meta, cuenta como portal
    }
    const visito = new Map<string, Set<string>>();
    for (const v of visitas) {
        const cid = String(v.contact?._id);
        for (const st of (v.steps as Document[]) || []) {
            const pid = String(st.property?._id);
            const f = primero.get(`${pid}|${cid}`);
            if (f && v.createdAt >= f) {
                if (!visito.has(pid)) visito.set(pid, new Set());
                visito.get(pid)!.add(cid);
            }
        }
    }
    const out = new Map<string, Demanda>();
    for (const [pid, cs] of canal) {
        const porCanal: Record<string, number> = {};
        let meta = 0;
        for (const c of cs.values()) {
            if (c === 'Redes sociales') meta++;
            else porCanal[c] = (porCanal[c] || 0) + 1;
        }
        out.set(pid, { leads: cs.size - meta, leadsMeta: meta, visitas: visito.get(pid)?.size ?? 0, porCanal });
    }
    return out;
}

export async function fetchPauta(): Promise<PautaProp[]> {
    const db = await getDb();
    const raw = await db.collection('properties')
        .find({ 'contract.exclusive.pulppo': { $ne: null }, 'status.last': 'published' }, { projection: PROJ })
        .toArray();
    const dem = await demanda(db, raw.map((P) => P._id as ObjectId));
    const props = raw.map((P) => {
        const p = mapear(P);
        p.demanda = dem.get(p.id) ?? { leads: 0, leadsMeta: 0, visitas: 0, porCanal: {} };
        p.estrella = !p.excluida && esEstrella(p.demanda);
        if (p.demanda.leads >= 20 && p.demanda.visitas === 0) {
            p.avisos.push(`${p.demanda.leads} personas preguntaron en ${DIAS_DEMANDA} días y nadie visitó: revisar la calidad de esos leads y el precio antes de pautar.`);
        }
        return p;
    });
    return props.sort((a, b) => a.cluster.localeCompare(b.cluster, 'es') || (a.precio ?? 0) - (b.precio ?? 0));
}

export async function getPautaProp(code: string): Promise<PautaProp | null> {
    const db = await getDb();
    const P = await db.collection('properties').findOne({ internalId: code.trim().toUpperCase() }, { projection: PROJ });
    return P ? mapear(P) : null;
}
