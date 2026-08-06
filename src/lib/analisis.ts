// Motor del "Análisis general" — port de gen_reporte_plus.py (Track B ampliado).
// Fase 1: Inventario (P1) + Precio × calidad (P2). Lee Mongo en vivo (read-only).
// Las secciones YoY / Top 10 / destacados / funnel se irán agregando después.
import { ObjectId, type Db, type Document } from 'mongodb';
import { getDb } from './data';
import { refComps, idxPool, type PoolItem, type Subj } from './comparables';

// ---------- helpers (equivalentes a los del script Python) ----------
const gv = (o: Document | null | undefined, ...path: string[]): unknown => {
    let cur: unknown = o;
    for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    return cur;
};
const num = (v: unknown): number | null => (typeof v === 'number' && !isNaN(v) ? v : null);
const asDt = (v: unknown): Date | null => {
    if (v instanceof Date) return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    return null;
};
const median = (xs: (number | null | undefined)[]): number | null => {
    const s = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
};

type Band = [string, number, number];
const VB: Band[] = [['0–3M', 0, 3e6], ['3–6M', 3e6, 6e6], ['6–10M', 6e6, 10e6], ['+10M', 10e6, 9e15]];
const bandOf = (v: number | null, bands: Band[]): string => {
    const x = v || 0;
    for (const [lab, lo, hi] of bands) if (lo <= x && x < hi) return lab;
    return bands[bands.length - 1][0];
};
// Taxonomía del ACM (óptimo / no competitivo / fuera de mercado). Guardrail: ratios
// precio/ACM absurdos (>3× o <0.2×) = ACM roto → "Sin referencia", no distorsionan.
const priceCls = (sp: number | null): string =>
    sp == null || sp > 3 || sp < 0.2 ? 'Sin referencia'
        : sp <= 1.05 ? 'Óptimo' : sp <= 1.20 ? 'No competitivo' : 'Fuera de mercado';
const PL_ORDER = ['Óptimo', 'No competitivo', 'Fuera de mercado'];
const tierName = (t: unknown): string | null => {
    if (!t) return null;
    const s = String(t).toUpperCase();
    if (s.startsWith('HOME')) return 'Súper destacado';
    if (s.startsWith('DESTACADO')) return 'Destacado';
    if (s.startsWith('SIMPLE')) return 'Simple';
    if (s.includes('OFFLINE')) return 'Offline';
    return null;
};
const CAL: Record<number, string> = { 3: 'Alta', 2: 'Media', 1: 'Baja' };
const QROWS = ['Alta', 'Media', 'Baja'];
const PCOLS = ['Óptimo', 'No competitivo', 'Fuera de mercado', 'Sin referencia'];

// ---------- config de entrada ----------
// DOS conceptos de fecha, separados a propósito (estandarización pedida por Ale, ago-2026):
//
//   1) COMPARABLES = el MERCADO. Sirve para comparar precio, cuánta competencia tienes y cuánta
//      gente está buscando. Cada pieza tiene su propia naturaleza temporal:
//        · Oferta (lo que se pide)  → FOTO DE HOY, no configurable: no guardamos la historia
//                                     del asking, solo lo que está publicado hoy.
//        · Cierres (lo que se vende)→ mínimo 6 meses: los cierres son pocos y una ventana corta
//                                     no junta comparables suficientes.
//        · Demanda (búsquedas)      → mínimo 1 mes.
//
//   2) DESEMPEÑO = TU OPERACIÓN. Alimenta el funnel comercial, los asesores, los leads por
//      propiedad y el "sin actividad". Es UNA ventana (mes actual, mes anterior, un mes
//      específico, últimos 3/6/12 meses, año en curso) + UNA base contra la cual compararla.
//
// Antes esto vivía en 4 controles sueltos ("ventana de análisis", "comparación de períodos",
// "desempeño de leads", "zombie") que se pisaban entre sí. Ahora es: comparables + desempeño.
export interface AnalisisConfig {
    inmo?: string;                // nombre (regex case-insensitive) — o usa companyId directo
    companyId?: string;           // ObjectId directo (para /mb, scoped por la liga): salta resolveCompany
    audiencia?: 'kam' | 'mb';     // 'kam' (default) = interno; 'mb' = hacia afuera (sin destacados/OKR internos)
    operacion?: string;           // 'Ambas' | 'Venta' | 'Renta'
    // --- COMPARABLES (mercado) ---
    ventCierres?: string;         // ver CIERRES_WIN (mín. 6 meses)
    ventDemanda?: string;         // ver DEMANDA_WIN (mín. 1 mes)
    referencias?: string[];       // qué referencias mostrar: 'Oferta de zona' | 'Cierres reales' | ...
    mlsGeneral?: boolean;         // oferta/zona contra el MLS i24 completo en vez de la red Pulppo
    // --- DESEMPEÑO (tu operación) ---
    desempeno?: string;           // ver DESEMPENO_WIN
    desempenoMes?: string;        // 'YYYY-MM' cuando desempeno === 'Mes específico'
    comparar?: string;            // ver COMPARAR_OPTS
    asesor?: string;              // nombre de un asesor → acota TODO el reporte a su cartera
    // --- legacy (formularios anteriores): se mapean a desempeno/comparar ---
    ventLeads?: string;
    comparacion?: string;
    zombie?: string;
}

// Las opciones de los selectores viven en src/lib/ventanas.ts (sin dependencias, para que los
// formularios 'use client' las puedan importar sin arrastrar el driver de mongodb al navegador).

// clasificador de fuente con etiquetas limpias (alineadas a los chips del form)
const srcLabel = (s: unknown): string => {
    const t = String(s || '').toLowerCase();
    if (t.includes('inmueble') || t.includes('i24')) return 'Inmuebles24';
    if (t.includes('meli') || t.includes('mercado')) return 'MercadoLibre';
    if (t.includes('easybroker')) return 'EasyBroker';
    if (t.includes('whats')) return 'WhatsApp';
    if (t.includes('pulppo')) return 'Pulppo';
    if (t.includes('propiedades.com')) return 'propiedades.com';
    if (t.includes('face') || t.includes('insta') || t.includes('tiktok')) return 'Redes';
    if (t.includes('tel') || t.includes('phone')) return 'Teléfono';
    if (t.includes('lamudi')) return 'Lamudi';
    if (t.includes('web')) return 'Website';
    return 'Otros';
};

