// Pulppo Plus — niveles y competencia de inmobiliarias y asesores.
// Porteo de `~/Documents/Pulppo/Pulppo Plus/pp_data.py` (Streamlit + build estático mensual)
// a la app, para que lea Mongo en vivo y muera el refresco manual de cada mes.
//
// Dos métricas, se elige con toggle en la UI:
//   · 'cobrada' — comisión efectivamente cobrada en el mes: Σ payments[].comission.value
//                 cuyo createdAt cae en el mes. Es la que reproduce la lista de Ale.
//   · 'total'   — comisión de operaciones cerradas: comission.value de ops con closedAt en
//                 el mes y status.last en (closed, paying).
//
// Split por rol para rankings de broker: comprador 50 / vendedor 25 / productor 25.
// Si ambas partes son Pulppo se reparte; si una es externa, el lado Pulppo se lleva 100%.
//
// Exclusiones (idénticas al Python): demos/pruebas por nombre, y TuHabi por domain.host
// (NO por nombre — las inmobiliarias de Habi tienen nombres arbitrarios que no dicen 'habi',
// y regexear 'habi' mata inmobiliarias reales tipo Habitat/Habitare/Habix).
import { type Document } from 'mongodb';
import { getDb } from './data';

export const LEVELS = ['standard', 'professional', 'elite'] as const;
export type Level = (typeof LEVELS)[number];
const ORDER: Record<string, number> = { standard: 1, professional: 2, elite: 3 };
const DEMO_RE = /demo|testing|prueba|tu360|pulppo\.com|inmobiliaria demo/i;
export type Metric = 'cobrada' | 'total';

const isDemo = (n?: string | null) => !!n && DEMO_RE.test(n);
const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());

/** [inicio, fin) del mes. month es 1..12. */
export function monthBounds(year: number, month: number): [Date, Date] {
    // ⚠️ UTC obligatorio. Mongo guarda las fechas en UTC y el Python original las lee naive;
    // `new Date(y, m, 1)` es medianoche LOCAL y en México (UTC−6) corre la ventana 6 horas,
    // metiendo pagos del mes anterior y sacando los del último día.
    return [new Date(Date.UTC(year, month - 1, 1)),
            new Date(Date.UTC(year + Math.floor(month / 12), month % 12, 1))];
}

// ── mapas base ─────────────────────────────────────────────────────
export interface AgentMaps {
    level: Map<string, string | null>;
    uidEmail: Map<string, string>;
    name: Map<string, string>;
    company: Map<string, string | null>;
    hist: Map<string, [Date, Level][]>;
    pulppo: Set<string>;
}

