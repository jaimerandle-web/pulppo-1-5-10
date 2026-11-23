// /portales → Publicación (nov-2026): dónde estamos publicando, cuánto, y si aprovechamos lo que pagamos.
//
// Ale: «tener el estatus actual de dónde estamos publicando y cuánto, para ver si sí estamos aprovechando todos
// los avisos» y «entender si estamos aprovechando al 100% todos nuestros espacios destacados vs. el plan que tenemos
// contratado en cada portal». Tres lecturas, todas foto de HOY:
//
//   1. Contra el PLAN CONTRATADO (lo que pagamos al portal). i24 es una BOLSA en pesos para súper destacados y
//      destacados (con sus zona demand) + el Premier; los simples van en su paquete aparte. MeLi incluye N Oro Premium.
//      Sale en vivo de la hoja «Calculadora» del Sheet de asignación (`planContratado`): bolsa, precio de lista por tipo,
//      simples contratados, Premier y Oro Premium incluidos. Lo usado = avisos EN LÍNEA en NUESTRAS cuentas de i24
//      (ANUNCIO_SIMPLE, ANUNCIOS_DEGOHOUSE, ANUNCIO_PREMIERE) × su precio. Las cuentas propias de una inmobiliaria
//      (p. ej. la numérica de NURA) no gastan nuestra bolsa y van aparte.
//   2. Contra el CUPO ASIGNADO a cada inmobiliaria en el tool de asignación (`adassignmentcompanycupos`, el registro
//      más reciente por compañía y portal). 🔴 El Premier de Diamond House (cuenta ANUNCIO_PREMIERE) cuenta como
//      súper destacado: su cupo de «super-destacado» (130) ES el Premier. Antes lo dejaba fuera y DH salía en 103/205
//      cuando en realidad tiene 233 en línea (Ale, 20-nov-2026).
//   3. Los avisos CAÍDOS (publicada en Pulppo, aviso no en línea), por motivo y por quién lo corrige. Se cuentan por
//      AVISO: una propiedad caída en 3 portales suma 3.
import { unstable_cache } from 'next/cache';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';
import { claveLead } from '../mbComun';
import { NOT, dig } from './metrics';
import { canalDeLead, cuentaI24DeLead, opcionesInmobiliarias } from './inmobiliaria';
import { CUENTA_PREMIER } from './avisosTipos';
import { MELI_PAQUETE } from './inversion';

const DIA = 86400000;
/** inmobiliaria · portal · nivel · cupo asignado · en línea · con lead 30 d */
export type PubFila = [string, string, string, number, number, number];
/** inmobiliaria · portal · motivo · quién lo corrige · avisos */
export type OffFila = [string, string, string, Quien, number];
export type Quien = 'Inmobiliaria' | 'Pulppo' | 'Por regla' | 'Portal';
/** cuenta de i24 · nivel · avisos en línea (toda la red) */
export type CuentaFila = [string, string, number];
export interface PlanContratado {
    fuente: string; ok: boolean; nota?: string;
    /** i24: bolsa en pesos para elevados + Premier, precio de lista por nivel, simples contratados */
    bolsaI24: number | null; precios: Record<string, number>; premier: number | null; simplesI24: number | null;
    /** MeLi: Oro Premium y publicaciones incluidos en el paquete (MELI_PAQUETE, no el Sheet) */
    oroPremiumMeli: number | null; publicacionesMeli: number | null;
}
export interface PublicacionView {
    generado: string; filas: PubFila[]; offline: OffFila[]; inventario: Array<[string, number]>;
    cuentasI24: CuentaFila[]; plan: PlanContratado;
}

export const NIVELES_I24 = ['Súper destacado ZD', 'Súper destacado', 'Destacado ZD', 'Destacado', 'Simple', 'Gratis'];
/** nuestras cuentas de i24 (gastan la bolsa); cualquier otra es de la inmobiliaria */
export const CUENTAS_PULPPO = ['ANUNCIO_SIMPLE', 'ANUNCIOS_DEGOHOUSE', CUENTA_PREMIER];
const CUPO_I24: Record<string, string> = {
    'super-destacado': 'Súper destacado', 'zd-super-destacado': 'Súper destacado ZD', destacado: 'Destacado', 'zd-destacado': 'Destacado ZD', simple: 'Simple',
};
const CUPO_MELI: Record<string, string> = { 'oro-meli': 'Oro Premium', 'plata-meli': 'Oro', 'simple-meli': 'Plata' };
const NIVEL_MELI: Record<string, string> = { gold_premium: 'Oro Premium', gold: 'Oro', silver: 'Plata' };
const PORTAL_DE_CANAL: Record<string, string> = {
    i24: 'Inmuebles24', i24nura: 'Inmuebles24', i24premier: 'Inmuebles24', meli: 'MercadoLibre',
    propiedades: 'Propiedades.com', cyt: 'Casas y Terrenos', easybroker: 'EasyBroker',
};

