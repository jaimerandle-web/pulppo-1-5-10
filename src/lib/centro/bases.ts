/* ------------------------------------------------------------------ *
 * Centro de Marketing — las bases, leídas en vivo de Mongo.
 *
 * Cada base es UNA CONSULTA, no una lista exportada. Así el centro queda
 * sincronizado solo: si hoy se publica una renta, su propietario aparece
 * mañana sin que nadie toque un CSV.
 *
 * Mapa de dónde sale cada quién (medido 8-sep-2026):
 *  · brokers            agents.status='active' + type associate|master → 1,098
 *  · inmobiliarias      companies.external=false + status='active'     →   252
 *  · propietarios-renta properties.contact de rentas publicadas        → 2,180 (97% con teléfono)
 *  · propietarios       contacts.tags ~ /propietario/i                 → 5,759
 *  · inquilinos         contacts.tags ~ /inquilino/i                   → 1,340
 *  · brokers-externos   contacts.tags ~ /broker/i                      → 53,687
 *  · compradores        leads con contacto, últimos 90d
 *  · pulppers           agents.type='staff' activos                    →    15
 *
 * TRAMPAS que ya nos costaron caro y están resueltas acá:
 *  1. Los tags de `contacts` NO están normalizados: conviven 'Broker' (32,284)
 *     y 'broker' (29,895), 'Propietario' (3,734) y 'propietario' (2,044).
 *     Filtrar por el valor exacto pierde la mitad de la base → siempre /i.
 *  2. `operation.type` NO existe (es {_id, status}). Venta vs renta se
 *     distingue por `listing.operation` ('sale' | 'rent').
 *  3. Sólo el 31% de los contacts tiene email (254k de 808k) contra 94% con
 *     teléfono. El canal real es WhatsApp; el correo deja fuera a 2 de cada 3.
 * ------------------------------------------------------------------ */

import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { BANDAS, type BaseId, type BaseResultado, type Cluster, type FiltroDemanda, type Persona } from './tipos';

const LIMITE = 500; // filas que se mandan al navegador; el total sí es real

const nombreDe = (o: Document | null | undefined, fb = 'Sin nombre'): string =>
    [o?.firstName, o?.lastName].filter(Boolean).join(' ').trim() || fb;

/** Primer teléfono utilizable de un contacts.phones[] (prefiere el de WhatsApp). */
function telDeContacto(c: Document): string | null {
    const ps: Document[] = Array.isArray(c.phones) ? c.phones : [];
    const wa = ps.find((p) => p?.type === 'whatsapp' && p?.phone);
    const def = ps.find((p) => p?.is_default && p?.phone);
    return (wa?.phone || def?.phone || ps.find((p) => p?.phone)?.phone || null) as string | null;
}

function mailDeContacto(c: Document): string | null {
    const es = Array.isArray(c.emails) ? c.emails : [];
    const first = es.find((e: unknown) => typeof e === 'string' ? e : (e as Document)?.email);
    if (!first) return null;
    return (typeof first === 'string' ? first : (first as Document).email) || null;
}

export { BASES } from './basesMeta';

/* ---------------------------- cargadores ---------------------------- */

/**
 * La cartera de renta de cada asesor, que es lo que Ulises necesita ver para
 * pedirle permiso: cuántas captó, cuántos dueños distintos hay detrás y
 * cuánta gente sigue buscando rentar con él.
 *
 * Rentas y propietarios NO son el mismo número: un dueño puede tener tres
 * departamentos en el mismo edificio, y en ese caso es UNA conversación.
 */
async function carteraRentaPorAsesor(): Promise<Map<string, { rentas: number; propietarios: number }>> {
    const db = await getDb();
    const agg = db.collection('properties').aggregate([
        { $match: { 'listing.operation': 'rent', 'status.last': 'published' } },
        { $group: { _id: '$agent._id', rentas: { $sum: 1 }, duenos: { $addToSet: '$contact._id' } } },
        { $project: { rentas: 1, propietarios: { $size: '$duenos' } } }
    ]);
    const out = new Map<string, { rentas: number; propietarios: number }>();
    for await (const r of agg) {
        if (r._id) out.set(String(r._id), { rentas: r.rentas as number, propietarios: r.propietarios as number });
    }
    return out;
}

