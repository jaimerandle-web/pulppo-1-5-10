import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/data';
import { canAccessCompany } from '@/lib/companyAccess';

// Métricas por propiedad (vistas/leads/visitas/ofertas) para un RANGO de fechas, para el filtro de
// fechas del listado /mb. Devuelve mapas { propId: n }. Datos en vivo, read-only.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADVANCED = ['offer', 'offer_blocked', 'contract', 'paying', 'closed'];

export async function POST(req: Request) {
    try {
        const { companyId, from, to } = (await req.json()) as { companyId?: string; from?: string; to?: string };
        if (!companyId || !from || !to) return Response.json({ error: 'Falta companyId / from / to' }, { status: 400 });
        // Interno: cualquier company. Externo: solo la suya.
        if (!(await canAccessCompany(companyId))) return Response.json({ error: 'No autorizado' }, { status: 403 });
        const fromD = new Date(from), toD = new Date(to);
        const db = await getDb();
        const cid = new ObjectId(companyId);
        const props = await db.collection('properties').find({ 'company._id': cid, 'status.last': 'published' }, { projection: { _id: 1 } }).toArray();
        const ids = props.map((p) => p._id as ObjectId);
        const rng = { $gte: fromD, $lte: toD };

        const byField = async (coll: string, field: string, match: Record<string, unknown>): Promise<Record<string, number>> => {
            const rows = await db.collection(coll).aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }], { allowDiskUse: true }).toArray();
            return Object.fromEntries(rows.map((r) => [String(r._id), r.n as number]));
        };

        const leads = await byField('leads', 'property._id', { 'property._id': { $in: ids }, createdAt: rng });
        // respondidos: leads del rango que sí tienen answeredAt (el funnel del listado lo usa)
        const respondidos = await byField('leads', 'property._id', { 'property._id': { $in: ids }, createdAt: rng, answeredAt: { $type: 'date' } });
        const cierres = await byField('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: ['closed', 'paying'] }, closedAt: rng });
        const vistas = await byField('metrics', 'property', { property: { $in: ids }, type: 'view', createdAt: rng });
        const ofertas = await byField('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: ADVANCED }, createdAt: rng });
        // visitas = visitantes únicos confirmados con la visita dentro del rango
        const visRows = await db.collection('visits').aggregate([
            { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed', createdAt: rng } },
            { $unwind: '$steps' }, { $match: { 'steps.property._id': { $in: ids } } },
            { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
            { $group: { _id: '$_id.p', n: { $sum: 1 } } }
        ]).toArray();
        const visitas = Object.fromEntries(visRows.map((r) => [String(r._id), r.n as number]));

        return Response.json({ leads, respondidos, vistas, visitas, ofertas, cierres });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
    }
}
