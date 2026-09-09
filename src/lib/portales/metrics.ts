// Capa compartida de cálculo de portales. Porteo de `metrics_lib.py` del dashboard local
// (que a su vez era una COPIA de la del pipeline de reportes — el README advertía "si cambias
// reglas allá, RE-COPIA acá"). Al traerlo queda UNA sola.
//
// Reglas base: ~/Documents/Pulppo/_Analytics/FUNDAMENTOS.md
//
// ⚠️⚠️ UTC obligatorio en todo este módulo. Mongo guarda las fechas en UTC y el Python las lee
// naive (o sea, ya en UTC). En JS `new Date(y, m, d)` es medianoche LOCAL: en México (UTC−6)
// eso corre cada ventana 6 horas y mete/saca leads de los bordes del mes. Es el mismo bug que
// se corrigió en Pulppo Plus (ahí movía newPro de 0 a 6). Siempre `Date.UTC(...)` + `getUTC*()`.
import { ObjectId, type Document, type Filter } from 'mongodb';
import { getDb } from '../data';

/** Desfase fijo México (UTC−6, sin DST) en milisegundos. */
export const MX_MS = 6 * 3600 * 1000;

export const CANALES: Array<[string, string]> = [
    ['Inmuebles24', 'i24'], ['MercadoLibre', 'meli'], ['EasyBroker', 'easybroker'],
    ['Propiedades.com', 'propiedades'], ['Casas y Terrenos', 'cyt'], ['Meta (FB/IG)', 'facebook'],
    ['WhatsApp', 'whatsapp'], ['Pulppo', 'pulppo'],
];
export const KEYS = CANALES.map(([, k]) => k);
export const KEY2NAME: Record<string, string> = Object.fromEntries(CANALES.map(([n, k]) => [k, n]));
export const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ── exclusiones (FUNDAMENTOS §2) ───────────────────────────────────
// Habi SIEMPRE por email `tuhabi`, NUNCA por nombre: sus ~121 inmobiliarias tienen nombres
// arbitrarios que no dicen "habi" (IJB Asesoría, ÁUREA, Mundo Vitalia…) y regexear 'habi'
// suelto mata inmobiliarias reales tipo Habitat/Habitare/Habix.
const HABI = { $regex: 'tuhabi', $options: 'i' } as const;
const TEST = { $regex: String.raw`\btest\b|testing|\bdemo\b|prueba`, $options: 'i' } as const;
/** lead.company (la inmobiliaria que recibe) — universos de leads/visitas/cohorte. */
export const NOT: Filter<Document> = { 'company.email': { $not: HABI }, 'company.name': { $not: TEST } };
/** property.company embebida — cierres y pipeline. */
export const NOTP: Filter<Document> = {
    'property.company.email': { $not: HABI }, 'property.company.name': { $not: TEST },
};

// ── clasificador de fuente ─────────────────────────────────────────
// Meta = TODO lo de Facebook/Instagram, verificado contra los 88 valores distintos de
// leads.source: facebook · fb · fb-SiteLink-* · ig · IGShopping · instagram · an.
// ⚠️ Un `^ig$` anclado NO captura IGShopping — de ahí el alterno.
// `whatsapp` va DESPUÉS: los ads de click-to-WhatsApp llegan con source=facebook +
// medium=whatsapp (ya cuentan como Meta); el source=whatsapp suelto es el del broker.
const SRC_REGEX: Record<string, string> = {
    i24: 'inmuebles.?24|i24',
    meli: 'meli|mercado.?libre|^ml$|mercadolibre',
    easybroker: 'easybroker',
    propiedades: String.raw`propiedades\.com`,
    cyt: 'casas-y-terrenos|casas y terrenos',
    facebook: 'facebook|^fb$|^fb-|meta|^ig$|instagram|igshopping|^an$',
    whatsapp: 'whatsapp',
    pulppo: 'pulppo',
};
const ORDEN = ['i24', 'meli', 'easybroker', 'propiedades', 'cyt', 'facebook', 'whatsapp', 'pulppo'];
const COMP: Record<string, RegExp> = Object.fromEntries(
    Object.entries(SRC_REGEX).map(([k, v]) => [k, new RegExp(v, 'i')]));

/** Clasifica un `source` a canal, o 'otros'. Orden fijo: i24 primero. */
export function classifySource(s?: string | null): string {
    const t = (s || '').trim().toLowerCase();
    for (const k of ORDEN) if (COMP[k].test(t)) return k;
    return 'otros';
}

// ── buckets de precio (FUNDAMENTOS §3) ─────────────────────────────
export const VB_ORDER = ['0-3M', '3-6M', '6-10M', '+10M'];
export const RB_ORDER = ['0-20k', '20-40k', '40-70k', '70k+'];
const VB: Array<[number, number, string]> = [
    [0, 3e6, '0-3M'], [3e6, 6e6, '3-6M'], [6e6, 10e6, '6-10M'], [10e6, Infinity, '+10M']];
