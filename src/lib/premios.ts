// Premios Pulppo del año — acumulado en vivo, SIEMPRE con comisión COBRADA (decisión de Ale,
// oct-2026). Lo muestra /plus → Salón de la fama. Port de `Pulppo Plus/scripts/premios_2026.py`.
//
// Reglas acordadas con Ale:
//   · Cobrada = payments[].comission.value por fecha de captura, con la excepción de 1–2 días
//     después del cierre (cuenta en el mes del cierre) → paymentDate() de plus.ts.
//   · Fuera TuHabi (domain.host) y demos/pruebas (Inmobiliaria Demo, tu360…).
//   · Inmobiliarias agrupadas por NOMBRE normalizado: Mongo tiene la misma marca en varios
//     registros (Quatre ×2, Grupo ADA ×4) y el premio es de la marca.
//   · Brokers: split por rol (splitByRole). Compiten en el NIVEL QUE TIENEN HOY con todo lo
//     cobrado en el año (Mercedes Rivas es élite hoy → compite en élite aunque cobró siendo
//     profesional). Top 5 por nivel. Broker del año = #1 de élite.
//   · Mínimos para premios de tasa (para que no gane quien tuvo 3 leads y 1 cierre): ver MIN_*.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { agentMaps, hallOfFame, isDemo, paymentDate, splitByRole, type Level } from './plus';
import { ORDEN_INMOBILIARIAS } from './portales/ordenInmobiliarias';

const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const ORD: Record<string, number> = { standard: 1, professional: 2, elite: 3 };
const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v: unknown) => Number(v ?? 0) || 0;
const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const MIN_LEADS_INMO = 200;     // tasa de visita, lead→cierre y desempeño de inmobiliarias
const MIN_LEADS_BROKER = 100;   // lead→cierre por asesor
const MIN_RESP_BROKER = 50;     // leads respondidos para "respuesta relámpago"
const MIN_PROPS_CALIDAD = 30;   // inventario publicado para "mejor calidad de inventario"
const MIN_VENTAS_TICKET = 5;
const MIN_VALOR_RAPIDA = 2_000_000;  // venta más rápida: sin terrenos ni tickets chicos (decisión de Ale)

// Un lugar en un podio. `value` es la métrica principal (formateada según `fmt`); `sub` va en chico.
export interface Lugar { name: string; company?: string | null; photo?: string | null; value: number; fmt: 'money' | 'pct' | 'int' | 'dias' | 'min' | 'score'; sub?: string; nota?: string }
export interface PremioNuevo { email: string; name: string; company: string | null; photo: string | null; mes: string; sigue: boolean; levelHoy: string | null }
export interface Premios {
    year: number; hasta: string;
    inmoDelAño: Lugar[]; brokerDelAño: Lugar | null;
    brokers: Record<Level, Lugar[]>;
    // inmobiliarias
    desempeño: Lugar[]; ticket: Lugar[]; nuevasInmo: Lugar[]; tasaVisita: Lugar[]; calidad: Lugar[];
    conjunto: Lugar[];          // pares de inmobiliarias con más operaciones juntas
    // asesores
    insignias: Lugar[]; racha: Lugar[]; revelacion: Lugar[]; relampago: Lugar[]; leadCierre: Lugar[];
    captador: Lugar[]; rentas: Lugar[];
    // récords
    ventaMayor: Lugar[]; ventaRapida: Lugar[];
    nuevosPro: PremioNuevo[]; nuevosElite: PremioNuevo[];
    pendiente: { name: string; porCobrar: number }[];
}

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LVL_LBL: Record<string, string> = { standard: 'Estándar', professional: 'Profesional', elite: 'Élite' };
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

/** Clientes vigentes = la lista canónica de las 102 inmobiliarias (`_lista.txt`, copiada en
 *  lib/portales/ordenInmobiliarias.ts). `companies.status` en Mongo NO basta: Círculo Bienes
 *  Raíces ya es baja y en la base sigue 'active' con 25 asesores activos. Si entra o sale una
 *  inmobiliaria, se actualiza esa lista (no este archivo). */
