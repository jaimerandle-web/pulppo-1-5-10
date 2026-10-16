// Marketing de una inmobiliaria en /mb → Marketing (oct-2026). Hoy SÓLO Diamond House y SÓLO para el
// equipo interno de Pulppo (ver MARKETING_VISIBLE_PARA en marketingAcceso.ts y la barrera de /api/mb-marketing).
//
// Responde «¿cómo está asignada la exposición en portales y qué está rindiendo?», en vivo y contra la
// semana anterior (lunes a domingo, hora México):
//   1. Asignación de hoy: nivel del aviso en Inmuebles24 (`portals.inmuebles24.type`) y MeLi, venta/renta,
//      fijados a mano. 🔴 NO se muestran las cuentas de i24 (ANUNCIO_SIMPLE / ANUNCIOS_DEGOHOUSE): Ale no
//      quiere que la inmobiliaria vea en qué cuenta está cada aviso. Tampoco «zona forzada»: es la misma
//      marca que zona demand (`zonaForced` = los tipos *_ZONA_DEMAND).
//   2. Cambios de la semana: el tipo vigente al inicio y al final de cada semana, desde el historial
//      casi diario del aviso (`history[]`, con `trigger`: daily / reorder / manual / force…).
//   3. Desempeño por nivel y por aviso: VISTAS → leads ÚNICOS (contacto + propiedad) → visitas por fecha
//      de la visita (confirmadas + pendientes; reglas de mbComun.ts).
//      Vistas = colección `metrics` con type 'view' (fechadas: ~80% vienen de Inmuebles24 y el resto del
//      portal de brokers), que sí se pueden cortar por semana. `portals.inmuebles24.performance` (vistas
//      del aviso contra el promedio del mercado, ventana del portal) se usa sólo como contexto en el «por qué».
//   4–7. Estrellas, exposición vs calidad, rotación y trabadas: usan el SCORING de avisos
//      (src/lib/portales/avisos.ts → datosDe: demanda, competencia, precio vs zona), no uno nuevo.
// Se dice «zona demand» (Ale): «Súper destacado zona demand», «Destacado zona demand».
// 🔴 SIN costos ni CPL: esa lectura es interna de Pulppo y Ale no la quiere en esta pestaña.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { claveLead, VISITA_OK } from './mbComun';
import { datosDe, type Aviso } from './portales/avisos';

const MX = 6 * 3600 * 1000;
const DIA = 86400000;
/** regla vigente de rotación: con 30–45 leads en su lugar pagado, el aviso pasa a Simple y libera el lugar */
export const LEADS_ROTAR = 30;

/** nivel legible a partir del tipo crudo de i24 (HOME = súper destacado, como en avisos.ts) */
export function nivelDe(raw: unknown): string {
    const t = String(raw ?? '').toUpperCase();
    const zd = t.includes('ZONA_DEMAND');
    if (!t || t === 'NULL' || t === 'UNDEFINED') return 'Sin aviso';
    if (t === 'OFFLINE') return 'Offline';
    if (t.startsWith('HOME')) return zd ? 'Súper destacado zona demand' : 'Súper destacado';
    if (t.startsWith('DESTACADO')) return zd ? 'Destacado zona demand' : 'Destacado';
    if (t.startsWith('GRATIS')) return 'Gratis';
    return 'Simple';
}
/** el nivel sin distinguir zona demand (para la gráfica de distribución) */
export const nivelBase = (nivel: string) => nivel.replace(/ zona demand$/, '');
export const NIVELES = ['Súper destacado', 'Súper destacado zona demand', 'Destacado', 'Destacado zona demand', 'Simple', 'Gratis', 'Offline', 'Sin aviso'];
const NIVELES_BASE = ['Súper destacado', 'Destacado', 'Simple', 'Offline', 'Gratis', 'Sin aviso'];
const PREMIUM = new Set(['Súper destacado', 'Súper destacado zona demand', 'Destacado', 'Destacado zona demand']);
const rango = (n: string) => (n.startsWith('Súper') ? 3 : n.startsWith('Destacado') ? 2 : n === 'Simple' || n === 'Gratis' ? 1 : 0);
const TRIGGER: Record<string, string> = {
    daily: 'rotación automática', reorder: 'reordenamiento', manual: 'manual', force: 'forzado',
    'manual-cleanup': 'limpieza manual',
};