const RB: Array<[number, number, string]> = [
    [0, 20e3, '0-20k'], [20e3, 40e3, '20-40k'], [40e3, 70e3, '40-70k'], [70e3, Infinity, '70k+']];
export function bucket(v: unknown, B: Array<[number, number, string]>): string | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    for (const [lo, hi, lb] of B) if (v >= lo && v < hi) return lb;
    return null;
}
export { VB, RB };

// ── helpers ────────────────────────────────────────────────────────
export function dig(d: unknown, ...ks: string[]): unknown {
    let cur: unknown = d;
    for (const k of ks) cur = cur && typeof cur === 'object' ? (cur as Document)[k] : undefined;
    return cur;
}
export function oid(x: unknown): ObjectId | null {
    try { return new ObjectId(String(x)); } catch { return null; }
}
export const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const pct = (cur: number, prev: number): number | null =>
    prev ? Math.round(((cur - prev) / prev) * 100) : null;

/** Fecha civil de HOY en México, como {y, m, d}. En Vercel el reloj es UTC, así que sin
 *  restar las 6 horas el "hoy" salta de día a las 18:00 hora de México. */
export function hoyMx(now = Date.now()): { y: number; m: number; d: number } {
    const t = new Date(now - MX_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** Medianoche UTC del día dado (equivalente al `_dt(date)` del Python). */
export const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** [inicio, fin) del mes. m es 1..12. */
export function monthWindow(y: number, m: number): [Date, Date] {
    return [utc(y, m, 1), m === 12 ? utc(y + 1, 1, 1) : utc(y, m + 1, 1)];
}
/** Lunes de la semana de `d` (Python weekday(): lunes=0; JS getUTCDay(): domingo=0). */
export function lunesDe(d: Date): Date {
    const wd = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - wd * 86400000);
}
/** Hora del día en México de un instante UTC. */
export const horaMx = (d: Date) => new Date(d.getTime() - MX_MS).getUTCHours();
export const mesKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// ── split cliente vs broker ────────────────────────────────────────
// Decisión de Ale: por tags /broker/i normalizado. `role` deja 99.6% en "cliente" (inservible);
// las tags dan ~9% broker en MeLi. Se agrupa por patrón, no por valor exacto.
const BROKER_RE = /broker/i;
/** Dado un set de contact._id (string), devuelve el subset que es broker por tags. */
export async function brokerContacts(ids: Iterable<string>): Promise<Set<string>> {
    const db = await getDb();
    const oids = [...ids].map(oid).filter((o): o is ObjectId => !!o);
    const out = new Set<string>();
    const B = 1000;
    for (let i = 0; i < oids.length; i += B) {
        const cur = db.collection('contacts')
            .find({ _id: { $in: oids.slice(i, i + B) } }, { projection: { tags: 1 } });
        for await (const c of cur) {
            const tags = (c.tags as unknown[]) ?? [];
            if (tags.some((t) => BROKER_RE.test(String(t)))) out.add(String(c._id));
        }
    }
    return out;
}

// ── cierres + regalía por canal (atribución por buyer.source) ──────
export interface CierreCanal { n: number; comision: number; regalia: number; gmv: number; ticket: number }

/** Cierres (closed/paying con closedAt en [a,b)) por canal. regalia = pulppoComission.
 *  Para el 6% del deal MeLi NO se usa esto: ver `deal.ts`. */
export async function cierresPorCanal(a: Date, b: Date): Promise<Record<string, CierreCanal>> {
    const db = await getDb();
    const agg: Record<string, CierreCanal> = {};
    const mk = (): CierreCanal => ({ n: 0, comision: 0, regalia: 0, gmv: 0, ticket: 0 });
    for (const k of [...KEYS, 'otros']) agg[k] = mk();
    const cur = db.collection('operations').find({
        'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: a, $lt: b }, ...NOTP,
    }, { projection: { 'buyer.source': 1, 'comission.value': 1, 'pulppoComission.value': 1, 'closeValue.value': 1 } });
    for await (const o of cur) {
        const k = classifySource(dig(o, 'buyer', 'source') as string);
        const r = agg[k] ?? agg.otros;
        r.n += 1;
        r.comision += num(dig(o, 'comission', 'value'));
        r.regalia += num(dig(o, 'pulppoComission', 'value'));
        r.gmv += num(dig(o, 'closeValue', 'value'));
    }
    for (const k of Object.keys(agg)) {
        const r = agg[k];
        r.ticket = r.n ? Math.round(r.gmv / r.n) : 0;
        r.comision = Math.round(r.comision);
        r.regalia = Math.round(r.regalia);
    }
    return agg;
}
