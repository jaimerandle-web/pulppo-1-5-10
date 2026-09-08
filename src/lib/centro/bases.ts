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
import type { BaseId, BaseResultado, Persona } from './tipos';

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

/** Rentas publicadas por asesor — el "# de rentas captadas" del tablero. */
async function rentasPorAsesor(): Promise<Map<string, number>> {
    const db = await getDb();
    const agg = db.collection('properties').aggregate([
        { $match: { 'listing.operation': 'rent', 'status.last': 'published' } },
        { $group: { _id: '$agent._id', n: { $sum: 1 } } }
    ]);
    const out = new Map<string, number>();
    for await (const r of agg) if (r._id) out.set(String(r._id), r.n as number);
    return out;
}

async function cargarBrokers(): Promise<BaseResultado> {
    const db = await getDb();
    const q = { status: 'active', type: { $in: ['associate', 'master'] } };
    const [total, docs, rentas] = await Promise.all([
        db.collection('agents').countDocuments(q),
        db.collection('agents').find(q, {
            projection: {
                firstName: 1, lastName: 1, email: 1, phone: 1, type: 1, whatsapp: 1,
                'company.name': 1, 'company._id': 1, 'personal.phone': 1
            }
        }).limit(LIMITE).toArray(),
        rentasPorAsesor()
    ]);

    const personas: Persona[] = docs.map((a) => ({
        id: String(a._id),
        nombre: nombreDe(a),
        telefono: (a.phone || a.personal?.phone || null) as string | null,
        email: (a.email || null) as string | null,
        asesorId: String(a._id), // el broker se autoriza a sí mismo
        asesor: nombreDe(a),
        inmobiliaria: (a.company?.name || null) as string | null,
        extra: {
            rentas: rentas.get(String(a._id)) ?? 0,
            rol: a.type === 'master' ? 'Master' : 'Asesor',
            // Sin WhatsApp vinculado el asesor contesta por fuera: la vía
            // "desde su WhatsApp" no está disponible para él.
            whatsapp: a.whatsapp ? 'Sí' : 'No'
        }
    }));
    personas.sort((a, b) => Number(b.extra.rentas) - Number(a.extra.rentas));

    return {
        id: 'brokers', label: 'Brokers', total, personas,
        columnas: [
            { key: 'rentas', label: 'Rentas vivas' },
            { key: 'rol', label: 'Rol' },
            { key: 'whatsapp', label: 'WhatsApp' }
        ],
        notas: ['El asesor sin WhatsApp vinculado no puede usar la vía "desde su WhatsApp".']
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

async function cargarCompradores(): Promise<BaseResultado> {
    const db = await getDb();
    const desde = new Date(Date.now() - 90 * 864e5);
    const q = { createdAt: { $gte: desde }, 'contact._id': { $ne: null } };
    const [total, docs] = await Promise.all([
        db.collection('leads').countDocuments(q),
        db.collection('leads').find(q, {
            projection: {
                createdAt: 1, source: 1, contact: 1, 'property.internalId': 1,
                'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'company.name': 1
            }
        }).sort({ createdAt: -1 }).limit(LIMITE).toArray()
    ]);
    return {
        id: 'compradores', label: 'Compradores', total,
        personas: docs.map((l) => ({
            id: String(l.contact?._id),
            nombre: nombreDe(l.contact),
            telefono: (l.contact?.phone || null) as string | null,
            email: (l.contact?.email || null) as string | null,
            asesorId: l.agent?._id ? String(l.agent._id) : null,
            asesor: nombreDe(l.agent, '—'),
            inmobiliaria: (l.company?.name || null) as string | null,
            extra: {
                fuente: (l.source as string) || '—',
                dia: l.createdAt instanceof Date ? l.createdAt.toISOString().slice(0, 10) : null
            }
        })),
        columnas: [{ key: 'fuente', label: 'Fuente' }, { key: 'dia', label: 'Lead' }],
        notas: ['Un mismo comprador deja varios leads: se deduplica por contacto al programar.']
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

export async function cargarBase(id: BaseId): Promise<BaseResultado> {
    switch (id) {
        case 'brokers': return cargarBrokers();
        case 'inmobiliarias': return cargarInmobiliarias();
        case 'propietarios-renta': return cargarPropietariosRenta();
        case 'propietarios': return cargarPorTag('propietarios', 'Propietarios', 'propietario',
            ['Tag sin normalizar: se busca /propietario/i para no perder la mitad de la base.']);
        case 'inquilinos': return cargarPorTag('inquilinos', 'Inquilinos', 'inquilino',
            ['Tag sin normalizar: se busca /inquilino/i.']);
        case 'brokers-externos': return cargarPorTag('brokers-externos', 'Brokers externos', 'broker',
            ['Tag sin normalizar: se busca /broker/i.',
                'Incluye colegas de la red: cruzar contra `agents` antes de mandar algo de captación.']);
        case 'compradores': return cargarCompradores();
        case 'pulppers': return cargarPulppers();
    }
}

/** Conteos de todas las bases para el menú. Barato: sólo countDocuments. */
export async function contarBases(): Promise<Record<BaseId, number>> {
    const db = await getDb();
    const tag = (t: string) => ({ tags: { $regex: t, $options: 'i' } });
    const [brokers, inmobiliarias, propRenta, propietarios, inquilinos, externos, compradores, pulppers] =
        await Promise.all([
            db.collection('agents').countDocuments({ status: 'active', type: { $in: ['associate', 'master'] } }),
            db.collection('companies').countDocuments({ external: false, status: 'active' }),
            db.collection('properties').countDocuments({ 'listing.operation': 'rent', 'status.last': 'published', 'contact._id': { $ne: null } }),
            db.collection('contacts').countDocuments(tag('propietario')),
            db.collection('contacts').countDocuments(tag('inquilino')),
            db.collection('contacts').countDocuments(tag('broker')),
            db.collection('leads').countDocuments({ createdAt: { $gte: new Date(Date.now() - 90 * 864e5) }, 'contact._id': { $ne: null } }),
            db.collection('agents').countDocuments({ status: 'active', type: 'staff' })
        ]);
    return {
        brokers, inmobiliarias, 'propietarios-renta': propRenta, propietarios,
        inquilinos, 'brokers-externos': externos, compradores, pulppers
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