const dig = (d: unknown, ...ks: string[]): unknown => {
    let c: unknown = d;
    for (const k of ks) { if (c == null || typeof c !== 'object') return undefined; c = (c as Document)[k]; }
    return c;
};
const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const fechaHist = (e: Document): Date | null => {
    if (isDate(e.timestamp)) return e.timestamp;
    const d = e.date ? new Date(String(e.date)) : null;
    return d && !isNaN(d.getTime()) ? d : null;
};
const ymd = (d: Date) => new Date(d.getTime() - MX).toISOString().slice(0, 10);
/** lunes 00:00 hora México de la semana de `d`, como instante UTC */
function lunesMx(d: Date): Date {
    const m = new Date(d.getTime() - MX);
    const dow = (m.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() - dow) + MX);
}
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export interface AvisoMk {
    id: string; codigo: string; tipo: string | null; operacion: string; colonia: string | null; calle: string | null; asesor: string;
    precio: number | null; nivel: string; meli: string; diasPublicada: number | null;
    fijado: boolean; fijadoPor: string | null; fijadoEl: string | null;
    /** desde cuándo está en su nivel actual (inicio de la racha en el historial), días y leads únicos desde entonces */
    enNivelDesde: string | null; diasEnNivel: number | null; leadsEnNivel: number;
    vistasSem: number; vistasSemAnt: number; vistas30: number;
    leadsSem: number; leadsSemAnt: number; leads30: number; leads90: number;
    visitasSem: number; visitasSemAnt: number; visitas30: number; visitas90: number;
    ofertas: number;
    /** vistas del aviso en i24 contra el promedio del mercado (portals.inmuebles24.performance, ventana del portal) */
    vistasI24: number | null; vistasMercadoI24: number | null;
    // scoring de avisos.ts
    puntos: number | null; compite: boolean; tags: string[]; falta: string; precioVsZona: number | null;
    demanda: number | null; competencia: number | null;
}
export interface CambioMk { codigo: string; antes: string; despues: string; sube: boolean; motivo: string | null; fecha: string }
export interface Semana { desde: string; hasta: string; enCurso: boolean }
export interface PorNivelMk {
    nivel: string; avisos: number;
    vistasSem: number; vistasSemAnt: number; vistas30: number;
    leadsSem: number; leadsSemAnt: number; leads30: number;
    visitasSem: number; visitasSemAnt: number; visitas30: number;
}
export interface MarketingMk {
    inmobiliaria: string; generado: string;
    semana: Semana; semanaAnt: Semana;
    asignacion: {
        venta: number; renta: number;
        porNivel: Array<{ nivel: string; n: number; venta: number; renta: number }>;
        /** distribución en i24 sin distinguir zona demand: Súper destacado / Destacado / Simple / Offline */
        i24: Array<{ nivel: string; n: number }>;
        /** de los avisos EN VENTA: cuántos van en zona demand y cuántos normales */
        zonaDemandVenta: { zonaDemand: number; normal: number };
        /** proporcionalidad zona demand: inventario de venta en las 4 alcaldías ZD vs avisos premium con tier ZD.
         *  Criterio de la asignación (Ale, 31-ago-2026): la promesa ZD es proporcional a ese inventario. */
        zdProporcion: { ventaInv: number; ventaEnZd: number; premium: number; premiumZd: number; zdFueraDeZona: number };
        meli: Array<{ tipo: string; n: number }>;
        fijados: Array<{ codigo: string; nivel: string; por: string | null; el: string | null }>;
        noPromovidos: Array<{ motivo: string; n: number }>;
    };
    cambios: { semana: CambioMk[]; semanaAnt: CambioMk[] };
    porNivel: PorNivelMk[];
    avisos: AvisoMk[];
    reglas: { leadsRotar: number };
    estrellas: Array<{ codigo: string; nivel: string; operacion: string; vistas30: number; leads30: number; visitas30: number; conv: number | null; etiqueta: 'Estrella' | 'Mucho ruido, poca visita' | 'En camino' }>;
    desperdicio: Array<{ codigo: string; nivel: string; operacion: string; vistas30: number; leads30: number; motivo: string }>;
    premiumSinLeads: Array<{ codigo: string; nivel: string; operacion: string; diasEnNivel: number; desde: string | null; vistas30: number; porque: string }>;
    subir: Array<{ codigo: string; operacion: string; puntos: number; leads30: number; demanda: number | null; competencia: number | null }>;
    rotar: Array<{ codigo: string; nivel: string; operacion: string; leadsEnNivel: number; desde: string | null; motivo: string }>;
    trabadas: Array<{ codigo: string; nivel: string; operacion: string; dias: number; vistas30: number; leads90: number; visitas90: number; freno: string; porque: string; accion: string }>;
}
const FICHA = new Set(['faltan fotos', 'falta video o tour', 'calidad i24 baja']);
const PRECIO = new Set(['precio caro', 'precio fuera de su zona']);

