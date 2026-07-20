// Generador de base (audiencia) en vivo para campañas 1·5·10. Dada una propiedad, arma la lista de
// destinatarios cruzando su colonia/ciudad/zona + tipo contra la DEMANDA real: gente que dejó lead
// por propiedades de esa zona y tipo. El email vive en leads.contact.email (contacts.email está vacío).
// Cascadeo: colonia → ciudad → zona hasta juntar al menos MIN correos. Dedup por email + excluye internos.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { extractEmail } from './validEmail';
import zonaMap from './zona_map.json';

const MIN = 300;                                  // umbral para ampliar al siguiente nivel
const INTERNAL = /@(pulppo\.com|propiedades\.com)$/i;
const ZONA: Record<string, string> = zonaMap as Record<string, string>;

const norm = (s: unknown) =>
    (s == null ? '' : String(s)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export type Level = 'colonia' | 'ciudad' | 'zona';
export interface AudienceRow { nombre: string; email: string; colonia: string | null }
export interface Audience {
    id: string; code: string; title: string; type: string | null;
    colonia: string | null; ciudad: string | null; zona: string | null;
    level: Level; count: number; rows: AudienceRow[];
}

async function findProperty(idOrCode: string): Promise<Document | null> {
    const db = await getDb();
    let P: Document | null = null;
    try { P = await db.collection('properties').findOne({ _id: new ObjectId(idOrCode) }); } catch { /* no es ObjectId */ }
    if (!P) P = await db.collection('properties').findOne({ internalId: idOrCode.trim().toUpperCase() });
    return P;
}

// Índice cacheado ciudad.id → zona (para el nivel más amplio). Se arma de las ciudades de properties
// mapeadas contra zona_map.json (por nombre normalizado). En memoria por instancia (Vercel).
let cityIdx: { toZona: Map<string, string>; zonaCities: Map<string, string[]> } | null = null;
async function cityZonaIndex() {
    if (cityIdx) return cityIdx;
    const db = await getDb();
    const cities = await db.collection('properties').aggregate([
        { $group: { _id: '$address.city.id', name: { $first: '$address.city.name' } } }
    ]).toArray();
    const toZona = new Map<string, string>();
    const zonaCities = new Map<string, string[]>();
    for (const c of cities) {
        const z = ZONA[norm(c.name)];
        if (!c._id || !z) continue;
        toZona.set(String(c._id), z);
        zonaCities.set(z, [...(zonaCities.get(z) || []), String(c._id)]);
    }
    cityIdx = { toZona, zonaCities };
    return cityIdx;
}

// Leads (con email) de las propiedades cuyos _id se pasan → filas dedup por email.
async function leadsFor(propIds: ObjectId[]): Promise<AudienceRow[]> {
    if (!propIds.length) return [];
    const db = await getDb();
    const docs = await db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: propIds }, 'contact.email': { $nin: [null, ''] } } },
        { $project: { email: { $toLower: '$contact.email' }, nombre: { $concat: [{ $ifNull: ['$contact.firstName', ''] }, ' ', { $ifNull: ['$contact.lastName', ''] }] }, colonia: '$property.address.neighborhood.name' } },
        { $group: { _id: '$email', nombre: { $first: '$nombre' }, colonia: { $first: '$colonia' } } }
    ], { allowDiskUse: true, maxTimeMS: 25000 }).toArray();
    // Extrae el mail (tirando el tel/basura) y re-deduplica: dos registros pueden traer el mismo correo
    // con distinta basura pegada y en Mongo cayeron en grupos distintos.
    const out: AudienceRow[] = [];
    const seen = new Set<string>();
    for (const d of docs) {
        const email = extractEmail(String(d._id ?? ''));
        if (!email || INTERNAL.test(email) || seen.has(email)) continue;
        seen.add(email);
        out.push({ email, nombre: String(d.nombre || '').trim() || '—', colonia: (d.colonia as string) ?? null });
    }
    return out;
}

async function propIdsBy(filter: Document): Promise<ObjectId[]> {
    const db = await getDb();
    const ps = await db.collection('properties').find(filter, { projection: { _id: 1 } }).limit(8000).toArray();
    return ps.map((p) => p._id as ObjectId);
}

export async function buildAudience(idOrCode: string): Promise<Audience | null> {
    const P = await findProperty(idOrCode);
    if (!P) return null;
    const id = String(P._id);
    const code = (P.internalId as string) ?? id;
    const title = (P.listing as Document)?.title as string ?? `Exclusiva ${code}`;
    const type = (P.type as string) ?? null;
    const addr = (P.address as Document) || {};
    const nbId = (addr.neighborhood as Document)?.id as string | undefined;
    const nbName = (addr.neighborhood as Document)?.name as string ?? null;
    const cityId = (addr.city as Document)?.id as string | undefined;
    const cityName = (addr.city as Document)?.name as string ?? null;
    const typeFilter = type ? { type } : {};

    // Nivel 1: colonia + tipo
    let level: Level = 'colonia';
    let rows: AudienceRow[] = [];
    if (nbId) rows = await leadsFor(await propIdsBy({ 'address.neighborhood.id': nbId, ...typeFilter }));

    // Nivel 2: ciudad + tipo
    if (rows.length < MIN && cityId) {
        const r2 = await leadsFor(await propIdsBy({ 'address.city.id': cityId, ...typeFilter }));
        if (r2.length >= rows.length) { rows = r2; level = 'ciudad'; }
    }

    // Nivel 3: zona + tipo (todas las ciudades de la misma zona)
    let zona: string | null = null;
    if (cityId) { const idx = await cityZonaIndex(); zona = idx.toZona.get(cityId) ?? ZONA[norm(cityName)] ?? null; }
    if (rows.length < MIN && zona) {
        const idx = await cityZonaIndex();
        const cids = idx.zonaCities.get(zona) || [];
        if (cids.length) {
            const r3 = await leadsFor(await propIdsBy({ 'address.city.id': { $in: cids }, ...typeFilter }));
            if (r3.length >= rows.length) { rows = r3; level = 'zona'; }
        }
    }

    rows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return { id, code, title, type, colonia: nbName, ciudad: cityName, zona, level, count: rows.length, rows };
}

export function audienceCsv(a: Audience): string {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['nombre,email,colonia_buscada'];
    for (const r of a.rows) lines.push([q(r.nombre), q(r.email), q(r.colonia)].join(','));
    return lines.join('\n');
}
