// Premios Pulppo del año — acumulado en vivo, SIEMPRE con comisión COBRADA (decisión de Ale,
// oct-2026). Lo muestra /plus → Salón de la fama. Port de `Pulppo Plus/scripts/premios_2026.py`.
//
// Reglas acordadas:
//   · Cobrada = payments[].comission.value por fecha de captura, con la excepción de 1–2 días
//     después del cierre (cuenta en el mes del cierre) → paymentDate() de plus.ts.
//   · Fuera TuHabi (domain.host) y demos/pruebas (Inmobiliaria Demo, tu360…).
//   · Inmobiliarias agrupadas por NOMBRE normalizado: Mongo tiene la misma marca en varios
//     registros (Quatre ×2, Grupo ADA ×4) y el premio es de la marca.
//   · Brokers: split por rol (splitByRole) y cada peso cuenta en el nivel que el asesor tenía
//     el mes del pago. Top 5 por nivel. Broker del año = #1 de élite.
//   · Ticket = valor promedio de lo VENDIDO (closeValue, sólo venta) en operaciones con cobro
//     en el año; mínimo 5 ventas.
//   · Mejor desempeño = puntaje compuesto: percentil en 4 ejes al 25% — comisión cobrada,
//     crecimiento vs mismo periodo del año anterior, conversión lead→cierre (cohorte por
//     contacto) y visitas por lead. Sólo inmobiliarias con ≥200 leads y ≥5 operaciones cobradas.
//   · Insignias = las ganadas en el año (fecha en agents.badges), sin 'academy' (la tiene el 90%
//     de la red y no distingue). Desempate por rareza.
//   · Nuevos profesionales / élite = TODOS los que llegaron por primera vez con un corte del año.
import { type Document } from 'mongodb';
import { getDb } from './data';
import { agentMaps, isDemo, paymentDate, splitByRole, type Level } from './plus';

const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const ORD: Record<string, number> = { standard: 1, professional: 2, elite: 3 };
const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface PremioInmo { name: string; value: number; nops: number; onboarding: boolean; extra?: Record<string, number | null> }
export interface PremioBroker { name: string; company: string | null; photo: string | null; value: number; nops: number; levelHoy: string | null }
export interface PremioInsignias { name: string; company: string | null; photo: string | null; n: number; cuales: string[] }
export interface PremioNuevo { name: string; company: string | null; photo: string | null; mes: string; sigue: boolean }
export interface Premios {
    year: number; hasta: string;
    inmoDelAño: PremioInmo[];
    ticket: PremioInmo[];
    desempeño: PremioInmo[];
    brokers: Record<Level, PremioBroker[]>;
    brokerDelAño: PremioBroker | null;
    insignias: PremioInsignias[];
    nuevosPro: PremioNuevo[];
    nuevosElite: PremioNuevo[];
    pendiente: { name: string; porCobrar: number }[];   // cerrado en el año y todavía sin cobrar (aviso)
}

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const BADGE_LBL: Record<string, string> = {
    'first-sale': 'Primera venta', 'first-rent': 'Primera renta', exclusive: 'Exclusiva', '20-millions': '20 millones',
    '50-millions': '50 millones', '100-millions': '100 millones', '100-visits': '100 visitas', 'sale-shared': 'Venta compartida',
    '3-months-sale': '3 meses vendiendo', '6-months-sale': '6 meses vendiendo', '12-months-sale': '12 meses vendiendo',
    '3-months-rent': '3 meses rentando', '6-months-rent': '6 meses rentando', '12-months-rent': '12 meses rentando',
};

/** Nivel durante el mes (0-11) de `year`: el corte con timestamp día 1 del mes M fija el nivel de M. */
function levelAt(hist: [Date, Level][] | undefined, vivo: string | null | undefined, year: number, m0: number): string | null {
    const ref = Date.UTC(year, m0, 1, 12);
    let lv: string | null = null;
    for (const [ts, l] of hist ?? []) if (ts.getTime() <= ref) lv = l;
    return lv ?? (hist?.[0]?.[1] ?? vivo ?? null);
}

