// Capa de datos del centro de mando 1·5·10 (port de mvp_data.py).
// Pull read-only de Mongo: exclusivas Pulppo vivas + programa completo. NUNCA loguea credenciales.
import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { getKam } from './kam';
import { CATS, type CarteraRow, type ProgramRow } from '@/types';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('Falta MONGO_URI (variable de entorno). Ver .env.example');
    if (!client) {
        client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
        await client.connect();
    }
    return client.db('pulppo');
}

function classifySource(src?: string | null): string {
    const s = (src || '').trim().toLowerCase();
    if (!s) return 'Sin fuente';
    if (s.includes('inmueble') || s.includes('i24')) return 'Inmuebles24';
    if (s.includes('meli') || s.includes('mercado')) return 'MercadoLibre';
    if (s.includes('lamudi')) return 'Lamudi';
    if (s.includes('propiedades.com') || s.includes('vivanuncios') || s.includes('trovit') || s.includes('icasas')) return 'Otros portales';
    if (s.includes('whats') || s === 'wa') return 'WhatsApp';
    if (s.includes('pulppo')) return 'Pulppo';
    if (s.includes('broker') || s.includes('red')) return 'Red brokers';
    if (s === 'fb' || s === 'ig' || s.includes('face') || s.includes('insta') || s.includes('tiktok') || s.includes('social')) return 'Redes sociales';
    if (s.includes('tel') || s.includes('phone') || s.includes('llamada') || s.includes('cel')) return 'Teléfono';
    if (s.includes('organic') || s.includes('google') || s.includes('seo') || s.includes('web')) return 'Orgánico/Google';
    return 'Otros';
}