function nivelI24(raw: unknown): string | null {
    const t = String(raw ?? '').toUpperCase();
    if (!t || t === 'NULL' || t === 'UNDEFINED' || t === 'OFFLINE') return null;
    const zd = t.includes('ZONA_DEMAND');
    if (t.startsWith('HOME')) return zd ? 'Súper destacado ZD' : 'Súper destacado';
    if (t.startsWith('DESTACADO')) return zd ? 'Destacado ZD' : 'Destacado';
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

/** Por qué está caído un aviso y quién lo arregla. Medido 20-nov-2026 sobre 8,923 publicadas: i24 668 (489 el bug
 *  de OFFLINE), MeLi 1,128 (275 sin cupo por regla), EasyBroker 748 (casi todo plan/clave/pago de SU cuenta). */
function motivo(portal: string, x: Document): [string, Quien] {
    const err = (x.lastError ?? x.error) as Document | string | null | undefined;
    const code = typeof err === 'object' && err ? String(err.code ?? '') : '';
    const msg = (typeof err === 'object' && err ? String(err.message ?? JSON.stringify(err)) : String(err ?? '')).toLowerCase();
    if (portal === 'Inmuebles24') {
        if (code === 'EXCLUDED_BY_RULE') return ['i24 lo excluyó (duplicado de otra publicación)', 'Inmobiliaria'];
        if (code === 'NO_PORTAL_STOCK') return ['Sin lugares disponibles en la cuenta de i24', 'Pulppo'];
        if (!code && !msg) return ['OFFLINE sin error: falla de la API de i24 (se cobra como Simple)', 'Portal'];
        return ['Otro error de i24', 'Pulppo'];
    }
    if (portal === 'MercadoLibre') {
        if (code === 'NO_CUPO_CONFIG') return ['Sin cupo de MeLi asignado a la inmobiliaria', 'Por regla'];
        if (['PRICE_BELOW_CATEGORY_MINIMUM', 'NO_LOCATION_MAPPING', 'MISSING_CITY', 'INVALID_ITEM_FIELD'].includes(code)) return ['Datos de la propiedad (precio o ubicación)', 'Inmobiliaria'];
        if (!code && !msg) return ['Fuera de línea sin error registrado', 'Pulppo'];
        return ['Otro error de MeLi', 'Pulppo'];
    }
    if (portal === 'EasyBroker') {
        if (msg.includes('límite') || msg.includes('limite')) return ['Su plan de EasyBroker está lleno', 'Inmobiliaria'];
        if (msg.includes('api key')) return ['La clave de su EasyBroker no es válida', 'Inmobiliaria'];
        if (msg.includes('paid account')) return ['Su cuenta de EasyBroker no está pagada', 'Inmobiliaria'];
        if (msg.includes('neighborhood') || msg.includes('location')) return ['Datos de ubicación', 'Inmobiliaria'];
        if (!msg) return ['Fuera de línea sin error registrado', 'Pulppo'];
        return ['Otro error de EasyBroker', 'Inmobiliaria'];
    }
    if (!code && !msg) return ['Fuera de línea sin error registrado', 'Pulppo'];
    return [`Error del portal`, 'Pulppo'];
}

// ── plan contratado: hoja «Calculadora» del Sheet de asignación (se lee sin credenciales, como inversion.ts) ──────
const SHEET_ASIGNACION = '1EzkDZnpTSjhh49S1yKDTOAQLDLtGgwg1NSxS3Vk6f6s';
const PRECIO_ROTULO: Record<string, string> = {
    'Súper Destacado ZD': 'Súper destacado ZD', 'Súper Destacado': 'Súper destacado', 'Destacado ZD': 'Destacado ZD', Destacado: 'Destacado', Simple: 'Simple',
};
function csv(texto: string): string[][] {
    const filas: string[][] = []; let fila: string[] = [], campo = '', q = false;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (q) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; continue; }
        if (c === '"') q = true; else if (c === ',') { fila.push(campo); campo = ''; } else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; } else campo += c;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
}
const pesos = (s: string | undefined) => { const n = Number(String(s ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && /\d/.test(String(s)) ? n : null; };
export async function planContratado(): Promise<PlanContratado> {
    const fuente = `docs.google.com/spreadsheets/d/${SHEET_ASIGNACION} · hoja Calculadora`;
    const vacio: PlanContratado = { fuente, ok: false, bolsaI24: null, precios: {}, premier: null, simplesI24: null, oroPremiumMeli: MELI_PAQUETE.oroPremium, publicacionesMeli: MELI_PAQUETE.publicaciones };
    try {
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ASIGNACION}/gviz/tq?tqx=out:csv&sheet=Calculadora`, { cache: 'no-store' });
        if (!r.ok) return { ...vacio, nota: `El Sheet respondió ${r.status}` };
        const F = csv(await r.text());
        // Google devuelve la PRIMERA hoja si la pestaña no existe: se exige el rótulo de la Calculadora
        if (!F.some((f) => f.some((c) => c.startsWith('Calculadora')))) return { ...vacio, nota: 'No encontré la hoja «Calculadora»' };
        const celda = (rotulo: string, col: number, desp = 1) => { const f = F.find((x) => (x[col] ?? '').trim() === rotulo); return f ? f[col + desp] : undefined; };
        const ultimoNum = (rotulo: string, col: number) => { const f = F.find((x) => (x[col] ?? '').trim() === rotulo); return f ? [...f.slice(col + 1)].reverse().map(pesos).find((x) => x != null) ?? null : null; };
        const precios: Record<string, number> = {};
        for (const f of F) { const k = PRECIO_ROTULO[(f[1] ?? '').trim()]; const v = pesos(f[2]); if (k && v != null && v < 2000) precios[k] = v; }
        // sección 8: «Hoy contratado» de los simples (columna 16 de la fila «Simple» de la tabla de la derecha)
        const ini8 = F.findIndex((f) => (f[11] ?? '').startsWith('8 ·'));
        const fSimple = ini8 >= 0 ? F.slice(ini8).find((f) => (f[11] ?? '').trim() === 'Simple') : undefined;
        return {
            fuente, ok: true,
            bolsaI24: pesos(celda('Bolsa disponible hoy', 11)),
            premier: ultimoNum('Premier / plan propio', 11),
            simplesI24: fSimple ? pesos(fSimple[16]) : null,
            // El paquete nuevo de MeLi (23-nov-2026) manda sobre la Calculadora, que sigue con los 1,600 del deal viejo
            oroPremiumMeli: MELI_PAQUETE.oroPremium, publicacionesMeli: MELI_PAQUETE.publicaciones,
            precios,
        };
    } catch (e) {
        return { ...vacio, nota: e instanceof Error ? e.message : String(e) };
    }
}

async function calcular(): Promise<PublicacionView> {
    const db = await getDb();
    const nombreDe = new Map<string, string>();
    for (const o of await opcionesInmobiliarias()) for (const id of o.ids) nombreDe.set(id, o.nombre);
    const plan = planContratado();
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
    const conLead = new Set<string>();
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
    const cuentas = new Map<string, CuentaFila>();
    const comps = [...nombreDe.keys()].map((s) => new ObjectId(s));
    for await (const p of db.collection('properties').find({ 'status.last': 'published', 'company._id': { $in: comps } }, {
        projection: { 'company._id': 1, 'portals.inmuebles24.type': 1, 'portals.inmuebles24.company': 1, 'portals.inmuebles24.status': 1, 'portals.inmuebles24.id': 1,
            'portals.inmuebles24.lastError': 1,
            'portals.mercadolibre.status': 1, 'portals.mercadolibre.type': 1, 'portals.mercadolibre.id': 1, 'portals.mercadolibre.lastError': 1, 'portals.mercadolibre.error': 1,
            'portals.propiedadesDotCom.status': 1, 'portals.propiedadesDotCom.id': 1, 'portals.propiedadesDotCom.lastError': 1, 'portals.propiedadesDotCom.error': 1,
            'portals.casas-y-terrenos.status': 1, 'portals.casas-y-terrenos.id': 1, 'portals.casas-y-terrenos.lastError': 1, 'portals.casas-y-terrenos.error': 1,
            'portals.companyEasybroker.status': 1, 'portals.companyEasybroker.id': 1, 'portals.companyEasybroker.lastError': 1, 'portals.companyEasybroker.error': 1 },
    })) {
        const inmo = nombreDe.get(String(dig(p, 'company', '_id')))!;
        inv.set(inmo, (inv.get(inmo) ?? 0) + 1);
        const pid = String(p._id);
        const caido = (portal: string, x: Document) => {
            const [m, q] = motivo(portal, x);
            const k = `${inmo}|${portal}|${m}`;
            (off.get(k) ?? off.set(k, [inmo, portal, m, q, 0]).get(k)!)[4] += 1;
        };
        const marca = (portal: string, nivel: string) => {
            const f = fila(inmo, portal, nivel);
            f[4] += 1;
            if (conLead.has(`${pid}|${portal}`)) f[5] += 1;
        };
        const i24 = dig(p, 'portals', 'inmuebles24') as Document | undefined;
        const n24 = i24 && String(i24.status ?? '').toUpperCase() === 'ONLINE' ? nivelI24(i24.type) : null;
        if (n24) {
            marca('Inmuebles24', n24);
            const cuenta = String(i24!.company ?? '—');
            const k = `${cuenta}|${n24}`;
            (cuentas.get(k) ?? cuentas.set(k, [cuenta, n24, 0]).get(k)!)[2] += 1;
        } else if (tieneAviso(i24)) caido('Inmuebles24', i24!);
        const ml = dig(p, 'portals', 'mercadolibre') as Document | undefined;
        if (enLinea(ml)) marca('MercadoLibre', NIVEL_MELI[String(ml!.type ?? '').toLowerCase()] ?? 'Otro'); else if (tieneAviso(ml)) caido('MercadoLibre', ml!);
        for (const [portal, k] of [['Propiedades.com', 'propiedadesDotCom'], ['Casas y Terrenos', 'casas-y-terrenos'], ['EasyBroker', 'companyEasybroker']] as const) {
            const x = dig(p, 'portals', k) as Document | undefined;
            if (enLinea(x)) marca(portal, 'En línea'); else if (tieneAviso(x)) caido(portal, x!);
        }
    }
    // MeLi caído sin error en una inmobiliaria con cupo 0 de MeLi (Red, bajas) no es falla: salió por regla.
    // 20-nov-2026: 362 de los 583 «sin error» eran de 5a Avenida, Finver, Dream House, Enlace Fehu…
    const cupoMeli = new Map<string, number>();
    for (const f of acc.values()) if (f[1] === 'MercadoLibre') cupoMeli.set(f[0], (cupoMeli.get(f[0]) ?? 0) + f[3]);
    const offline: OffFila[] = [];
    for (const o of off.values()) {
        if (o[1] === 'MercadoLibre' && o[3] === 'Pulppo' && o[2].startsWith('Fuera de línea') && !cupoMeli.get(o[0])) {
            const y = offline.find((x) => x[0] === o[0] && x[1] === o[1] && x[2] === 'Sin cupo de MeLi asignado a la inmobiliaria');
            if (y) y[4] += o[4]; else offline.push([o[0], o[1], 'Sin cupo de MeLi asignado a la inmobiliaria', 'Por regla', o[4]]);
        } else {
            const y = offline.find((x) => x[0] === o[0] && x[1] === o[1] && x[2] === o[2]);
            if (y) y[4] += o[4]; else offline.push([...o]);
        }
    }
    return {
        generado: new Date().toISOString(), filas: [...acc.values()], offline, inventario: [...inv.entries()],
        cuentasI24: [...cuentas.values()], plan: await plan,
    };
}

/** La foto de hoy (caché 1 h). */
export async function publicacionView(fresco = false): Promise<PublicacionView> {
    if (fresco) return calcular();
    return unstable_cache(calcular, ['portales-publicacion-v3'], { revalidate: 3600, tags: ['portales-publicacion'] })();
}
