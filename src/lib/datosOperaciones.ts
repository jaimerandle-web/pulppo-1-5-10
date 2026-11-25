// Dos juegos más para la liga de Datos, para que los flujos de contenido y emailing corran sin Mongo
// (handover de DH, 25-nov-2026). Port de lo que leían carrusel_semanal.py, vendidas.py, casos_reales.py y
// clusters_base.py.
//
//   operaciones  cada operación de la inmobiliaria (cualquier lado): estatus, fechas, valor de cierre, la
//                propiedad (precio de salida, cambios de precio, días en el mercado) y SUS asesores.
//                🔒 Nunca el cliente: `seller.contact` / `buyer.contact` / `owner` son clientes y no salen.
//   demanda      búsquedas de TODA la red de los últimos 180 días en las colonias donde la inmobiliaria tiene
//                inventario: conteos y presupuestos máximos, sin personas.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';

type D = Document;
const g = (o: unknown, ...ks: string[]): unknown => ks.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as D)[k] : undefined), o);
const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v).trim() || null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const fecha = (v: unknown): Date | null => { if (v instanceof Date) return v; const d = v ? new Date(String(v)) : null; return d && !isNaN(+d) ? d : null; };
const OP: Record<string, string> = { sale: 'venta', rent: 'renta' };
const DIA = 86400000;

export type AsesorOp = { lado: 'vendedor' | 'comprador'; id: string | null; nombre: string | null; apellido: string | null; email: string | null; foto: string | null };
export type Operacion = {
    id: string; estatus: string | null; lado: string | null; creada: string | null; cierre: string | null;
    valor_cierre: number | null; moneda: string | null;
    propiedad: {
        id: string | null; codigo: string | null; tipo: string | null; operacion: string | null; colonia: string | null; municipio: string | null;
        m2: number | null; precio_salida: number | null; precio_actual: number | null; cambios_precio: number;
        publicada_desde: string | null; dias_publicada_a_oferta: number | null; dias_publicada_a_cierre: number | null;
    };
    asesores: AsesorOp[];
    comprador_de_otra_inmobiliaria: boolean | null; fuente_comprador: string | null;
};

/** Días del ciclo que terminó en esta operación: primera publicación (tras el último ciclo viejo) → 'completed'
 *  (oferta firme) o, si no hay, el cierre. Igual que vendidas.py. */
function diasCiclo(hist: D[], cierre: Date): number | null {
    const h = hist.map((x) => [s(x.status ?? x.value), fecha(x.timestamp ?? x.date)] as const)
        .filter(([, t]) => t && +t <= +cierre + DIA).sort((a, b) => +a[1]! - +b[1]!);
    let ini: Date | null = null, fin: Date | null = null;
    for (const [st, t] of h) {
        if (st === 'published' && !ini) ini = t;
        else if (st === 'completed' && ini) { fin = t; if (+t! < +cierre - 120 * DIA) ini = fin = null; }
    }
    return ini ? Math.round((+(fin ?? cierre) - +ini) / DIA) : null;
}

