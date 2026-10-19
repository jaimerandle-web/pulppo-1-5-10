// ¿Dónde más está publicado este inmueble? Lo comparten el expediente (/propiedad/[id]) y la ficha
// de desempeño (/ficha/[id]).
//
// Busca en dos lados:
//   · `mls` — el mercado scrapeado (propiedades.com, i24, EasyBroker, MeLi): la misma propiedad
//     publicada por otra agencia, por el propietario o por nosotros mismos con otro aviso.
//   · `properties` — otra propiedad de Pulppo (de la misma u otra inmobiliaria) que es el mismo
//     inmueble cargado dos veces.
//
// La llave NO puede ser el título ni las fotos (cada portal re-hostea las imágenes), así que se usa
// la misma firma que el dedup del MLS en mb.ts: mismo tipo y operación + superficie casi igual +
// precio cercano, y además cerca (≤300 m) o en la misma colonia. Dos niveles:
//   · «Muy probable» — superficie ±3%, precio ±3% y la misma calle o a ≤300 m.
//   · «Posible»      — superficie ±3%, precio ±15% y además la misma calle o a ≤150 m (el precio
//                      cambia entre portales y agencias, pero entonces exigimos más cercanía).
// Las recámaras, si las dos las traen y no coinciden, descartan.
//
// El rebote de NUESTRO MISMO aviso en el MLS (mismo id de portal) no es un duplicado y se omite.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';

export interface Duplicado {
    origen: 'mercado' | 'pulppo';
    nivel: 'Muy probable' | 'Posible';
    portal: string;
    /** quién la publica: inmobiliaria / agencia y asesor */
    quien: string;
    precio: number | null;
    m2: number | null;
    rec: number | null;
    calle: string | null;
    /** metros a la propiedad, si las dos tienen coordenadas */
    distancia: number | null;
    /** diferencia de precio contra la nuestra, en % */
    difPrecio: number | null;
    url: string | null;
    /** sólo origen 'pulppo' */
    pulppoId?: string;
    internalId?: string | null;
    estatus?: string | null;
}

const PORTAL: Record<string, string> = {
    propiedadesdotcom: 'Propiedades.com', 'propiedades.com': 'Propiedades.com', inmuebles24: 'Inmuebles24', 'inmuebles 24': 'Inmuebles24',
    easybroker: 'EasyBroker', mercadolibre: 'MercadoLibre', lamudi: 'Lamudi', 'casas-y-terrenos': 'Casas y Terrenos',
};
export const portalDe = (src: unknown) => PORTAL[String(src ?? '').trim().toLowerCase()] ?? (String(src ?? '').trim() || 'Mercado');

