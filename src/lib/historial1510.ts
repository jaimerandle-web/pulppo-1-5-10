// Historial de la inmobiliaria en el programa 1·5·10: TODAS sus exclusivas, no sólo las vivas.
//
// **Por qué es un camino de datos aparte.** `mb.ts` filtra `status.last = 'published'`, así que
// las vendidas nunca llegan al cliente. Y para muchas cuentas el pasado es más grande que el
// presente: Diamond House tiene 26 exclusivas del programa y 20 YA SE VENDIERON —sólo 4 siguen
// publicadas—, y Andina tiene 5 de 5 vendidas. Mirando sólo lo vivo, Andina parecía una cuenta
// sin nada y en realidad tiene un historial perfecto.
//
// **Por qué es acumulado y no una serie mensual.** Con 5 a 26 propiedades por cuenta, una
// gráfica por mes serían casi puros ceros con un pico suelto: ruido, no tendencia. El
// acumulado —cuántas entraron, cuántas se vendieron, en cuánto tiempo— aguanta cualquier n.
import { getDb } from './data';
import { ObjectId, type Document } from 'mongodb';

const dig = (o: Document | null | undefined, ...ks: string[]): unknown =>
    ks.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Document)[k] : undefined), o);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const fecha = (v: unknown): Date | null => (v instanceof Date ? v : null);

export interface Hist1510 {
    id: string; code: string; tipo: string; colonia: string; asesor: string;
    precio: number | null;
    /** 'vendida' | 'publicada' | 'fuera' (cancelada, pausada, lo que sea que no esté viva) */
    estado: 'vendida' | 'publicada' | 'fuera';
    /** días entre publicación y cierre; sólo en las vendidas y si hay ambas fechas */
    diasVenta: number | null;
    /** meses publicada hasta hoy; sólo en las vivas */
    mesesVivos: number | null;
    leads: number; visitas: number;
}

export interface Historial {
    companyId: string;
    props: Hist1510[];
    /** vendidas con fecha utilizable, para la mediana */
    medianaDiasVenta: number | null;
    calculadoEn: string;
}

export async function historialDe(companyId: string): Promise<Historial> {
    const db = await getDb();
    const cid = new ObjectId(companyId);
    const hoy = Date.now();

    const docs = await db.collection('properties').find(
        { 'company._id': cid, 'contract.exclusive.pulppo': { $ne: null } },
        { projection: {
            internalId: 1, type: 1, 'listing.value': 1, 'address.neighborhood.name': 1,
            agent: 1, publishedAt: 1, 'status.last': 1, 'status.history': 1,
        } }).toArray();

    const ids = docs.map((d) => d._id as ObjectId);
    // Sin propiedades no hay nada que contar, y un $in vacío recorrería la colección entera.
    const [leadRows, visRows] = ids.length ? await Promise.all([
        db.collection('leads').aggregate([
            { $match: { 'property._id': { $in: ids } } },
            { $group: { _id: '$property._id', n: { $sum: 1 } } },
        ]).toArray(),
        // `visits` NO tiene `property._id` en la raíz: el camino es `steps.property._id`.
        // Con el camino equivocado sale 0 en todo. Se deduplica por persona, igual que mb.ts.
        db.collection('visits').aggregate([
            { $match: { 'steps.property._id': { $in: ids }, 'status.last': 'confirmed' } },
            { $unwind: '$steps' },
            { $match: { 'steps.property._id': { $in: ids } } },
            { $group: { _id: { p: '$steps.property._id',
                               c: { $ifNull: ['$contact._id', { $ifNull: ['$contact.email', '$_id'] }] } } } },
            { $group: { _id: '$_id.p', n: { $sum: 1 } } },
        ]).toArray(),
    ]) : [[], []];
    const leadMap = new Map(leadRows.map((r) => [String(r._id), r.n as number]));
    const visMap = new Map(visRows.map((r) => [String(r._id), r.n as number]));

    const dias: number[] = [];
    const props: Hist1510[] = docs.map((p) => {
        const hex = String(p._id);
        const last = String(dig(p, 'status', 'last') ?? '');
        const estado: Hist1510['estado'] =
            last === 'completed' ? 'vendida' : last === 'published' ? 'publicada' : 'fuera';

        const pub = fecha(p.publishedAt);
        let diasVenta: number | null = null;
        if (estado === 'vendida' && pub) {
            // 🔴 `status.history[].timestamp` a veces viene como TEXTO, no como Date: hay que
            // filtrar por tipo o la resta revienta con "str - datetime".
            const cierres = ((dig(p, 'status', 'history') as Document[]) ?? [])
                .filter((h) => h.status === 'completed')
                .map((h) => fecha(h.timestamp))
                .filter((d): d is Date => d != null);
            if (cierres.length) {
                const d = Math.round((Math.max(...cierres.map((x) => x.getTime())) - pub.getTime()) / 86400000);
                if (d > 0 && d < 2000) { diasVenta = d; dias.push(d); }
            }
        }

        const nom = [dig(p, 'agent', 'firstName'), dig(p, 'agent', 'lastName')]
            .filter(Boolean).join(' ').trim();

        return {
            id: hex,
            code: (p.internalId as string) ?? hex,
            tipo: (p.type as string) ?? '—',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? '—',
            asesor: nom || '—',
            precio: num(dig(p, 'listing', 'value')),
            estado,
            diasVenta,
            mesesVivos: estado === 'publicada' && pub
                ? Math.round(((hoy - pub.getTime()) / (30.44 * 86400000)) * 10) / 10 : null,
            leads: leadMap.get(hex) ?? 0,
            visitas: visMap.get(hex) ?? 0,
        };
    });

    dias.sort((a, b) => a - b);
    const m = Math.floor(dias.length / 2);
    const medianaDiasVenta = dias.length
        ? (dias.length % 2 ? dias[m] : Math.round((dias[m - 1] + dias[m]) / 2)) : null;

    props.sort((a, b) => {
        const orden = { vendida: 0, publicada: 1, fuera: 2 };
        return orden[a.estado] - orden[b.estado] || b.leads - a.leads;
    });

    return { companyId, props, medianaDiasVenta, calculadoEn: new Date().toISOString() };
}
