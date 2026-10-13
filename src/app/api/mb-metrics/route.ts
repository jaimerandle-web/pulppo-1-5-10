import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/data';
import { canAccessCompany } from '@/lib/companyAccess';
import { VISITA_OK, claveLead, cierresInmobiliaria, enHorario, ladoVendedor } from '@/lib/mbComun';

// Métricas por propiedad (vistas/leads/visitas/ofertas) para un RANGO de fechas, para el filtro de
// fechas del listado /mb. Devuelve mapas { propId: n }. Datos en vivo, read-only.
// Mismas reglas que el resto de /mb (lib/mbComun.ts): leads ÚNICOS, atención sólo en horario
// (8 am – 8 pm MX), visitas por fecha de la visita (confirmadas + pendientes) y los cierres de
// Desempeño (ambos lados, sin duplicar). Las ofertas siguen por fecha de creación (Ale: el funnel
// se queda acumulado, no por cohorte).
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

        // leads ÚNICOS del rango (contacto + propiedad) y su atención en horario
        const porLeads = async (pids: ObjectId[]) => {
            const out = { leads: {} as Record<string, number>, respondidos: {} as Record<string, number>, lab: {} as Record<string, number>,
                labSin: {} as Record<string, number>, respMed: {} as Record<string, number> };
            const mins: Record<string, number[]> = {};
            const visto = new Set<string>();
            const docs = (await db.collection('leads').find({ 'property._id': { $in: pids }, createdAt: rng },
                { projection: { 'property._id': 1, 'contact._id': 1, createdAt: 1, answeredAt: 1 } }).toArray())
                .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
            const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
            for (const l of docs) {
                const k = claveLead(l); if (visto.has(k)) continue; visto.add(k);
                const pid = String((l.property as { _id?: unknown })?._id), ca = l.createdAt as Date, aa = l.answeredAt;
                inc(out.leads, pid);
                if (aa instanceof Date) inc(out.respondidos, pid);
                if (!(ca instanceof Date) || !enHorario(ca)) continue;
                inc(out.lab, pid);
                if (aa instanceof Date) (mins[pid] ??= []).push(Math.max(0, (aa.getTime() - ca.getTime()) / 60000)); else inc(out.labSin, pid);
            }
            for (const [pid, xs] of Object.entries(mins)) { xs.sort((a, b) => a - b); out.respMed[pid] = xs[Math.floor(xs.length / 2)]; }
            return out;
        };
        const ld = await porLeads(ids);
        const { leads, respondidos, lab, labSin, respMed } = ld;
        // cierres de Desempeño en el rango: a cada propiedad, los de su lado vendedor
        const cierresR = await cierresInmobiliaria(companyId, fromD, new Date(toD.getTime() + 1));
        const cierres: Record<string, number> = {};
        for (const c of cierresR) if (ladoVendedor(c)) cierres[c.propertyId] = (cierres[c.propertyId] ?? 0) + 1;
        const cierresComprador = cierresR.filter((c) => !ladoVendedor(c))
            .map((c) => ({ fecha: c.closedAt, op: c.op === 'sale' ? 'Venta' : c.op === 'rent' ? 'Renta' : '—', asesor: c.asesor, codigo: c.codigo }));
        const vistas = await byField('metrics', 'property', { property: { $in: ids }, type: 'view', createdAt: rng });
        const ofertas = await byField('operations', 'property._id', { 'property._id': { $in: ids }, 'status.last': { $in: ADVANCED }, createdAt: rng });
        // visitas = visitantes únicos con la visita (startTime) dentro del rango, confirmadas + pendientes
        const visRows = await db.collection('visits').aggregate([
            { $match: { 'steps.property._id': { $in: ids }, 'status.last': { $in: VISITA_OK }, startTime: rng } },
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
        // + las propiedades propias ya fuera del inventario con un cierre de Desempeño en el rango
        for (const c of cierresR) if (ladoVendedor(c) && c.propertyId && !pubSet.has(c.propertyId) && !outIds.some((x) => String(x) === c.propertyId)) {
            try { outIds.push(new ObjectId(c.propertyId)); } catch { /* id inválido */ }
        }

        const fuera: Array<Record<string, unknown>> = [];
        if (outIds.length) {
            const outDocs = await db.collection('properties').find({ _id: { $in: outIds } },
                { projection: { internalId: 1, type: 1, 'listing.operation': 1, 'address.neighborhood.name': 1, agent: 1 } }).toArray();
            const oVw = await byField('metrics', 'property', { property: { $in: outIds }, type: 'view', createdAt: rng });
            const oL = await porLeads(outIds);
            const oOf = await byField('operations', 'property._id', { 'property._id': { $in: outIds }, 'status.last': { $in: ADVANCED }, createdAt: rng });
            const oVisRows = await db.collection('visits').aggregate([
                { $match: { 'steps.property._id': { $in: outIds }, 'status.last': { $in: VISITA_OK }, startTime: rng } },
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
                    asesor: [ag?.firstName, ag?.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || '—',
                    vistas: oVw[hex] ?? 0, leads: oL.leads[hex] ?? 0, respondidos: oL.respondidos[hex] ?? 0,
                    visitas: oVis[hex] ?? 0, ofertas: oOf[hex] ?? 0, cierres: cierres[hex] ?? 0,
                    lab: oL.lab[hex] ?? 0, labSin: oL.labSin[hex] ?? 0
                });
            }
        }

        return Response.json({ leads, respondidos, lab, labSin, respMed, vistas, visitas, ofertas, cierres, fuera, cierresComprador });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
    }
}
