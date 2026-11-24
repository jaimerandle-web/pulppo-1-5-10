// Asignación de avisos (fase 3 de /portales, nov-2026): la hoja de Ale para jugar con el número de avisos
// de cada inmobiliaria, con las reglas a la vista y lo que las KAMs pueden consultar.
//
// Tres fuentes, cada una para lo que sí sabe:
//   · Sheet de asignación, pestaña «Asignación» (gid 839916250): MODELO, % de regalía, regalía al mes y las
//     excepciones. Es entrada humana: no está en Mongo. Se lee por /export?format=csv&gid=, porque gviz por
//     nombre de pestaña devuelve sólo una parte (adivina encabezados y se salta las filas de Equipos).
//   · Mongo: inventario publicado hoy (venta, ZD = venta en las 4 alcaldías), el cupo cargado hoy en la
//     herramienta (`adassignmentcompanycupos`, el último registro por compañía y portal) y lo que está en línea.
//   · El borrador (lo que Ale escribe) vive en Blob (`asignacionStore.ts`), no aquí.
//
// Las REGLAS (cuánto se destaca y el tope de reinversión) corren en el navegador para que se puedan mover en
// vivo: ver `reglas` en app/portales/Asignacion.tsx.
import { unstable_cache } from 'next/cache';
import { ObjectId } from 'mongodb';
import { getDb } from '../data';
import { dig } from './metrics';
import { opcionesInmobiliarias } from './inmobiliaria';
import { normInmo } from './ordenInmobiliarias';
import { CUENTAS_PULPPO, planContratado, type PlanContratado } from './publicacion';
import { MELI_PAQUETE } from './inversion';

const SHEET = '1EzkDZnpTSjhh49S1yKDTOAQLDLtGgwg1NSxS3Vk6f6s';
const GID_ASIGNACION = '839916250';

/** Los niveles de la herramienta, en su orden. */
export const NIVELES = ['sdzd', 'sd', 'dzd', 'd', 'simple', 'op', 'oro', 'plata'] as const;
export type Nivel = typeof NIVELES[number];
export type Cuenta = Record<Nivel, number>;
const TIER_A_NIVEL: Record<string, Nivel> = {
    'zd-super-destacado': 'sdzd', 'super-destacado': 'sd', 'zd-destacado': 'dzd', destacado: 'd', simple: 'simple',
    'oro-meli': 'op', 'plata-meli': 'oro', 'simple-meli': 'plata',
};
const cero = (): Cuenta => ({ sdzd: 0, sd: 0, dzd: 0, d: 0, simple: 0, op: 0, oro: 0, plata: 0 });

export interface FilaAsig {
    nombre: string; kam: string | null; tier: string | null;
    /** del Sheet (null = la inmobiliaria no está en la pestaña) */
    modelo: string | null; pctRegalia: number | null; regaliaMes: number | null; pctReinversion: number | null;
    excSD: number | null; excD: number | null; nota: string;
    /** Mongo, hoy */
    invTotal: number; invVenta: number; invZdVenta: number;
    hoy: Cuenta;        // cupo cargado en la herramienta
    enLinea: Cuenta;    // avisos en línea por nivel
}
export interface AsignacionView {
    generado: string; filas: FilaAsig[]; plan: PlanContratado;
    meli: typeof MELI_PAQUETE;
    hoja: { ok: boolean; nota?: string; fuente: string };
}