export async function operaciones(companyId: string): Promise<Operacion[]> {
    const db = await getDb();
    const co = new ObjectId(companyId);
    const PER = ['_id', 'firstName', 'lastName', 'email', 'profilePicture'];
    const ops = await db.collection('operations').find(
        { $or: [{ 'company._id': co }, { 'property.company._id': co }, { 'property.company._id': companyId }, { 'seller.company._id': co }, { 'buyer.company._id': co }] },
        { projection: Object.fromEntries(['status.last', 'side', 'closedAt', 'createdAt', 'closeValue.value', 'closeValue.price', 'closeValue.currency', 'property._id',
            'seller.company._id', 'buyer.company._id', 'buyer.company.external', 'buyer.source',
            ...PER.flatMap((k) => [`seller.broker.${k}`, `buyer.broker.${k}`])].map((k) => [k, 1])) },
    ).toArray();
    const pids = [...new Set(ops.map((o) => s(g(o, 'property', '_id'))).filter(Boolean) as string[])].map((x) => new ObjectId(x));
    const props = new Map((await db.collection('properties').find({ _id: { $in: pids } }, {
        projection: { internalId: 1, type: 1, 'listing.operation': 1, 'listing.price': 1, 'listing.priceHistory': 1, publishedAt: 1, 'status.history': 1,
            'address.neighborhood.name': 1, 'address.city.name': 1, 'attributes.roofedSurface': 1, 'attributes.totalSurface': 1 },
    }).toArray()).map((p) => [String(p._id), p]));

    return ops.map((o): Operacion => {
        const p: D = props.get(String(g(o, 'property', '_id'))) ?? {};
        const hist = ((g(p, 'listing', 'priceHistory') as D[]) || []).map((h) => n(h.price)).filter((x): x is number => !!x && x > 1000);
        const actual = n(g(p, 'listing', 'price', 'price'));
        const sh = ((g(p, 'status', 'history') as D[]) || []);
        const pubs = sh.filter((h) => (h.status ?? h.value) === 'published').map((h) => fecha(h.timestamp ?? h.date)).filter(Boolean) as Date[];
        const pub = pubs.length ? new Date(Math.min(...pubs.map(Number))) : fecha(p.publishedAt);
        const cierre = fecha(o.closedAt);
        const asesores: AsesorOp[] = [];
        for (const [lado, k] of [['vendedor', 'seller'], ['comprador', 'buyer']] as const) {
            if (String(g(o, k, 'company', '_id')) !== companyId) continue;
            const b = (g(o, k, 'broker') || {}) as D;
            if (!b.firstName && !b.email) continue;
            asesores.push({ lado, id: s(b._id), nombre: s(b.firstName), apellido: s(b.lastName), email: s(b.email)?.toLowerCase() ?? null, foto: s(b.profilePicture) });
        }
        const cv = g(o, 'closeValue') as D | undefined;
        return {
            id: String(o._id), estatus: s(g(o, 'status', 'last')), lado: s(o.side),
            creada: fecha(o.createdAt)?.toISOString() ?? null, cierre: cierre?.toISOString() ?? null,
            valor_cierre: n(cv?.value ?? cv?.price), moneda: s(cv?.currency) ?? (cv ? 'MXN' : null),
            propiedad: {
                id: s(g(o, 'property', '_id')), codigo: s(p.internalId), tipo: s(p.type), operacion: OP[String(g(p, 'listing', 'operation'))] ?? null,
                colonia: s(g(p, 'address', 'neighborhood', 'name')), municipio: s(g(p, 'address', 'city', 'name')),
                m2: n(g(p, 'attributes', 'roofedSurface')) || n(g(p, 'attributes', 'totalSurface')),
                precio_salida: hist[0] ?? actual, precio_actual: actual, cambios_precio: hist.length,
                publicada_desde: pub?.toISOString() ?? null,
                dias_publicada_a_oferta: cierre ? diasCiclo(sh, cierre) : null,
                dias_publicada_a_cierre: cierre && pub && +cierre > +pub ? Math.round((+cierre - +pub) / DIA) : null,
            },
            asesores,
            comprador_de_otra_inmobiliaria: g(o, 'buyer', 'company', '_id') ? String(g(o, 'buyer', 'company', '_id')) !== companyId : null,
            fuente_comprador: s(g(o, 'buyer', 'source')),
        };
    }).sort((a, b) => String(b.cierre ?? b.creada).localeCompare(String(a.cierre ?? a.creada)));
}

export type Demanda = { operacion: string; colonia: string; busquedas: number; personas: number; presupuestos_max: number[] };

/** Búsquedas de toda la red (180 días) en las colonias donde la inmobiliaria tiene inventario. */
export async function demanda(companyId: string, dias = 180): Promise<Demanda[]> {
    const db = await getDb();
    const cols = (await db.collection('properties').distinct('address.neighborhood.name', { 'company._id': new ObjectId(companyId) })).filter(Boolean) as string[];
    const desde = new Date(Date.now() - dias * DIA);
    const out = await db.collection('searches').aggregate([
        { $match: { createdAt: { $gte: desde }, 'filters.addresses.name': { $in: cols } } },
        { $project: { op: '$filters.operation', max: '$filters.price.max', c: '$contact._id', a: '$filters.addresses.name' } },
        { $unwind: '$a' }, { $match: { a: { $in: cols } } },
        { $group: { _id: { op: '$op', col: '$a' }, busquedas: { $sum: 1 }, personas: { $addToSet: '$c' }, max: { $push: '$max' } } },
    ], { allowDiskUse: true }).toArray();
    return out.filter((x) => OP[x._id.op]).map((x) => ({
        operacion: OP[x._id.op], colonia: x._id.col, busquedas: x.busquedas, personas: x.personas.filter(Boolean).length,
        presupuestos_max: (x.max as unknown[]).map(n).filter((v): v is number => !!v && v > 0).sort((a, b) => a - b),
    })).sort((a, b) => b.busquedas - a.busquedas);
}