function daysSince(dt?: Date | null): number | null {
    if (!dt) return null;
    return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

function month(dt?: Date | null): string | null {
    return dt ? dt.toISOString().slice(0, 7) : null;
}

// Lunes (UTC) de la semana de una fecha, como YYYY-MM-DD (mismo criterio que $dateTrunc startOfWeek:monday).
function mondayOf(d: Date): Date {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
}

// Serie semanal de leads/visitas, rellenando con 0 las semanas sin actividad hasta hoy.
function buildSerie(leadsWk: Record<string, number> = {}, visWk: Record<string, number> = {}) {
    const weeks = [...new Set([...Object.keys(leadsWk), ...Object.keys(visWk)])].sort();
    if (!weeks.length) return [];
    const end = mondayOf(new Date());
    const out: { week: string; leads: number; visitas: number }[] = [];
    for (const d = new Date(weeks[0] + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
        const wk = d.toISOString().slice(0, 10);
        out.push({ week: wk, leads: leadsWk[wk] || 0, visitas: visWk[wk] || 0 });
    }
    return out;
}

export async function fetchRows(): Promise<CarteraRow[]> {
    const db = await getDb();
    const FLAG = { 'contract.exclusive.pulppo': { $ne: null }, 'status.last': 'published' };
    const proj = {
        internalId: 1,
        'company.name': 1, 'agent.firstName': 1, 'agent.lastName': 1,
        type: 1, 'listing.title': 1, 'listing.value': 1, 'listing.operation': 1,
        videos: 1, 'marketing.Video.videoUrl': 1, virtualTour: 1,
        'address.neighborhood.name': 1, 'address.city.name': 1, 'address.state.name': 1,
        'contract.exclusive.pulppo': 1, 'contract.exclusive.durationMonths': 1,
        'status.last': 1, pictures: 1, 'portals.inmuebles24.type': 1
    };
    // Superdestacada en Inmuebles24 = producto Home Combo o Home Combo Zona Demand.
    const SUPER = new Set(['HOME_COMBO', 'HOME_COMBO_ZONA_DEMAND']);
    const props = await db.collection('properties').find(FLAG, { projection: proj }).toArray();
    const ids = props.map((p) => p._id as ObjectId);

    // leads por propiedad y fuente
    const leadsMap: Record<string, Record<string, number>> = {};
    const leadAgg = db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: ids } } },
        { $group: { _id: { pid: '$property._id', src: '$source' }, n: { $sum: 1 } } }
    ]);
    for await (const row of leadAgg) {
        const pid = String(row._id.pid);
        const cat = classifySource(row._id.src);
        leadsMap[pid] = leadsMap[pid] || {};
        leadsMap[pid][cat] = (leadsMap[pid][cat] || 0) + row.n;
    }

    // visitas (no canceladas)
    const visMap: Record<string, number> = {};
    const visAgg = db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': { $ne: 'cancelled' } } },
        { $unwind: '$steps' },
        { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: '$steps.property._id', n: { $sum: 1 } } }
    ]);
    for await (const r of visAgg) visMap[String(r._id)] = r.n;

    // desempeño en el tiempo: leads y visitas por semana (lunes) por propiedad
    const weekTrunc = (dateExpr: unknown) => ({
        $dateToString: { date: { $dateTrunc: { date: dateExpr, unit: 'week', startOfWeek: 'monday' } }, format: '%Y-%m-%d' }
    });
    const weeklyLeads: Record<string, Record<string, number>> = {};
    const lwAgg = db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: ids } } },
        { $group: { _id: { pid: '$property._id', wk: weekTrunc('$createdAt') }, n: { $sum: 1 } } }
    ]);
    for await (const r of lwAgg) (weeklyLeads[String(r._id.pid)] ??= {})[r._id.wk] = r.n;

    const weeklyVis: Record<string, Record<string, number>> = {};
    const vwAgg = db.collection('visits').aggregate([
        { $match: { 'steps.property._id': { $in: ids }, 'status.last': { $ne: 'cancelled' } } },
        { $unwind: '$steps' },
        { $match: { 'steps.property._id': { $in: ids } } },
        { $group: { _id: { pid: '$steps.property._id', wk: weekTrunc({ $ifNull: ['$steps.date', '$startTime'] }) }, n: { $sum: 1 } } }
    ]);
    for await (const r of vwAgg) (weeklyVis[String(r._id.pid)] ??= {})[r._id.wk] = r.n;

    // competencia por zona = publicados en venta en la misma colonia (todo el mercado en la base)
    const zonas = [...new Set(props.map((p) => p.address?.neighborhood?.name).filter(Boolean))] as string[];
    const zonaComp: Record<string, number> = {};
    if (zonas.length) {
        const zAgg = db.collection('properties').aggregate([
            { $match: { 'status.last': 'published', 'listing.operation': 'sale', 'address.neighborhood.name': { $in: zonas } } },
            { $group: { _id: '$address.neighborhood.name', n: { $sum: 1 } } }
        ]);
        for await (const r of zAgg) zonaComp[r._id] = r.n;
    }

    // estatus de operación por propiedad
    const opMap: Record<string, string | null> = {};
    const ops = db.collection('operations').find(
        { 'property._id': { $in: ids } },
        { projection: { 'property._id': 1, 'status.last': 1 } }
    );
    for await (const o of ops) {
        const opid = o.property?._id;
        if (opid != null) opMap[String(opid)] = o.status?.last ?? null;
    }

    const rows: CarteraRow[] = props.map((p: Document) => {
        const pid = String(p._id);
        const lm = leadsMap[pid] || {};
        const listing = p.listing || {};
        const pics = (p.pictures || []).length;
        const hasVideo = Boolean(p.videos?.length) || Boolean(p.marketing?.Video?.videoUrl);
        const hasTour = Boolean(p.virtualTour);
        const addr = p.address || {};
        const i24Type = p.portals?.inmuebles24?.type ?? null;
        const leads: Record<string, number> = {};
        for (const c of CATS) leads[c] = lm[c] || 0;
        return {
            id: pid,
            internalId: p.internalId ?? null,
            inmobiliaria: p.company?.name ?? null,
            broker: [p.agent?.firstName, p.agent?.lastName].filter(Boolean).join(' '),
            kam: getKam(p.company?.name),
            tipo: p.type ?? null,
            titulo: listing.title ?? null,
            precio: listing.value ?? null,
            colonia: addr.neighborhood?.name ?? null,
            ciudad: addr.city?.name ?? null,
            estado: addr.state?.name ?? null,
            dias_activa: daysSince(p.contract?.exclusive?.pulppo),
            op_status: opMap[pid] ?? null,
            leads_total: Object.values(lm).reduce((a, b) => a + b, 0),
            visitas: visMap[pid] || 0,
            fotos: pics,
            video: hasVideo,
            tour: hasTour,
            material_ok: pics >= 12 && hasVideo && hasTour,
            i24_type: i24Type,
            superdestacada: SUPER.has(i24Type),
            zona_oferta: addr.neighborhood?.name ? (zonaComp[addr.neighborhood.name] ?? 0) : null,
            serie: buildSerie(weeklyLeads[pid], weeklyVis[pid]),
            url: `https://pulppo.com/propiedades/${pid}`,
            leads
        };
    });
    rows.sort((a, b) => (b.leads_total || 0) - (a.leads_total || 0));
    return rows;
}