// ── Sheet ───────────────────────────────────────────────────────────
function csv(t: string): string[][] {
    const rows: string[][] = []; let row: string[] = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
        else if (ch === '"') q = true; else if (ch === ',') { row.push(c); c = ''; }
        else if (ch === '\n') { row.push(c); rows.push(row); row = []; c = ''; } else if (ch !== '\r') c += ch;
    }
    if (c || row.length) { row.push(c); rows.push(row); }
    return rows;
}
const num = (s?: string) => { const t = String(s ?? '').replace(/[$,%\s]/g, '').replace('−', '-'); if (!t || !/\d/.test(t)) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const pct = (s?: string) => { const n = num(s); return n == null ? null : n / 100; };

interface DeHoja { modelo: string; pctRegalia: number | null; regaliaMes: number | null; pctReinversion: number | null; excSD: number | null; excD: number | null; nota: string }
async function leerHoja(): Promise<{ ok: boolean; nota?: string; filas: Map<string, DeHoja> }> {
    const filas = new Map<string, DeHoja>();
    try {
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID_ASIGNACION}`, { cache: 'no-store' });
        if (!r.ok) return { ok: false, nota: `El Sheet respondió ${r.status}`, filas };
        const F = csv(await r.text());
        // los encabezados se buscan por NOMBRE (fila con «Inmobiliaria» y «Modelo»): si Ale mueve columnas, sigue leyendo
        const h = F.findIndex((f) => f[1]?.trim() === 'Inmobiliaria' && f.includes('Modelo'));
        if (h < 0) return { ok: false, nota: 'No encontré la fila de encabezados en la pestaña «Asignación»', filas };
        const H = F[h].map((x) => x.trim());
        const col = (n: string) => H.indexOf(n);
        const c = {
            modelo: col('Modelo'), reg: col('% regalía nuevo'), regMes: col('Regalía con el % nuevo /mes'), reinv: col('% reinversión'),
            sd: col('Excepción: SD fijos'), d: col('Excepción: D fijos'), nota: col('Nota'),
        };
        for (const f of F.slice(h + 1)) {
            const nombre = f[1]?.trim();
            if (!nombre || nombre === 'TOTAL') continue;
            filas.set(normInmo(nombre), {
                modelo: f[c.modelo]?.trim() || '', pctRegalia: pct(f[c.reg]), regaliaMes: num(f[c.regMes]), pctReinversion: pct(f[c.reinv]),
                excSD: num(f[c.sd]), excD: num(f[c.d]), nota: c.nota >= 0 ? (f[c.nota] ?? '').trim() : '',
            });
        }
        return { ok: true, filas };
    } catch (e) {
        return { ok: false, nota: e instanceof Error ? e.message : String(e), filas };
    }
}

// ── Mongo ───────────────────────────────────────────────────────────
const sinAc = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Zona demand = las 4 alcaldías oficiales (mismo criterio que marketingDh.ts; Huixquilucan NO)
const ALCALDIAS_ZD = new Set(['miguel hidalgo', 'alvaro obregon', 'cuajimalpa de morelos', 'cuajimalpa', 'la magdalena contreras', 'magdalena contreras']);
const I24_A_NIVEL = (t: unknown): Nivel | null => {
    const s = String(t ?? '').toUpperCase();
    if (s.startsWith('HOME')) return s.includes('ZONA_DEMAND') ? 'sdzd' : 'sd';
    if (s.startsWith('DESTACADO')) return s.includes('ZONA_DEMAND') ? 'dzd' : 'd';
    if (s.startsWith('SIMPLE')) return 'simple';
    return null;            // GRATIS / GRATIS_COMBO, y OFFLINE (bug de i24: va en «caídos» de Publicación, igual que allá)
};
const MELI_A_NIVEL: Record<string, Nivel> = { gold_premium: 'op', gold: 'oro', silver: 'plata' };

async function calcular(): Promise<AsignacionView> {
    const db = await getDb();
    const [opciones, hoja, plan] = await Promise.all([opcionesInmobiliarias(), leerHoja(), planContratado()]);
    const nombreDe = new Map<string, string>();
    for (const o of opciones) for (const id of o.ids) nombreDe.set(id, o.nombre);
    const filas = new Map<string, FilaAsig>();
    for (const o of opciones) {
        const s = hoja.filas.get(normInmo(o.nombre));
        filas.set(o.nombre, {
            nombre: o.nombre, kam: o.kam, tier: o.tier,
            modelo: s?.modelo || null, pctRegalia: s?.pctRegalia ?? null, regaliaMes: s?.regaliaMes ?? null, pctReinversion: s?.pctReinversion ?? null,
            excSD: s?.excSD ?? null, excD: s?.excD ?? null, nota: s?.nota ?? '',
            invTotal: 0, invVenta: 0, invZdVenta: 0, hoy: cero(), enLinea: cero(),
        });
    }

    // cupo cargado hoy: el registro más reciente por compañía y portal; una inmobiliaria partida en varias compañías suma todas
    const ultimo = new Map<string, { t: number; tiers: Record<string, number>; inmo: string }>();
    for await (const c of db.collection('adassignmentcompanycupos').find({}, { projection: { company: 1, portal: 1, tiers: 1, updatedAt: 1, createdAt: 1 } })) {
        const inmo = nombreDe.get(String(c.company));
        if (!inmo) continue;
        const k = `${String(c.company)}|${String(c.portal)}`;
        const t = new Date((c.updatedAt ?? c.createdAt ?? 0) as Date).getTime();
        const prev = ultimo.get(k);
        if (!prev || t > prev.t) ultimo.set(k, { t, tiers: (c.tiers as Record<string, number>) ?? {}, inmo });
    }
    for (const u of ultimo.values()) {
        const f = filas.get(u.inmo)!;
        for (const [tier, n] of Object.entries(u.tiers)) { const nv = TIER_A_NIVEL[tier]; if (nv) f.hoy[nv] += Number(n) || 0; }
    }

    // inventario publicado y en línea por nivel
    const comps = [...nombreDe.keys()].map((s) => new ObjectId(s));
    for await (const p of db.collection('properties').find({ 'status.last': 'published', 'company._id': { $in: comps } }, {
        projection: { 'company._id': 1, 'listing.operation': 1, 'address.city.name': 1, 'portals.inmuebles24.type': 1, 'portals.inmuebles24.status': 1, 'portals.inmuebles24.company': 1, 'portals.mercadolibre.type': 1, 'portals.mercadolibre.status': 1 },
    })) {
        const f = filas.get(nombreDe.get(String(dig(p, 'company', '_id')))!)!;
        f.invTotal++;
        if (dig(p, 'listing', 'operation') === 'sale') {
            f.invVenta++;
            if (ALCALDIAS_ZD.has(sinAc(dig(p, 'address', 'city', 'name')))) f.invZdVenta++;
        }
        // sólo NUESTRAS cuentas de i24: la cuenta propia de una inmobiliaria (51224741) no ocupa cupo
        if (String(dig(p, 'portals', 'inmuebles24', 'status') ?? '').toUpperCase() === 'ONLINE'
            && CUENTAS_PULPPO.includes(String(dig(p, 'portals', 'inmuebles24', 'company') ?? ''))) {
            const nv = I24_A_NIVEL(dig(p, 'portals', 'inmuebles24', 'type'));
            if (nv) f.enLinea[nv]++;
        }
        // misma regla de «en línea» que publicacion.ts
        const ml = String(dig(p, 'portals', 'mercadolibre', 'status') ?? '').toUpperCase();
        if ((ml === 'ONLINE' || ml === 'PUBLISHED') && String(dig(p, 'portals', 'mercadolibre', 'type') ?? '').toUpperCase() !== 'OFFLINE') {
            const nv = MELI_A_NIVEL[String(dig(p, 'portals', 'mercadolibre', 'type') ?? '').toLowerCase()];
            if (nv) f.enLinea[nv]++;
        }
    }

    return {
        generado: new Date().toISOString(), filas: [...filas.values()], plan, meli: MELI_PAQUETE,
        hoja: { ok: hoja.ok, nota: hoja.nota, fuente: `docs.google.com/spreadsheets/d/${SHEET} · pestaña Asignación` },
    };
}

/** Datos de la asignación (caché 30 min: el cupo de la herramienta cambia pocas veces al día). */
export async function asignacionView(fresco = false): Promise<AsignacionView> {
    if (fresco) return calcular();
    return unstable_cache(calcular, ['portales-asignacion-v2'], { revalidate: 1800, tags: ['portales-asignacion'] })();
}