/**
 * Búsquedas de renta VIVAS por asesor = "leads activos interesados en rentar".
 *
 * Dos decisiones de dato que importan:
 *  · El estado se lee de `status.last`, NO de `cancelledAt`. Ese campo miente:
 *    da 199,109 búsquedas "sin cancelar" cuando `status.last='cancelled'` son
 *    175,780 de 211,263. Usar cancelledAt triplicaría el número.
 *  · Se piden 90 días de frescura. Una búsqueda "searching" de hace dos años
 *    no es un interesado, es una que nadie cerró (el 83% de las de renta
 *    terminan canceladas).
 */
const VIVAS = ['searching', 'pending', 'visiting', 'offer_done', 'closing'];

async function busquedasRentaPorAsesor(dias = 90): Promise<Map<string, number>> {
    const db = await getDb();
    const agg = db.collection('searches').aggregate([
        {
            $match: {
                'filters.operation': 'rent',
                'status.last': { $in: VIVAS },
                updatedAt: { $gte: new Date(Date.now() - dias * 864e5) },
                'contact.phone': { $nin: [null, ''] }
            }
        },
        { $group: { _id: '$agent._id', personas: { $addToSet: '$contact._id' } } },
        { $project: { n: { $size: '$personas' } } }
    ]);
    const out = new Map<string, number>();
    for await (const r of agg) if (r._id) out.set(String(r._id), r.n as number);
    return out;
}

async function cargarBrokers(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { status: 'active', type: { $in: ['associate', 'master'] } };
    const [total, docs, cartera, busquedas] = await Promise.all([
        db.collection('agents').countDocuments(q),
        db.collection('agents').find(q, {
            projection: {
                firstName: 1, lastName: 1, email: 1, phone: 1, type: 1, whatsapp: 1,
                'company.name': 1, 'company._id': 1, 'personal.phone': 1
            }
        }).toArray(),
        carteraRentaPorAsesor(),
        busquedasRentaPorAsesor()
    ]);

    let personas: Persona[] = docs.map((a) => {
        const id = String(a._id);
        const c = cartera.get(id);
        return {
            id,
            nombre: nombreDe(a),
            telefono: (a.phone || a.personal?.phone || null) as string | null,
            email: (a.email || null) as string | null,
            asesorId: id, // el broker se autoriza a sí mismo
            asesor: nombreDe(a),
            inmobiliaria: (a.company?.name || null) as string | null,
            extra: {
                rentas: c?.rentas ?? 0,
                propietarios: c?.propietarios ?? 0,
                busquedas: busquedas.get(id) ?? 0,
                rol: a.type === 'master' ? 'Master' : 'Asesor',
                // Sin WhatsApp vinculado el asesor contesta por fuera: la opción
                // "escriban en mi nombre" no se le puede ofrecer.
                whatsapp: a.whatsapp ? 'Sí' : 'No'
            }
        };
    });

    // Primero los que más tienen para conversar: es el orden en que Ulises
    // los va a llamar.
    personas.sort((a, b) =>
        (Number(b.extra.rentas) - Number(a.extra.rentas)) ||
        (Number(b.extra.busquedas) - Number(a.extra.busquedas)));
    personas = personas.slice(0, LIMITE);

    return {
        id: 'brokers', label: 'Brokers', total, personas,
        columnas: [
            { key: 'rentas', label: 'Rentas captadas' },
            { key: 'propietarios', label: 'Propietarios' },
            { key: 'busquedas', label: 'Buscan rentar' },
            { key: 'rol', label: 'Rol' }
        ],
        notas: [
            'Rentas y propietarios no son el mismo número: un dueño puede tener varias, y ahí es una sola conversación.',
            '"Buscan rentar" = búsquedas de renta vivas con teléfono, movidas en los últimos 90 días. El estado sale de status.last, no de cancelledAt (ese campo miente: da 199k sin cancelar contra 176k canceladas de verdad).',
            'El asesor sin WhatsApp vinculado no puede recibir la opción "escriban en mi nombre".'
        ]
    };
}

