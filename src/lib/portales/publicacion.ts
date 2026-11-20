// /portales → Publicación (nov-2026): dónde estamos publicando, cuánto, y si aprovechamos lo que pagamos.
//
// Ale: «tener el estatus actual de dónde estamos publicando y cuánto, para ver si sí estamos aprovechando todos
// los avisos o no». Por inmobiliaria × portal × nivel, la foto de HOY:
//   · cupo     = lo asignado en el tool de asignación (`adassignmentcompanycupos`, el registro más reciente por
//                compañía y portal). i24: súper destacado / destacado (con sus zona demand) / simple. MeLi:
//                oro-meli = Oro Premium (gold_premium) · plata-meli = Oro (gold) · simple-meli = Plata (silver).
//   · publicados = propiedades publicadas en Pulppo con el aviso EN LÍNEA en ese nivel.
//   · con lead = de esos avisos, cuántos recibieron al menos un lead ÚNICO de ese portal en los últimos 30 días.
//   · fuera de línea = la propiedad está publicada en Pulppo pero el aviso no está en línea en el portal.
// 🔴 i24 OFFLINE es un bug conocido (la API key de la cuenta falla) y se cobra como Simple: aquí cuenta como
// «fuera de línea», no como lugar libre.
import { unstable_cache } from 'next/cache';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { claveLead } from '../mbComun';
import { NOT, dig } from './metrics';
import { canalDeLead, cuentaI24DeLead, opcionesInmobiliarias } from './inmobiliaria';
import { CUENTA_PREMIER } from './avisosTipos';

const DIA = 86400000;
/** inmobiliaria · portal · nivel · cupo · publicados · con lead 30 d */
export type PubFila = [string, string, string, number, number, number];
/** inmobiliaria · portal · avisos fuera de línea (publicada en Pulppo, aviso caído) */
export type OffFila = [string, string, number];
export interface PublicacionView { generado: string; filas: PubFila[]; offline: OffFila[]; inventario: Array<[string, number]> }

export const PORTALES_PUB = ['Inmuebles24', 'MercadoLibre', 'Propiedades.com', 'Casas y Terrenos', 'EasyBroker'] as const;
export const NIVELES_PUB: Record<string, string[]> = {
    Inmuebles24: ['Súper destacado · Premier', 'Súper destacado', 'Destacado', 'Simple', 'Gratis'],
    MercadoLibre: ['Oro Premium', 'Oro', 'Plata', 'Otro'],
    'Propiedades.com': ['En línea'], 'Casas y Terrenos': ['En línea'], EasyBroker: ['En línea'],
};
const CUPO_I24: Record<string, string> = {
    'super-destacado': 'Súper destacado', 'zd-super-destacado': 'Súper destacado', destacado: 'Destacado', 'zd-destacado': 'Destacado', simple: 'Simple',
};
const CUPO_MELI: Record<string, string> = { 'oro-meli': 'Oro Premium', 'plata-meli': 'Oro', 'simple-meli': 'Plata' };
const NIVEL_MELI: Record<string, string> = { gold_premium: 'Oro Premium', gold: 'Oro', silver: 'Plata' };
/** canal del lead → portal de esta vista */
const PORTAL_DE_CANAL: Record<string, string> = {
    i24: 'Inmuebles24', i24nura: 'Inmuebles24', i24premier: 'Inmuebles24', meli: 'MercadoLibre',
    propiedades: 'Propiedades.com', cyt: 'Casas y Terrenos', easybroker: 'EasyBroker',
};

function nivelI24(raw: unknown, cuenta: unknown): string | null {
    const t = String(raw ?? '').toUpperCase();
    if (!t || t === 'NULL' || t === 'UNDEFINED' || t === 'OFFLINE') return null;
    if (String(cuenta ?? '').toUpperCase() === CUENTA_PREMIER) return 'Súper destacado · Premier';
    if (t.startsWith('HOME')) return 'Súper destacado';
    if (t.startsWith('DESTACADO')) return 'Destacado';
    if (t.startsWith('GRATIS')) return 'Gratis';
    return 'Simple';
}
const enLinea = (x: unknown) => {
    if (!x || typeof x !== 'object') return false;
    const d = x as Document;
    const st = String(d.status ?? '').toUpperCase();
    return (st === 'ONLINE' || st === 'PUBLISHED') && String(d.type ?? '').toUpperCase() !== 'OFFLINE';
};
const tieneAviso = (x: unknown) => !!x && typeof x === 'object' && !!((x as Document).id || (x as Document).code || (x as Document).status);