/** nivel vigente en el instante `t` según el historial (último registro con fecha ≤ t). Se ignoran los
 *  OFFLINE: es el bug conocido de i24 (cuando falla su API key el aviso queda OFFLINE aunque siga
 *  publicado). Contarlos hacía que medio inventario «subiera de Offline a Súper destacado» cada semana. */
function nivelEn(hist: Array<{ t: Date; tipo: unknown; e: Document }>, t: Date): { nivel: string; e: Document | null } | null {
    let r: { tipo: unknown; e: Document } | null = null;
    for (const h of hist) { if (h.t > t) break; if (String(h.tipo).toUpperCase() !== 'OFFLINE') r = h; }
    return r ? { nivel: nivelDe(r.tipo), e: r.e } : null;
}

export async function marketingDe(companyId: string): Promise<MarketingMk> {
    const db = await getDb();
    const cid = new ObjectId(companyId);
    const company = await db.collection('companies').findOne({ _id: cid }, { projection: { name: 1 } });
    const nombre = String(company?.name ?? '').trim();
    const ahora = new Date();
    const L0 = lunesMx(ahora), Lm1 = new Date(L0.getTime() - 7 * DIA);
    const D30 = new Date(ahora.getTime() - 30 * DIA), D90 = new Date(ahora.getTime() - 90 * DIA);

    const props = await db.collection('properties').find({ 'company._id': cid, 'status.last': 'published' }, { projection: {
        internalId: 1, type: 1, 'listing.operation': 1, 'listing.value': 1, 'address.neighborhood.name': 1, 'address.street': 1, 'address.city.name': 1, publishedAt: 1,
        'agent.firstName': 1, 'agent.lastName': 1, 'portals.inmuebles24': 1, 'portals.mercadolibre.type': 1,
    } }).toArray();
    const ids = props.map((p) => p._id);
    const idSet = new Set(ids.map(String));

    // leads únicos (contacto + propiedad) por ventana; se guarda la fecha para contar «leads en su nivel»
    const leadsP = new Map<string, Date[]>();
    const vistos = new Set<string>();
    for await (const l of db.collection('leads').find({ 'property._id': { $in: ids }, createdAt: { $gte: new Date(ahora.getTime() - 400 * DIA) } },
        { projection: { 'contact._id': 1, 'property._id': 1, createdAt: 1 } }).sort({ createdAt: 1 })) {
        if (!isDate(l.createdAt)) continue;
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        const pid = String(dig(l, 'property', '_id'));
        (leadsP.get(pid) ?? leadsP.set(pid, []).get(pid)!).push(l.createdAt);
    }
    const visP = new Map<string, Date[]>();
    for await (const v of db.collection('visits').find({ 'steps.property._id': { $in: ids }, 'status.last': { $in: VISITA_OK }, startTime: { $gte: D90 } },
        { projection: { 'steps.property._id': 1, startTime: 1 } })) {
        if (!isDate(v.startTime)) continue;
        for (const pid of new Set(((v.steps as Document[]) ?? []).map((s) => String(dig(s, 'property', '_id'))))) {
            if (!idSet.has(pid)) continue;
            (visP.get(pid) ?? visP.set(pid, []).get(pid)!).push(v.startTime);
        }
    }
    // vistas fechadas (metrics type 'view'): las mismas que usa la tabla de propiedades de /mb
    const vistP = new Map<string, Date[]>();
    for await (const m of db.collection('metrics').find({ type: 'view', property: { $in: ids }, createdAt: { $gte: D30 < Lm1 ? D30 : Lm1 } },
        { projection: { property: 1, createdAt: 1 } })) {
        if (!isDate(m.createdAt)) continue;
        const pid = String(m.property);
        (vistP.get(pid) ?? vistP.set(pid, []).get(pid)!).push(m.createdAt);
    }
    const ofertas = new Map<string, number>();
    for (const r of await db.collection('operations').aggregate([
        { $match: { 'property._id': { $in: ids }, 'status.last': { $ne: 'cancelled' } } },
        { $group: { _id: '$property._id', n: { $sum: 1 } } }]).toArray()) ofertas.set(String(r._id), r.n as number);
    // quién fijó a mano: pinnedBy es el uid de Firebase del usuario
    const uids = [...new Set(props.map((p) => dig(p, 'portals', 'inmuebles24', 'pinnedBy')).flat().filter(Boolean).map(String))];
    const quien = new Map<string, string>();
    if (uids.length) for await (const a of db.collection('agents').find({ uid: { $in: uids } }, { projection: { uid: 1, firstName: 1, lastName: 1 } }))
        quien.set(String(a.uid), `${a.firstName ?? ''} ${a.lastName ?? ''}`.replace(/\s+/g, ' ').trim());

    // scoring de avisos.ts (cacheado 24 h por cuenta)
    const score = new Map<string, Aviso>();
    try { for (const a of (await datosDe(nombre)).avisos) score.set(a.id, a); } catch (e) { console.error('[marketing] scoring', e); }

    const cuenta = (xs: Date[] | undefined, a: Date, b: Date) => (xs ?? []).filter((t) => t >= a && t < b).length;
    const fin = new Date(ahora.getTime() + DIA);
    const cambiosSem: CambioMk[] = [], cambiosAnt: CambioMk[] = [];
    const avisos: AvisoMk[] = props.map((p) => {
        const i24 = (dig(p, 'portals', 'inmuebles24') as Document) ?? {};
        const hist = (((i24.history as Document[]) ?? []).map((e) => ({ t: fechaHist(e), tipo: e.type, e })).filter((h) => h.t) as Array<{ t: Date; tipo: unknown; e: Document }>)
            .sort((a, b) => a.t.getTime() - b.t.getTime());
        const nivel = nivelDe(i24.type);
        const codigo = String(p.internalId ?? p._id);
        // cambios: nivel al inicio y al final de cada semana
        for (const [a, b, dest] of [[L0, ahora, cambiosSem], [Lm1, L0, cambiosAnt]] as Array<[Date, Date, CambioMk[]]>) {
            const ini = nivelEn(hist, a), fn = nivelEn(hist, b);
            const antes = ini?.nivel ?? null, despues = b === ahora ? nivel : fn?.nivel ?? null;
            if (antes && despues && antes !== despues && antes !== 'Offline' && despues !== 'Offline') {
                const ult = hist.filter((h) => h.t > a && h.t <= b).pop();
                const trig = ult ? String(ult.e.trigger ?? '') : '';
                dest.push({ codigo, antes, despues, sube: rango(despues) > rango(antes), fecha: ult ? ymd(ult.t) : ymd(b),
                    motivo: TRIGGER[trig] ?? (trig || (ult?.e.note ? String(ult.e.note).replace(/_/g, ' ') : null)) });
            }
        }
        // inicio de la racha en el nivel actual
        let desde: Date | null = null;
        for (let k = hist.length - 1; k >= 0; k--) {
            if (String(hist[k].tipo).toUpperCase() === 'OFFLINE') continue;   // el bug de i24 no corta la racha
            if (nivelDe(hist[k].tipo) === nivel) desde = hist[k].t; else break;
        }
        const pid = String(p._id);
        const L = leadsP.get(pid), V = visP.get(pid), W = vistP.get(pid);
        const sc = score.get(codigo);
        const perf = (i24.performance as Document) ?? {};
        const pinBy = [i24.pinnedBy].flat().filter(Boolean).map(String)[0];
        const pub = isDate(p.publishedAt) ? p.publishedAt : null;
        const num = (v: unknown) => (typeof v === 'number' ? v : null);
        return {
            id: pid, codigo, tipo: (p.type as string) ?? null, operacion: dig(p, 'listing', 'operation') === 'rent' ? 'Renta' : 'Venta',
            colonia: (dig(p, 'address', 'neighborhood', 'name') as string) ?? null,
            calle: String(dig(p, 'address', 'street') ?? '').replace(/\s+/g, ' ').trim() || null,
            asesor: `${dig(p, 'agent', 'firstName') ?? ''} ${dig(p, 'agent', 'lastName') ?? ''}`.replace(/\s+/g, ' ').trim() || '—',
            precio: (dig(p, 'listing', 'value') as number) ?? null, nivel,
            meli: String(dig(p, 'portals', 'mercadolibre', 'type') ?? 'sin aviso').toLowerCase(),
            diasPublicada: pub ? Math.floor((ahora.getTime() - pub.getTime()) / DIA) : null,
            fijado: i24.pinned === true, fijadoPor: pinBy ? quien.get(pinBy) ?? 'usuario de Pulppo' : null,
            fijadoEl: isDate(i24.pinnedAt) ? ymd(i24.pinnedAt) : null,
            enNivelDesde: desde ? ymd(desde) : null, diasEnNivel: desde ? Math.floor((ahora.getTime() - desde.getTime()) / DIA) : null,
            leadsEnNivel: desde ? cuenta(L, desde, fin) : 0,
            vistasSem: cuenta(W, L0, fin), vistasSemAnt: cuenta(W, Lm1, L0), vistas30: cuenta(W, D30, fin),
            leadsSem: cuenta(L, L0, fin), leadsSemAnt: cuenta(L, Lm1, L0), leads30: cuenta(L, D30, fin), leads90: cuenta(L, D90, fin),
            visitasSem: cuenta(V, L0, fin), visitasSemAnt: cuenta(V, Lm1, L0), visitas30: cuenta(V, D30, fin), visitas90: cuenta(V, D90, fin),
            ofertas: ofertas.get(pid) ?? 0,
            vistasI24: num(dig(perf, 'views', 'listing')), vistasMercadoI24: num(dig(perf, 'views', 'market')) != null ? Math.round(num(dig(perf, 'views', 'market'))!) : null,
            puntos: sc?.puntos ?? null, compite: !!sc?.compite, tags: sc?.tags ?? [], falta: sc?.falta ?? '',
            precioVsZona: sc?.precioVsZona ?? null, demanda: sc?.demanda ?? null, competencia: sc?.competencia ?? null,
        };
    });

    const porNivelMap = new Map<string, { n: number; venta: number; renta: number }>();
    const baseMap = new Map<string, number>();
    const meliMap = new Map<string, number>(), noProm = new Map<string, number>();
    // Zona demand = las 4 alcaldías oficiales (mismo criterio que la asignación de avisos; Huixquilucan NO)
    const sinAc = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const ALCALDIAS_ZD = new Set(['miguel hidalgo', 'alvaro obregon', 'cuajimalpa de morelos', 'cuajimalpa', 'la magdalena contreras', 'magdalena contreras']);
    const zdp = { ventaInv: 0, ventaEnZd: 0, premium: 0, premiumZd: 0, zdFueraDeZona: 0 };
    for (const p of props) {
        if (dig(p, 'listing', 'operation') !== 'sale') continue;
        const t = String(dig(p, 'portals', 'inmuebles24', 'type') ?? '');
        const enZd = ALCALDIAS_ZD.has(sinAc(dig(p, 'address', 'city', 'name')));
        const premium = /^(HOME|DESTACADO)/.test(t), tierZd = t.includes('ZONA_DEMAND');
        zdp.ventaInv++; if (enZd) zdp.ventaEnZd++;
        if (premium) { zdp.premium++; if (tierZd) zdp.premiumZd++; }
        if (tierZd && !enZd) zdp.zdFueraDeZona++;
    }
    let zdVenta = 0, venta = 0;
    for (const [k, p] of props.entries()) {
        const a = avisos[k];
        const e = porNivelMap.get(a.nivel) ?? porNivelMap.set(a.nivel, { n: 0, venta: 0, renta: 0 }).get(a.nivel)!;
        e.n++; if (a.operacion === 'Renta') e.renta++; else e.venta++;
        baseMap.set(nivelBase(a.nivel), (baseMap.get(nivelBase(a.nivel)) ?? 0) + 1);
        if (a.operacion === 'Venta') { venta++; if (a.nivel.endsWith('zona demand')) zdVenta++; }
        meliMap.set(a.meli, (meliMap.get(a.meli) ?? 0) + 1);
        const motivos = (dig(p, 'portals', 'inmuebles24', 'noPromotedReason') as string[] | undefined) ?? [];
        for (const m of motivos) noProm.set(m, (noProm.get(m) ?? 0) + 1);
    }
    const porNivel: PorNivelMk[] = NIVELES.filter((n) => porNivelMap.has(n)).map((nivel) => {
        const xs = avisos.filter((a) => a.nivel === nivel);
        const s = (k: keyof AvisoMk) => xs.reduce((t, a) => t + (a[k] as number), 0);
        return { nivel, avisos: xs.length,
            vistasSem: s('vistasSem'), vistasSemAnt: s('vistasSemAnt'), vistas30: s('vistas30'),
            leadsSem: s('leadsSem'), leadsSemAnt: s('leadsSemAnt'), leads30: s('leads30'),
            visitasSem: s('visitasSem'), visitasSemAnt: s('visitasSemAnt'), visitas30: s('visitas30') };
    });

    return {
        inmobiliaria: nombre, generado: ahora.toISOString(),
        semana: { desde: ymd(L0), hasta: ymd(ahora), enCurso: true },
        semanaAnt: { desde: ymd(Lm1), hasta: ymd(new Date(L0.getTime() - DIA)), enCurso: false },
        asignacion: {
            venta, renta: avisos.length - venta,
            porNivel: NIVELES.filter((n) => porNivelMap.has(n)).map((nivel) => ({ nivel, ...porNivelMap.get(nivel)! })),
            i24: NIVELES_BASE.filter((n) => baseMap.has(n)).map((nivel) => ({ nivel, n: baseMap.get(nivel)! })),
            zonaDemandVenta: { zonaDemand: zdVenta, normal: venta - zdVenta },
            zdProporcion: zdp,
            meli: [...meliMap.entries()].sort((a, b) => b[1] - a[1]).map(([tipo, n]) => ({ tipo, n })),
            fijados: avisos.filter((a) => a.fijado).map((a) => ({ codigo: a.codigo, nivel: a.nivel, por: a.fijadoPor, el: a.fijadoEl })),
            noPromovidos: [...noProm.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo: motivo.toLowerCase(), n })),
        },
        cambios: { semana: cambiosSem.sort((a, b) => b.fecha.localeCompare(a.fecha)), semanaAnt: cambiosAnt.sort((a, b) => b.fecha.localeCompare(a.fecha)) },
        porNivel, avisos, reglas: { leadsRotar: LEADS_ROTAR },
        ...derivar(avisos),
    };
}