// De las que "no se quedan" en la lista, Ale saca de los premios sólo estas (oct-2026); las demás
// siguen contando mientras sean clientes.
const FUERA_DE_PREMIOS = ['Adamá Bienes Raíces', 'Zam Inmobiliaria'].map(norm);
const VIGENTES = new Set(ORDEN_INMOBILIARIAS.map((x) => norm(x.nombre)).filter((k) => !FUERA_DE_PREMIOS.includes(k)));
export const esVigente = (nombreInmobiliaria: string | null | undefined) => VIGENTES.has(norm(nombreInmobiliaria));

/** Emails de asesores que NO cuentan: su cuenta está `inactive`, su inmobiliaria está de baja en
 *  Mongo (`companies.status = 'inactive'`) o su inmobiliaria no está entre las vigentes. */
export async function asesoresDeBaja(): Promise<Set<string>> {
    const db = await getDb();
    const inact = new Set((await db.collection('companies').find({ status: 'inactive' }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));
    const out = new Set<string>();
    for await (const a of db.collection('agents').find({ email: { $exists: true } }, { projection: { email: 1, status: 1, 'company._id': 1, 'company.name': 1 } })) {
        const co = (a.company as Document) ?? {};
        if (a.status === 'inactive' || inact.has(String(co._id)) || !esVigente(co.name as string)) out.add(a.email as string);
    }
    return out;
}

/** Asesores que llegaron POR PRIMERA VEZ a `level` (o más arriba) con un corte del año. Los cortes
 *  feb-año … ene-año+1 son el desempeño de ene–dic. Lo usan los premios y /plus → Ascensos.
 *  `bajas` (opcional) los saca de la lista: ver asesoresDeBaja(). */
export function nuevosDelAño(am: Awaited<ReturnType<typeof agentMaps>>, year: number, level: Level, bajas?: Set<string>): PremioNuevo[] {
    const lo = Date.UTC(year, 0, 31), hi = Date.UTC(year + 1, 0, 2);
    const out: (PremioNuevo & { ts: number })[] = [];
    for (const [e, hs] of am.hist) {
        if (isDemo(am.company.get(e)) || bajas?.has(e)) continue;
        const antes = hs.some(([ts, l]) => ORD[l] >= ORD[level] && ts.getTime() < lo);
        const llega = hs.filter(([ts, l]) => ORD[l] >= ORD[level] && ts.getTime() >= lo && ts.getTime() < hi);
        if (antes || !llega.length) continue;
        const ts = llega[0][0].getTime();
        const hoy = am.level.get(e) ?? null;
        out.push({ email: e, name: am.name.get(e) ?? e, company: am.company.get(e) ?? null, photo: am.photo.get(e) ?? null,
            mes: MES[new Date(ts - 86_400_000).getUTCMonth()], sigue: (ORD[hoy ?? ''] ?? 0) >= ORD[level], levelHoy: hoy, ts });
    }
    return out.sort((a, b) => a.ts - b.ts).map(({ ts: _ts, ...r }) => r);
}

export async function fetchPremios(year: number): Promise<Premios> {
    const db = await getDb();
    const [am, bajas] = await Promise.all([agentMaps(), asesoresDeBaja()]);
    const INI = new Date(Date.UTC(year, 0, 1)), FIN = new Date(Date.UTC(year + 1, 0, 1));
    const hoy = new Date();
    const finPrev = hoy.getUTCFullYear() === year ? new Date(Date.UTC(year - 1, hoy.getUTCMonth(), hoy.getUTCDate())) : INI;
    const iniPrev = new Date(Date.UTC(year - 1, 0, 1));
    const persona = (e: string) => ({ name: am.name.get(e) ?? e, company: am.company.get(e) ?? null, photo: am.photo.get(e) ?? null });
    // fuera = demo, o asesor de baja / de inmobiliaria de baja (asesoresDeBaja)
    const fuera = (e: string) => isDemo(am.company.get(e)) || bajas.has(e);

    // ── compañías → marca ──
    const comp = new Map<string, { brand: string; name: string; out: boolean; onb: boolean }>();
    const brandName = new Map<string, string>();
    const brandBorn = new Map<string, number>();   // primer registro de la marca (para "nuevas")
    const statusId = new Map<string, 'active' | 'inactive'>();
    for await (const c of db.collection('companies').find({}, { projection: { name: 1, 'domain.host': 1, integratedAt: 1, createdAt: 1, status: 1 } })) {
        const name = String(c.name ?? '').trim();
        const host = String(((c.domain as Document) ?? {}).host ?? '').toLowerCase();
        const brand = norm(name);
        comp.set(String(c._id), { brand, name, out: host.includes('tuhabi') || isDemo(name) || !brand, onb: !isDate(c.integratedAt) });
        if (c.status === 'inactive') statusId.set(String(c._id), 'inactive'); else statusId.set(String(c._id), 'active');
        if (brand && !brandName.has(brand)) brandName.set(brand, name);
        if (brand && isDate(c.createdAt)) brandBorn.set(brand, Math.min(brandBorn.get(brand) ?? Infinity, c.createdAt.getTime()));
    }
    const brandOf = (co: Document | undefined) => {
        const c = comp.get(String(co?._id));
        if (c) return c;
        const name = String(co?.name ?? '');
        return { brand: norm(name), name, out: isDemo(name) || !norm(name), onb: false };
    };

    // ── agentes: marca e insignias ──
    const agentBrand = new Map<string, string>();
    const badges = new Map<string, Record<string, unknown>>();
    const brandFirstAgent = new Map<string, number>();   // cuenta de asesor más vieja de la marca
    // Marca de baja = tiene un registro dado de baja (companies.status='inactive') con asesores y
    // NINGÚN registro activo con asesores. Hace falta mirar asesores porque la misma marca suele
    // tener un registro activo vacío (importado del portal): "Inmuebles Proyecta" activo sin
    // asesores + "Inmuebles proyecta" de baja con los asesores.
    const brandBajaRec = new Set<string>(), brandActivaRec = new Set<string>();
    for await (const a of db.collection('agents').find({ email: { $exists: true } }, { projection: { email: 1, 'company._id': 1, badges: 1, createdAt: 1 } })) {
        const c = comp.get(String(((a.company as Document) ?? {})._id));
        if (c && !c.out) agentBrand.set(a.email as string, c.brand);
        if (c) { const st = statusId.get(String(((a.company as Document) ?? {})._id)); (st === 'inactive' ? brandBajaRec : brandActivaRec).add(c.brand); }
        if (c && isDate(a.createdAt)) brandFirstAgent.set(c.brand, Math.min(brandFirstAgent.get(c.brand) ?? Infinity, a.createdAt.getTime()));
        if (a.badges && typeof a.badges === 'object') badges.set(a.email as string, a.badges as Record<string, unknown>);
    }

    // ── operaciones con pagos: un solo barrido ──
    type Acc = { cobrada: number; pend: number; ops: Set<string>; ventas: number[]; onb: boolean; prev: number };
    const inmo = new Map<string, Acc>();
    const get = (k: string) => {
        let r = inmo.get(k);
        if (!r) { r = { cobrada: 0, pend: 0, ops: new Set(), ventas: [], onb: false, prev: 0 }; inmo.set(k, r); }
        return r;
    };
    const bro = new Map<string, { v: number; ops: Set<string>; rentas: Set<string> }>();
    const pares = new Map<string, Set<string>>();
    const ventas: { v: number; brand: string; e: string | null; id: string }[] = [];
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
        const pagos = (o.payments as Document[]) ?? [];
        // Por cobrar: comisión de lo cerrado en el año menos TODO lo pagado de esa operación.
        if (isDate(ca) && ca >= INI && ca < FIN && ['closed', 'paying'].includes(st)) {
            const pagado = pagos.reduce((a, p) => a + num(((p.comission as Document) ?? {}).value), 0);
            r.pend += Math.max(0, num(((o.comission as Document) ?? {}).value) - pagado);
        }
        let cobrado = 0;
        const parte = new Map<string, number>();
        for (const p of pagos) {
            const d = paymentDate(p, ca);
            if (!d) continue;
            const v = num(((p.comission as Document) ?? {}).value);
            if (d >= iniPrev && d < finPrev) r.prev += v;
            if (d < INI || d >= FIN) continue;
            cobrado += v;
            for (const [e, x] of splitByRole(o, v, am.pulppo)) parte.set(e, (parte.get(e) ?? 0) + x);
        }
        if (cobrado <= 0) continue;
        const id = String(o.id);
        r.cobrada += cobrado; r.ops.add(id);
        const oper = (((o.property as Document) ?? {}).listing as Document ?? {})?.operation;
        for (const [e, x] of parte) {
            const b = bro.get(e) ?? { v: 0, ops: new Set<string>(), rentas: new Set<string>() };
            b.v += x; b.ops.add(id); if (oper === 'rent') b.rentas.add(id);
            bro.set(e, b);
        }
        const cv = num(((o.closeValue as Document) ?? {}).value);
        if (oper === 'sale' && cv > 0) {
            r.ventas.push(cv);
            const top = [...parte.entries()].sort((a, b) => b[1] - a[1])[0];
            ventas.push({ v: cv, brand: c.brand, e: top?.[0] ?? null, id });
        }
        // operaciones entre dos inmobiliarias de la red (un lado cada una)
        const bb = agentBrand.get(String((((o.buyer as Document) ?? {}).broker as Document ?? {})?.email ?? ''));
        const sb = agentBrand.get(String((((o.seller as Document) ?? {}).broker as Document ?? {})?.email ?? ''));
        if (bb && sb && bb !== sb) {
            const k = [bb, sb].sort().join('|');
            const s = pares.get(k) ?? new Set<string>(); s.add(id); pares.set(k, s);
        }
    }

    // ── leads del año: funnel por inmobiliaria y por asesor + tiempos de respuesta ──
    const leadsN = new Map<string, number>();
    const leadsC = new Map<string, Set<string>>();          // marca → contactos
    const leadsCA = new Map<string, Set<string>>();         // asesor → contactos
    const leadsNA = new Map<string, number>();
    const resp = new Map<string, number[]>();               // asesor → minutos de respuesta
    for await (const l of db.collection('leads').find({ createdAt: { $gte: INI, $lt: FIN } },
        { projection: { 'agent.uid': 1, 'contact._id': 1, createdAt: 1, answeredAt: 1 } })) {
        const e = am.uidEmail.get(String(((l.agent as Document) ?? {}).uid ?? ''));
        if (!e) continue;
        const cid = ((l.contact as Document) ?? {})._id;
        leadsNA.set(e, (leadsNA.get(e) ?? 0) + 1);
        if (cid) { const s = leadsCA.get(e) ?? new Set<string>(); s.add(String(cid)); leadsCA.set(e, s); }
        // Respuestas en menos de 10 s son automáticas (6% de los leads, medido oct-2026): con
        // ellas el ranking lo ganaba quien tiene el bot prendido, con medianas de 0 minutos.
        if (isDate(l.answeredAt) && isDate(l.createdAt) && l.answeredAt.getTime() - l.createdAt.getTime() >= 10_000) {
            const xs = resp.get(e) ?? []; xs.push((l.answeredAt.getTime() - l.createdAt.getTime()) / 60000); resp.set(e, xs);
        }
        const k = agentBrand.get(e);
        if (!k) continue;
        leadsN.set(k, (leadsN.get(k) ?? 0) + 1);
        if (cid) { const s = leadsC.get(k) ?? new Set<string>(); s.add(String(cid)); leadsC.set(k, s); }
    }
    // visitas: total por marca y cohorte (contacto con lead que llegó a visita con la misma marca)
    const visN = new Map<string, number>();
    const visC = new Map<string, Set<string>>();
    for await (const v of db.collection('visits').find({ createdAt: { $gte: INI, $lt: FIN }, 'status.last': { $ne: 'cancelled' } },
        { projection: { 'agent.email': 1, 'contact._id': 1 } })) {
        const k = agentBrand.get(String(((v.agent as Document) ?? {}).email ?? ''));
        if (!k) continue;
        visN.set(k, (visN.get(k) ?? 0) + 1);
        const cid = String(((v.contact as Document) ?? {})._id ?? '');
        if (cid && leadsC.get(k)?.has(cid)) { const s = visC.get(k) ?? new Set<string>(); s.add(cid); visC.set(k, s); }
    }
    // cierres del año: cohorte lead→cierre por marca y por asesor, y velocidad lead→venta
    const cerr = new Map<string, Set<string>>(), cerrA = new Map<string, Set<string>>();
    const ventasCerradas: { id: string; cid: string; raw: unknown; closed: Date; created: Date | null; brand: string; e: string; v: number }[] = [];
    for await (const o of db.collection('operations').find(
        { closedAt: { $gte: INI, $lt: FIN }, 'status.last': { $in: ['closed', 'paying'] } },
        { projection: { id: 1, closedAt: 1, createdAt: 1, company: 1, 'buyer.contact._id': 1, 'buyer.broker.email': 1, 'property.listing.operation': 1, 'property.type': 1, 'closeValue.value': 1 } })) {
        const b = (o.buyer as Document) ?? {};
        const e = String(((b.broker as Document) ?? {}).email ?? '');
        const raw = ((b.contact as Document) ?? {})._id;
        const cid = String(raw ?? '');
        if (!cid) continue;
        const k = agentBrand.get(e);
        if (k && leadsC.get(k)?.has(cid)) { const s = cerr.get(k) ?? new Set<string>(); s.add(cid); cerr.set(k, s); }
        if (leadsCA.get(e)?.has(cid)) { const s = cerrA.get(e) ?? new Set<string>(); s.add(cid); cerrA.set(e, s); }
        const c = brandOf(o.company as Document);
        const tipo = String(((o.property as Document) ?? {}).type ?? '');
        const valor = num(((o.closeValue as Document) ?? {}).value);
        if (!c.out && (((o.property as Document) ?? {}).listing as Document ?? {})?.operation === 'sale'
            && valor >= MIN_VALOR_RAPIDA && !/terreno|lote/i.test(tipo)) {
            ventasCerradas.push({ id: String(o.id), cid, raw, closed: o.closedAt as Date, created: isDate(o.createdAt) ? o.createdAt : null, brand: c.brand, e, v: num(((o.closeValue as Document) ?? {}).value) });
        }
    }
    // primer lead (de cualquier año, con cualquier asesor) de cada comprador → días hasta el cierre
    const primerLead = new Map<string, number>();
    const ids = [...new Set(ventasCerradas.map((x) => x.raw).filter((x) => x instanceof ObjectId || typeof x === 'string'))];
    for await (const l of db.collection('leads').find({ 'contact._id': { $in: ids } }, { projection: { 'contact._id': 1, createdAt: 1 } })) {
        const cid = String(((l.contact as Document) ?? {})._id ?? '');
        if (isDate(l.createdAt)) primerLead.set(cid, Math.min(primerLead.get(cid) ?? Infinity, l.createdAt.getTime()));
    }

    // ── inventario publicado: % en calidad Alta por marca ──
    const cal = new Map<string, { n: number; alta: number }>();
    for await (const p of db.collection('properties').find({ 'status.last': 'published' }, { projection: { company: 1, qualityScore: 1 } })) {
        const c = brandOf(p.company as Document);
        if (c.out) continue;
        const x = cal.get(c.brand) ?? { n: 0, alta: 0 };
        x.n += 1; if (num(p.qualityScore) === 3) x.alta += 1;
        cal.set(c.brand, x);
    }
    // ── exclusivas captadas en el año (contract.exclusive.start), por asesor ──
    const excl = new Map<string, { n: number; firmadas: number }>();
    for await (const p of db.collection('properties').find({ 'contract.exclusive.start': { $gte: INI, $lt: FIN } },
        { projection: { 'agent.email': 1, 'contract.status': 1, company: 1 } })) {
        if (brandOf(p.company as Document).out) continue;
        const e = String(((p.agent as Document) ?? {}).email ?? '');
        if (!e || fuera(e)) continue;
        const x = excl.get(e) ?? { n: 0, firmadas: 0 };
        x.n += 1; if (((p.contract as Document) ?? {}).status === 'completed') x.firmadas += 1;
        excl.set(e, x);
    }

    // ══ armado ══
    const nm = (k: string) => brandName.get(k) ?? k;
    const deBaja = (k: string) => (brandBajaRec.has(k) && !brandActivaRec.has(k)) || !VIGENTES.has(k);
    const rows = [...inmo.entries()].filter(([k, r]) => r.cobrada > 0 && !deBaja(k)).map(([k, r]) => {
        const contactos = leadsC.get(k)?.size ?? 0;
        return {
            k, r, leads: leadsN.get(k) ?? 0,
            crec: r.prev > 0 ? r.cobrada / r.prev - 1 : null,
            conv: contactos ? (cerr.get(k)?.size ?? 0) / contactos : null,
            tvis: contactos ? (visC.get(k)?.size ?? 0) / contactos : null,
            vpl: (leadsN.get(k) ?? 0) ? (visN.get(k) ?? 0) / (leadsN.get(k) ?? 1) : null,
        };
    });
    const ops = (n: number) => `${n} ${n === 1 ? 'op' : 'ops'}`;

    const inmoDelAño: Lugar[] = [...rows].sort((a, b) => b.r.cobrada - a.r.cobrada).slice(0, 5)
        .map((x) => ({ name: nm(x.k), value: x.r.cobrada, fmt: 'money', sub: ops(x.r.ops.size), nota: x.r.onb ? 'onboarding' : undefined }));

    const ticket: Lugar[] = rows.filter((x) => x.r.ventas.length >= MIN_VENTAS_TICKET)
        .map((x) => ({ x, avg: x.r.ventas.reduce((a, b) => a + b, 0) / x.r.ventas.length }))
        .sort((a, b) => b.avg - a.avg).slice(0, 5)
        .map(({ x, avg }) => ({ name: nm(x.k), value: avg, fmt: 'money', sub: `${x.r.ventas.length} ventas` }));

    // desempeño: percentil dentro de las elegibles en 4 ejes al 25%; un null cuenta como el peor
    const elig = rows.filter((x) => x.leads >= MIN_LEADS_INMO && x.r.ops.size >= 5);
    const pctl = (vals: (number | null)[]) => {
        const ord = vals.map((v, i) => [v ?? -Infinity, i] as [number, number]).sort((a, b) => a[0] - b[0]);
        const out = new Array<number>(vals.length).fill(0);
        ord.forEach(([, i], j) => { out[i] = vals[i] == null ? 0 : (100 * (j + 1)) / ord.length; });
        return out;
    };
    const P = [pctl(elig.map((x) => x.r.cobrada)), pctl(elig.map((x) => x.crec)), pctl(elig.map((x) => x.conv)), pctl(elig.map((x) => x.vpl))];
    const desempeño: Lugar[] = elig.map((x, i) => ({ x, s: (P[0][i] + P[1][i] + P[2][i] + P[3][i]) / 4 }))
        .sort((a, b) => b.s - a.s).slice(0, 5)
        .map(({ x, s }) => ({ name: nm(x.k), value: s, fmt: 'score',
            sub: `crec ${x.crec == null ? '—' : `${x.crec >= 0 ? '+' : ''}${Math.round(x.crec * 100)}%`} · conv ${x.conv == null ? '—' : (x.conv * 100).toFixed(1) + '%'}` }));

    // Nueva = el registro de la inmobiliaria Y su asesor más antiguo son del año. Sólo con el
    // registro, Reset Living salía como nueva (se creó en ene-2026) aunque Aline, su master
    // broker, está en Pulppo desde feb-2024: no es una inmobiliaria nueva, es una cuenta nueva.
    const nuevasInmo: Lugar[] = rows.filter((x) => (brandBorn.get(x.k) ?? 0) >= INI.getTime()
        && (brandFirstAgent.get(x.k) ?? 0) >= INI.getTime())
        .sort((a, b) => b.r.cobrada - a.r.cobrada).slice(0, 3)
        .map((x) => ({ name: nm(x.k), value: x.r.cobrada, fmt: 'money', sub: `entró en ${MES[new Date(brandBorn.get(x.k)!).getUTCMonth()]}` }));

    const tasaVisita: Lugar[] = rows.filter((x) => x.leads >= MIN_LEADS_INMO && x.tvis != null)
        .sort((a, b) => (b.tvis ?? 0) - (a.tvis ?? 0)).slice(0, 5)
        .map((x) => ({ name: nm(x.k), value: x.tvis!, fmt: 'pct', sub: `${(visC.get(x.k)?.size ?? 0).toLocaleString('es-MX')} de ${(leadsC.get(x.k)?.size ?? 0).toLocaleString('es-MX')} contactos` }));

    const calidad: Lugar[] = [...cal.entries()].filter(([k, x]) => x.n >= MIN_PROPS_CALIDAD && inmo.has(k) && !deBaja(k))
        .sort((a, b) => b[1].alta / b[1].n - a[1].alta / a[1].n).slice(0, 5)
        .map(([k, x]) => ({ name: nm(k), value: x.alta / x.n, fmt: 'pct', sub: `${x.alta} de ${x.n} fichas en Alta` }));

    const conjunto: Lugar[] = [...pares.entries()].filter(([k]) => !k.split('|').some(deBaja)).sort((a, b) => b[1].size - a[1].size).slice(0, 5)
        .map(([k, s]) => ({ name: k.split('|').map(nm).join(' + '), value: s.size, fmt: 'int', sub: 'operaciones juntas' }));

    // brokers: nivel de HOY, todo lo cobrado en el año
    const brokers = { standard: [], professional: [], elite: [] } as Record<Level, Lugar[]>;
    for (const lv of ['elite', 'professional', 'standard'] as Level[]) {
        brokers[lv] = [...bro.entries()].filter(([e]) => am.level.get(e) === lv && !fuera(e))
            .sort((a, b) => b[1].v - a[1].v).slice(0, 5)
            .map(([e, b]) => ({ ...persona(e), value: b.v, fmt: 'money', sub: ops(b.ops.size) }));
    }

    const freq = new Map<string, number>();
    for (const bs of badges.values()) for (const k of Object.keys(bs)) freq.set(k, (freq.get(k) ?? 0) + 1);
    const insignias: Lugar[] = [...badges.entries()].map(([e, bs]) => {
        const gan = Object.entries(bs).filter(([k, v]) => k !== 'academy' && isDate(v) && v >= INI && v < FIN).map(([k]) => k);
        return { e, gan, rare: gan.reduce((a, k) => a + 1000 / (freq.get(k) ?? 1), 0) };
    }).filter((x) => x.gan.length && !fuera(x.e))
        .sort((a, b) => b.gan.length - a.gan.length || b.rare - a.rare).slice(0, 5)
        .map(({ e, gan }) => ({ ...persona(e), value: gan.length, fmt: 'int',
            nota: gan.sort((a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0)).map((k) => BADGE_LBL[k] ?? k).join(' · ') }));

    // racha élite vigente (reusa el Salón de la fama)
    const byName = new Map<string, string>();
    for (const [e, n] of am.name) byName.set(n, e);
    const racha: Lugar[] = hallOfFame(am).vigentes.filter((v) => !isDemo(v.company) && !fuera(byName.get(v.name) ?? '')).slice(0, 3).map((v) => {
        const e = byName.get(v.name);
        return { name: v.name, company: v.company, photo: e ? am.photo.get(e) ?? null : null, value: v.months, fmt: 'int', sub: 'meses seguidos' };
    });

    // revelación: más niveles subidos en el año (enero → hoy); desempate por lo cobrado
    const revelacion: Lugar[] = [...am.level.entries()].map(([e, hoyLv]) => {
        const ene = levelAt(am.hist.get(e), hoyLv, year, 0);
        return { e, de: ene, a: hoyLv, salto: (ORD[hoyLv ?? ''] ?? 0) - (ORD[ene ?? ''] ?? 0), v: bro.get(e)?.v ?? 0 };
    }).filter((x) => x.salto > 0 && x.v > 0 && !fuera(x.e))
        .sort((a, b) => b.salto - a.salto || b.v - a.v).slice(0, 3)
        .map((x) => ({ ...persona(x.e), value: x.v, fmt: 'money', sub: `${LVL_LBL[x.de ?? ''] ?? '—'} → ${LVL_LBL[x.a ?? ''] ?? '—'}` }));

    const relampago: Lugar[] = [...resp.entries()].filter(([e, xs]) => xs.length >= MIN_RESP_BROKER && !fuera(e))
        .map(([e, xs]) => ({ e, med: median(xs)!, n: xs.length }))
        .sort((a, b) => a.med - b.med).slice(0, 5)
        .map((x) => ({ ...persona(x.e), value: x.med, fmt: 'min', sub: `${x.n} leads respondidos` }));

    const leadCierre: Lugar[] = [...leadsCA.entries()].filter(([e]) => (leadsNA.get(e) ?? 0) >= MIN_LEADS_BROKER && !fuera(e))
        .map(([e, s]) => ({ e, conv: (cerrA.get(e)?.size ?? 0) / s.size, n: cerrA.get(e)?.size ?? 0, c: s.size }))
        .filter((x) => x.n > 0).sort((a, b) => b.conv - a.conv || b.n - a.n).slice(0, 5)
        .map((x) => ({ ...persona(x.e), value: x.conv, fmt: 'pct', sub: `${x.n} de ${x.c} contactos` }));

    const captador: Lugar[] = [...excl.entries()].sort((a, b) => b[1].firmadas - a[1].firmadas || b[1].n - a[1].n).slice(0, 5)
        .map(([e, x]) => ({ ...persona(e), value: x.firmadas, fmt: 'int', sub: `firmadas de ${x.n}` }));

    const rentas: Lugar[] = [...bro.entries()].filter(([e, b]) => b.rentas.size > 0 && !fuera(e))
        .sort((a, b) => b[1].rentas.size - a[1].rentas.size || b[1].v - a[1].v).slice(0, 5)
        .map(([e, b]) => ({ ...persona(e), value: b.rentas.size, fmt: 'int', sub: 'rentas cobradas' }));

    const ventaMayor: Lugar[] = ventas.filter((x) => !deBaja(x.brand) && !(x.e && fuera(x.e))).sort((a, b) => b.v - a.v).slice(0, 3)
        .map((x) => ({ name: nm(x.brand), value: x.v, fmt: 'money', sub: x.e ? `${am.name.get(x.e) ?? x.e} · ${x.id}` : x.id }));

    // venta más rápida: del primer lead del comprador al cierre. Sólo ventas de $2M+ y sin
    // terrenos (un terreno de $600K entre dos asesores de la misma familia ganaba con 13 días).
    // Sólo cuenta si el lead es
    // ANTERIOR a que se abriera la operación: si no, el lead se capturó tarde y el cliente ya
    // venía de antes (la venta de $61.8M de enero tenía la operación abierta desde oct-2025 y
    // el "lead" 6 días antes del cierre). Menos de 1 día también se descarta.
    const ventaRapida: Lugar[] = ventasCerradas.map((x) => {
        const lead = primerLead.get(x.cid);
        const ok = lead != null && (!x.created || lead <= x.created.getTime());
        return { x, d: ok ? (x.closed.getTime() - lead!) / 86_400_000 : null };
    })
        .filter((y) => y.d != null && y.d >= 1 && !deBaja(y.x.brand) && !fuera(y.x.e))
        .sort((a, b) => a.d! - b.d!).slice(0, 3)
        .map(({ x, d }) => ({ name: nm(x.brand), value: d!, fmt: 'dias', sub: `${am.name.get(x.e) ?? 'comprador externo'} · ${x.id}${x.v ? ` · $${(x.v / 1e6).toFixed(1)}M` : ''}` }));


    const pendiente = rows.filter((x) => x.r.pend > 250_000).sort((a, b) => b.r.pend - a.r.pend).slice(0, 5)
        .map((x) => ({ name: nm(x.k), porCobrar: x.r.pend }));

    const h = hoy < FIN ? hoy : new Date(FIN.getTime() - 1);
    return {
        year, hasta: `${h.getUTCDate()} de ${MES[h.getUTCMonth()]} ${h.getUTCFullYear()}`,
        inmoDelAño, brokerDelAño: brokers.elite[0] ?? null, brokers,
        desempeño, ticket, nuevasInmo, tasaVisita, calidad, conjunto,
        insignias, racha, revelacion, relampago, leadCierre, captador, rentas,
        ventaMayor, ventaRapida,
        nuevosPro: nuevosDelAño(am, year, 'professional', bajas), nuevosElite: nuevosDelAño(am, year, 'elite', bajas), pendiente,
    };
}