async function cargarInmobiliarias(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { external: false, status: 'active' };
    const [total, docs] = await Promise.all([
        db.collection('companies').countDocuments(q),
        db.collection('companies').find(q, { projection: { name: 1, email: 1, phone: 1, contactMethod: 1 } })
            .limit(LIMITE).toArray()
    ]);
    return {
        id: 'inmobiliarias', label: 'Inmobiliarias', total,
        personas: docs.map((c) => ({
            id: String(c._id),
            nombre: (c.name || 'Sin nombre').trim(),
            telefono: (c.phone || null) as string | null,
            email: (c.email || null) as string | null,
            asesorId: null, asesor: null,
            inmobiliaria: (c.name || null) as string | null,
            extra: { contacto: (c.contactMethod as string) || '—' }
        })),
        columnas: [{ key: 'contacto', label: 'Método' }],
        notas: []
    };
}

/**
 * La audiencia del MVP. El propietario NO es un contacto etiquetado: es
 * `properties.contact` de una renta publicada. Ahí está el 97% con teléfono
 * (contra el 31% de email de la base general de contacts).
 */
async function cargarPropietariosRenta(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { 'listing.operation': 'rent', 'status.last': 'published', 'contact._id': { $ne: null } };
    const [total, docs] = await Promise.all([
        db.collection('properties').countDocuments(q),
        db.collection('properties').find(q, {
            projection: {
                internalId: 1, publishedAt: 1, 'listing.title': 1, 'listing.value': 1,
                contact: 1, 'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'company.name': 1
            }
        }).sort({ publishedAt: -1 }).limit(LIMITE).toArray()
    ]);

    const personas: Persona[] = docs.map((p) => ({
        // La clave es el CONTACTO, no la propiedad: un propietario con tres
        // rentas es una sola persona y debe recibir un solo mensaje.
        id: String(p.contact?._id),
        nombre: nombreDe(p.contact),
        telefono: (p.contact?.phone || null) as string | null,
        email: (p.contact?.email || null) as string | null,
        asesorId: p.agent?._id ? String(p.agent._id) : null,
        asesor: nombreDe(p.agent, '—'),
        inmobiliaria: (p.company?.name || null) as string | null,
        extra: {
            codigo: (p.internalId as string) || '—',
            propiedad: (p.listing?.title as string) || '—',
            renta: (p.listing?.value as number) ?? null,
            publicada: p.publishedAt instanceof Date ? p.publishedAt.toISOString().slice(0, 10) : null,
            // El "propietario" que en realidad es otra agencia no debe recibir
            // el mensaje de tranquilidad: es un colega, no un dueño.
            esBroker: p.contact?.company?._id ? 'Sí' : 'No'
        }
    }));

    return {
        id: 'propietarios-renta', label: 'Propietarios de renta', total, personas,
        columnas: [
            { key: 'codigo', label: 'Código' },
            { key: 'propiedad', label: 'Propiedad' },
            { key: 'renta', label: 'Renta' },
            { key: 'publicada', label: 'Publicada' },
            { key: 'esBroker', label: '¿Es agencia?' }
        ],
        notas: [
            '97% tiene teléfono, 82% email. El canal es WhatsApp.',
            'Un propietario con varias rentas aparece una vez por propiedad: se deduplica por contacto al programar.',
            '"¿Es agencia?" marca al contacto que trae company: ése es un colega, no un dueño.'
        ]
    };
}