export const esPremium = (nivel: string) => PREMIUM.has(nivel);
export { pct };

const f0 = (n: number) => n.toLocaleString('es-MX');
/** «+18% vs la colonia» a partir del cociente precio/zona del scoring */
const pl = (n: number, uno: string, varios: string) => `${f0(n)} ${n === 1 ? uno : varios}`;
const vsZona = (r: number | null) => (r == null ? null : `${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)}% vs la colonia`);

/** El «por qué» corto y concreto de un aviso: exposición, vistas, leads, precio, demanda y competencia.
 *  Ej.: «Súper destacado desde hace 45 días, 1,200 vistas y 0 leads: la ven pero no escriben → revisar
 *  precio (+18% vs la colonia) y fotos». */
function porqueDe(a: AvisoMk): string {
    const partes: string[] = [];
    const premium = PREMIUM.has(a.nivel);
    const nivel = premium && a.diasEnNivel != null ? `${a.nivel} desde hace ${a.diasEnNivel} días, ` : '';
    const precio = vsZona(a.precioVsZona);
    const caro = a.tags.some((t) => PRECIO.has(t));
    const ficha = a.tags.filter((t) => FICHA.has(t));
    if (a.vistas30 >= 30 && a.leads30 === 0) {
        const revisar = ficha.length ? `${caro && precio ? `precio (${precio})` : 'precio'}, fotos y video` : `${caro && precio ? `precio (${precio})` : 'precio'} y fotos`;
        partes.push(`${nivel}${pl(a.vistas30, 'vista', 'vistas')} y 0 leads en 30 días: la ven pero no escriben → revisar ${revisar}`);
    } else if (a.vistas30 < 15) {
        partes.push(`${nivel}${pl(a.vistas30, 'vista', 'vistas')} en 30 días: casi nadie la ve → ${premium ? 'el lugar destacado no le está dando exposición: revisar zona y título' : 'falta exposición o zona'}`);
    } else {
        partes.push(`${nivel}${pl(a.vistas30, 'vista', 'vistas')}, ${pl(a.leads30, 'lead', 'leads')} y ${pl(a.visitas30, 'visita', 'visitas')} en 30 días`);
        if (caro && precio) partes.push(`precio ${precio}`);
        if (ficha.length) partes.push(`ficha: ${ficha.join(', ')}`);
    }
    if (a.demanda != null) partes.push(a.demanda <= 5 ? `poca demanda en la zona (${a.demanda} ${a.demanda === 1 ? 'búsqueda' : 'búsquedas'})` : `${f0(a.demanda)} búsquedas en la zona`);
    if (a.competencia != null && a.competencia >= 15) partes.push(`${f0(a.competencia)} comparables compitiendo`);
    return partes.join(' · ');
}

