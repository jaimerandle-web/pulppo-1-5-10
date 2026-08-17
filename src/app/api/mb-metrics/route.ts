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

        // --- actividad del rango en propiedades que YA NO están publicadas (ver MBFuera en lib/mb.ts) ---
        // Al cerrarse, una propiedad sale de `published`: contando solo el inventario vivo, ofertas y
        // cierres del funnel daban ~0 siempre. Van aparte, con los campos que necesitan los filtros.
        const allProps = await db.collection('properties').find({ 'company._id': cid }, { projection: { _id: 1 } }).toArray();
        const allIds = allProps.map((p) => p._id as ObjectId);
        const pubSet = new Set(ids.map((x) => String(x)));
        const outIds = ((await db.collection('operations').distinct('property._id', {
            'property._id': { $in: allIds },
            $or: [{ 'status.last': { $in: ADVANCED }, createdAt: rng }, { 'status.last': { $in: ['closed', 'paying'] }, closedAt: rng }]
        })) as ObjectId[]).filter((x) => x && !pubSet.has(String(x)));

        const fuera: Array<Record<string, unknown>> = [];
        if (outIds.length) {
            const outDocs = await db.collection('properties').find({ _id: { $in: outIds } },
                { projection: { internalId: 1, type: 1, 'listing.operation': 1, 'address.neighborhood.name': 1, agent: 1 } }).toArray();
            const oVw = await byField('metrics', 'property', { property: { $in: outIds }, type: 'view', createdAt: rng });
            const oLd = await byField('leads', 'property._id', { 'property._id': { $in: outIds }, createdAt: rng });
            const oAns = await byField('leads', 'property._id', { 'property._id': { $in: outIds }, createdAt: rng, answeredAt: { $type: 'date' } });
            const oOf = await byField('operations', 'property._id', { 'property._id': { $in: outIds }, 'status.last': { $in: ADVANCED }, createdAt: rng });
            const oClo = await byField('operations', 'property._id', { 'property._id': { $in: outIds }, 'status.last': { $in: ['closed', 'paying'] }, closedAt: rng });
            const oVisRows = await db.collection('visits').aggregate([
                { $match: { 'steps.property._id': { $in: outIds }, 'status.last': 'confirmed', createdAt: rng } },
                { $unwind: '$steps' }, { $match: { 'steps.property._id': { $in: outIds } } },
                { $group: { _id: { p: '$steps.property._id', c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
                { $group: { _id: '$_id.p', n: { $sum: 1 } } }
            ]).toArray();
            const oVis = Object.fromEntries(oVisRows.map((r) => [String(r._id), r.n as number]));
            for (const p of outDocs) {
                const hex = String(p._id);
                const ag = p.agent as { firstName?: string; lastName?: string } | undefined;
                const pop = (p.listing as { operation?: string } | undefined)?.operation;
                const nb = (p.address as { neighborhood?: { name?: string } } | undefined)?.neighborhood?.name;
                fuera.push({
                    code: (p.internalId as string) ?? hex, type: (p.type as string) ?? '—',
                    op: pop === 'sale' ? 'Venta' : pop === 'rent' ? 'Renta' : '—',
                    colonia: nb ?? '—',
                    asesor: [ag?.firstName, ag?.lastName].filter(Boolean).join(' ').trim() || '—',
                    vistas: oVw[hex] ?? 0, leads: oLd[hex] ?? 0, respondidos: oAns[hex] ?? 0,
                    visitas: oVis[hex] ?? 0, ofertas: oOf[hex] ?? 0, cierres: oClo[hex] ?? 0
                });
            }
        }

        return Response.json({ leads, respondidos, vistas, visitas, ofertas, cierres, fuera });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
    }
}