// ---------- ventana de DESEMPEÑO + su base de comparación ----------
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
type Rng = { start: Date; end: Date; label: string };
// 'month' = la ventana es un mes de calendario (su comparación natural es el mes anterior);
// 'span'  = la ventana es un tramo de N días/meses (su comparación natural es el tramo previo).
type RngKind = 'month' | 'span';
const mStartUTC = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const addMonthsUTC = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
const addYearsUTC = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
const mesLabel = (d: Date) => `${MES_L[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// La ventana de desempeño elegida. `end` es exclusivo.
// `meses` = largo en meses de calendario (para que "el período anterior" no se desalinee por
// los días de cada mes). `ytd` = el año en curso, donde "período anterior" no tiene sentido
// como tramo previo y se lee siempre contra el año pasado a la misma fecha.
type Perf = Rng & { kind: RngKind; meses?: number; ytd?: boolean };
function perfRange(win: string, mes: string | undefined, now: Date): Perf {
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    if (win === 'Mes específico' && mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
        const yy = parseInt(mes.slice(0, 4)), mm = parseInt(mes.slice(5, 7)) - 1;
        const s = mStartUTC(yy, mm);
        // si es el mes en curso, corta hoy (no proyecta el mes completo)
        const e = yy === y && mm === m ? now : mStartUTC(yy, mm + 1);
        return { start: s, end: e, label: mesLabel(s), kind: 'month' };
    }
    if (win === 'Mes actual') {
        const s = mStartUTC(y, m);
        return { start: s, end: now, label: `${mesLabel(s)} (al día ${now.getUTCDate()})`, kind: 'month' };
    }
    if (win === 'Mes anterior') {
        const s = mStartUTC(y, m - 1);
        return { start: s, end: mStartUTC(y, m), label: mesLabel(s), kind: 'month' };
    }
    for (const n of [3, 6, 12]) {
        if (win === `Últimos ${n} meses`) return { start: addMonthsUTC(now, -n), end: now, label: `últimos ${n} meses`, kind: 'span', meses: n };
    }
    // 'Año en curso (YTD)' (default)
    return { start: mStartUTC(y, 0), end: now, label: `${y} a la fecha`, kind: 'span', ytd: true };
}

// La base contra la cual se compara la ventana de desempeño. null = sin comparación.
function compareRange(p: Perf, modo: string): Rng | null {
    if (modo === 'Sin comparación') return null;
    const mismoAnioPasado = (): Rng => {
        const s = addYearsUTC(p.start, -1), e = addYearsUTC(p.end, -1);
        return { start: s, end: e, label: p.kind === 'month' ? mesLabel(s) : p.ytd ? `${s.getUTCFullYear()} a la misma fecha` : `mismo tramo de ${s.getUTCFullYear()}` };
    };
    if (modo === 'Mismo período del año pasado') return mismoAnioPasado();
    // 'Período anterior' (default)
    if (p.kind === 'month') {
        const s = mStartUTC(p.start.getUTCFullYear(), p.start.getUTCMonth() - 1);
        const dias = Math.round((p.end.getTime() - p.start.getTime()) / 864e5);
        const largoMes = Math.round((p.start.getTime() - s.getTime()) / 864e5);
        // mes en curso (parcial) → compara los MISMOS días del mes anterior, para que sea justo
        const parcial = dias < largoMes;
        const e = parcial ? new Date(s.getTime() + dias * 864e5) : p.start;
        return { start: s, end: e, label: parcial ? `${mesLabel(s)} (mismos ${dias} días)` : mesLabel(s) };
    }
    // el año en curso no tiene "tramo previo" con sentido comercial → se lee contra el año pasado
    if (p.ytd || !p.meses) return mismoAnioPasado();
    return { start: addMonthsUTC(p.start, -p.meses), end: p.start, label: `${p.meses} meses previos` };
}

// Mapeo de los selectores viejos (por si un cliente cacheado manda el body anterior).
const legacyDesempeno = (cfg: AnalisisConfig): { win: string; comparar: string } => {
    const c = cfg.comparacion || '';
    if (c.startsWith('Mes vs mes')) return { win: 'Mes anterior', comparar: 'Período anterior' };
    if (c.startsWith('Mismo mes')) return { win: 'Mes actual', comparar: 'Mismo período del año pasado' };
    if (c.startsWith('Últimos 30')) return { win: 'Mes actual', comparar: 'Período anterior' };
    if (c.startsWith('Últimos 90')) return { win: 'Últimos 3 meses', comparar: 'Período anterior' };
    if (c.startsWith('Trimestre')) return { win: 'Últimos 3 meses', comparar: 'Período anterior' };
    const vl = cfg.ventLeads || '';
    if (/30\s*d/.test(vl)) return { win: 'Mes actual', comparar: 'Período anterior' };
    if (/90\s*d|3\s*mes/.test(vl)) return { win: 'Últimos 3 meses', comparar: 'Período anterior' };
    if (/6\s*mes/.test(vl)) return { win: 'Últimos 6 meses', comparar: 'Período anterior' };
    if (/12\s*mes/.test(vl)) return { win: 'Últimos 12 meses', comparar: 'Período anterior' };
    return { win: 'Año en curso (YTD)', comparar: 'Mismo período del año pasado' };
};

// Métricas de un asesor dentro de la ventana de desempeño, siempre partidas venta/renta
// (los tickets y los % de comisión de renta y venta no son comparables entre sí).
export type PorOp = { sale: number; rent: number };
export interface AsesorRow {
    id: string; name: string;
    leads: PorOp;                 // leads únicos que le tocaron
    resp: PorOp;                  // de esos, los que respondió
    fueraSla: PorOp;              // respondidos DESPUÉS de 24 h + los que nunca respondió
    respMinAvg: { sale: number | null; rent: number | null };   // minutos a la 1ª respuesta (promedio)
    respMinMed: { sale: number | null; rent: number | null };   // ídem (mediana: el promedio lo rompen los outliers)
    visitas: PorOp; ofertas: PorOp; cierres: PorOp;
    comision: PorOp;              // comisión de las operaciones cerradas
    gmv: PorOp;                   // valor de cierre (para ticket promedio y % de comisión)
    busquedas: number;            // búsquedas de comprador abiertas en el período (pipeline de demanda)
    propsCompartidas: number;     // propiedades que le compartió a sus clientes
    clientes: number;             // clientes distintos con búsqueda en el período
}
// Actividad sobre TU inventario que hizo un broker de OTRA inmobiliaria (la red Pulppo es un MLS
// compartido). No va en la tabla de asesores, pero es información: la red trabajando tu inventario.
export interface ExternoRow { leads: number; visitas: number; pctLeads: number; pctVisitas: number }
// Una propiedad dentro de una propuesta de swap de destacado, con la razón en palabras.
export interface SwapProp {
    code: string; nb: string; val: number; tier: string;
    sp: number | null;            // precio ÷ ACM
    calidad: string; leads: number; demanda: number;
    razon: string;
}
// Referencia de mercado: las mejores inmobiliarias (TOP 20 por # de cierres en la ventana).
export interface Bench { tasaVisita: number | null; tasaResp: number | null; leadToClose: number | null; nInmos: number; label: string }

export interface AnalisisData {
    company: string;
    corte: string;                // ISO de la fecha de corte
    N: number;
    opSplit: { sale: number; rent: number };
    llProp: number;               // leads (ventana de desempeño) / N
    leadsLabel: string;           // etiqueta de la ventana de DESEMPEÑO
    demandaLabel: string;         // etiqueta de la ventana de demanda (comparables)
    ofertaLabel: string;          // "red Pulppo" | "MLS i24"
    asesores: AsesorRow[];        // desempeño por asesor (SOLO asesores de la inmobiliaria)
    externo: ExternoRow;          // lo que hicieron brokers de otras inmobiliarias sobre tu inventario
    bench: Bench;                 // referencia: mejores inmobiliarias (TOP 20 por cierres)
    asesorFiltro: string;         // '' = toda la inmobiliaria; si no, el asesor al que está acotado
    operacion: string;            // 'Ambas' | 'Venta' | 'Renta' (eco del filtro aplicado)
    zombie: { n: number; pct: number; label: string };
    leadsBySource: { source: string; n: number }[];
    leadsComp: { cliente: number; broker: number; incontactables: number; duplicados: number; total: number; totalOp: { sale: number; rent: number } };
    cierresLabel: string;         // etiqueta de la ventana de cierres
    zones: { nb: string; n: number; oferta: number; herPpm2: number | null; ofertaPpm2: number | null; cierresPpm2: number | null; vsOferta: number | null; vsCierres: number | null; nCierres: number; dem: number; leads: number }[];
    segTipo: { tipo: string; n: number; leads: number }[];
    segOp: { op: string; n: number; leads: number }[];
    benchmarkMarket: { vsOfertaAvg: number | null; vsCierresAvg: number | null; zonasCaras: number; zonasCierres: number; absorcion: number | null; demTotal: number; ofertaTotal: number };
    invVsDemand: { band: string; invPct: number; demPct: number; inv: number; dem: number }[];
    matrix: { q: string; cells: { p: string; n: number; ll: number }[] }[];
    priceLead: { cls: string; props: number; leads: number; ll: number }[];
    joyas: number; joyasAlta: number; caras: number;
    nSale: number; nCaro: number; pctCaro: number;
    insightInv: string;           // lectura auto de Inventario
    insightPrecio: string;        // lectura auto de Precio × calidad
    // funnel de la ventana de desempeño y el MISMO funnel del período base, para mostrar el ▲▼
    // dentro de la sección (antes la comparación solo existía en su propia sección)
    funnel: { title: string; steps: { label: string; value: number; rate: number | null; prev: number | null }[] }[];
    funnelReading: string;
    recos: { enfoque: string; title: string; body: string; sev: number }[];
    compLabels: { a: string; b: string };
    hasComp: boolean;             // false = "Sin comparación" (la sección lo dice en vez de inventar números)
    yoy: { label: string; a: number; b: number; fmt: 'int' | 'dec' | 'pct' | 'pct2' | 'money'; goodUp: boolean }[];
    yoyMix: { period: string; sale: number; rent: number; com: number }[];
    yoyReading: string;
    top10: { code: string; nb: string; val: number; sp: number | null; leads: number; dz: number; lev: string[] }[];
    // Swaps de destacado: qué aviso conviene sacar del slot y qué meter, con su razón. Es
    // presupuesto-neutro (mismo número de slots) para que el KAM lo pueda proponer sin pedir más.
    swaps: { sale: SwapProp; entra: SwapProp }[];
    swapsNota: string;
    destacados: {
        sdNow: number; dNow: number; simpleNow: number; pctDest: number;
        splits: { sd: { sale: number; rent: number }; d: { sale: number; rent: number }; simple: { sale: number; rent: number } };
        monthly: { month: string; tiers: { tier: string; n: number }[]; dest: number }[];
        llTier: { tier: string; saleLL: number | null; saleLeads: number; rentLL: number | null; rentLeads: number }[];
        reading: string;
    };
}

// Nombre completo de un agente (null si no es un agente usable: sin _id o sin nombre).
const agName = (a: Document | null | undefined): string | null => {
    if (!a || !gv(a, '_id')) return null;
    const n = [gv(a, 'firstName'), gv(a, 'lastName')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return n || null;
};
// Se agrupa por nombre normalizado: la misma persona puede tener dos cuentas de agente
// (visto en producción) y al dueño le interesa la persona, no la cuenta.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- Benchmark: las MEJORES inmobiliarias ----------
// Referencia = TOP 20 por # de cierres en la ventana (decisión de Ale, ago-2026). El ranking por
// ROI vive fuera de Mongo, pero "quién cierra más" sale de aquí y es defendible.
// Medido en may–jul 2026: las TOP convierten a visita 14.4% vs 10.4% del resto, así que comparar
// contra el PROMEDIO no sirve (casi todas salen bien); hay que comparar contra las mejores.
// Cacheado por ventana: es un escaneo global y cambia lento.
const _benchCache = new Map<string, { v: Bench; at: number }>();
async function bestAgencies(db: Db, start: Date, end: Date, label: string): Promise<Bench> {
    const key = `${start.getTime()}|${end.getTime()}`;
    const hit = _benchCache.get(key);
    if (hit && Date.now() - hit.at < 900000) return hit.v;

    const pid2cid = new Map<string, string>();
    for await (const p of db.collection('properties').find({ 'company._id': { $exists: true } }, { projection: { 'company._id': 1 } }))
        pid2cid.set(String(p._id), String(gv(p, 'company', '_id')));

    const leads: Record<string, number> = {}, resp: Record<string, number> = {};
    const vis: Record<string, number> = {}, clo: Record<string, number> = {};
    const seen = new Set<string>();
    for await (const l of db.collection('leads').find({ createdAt: { $gte: start, $lt: end } },
        { projection: { 'property._id': 1, answeredAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact._id': 1 } })) {
        const pid = String(gv(l, 'property', '_id')); const cid = pid2cid.get(pid);
        if (!cid) continue;
        const who = gv(l, 'contact', 'phone') || gv(l, 'contact', 'email') || String(gv(l, 'contact', '_id') || l._id);
        const k = `${pid}|${who}`;
        if (seen.has(k)) continue;
        seen.add(k);
        leads[cid] = (leads[cid] || 0) + 1;
        if (l.answeredAt) resp[cid] = (resp[cid] || 0) + 1;
    }
    for await (const v of db.collection('visits').find({ 'status.last': { $ne: 'cancelled' }, createdAt: { $gte: start, $lt: end } },
        { projection: { 'steps.property._id': 1 } })) {
        for (const s of ((v.steps || []) as Document[])) {
            const cid = pid2cid.get(String(gv(s, 'property', '_id')));
            if (cid) { vis[cid] = (vis[cid] || 0) + 1; break; }
        }
    }
    for await (const o of db.collection('operations').find({ 'status.last': { $in: ['closed', 'paying'] }, closedAt: { $gte: start, $lt: end } },
        { projection: { 'property._id': 1 } })) {
        const cid = pid2cid.get(String(gv(o, 'property', '_id')));
        if (cid) clo[cid] = (clo[cid] || 0) + 1;
    }
    // universo: inmobiliarias con volumen suficiente para que la tasa signifique algo
    const univ = Object.keys(leads).filter((c) => leads[c] >= 50);
    const top = univ.sort((a, b) => (clo[b] || 0) - (clo[a] || 0)).slice(0, 20);
    const L = top.reduce((a, c) => a + leads[c], 0);
    const v: Bench = {
        tasaVisita: L ? top.reduce((a, c) => a + (vis[c] || 0), 0) / L : null,
        tasaResp: L ? top.reduce((a, c) => a + (resp[c] || 0), 0) / L : null,
        leadToClose: L ? top.reduce((a, c) => a + (clo[c] || 0), 0) / L : null,
        nInmos: top.length, label,
    };
    _benchCache.set(key, { v, at: Date.now() });
    return v;
}

async function resolveCompany(db: Db, name: string): Promise<{ id: ObjectId; name: string }> {
    const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const cands = await db.collection('companies').find({ name: rx }, { projection: { name: 1 } }).toArray();
    if (!cands.length) throw new Error(`No encontré inmobiliaria ~ "${name}"`);
    // la de más inventario publicado
    let best = cands[0], bestN = -1;
    for (const c of cands) {
        const n = await db.collection('properties').countDocuments({ 'company._id': c._id, 'status.last': 'published' });
        if (n > bestN) { bestN = n; best = c; }
    }
    return { id: best._id as ObjectId, name: best.name as string };
}

export async function buildAnalisis(cfg: AnalisisConfig): Promise<AnalisisData> {
    const db = await getDb();
    const mb = cfg.audiencia === 'mb';   // versión hacia afuera (MB): sin destacados ni metas OKR internas
    let CID: ObjectId, CNAME: string;
    if (cfg.companyId) {
        CID = new ObjectId(cfg.companyId);
        const c = await db.collection('companies').findOne({ _id: CID }, { projection: { name: 1 } });
        CNAME = (c?.name as string) ?? 'Inmobiliaria';
    } else {
        if (!cfg.inmo) throw new Error('Falta inmo o companyId');
        const r = await resolveCompany(db, cfg.inmo); CID = r.id; CNAME = r.name;
    }

    const NOW = new Date();
    const YTD0 = new Date(Date.UTC(NOW.getUTCFullYear(), 0, 1));
    // --- ventana de DESEMPEÑO (funnel, asesores, leads por propiedad, sin actividad) ---
    const legacy = legacyDesempeno(cfg);
    const PERF = perfRange(cfg.desempeno || legacy.win, cfg.desempenoMes, NOW);
    const CMP = compareRange(PERF, cfg.comparar || legacy.comparar);
    const leadsStart = PERF.start, leadsEnd = PERF.end;
    const leadsLabel = PERF.label;
    // se escanean leads desde el inicio más viejo de las dos ventanas (desempeño y su comparación)
    const leadScanStart = CMP ? new Date(Math.min(PERF.start.getTime(), CMP.start.getTime())) : PERF.start;
    // --- ventanas de COMPARABLES (mercado) ---
    const windowStart = (w: string, fallbackMonths: number): Date => {
        if (w === 'YTD 2026' || w === 'Año en curso (YTD)') return YTD0;
        if (w === 'Totales') return new Date(0);
        const d = new Date(NOW);
        const mm = w.match(/(\d+)\s*mes/), dd = w.match(/(\d+)\s*d[ií]a/);
        if (mm) d.setUTCMonth(d.getUTCMonth() - parseInt(mm[1]));
        else if (dd) d.setUTCDate(d.getUTCDate() - parseInt(dd[1]));
        else if (/último\s+mes/i.test(w)) d.setUTCMonth(d.getUTCMonth() - 1);   // 'Último mes'
        else d.setUTCMonth(d.getUTCMonth() - fallbackMonths);
        return d;
    };
    const demandaWindow = cfg.ventDemanda || 'Últimos 3 meses';
    const demandStart = windowStart(demandaWindow, 3);
    const demandaLabel = demandaWindow.toLowerCase();

    // ---- QUIÉNES SON TUS ASESORES (y el filtro por asesor) ----
    // La red Pulppo es un MLS compartido: un broker de OTRA inmobiliaria puede atender un lead o
    // hacer una visita sobre tu inventario (hasta 17% de las visitas en los casos medidos). En la
    // tabla "cómo están tus asesores" eso NO puede aparecer, así que la lista sale de la colección
    // `agents` de la inmobiliaria y lo demás se cuenta aparte como actividad de la red.
    const internos = new Map<string, string>();
    for (const a of await db.collection('agents').find({ 'company._id': CID },
        { projection: { firstName: 1, lastName: 1 } }).toArray()) {
        const n = agName(a);
        if (n) internos.set(String(a._id), n);
    }
    // Filtro por asesor: acota el reporte a SU CARTERA (las propiedades de las que es responsable).
    // Es el corte defendible: "el inventario de Juan y lo que pasó con él".
    const asesorSel = (cfg.asesor || '').trim();
    const asesorIds = asesorSel
        ? [...internos.entries()].filter(([, n]) => norm(n) === norm(asesorSel)).map(([id]) => new ObjectId(id))
        : [];
    if (asesorSel && !asesorIds.length) throw new Error(`No encontré al asesor "${asesorSel}" en ${CNAME}`);
    const agentFilter: Document = asesorIds.length ? { 'agent._id': { $in: asesorIds } } : {};

    // --- propiedades publicadas ---
    const pub = await db.collection('properties').find(
        { 'company._id': CID, 'status.last': 'published', ...agentFilter },
        { projection: {
            listing: 1, type: 1, 'acm.price.value': 1, qualityScore: 1, pictures: 1, videos: 1,
            virtualTour: 1, 'address.neighborhood': 1, 'address.city': 1, internalId: 1, publishedAt: 1,
            'portals.inmuebles24.type': 1, 'attributes.totalSurface': 1, 'attributes.roofedSurface': 1, 'attributes.suites': 1,
        } }
    ).toArray();

    type Item = { pid: ObjectId; code: string | null; nb: string | null; nbid: string | null; ci: string | null; op: string | null;
        val: number; sp: number | null; ppm2: number | null; m2: number | null; suites: number | null; q3: number | null; tour: boolean; tier: string | null;
        fotos: number; video: boolean; descLen: number; tipo: string | null };
    const items: Item[] = pub.map((p) => {
        const nb = (gv(p, 'address', 'neighborhood') || {}) as Record<string, unknown>;
        const val = (num(gv(p, 'listing', 'value')) || 0);
        const acm = num(gv(p, 'acm', 'price', 'value'));
        const m2 = num(gv(p, 'attributes', 'totalSurface')) || num(gv(p, 'attributes', 'roofedSurface'));
        const rawType = p.type;
        const tipo = rawType && typeof rawType === 'object' ? ((rawType as { name?: string }).name || null) : (rawType as string) || null;
        return {
            pid: p._id as ObjectId, code: (p.internalId as string) || null, tipo,
            nb: (nb.name as string) || null, nbid: (nb.id as string) || null,
            ci: (gv(p, 'address', 'city', 'id') as string) || null,
            op: (gv(p, 'listing', 'operation') as string) || null,
            val, sp: val && acm ? val / acm : null,
            ppm2: val && m2 ? val / m2 : null, m2, suites: num(gv(p, 'attributes', 'suites')),
            q3: num(p.qualityScore), tour: !!p.virtualTour,
            tier: tierName(gv(p, 'portals', 'inmuebles24', 'type')),
            fotos: (p.pictures as unknown[] | undefined)?.length || 0,
            video: !!((p.videos as unknown[] | undefined)?.length),
            descLen: ((gv(p, 'listing', 'description') as string) || '').length,
        };
    });
    const N = items.length;
    const pid2nb = new Map(items.map((it) => [String(it.pid), it.nb]));
    const pubIds = items.map((it) => it.pid);
    const nbids = [...new Set(items.map((it) => it.nbid).filter(Boolean) as string[])];

    // --- demanda por zona y por ticket ---
    const demandByNb: Record<string, number> = {};
    if (nbids.length) {
        const agg = db.collection('searches').aggregate([
            { $match: { 'filters.addresses.id': { $in: nbids }, createdAt: { $gte: demandStart } } },
            { $unwind: '$filters.addresses' },
            { $match: { 'filters.addresses.id': { $in: nbids } } },
            { $group: { _id: '$filters.addresses.id', n: { $sum: 1 } } },
        ], { allowDiskUse: true });
        for await (const r of agg) demandByNb[r._id as string] = r.n as number;
    }
    const demandTicket: Record<string, number> = {};
    await Promise.all(VB.map(async ([lab, lo, hi]) => {
        demandTicket[lab] = nbids.length ? await db.collection('searches').countDocuments({
            'filters.addresses.id': { $in: nbids }, 'filters.operation': 'sale',
            createdAt: { $gte: demandStart }, 'filters.price.max': { $gte: lo, $lt: hi },
        }) : 0;
    }));

    // --- leads YTD por propiedad y por zona ---
    const opFilter = cfg.operacion === 'Venta' ? 'sale' : cfg.operacion === 'Renta' ? 'rent' : null;
    const pid2opPub = new Map(items.map((it) => [String(it.pid), it.op]));

    const leadsByPid: Record<string, number> = {};
    const leadsByNb: Record<string, number> = {};
    const leadsByNbOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    let leadsWinTotal = 0;
    const invSeen = new Set<string>();   // dedup: mismo contacto en la misma propiedad = 1 lead único
    const leadCur = db.collection('leads').find(
        { 'property._id': { $in: pubIds }, createdAt: { $gte: leadsStart, $lt: leadsEnd } },
        { projection: { 'property._id': 1, createdAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact._id': 1 } }
    );
    for await (const l of leadCur) {
        const pid = String(gv(l, 'property', '_id'));
        const who = gv(l, 'contact', 'phone') || gv(l, 'contact', 'email') || String(gv(l, 'contact', '_id') || l._id);
        const k = `${pid}|${who}`;
        if (invSeen.has(k)) continue;   // duplicado → no cuenta
        invSeen.add(k);
        leadsByPid[pid] = (leadsByPid[pid] || 0) + 1;
        leadsWinTotal++;
        const nb = pid2nb.get(pid);
        if (nb) {
            leadsByNb[nb] = (leadsByNb[nb] || 0) + 1;
            const po = pid2opPub.get(pid);
            if (po === 'sale' || po === 'rent') leadsByNbOp[po][nb] = (leadsByNbOp[po][nb] || 0) + 1;
        }
    }

    // --- inventario hoy ---
    const opSplit = { sale: items.filter((it) => it.op === 'sale').length, rent: items.filter((it) => it.op === 'rent').length };
    const venta = items.filter((it) => it.op === 'sale');
    const pbV: Record<string, number> = {};
    for (const it of venta) { const b = bandOf(it.val, VB); pbV[b] = (pbV[b] || 0) + 1; }

    // --- zonas (top 7 por # de props) — filtradas por operación si aplica ---
    const zoneUniverse = opFilter ? items.filter((it) => it.op === opFilter) : items;
    const byNb = new Map<string, Item[]>();
    for (const it of zoneUniverse) if (it.nb) { const a = byNb.get(it.nb) || []; a.push(it); byNb.set(it.nb, a); }
    const topZones = [...byNb.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 7);
    const zoneNbids = [...new Set(topZones.map(([, its]) => its[0].nbid).filter(Boolean) as string[])];
    // Fuente de la "oferta" de la zona: red Pulppo (properties) o MLS i24 completo (mls).
    const ofertaLabel = cfg.mlsGeneral ? 'MLS i24' : 'red Pulppo';
    const cierresLabel = (cfg.ventCierres || 'Últimos 24 meses').toLowerCase();
    const cierresStart = windowStart(cfg.ventCierres || 'Últimos 24 meses', 24);
    const mlsCount: Record<string, number> = {}, propCount: Record<string, number> = {};   // # publicadas por colonia
    // Pools de COMPARABLES (mismo motor que mb.ts): oferta (mls + red Pulppo) y cierres, con atributos
    // por listing, para comparar cada propiedad contra comparables reales en vez de contra toda la colonia.
    const offByNb = new Map<string, PoolItem[]>(), offByCi = new Map<string, PoolItem[]>();
    const cloByNb = new Map<string, PoolItem[]>(), cloByCi = new Map<string, PoolItem[]>();
    if (zoneNbids.length) {
        for (const [coll, dest] of [['mls', mlsCount], ['properties', propCount]] as [string, Record<string, number>][]) {
            for await (const r of db.collection(coll).aggregate([
                { $match: { 'status.last': 'published', 'address.neighborhood.id': { $in: zoneNbids } } },
                { $group: { _id: '$address.neighborhood.id', n: { $sum: 1 } } },
            ], { allowDiskUse: true })) dest[r._id as string] = r.n as number;
        }
        // oferta: cada anuncio de venta con precio y m² (mls + properties) entra al pool de comparables.
        for (const coll of ['mls', 'properties']) {
            for await (const r of db.collection(coll).aggregate([
                { $match: { 'status.last': 'published', 'listing.operation': 'sale', 'address.neighborhood.id': { $in: zoneNbids }, 'attributes.totalSurface': { $gt: 0 }, 'listing.value': { $gt: 0 } } },
                { $project: { type: 1, nbid: '$address.neighborhood.id', ci: '$address.city.id', suites: '$attributes.suites', surf: '$attributes.totalSurface', ppm: { $divide: ['$listing.value', '$attributes.totalSurface'] } } },
            ], { allowDiskUse: true })) {
                idxPool(offByNb, offByCi, { id: String(r._id), nb: (r.nbid as string) ?? null, ci: (r.ci as string) ?? null, type: (r.type as string) ?? '—', surf: num(r.surf), suites: num(r.suites), ppm: r.ppm as number });
            }
        }
        // cierres: ventas cerradas (properties completed + operations.closeValue) en la ventana, como comparables.
        const closedProps = await db.collection('properties').aggregate([
            { $match: { 'status.last': 'completed', 'listing.operation': 'sale', 'address.neighborhood.id': { $in: zoneNbids }, 'attributes.totalSurface': { $gt: 0 } } },
            { $lookup: { from: 'operations', localField: '_id', foreignField: 'property._id', as: 'op' } },
            { $project: { type: 1, nbid: '$address.neighborhood.id', ci: '$address.city.id', suites: '$attributes.suites', m2: '$attributes.totalSurface', op: 1 } },
            { $limit: 4000 },
        ], { allowDiskUse: true }).toArray();
        for (const p of closedProps) {
            const m2 = num(p.m2); if (!m2) continue;
            for (const o of (p.op as Document[]) || []) {
                const v = num(gv(o, 'closeValue', 'value')); const xd = asDt(gv(o, 'closedAt'));
                if (v && xd && xd >= cierresStart) { idxPool(cloByNb, cloByCi, { id: String(p._id), nb: (p.nbid as string) ?? null, ci: (p.ci as string) ?? null, type: (p.type as string) ?? '—', surf: m2, suites: num(p.suites), ppm: v / m2 }); break; }
            }
        }
    }
    // vs. oferta / vs. cierres se calculan POR PROPIEDAD contra comparables y se agregan por zona (mediana).
    // nCierres = cuántas de tus propiedades encontraron cierres comparables.
    const zones = topZones.map(([nb, its]) => {
        const nbid = its[0].nbid;
        const saleIts = its.filter((i) => i.op === 'sale');
        const herPpm2 = median(saleIts.map((i) => i.ppm2));
        const vsOfVals: number[] = [], vsCiVals: number[] = []; let nCierres = 0;
        for (const it of saleIts) {
            const ppm = it.ppm2; if (!ppm) continue;
            const subj: Subj = { id: String(it.pid), nb: it.nbid, ci: it.ci, type: it.tipo ?? '—', surf: it.m2, suites: it.suites };
            const oR = refComps(offByNb, offByCi, subj), cR = refComps(cloByNb, cloByCi, subj);
            if (oR.med) vsOfVals.push((ppm / oR.med - 1) * 100);
            if (cR.med) { vsCiVals.push((ppm / cR.med - 1) * 100); nCierres++; }
        }
        const vsOferta = vsOfVals.length ? Math.round(median(vsOfVals) as number) : null;
        const vsCierres = vsCiVals.length ? Math.round(median(vsCiVals) as number) : null;
        const leads = opFilter ? (leadsByNbOp[opFilter][nb] || 0) : (leadsByNb[nb] || 0);
        return { nb, n: its.length, oferta: (nbid && (cfg.mlsGeneral ? mlsCount : propCount)[nbid]) || 0,
            herPpm2, ofertaPpm2: null, cierresPpm2: null, vsOferta, vsCierres, nCierres,
            dem: (nbid && demandByNb[nbid]) || 0, leads };
    });

    // --- cortes por tipo y por operación (para los "cortes de segmentación") ---
    const segUniverse = opFilter ? items.filter((it) => it.op === opFilter) : items;
    const typeMap = new Map<string, { n: number; leads: number }>();
    for (const it of segUniverse) {
        const t = it.tipo || 'Otro'; const e = typeMap.get(t) || { n: 0, leads: 0 };
        e.n++; e.leads += leadsByPid[String(it.pid)] || 0; typeMap.set(t, e);
    }
    const segTipo = [...typeMap.entries()].map(([tipo, e]) => ({ tipo, n: e.n, leads: e.leads })).sort((a, b) => b.n - a.n).slice(0, 6);
    const segOp = (['sale', 'rent'] as const).map((op) => {
        const its = items.filter((i) => i.op === op);
        return { op: op === 'sale' ? 'Venta' : 'Renta', n: its.length, leads: its.reduce((a, i) => a + (leadsByPid[String(i.pid)] || 0), 0) };
    });

    // --- benchmark "vs. promedio de mercado" (rollup de las zonas, ponderado por inventario) ---
    const zOf = zones.filter((z) => z.vsOferta != null), zCi = zones.filter((z) => z.vsCierres != null);
    const wOf = zOf.reduce((a, z) => a + z.n, 0), wCi = zCi.reduce((a, z) => a + z.n, 0);
    // absorción = mercado real → oferta SIEMPRE del MLS i24 (no depende del toggle)
    const demTotal = zones.reduce((a, z) => a + z.dem, 0), ofertaTotal = zoneNbids.reduce((a, nid) => a + (mlsCount[nid] || 0), 0);
    const benchmarkMarket = {
        vsOfertaAvg: wOf ? Math.round(zOf.reduce((a, z) => a + (z.vsOferta || 0) * z.n, 0) / wOf) : null,
        vsCierresAvg: wCi ? Math.round(zCi.reduce((a, z) => a + (z.vsCierres || 0) * z.n, 0) / wCi) : null,
        zonasCaras: zCi.filter((z) => (z.vsCierres || 0) > 3).length,
        zonasCierres: zCi.length,
        absorcion: ofertaTotal ? demTotal / ofertaTotal : null,
        demTotal, ofertaTotal,
    };

    // --- inventario vs demanda por ticket ---
    const svTot = venta.length || 1;
    const demTot = Object.values(demandTicket).reduce((a, b) => a + b, 0) || 1;
    const invVsDemand = VB.map(([lab]) => ({
        band: lab,
        inv: pbV[lab] || 0, dem: demandTicket[lab] || 0,
        invPct: 100 * (pbV[lab] || 0) / svTot, demPct: 100 * (demandTicket[lab] || 0) / demTot,
    }));

    // --- segmentación precio × calidad + leads por celda (SOLO VENTA) ---
    const seg: Record<string, number> = {}; const segLeads: Record<string, number> = {};
    const key = (q: string, p: string) => `${q}|${p}`;
    for (const it of venta) {
        const q = CAL[it.q3 as number] || 'Media'; const pcl = priceCls(it.sp);
        seg[key(q, pcl)] = (seg[key(q, pcl)] || 0) + 1;
        segLeads[key(q, pcl)] = (segLeads[key(q, pcl)] || 0) + (leadsByPid[String(it.pid)] || 0);
    }
    const matrix = QROWS.map((q) => ({
        q, cells: PCOLS.map((p) => {
            const n = seg[key(q, p)] || 0; const lp = segLeads[key(q, p)] || 0;
            return { p, n, ll: n ? lp / n : 0 };
        }),
    }));
    const priceLead = PL_ORDER.map((pcl) => {
        const grp = venta.filter((it) => priceCls(it.sp) === pcl);
        const leads = grp.reduce((a, it) => a + (leadsByPid[String(it.pid)] || 0), 0);
        return { cls: pcl, props: grp.length, leads, ll: grp.length ? leads / grp.length : 0 };
    });
    const joyas = (seg[key('Alta', 'Óptimo')] || 0) + (seg[key('Media', 'Óptimo')] || 0);
    const joyasAlta = seg[key('Alta', 'Óptimo')] || 0;
    const caras = QROWS.reduce((a, q) => a + (seg[key(q, 'Fuera de mercado')] || 0), 0);
    const nSale = venta.length;
    const nRef = venta.filter((it) => priceCls(it.sp) !== 'Sin referencia').length;
    const nCaro = venta.filter((it) => priceCls(it.sp) === 'Fuera de mercado').length;
    const pctCaro = nCaro / (nRef || 1);

    // --- lecturas auto por sección ---
    const gap = [...invVsDemand].sort((a, b) => (b.invPct - b.demPct) - (a.invPct - a.demPct))[0];
    const topZone = zones[0];
    const insightInv = topZone
        ? `Tu mayor concentración está en ${topZone.nb} (${topZone.n} de ${topZone.oferta} propiedades de la zona). `
          + (gap && gap.invPct - gap.demPct > 8
              ? `En el rango ${gap.band} tienes ${Math.round(gap.invPct)}% de tu inventario pero la demanda ahí es ${Math.round(gap.demPct)}% — hay sobreoferta.`
              : `Tu mezcla por rango de precio va en línea con la demanda del mercado.`)
        : '';
    const pOpt = priceLead.find((x) => x.cls === 'Óptimo'), pCaro = priceLead.find((x) => x.cls === 'Fuera de mercado');
    const insightPrecio = `${Math.round(pctCaro * 100)}% de tu venta con referencia está fuera de mercado (${nCaro} props). `
        + (pOpt && pCaro
            ? `Las de precio óptimo reciben ${pOpt.ll.toFixed(1)} leads por propiedad vs ${pCaro.ll.toFixed(1)} las que están fuera de mercado.`
            : '');

    // ===================== FUNNEL (venta vs renta) + ASESORES + RECOMENDACIONES =====================
    // El funnel usa TODO el inventario (incl. vendido/dado de baja), no solo lo publicado hoy, y se
    // mide dentro de la VENTANA DE DESEMPEÑO elegida (antes estaba clavado a YTD, ignorando el filtro).
    const allprops = await db.collection('properties').find({ 'company._id': CID, ...agentFilter },
        { projection: { 'listing.operation': 1, qualityScore: 1, publishedAt: 1, 'status.last': 1, 'status.history': 1, agent: 1 } }).toArray();
    const pid2op = new Map(allprops.map((p) => [String(p._id), gv(p, 'listing', 'operation') as string]));
    const allpids = allprops.map((p) => p._id as ObjectId);
    const zero = () => ({ sale: 0, rent: 0 } as Record<string, number>);
    const inPerf = (d: Date | null) => !!d && d >= PERF.start && d < PERF.end;

    // --- asesores: acumulador por persona (se agrupa por nombre normalizado: la misma persona
    //     puede tener dos cuentas de agente y al dueño le interesa la persona, no la cuenta) ---
    type Ac = { id: string; name: string; leads: Record<string, number>; resp: Record<string, number>;
        fueraSla: Record<string, number>;
        mins: Record<string, number[]>; visitas: Record<string, number>; ofertas: Record<string, number>;
        cierres: Record<string, number>; comision: Record<string, number>; gmv: Record<string, number>;
        busquedas: number; propsCompartidas: number; clientes: Set<string> };
    const ases = new Map<string, Ac>();
    // Primer candidato USABLE (con _id y nombre). No basta con `a ?? b`: en Mongo hay `agent: {}`
    // y `agent: null`, y un objeto vacío cortaría la cadena de fallback perdiendo el evento.
    const pickAgent = (...cands: unknown[]): Document | null => {
        for (const c of cands) {
            const a = c as Document | null | undefined;
            if (a && gv(a, '_id') && agName(a)) return a;
        }
        return null;
    };
    const acc = (name: string | null, id: string): Ac | null => {
        if (!name) return null;
        const k = norm(name);
        let e = ases.get(k);
        if (!e) {
            e = { id, name, leads: zero(), resp: zero(), fueraSla: zero(), mins: { sale: [], rent: [] }, visitas: zero(),
                ofertas: zero(), cierres: zero(), comision: zero(), gmv: zero(),
                busquedas: 0, propsCompartidas: 0, clientes: new Set<string>() };
            ases.set(k, e);
        }
        return e;
    };
    const esInterno = (a: Document | null | undefined): boolean => !!a && internos.has(String(gv(a, '_id')));
    // acumula SOLO si el agente es de la inmobiliaria; si no, devuelve null (y quien llama lo cuenta como externo)
    const accInterno = (a: Document | null | undefined): Ac | null =>
        esInterno(a) ? acc(agName(a), String(gv(a, '_id') || '')) : null;

    // asesores con inventario publicado hoy (para sembrar la tabla y como fallback de atribución)
    const agentsVivos = new Map<string, string>();
    for (const p of allprops) {
        const a = gv(p, 'agent') as Document | undefined;
        const n = agName(a);
        if (!a || !n) continue;
        if (gv(p, 'status', 'last') === 'published') agentsVivos.set(String(gv(a, '_id')), n);
    }
    const pid2agent = new Map(allprops.map((p) => [String(p._id), gv(p, 'agent') as Document | undefined]));
    // Todo asesor con inventario publicado aparece en la tabla aunque no haya tenido actividad en la
    // ventana (un asesor con 0 leads es información, no un hueco). Si trae inventario de la
    // inmobiliaria, cuenta como interno aunque no esté en `agents` (cuentas viejas sin migrar).
    for (const [id, n] of agentsVivos) { if (!internos.has(id)) internos.set(id, n); acc(n, id); }
    let extLeads = 0, extVisitas = 0;   // actividad de brokers de otras inmobiliarias

    const leadsByOp = zero(), contByOp = zero();
    // mismos contadores para el PERÍODO BASE, para poder mostrar el ▲▼ dentro del funnel
    // (antes la comparación solo existía en su propia sección y no se veía en ningún otro lado)
    const leadsPrev = zero(), contPrev = zero(), visPrev = zero(), offPrev = zero(), cloPrev = zero();
    const inCmp = (d: Date | null) => !!d && !!CMP && d >= CMP.start && d < CMP.end;
    const dupPrev = new Set<string>();
    let perfLeadsAll = 0, perfVis = 0, leadsA = 0, leadsB = 0;
    let compCliente = 0, compBroker = 0, compIncont = 0, compDup = 0;
    const dupSet = new Set<string>();   // clave propiedad+contacto → repetición = duplicado
    const seenA = new Set<string>(), seenB = new Set<string>();   // dedup por período de comparación
    const srcCount: Record<string, number> = {};   // leads únicos por fuente (ventana de desempeño)
    const lc = db.collection('leads').find({ 'property._id': { $in: allpids }, createdAt: { $gte: leadScanStart, $lt: PERF.end } },
        { projection: { 'property._id': 1, 'property.agent': 1, agent: 1, answeredAt: 1, createdAt: 1, source: 1, 'contact.phone': 1, 'contact.email': 1, 'contact.company._id': 1, 'contact._id': 1 } });
    for await (const l of lc) {
        const d = asDt(l.createdAt); if (!d) continue;
        const pid = String(gv(l, 'property', '_id'));
        const op = pid2op.get(pid);
        const phone = gv(l, 'contact', 'phone'), email = gv(l, 'contact', 'email');
        const who = phone || email || String(gv(l, 'contact', '_id') || l._id);
        const kk = `${pid}|${who}`;
        if (inPerf(d) && (op === 'sale' || op === 'rent')) {
            // duplicado = mismo contacto en la misma propiedad → se descarta de TODO el funnel
            if (dupSet.has(kk)) { compDup++; }
            else {
                dupSet.add(kk);
                perfLeadsAll++;
                leadsByOp[op]++;
                const broker = !!gv(l, 'contact', 'company', '_id');   // el contacto está asociado a una empresa/inmobiliaria
                if (!(phone || email)) compIncont++;                   // sin teléfono ni correo = incontactable
                if (broker) compBroker++; else compCliente++;
                const ans = asDt(l.answeredAt);
                if (l.answeredAt) contByOp[op]++;
                const sl = srcLabel(l.source); srcCount[sl] = (srcCount[sl] || 0) + 1;
                // asesor RESPONSABLE del lead (agent asignado); si no hay, el de la propiedad
                const la = pickAgent(gv(l, 'agent'), gv(l, 'property', 'agent'), pid2agent.get(pid));
                const e = accInterno(la);
                if (e) {
                    e.leads[op]++;
                    if (ans) {
                        const min = Math.max(0, (ans.getTime() - d.getTime()) / 60000);
                        e.resp[op]++; e.mins[op].push(min);
                        if (min > 1440) e.fueraSla[op]++;       // contestado, pero después de 24 h
                    } else e.fueraSla[op]++;                    // nunca contestado = el peor caso
                } else if (la) extLeads++;
            }
        }
        // el mismo funnel en el período base (dedup propio, sin tocar el del período actual)
        if (inCmp(d) && (op === 'sale' || op === 'rent') && !dupPrev.has(kk)) {
            dupPrev.add(kk);
            leadsPrev[op]++;
            if (l.answeredAt) contPrev[op]++;
        }
        // comparación de períodos (leads únicos dentro de cada rango)
        if (CMP && d >= CMP.start && d < CMP.end && !seenA.has(kk)) { seenA.add(kk); leadsA++; }
        if (inPerf(d) && !seenB.has(kk)) { seenB.add(kk); leadsB++; }
    }
    const visByOp = zero();
    // se escanea desde el inicio de la ventana más vieja para poder llenar también el período base
    const vc = db.collection('visits').find({ 'steps.property._id': { $in: allpids }, 'status.last': { $ne: 'cancelled' }, createdAt: { $gte: leadScanStart, $lt: PERF.end } },
        { projection: { 'steps.property._id': 1, agent: 1, createdAt: 1 } });
    for await (const v of vc) {
        const steps = (v.steps || []) as Document[];
        const mine = steps.map((s) => String(gv(s, 'property', '_id'))).find((id) => pid2op.has(id));
        if (!mine) continue;
        const vd = asDt(v.createdAt);
        const op = pid2op.get(mine);
        if (inCmp(vd) && (op === 'sale' || op === 'rent')) visPrev[op]++;
        if (!inPerf(vd)) continue;
        perfVis++;
        if (op === 'sale' || op === 'rent') {
            visByOp[op]++;
            // asesor que hizo la visita; si no viene, el de la propiedad visitada
            const va = pickAgent(gv(v, 'agent'), pid2agent.get(mine));
            const e = accInterno(va);
            if (e) e.visitas[op]++;
            else if (va) extVisitas++;   // la visita la hizo un broker de otra inmobiliaria
        }
    }
    const offersByOp = zero(), closesByOp = zero();
    const opsAll = await db.collection('operations').find({ 'property._id': { $in: allpids } },
        { projection: { 'status.last': 1, closedAt: 1, createdAt: 1, 'property._id': 1, 'property.agent': 1,
            'seller.broker': 1, 'buyer.broker': 1, 'closeValue.value': 1, 'comission.value': 1 } }).toArray();
    for (const o of opsAll) {
        const pid = String(gv(o, 'property', '_id'));
        const t = pid2op.get(pid);
        if (t !== 'sale' && t !== 'rent') continue;
        const cd = asDt(o.createdAt), xd = asDt(gv(o, 'closedAt'));
        const abierta = inPerf(cd) || inPerf(xd);
        if (abierta) offersByOp[t]++;
        const last = gv(o, 'status', 'last');
        const cerrada = (last === 'closed' || last === 'paying') && inPerf(xd);
        if (cerrada) closesByOp[t]++;
        // mismos pasos en el período base
        if (inCmp(cd) || inCmp(xd)) offPrev[t]++;
        if ((last === 'closed' || last === 'paying') && inCmp(xd)) cloPrev[t]++;
        if (!abierta && !cerrada) continue;
        // la operación se atribuye al primer broker que SÍ es de la inmobiliaria (puede ser el
        // captador o el que trajo al comprador); si ninguno lo es, al asesor de la propiedad.
        const cands = [gv(o, 'seller', 'broker'), gv(o, 'buyer', 'broker'), gv(o, 'property', 'agent')];
        const dentro = cands.find((c) => esInterno(c as Document | null | undefined));
        const oa = pickAgent(dentro, pid2agent.get(pid));
        const e = accInterno(oa);
        if (e) {
            if (abierta) e.ofertas[t]++;
            if (cerrada) {
                e.cierres[t]++;
                e.comision[t] += num(gv(o, 'comission', 'value')) || 0;
                e.gmv[t] += num(gv(o, 'closeValue', 'value')) || 0;
            }
        }
    }
    // --- pipeline del lado COMPRADOR por asesor: búsquedas abiertas en el período y cuántas
    //     propiedades le compartió a cada cliente. `searches.properties[]` = lo que el asesor le
    //     agregó a la búsqueda. Ojo: el 97% de las búsquedas históricas están canceladas, así que
    //     solo tiene sentido contar las ABIERTAS EN EL PERÍODO, no un acumulado. ---
    // Se cuenta con $size en el servidor: `properties` trae fichas completas y traerlas sería carísimo.
    const busqAgg = await db.collection('searches').aggregate([
        { $match: { 'company._id': CID, createdAt: { $gte: PERF.start, $lt: PERF.end }, ...agentFilter } },
        { $group: {
            _id: '$agent._id',
            busquedas: { $sum: 1 },
            props: { $sum: { $size: { $ifNull: ['$properties', []] } } },
            clientes: { $addToSet: '$contact._id' },
        } },
    ], { allowDiskUse: true }).toArray();
    for (const r of busqAgg) {
        const aid = r._id ? String(r._id) : '';
        const nm = internos.get(aid);
        if (!nm) continue;                       // búsqueda de un broker de otra inmobiliaria
        const e = acc(nm, aid);
        if (!e) continue;
        e.busquedas += r.busquedas as number;
        e.propsCompartidas += r.props as number;
        for (const c of (r.clientes as unknown[]) || []) if (c) e.clientes.add(String(c));
    }

    // --- asesores: cerrar promedios/medianas y ordenar por volumen de leads ---
    const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const asesores: AsesorRow[] = [...ases.values()].map((e) => ({
        id: e.id, name: e.name,
        leads: { sale: e.leads.sale, rent: e.leads.rent },
        resp: { sale: e.resp.sale, rent: e.resp.rent },
        fueraSla: { sale: e.fueraSla.sale, rent: e.fueraSla.rent },
        respMinAvg: { sale: avg(e.mins.sale), rent: avg(e.mins.rent) },
        respMinMed: { sale: median(e.mins.sale), rent: median(e.mins.rent) },
        visitas: { sale: e.visitas.sale, rent: e.visitas.rent },
        ofertas: { sale: e.ofertas.sale, rent: e.ofertas.rent },
        cierres: { sale: e.cierres.sale, rent: e.cierres.rent },
        comision: { sale: e.comision.sale, rent: e.comision.rent },
        gmv: { sale: e.gmv.sale, rent: e.gmv.rent },
        busquedas: e.busquedas, propsCompartidas: e.propsCompartidas, clientes: e.clientes.size,
    })).sort((a, b) =>
        (b.leads.sale + b.leads.rent) - (a.leads.sale + a.leads.rent)
        || (b.cierres.sale + b.cierres.rent) - (a.cierres.sale + a.cierres.rent)
        || a.name.localeCompare(b.name, 'es'));
    // "Leads" en vez de "Únicos" (el dedup se explica al pie, no en la etiqueta del paso).
    // `prev` = el mismo paso en el período base → la sección muestra el ▲▼ sin salir de ella.
    const buildFunnel = (title: string, op: string) => {
        const raw: [string, number, number][] = [
            ['Leads', leadsByOp[op], leadsPrev[op]],
            ['Respondidos', contByOp[op], contPrev[op]],
            ['Visitas', visByOp[op], visPrev[op]],
            ['Ofertas', offersByOp[op], offPrev[op]],
            ['Cierres', closesByOp[op], cloPrev[op]],
        ];
        let ant: number | null = null;
        return { title, steps: raw.map(([label, value, pv]) => {
            const rate = ant && ant > 0 ? value / ant : null; ant = value;
            return { label, value, rate, prev: CMP ? pv : null };
        }) };
    };
    const funnel = [buildFunnel('Venta', 'sale'), buildFunnel('Renta', 'rent')]
        .filter((c) => !opFilter || c.title === (opFilter === 'sale' ? 'Venta' : 'Renta'));
    const leadsBySource = Object.entries(srcCount).map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const visRateV = leadsByOp.sale ? visByOp.sale / leadsByOp.sale : 0;
    const closeV = leadsByOp.sale ? closesByOp.sale / leadsByOp.sale : 0;
    const closeR = leadsByOp.rent ? closesByOp.rent / leadsByOp.rent : 0;

    // Referencia real de las mejores inmobiliarias (TOP 20 por cierres) en la misma ventana.
    const bench = await bestAgencies(db, PERF.start, PERF.end, PERF.label);
    const totL = leadsByOp.sale + leadsByOp.rent;
    const visRateTot = totL ? (visByOp.sale + visByOp.rent) / totL : 0;
    const benchTxt = bench.tasaVisita != null
        ? `${pct(visRateTot)} de tus leads llega a visita, contra ${pct(bench.tasaVisita)} de las ${bench.nInmos} inmobiliarias que más cierran. `
            + (visRateTot >= bench.tasaVisita ? 'Estás a la altura de las mejores. ' : 'Ahí está tu principal hueco. ')
        : '';
    const funnelReading = benchTxt
        + `Cierre sobre leads: ${(100 * closeV).toFixed(1)}% en venta y ${(100 * closeR).toFixed(1)}% en renta`
        + (bench.leadToClose != null ? ` (mejores: ${(100 * bench.leadToClose).toFixed(1)}%)` : '')
        + `. La tasa se lee por operación, nunca mezclando venta y renta.`;

    // --- recomendaciones a nivel cartera (nunca priorizan renta sobre venta) ---
    const altaNow = items.filter((it) => it.q3 === 3).length / (N || 1);
    const nNoTour = items.filter((it) => !it.tour).length;
    const visRate = perfLeadsAll ? perfVis / perfLeadsAll : 0;
    const recos: { enfoque: string; title: string; body: string; sev: number }[] = [];
    if (pctCaro >= 0.30) recos.push({ enfoque: 'Precio', sev: 5, title: 'Ajusta el precio de tu inventario en venta',
        body: `${pct(pctCaro)} de tu venta con referencia (${nCaro} props) está fuera de mercado (+20% sobre ACM). Las de precio óptimo reciben ${pOpt ? pOpt.ll.toFixed(1) : '—'} leads por propiedad vs ${pCaro ? pCaro.ll.toFixed(1) : '—'} las que están fuera de mercado. Empieza por los rangos de mayor ticket.` });
    if (visRate < 0.14) recos.push({ enfoque: 'Ficha', sev: 4, title: 'Sube tu tasa de visita',
        body: `Solo el ${pct(visRate)} de tus leads llega a visita${mb ? ', por debajo de una referencia sana de mercado' : ' (benchmark Pulppo 14%)'}. Mejora las primeras 3 fotos, el orden de la galería y la descripción — ahí se decide si el interesado agenda.` });
    if (altaNow < 0.25) recos.push({ enfoque: 'Ficha', sev: 3, title: 'Sube la calidad de tus fichas',
        body: `Solo ${pct(altaNow)} de tus fichas son calidad Alta. Fotos profesionales, video y tour virtual (hoy ${nNoTour} sin tour) elevan la exposición y la conversión sin cambiar el precio.` });
    if (!mb) recos.push({ enfoque: 'Visibilidad', sev: 2, title: 'Enfoca la inversión en visibilidad donde rinde',
        body: `Destacar solo rinde cuando la propiedad ya está bien puesta (precio óptimo + ficha completa). Concentra el impulso en tus ${joyas} propiedades listas — no en las que están fuera de mercado.` });
    if (mb) recos.push({ enfoque: 'Canales', sev: 2, title: 'Diversifica tus canales de captación de leads',
        body: `No dependas de un solo portal. Revisa el mix de fuentes de tus leads y refuerza los canales que mejor te convierten a visita.` });

    // ===================== COMPARACIÓN DE PERÍODOS (desempeño vs su base) =====================
    const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
    const monthEnd = (y: number, m: number) => new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const terminal = (p: Document): Date | null => {
        if (gv(p, 'status', 'last') === 'published') return null;
        const hist = (gv(p, 'status', 'history') || []) as Document[];
        const ts = hist.map((h) => asDt(h.date || h.timestamp || h.createdAt)).filter(Boolean) as Date[];
        return ts.length ? new Date(Math.max(...ts.map((d) => d.getTime()))) : null;
    };
    // 1ª publicación real: publishedAt se reinicia al republicar, así que la foto histórica de
    // inventario se toma del status.history (igual que la antigüedad de la ficha y de /mb).
    const firstPub = (p: Document): Date | null => {
        const hist = (gv(p, 'status', 'history') || []) as Document[];
        const ds = hist.filter((h) => h.status === 'published').map((h) => asDt(h.date || h.timestamp || h.createdAt)).filter(Boolean) as Date[];
        return ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))) : asDt(p.publishedAt);
    };
    const propMeta = allprops.map((p) => ({ pub: firstPub(p), term: terminal(p), q3: num(p.qualityScore) }));
    const activeAt = (end: Date) => propMeta.filter((p) => p.pub && p.pub < end && (p.term === null || p.term > end));
    const closeWindow = (a: Date, b: Date) => {
        const r = { n: 0, sale: 0, rent: 0, com: 0, gmv: 0 };
        for (const o of opsAll) {
            const last = gv(o, 'status', 'last'); const xd = asDt(gv(o, 'closedAt'));
            if (!(last === 'closed' || last === 'paying') || !xd || xd < a || xd >= b) continue;
            const t = pid2op.get(String(gv(o, 'property', '_id')));
            r.n++; if (t === 'sale') r.sale++; else r.rent++;
            r.com += num(gv(o, 'comission', 'value')) || 0;
            if (t === 'sale') r.gmv += num(gv(o, 'closeValue', 'value')) || 0;
        }
        return r;
    };
    // inventario = foto al cierre de cada período; leads/cierres/comisión = flujo dentro del período
    const hasComp = !!CMP;
    const rngA = CMP ?? { start: PERF.start, end: PERF.end, label: '—' };
    const actA = activeAt(rngA.end), actB = activeAt(PERF.end);
    const invA = actA.length, invB = actB.length;
    const altaA = actA.filter((p) => p.q3 === 3).length / (invA || 1), altaB = actB.filter((p) => p.q3 === 3).length / (invB || 1);
    const clA = closeWindow(rngA.start, rngA.end), clB = closeWindow(PERF.start, PERF.end);
    const tcA = clA.n / (leadsA || 1), tcB = clB.n / (leadsB || 1);
    const yoy: AnalisisData['yoy'] = !hasComp ? [] : [
        { label: 'Inventario activo (fin período)', a: invA, b: invB, fmt: 'int', goodUp: true },
        { label: 'Leads únicos del período', a: leadsA, b: leadsB, fmt: 'int', goodUp: true },
        { label: 'Leads por propiedad', a: leadsA / (invA || 1), b: leadsB / (invB || 1), fmt: 'dec', goodUp: true },
        { label: 'Calidad Alta (ficha de hoy)', a: altaA, b: altaB, fmt: 'pct', goodUp: true },
        { label: 'Cierres', a: clA.n, b: clB.n, fmt: 'int', goodUp: true },
        { label: 'Comisión', a: clA.com, b: clB.com, fmt: 'money', goodUp: true },
        { label: 'Tasa de cierre (leads→cierre)', a: tcA, b: tcB, fmt: 'pct2', goodUp: true },
    ];
    const yoyMix = !hasComp ? [] : [{ period: rngA.label, sale: clA.sale, rent: clA.rent, com: clA.com }, { period: PERF.label, sale: clB.sale, rent: clB.rent, com: clB.com }];
    // sin base (comisión 0 en el período anterior) un % sería falso: se dice en palabras
    const deltaTxt = clA.com > 0
        ? `${clB.com >= clA.com ? '+' : ''}${Math.round((100 * (clB.com - clA.com)) / clA.com)}%`
        : clB.com > 0 ? 'sin base para comparar' : 'sin comisión en ninguno de los dos';
    const yoyReading = !hasComp
        ? `Estás viendo ${PERF.label} sin comparación. Elige una base ("período anterior" o "mismo período del año pasado") para ver la variación.`
        : `Comisión ${money(clA.com)} → ${money(clB.com)} (${deltaTxt}) de ${rngA.label} a ${PERF.label}. El motor son las ventas: en ${PERF.label} se cerraron ${clB.sale}.`;

    // ===================== Top 10 críticas =====================
    const cand10 = [];
    for (const it of items) {
        if (it.op !== 'sale') continue;
        const leads = leadsByPid[String(it.pid)] || 0;
        const dz = (it.nbid && demandByNb[it.nbid]) || 0;
        const spV = it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null;
        const fueraMercado = spV != null && spV > 1.20;
        const lev: string[] = [];
        if (spV && spV > 1.15) lev.push('Bajar precio');
        // Destacar solo si el precio NO está fuera de mercado (la visibilidad no arregla el sobreprecio). No en MB.
        if (!mb && (it.tier === null || it.tier === 'Simple' || it.tier === 'Offline') && !fueraMercado) lev.push('Destacar');
        // Mejorar ficha: detallar qué falta en vez de decirlo genérico.
        const falta: string[] = [];
        if (it.fotos < 8) falta.push('fotos');
        if (!it.tour) falta.push('tour');
        if (it.descLen < 400) falta.push('descripción');
        if (!it.video) falta.push('video');
        if (((it.q3 || 2) <= 2 || !it.tour || it.fotos < 8) && falta.length) lev.push(`Mejorar ficha: ${falta.join(', ')}`);
        if (!lev.length || dz <= 0) continue;
        cand10.push({ code: it.code || '—', nb: it.nb || '—', val: it.val, sp: spV, leads, dz, lev, score: dz / (1 + leads) });
    }
    const top10 = cand10.sort((a, b) => b.score - a.score).slice(0, 10)
        .map(({ code, nb, val, sp, leads, dz, lev }) => ({ code, nb, val, sp, leads, dz, lev }));

    // ===================== DESTACADOS (nivel de aviso + L/L) =====================
    const MES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const TIER_ORDER = ['Súper destacado', 'Destacado', 'Simple', 'Offline'];
    const MONTHS: [number, number][] = [];
    for (let m = 1; m <= NOW.getUTCMonth() + 1; m++) MONTHS.push([NOW.getUTCFullYear(), m]);
    const mkey = (y: number, m: number) => `${y}-${m}`;

    const histProps = await db.collection('properties').find(
        { 'company._id': CID, 'portals.inmuebles24': { $exists: true } },
        { projection: { 'portals.inmuebles24.history': 1, 'portals.inmuebles24.type': 1, updatedAt: 1 } }
    ).toArray();
    const pid2seq = new Map<string, [Date, string | null][]>();
    const monthTierAll: Record<string, Record<string, number>> = {};
    const monthTierOp: Record<'sale' | 'rent', Record<string, Record<string, number>>> = { sale: {}, rent: {} };
    for (const [y, m] of MONTHS) { monthTierAll[mkey(y, m)] = {}; monthTierOp.sale[mkey(y, m)] = {}; monthTierOp.rent[mkey(y, m)] = {}; }
    for (const p of histProps) {
        const i24 = (gv(p, 'portals', 'inmuebles24') || {}) as Document;
        const seq = ((i24.history as Document[]) || [])
            .map((h) => [asDt(h.timestamp), tierName(h.type)] as [Date | null, string | null])
            .filter((x): x is [Date, string | null] => !!x[0]);
        const cur = tierName(i24.type);
        if (cur) seq.push([asDt(p.updatedAt) || NOW, cur]);
        seq.sort((a, b) => a[0].getTime() - b[0].getTime());
        pid2seq.set(String(p._id), seq);
        const pop = pid2op.get(String(p._id));
        for (const [y, m] of MONTHS) {
            const end = monthEnd(y, m); let st: string | null = null;
            for (const [dd, tt] of seq) { if (dd < end) st = tt; else break; }
            if (st && st !== 'Offline') {
                monthTierAll[mkey(y, m)][st] = (monthTierAll[mkey(y, m)][st] || 0) + 1;
                if (pop === 'sale' || pop === 'rent') monthTierOp[pop][mkey(y, m)][st] = (monthTierOp[pop][mkey(y, m)][st] || 0) + 1;
            }
        }
    }
    const avmOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    for (const op of ['sale', 'rent'] as const) for (const t of TIER_ORDER)
        avmOp[op][t] = MONTHS.reduce((s, [y, m]) => s + (monthTierOp[op][mkey(y, m)][t] || 0), 0);
    const tierAt = (pid: string, d: Date): string | null => {
        let st: string | null = null;
        for (const [t, tt] of (pid2seq.get(pid) || [])) { if (t.getTime() <= d.getTime()) st = tt; else break; }
        return st;
    };
    // leads YTD (únicos) atribuidos al nivel que tenía el aviso cuando llegó el contacto
    const tlYtdOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    const dSeen = new Set<string>();
    const dc = db.collection('leads').find({ 'property._id': { $in: allpids }, createdAt: { $gte: YTD0 } },
        { projection: { 'property._id': 1, createdAt: 1, 'contact.phone': 1, 'contact.email': 1, 'contact._id': 1 } });
    for await (const l of dc) {
        const d = asDt(l.createdAt); if (!d) continue;
        const pid = String(gv(l, 'property', '_id')); const op = pid2op.get(pid);
        if (op !== 'sale' && op !== 'rent') continue;
        const who = gv(l, 'contact', 'phone') || gv(l, 'contact', 'email') || String(gv(l, 'contact', '_id') || l._id);
        const k = `${pid}|${who}`; if (dSeen.has(k)) continue; dSeen.add(k);
        const st = tierAt(pid, d);
        if (st && st !== 'Offline') tlYtdOp[op][st] = (tlYtdOp[op][st] || 0) + 1;
    }
    const tierNowOp: Record<'sale' | 'rent', Record<string, number>> = { sale: {}, rent: {} };
    for (const it of items) if (it.op === 'sale' || it.op === 'rent') { const t = it.tier || 'Sin i24'; tierNowOp[it.op][t] = (tierNowOp[it.op][t] || 0) + 1; }
    const sdNow = (tierNowOp.sale['Súper destacado'] || 0) + (tierNowOp.rent['Súper destacado'] || 0);
    const dNow = (tierNowOp.sale['Destacado'] || 0) + (tierNowOp.rent['Destacado'] || 0);
    const simpleNow = (tierNowOp.sale['Simple'] || 0) + (tierNowOp.rent['Simple'] || 0);
    const llTier = ['Súper destacado', 'Destacado', 'Simple'].map((t) => ({
        tier: t,
        saleLL: avmOp.sale[t] >= 3 ? (tlYtdOp.sale[t] || 0) / avmOp.sale[t] : null, saleLeads: tlYtdOp.sale[t] || 0,
        rentLL: avmOp.rent[t] >= 3 ? (tlYtdOp.rent[t] || 0) / avmOp.rent[t] : null, rentLeads: tlYtdOp.rent[t] || 0,
    }));
    const boostOp = (op: 'sale' | 'rent'): number | null => {
        const s = avmOp[op]['Simple'] >= 3 ? (tlYtdOp[op]['Simple'] || 0) / avmOp[op]['Simple'] : null;
        const cand = ['Súper destacado', 'Destacado'].filter((t) => avmOp[op][t] >= 3).map((t) => (tlYtdOp[op][t] || 0) / avmOp[op][t]);
        if (!s || !cand.length) return null;
        return Math.max(...cand) / s;
    };
    const bv = boostOp('sale'), br = boostOp('rent');
    const rindeTxt = (op: string, b: number | null) => b === null
        ? `en ${op} casi no has destacado (sin datos para comparar)`
        : b >= 1.15 ? `en ${op} destacar rinde ${b.toFixed(1)}× más` : `en ${op} destacar no rinde más que el simple`;
    let destReading = `Con tus datos, ${rindeTxt('venta', bv)} y ${rindeTxt('renta', br)}.`;
    if (sdNow + dNow === 0) destReading += ` Hoy tienes 0 avisos destacados — enfoca el impulso en tus ${joyas} propiedades competitivas y de buena calidad.`;
    const destacados = {
        sdNow, dNow, simpleNow, pctDest: (sdNow + dNow) / (N || 1),
        splits: {
            sd: { sale: tierNowOp.sale['Súper destacado'] || 0, rent: tierNowOp.rent['Súper destacado'] || 0 },
            d: { sale: tierNowOp.sale['Destacado'] || 0, rent: tierNowOp.rent['Destacado'] || 0 },
            simple: { sale: tierNowOp.sale['Simple'] || 0, rent: tierNowOp.rent['Simple'] || 0 },
        },
        monthly: MONTHS.map(([y, m]) => ({
            month: MES[m], tiers: TIER_ORDER.map((t) => ({ tier: t, n: monthTierAll[mkey(y, m)][t] || 0 })),
            dest: (monthTierAll[mkey(y, m)]['Súper destacado'] || 0) + (monthTierAll[mkey(y, m)]['Destacado'] || 0),
        })),
        llTier, reading: destReading,
    };

    // ===================== SWAPS DE DESTACADO =====================
    // Qué aviso conviene SACAR del slot y qué METER, con la razón. Presupuesto-neutro: se propone
    // el mismo número de slots que ya se paga, así el KAM no tiene que pedir más inversión.
    //
    // Regla de fondo: destacar solo rinde cuando la propiedad ya está bien puesta. Un aviso
    // destacado con precio fuera de mercado no convierte — la visibilidad no arregla el sobreprecio.
    const DEST = new Set(['Súper destacado', 'Destacado']);
    const calOf = (q: number | null) => CAL[q as number] || 'Media';
    const mkSwap = (it: Item, razon: string): SwapProp => ({
        code: it.code || '—', nb: it.nb || '—', val: it.val, tier: it.tier || 'Simple',
        sp: it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null,
        calidad: calOf(it.q3), leads: leadsByPid[String(it.pid)] || 0,
        demanda: (it.nbid && demandByNb[it.nbid]) || 0, razon,
    });
    // --- candidatas a SALIR: destacadas hoy que no están aprovechando el slot ---
    const salen: { s: SwapProp; sev: number }[] = [];
    for (const it of items) {
        if (!it.tier || !DEST.has(it.tier)) continue;
        const spV = it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null;
        const lds = leadsByPid[String(it.pid)] || 0;
        const cal = calOf(it.q3);
        if (spV != null && spV > 1.20)
            salen.push({ s: mkSwap(it, `está ${Math.round((spV - 1) * 100)}% arriba del ACM: destacar no arregla el sobreprecio`), sev: 3 });
        else if (cal === 'Baja')
            salen.push({ s: mkSwap(it, 'ficha en calidad Baja: el tráfico llega a una publicación floja'), sev: 2 });
        else if (lds === 0)
            salen.push({ s: mkSwap(it, `destacada y sin un solo lead en ${PERF.label}`), sev: 1 });
    }
    salen.sort((a, b) => b.sev - a.sev || b.s.val - a.s.val);
    // --- candidatas a ENTRAR: bien puestas, con demanda en su zona y sin explotar ---
    const entran = items
        .filter((it) => {
            if (it.tier && DEST.has(it.tier)) return false;             // ya está destacada
            const spV = it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null;
            if (spV != null && spV > 1.20) return false;                // fuera de mercado: no destacar
            if (calOf(it.q3) === 'Baja') return false;                  // ficha floja: primero arreglarla
            return ((it.nbid && demandByNb[it.nbid]) || 0) > 0;         // tiene que haber quién la busque
        })
        .map((it) => {
            const lds = leadsByPid[String(it.pid)] || 0;
            const dem = (it.nbid && demandByNb[it.nbid]) || 0;
            return { it, score: dem / (1 + lds), lds, dem };
        })
        .sort((a, b) => b.score - a.score)
        .map(({ it, lds, dem }) => {
            const cal = calOf(it.q3);
            const spV = it.sp != null && it.sp > 0.2 && it.sp < 3 ? it.sp : null;
            const precioTxt = spV == null ? 'sin ACM para comparar'
                : spV <= 1.05 ? 'precio óptimo' : 'precio con margen (≤ +20% del ACM)';
            return mkSwap(it, `${precioTxt}, ficha ${cal}, ${dem.toLocaleString('es-MX')} búsquedas en su zona y ${lds === 0 ? 'ningún lead' : `solo ${lds} ${lds === 1 ? 'lead' : 'leads'}`}`);
        });
    const nSwaps = Math.min(salen.length, entran.length, 8);
    const swaps = Array.from({ length: nSwaps }, (_, i) => ({ sale: salen[i].s, entra: entran[i] }));
    const swapsNota = (sdNow + dNow) === 0
        ? 'Hoy no hay avisos destacados, así que no hay nada que intercambiar: la propuesta sería empezar a destacar las propiedades bien puestas con demanda en su zona.'
        : swaps.length === 0
            ? 'Tus avisos destacados están bien elegidos: ninguno está fuera de mercado, con ficha Baja ni sin leads. No hay swap que proponer.'
            : `${swaps.length} ${swaps.length === 1 ? 'intercambio' : 'intercambios'} sin gastar un peso más: sale un aviso que no está aprovechando el slot y entra uno que sí puede. `
              + `Se propone el mismo número de slots que ya pagas.`;

    // ===================== SIN ACTIVIDAD (props sin lead en la ventana de desempeño) =====================
    // Ya no tiene su propio selector: "sin actividad" se lee SIEMPRE en la ventana de desempeño,
    // que es la misma con la que se leen el funnel y los asesores.
    const withLead = new Set<string>();
    const zc = db.collection('leads').find({ 'property._id': { $in: pubIds }, createdAt: { $gte: PERF.start, $lt: PERF.end } }, { projection: { 'property._id': 1 } });
    for await (const l of zc) withLead.add(String(gv(l, 'property', '_id')));
    const zombieUniverse = opFilter ? items.filter((it) => it.op === opFilter) : items;
    const zombieN = zombieUniverse.filter((it) => !withLead.has(String(it.pid))).length;
    const zombie = { n: zombieN, pct: zombieN / (zombieUniverse.length || 1), label: PERF.label };

    const totVis = visByOp.sale + visByOp.rent;
    return {
        company: CNAME, corte: NOW.toISOString(), N, opSplit,
        llProp: leadsWinTotal / (N || 1), leadsLabel, demandaLabel, ofertaLabel, asesores,
        externo: {
            leads: extLeads, visitas: extVisitas,
            pctLeads: extLeads / ((leadsByOp.sale + leadsByOp.rent + extLeads) || 1),
            pctVisitas: extVisitas / ((totVis + extVisitas) || 1),
        },
        bench, asesorFiltro: asesorSel,
        operacion: cfg.operacion || 'Ambas', zombie, leadsBySource, cierresLabel, segTipo, segOp, benchmarkMarket,
        leadsComp: { cliente: compCliente, broker: compBroker, incontactables: compIncont, duplicados: compDup, total: leadsByOp.sale + leadsByOp.rent, totalOp: { sale: leadsByOp.sale, rent: leadsByOp.rent } },
        zones, invVsDemand, matrix, priceLead,
        joyas, joyasAlta, caras, nSale, nCaro, pctCaro,
        insightInv, insightPrecio,
        funnel, funnelReading, recos,
        compLabels: { a: rngA.label, b: PERF.label }, hasComp,
        yoy, yoyMix, yoyReading, top10, destacados, swaps, swapsNota,
    };
}