/** Bases que salen de `contacts` por tag. Ojo: tags sin normalizar → /i. */
async function cargarPorTag(id: BaseId, label: string, tag: string, notas: string[]): Promise<BaseResultado> {
    const db = await getDb();
    const q = { tags: { $regex: tag, $options: 'i' } };
    const [total, docs] = await Promise.all([
        db.collection('contacts').countDocuments(q),
        db.collection('contacts').find(q, {
            projection: { firstName: 1, lastName: 1, phones: 1, emails: 1, tags: 1, source: 1, createdAt: 1, agent: 1 }
        }).sort({ updatedAt: -1 }).limit(LIMITE).toArray()
    ]);
    return {
        id, label, total,
        personas: docs.map((c) => ({
            id: String(c._id),
            nombre: nombreDe(c),
            telefono: telDeContacto(c),
            email: mailDeContacto(c),
            asesorId: c.agent?._id ? String(c.agent._id) : null,
            asesor: nombreDe(c.agent, '—'),
            inmobiliaria: (c.agent?.company?.name || null) as string | null,
            extra: { origen: (c.source as string) || '—', tags: (c.tags as string[] || []).join(', ') || '—' }
        })),
        columnas: [{ key: 'origen', label: 'Origen' }, { key: 'tags', label: 'Tags' }],
        notas
    };
}

/* ------------------------- demanda / compradores ------------------------- */

/**
 * "Compradores" sale de `searches`, no de `leads`, y la diferencia importa:
 * el lead dice lo que la persona HIZO (tocó tal propiedad), la búsqueda dice
 * lo que DECLARÓ que quiere — estado, colonias y presupuesto. Sin eso no hay
 * con qué armar clusters.
 *
 * (El enviador de /campanas usa leads a propósito: para una exclusiva concreta
 * la preferencia revelada predice mejor. Son dos herramientas distintas.)
 */
const DEMANDA_BASE = () => ({
    'status.last': { $in: VIVAS },
    updatedAt: { $gte: new Date(Date.now() - 90 * 864e5) },
    'contact._id': { $ne: null },
    'contact.phone': { $nin: [null, ''] }
});

/**
 * "Edo. de México" (11,821) y "Estado de México" (262) son el mismo estado
 * escrito de dos formas. Filtrar por uno pierde al otro y borra Edomex del
 * análisis sin avisar.
 */
const ALIAS_ESTADO: Record<string, string> = {
    'estado de méxico': 'Edo. de México',
    'estado de mexico': 'Edo. de México',
    'edo. de mexico': 'Edo. de México',
    'méxico': 'Edo. de México',
    'mexico': 'Edo. de México'
};
export const normEstado = (s?: string | null): string =>
    !s ? '—' : (ALIAS_ESTADO[s.trim().toLowerCase()] ?? s.trim());

/** Todas las grafías que hay que buscar para un estado normalizado. */
const grafiasDe = (estado: string): string[] => {
    const canon = normEstado(estado);
    const otras = Object.keys(ALIAS_ESTADO).filter((k) => ALIAS_ESTADO[k] === canon);
    return [...new Set([canon, ...otras])];
};

