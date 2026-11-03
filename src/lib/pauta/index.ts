// Pauta de Meta para exclusivas 1·5·10: qué propiedades se pueden pautar, en qué cluster caen
// (zona × rango de precio), de qué inmobiliaria son y el paquete completo para que el equipo
// que monta las campañas (Habi) sólo suba: artes, video, copies, segmentación y UTMs.
//
// Fuentes que NO son Mongo (fotos fijas, se refrescan a mano):
// · videos.json   — cortes editados en Drive por código (carpeta de multimedia). Los videos de
//                   Mongo son ligas de YouTube y Meta no los acepta para anunciar.
// · historial.json — lo que ya se gastó en Meta por propiedad y lo que dio en el CRM.
import type { Document } from 'mongodb';
import { getDb } from '../data';
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
        copies: armarCopies(d),
        seg: armarSegmentacion(d)
    };
}

export async function fetchPauta(): Promise<PautaProp[]> {
    const db = await getDb();
    const props = await db.collection('properties')
        .find({ 'contract.exclusive.pulppo': { $ne: null }, 'status.last': 'published' }, { projection: PROJ })
        .toArray();
    return props.map(mapear).sort((a, b) => a.cluster.localeCompare(b.cluster, 'es') || (a.precio ?? 0) - (b.precio ?? 0));
}

export async function getPautaProp(code: string): Promise<PautaProp | null> {
    const db = await getDb();
    const P = await db.collection('properties').findOne({ internalId: code.trim().toUpperCase() }, { projection: PROJ });
    return P ? mapear(P) : null;
}
