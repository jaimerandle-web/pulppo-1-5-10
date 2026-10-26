// Consultas a detalle de una inmobiliaria (/mb → Consultas). Reemplaza el Retool «Reporte de consultas y
// propiedades» que usaba Diamond House, pero con un solo cálculo y filtros que filtran TODO (Ale, oct-2026:
// «si filtro portal Inmuebles24, que me salgan sólo esos leads»).
//
// Devuelve la lista de leads del periodo elegido Y del periodo anterior de la misma duración (para comparar);
// la UI filtra y agrega en el cliente. Cada lead:
//   · ÚNICO: misma persona + misma propiedad = 1, contado la primera vez que escribió (400 días hacia atrás),
//     igual que Marketing y Desempeño.
//   · canal: el de /portales (classifySource); medio: WhatsApp / teléfono / formulario (canalContacto).
//   · DOS medidas de respuesta (Ale: «mostremos las dos»):
//       «respondidos» = `answeredAt` (igual que el Retool y la pestaña Propiedades; sólo dice que el asesor
//       abrió el chat desde la app, no que contestó) y
//       «con conversación visible» = hubo plática real del cliente en su interacción o en otra del mismo
//       contacto de −30 a +14 días (regla de /portales; en WhatsApp el chat del asesor no se guarda).
//   · etapa: la de su búsqueda (`searches.status.last`) y, si se descartó, el motivo (`status.reasonToFinish`).
//   · visitó / ofertó: visita (confirmada o pendiente) u operación del mismo contacto con la inmobiliaria,
//     después del lead.
// 🔴 Trae datos personales (nombre, teléfono, correo): sólo para la inmobiliaria dueña y el equipo interno.
import { CUENTA_PREMIER, TIPO_MELI } from './portales/avisosTipos';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { claveLead, VISITA_OK } from './mbComun';
import { classifySource, KEY2NAME, dig, isDate } from './portales/metrics';
import { canalContacto } from './portales/inmobiliaria';
import { nivelDe } from './marketingDh';

export interface LeadConsulta {
    id: string; fecha: string;
    nombre: string | null; telefono: string | null; correo: string | null;
    canal: string; medio: 'WhatsApp' | 'Teléfono' | 'Formulario';
    operacion: 'Venta' | 'Renta';
    /** tipo de aviso CON EL QUE LLEGÓ el lead (i24: Premier / SD / SD ZD / D / D ZD / Simple; MeLi: Gold premium / Silver…) */
    aviso: string | null;
    codigo: string | null; tipo: string | null; calle: string | null; colonia: string | null; precio: number | null; nivel: string | null;
    asesor: string;
    abierto: boolean; minutosRespuesta: number | null; conversacion: boolean;
    etapa: string; motivo: string | null; visito: boolean; oferto: boolean;
    mensaje: string | null;
}
export interface ConsultasData { desde: string; hasta: string; desdeAnt: string; leads: LeadConsulta[]; generado: string }

const DIA = 86400000;
/** El tipo de aviso viaja en el lead: i24 manda su tipo en `campaign` (HOME_COMBO…) y la cuenta del aviso en
 *  `propertyPublishPortals` (ANUNCIO_PREMIERE = la cuenta Premier de DH); MeLi manda gold_premium / silver. */