async function calcular(): Promise<PublicacionView> {
    const db = await getDb();
    const nombreDe = new Map<string, string>();
    for (const o of await opcionesInmobiliarias()) for (const id of o.ids) nombreDe.set(id, o.nombre);
    const acc = new Map<string, PubFila>();
    const fila = (inmo: string, portal: string, nivel: string) => {
        const k = `${inmo}|${portal}|${nivel}`;
        return acc.get(k) ?? acc.set(k, [inmo, portal, nivel, 0, 0, 0]).get(k)!;
    };

    // 1) cupos asignados (el registro más reciente por compañía y portal)
    const ultimo = new Map<string, Document>();
    for await (const c of db.collection('adassignmentcompanycupos').find({}, { projection: { company: 1, portal: 1, tiers: 1, updatedAt: 1, createdAt: 1 } })) {
        const k = `${String(c.company)}|${String(c.portal)}`;
        const t = (d: Document) => new Date((d.updatedAt ?? d.createdAt ?? 0) as Date).getTime();
        const prev = ultimo.get(k);
        if (!prev || t(c) > t(prev)) ultimo.set(k, c);
    }
    for (const c of ultimo.values()) {
        const inmo = nombreDe.get(String(c.company));
        if (!inmo) continue;
        const portal = c.portal === 'inmuebles24' ? 'Inmuebles24' : c.portal === 'mercadolibre' ? 'MercadoLibre' : null;
        if (!portal) continue;
        const mapa = portal === 'Inmuebles24' ? CUPO_I24 : CUPO_MELI;
        for (const [tier, n] of Object.entries((c.tiers as Record<string, number>) ?? {})) {
            const nivel = mapa[tier];
            if (nivel && Number(n) > 0) fila(inmo, portal, nivel)[3] += Number(n);
        }
    }

    // 2) leads únicos de los últimos 30 días por propiedad y portal
    const D30 = new Date(Date.now() - 30 * DIA);
    const conLead = new Set<string>();   // `${pid}|${portal}`
    const vistos = new Set<string>();
    for await (const l of db.collection('leads').find({ createdAt: { $gte: D30 }, ...NOT },
        { projection: { source: 1, 'company.name': 1, 'contact._id': 1, 'property._id': 1, 'propertyPublishPortals.portals.inmuebles24.company': 1 } }).sort({ createdAt: 1 })) {
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        const portal = PORTAL_DE_CANAL[canalDeLead(l.source, dig(l, 'company', 'name'), cuentaI24DeLead(l))];
        const pid = dig(l, 'property', '_id');
        if (portal && pid) conLead.add(`${String(pid)}|${portal}`);
    }

    // 3) inventario publicado hoy y su aviso en cada portal
    const off = new Map<string, OffFila>();
    const inv = new Map<string, number>();
    const comps = [...nombreDe.keys()].map((s) => new ObjectId(s));
    for await (const p of db.collection('properties').find({ 'status.last': 'published', 'company._id': { $in: comps } }, {
        projection: { 'company._id': 1, 'listing.publishOnPortals': 1, 'portals.inmuebles24.type': 1, 'portals.inmuebles24.company': 1, 'portals.inmuebles24.status': 1, 'portals.inmuebles24.id': 1,
            'portals.mercadolibre.status': 1, 'portals.mercadolibre.type': 1, 'portals.mercadolibre.id': 1,
            'portals.propiedadesDotCom.status': 1, 'portals.propiedadesDotCom.id': 1,
            'portals.casas-y-terrenos.status': 1, 'portals.casas-y-terrenos.id': 1,
            'portals.companyEasybroker.status': 1, 'portals.companyEasybroker.id': 1 },
    })) {
        const inmo = nombreDe.get(String(dig(p, 'company', '_id')))!;
        inv.set(inmo, (inv.get(inmo) ?? 0) + 1);
        const pid = String(p._id);
        const caido = (portal: string) => { const k = `${inmo}|${portal}`; (off.get(k) ?? off.set(k, [inmo, portal, 0]).get(k)!)[2] += 1; };
        const marca = (portal: string, nivel: string) => {
            const f = fila(inmo, portal, nivel);
            f[4] += 1;
            if (conLead.has(`${pid}|${portal}`)) f[5] += 1;
        };
        const i24 = dig(p, 'portals', 'inmuebles24') as Document | undefined;
        const n24 = i24 ? nivelI24(i24.type, i24.company) : null;
        if (n24) marca('Inmuebles24', n24); else if (tieneAviso(i24)) caido('Inmuebles24');
        const ml = dig(p, 'portals', 'mercadolibre') as Document | undefined;
        if (enLinea(ml)) marca('MercadoLibre', NIVEL_MELI[String(ml!.type ?? '').toLowerCase()] ?? 'Otro'); else if (tieneAviso(ml)) caido('MercadoLibre');
        for (const [portal, k] of [['Propiedades.com', 'propiedadesDotCom'], ['Casas y Terrenos', 'casas-y-terrenos'], ['EasyBroker', 'companyEasybroker']] as const) {
            const x = dig(p, 'portals', k);
            if (enLinea(x)) marca(portal, 'En línea'); else if (tieneAviso(x)) caido(portal);
        }
    }
    return { generado: new Date().toISOString(), filas: [...acc.values()], offline: [...off.values()], inventario: [...inv.entries()] };
}

/** La foto de hoy (caché 1 h). */
export async function publicacionView(fresco = false): Promise<PublicacionView> {
    if (fresco) return calcular();
    return unstable_cache(calcular, ['portales-publicacion-v1'], { revalidate: 3600, tags: ['portales-publicacion'] })();
}