export async function fetchPremios(year: number): Promise<Premios> {
    const db = await getDb();
    const am = await agentMaps();
    const INI = new Date(Date.UTC(year, 0, 1)), FIN = new Date(Date.UTC(year + 1, 0, 1));
    const hoy = new Date();
    // mismo periodo del año anterior, para el crecimiento
    const finPrev = hoy.getUTCFullYear() === year ? new Date(Date.UTC(year - 1, hoy.getUTCMonth(), hoy.getUTCDate())) : INI;
    const iniPrev = new Date(Date.UTC(year - 1, 0, 1));

    // ── compañías → marca ──
    const comp = new Map<string, { brand: string; name: string; out: boolean; onb: boolean }>();
    const brandName = new Map<string, string>();
    for await (const c of db.collection('companies').find({}, { projection: { name: 1, 'domain.host': 1, integratedAt: 1 } })) {
        const name = String(c.name ?? '').trim();
        const host = String(((c.domain as Document) ?? {}).host ?? '').toLowerCase();
        const brand = norm(name);
        comp.set(String(c._id), { brand, name, out: host.includes('tuhabi') || isDemo(name) || !brand, onb: !isDate(c.integratedAt) });
        if (brand && !brandName.has(brand)) brandName.set(brand, name);
    }
    const brandOf = (co: Document | undefined) => {
        const c = comp.get(String(co?._id));
        if (c) return c;
        const name = String(co?.name ?? '');
        return { brand: norm(name), name, out: isDemo(name) || !norm(name), onb: false };
    };

    // ── agentes: compañía (para leads/visitas) e insignias ──
    const agentBrand = new Map<string, string>();
    const badges = new Map<string, Record<string, unknown>>();
    for await (const a of db.collection('agents').find({ email: { $exists: true } }, { projection: { email: 1, 'company._id': 1, badges: 1 } })) {
        const c = comp.get(String(((a.company as Document) ?? {})._id));
        if (c && !c.out) agentBrand.set(a.email as string, c.brand);
        if (a.badges && typeof a.badges === 'object') badges.set(a.email as string, a.badges as Record<string, unknown>);
    }

    // ── operaciones: un solo barrido de las que tienen pagos ──
    type Acc = { cobrada: number; pend: number; ops: Set<string>; ventas: number[]; onb: boolean; prev: number };
    const inmo = new Map<string, Acc>();
    const get = (k: string) => {
        let r = inmo.get(k);
        if (!r) { r = { cobrada: 0, pend: 0, ops: new Set(), ventas: [], onb: false, prev: 0 }; inmo.set(k, r); }
        return r;
    };
    const bro: Record<string, Map<string, { v: number; ops: Set<string> }>> = { standard: new Map(), professional: new Map(), elite: new Map() };
    const cur = db.collection('operations').find(
        { 'payments.0': { $exists: true }, $or: [{ 'payments.createdAt': { $gte: iniPrev } }, { closedAt: { $gte: iniPrev } }] },
        { projection: {
            id: 1, company: 1, closedAt: 1, 'status.last': 1, 'comission.value': 1, 'closeValue.value': 1, payments: 1,
            'property.listing.operation': 1, 'buyer.broker.email': 1, 'seller.broker.email': 1, 'property.agent.email': 1,
        } });
    for await (const o of cur) {
        const c = brandOf(o.company as Document);
        if (c.out) continue;
        const r = get(c.brand);
        if (c.onb) r.onb = true;
        const ca = o.closedAt;
        const st = String(((o.status as Document) ?? {}).last ?? '');
        // Por cobrar: comisión de lo cerrado en el año menos TODO lo pagado de esa operación.
        if (isDate(ca) && ca >= INI && ca < FIN && ['closed', 'paying'].includes(st)) {
            const pagado = ((o.payments as Document[]) ?? []).reduce((a, p) => a + (Number(((p.comission as Document) ?? {}).value ?? 0) || 0), 0);
            r.pend += Math.max(0, (Number(((o.comission as Document) ?? {}).value ?? 0) || 0) - pagado);
        }
        let cobrado = 0;
        for (const p of (o.payments as Document[]) ?? []) {
            const d = paymentDate(p, ca);
            if (!d) continue;
            const v = Number(((p.comission as Document) ?? {}).value ?? 0) || 0;
            if (d >= iniPrev && d < finPrev) r.prev += v;
            if (d < INI || d >= FIN) continue;
            cobrado += v;
            for (const [e, part] of splitByRole(o, v, am.pulppo)) {
                const lv = levelAt(am.hist.get(e), am.level.get(e), year, d.getUTCMonth());
                if (!lv || !(lv in bro)) continue;
                const b = bro[lv].get(e) ?? { v: 0, ops: new Set<string>() };
                b.v += part; b.ops.add(String(o.id)); bro[lv].set(e, b);
            }
        }
        if (cobrado > 0) {
            r.cobrada += cobrado; r.ops.add(String(o.id));
            const cv = Number(((o.closeValue as Document) ?? {}).value ?? 0) || 0;
            const oper = (((o.property as Document) ?? {}).listing as Document ?? {})?.operation;
            if (oper === 'sale' && cv > 0) r.ventas.push(cv);
        }
    }

    // ── funnel: leads del año → visitas → cierres (cohorte por contacto) ──
    const leadsN = new Map<string, number>();
    const leadsC = new Map<string, Set<string>>();
    for await (const l of db.collection('leads').find({ createdAt: { $gte: INI, $lt: FIN } }, { projection: { 'agent.uid': 1, 'contact._id': 1 } })) {
        const e = am.uidEmail.get(String(((l.agent as Document) ?? {}).uid ?? ''));
        const k = e ? agentBrand.get(e) : undefined;
        if (!k) continue;
        leadsN.set(k, (leadsN.get(k) ?? 0) + 1);
        const cid = ((l.contact as Document) ?? {})._id;
        if (cid) { const s = leadsC.get(k) ?? new Set<string>(); s.add(String(cid)); leadsC.set(k, s); }
    }
    const visN = new Map<string, number>();
    for await (const v of db.collection('visits').find({ createdAt: { $gte: INI, $lt: FIN }, 'status.last': { $ne: 'cancelled' } }, { projection: { 'agent.email': 1 } })) {
        const k = agentBrand.get(String(((v.agent as Document) ?? {}).email ?? ''));
        if (k) visN.set(k, (visN.get(k) ?? 0) + 1);
    }
    const cerr = new Map<string, Set<string>>();
    for await (const o of db.collection('operations').find(
        { closedAt: { $gte: INI, $lt: FIN }, 'status.last': { $in: ['closed', 'paying'] } },
        { projection: { 'buyer.contact._id': 1, 'buyer.broker.email': 1 } })) {
        const b = (o.buyer as Document) ?? {};
        const k = agentBrand.get(String(((b.broker as Document) ?? {}).email ?? ''));
        const cid = ((b.contact as Document) ?? {})._id;
        if (k && cid && leadsC.get(k)?.has(String(cid))) { const s = cerr.get(k) ?? new Set<string>(); s.add(String(cid)); cerr.set(k, s); }
    }

    // ── armado ──
    const rows = [...inmo.entries()].filter(([, r]) => r.cobrada > 0).map(([k, r]) => {
        const leads = leadsN.get(k) ?? 0, contactos = leadsC.get(k)?.size ?? 0;
        return {
            k, name: brandName.get(k) ?? k, r,
            crec: r.prev > 0 ? r.cobrada / r.prev - 1 : null,
            conv: contactos ? (cerr.get(k)?.size ?? 0) / contactos : null,
            vpl: leads ? (visN.get(k) ?? 0) / leads : null,
            leads,
        };
    });
    const asInmo = (x: (typeof rows)[number], extra?: Record<string, number | null>): PremioInmo =>
        ({ name: x.name, value: x.r.cobrada, nops: x.r.ops.size, onboarding: x.r.onb, extra });

    const inmoDelAño = [...rows].sort((a, b) => b.r.cobrada - a.r.cobrada).slice(0, 5).map((x) => asInmo(x));
    const ticket = rows.filter((x) => x.r.ventas.length >= 5)
        .map((x) => ({ x, avg: x.r.ventas.reduce((a, b) => a + b, 0) / x.r.ventas.length }))
        .sort((a, b) => b.avg - a.avg).slice(0, 5)
        .map(({ x, avg }) => ({ ...asInmo(x, { ventas: x.r.ventas.length }), value: avg }));

    // percentil dentro de las elegibles; un null cuenta como el peor
    const elig = rows.filter((x) => x.leads >= 200 && x.r.ops.size >= 5);
    const pct = (vals: (number | null)[]) => {
        const ok = vals.map((v, i) => [v ?? -Infinity, i] as [number, number]).sort((a, b) => a[0] - b[0]);
        const out = new Array(vals.length).fill(0);
        ok.forEach(([, i], j) => { out[i] = vals[i] == null ? 0 : (100 * (j + 1)) / ok.length; });
        return out as number[];
    };
    const p1 = pct(elig.map((x) => x.r.cobrada)), p2 = pct(elig.map((x) => x.crec)),
        p3 = pct(elig.map((x) => x.conv)), p4 = pct(elig.map((x) => x.vpl));
    const desempeño = elig.map((x, i) => ({ x, score: (p1[i] + p2[i] + p3[i] + p4[i]) / 4 }))
        .sort((a, b) => b.score - a.score).slice(0, 5)
        .map(({ x, score }) => asInmo(x, { puntaje: score, crecimiento: x.crec, conversion: x.conv, visitasPorLead: x.vpl }));

    const brokers = { standard: [], professional: [], elite: [] } as Record<Level, PremioBroker[]>;
    for (const lv of ['elite', 'professional', 'standard'] as Level[]) {
        brokers[lv] = [...bro[lv].entries()]
            .filter(([e]) => !isDemo(am.company.get(e)))
            .sort((a, b) => b[1].v - a[1].v).slice(0, 5)
            .map(([e, b]) => ({ name: am.name.get(e) ?? e, company: am.company.get(e) ?? null, photo: am.photo.get(e) ?? null,
                value: b.v, nops: b.ops.size, levelHoy: am.level.get(e) ?? null }));
    }

    // insignias del año
    const freq = new Map<string, number>();
    for (const bs of badges.values()) for (const k of Object.keys(bs)) freq.set(k, (freq.get(k) ?? 0) + 1);
    const insignias = [...badges.entries()].map(([e, bs]) => {
        const gan = Object.entries(bs).filter(([k, v]) => k !== 'academy' && isDate(v) && v >= INI && v < FIN).map(([k]) => k);
        return { e, gan, rare: gan.reduce((a, k) => a + 1000 / (freq.get(k) ?? 1), 0) };
    }).filter((x) => x.gan.length && !isDemo(am.company.get(x.e)))
        .sort((a, b) => b.gan.length - a.gan.length || b.rare - a.rare).slice(0, 5)
        .map(({ e, gan }) => ({ name: am.name.get(e) ?? e, company: am.company.get(e) ?? null, photo: am.photo.get(e) ?? null,
            n: gan.length, cuales: gan.sort((a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0)).map((k) => BADGE_LBL[k] ?? k) }));

    // nuevos: primera vez en el nivel con un corte del año (feb-año … ene-año+1 = desempeño ene–dic)
    const nuevos = (level: Level): PremioNuevo[] => {
        const lo = Date.UTC(year, 0, 31), hi = Date.UTC(year + 1, 0, 2);
        const out: (PremioNuevo & { ts: number })[] = [];
        for (const [e, hs] of am.hist) {
            if (isDemo(am.company.get(e))) continue;
            const antes = hs.some(([ts, l]) => ORD[l] >= ORD[level] && ts.getTime() < lo);
            const llega = hs.filter(([ts, l]) => ORD[l] >= ORD[level] && ts.getTime() >= lo && ts.getTime() < hi);
            if (antes || !llega.length) continue;
            const ts = llega[0][0].getTime();
            const m = new Date(ts - 86_400_000);
            out.push({ name: am.name.get(e) ?? e, company: am.company.get(e) ?? null, photo: am.photo.get(e) ?? null,
                mes: MES[m.getUTCMonth()], sigue: (ORD[am.level.get(e) ?? ''] ?? 0) >= ORD[level], ts });
        }
        return out.sort((a, b) => a.ts - b.ts).map(({ ts: _ts, ...r }) => r);
    };

    const pendiente = rows.filter((x) => x.r.pend > 250_000).sort((a, b) => b.r.pend - a.r.pend).slice(0, 5)
        .map((x) => ({ name: x.name, porCobrar: x.r.pend }));

    const h = hoy < FIN ? hoy : new Date(FIN.getTime() - 1);
    return {
        year, hasta: `${h.getUTCDate()} de ${MES[h.getUTCMonth()]} ${h.getUTCFullYear()}`,
        inmoDelAño, ticket, desempeño, brokers, brokerDelAño: brokers.elite[0] ?? null,
        insignias, nuevosPro: nuevos('professional'), nuevosElite: nuevos('elite'), pendiente,
    };
}