const dig = (d: unknown, ...ks: string[]): unknown => ks.reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), d);
const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const s = (x: unknown) => String(x ?? '').trim();
const nombre = (o: unknown) => [dig(o, 'firstName'), dig(o, 'lastName')].map(s).filter(Boolean).join(' ').replace(/\s+/g, ' ');
// calle sin número ni acentos: «Goldsmith 341» y «GOLDSMITH» son la misma
const calleKey = (c: unknown) => s(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(calle|av|avenida|blvd|boulevard|privada|priv|cerrada|cda)\b\.?/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const mismaCalle = (a: unknown, b: unknown) => { const x = calleKey(a), y = calleKey(b); return x.length > 3 && y.length > 3 && (x === y || x.startsWith(y) || y.startsWith(x)); };
const metros = (a: number[] | null, b: number[] | null): number | null => {
    if (!a || !b) return null;
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
const coords = (d: Document): number[] | null => {
    const c = dig(d, 'address', 'location', 'coordinates') as unknown[] | undefined;
    return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && (c[0] !== 0 || c[1] !== 0) ? [c[0], c[1]] : null;
};
const superficies = (d: Document) => [n(dig(d, 'attributes', 'totalSurface')), n(dig(d, 'attributes', 'roofedSurface'))].filter((x): x is number => x != null);

/** Todos los ids de portal de una propiedad nuestra (incluye avisos viejos de i24 del historial): un registro
 *  del MLS con uno de estos ids es NUESTRO MISMO aviso rebotado, no un duplicado. */
export function idsDePortal(P: Document): Set<string> {
    const out = new Set<string>();
    const add = (x: unknown) => { const v = s(x); if (v && v !== 'null' && v !== 'undefined') out.add(v.toUpperCase()); };
    for (const v of Object.values((P.portals as Record<string, unknown>) ?? {})) { add(dig(v, 'id')); add(dig(v, 'code')); }
    for (const h of ((dig(P, 'portals', 'inmuebles24', 'history') as Document[]) ?? [])) add(h?.idAvisoNavplat);
    // MeLi se guarda «MLM123» pero en la URL va «MLM-123»
    for (const v of [...out]) if (/^MLM\d+$/.test(v)) out.add(v.replace(/^MLM/, ''));
    return out;
}

const PROJ = {
    'import.source': 1, 'import.id': 1, 'import.url': 1, referenceCode: 1, portals: 1, 'company.name': 1, agent: 1,
    'listing.value': 1, 'attributes.totalSurface': 1, 'attributes.roofedSurface': 1, 'attributes.suites': 1,
    'address.street': 1, 'address.location': 1, 'status.last': 1, internalId: 1,
};

export async function duplicadosDe(P: Document): Promise<Duplicado[]> {
    const op = dig(P, 'listing', 'operation'), type = P.type, val = n(dig(P, 'listing', 'value'));
    const sup = superficies(P);
    if (!op || !type || !val || !sup.length) return [];
    const loc = coords(P), nb = s(dig(P, 'address', 'neighborhood', 'id'));
    const base = { 'listing.operation': op, type, 'status.last': 'published', 'listing.value': { $gte: val * 0.85, $lte: val * 1.15 } };
    const geo = loc ? { 'address.location': { $geoWithin: { $centerSphere: [loc, 0.3 / 6378.1] } } } : null;
    const db = await getDb();
    const q = (coll: string, extra: Document) => db.collection(coll).find({ ...base, ...extra }, { projection: PROJ, limit: 300 }).toArray().catch(() => [] as Document[]);
    const [mGeo, mNb, pGeo, pNb] = await Promise.all([
        geo ? q('mls', geo) : [], nb ? q('mls', { 'address.neighborhood.id': nb }) : [],
        geo ? q('properties', { ...geo, _id: { $ne: P._id } }) : [], nb ? q('properties', { 'address.neighborhood.id': nb, _id: { $ne: P._id } }) : [],
    ]);

    const propios = idsDePortal(P);
    const recP = n(dig(P, 'attributes', 'suites'));
    const calleP = dig(P, 'address', 'street');
    const vistos = new Set<string>();
    const out: Duplicado[] = [];
    const evalua = (d: Document, origen: Duplicado['origen']) => {
        const k = `${origen}:${String(d._id)}`;
        if (vistos.has(k)) return;
        vistos.add(k);
        const precio = n(dig(d, 'listing', 'value'));
        const supD = superficies(d);
        if (!precio || !supD.length) return;
        const supOk = sup.some((a) => supD.some((b) => Math.abs(a - b) <= Math.max(2, 0.03 * a)));
        if (!supOk) return;
        const rec = n(dig(d, 'attributes', 'suites'));
        if (recP != null && rec != null && recP !== rec) return;
        const dif = (precio / val - 1) * 100;
        const dist = metros(loc, coords(d));
        const calle = s(dig(d, 'address', 'street')) || null;
        const cerca = mismaCalle(calleP, calle) || (dist != null && dist <= 150);
        // misma colonia no basta: en Polanco hay decenas de depas de 250 m² a $19M. Sin cercanía (≤300 m o
        // la misma calle) sólo puede ser «posible», y sólo si el precio es casi igual.
        const junto = mismaCalle(calleP, calle) || (dist != null && dist <= 300);
        const nivel: Duplicado['nivel'] | null = Math.abs(dif) <= 3 && junto ? 'Muy probable'
            : (Math.abs(dif) <= 15 && cerca) || (Math.abs(dif) <= 1 && dist == null) ? 'Posible' : null;
        if (!nivel) return;
        if (origen === 'mercado') {
            const ids = [dig(d, 'import', 'id'), d.referenceCode, ...Object.values((d.portals as Record<string, unknown>) ?? {}).map((v) => dig(v, 'id'))].map((x) => s(x).toUpperCase()).filter(Boolean);
            const url = s(dig(d, 'import', 'url')) || (Object.values((d.portals as Record<string, unknown>) ?? {}).map((v) => s(dig(v, 'url'))).find(Boolean) ?? '');
            // nuestro mismo aviso rebotado (por id, o por el MLM dentro de la URL)
            if (ids.some((x) => propios.has(x)) || [...propios].some((x) => x.length > 5 && url.toUpperCase().includes(x))) return;
            const empresa = s(dig(d, 'company', 'name')), asesor = nombre(d.agent);
            out.push({
                origen, nivel, portal: portalDe(dig(d, 'import', 'source')),
                quien: [empresa, asesor && asesor.toLowerCase() !== empresa.toLowerCase() ? asesor : ''].filter(Boolean).join(' · ') || '—',
                precio, m2: supD[0], rec, calle, distancia: dist, difPrecio: Math.round(dif * 10) / 10, url: url || null,
            });
        } else {
            const i24 = s(dig(d, 'portals', 'inmuebles24', 'url')), ml = s(dig(d, 'portals', 'mercadolibre', 'url'));
            out.push({
                origen, nivel, portal: 'Pulppo', quien: [s(dig(d, 'company', 'name')), nombre(d.agent)].filter(Boolean).join(' · ') || '—',
                precio, m2: supD[0], rec, calle, distancia: dist, difPrecio: Math.round(dif * 10) / 10,
                url: i24 || ml || `https://pulppo.com/propiedades/${String(d._id)}`,
                pulppoId: String(d._id), internalId: (d.internalId as string) ?? null, estatus: s(dig(d, 'status', 'last')) || null,
            });
        }
    };
    for (const d of [...pGeo, ...pNb]) evalua(d, 'pulppo');
    for (const d of [...mGeo, ...mNb]) evalua(d, 'mercado');
    // el mismo aviso puede venir dos veces en el MLS (mismo URL desde dos cargas)
    const urls = new Set<string>();
    return out.filter((d) => !d.url || (urls.has(d.url) ? false : (urls.add(d.url), true)))
        .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'Muy probable' ? -1 : 1) || (a.origen === b.origen ? 0 : a.origen === 'pulppo' ? -1 : 1)
            || Math.abs(a.difPrecio ?? 99) - Math.abs(b.difPrecio ?? 99));
}

export const esObjectId = (x: string) => /^[a-f0-9]{24}$/i.test(x) && ObjectId.isValid(x);