export async function agentMaps(): Promise<AgentMaps> {
    const db = await getDb();
    const m: AgentMaps = {
        level: new Map(), uidEmail: new Map(), name: new Map(),
        company: new Map(), hist: new Map(), pulppo: new Set(),
    };
    const cur = db.collection('agents').find({}, {
        projection: { email: 1, uid: 1, level: 1, firstName: 1, lastName: 1, company: 1, levelHistory: 1 },
    });
    for await (const a of cur) {
        const e = a.email as string | undefined;
        if (!e) continue;
        m.level.set(e, (a.level as string) ?? null);
        m.pulppo.add(e);
        if (a.uid) m.uidEmail.set(a.uid as string, e);
        m.name.set(e, `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim());
        const c = a.company as Document | undefined;
        m.company.set(e, c && typeof c === 'object' ? ((c.name as string) ?? null) : null);
        const hs: [Date, Level][] = ((a.levelHistory as Document[]) ?? [])
            .filter((h) => isDate(h.timestamp) && ORDER[h.level as string])
            .map((h) => [h.timestamp as Date, h.level as Level]);
        hs.sort((x, y) => x[0].getTime() - y[0].getTime());
        m.hist.set(e, hs);
    }
    return m;
}

export interface CompanyMeta { integ: Date | null; tuhabi: boolean }

export async function companyMetaMap(): Promise<Map<string, CompanyMeta>> {
    const db = await getDb();
    const out = new Map<string, CompanyMeta>();
    const cur = db.collection('companies').find({}, { projection: { integratedAt: 1, 'domain.host': 1 } });
    for await (const c of cur) {
        const host = String(((c.domain as Document) ?? {}).host ?? '');
        out.set(String(c._id), {
            integ: isDate(c.integratedAt) ? (c.integratedAt as Date) : null,
            tuhabi: host.toLowerCase().includes('tuhabi'),
        });
    }
    return out;
}

const isTuhabi = (meta: Map<string, CompanyMeta> | undefined, cid: string) => !!meta?.get(cid)?.tuhabi;

// ── rankings de inmobiliarias ──────────────────────────────────────
export interface CompanyRow { name: string | null; value: number; nops: number; onboarding: boolean }

/** {companyId: [nombre, valor, nOps]} del mes/métrica. Excluye demos y TuHabi. */
export async function companyValueByMonth(
    year: number, month: number, metric: Metric, meta?: Map<string, CompanyMeta>,
): Promise<Map<string, { name: string | null; value: number; nops: number }>> {
    const db = await getDb();
    const [start, end] = monthBounds(year, month);
    const acc = new Map<string, { name: string | null; value: number; nops: number }>();
    const bump = (cid: string, nm: string | null, v: number) => {
        const r = acc.get(cid) ?? { name: nm, value: 0, nops: 0 };
        r.value += v; r.nops += 1; r.name = nm; acc.set(cid, r);
    };

    if (metric === 'cobrada') {
        // Ojo: recorre TODAS las ops con pagos (no se puede filtrar por mes en la query
        // porque el mes se decide por payments[].createdAt, que es un array).
        const cur = db.collection('operations').find(
            { 'payments.0': { $exists: true } }, { projection: { company: 1, payments: 1 } });
        for await (const op of cur) {
            let j = 0;
            for (const p of ((op.payments as Document[]) ?? [])) {
                if (isDate(p.createdAt) && p.createdAt >= start && p.createdAt < end) {
                    j += Number(((p.comission as Document) ?? {}).value ?? 0) || 0;
                }
            }
            if (j <= 0) continue;
            const co = (op.company as Document) ?? {};
            const cid = String(co._id);
            if (isDemo(co.name as string) || isTuhabi(meta, cid)) continue;
            bump(cid, (co.name as string) ?? null, j);
        }
    } else {
        const cur = db.collection('operations').find(
            { closedAt: { $gte: start, $lt: end }, 'status.last': { $in: ['closed', 'paying'] } },
            { projection: { company: 1, 'comission.value': 1 } });
        for await (const op of cur) {
            const co = (op.company as Document) ?? {};
            const cid = String(co._id);
            if (isDemo(co.name as string) || isTuhabi(meta, cid)) continue;
            bump(cid, (co.name as string) ?? null, Number(((op.comission as Document) ?? {}).value ?? 0) || 0);
        }
    }
    return acc;
}

export async function topCompanies(
    year: number, month: number, metric: Metric,
    meta: Map<string, CompanyMeta>, onboarding = false, n = 5,
): Promise<CompanyRow[]> {
    const data = await companyValueByMonth(year, month, metric, meta);
    const rows: CompanyRow[] = [];
    for (const [cid, r] of data) {
        // Regla de Ale: con fecha en integratedAt = consultoría; sin fecha = onboarding.
        const isOnb = (meta.get(cid)?.integ ?? null) === null;
        if (onboarding && !isOnb) continue;
        rows.push({ name: r.name, value: r.value, nops: r.nops, onboarding: isOnb });
    }
    rows.sort((a, b) => b.value - a.value);
    return rows.slice(0, n);
}

// ── split de comisión por rol ──────────────────────────────────────
function splitByRole(o: Document, amount: number, pulppo: Set<string>): Map<string, number> {
    const be = (((o.buyer as Document) ?? {}).broker as Document ?? {})?.email as string | undefined;
    const se = (((o.seller as Document) ?? {}).broker as Document ?? {})?.email as string | undefined;
    const pe = (((o.property as Document) ?? {}).agent as Document ?? {})?.email as string | undefined;
    const bp = !!be && pulppo.has(be), sp = !!se && pulppo.has(se);
    const out = new Map<string, number>();
    const add = (k: string, v: number) => out.set(k, (out.get(k) ?? 0) + v);

    const reparte = (w: Map<string, number>) => {
        const tw = [...w.values()].reduce((a, b) => a + b, 0);
        if (tw <= 0) return;
        for (const [k, wt] of w) add(k, (amount * wt) / tw);
    };

    if (bp && sp) {                       // interna: se reparte
        const w = new Map<string, number>();
        w.set(be!, (w.get(be!) ?? 0) + 50);
        w.set(se!, (w.get(se!) ?? 0) + 25);
        if (pe && pulppo.has(pe)) w.set(pe, (w.get(pe) ?? 0) + 25);
        reparte(w);
    } else if (bp && !sp) {               // externa del lado vendedor: comprador se lleva todo
        add(be!, amount);
    } else {
        const w = new Map<string, number>();
        if (se && pulppo.has(se)) w.set(se, (w.get(se) ?? 0) + 25);
        if (pe && pulppo.has(pe)) w.set(pe, (w.get(pe) ?? 0) + 25);
        reparte(w);
    }
    return out;
}

const PROJ_BROKER = {
    id: 1, payments: 1, 'comission.value': 1, closedAt: 1, 'status.last': 1, 'company._id': 1,
    'buyer.broker.email': 1, 'seller.broker.email': 1, 'property.agent.email': 1,
};

export async function brokerValueByMonth(
    year: number, month: number, metric: Metric, pulppo: Set<string>, meta?: Map<string, CompanyMeta>,
): Promise<{ acc: Map<string, number>; nops: Map<string, number> }> {
    const db = await getDb();
    const [start, end] = monthBounds(year, month);
    const acc = new Map<string, number>();
    const ops = new Map<string, Set<string>>();
    const q = metric === 'cobrada'
        ? { 'payments.0': { $exists: true } }
        : { closedAt: { $gte: start, $lt: end }, 'status.last': { $in: ['closed', 'paying'] } };

    for await (const o of db.collection('operations').find(q, { projection: PROJ_BROKER })) {
        if (isTuhabi(meta, String(((o.company as Document) ?? {})._id))) continue;
        let amt = 0;
        if (metric === 'cobrada') {
            for (const p of ((o.payments as Document[]) ?? [])) {
                if (isDate(p.createdAt) && p.createdAt >= start && p.createdAt < end) {
                    amt += Number(((p.comission as Document) ?? {}).value ?? 0) || 0;
                }
            }
        } else {
            amt = Number(((o.comission as Document) ?? {}).value ?? 0) || 0;
        }
        if (amt <= 0) continue;
        for (const [e, part] of splitByRole(o, amt, pulppo)) {
            acc.set(e, (acc.get(e) ?? 0) + part);
            const s = ops.get(e) ?? new Set<string>();
            s.add(String(o.id)); ops.set(e, s);
        }
    }
    const nops = new Map<string, number>();
    for (const [e, s] of ops) nops.set(e, s.size);
    return { acc, nops };
}

export interface BrokerRow { email: string; name: string; company: string | null; value: number; nops: number }

export async function topBrokersByLevel(
    year: number, month: number, metric: Metric, am: AgentMaps,
    meta?: Map<string, CompanyMeta>, n = 3,
): Promise<Record<Level, BrokerRow[]>> {
    const { acc, nops } = await brokerValueByMonth(year, month, metric, am.pulppo, meta);
    const by = { standard: [], professional: [], elite: [] } as Record<Level, BrokerRow[]>;
    for (const [e, v] of acc) {
        const lv = am.level.get(e) as Level | null | undefined;
        if (lv && lv in by) {
            by[lv].push({
                email: e, name: am.name.get(e) ?? '?', company: am.company.get(e) ?? null,
                value: v, nops: nops.get(e) ?? 0,
            });
        }
    }
    for (const lv of LEVELS) { by[lv].sort((a, b) => b.value - a.value); by[lv] = by[lv].slice(0, n); }
    return by;
}

// ── nuevos élite / profesional (primera vez) ───────────────────────
/** El corte del mes M lleva timestamp = día 1 del mes M+1. */
export function newAtLevel(year: number, month: number, level: Level, am: AgentMaps) {
    const corteY = year + Math.floor(month / 12);
    const corteM = (month % 12) + 1;
    const out: { name: string; company: string | null }[] = [];
    for (const [e, hs] of am.hist) {
        const aqui = hs.some(([ts, lv]) => ts.getUTCFullYear() === corteY && ts.getUTCMonth() + 1 === corteM && lv === level);
        if (!aqui) continue;
        const firsts = hs.filter(([, lv]) => lv === level).map(([ts]) => ts.getTime());
        if (!firsts.length) continue;
        const first = new Date(Math.min(...firsts));
        if (first.getUTCFullYear() === corteY && first.getUTCMonth() + 1 === corteM) {
            out.push({ name: am.name.get(e) ?? '?', company: am.company.get(e) ?? null });
        }
    }
    return out;
}

// ── movimiento de niveles ──────────────────────────────────────────
type YM = [number, number];
const ymKey = (a: YM) => `${a[0]}-${String(a[1]).padStart(2, '0')}`;
const mdiff = (a: YM, b: YM) => (b[0] - a[0]) * 12 + (b[1] - a[1]);

function monthsRange(hist: Map<string, [Date, Level][]>): YM[] {
    let mn = Infinity, mx = -Infinity;
    for (const hs of hist.values()) {
        if (!hs.length) continue;
        mn = Math.min(mn, hs[0][0].getTime());
        mx = Math.max(mx, hs[hs.length - 1][0].getTime());
    }
    if (!isFinite(mn)) return [];
    const a = new Date(mn), b = new Date(mx);
    const out: YM[] = [];
    let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1;
    while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth() + 1)) {
        out.push([y, m]);
        m += 1; if (m === 13) { y += 1; m = 1; }
    }
    return out;
}

export interface LevelCount { mes: string; y: number; m: number; nivel: Level; n: number }
export interface LevelFlow { mes: string; y: number; m: number; promos: number; demos: number; neto: number }

export function levelMovement(am: AgentMaps) {
    const months = monthsRange(am.hist);
    // conteo por nivel por mes (forward-fill; ~92% coincide con el nivel vivo)
    const cnt = new Map<string, Record<Level, number>>();
    for (const mo of months) cnt.set(ymKey(mo), { standard: 0, professional: 0, elite: 0 });
    for (const hs of am.hist.values()) {
        let i = 0, cur: Level | null = null;
        for (const mo of months) {
            while (i < hs.length && (hs[i][0].getUTCFullYear() < mo[0]
                || (hs[i][0].getUTCFullYear() === mo[0] && hs[i][0].getUTCMonth() + 1 <= mo[1]))) {
                cur = hs[i][1]; i += 1;
            }
            if (cur) cnt.get(ymKey(mo))![cur] += 1;
        }
    }
    // transiciones por corte
    const up = new Map<string, number>(), down = new Map<string, number>();
    const reached = new Map<string, Record<string, number>>(), left = new Map<string, Record<string, number>>();
    for (const hs of am.hist.values()) {
        let prev: Level | null = null;
        for (const [ts, l] of hs) {
            const k = ymKey([ts.getUTCFullYear(), ts.getUTCMonth() + 1]);
            if (prev) {
                if (ORDER[l] > ORDER[prev]) {
                    up.set(k, (up.get(k) ?? 0) + 1);
                    const r = reached.get(k) ?? {}; r[l] = (r[l] ?? 0) + 1; reached.set(k, r);
                } else if (ORDER[l] < ORDER[prev]) {
                    down.set(k, (down.get(k) ?? 0) + 1);
                    const r = left.get(k) ?? {}; r[prev] = (r[prev] ?? 0) + 1; left.set(k, r);
                }
            }
            prev = l;
        }
    }
    const counts: LevelCount[] = [], flow: LevelFlow[] = [];
    const byCorte: Record<string, { promos: number; demos: number; reached: Record<string, number>; left: Record<string, number> }> = {};
    for (const mo of months) {
        const k = ymKey(mo);
        for (const lv of LEVELS) counts.push({ mes: k, y: mo[0], m: mo[1], nivel: lv, n: cnt.get(k)![lv] });
        const u = up.get(k) ?? 0, d = down.get(k) ?? 0;
        flow.push({ mes: k, y: mo[0], m: mo[1], promos: u, demos: -d, neto: u - d });
        byCorte[k] = { promos: u, demos: d, reached: reached.get(k) ?? {}, left: left.get(k) ?? {} };
    }
    return { counts, flow, byCorte, months };
}

// ── salón de la fama ───────────────────────────────────────────────
export interface EliteStreak { months: number; name: string; company: string | null; start: YM; end: YM | null }
export interface Revolving { stints: number; name: string; company: string | null; vigente: boolean }

/**
 * Rachas élite por intervalos reales entre transiciones, no forward-fill ciego.
 * ⚠️ levelHistory está incompleto: a veces la última transición dice élite pero agents.level
 * ya no lo es (bajada no registrada). Regla: una racha vigente sólo cuenta si el nivel VIVO
 * es élite; si el historial deja una racha abierta y el vivo no coincide, se descarta.
 */
export function hallOfFame(am: AgentMaps) {
    const months = monthsRange(am.hist);
    if (!months.length) return { vigentes: [], historicos: [], revolving: [] };
    const now = months[months.length - 1];
    const nowNext: YM = [now[0] + Math.floor(now[1] / 12), (now[1] % 12) + 1];
    const vigentes: EliteStreak[] = [], historicos: EliteStreak[] = [], revolving: Revolving[] = [];

    for (const [e, hs] of am.hist) {
        if (!hs.length) continue;
        const closed: [YM, YM, number][] = [];
        let start: YM | null = null, prev: Level | null = null;
        for (const [ts, l] of hs) {
            const ym: YM = [ts.getUTCFullYear(), ts.getUTCMonth() + 1];
            if (l === 'elite' && prev !== 'elite') start = ym;
            if (l !== 'elite' && prev === 'elite' && start) { closed.push([start, ym, mdiff(start, ym)]); start = null; }
            prev = l;
        }
        const nm = am.name.get(e) ?? '?', co = am.company.get(e) ?? null;
        if (prev === 'elite' && start && am.level.get(e) === 'elite') {
            vigentes.push({ months: mdiff(start, nowNext), name: nm, company: co, start, end: null });
        }
        for (const [s, en, mo] of closed) {
            if (mo > 12) historicos.push({ months: mo, name: nm, company: co, start: s, end: en });
        }
        let stints = 0; prev = null;
        for (const [, l] of hs) { if (l === 'elite' && prev !== 'elite') stints += 1; prev = l; }
        if (stints >= 2) revolving.push({ stints, name: nm, company: co, vigente: am.level.get(e) === 'elite' });
    }
    vigentes.sort((a, b) => b.months - a.months);
    historicos.sort((a, b) => b.months - a.months);
    revolving.sort((a, b) => b.stints - a.stints);
    return { vigentes, historicos, revolving };
}

// ── récords de venta ───────────────────────────────────────────────
export interface RecordSale { value: number; company: string | null; when: Date | null; asesor: string; comision: number }

export async function recordSales(top = 10, meta?: Map<string, CompanyMeta>, am?: AgentMaps): Promise<RecordSale[]> {
    const db = await getDb();
    const pulppo = am?.pulppo ?? new Set<string>();
    const out: RecordSale[] = [];
    const cur = db.collection('operations').find(
        { 'status.last': { $in: ['closed', 'paying'] }, 'closeValue.value': { $gt: 0 } },
        {
            projection: {
                id: 1, closeValue: 1, closedAt: 1, 'company._id': 1, 'company.name': 1,
                'comission.value': 1, 'property.listing.operation': 1,
                'buyer.broker.email': 1, 'seller.broker.email': 1, 'property.agent.email': 1,
            },
        },
    ).sort({ 'closeValue.value': -1 }).limit(400);

    for await (const op of cur) {
        const co = (op.company as Document) ?? {};
        if (isDemo(co.name as string) || isTuhabi(meta, String(co._id))) continue;
        if ((((op.property as Document) ?? {}).listing as Document ?? {})?.operation === 'rent') continue;
        const com = Number(((op.comission as Document) ?? {}).value ?? 0) || 0;
        let asesor = '—', aseCom = 0;
        if (pulppo.size) {
            const sp = splitByRole(op, com, pulppo);
            if (sp.size) {
                const [te, tv] = [...sp.entries()].sort((a, b) => b[1] - a[1])[0];
                asesor = am?.name.get(te) ?? te; aseCom = tv;
            }
        }
        out.push({
            value: Number(((op.closeValue as Document) ?? {}).value ?? 0) || 0,
            company: (co.name as string) ?? null,
            when: isDate(op.closedAt) ? (op.closedAt as Date) : null,
            asesor, comision: aseCom,
        });
        if (out.length >= top) break;
    }
    return out;
}

// ── carrera (acumulado del año) ────────────────────────────────────
const NM = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export interface RaceRow { mes: string; mesI: number; rank: number; label: string; value: number }

export async function raceFrames(
    year: number, metric: Metric, meta: Map<string, CompanyMeta>, am: AgentMaps,
    upToMonth: number, entity: 'company' | 'broker' = 'company', n = 10,
): Promise<{ rows: RaceRow[]; frames: string[] }> {
    const monthly = new Map<number, Map<string, [string, number]>>();
    for (let m = 1; m <= upToMonth; m++) {
        const f = new Map<string, [string, number]>();
        if (entity === 'company') {
            for (const [cid, r] of await companyValueByMonth(year, m, metric, meta)) f.set(cid, [r.name ?? '?', r.value]);
        } else {
            const { acc } = await brokerValueByMonth(year, m, metric, am.pulppo, meta);
            for (const [e, v] of acc) f.set(e, [am.name.get(e) ?? '?', v]);
        }
        monthly.set(m, f);
    }
    const cum = new Map<string, number>(), labels = new Map<string, string>();
    const rows: RaceRow[] = [];
    for (let m = 1; m <= upToMonth; m++) {
        for (const [k, [lab, v]] of monthly.get(m)!) {
            cum.set(k, (cum.get(k) ?? 0) + v); labels.set(k, lab);
        }
        const snap = [...cum.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
        snap.forEach(([k, v], i) => rows.push({ mes: NM[m - 1], mesI: m, rank: i + 1, label: labels.get(k)!, value: v }));
    }
    return { rows, frames: Array.from({ length: upToMonth }, (_, i) => NM[i]) };
}

// ── payload para la UI ─────────────────────────────────────────────
export interface PlusData {
    year: number; month: number; metric: Metric;
    general: CompanyRow[]; onboarding: CompanyRow[];
    brokers: Record<Level, BrokerRow[]>;
    newElite: { name: string; company: string | null }[];
    newPro: { name: string; company: string | null }[];
    counts: LevelCount[]; flow: LevelFlow[];
    corte: { promos: number; demos: number; reached: Record<string, number>; left: Record<string, number> } | null;
    vigentes: EliteStreak[]; historicos: EliteStreak[]; revolving: Revolving[];
    records: RecordSale[];
    race: RaceRow[]; raceFrames: string[];
}

export async function fetchPlus(year: number, month: number, metric: Metric = 'cobrada'): Promise<PlusData> {
    const [am, meta] = await Promise.all([agentMaps(), companyMetaMap()]);
    const mov = levelMovement(am);
    const hof = hallOfFame(am);
    const [general, onboarding, brokers, records, race] = await Promise.all([
        topCompanies(year, month, metric, meta, false, 10),
        topCompanies(year, month, metric, meta, true, 10),
        topBrokersByLevel(year, month, metric, am, meta, 3),
        recordSales(10, meta, am),
        raceFrames(year, metric, meta, am, month, 'company', 10),
    ]);
    return {
        year, month, metric, general, onboarding, brokers,
        newElite: newAtLevel(year, month, 'elite', am),
        newPro: newAtLevel(year, month, 'professional', am),
        counts: mov.counts, flow: mov.flow,
        corte: mov.byCorte[ymKey([year + Math.floor(month / 12), (month % 12) + 1])] ?? null,
        vigentes: hof.vigentes, historicos: hof.historicos, revolving: hof.revolving,
        records, race: race.rows, raceFrames: race.frames,
    };
}
