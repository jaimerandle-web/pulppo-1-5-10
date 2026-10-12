// Ortografía de títulos y descripciones del inventario publicado de una inmobiliaria.
//
//   GET /api/mb-ortografia?company=<id>
//
// Va aparte de /api/mb-metrics porque las sugerencias del corrector tardan unos segundos y no deben
// frenar la carga de /mb: la pantalla pinta y las etiquetas de ortografía llegan después.
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { canAccessCompany } from '@/lib/companyAccess';
import { getDb } from '@/lib/data';
import { revisarTexto, type ErrorOrto } from '@/lib/ortografia';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { t: number; d: unknown }>();
// nombres de colonias, ciudades y calles de TODA la red: en minúscula dentro de una descripción no son error
let lugares: { t: number; s: Set<string> } | null = null;
async function nombresDeLugares(): Promise<Set<string>> {
    if (lugares && Date.now() - lugares.t < 24 * CACHE_MS) return lugares.s;
    const db = await getDb();
    const s = new Set<string>();
    for (const campo of ['address.neighborhood.name', 'address.city.name', 'address.state.name'])
        for (const v of await db.collection('properties').distinct(campo))
            for (const w of String(v ?? '').toLowerCase().match(/[a-záéíóúüñ]{4,}/g) ?? []) s.add(w);
    lugares = { t: Date.now(), s };
    return s;
}

export async function GET(req: NextRequest) {
    const company = (req.nextUrl.searchParams.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    const hit = cache.get(company);
    if (hit && Date.now() - hit.t < CACHE_MS && req.nextUrl.searchParams.get('refresh') !== '1')
        return NextResponse.json(hit.d, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
        const db = await getDb();
        const [extra, props] = await Promise.all([
            nombresDeLugares(),
            db.collection('properties').find({ 'company._id': new ObjectId(company), 'status.last': 'published' },
                { projection: { internalId: 1, 'listing.title': 1, 'listing.description': 1, 'address.street': 1 } }).toArray(),
        ]);
        const porProp: Record<string, ErrorOrto[]> = {};
        for (const p of props) {
            const calle = new Set(String(p.address?.street ?? '').toLowerCase().match(/[a-záéíóúüñ]{4,}/g) ?? []);
            const ex = new Set([...extra, ...calle]);
            const errs = [...revisarTexto(p.listing?.title, 'título', ex), ...revisarTexto(p.listing?.description, 'descripción', ex)];
            if (errs.length) porProp[String(p.internalId ?? p._id)] = errs;
        }
        const d = { porProp, revisadas: props.length, generado: new Date().toISOString() };
        cache.set(company, { t: Date.now(), d });
        return NextResponse.json(d, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
        console.error('[mb-ortografia]', e);
        return NextResponse.json({ error: 'no se pudo revisar la ortografía' }, { status: 500 });
    }
}