function avisoDeLead(canal: string, camp: string, cuenta: unknown): string | null {
    const c = camp.toUpperCase();
    if (canal === 'i24' || canal === 'i24nura') {
        if (!c && !cuenta) return null;
        if (String(cuenta ?? '').toUpperCase() === CUENTA_PREMIER) return 'Premier';
        const zd = c.includes('ZONA_DEMAND') ? ' ZD' : '';
        if (c.startsWith('HOME')) return 'SD' + zd;
        if (c.startsWith('DESTACADO')) return 'D' + zd;
        if (c.startsWith('GRATIS')) return 'Gratis';
        return c ? 'Simple' : null;
    }
    if (canal === 'meli') return TIPO_MELI[camp.toLowerCase()] ?? null;
    return null;
}
const MX = 6 * 3600 * 1000;
const s = (x: unknown) => String(x ?? '').trim();
const ymd = (d: Date) => new Date(d.getTime() - MX).toISOString().slice(0, 10);
const MEDIO = { whatsapp: 'WhatsApp', telefono: 'Teléfono', form: 'Formulario' } as const;
const ETAPA: Record<string, string> = {
    pending: 'Buscando', searching: 'Buscando', visiting: 'Visitando', offer_done: 'Ofertando', closing: 'Ofertando',
    completed: 'Cerró', cancelled: 'Descartado',
};
const MOTIVO: Record<string, string> = {
    descartado: 'Descartado', asesor: 'Era asesor / broker', fantasma: 'Fantasma', perdido: 'Perdido', incontactable: 'Incontactable',
    cancelado: 'Cancelado', inesperado: 'Inesperado', lost: 'Perdido', stop_answering: 'Dejó de contestar', lost_interest: 'Perdió interés',
    operaton_with_other_broker: 'Operó con otro broker', automatico: 'Cancelado automático', 'agent inactive': 'Asesor inactivo',
};
const PLACEHOLDER = /^(el cliente )?(vio|ver) (el )?tel[eé]fono\.?$|^vio el anuncio\.?$|^contact[oó] por whats?app\.?$|^es un lead de (tel[eé]fono|whats?app)\.?$/i;
const msgReal = (m: string) => ({ $and: [
    { $eq: [`${m}.from`, 'client'] },
    { $gt: [{ $strLenCP: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } } }, 0] },
    { $not: [{ $regexMatch: { input: { $trim: { input: { $toString: { $ifNull: [`${m}.message`, ''] } } } }, regex: PLACEHOLDER.source, options: 'i' } }] },
] });
const lotes = <T,>(xs: T[], n = 1000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Todas las compañías con el mismo nombre (Diamond House está partida en 2), sin Habi. */
export async function companiasDe(companyId: string): Promise<string[]> {
    const db = await getDb();
    const c = await db.collection('companies').findOne({ _id: new ObjectId(companyId) }, { projection: { name: 1 } });
    const nombre = s(c?.name);
    if (!nombre) return [companyId];
    const her = await db.collection('companies').find({ name: { $regex: `^\\s*${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' } }, { projection: { email: 1 } }).toArray();
    return [...new Set([companyId, ...her.filter((x) => !/tuhabi/i.test(s(x.email))).map((x) => String(x._id))])];
}

export async function consultasDe(companyId: string, desde: Date, hasta: Date): Promise<ConsultasData> {
    const db = await getDb();
    const ids = (await companiasDe(companyId)).map((x) => new ObjectId(x));
    const dur = hasta.getTime() - desde.getTime();
    const desdeAnt = new Date(desde.getTime() - dur);

    // leads: 400 días antes del periodo anterior para saber si la persona ya había escrito sobre esa propiedad
    const vistos = new Set<string>();
    const leads: Document[] = [];
    for (const l of await db.collection('leads').find({ 'company._id': { $in: ids }, createdAt: { $gte: new Date(desdeAnt.getTime() - 400 * DIA), $lt: hasta } }, { projection: {
        createdAt: 1, answeredAt: 1, source: 1, medium: 1, message: 1, phone: 1, email: 1, search: 1, 'contact._id': 1, 'contact.firstName': 1,
        'contact.lastName': 1, 'contact.email': 1, 'contact.phone': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'property._id': 1,
        'property.internalId': 1, 'property.type': 1, 'property.listing.operation': 1, 'property.listing.value': 1,
        'property.address.street': 1, 'property.address.neighborhood.name': 1, campaign: 1, 'propertyPublishPortals.portals.inmuebles24.company': 1,
    } }).sort({ createdAt: 1 }).toArray()) {
        if (!isDate(l.createdAt) || s(l.source).toLowerCase() === 'formulario de contacto') continue;   // spam de bots
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (l.createdAt >= desdeAnt) leads.push(l);
    }

    const contactos = [...new Set(leads.map((l) => dig(l, 'contact', '_id')).filter((x): x is ObjectId => x instanceof ObjectId).map(String))].map((x) => new ObjectId(x));
    const props = [...new Set(leads.map((l) => dig(l, 'property', '_id')).filter((x): x is ObjectId => x instanceof ObjectId).map(String))].map((x) => new ObjectId(x));
    const busq = [...new Set(leads.map((l) => l.search).filter((x): x is ObjectId => x instanceof ObjectId).map(String))].map((x) => new ObjectId(x));
    const conv = new Map<string, number[]>(), visitas = new Map<string, number[]>(), ofertas = new Map<string, number[]>();
    const etapa = new Map<string, { st: string; motivo: string }>(), nivel = new Map<string, string>();
    const push = (m: Map<string, number[]>, k: string, t: number) => (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    await Promise.all([
        // conversación real (regla de /portales), decidida EN MONGO
        ...lotes(contactos, 500).map(async (cs) => {
            for await (const it of db.collection('interactions').aggregate([
                { $match: { 'contact._id': { $in: cs } } },
                { $project: { c: '$contact._id', t: '$createdAt', real: { $or: [
                    { $gt: [{ $size: { $ifNull: ['$calls', []] } }, 0] },
                    { $anyElementTrue: [{ $map: { input: { $ifNull: ['$messages', []] }, as: 'm', in: msgReal('$$m') } }] },
                ] } } },
                { $match: { real: true } },
            ])) if (isDate(it.t)) push(conv, String(it.c), it.t.getTime());
        }),
        ...lotes(contactos).map(async (cs) => {
            for await (const v of db.collection('visits').find({ 'contact._id': { $in: cs }, 'agent.company._id': { $in: ids }, 'status.last': { $in: VISITA_OK } },
                { projection: { 'contact._id': 1, startTime: 1, createdAt: 1 } })) {
                const t = isDate(v.startTime) ? v.startTime : isDate(v.createdAt) ? v.createdAt : null;
                if (t) push(visitas, String(dig(v, 'contact', '_id')), t.getTime());
            }
        }),
        ...lotes(contactos).map(async (cs) => {
            for await (const o of db.collection('operations').find({ 'buyer.contact._id': { $in: cs }, $or: [{ 'buyer.company._id': { $in: ids } }, { 'seller.company._id': { $in: ids } }] },
                { projection: { 'buyer.contact._id': 1, createdAt: 1 } }))
                if (isDate(o.createdAt)) push(ofertas, String(dig(o, 'buyer', 'contact', '_id')), o.createdAt.getTime());
        }),
        ...lotes(busq).map(async (bs) => {
            for await (const b of db.collection('searches').find({ _id: { $in: bs } }, { projection: { 'status.last': 1, 'status.reasonToFinish': 1 } }))
                etapa.set(String(b._id), { st: s(dig(b, 'status', 'last')), motivo: s(dig(b, 'status', 'reasonToFinish')) });
        }),
        ...lotes(props).map(async (ps) => {
            for await (const p of db.collection('properties').find({ _id: { $in: ps } }, { projection: { 'portals.inmuebles24.type': 1, 'portals.inmuebles24.company': 1 } }))
                nivel.set(String(p._id), nivelDe(dig(p, 'portals', 'inmuebles24', 'type'), dig(p, 'portals', 'inmuebles24', 'company')));
        }),
    ]);

    const out: LeadConsulta[] = leads.map((l) => {
        const t = (l.createdAt as Date).getTime();
        const cid = s(dig(l, 'contact', '_id'));
        const b = etapa.get(s(l.search));
        const mot = b?.st === 'cancelled' ? (MOTIVO[b.motivo.toLowerCase()] ?? (b.motivo || 'Sin motivo')) : null;
        const resp = isDate(l.answeredAt) ? Math.round((l.answeredAt.getTime() - t) / 60000) : null;
        const pid = s(dig(l, 'property', '_id'));
        const op = dig(l, 'property', 'listing', 'operation');
        return {
            id: String(l._id), fecha: (l.createdAt as Date).toISOString(),
            nombre: [dig(l, 'contact', 'firstName'), dig(l, 'contact', 'lastName')].map(s).filter(Boolean).join(' ') || null,
            telefono: s(l.phone) || s(dig(l, 'contact', 'phone')) || null,
            correo: s(dig(l, 'contact', 'email')) || s(l.email) || null,
            canal: KEY2NAME[classifySource(s(l.source))] ?? (s(l.source) ? 'Otras fuentes' : 'Sin fuente'),
            medio: MEDIO[canalContacto({ medium: l.medium, message: l.message })],
            operacion: op === 'rent' ? 'Renta' : 'Venta',
            aviso: avisoDeLead(classifySource(s(l.source)), s(l.campaign), dig(l, 'propertyPublishPortals', 'portals', 'inmuebles24', 'company')),
            codigo: s(dig(l, 'property', 'internalId')) || null, tipo: s(dig(l, 'property', 'type')) || null,
            calle: s(dig(l, 'property', 'address', 'street')) || null, colonia: s(dig(l, 'property', 'address', 'neighborhood', 'name')) || null,
            precio: typeof dig(l, 'property', 'listing', 'value') === 'number' ? dig(l, 'property', 'listing', 'value') as number : null,
            nivel: nivel.get(pid) ?? null,
            asesor: [dig(l, 'agent', 'firstName'), dig(l, 'agent', 'lastName')].map(s).filter(Boolean).join(' ').replace(/\s+/g, ' ') || 'Sin asesor',
            abierto: resp != null, minutosRespuesta: resp != null && resp >= 0 ? resp : null,
            conversacion: (conv.get(cid) ?? []).some((x) => x >= t - 30 * DIA && x <= t + 14 * DIA),
            etapa: b ? (ETAPA[b.st] ?? 'Buscando') : 'Sin búsqueda', motivo: mot,
            visito: (visitas.get(cid) ?? []).some((x) => x >= t), oferto: (ofertas.get(cid) ?? []).some((x) => x >= t),
            mensaje: s(l.message).slice(0, 160) || null,
        };
    });
    return { desde: desde.toISOString(), hasta: hasta.toISOString(), desdeAnt: desdeAnt.toISOString(), leads: out.reverse(), generado: new Date().toISOString() };
}
export { ymd };