/** Las lecturas accionables, todas a partir del scoring de avisos.ts y de la regla de 30 leads. */
function derivar(avisos: AvisoMk[]): Pick<MarketingMk, 'estrellas' | 'desperdicio' | 'premiumSinLeads' | 'subir' | 'rotar' | 'trabadas'> {
    const conv = (a: AvisoMk) => (a.leads30 ? a.visitas30 / a.leads30 : null);
    const estrellas = avisos.filter((a) => a.leads30 > 0).sort((a, b) => b.leads30 - a.leads30).slice(0, 15).map((a) => {
        const c = conv(a);
        const etiqueta: 'Estrella' | 'Mucho ruido, poca visita' | 'En camino' =
            a.leads30 >= 5 && c != null && c >= 0.15 ? 'Estrella' : a.leads30 >= 5 && (c ?? 0) < 0.10 ? 'Mucho ruido, poca visita' : 'En camino';
        return { codigo: a.codigo, nivel: a.nivel, operacion: a.operacion, vistas30: a.vistas30, leads30: a.leads30, visitas30: a.visitas30, conv: c, etiqueta };
    });
    const desperdicio = avisos.filter((a) => PREMIUM.has(a.nivel)).map((a) => {
        const malo = a.leads30 === 0 || a.tags.some((t) => PRECIO.has(t)) || a.tags.some((t) => FICHA.has(t));
        return { codigo: a.codigo, nivel: a.nivel, operacion: a.operacion, vistas30: a.vistas30, leads30: a.leads30, motivo: malo ? porqueDe(a) : '' };
    }).filter((x) => x.motivo).sort((a, b) => a.leads30 - b.leads30);
    // premium sin un solo lead desde que entró a su nivel (sobre todo súper destacados), por días en el nivel
    const premiumSinLeads = avisos.filter((a) => PREMIUM.has(a.nivel) && a.leadsEnNivel === 0 && (a.diasEnNivel ?? 0) >= 7)
        .sort((a, b) => (rango(b.nivel) - rango(a.nivel)) || ((b.diasEnNivel ?? 0) - (a.diasEnNivel ?? 0)))
        .map((a) => ({ codigo: a.codigo, nivel: a.nivel, operacion: a.operacion, diasEnNivel: a.diasEnNivel ?? 0, desde: a.enNivelDesde, vistas30: a.vistas30, porque: porqueDe(a) }));
    const subir = avisos.filter((a) => a.nivel === 'Simple' && a.compite && (a.puntos ?? 0) >= 60)
        .sort((a, b) => (b.puntos ?? 0) - (a.puntos ?? 0)).slice(0, 15)
        .map((a) => ({ codigo: a.codigo, operacion: a.operacion, puntos: a.puntos ?? 0, leads30: a.leads30, demanda: a.demanda, competencia: a.competencia }));
    const rotar = avisos.filter((a) => PREMIUM.has(a.nivel)).map((a) => {
        const motivo = a.leadsEnNivel >= LEADS_ROTAR ? `ya juntó ${a.leadsEnNivel} leads en su lugar: libera el lugar para otra`
            : !a.compite && a.tags.length ? `el scoring no lo recomienda (${a.tags[0]})` : '';
        return { codigo: a.codigo, nivel: a.nivel, operacion: a.operacion, leadsEnNivel: a.leadsEnNivel, desde: a.enNivelDesde, motivo };
    }).filter((x) => x.motivo).sort((a, b) => b.leadsEnNivel - a.leadsEnNivel);
    const trabadas = avisos.filter((a) => (a.diasPublicada ?? 0) >= 60 && a.ofertas === 0 && (a.leads90 <= 2 || (a.leads90 >= 5 && a.visitas90 === 0)))
        .map((a) => {
            let freno = 'Revisar', accion = 'Revisar con el asesor qué está frenando la propiedad.';
            if (a.tags.some((t) => PRECIO.has(t))) { freno = 'Precio'; accion = `Llevar el ACM y los cierres de la zona al propietario${a.falta && a.falta !== 'nada' ? ` (${a.falta})` : ''}.`; }
            else if (a.tags.some((t) => FICHA.has(t))) { freno = 'Ficha'; accion = `Completar el anuncio: ${a.falta}.`; }
            else if (a.leads90 >= 5 && a.visitas90 === 0) { freno = 'Atención'; accion = `${a.leads90} leads en 90 días y ninguna visita: revisar el seguimiento del asesor.`; }
            else if (a.vistas30 >= 30 && a.leads90 <= 2) { freno = 'Precio o fotos'; accion = 'La ven pero no escriben: revisar precio contra la colonia y la primera foto.'; }
            else if (a.leads90 <= 2 && !PREMIUM.has(a.nivel)) { freno = 'Exposición'; accion = a.compite ? 'Promoverla: el scoring dice que puede competir por un lugar destacado.' : `Casi nadie la ve y no compite por un destacado (${a.tags[0] ?? 'sin datos'}): revisar zona, título y precio.`; }
            else if (a.leads90 <= 2) { freno = 'Demanda'; accion = 'Está destacada y aun así no genera leads: bajarla a Simple y revisar precio y zona.'; }
            return { codigo: a.codigo, nivel: a.nivel, operacion: a.operacion, dias: a.diasPublicada ?? 0, vistas30: a.vistas30, leads90: a.leads90, visitas90: a.visitas90, freno, porque: porqueDe(a), accion };
        }).sort((a, b) => b.dias - a.dias);
    return { estrellas, desperdicio, premiumSinLeads, subir, rotar, trabadas };
}