export async function fetchProgram(): Promise<ProgramRow[]> {
    const db = await getDb();
    const FLAG = { 'contract.exclusive.pulppo': { $ne: null } };
    const proj = {
        'company.name': 1, type: 1, 'listing.value': 1, 'listing.operation': 1,
        'status.last': 1, 'status.history': 1, internalId: 1,
        'contract.exclusive.pulppo': 1, 'contract.exclusive.durationMonths': 1,
        'address.city.name': 1, 'address.neighborhood.name': 1
    };
    const props = await db.collection('properties').find(FLAG, { projection: proj }).toArray();
    const ids = props.map((p) => p._id as ObjectId);

    // operaciones: preferir la más avanzada (closed/paying=Concretada, offer/offer_blocked/contract=Activa)
    const rank: Record<string, number> = { closed: 5, paying: 4, contract: 3, offer_blocked: 2, offer: 1 };
    const opMap: Record<string, Document> = {};
    const ops = db.collection('operations').find(
        { 'property._id': { $in: ids } },
        {
            projection: {
                'property._id': 1, id: 1, side: 1, 'status.last': 1, closedAt: 1,
                'closeValue.value': 1, 'comission.value': 1, 'comission.invoiceUrl': 1,
                'pulppoComission.value': 1, 'buyer.commission.client.value': 1,
                'user.firstName': 1, 'user.lastName': 1, 'user.email': 1, 'user.company.name': 1,
                'buyer.broker.firstName': 1, 'buyer.broker.lastName': 1, 'buyer.company.name': 1
            }
        }
    );
    for await (const o of ops) {
        const opid = o.property?._id;
        if (opid == null) continue;
        const st = o.status?.last;
        const prev = opMap[String(opid)];
        if (!prev || (rank[st] || 0) >= (rank[prev.status] || 0)) {
            const u = o.user || {};
            const b = o.buyer || {};
            const bb = b.broker || {};
            opMap[String(opid)] = {
                status: st ?? null,
                op_id: o.id ?? null,
                side: o.side ?? null,
                closedAt: o.closedAt ?? null,
                cierre: o.closeValue?.value ?? null,
                comision: o.comission?.value ?? null,
                factura: o.comission?.invoiceUrl ?? null,
                regalia: o.pulppoComission?.value ?? null,
                com_comprador: b.commission?.client?.value ?? null,
                vendedor: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
                vendedor_mail: u.email ?? null,
                inmo_vendedor: u.company?.name ?? null,
                broker_comprador: [bb.firstName, bb.lastName].filter(Boolean).join(' ') || null,
                inmo_comprador: b.company?.name ?? null
            };
        }
    }

    const completedTs = (hist?: Document[]): Date | null => {
        const ts = (hist || [])
            .filter((h) => h.status === 'completed' && h.timestamp instanceof Date)
            .map((h) => h.timestamp as Date);
        return ts.length ? new Date(Math.max(...ts.map((d) => d.getTime()))) : null;
    };

    const ACTIVA = new Set(['offer', 'offer_blocked', 'contract']);
    const BUYER_FACTOR: Record<string, number> = { both: 0.5, seller: 0.5, buyer: 1.0 };

    return props.map((p: Document) => {
        const pid = String(p._id);
        const act: Date | null = p.contract?.exclusive?.pulppo ?? null;
        const dur = p.contract?.exclusive?.durationMonths || 6;
        const op = opMap[pid] || {};
        const st = p.status?.last ?? null;
        // Diccionario oficial: properties.status.last == 'completed' = Vendido/Rentado (aquí todo es venta)
        const vendida = st === 'completed';
        let vfecha = vendida ? completedTs(p.status?.history) : null;
        if (vendida && !vfecha) vfecha = op.closedAt ?? null; // fallback si no hay timestamp en history
        const dtsale = vendida && act && vfecha ? Math.floor((vfecha.getTime() - act.getTime()) / 86400000) : null;
        const addr = p.address || {};
        // bono estimado = 5% de la comisión del lado comprador. base real si existe; si no, estimar por side.
        const com = op.comision as number | null;
        const cc = op.com_comprador as number | null;
        const side = op.side as string | null;
        const baseBono = cc ? cc : com ? com * (BUYER_FACTOR[side || ''] ?? 0.5) : null;
        const bonoEst = baseBono ? Math.round(0.05 * baseBono) : null;
        return {
            id: pid,
            internalId: p.internalId ?? null,
            bono_est: bonoEst,
            inmobiliaria: p.company?.name ?? null,
            kam: getKam(p.company?.name),
            tipo: p.type ?? null,
            precio: p.listing?.value ?? null,
            precio_cierre: op.cierre ?? null,
            ciudad: addr.city?.name ?? null,
            colonia: addr.neighborhood?.name ?? null,
            status: st,
            op_status: op.status ?? null,
            alta: act ? act.toISOString() : null,
            alta_mes: month(act),
            dur_meses: dur,
            vendida,
            venta_mes: vendida ? month(vfecha) : null,
            venta_fecha: vendida && vfecha ? vfecha.toISOString() : null,
            cierre_fin: op.status ?? null, // closed/paying = concretada; contract/offer = activa
            comision: op.comision ?? null,
            regalia: op.regalia ?? null,
            com_comprador: op.com_comprador ?? null,
            factura: op.factura ?? null,
            op_id: op.op_id ?? null,
            side,
            vendedor: op.vendedor ?? null,
            inmo_vendedor: op.inmo_vendedor ?? null,
            broker_comprador: op.broker_comprador ?? null,
            inmo_comprador: op.inmo_comprador ?? null,
            dias_venta: dtsale,
            dias_activa: daysSince(act),
            en_proceso: !vendida && ACTIVA.has(op.status)
        };
    });
}