/** Traduce los filtros de la UI a un $match de Mongo. */
function matchDemanda(f: FiltroDemanda): Document {
    const q: Document = DEMANDA_BASE();
    if (f.operacion) q['filters.operation'] = f.operacion;
    if (f.tipo) q['filters.types'] = f.tipo;
    if (f.colonia) q['filters.addresses.neighborhood.name'] = f.colonia;
    if (f.estado) {
        // Case-insensitive sobre todas las grafías conocidas del estado.
        q['filters.addresses.state.name'] = {
            $in: grafiasDe(f.estado).map((g) => new RegExp(`^${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
        };
    }
    if (f.banda !== undefined && f.operacion) {
        const b = BANDAS[f.operacion][f.banda];
        if (b) {
            q['filters.price.max'] = b.max === null ? { $gt: b.min } : { $gt: b.min, $lte: b.max };
        }
    }
    return q;
}

async function cargarCompradores(f: FiltroDemanda = {}): Promise<BaseResultado> {
    const db = await getDb();
    const q = matchDemanda(f);
    const [total, docs] = await Promise.all([
        db.collection('searches').countDocuments(q),
        db.collection('searches').find(q, {
            projection: {
                contact: 1, filters: 1, updatedAt: 1, 'status.last': 1,
                'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'company.name': 1
            }
        }).sort({ updatedAt: -1 }).limit(LIMITE).toArray()
    ]);

    const personas: Persona[] = docs.map((s) => {
        const dirs: Document[] = Array.isArray(s.filters?.addresses) ? s.filters.addresses : [];
        const colonias = [...new Set(dirs.map((d) => d?.neighborhood?.name).filter(Boolean))];
        const estados = [...new Set(dirs.map((d) => normEstado(d?.state?.name)).filter((x) => x !== '—'))];
        const max = s.filters?.price?.max as number | undefined;
        return {
            id: String(s.contact._id),
            nombre: nombreDe(s.contact),
            telefono: (s.contact.phone || null) as string | null,
            email: (s.contact.email || null) as string | null,
            asesorId: s.agent?._id ? String(s.agent._id) : null,
            asesor: nombreDe(s.agent, '—'),
            inmobiliaria: (s.company?.name || null) as string | null,
            extra: {
                operacion: s.filters?.operation === 'rent' ? 'Renta' : s.filters?.operation === 'sale' ? 'Venta' : '—',
                tipos: (s.filters?.types as string[] || []).join(', ') || '—',
                estado: estados.join(', ') || '—',
                colonias: colonias.join(', ') || '—',
                presupuesto: max ? max : null,
                movida: s.updatedAt instanceof Date ? s.updatedAt.toISOString().slice(0, 10) : null
            }
        };
    });

    return {
        id: 'compradores', label: 'Compradores', total, personas,
        columnas: [
            { key: 'operacion', label: 'Busca' },
            { key: 'tipos', label: 'Tipo' },
            { key: 'presupuesto', label: 'Presupuesto' },
            { key: 'estado', label: 'Estado' },
            { key: 'colonias', label: 'Colonias de interés' },
            { key: 'movida', label: 'Últ. movimiento' }
        ],
        notas: [
            'Sale de `searches` (lo que la persona declaró que busca), no de leads: el presupuesto y las colonias sólo viven ahí.',
            'Sólo búsquedas VIVAS con teléfono, movidas en los últimos 90 días. El estado sale de status.last, no de cancelledAt.',
            'Una búsqueda puede tener varias colonias (hasta 8): la persona aparece en todos sus clusters.',
            '"Edo. de México" y "Estado de México" se unifican al filtrar; si no, Edomex desaparece sin avisar.'
        ]
    };
}

/**
 * La parrilla estado × tipo × banda de presupuesto — el mismo modelo de
 * cluster del proyecto de campañas por correo (zona_tipo_precio), pero en
 * vivo y sobre demanda declarada en vez de un CSV congelado.
 *
 * Se cuentan PERSONAS distintas, no búsquedas: alguien con tres búsquedas en
 * el mismo cluster es un solo mensaje.
 */
export async function clustersDemanda(f: FiltroDemanda = {}): Promise<{ clusters: Cluster[]; personas: number; sinPresupuesto: number }> {
    const db = await getDb();
    const op = f.operacion || 'sale';
    const bandas = BANDAS[op];
    const q = matchDemanda({ ...f, operacion: op, banda: undefined });

    // $switch traduce price.max a índice de banda dentro de Mongo: traerse
    // 60k documentos al server sólo para clasificarlos sería absurdo.
    const ramas = bandas.map((b, i) => ({
        case: b.max === null
            ? { $gt: ['$filters.price.max', b.min] }
            : { $and: [{ $gt: ['$filters.price.max', b.min] }, { $lte: ['$filters.price.max', b.max] }] },
        then: i
    }));

    const agg = db.collection('searches').aggregate([
        { $match: { ...q, 'filters.price.max': { $gt: 0 } } },
        { $unwind: '$filters.addresses' },
        { $unwind: '$filters.types' },
        {
            $project: {
                contacto: '$contact._id',
                tipo: '$filters.types',
                estado: '$filters.addresses.state.name',
                colonia: '$filters.addresses.neighborhood.name',
                banda: { $switch: { branches: ramas, default: -1 } }
            }
        },
        { $match: { banda: { $gte: 0 }, estado: { $nin: [null, ''] } } },
        {
            $group: {
                _id: { e: '$estado', t: '$tipo', b: '$banda' },
                personas: { $addToSet: '$contacto' },
                colonias: { $push: '$colonia' }
            }
        },
        { $project: { personas: { $size: '$personas' }, colonias: 1 } },
        { $sort: { personas: -1 } },
        { $limit: 400 }
    ]);

    // Las grafías del mismo estado se colapsan DESPUÉS de agrupar: si no,
    // "Edo. de México" y "Estado de México" salen como dos clusters distintos.
    const fusion = new Map<string, Cluster & { _col: Map<string, number> }>();
    for await (const r of agg) {
        const estado = normEstado(r._id.e);
        const k = `${estado}|${r._id.t}|${r._id.b}`;
        let c = fusion.get(k);
        if (!c) {
            c = {
                estado, tipo: r._id.t as string, bandaIdx: r._id.b as number,
                banda: bandas[r._id.b as number]?.label ?? '—',
                personas: 0, colonias: [], _col: new Map()
            };
            fusion.set(k, c);
        }
        c.personas += r.personas as number;
        for (const n of (r.colonias as (string | null)[])) {
            if (n) c._col.set(n, (c._col.get(n) || 0) + 1);
        }
    }

    const clusters = [...fusion.values()]
        .map(({ _col, ...c }) => ({
            ...c,
            colonias: [..._col.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
                .map(([name, n]) => ({ name, n }))
        }))
        .sort((a, b) => b.personas - a.personas);

    const [personas, sinPresupuesto] = await Promise.all([
        db.collection('searches').countDocuments(q),
        db.collection('searches').countDocuments({ ...q, 'filters.price.max': { $not: { $gt: 0 } } })
    ]);

    return { clusters, personas, sinPresupuesto };
}

/** Opciones reales para los selectores (no listas inventadas). */
export async function opcionesDemanda(operacion?: 'sale' | 'rent'): Promise<{ estados: string[]; tipos: string[]; colonias: string[] }> {
    const db = await getDb();
    const q = matchDemanda({ operacion });
    const uno = async (path: string, limit: number): Promise<string[]> => {
        const agg = db.collection('searches').aggregate([
            { $match: q }, { $unwind: '$filters.addresses' },
            { $match: { [path]: { $nin: [null, ''] } } },
            { $group: { _id: `$${path}`, n: { $sum: 1 } } },
            { $sort: { n: -1 } }, { $limit: limit }
        ]);
        const out: string[] = [];
        for await (const r of agg) out.push(String(r._id));
        return out;
    };
    const [estadosRaw, colonias] = await Promise.all([
        uno('filters.addresses.state.name', 40),
        uno('filters.addresses.neighborhood.name', 120)
    ]);
    const tiposAgg = db.collection('searches').aggregate([
        { $match: q }, { $unwind: '$filters.types' },
        { $group: { _id: '$filters.types', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }
    ]);
    const tipos: string[] = [];
    for await (const r of tiposAgg) tipos.push(String(r._id));
    return { estados: [...new Set(estadosRaw.map(normEstado))], tipos, colonias };
}

/**
 * Los dados de baja. Base propia y no mezclados con los activos: no reciben
 * nada del programa. Valen como audiencia aparte — se fueron de la red pero
 * muchos siguen operando, así que para temas abiertos (crédito, protecciones)
 * son alcanzables como colegas externos, no como asesores nuestros.
 */
async function cargarBrokersInactivos(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { status: 'inactive' };
    const [total, docs] = await Promise.all([
        db.collection('agents').countDocuments(q),
        db.collection('agents').find(q, {
            projection: {
                firstName: 1, lastName: 1, email: 1, phone: 1, type: 1,
                'company.name': 1, 'personal.phone': 1, 'personal.email': 1, deletedAt: 1, lastLogin: 1
            }
        }).sort({ lastLogin: -1 }).limit(LIMITE).toArray()
    ]);
    return {
        id: 'brokers-inactivos', label: 'Brokers inactivos', total,
        personas: docs.map((a) => ({
            id: String(a._id),
            nombre: nombreDe(a),
            // El correo de Pulppo se apaga cuando se van: el personal es el que sirve.
            telefono: (a.personal?.phone || a.phone || null) as string | null,
            email: (a.personal?.email || a.email || null) as string | null,
            asesorId: null, asesor: null,
            inmobiliaria: (a.company?.name || null) as string | null,
            extra: {
                rol: a.type === 'master' ? 'Master' : a.type === 'associate' ? 'Asesor' : String(a.type ?? '—'),
                baja: a.deletedAt instanceof Date ? a.deletedAt.toISOString().slice(0, 10) : null,
                ultimoLogin: a.lastLogin instanceof Date ? a.lastLogin.toISOString().slice(0, 10) : null
            }
        })),
        columnas: [
            { key: 'rol', label: 'Era' },
            { key: 'baja', label: 'Baja' },
            { key: 'ultimoLogin', label: 'Último acceso' }
        ],
        notas: [
            'No entran en ninguna campaña del programa: si se les habla es como colegas externos.',
            'Se prefiere el contacto personal sobre el de Pulppo — la cuenta @pulppo.com se apaga al darlos de baja.',
            'Incluye el tipo viejo "broker" (714), que ya no se usa para asesores activos.'
        ]
    };
}

async function cargarPulppers(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { status: 'active', type: 'staff' };
    const [total, docs] = await Promise.all([
        db.collection('agents').countDocuments(q),
        db.collection('agents').find(q, { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, subType: 1 } })
            .limit(LIMITE).toArray()
    ]);
    return {
        id: 'pulppers', label: 'Pulppers', total,
        personas: docs.map((a) => ({
            id: String(a._id), nombre: nombreDe(a),
            telefono: (a.phone || null) as string | null,
            email: (a.email || null) as string | null,
            asesorId: null, asesor: null, inmobiliaria: 'Pulppo',
            extra: { area: (a.subType as string) || '—' }
        })),
        columnas: [{ key: 'area', label: 'Área' }],
        notas: []
    };
}

export async function cargarBase(id: BaseId, f: FiltroDemanda = {}): Promise<BaseResultado> {
    switch (id) {
        case 'brokers': return cargarBrokers();
        case 'brokers-inactivos': return cargarBrokersInactivos();
        case 'inmobiliarias': return cargarInmobiliarias();
        case 'propietarios-renta': return cargarPropietariosRenta();
        case 'propietarios': return cargarPorTag('propietarios', 'Propietarios', 'propietario',
            ['Tag sin normalizar: se busca /propietario/i para no perder la mitad de la base.']);
        case 'inquilinos': return cargarPorTag('inquilinos', 'Inquilinos', 'inquilino',
            ['Tag sin normalizar: se busca /inquilino/i.']);
        case 'brokers-externos': return cargarPorTag('brokers-externos', 'Brokers externos', 'broker',
            ['Tag sin normalizar: se busca /broker/i.',
                'Incluye colegas de la red: cruzar contra `agents` antes de mandar algo de captación.']);
        case 'compradores': return cargarCompradores(f);
        case 'pulppers': return cargarPulppers();
    }
}

/** Conteos de todas las bases para el menú. Barato: sólo countDocuments. */
export async function contarBases(): Promise<Record<BaseId, number>> {
    const db = await getDb();
    const tag = (t: string) => ({ tags: { $regex: t, $options: 'i' } });
    const [brokers, inactivos, inmobiliarias, propRenta, propietarios, inquilinos, externos, compradores, pulppers] =
        await Promise.all([
            db.collection('agents').countDocuments({ status: 'active', type: { $in: ['associate', 'master'] } }),
            db.collection('agents').countDocuments({ status: 'inactive' }),
            db.collection('companies').countDocuments({ external: false, status: 'active' }),
            db.collection('properties').countDocuments({ 'listing.operation': 'rent', 'status.last': 'published', 'contact._id': { $ne: null } }),
            db.collection('contacts').countDocuments(tag('propietario')),
            db.collection('contacts').countDocuments(tag('inquilino')),
            db.collection('contacts').countDocuments(tag('broker')),
            db.collection('searches').countDocuments(DEMANDA_BASE()),
            db.collection('agents').countDocuments({ status: 'active', type: 'staff' })
        ]);
    return {
        brokers, 'brokers-inactivos': inactivos, inmobiliarias, 'propietarios-renta': propRenta,
        propietarios, inquilinos, 'brokers-externos': externos, compradores, pulppers
    };
}

/**
 * La audiencia del MVP: rentas publicadas en los últimos `dias` días, con
 * propietario contactable y sin ser otra agencia. Deduplicada por contacto.
 */
export async function audienciaRentaNueva(dias = 7): Promise<Persona[]> {
    const db = await getDb();
    const docs = await db.collection('properties').find({
        'listing.operation': 'rent',
        'status.last': 'published',
        publishedAt: { $gte: new Date(Date.now() - dias * 864e5) },
        'contact._id': { $ne: null },
        'contact.phone': { $nin: [null, ''] },
        'contact.company._id': null // fuera los "propietarios" que son agencias
    }, {
        projection: {
            internalId: 1, publishedAt: 1, 'listing.title': 1, 'listing.value': 1, contact: 1,
            'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'company.name': 1
        }
    }).sort({ publishedAt: -1 }).toArray();

    const porContacto = new Map<string, Persona>();
    for (const p of docs) {
        const id = String(p.contact._id);
        const ya = porContacto.get(id);
        if (ya) { // mismo dueño, otra propiedad: se suma, no se duplica
            ya.extra.propiedades = Number(ya.extra.propiedades) + 1;
            continue;
        }
        porContacto.set(id, {
            id,
            nombre: nombreDe(p.contact),
            telefono: (p.contact.phone || null) as string | null,
            email: (p.contact.email || null) as string | null,
            asesorId: p.agent?._id ? String(p.agent._id) : null,
            asesor: nombreDe(p.agent, '—'),
            inmobiliaria: (p.company?.name || null) as string | null,
            extra: {
                codigo: (p.internalId as string) || '—',
                propiedad: (p.listing?.title as string) || '—',
                renta: (p.listing?.value as number) ?? null,
                publicada: p.publishedAt instanceof Date ? p.publishedAt.toISOString().slice(0, 10) : null,
                propiedades: 1
            }
        });
    }
    return [...porContacto.values()];
}

/** Los asesores detrás de una audiencia — a quienes hay que pedirles permiso. */
export async function asesoresDe(personas: Persona[]): Promise<Map<string, { nombre: string; email: string | null; telefono: string | null; inmobiliaria: string | null }>> {
    const ids = [...new Set(personas.map((p) => p.asesorId).filter(Boolean))] as string[];
    if (!ids.length) return new Map();
    const db = await getDb();
    const docs = await db.collection('agents').find(
        { _id: { $in: ids.map((i) => new ObjectId(i)) } },
        { projection: { firstName: 1, lastName: 1, email: 1, phone: 1, 'company.name': 1 } }
    ).toArray();
    return new Map(docs.map((a) => [String(a._id), {
        nombre: nombreDe(a),
        email: (a.email || null) as string | null,
        telefono: (a.phone || null) as string | null,
        inmobiliaria: (a.company?.name || null) as string | null
    }]));
}
