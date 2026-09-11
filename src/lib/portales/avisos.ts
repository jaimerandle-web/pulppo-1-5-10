// Avisos destacados de inmuebles24, EN VIVO.
//
// Reemplaza el snapshot estático (`public/avisos.html` con los datos embebidos, que se
// generaba con una cadena de CSVs y llevaba tres semanas sin refrescar: 3,722 avisos vivos no
// aparecían y 613 ya vendidos seguían en la tabla).
//
// El criterio completo está en SPEC_SCORING.md del repo de análisis de portales. Lo que hay
// que saber para tocar esto:
//
//  · Sólo el Súper Destacado mueve leads: 1.26× medido intra-aviso. El Destacado da 0.97×
//    con IC [0.90, 1.04] — o sea nada.
//  · El COSTO sale del tipo CRUDO de i24, no del tier del scoring: `OFFLINE` (no publicado)
//    y `GRATIS_COMBO` cuestan $0 y son el 27% de los avisos publicados de la red. Cobrarlos
//    a $15 infla el gasto.
//  · `demanda` se deduplica por persona (`contact._id`), y el fallback por nombre de colonia
//    NO es opcional: sólo 82% de las búsquedas traen coordenadas y las que no vienen como
//    [null, null], no ausentes.
//  · El precio se compara contra la mediana de su COLONIA Y TIPO. Sin segmentar por tipo, un
//    terreno de 10,000 m² se compara contra departamentos y parece ganga.
//
// Rendimiento medido (10-sep-2026): cargar el mercado son ~6 s (26,800 avisos del MLS +
// 85,000 búsquedas con geo) y se cachea; calcular una inmobiliaria completa toma 0.3–0.8 s.
import { getDb } from '../data';
import { getKam } from '../kam';

// Se recalcula UNA VEZ AL DÍA y sólo si alguien entra: si nadie abre la herramienta, no se
// genera nada. Una vez calculado queda listo el resto del día, así que el KAM y la
// inmobiliaria ven lo mismo aunque entren a horas distintas.
const TTL_MERCADO = 24 * 60 * 60 * 1000;
const TTL_INMO = 24 * 60 * 60 * 1000;
const VENTANA_DEMANDA = 180;            // días de búsquedas guardadas
const VENTANA_COMPETENCIA = 90;         // días de antigüedad del aviso rival
const RADIO_KM = 1.5;
const UMBRAL_CARO = 1.30;               // veces la mediana de su colonia y tipo
const UMBRAL_CALIDAD = 95;              // escala real de i24, 0–100
const MIN_COMPARABLES = 5;              // avisos para poder calcular la mediana de colonia

// ⚠️ `OFFLINE` NO significa que el aviso esté apagado. Es un bug conocido de i24: cuando su
// API no devuelve la información del aviso (problema de API key de su lado) el tipo llega como
// OFFLINE aunque la propiedad SÍ esté publicada. Se trata como Simple, que es lo que realmente
// es. Consecuencia: el gasto de la red es MAYOR de lo que se calculaba tratándolos como $0
// (2,223 avisos × $15 = $33,345/mes que no se estaban contando).
/** Precio de lista por tipo CRUDO de i24. GRATIS no cuesta; OFFLINE es Simple (ver arriba). */
const PRECIO: Record<string, number> = {
    HOME_COMBO_ZONA_DEMAND: 785, HOME_ZONA_DEMAND: 785,
    HOME_COMBO: 523, HOME: 523,
    DESTACADO_COMBO_ZONA_DEMAND: 420, DESTACADO_ZONA_DEMAND: 420,
    DESTACADO_COMBO: 315, DESTACADO: 315,
    SIMPLE_COMBO: 15, SIMPLE: 15,
    GRATIS_COMBO: 0, GRATIS: 0, OFFLINE: 15,
};
/** Precio por tier ya normalizado, para el desglose de "lo que tiene contratado hoy". */
const PRECIO_TIER: Record<string, number> = {
    SD_ZD: 785, SD: 523, DEST_ZD: 420, DEST: 315, SIMPLE: 15, GRATIS: 0,
};
/** Lift por tier. Se usa para DESCONTAR el boost que el aviso ya trae, no para proyectar. */
const LIFT: Record<string, number> = {
    SD_ZD: 1.329, SD: 1.26, DEST_ZD: 1.023, DEST: 0.97, SIMPLE: 1, GRATIS: 1,
};
const NOMBRE_TIER: Record<string, string> = {
    SD_ZD: 'Súper Destacado ZD', SD: 'Súper Destacado', DEST_ZD: 'Destacado ZD',
    DEST: 'Destacado', SIMPLE: 'Simple', GRATIS: 'Gratis',
};
const PAGADOS = new Set(['SD_ZD', 'SD', 'DEST_ZD', 'DEST']);
// Comercial no compite por lugares destacados: el criterio es residencial de venta.
const COMERCIAL = new Set(['Bodega', 'Nave', 'Local', 'Oficina', 'Edificio']);
const COSTO_SUBIR = PRECIO.HOME_COMBO - PRECIO.SIMPLE_COMBO;   // $508: el Simple ya se pagaba
const LIFT_SD = 0.26, MESES_PROY = 6, LEAD_A_CIERRE = 0.00566;

export type Aviso = {
    id: string; broker: string; tipo: string; operacion: string;
    precio: number; comisionPct: number | null; comision: number;
    colonia: string | null; municipio: string | null;
    tier: string; tierNombre: string; costo: number;
    fotos: number; videos: number; calidad: number | null;
    demanda: number; competencia: number; tension: number;
    precioVsZona: number | null; leadsMes: number; base: number;
    puntos: number; estado: string; falta: string;
    /** Todas las etiquetas que aplican. Un aviso puede tener varias a la vez. */
    tags: string[];
    /** false para renta y terreno: nunca compiten por un lugar destacado. */
    destacable: boolean;
    leadsExtra: number; comisionEsperada: number; roi: number;
    exclusiva: boolean; p1510: boolean;
};

export type DatosInmo = {
    inmobiliaria: string; kam: string;
    ventaViva: number; terrenosVenta: number; analizados: number;
    inventarioTotal: number; rentas: number; destacados: number; gastoMes: number; gratis: number;
    tiers: { tier: string; n: number; venta: number; costo: number }[];
    estados: Record<string, number>;
    comisionArreglable: number;
    leadsAno: number;
    avisos: Aviso[];
    calculadoEn: string; ms: number;
};

// ───────────────────────────────────────── utilidades
function coords(a: unknown): [number, number] | null {
    const c = (a as { location?: { coordinates?: unknown } })?.location?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return null;
    const lon = Number(c[0]), lat = Number(c[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return null;
    return [lon, lat];
}

/** Tier a partir del tipo crudo de i24. El `.type` vivo manda sobre el historial. */
function tierDe(raw: unknown): string {
    const t = String(raw ?? '').toUpperCase();
    const zd = t.includes('ZONA_DEMAND');
    if (t.startsWith('HOME')) return zd ? 'SD_ZD' : 'SD';
    if (t.startsWith('DESTACADO')) return zd ? 'DEST_ZD' : 'DEST';
    if (t.startsWith('GRATIS')) return 'GRATIS';
    return 'SIMPLE';                       // incluye OFFLINE: ver la nota de PRECIO
}

function mediana(v: number[]): number | null {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Lift del boost según la tensión del aviso, por cuartil (spec §4.1). */
function liftTension(t: number, q50: number, q75: number): number {
    if (!Number.isFinite(t)) return 1;
    if (t >= q75) return 1.47;
    if (t >= q50) return 1.22;
    return 0.81;
}

// ── Índice espacial. Sin esto cada aviso recorre las 85,000 búsquedas y los 26,000 avisos del
// mercado, y una inmobiliaria de 250 avisos son 28 millones de comparaciones (medido: 12 s).
// Con una rejilla de ~1.5 km sólo se miran las 9 celdas vecinas.
const CELDA = 0.0135;   // grados ≈ 1.5 km de latitud
const celdaDe = (lat: number, lon: number) =>
    `${Math.floor(lat / CELDA)}|${Math.floor(lon / CELDA)}`;

// La rejilla se parte además por OPERACIÓN: una venta nunca compite contra una renta, así
// que filtrar antes de entrar al bucle quita la mitad de las comparaciones.
function construirRejilla(
    lat: Float64Array | number[], lon: Float64Array | number[], op: string[],
) {
    const g = new Map<string, number[]>();
    for (let i = 0; i < lat.length; i++) {
        if (!Number.isFinite(lat[i]) || !Number.isFinite(lon[i])) continue;
        const k = `${op[i]}~${celdaDe(lat[i], lon[i])}`;
        const a = g.get(k);
        if (a) a.push(i); else g.set(k, [i]);
    }
    return g;
}

/**
 * Recorre las 9 celdas vecinas SIN construir un array intermedio. Con spread, una cuenta
 * grande alocaba cientos de miles de arrays y era el grueso del tiempo.
 */
function porVecinos(
    g: Map<string, number[]>, op: string, lat: number, lon: number, fn: (i: number) => void,
) {
    const cy = Math.floor(lat / CELDA), cx = Math.floor(lon / CELDA);
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const a = g.get(`${op}~${cy + dy}|${cx + dx}`);
            if (!a) continue;
            for (let j = 0; j < a.length; j++) fn(a[j]);
        }
    }
}

// ───────────────────────────────────────── el mercado (caro, se cachea)
type Mercado = {
    mlsLat: Float64Array; mlsLon: Float64Array; mlsPre: Float64Array;
    mlsTipo: string[]; mlsOp: string[];
    bLat: Float64Array; bLon: Float64Array; bMin: Float64Array; bMax: Float64Array;
    bOp: string[]; bPersona: string[]; bColonia: (string | null)[]; bTipos: Set<string>[];
    /** mediana de $/m² por `colonia|tipo`, sólo donde hay 5+ avisos vivos */
    medianaM2: Map<string, number>;
    /** rejillas espaciales: celda → índices. Sin esto el cálculo es 15× más lento. */
    gMls: Map<string, number[]>;
    gBusq: Map<string, number[]>;
    /** búsquedas SIN coordenadas, indexadas por nombre de colonia (18% de los casos) */
    bPorColonia: Map<string, number[]>;
    ts: number;
};
let mercado: Mercado | null = null;
let cargando: Promise<Mercado> | null = null;

async function cargarMercado(): Promise<Mercado> {
    const db = await getDb();
    const desdeC = new Date(Date.now() - VENTANA_COMPETENCIA * 864e5);
    const desdeD = new Date(Date.now() - VENTANA_DEMANDA * 864e5);

    // ── competencia: el mercado REAL de i24, no el inventario de Pulppo
    // 🔴 NO filtrar por `publishedAt >= hoy - 90 días`. El spec lo pide, pero medido el
    //    11-sep-2026 ese filtro deja el mercado en 911 de 26,590 avisos: mata el 96.6%. En
    //    `mls`, `publishedAt` es cuándo se publicó POR PRIMERA VEZ, no actividad reciente, y
    //    la mayoría del inventario vivo lleva más de un año anunciado. `status.last !=
    //    cancelled` ya garantiza que el aviso sigue vivo, que es lo que importa para competir.
    const [mls, busq, props] = await Promise.all([
        db.collection('mls').find(
        { 'import.source': 'inmuebles24', 'status.last': { $ne: 'cancelled' } },
            { projection: { 'address.location.coordinates': 1, type: 1,
                            'listing.operation': 1, 'listing.value': 1 } }).toArray(),
        db.collection('searches').find(
            { createdAt: { $gte: desdeD }, 'filters.addresses.0': { $exists: true } },
            { projection: { 'filters.addresses': 1, 'filters.price': 1,
                            'filters.operation': 1, 'filters.types': 1, contact: 1 } }).toArray(),
        db.collection('properties').find(
            { 'status.last': 'published' },
            { projection: { type: 1, 'address.neighborhood.name': 1, 'listing.value': 1,
                            'attributes.totalSurface': 1 } }).toArray(),
    ]);
    const mL: number[] = [], mO: number[] = [], mP: number[] = [], mT: string[] = [], mOp: string[] = [];
    for (const m of mls) {
        const c = coords(m.address);
        const v = Number(m.listing?.value);
        if (!c || !Number.isFinite(v) || v <= 0) continue;
        mO.push(c[0]); mL.push(c[1]); mP.push(v);
        mT.push(String(m.type ?? '')); mOp.push(String(m.listing?.operation ?? ''));
    }

    // ── demanda: búsquedas guardadas, una fila por (búsqueda × zona)
    const bL: number[] = [], bO: number[] = [], bmin: number[] = [], bmax: number[] = [];
    const bOp: string[] = [], bPer: string[] = [], bCol: (string | null)[] = [], bTip: Set<string>[] = [];
    for (const s of busq) {
        const f = (s.filters ?? {}) as Record<string, unknown>;
        const pr = (f.price ?? {}) as { min?: number; max?: number };
        const per = String((s.contact as { _id?: unknown })?._id ?? s.contact ?? '');
        const tipos = new Set<string>(((f.types as string[]) ?? []).map(String));
        for (const a of ((f.addresses as unknown[]) ?? [])) {
            const c = coords(a);
            const nb = (a as { neighborhood?: { name?: string } })?.neighborhood?.name ?? null;
            // sin geo la búsqueda NO se tira: entra por nombre de colonia (18% de los casos)
            bO.push(c ? c[0] : NaN); bL.push(c ? c[1] : NaN);
            bmin.push(Number(pr.min ?? 0)); bmax.push(Number(pr.max ?? Number.MAX_SAFE_INTEGER));
            bOp.push(String(f.operation ?? '')); bPer.push(per);
            bCol.push(nb ? nb.toLowerCase().trim() : null); bTip.push(tipos);
        }
    }

    // ── referencia de precio: mediana de $/m² por colonia Y tipo del inventario vivo
    const pool = new Map<string, number[]>();
    for (const p of props) {
        const col = p.address?.neighborhood?.name, m2 = Number(p.attributes?.totalSurface);
        const v = Number(p.listing?.value);
        if (!col || !Number.isFinite(m2) || m2 <= 0 || !Number.isFinite(v) || v <= 0) continue;
        const k = `${String(col).toLowerCase().trim()}|${String(p.type ?? '')}`;
        const arr = pool.get(k);
        if (arr) arr.push(v / m2); else pool.set(k, [v / m2]);
    }
    const medianaM2 = new Map<string, number>();
    for (const [k, v] of pool) if (v.length >= MIN_COMPARABLES) medianaM2.set(k, mediana(v)!);

    const bPorColonia = new Map<string, number[]>();
    for (let i = 0; i < bCol.length; i++) {
        if (Number.isFinite(bL[i])) continue;          // las que sí traen geo van por rejilla
        const k = bCol[i];
        if (!k) continue;
        const a = bPorColonia.get(k);
        if (a) a.push(i); else bPorColonia.set(k, [i]);
    }
    return {
        gMls: construirRejilla(mL, mO, mOp), gBusq: construirRejilla(bL, bO, bOp), bPorColonia,
        mlsLat: Float64Array.from(mL), mlsLon: Float64Array.from(mO),
        mlsPre: Float64Array.from(mP), mlsTipo: mT, mlsOp: mOp,
        bLat: Float64Array.from(bL), bLon: Float64Array.from(bO),
        bMin: Float64Array.from(bmin), bMax: Float64Array.from(bmax),
        bOp, bPersona: bPer, bColonia: bCol, bTipos: bTip,
        medianaM2, ts: Date.now(),
    };
}

/** El mercado, cacheado. Las peticiones concurrentes comparten la misma carga. */
export async function getMercado(forzar = false): Promise<Mercado> {
    if (!forzar && mercado && Date.now() - mercado.ts < TTL_MERCADO) return mercado;
    if (!cargando) {
        cargando = cargarMercado()
            .then((m) => { mercado = m; return m; })
            .finally(() => { cargando = null; });
    }
    return cargando;
}

// ───────────────────────────────────────── una inmobiliaria, en vivo
const cacheInmo = new Map<string, { d: DatosInmo; ts: number }>();

export async function datosDe(inmo: string, forzar = false): Promise<DatosInmo> {
    const hit = cacheInmo.get(inmo);
    if (!forzar && hit && Date.now() - hit.ts < TTL_INMO) return hit.d;

    const t0 = Date.now();
    const db = await getDb();
    const M = await getMercado();

    const props = await db.collection('properties').find(
        { 'company.name': inmo, 'status.last': 'published' },
        { projection: {
            internalId: 1, type: 1, listing: 1, address: 1, contract: 1, agent: 1,
            pictures: 1, videos: 1, virtualTour: 1, attributes: 1,
            'portals.inmuebles24.type': 1, 'portals.inmuebles24.quality': 1,
        } },
    ).toArray();

    // leads de los últimos 12 meses, por propiedad
    const hasta = new Date(); hasta.setUTCDate(1); hasta.setUTCHours(0, 0, 0, 0);
    const desde = new Date(hasta.getTime() - 365 * 864e5);
    const ids = props.map((p) => p._id);
    const leads = await db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: ids }, createdAt: { $gte: desde, $lt: hasta } } },
        { $group: { _id: '$property._id', n: { $sum: 1 } } },
    ]).toArray();
    const leadsPorProp = new Map(leads.map((l) => [String(l._id), l.n as number]));
    const leadsAno = await db.collection('leads').countDocuments(
        { 'company.name': inmo, createdAt: { $gte: desde, $lt: hasta } });

    // ── censo: lo que la inmobiliaria ve en su propio sistema
    let ventaViva = 0, terrenosVenta = 0, rentas = 0, gastoMes = 0, gratis = 0;
    const cuentaTier = new Map<string, { n: number; venta: number }>();
    const filas: (Aviso & { valor: number })[] = [];

    for (const p of props) {
        const op = String(p.listing?.operation ?? '');
        const tipo = String(p.type ?? '');
        const esTerreno = tipo.startsWith('Terreno');
        const tier = tierDe(p.portals?.inmuebles24?.type);
        const costo = PRECIO[String(p.portals?.inmuebles24?.type ?? '')] ?? 0;
        gastoMes += costo;
        if (costo === 0) gratis += 1;
        const ct = cuentaTier.get(tier) ?? { n: 0, venta: 0 };
        ct.n += 1; if (op !== 'rent') ct.venta += 1; cuentaTier.set(tier, ct);
        if (op === 'rent') rentas += 1;
        if (op === 'sale') { ventaViva += 1; if (esTerreno) terrenosVenta += 1; }

        // Renta y terreno ENTRAN a la tabla —Ale los quiere ver, no borrados— pero con su
        // etiqueta y marcados como no destacables: no compiten por un lugar pagado.
        const destacable = op === 'sale' && !esTerreno && !COMERCIAL.has(tipo.split(' ')[0]);

        const c = coords(p.address);
        const precio = Number(p.listing?.value);
        if (!Number.isFinite(precio) || precio <= 0) continue;
        const [lon, lat] = c ?? [0, 0];
        const conGeo = c !== null;
        const colonia = p.address?.neighborhood?.name ?? null;
        const colKey = colonia ? String(colonia).toLowerCase().trim() : null;
        const dLat = RADIO_KM / 111;
        const dLon = RADIO_KM / (111 * Math.max(Math.cos(lat * Math.PI / 180), 0.2));

        // ── competencia: mismo tipo y operación, ±25% de precio, a 1.5 km
        let competencia = 0;
        if (conGeo) porVecinos(M.gMls, op, lat, lon, (i) => {
            if (M.mlsTipo[i] !== tipo) return;
            if (M.mlsPre[i] < precio * 0.75 || M.mlsPre[i] > precio * 1.25) return;
            if (Math.abs(M.mlsLat[i] - lat) > dLat || Math.abs(M.mlsLon[i] - lon) > dLon) return;
            competencia++;
        });
        // ── demanda: personas distintas cuya búsqueda calza (geo o nombre de colonia)
        const personas = new Set<string>();
        const calza = (i: number) => {
            if (precio < M.bMin[i] || precio > M.bMax[i]) return false;
            const tp = M.bTipos[i];
            return !(tp.size && !tp.has(tipo));
        };
        if (conGeo) porVecinos(M.gBusq, op, lat, lon, (i) => {
            if (!calza(i)) return;
            if (Math.abs(M.bLat[i] - lat) > dLat || Math.abs(M.bLon[i] - lon) > dLon) return;
            personas.add(M.bPersona[i]);
        });
        // las búsquedas sin coordenadas entran por nombre de colonia (18% de los casos)
        for (const i of (colKey ? M.bPorColonia.get(colKey) ?? [] : [])) {
            if (M.bOp[i] === op && calza(i)) personas.add(M.bPersona[i]);
        }
        const demanda = personas.size;

        // ── precio contra su colonia y tipo
        const m2 = Number(p.attributes?.totalSurface);
        const ref = colKey ? M.medianaM2.get(`${colKey}|${tipo}`) : undefined;
        const precioVsZona = (ref && Number.isFinite(m2) && m2 > 0) ? (precio / m2) / ref : null;

        const fotos = (p.pictures ?? []).length;
        const videos = (p.videos ?? []).length + (p.virtualTour ? 1 : 0);
        const calidad = typeof p.portals?.inmuebles24?.quality === 'number'
            ? p.portals.inmuebles24.quality as number : null;
        const comisionPct = Number(p.contract?.comission) || null;
        const comision = comisionPct ? precio * comisionPct / 100 : 0;
        const leadsMes = (leadsPorProp.get(String(p._id)) ?? 0) / 12;
        const base = leadsMes / (LIFT[tier] ?? 1);

        filas.push({
            id: String(p.internalId ?? ''),
            broker: `${p.agent?.firstName ?? ''} ${p.agent?.lastName ?? ''}`.trim() || '—',
            tipo, operacion: op, precio, comisionPct, comision,
            colonia, municipio: p.address?.city?.name ?? null,
            tier, tierNombre: NOMBRE_TIER[tier], costo,
            fotos, videos, calidad, demanda, competencia,
            tension: demanda / (competencia + 1),
            precioVsZona, leadsMes, base,
            puntos: 0, estado: '', falta: '',
            leadsExtra: 0, comisionEsperada: 0, roi: 0,
            exclusiva: !!p.contract?.exclusive?.start,
            p1510: !!p.contract?.exclusive?.pulppo,
            tags: [], destacable, valor: 0,
        });
    }

    // ── puntaje: 70 del valor esperado + 15 de comisión + 15 de calidad de la cuenta.
    // ⚠️ El percentil se calcula DENTRO de la cuenta, no contra la red: calcular la red entera
    // en vivo son minutos. Sirve para ordenar su inventario, que es para lo que se usa; no para
    // comparar puntajes entre inmobiliarias. Eso se resuelve cuando el motor guarde `demanda` y
    // `competencia` con fecha (ver PROPUESTA_MOTOR.md del repo de análisis).
    const tens = filas.map((f) => f.tension).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
    const q50 = tens[Math.floor(tens.length * 0.5)] ?? 0;
    const q75 = tens[Math.floor(tens.length * 0.75)] ?? 0;
    for (const f of filas) f.valor = f.base * liftTension(f.tension, q50, q75) * f.comision * 0.15;
    const ref = filas.map((f) => f.valor).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const ptsComision = (c: number | null) =>
        c == null ? 0 : c >= 5 ? 15 : c >= 4 ? 10 : c >= 3 ? 2 : 0;

    for (const f of filas) {
        let i = 0; while (i < ref.length && ref[i] < f.valor) i++;
        f.puntos = Math.round((ref.length ? i / ref.length : 0) * 70 + ptsComision(f.comisionPct) + 15);

        // ── Las ETIQUETAS. Un aviso puede tener varias a la vez: puede estar caro Y sin
        // video. Por eso son una lista y no un solo cubo — así el asesor ve todo lo que
        // tiene que resolver, no sólo lo primero que apareció.
        const tags: string[] = [];
        if (f.operacion === 'rent') tags.push('renta');
        if (f.tipo.startsWith('Terreno')) tags.push('terreno');
        if (!f.destacable && !tags.length) tags.push('comercial');
        if (f.competencia === 0) tags.push('poca oferta');
        if (f.demanda === 0) tags.push('no hay demanda');
        if (f.precioVsZona !== null && f.precioVsZona > UMBRAL_CARO) tags.push('precio caro');
        if (f.videos < 1) tags.push('falta video o tour');
        if (f.fotos < 15) tags.push('faltan fotos');
        if (f.calidad !== null && f.calidad < UMBRAL_CALIDAD) tags.push('calidad i24 baja');
        if ((f.comisionPct ?? 0) < 4) tags.push('comisión baja');
        // "destacar" sólo si no le falta nada Y puede competir por un lugar
        if (!tags.length && f.destacable) tags.push('destacar');
        f.tags = tags;
        // el estado de una palabra se conserva para los filtros y el resumen
        f.estado = tags[0] ?? 'destacar';

        const pend: string[] = [];
        if (tags.includes('precio caro') && f.precioVsZona)
            pend.push(`bajar ${Math.round((1 - UMBRAL_CARO / f.precioVsZona) * 100)}%`);
        if (f.fotos < 15) pend.push(`faltan ${15 - f.fotos} fotos`);
        if (f.videos < 1) pend.push('falta video o tour');
        if (f.calidad !== null && f.calidad < UMBRAL_CALIDAD) pend.push(`calidad i24 ${f.calidad}/100`);
        if ((f.comisionPct ?? 0) < 4) pend.push(`comisión ${f.comisionPct ?? 0}%`);
        if (tags.includes('no hay demanda')) pend.push('nadie busca esto aquí');
        if (tags.includes('poca oferta')) pend.push('sin competencia: ya se ve');
        f.falta = pend.join(' · ') || 'nada';

        // valor de destacarlo: leads extra a 6 meses y comisión esperada
        f.leadsExtra = +(f.base * LIFT_SD * MESES_PROY).toFixed(2);
        f.comisionEsperada = Math.round(f.leadsExtra * LEAD_A_CIERRE * f.comision);
        f.roi = +(f.comisionEsperada / (COSTO_SUBIR * MESES_PROY)).toFixed(2);
    }
    filas.sort((a, b) => b.puntos - a.puntos);

    // cuenta por ETIQUETA: un aviso con dos problemas suma en las dos
    const estados: Record<string, number> = {};
    for (const f of filas) for (const t of f.tags) estados[t] = (estados[t] ?? 0) + 1;
    const ARREGLABLES = new Set(['falta video o tour', 'faltan fotos', 'calidad i24 baja',
                                 'precio caro', 'comisión baja']);

    const d: DatosInmo = {
        inmobiliaria: inmo, kam: getKam(inmo),
        ventaViva, terrenosVenta, analizados: filas.length,
        inventarioTotal: props.length, rentas,
        destacados: [...cuentaTier].filter(([t]) => PAGADOS.has(t))
            .reduce((s, [, v]) => s + v.n, 0),
        gastoMes, gratis,
        tiers: ['SD_ZD', 'SD', 'DEST_ZD', 'DEST', 'SIMPLE', 'GRATIS']
            .filter((t) => cuentaTier.has(t))
            .map((t) => ({
                tier: NOMBRE_TIER[t], n: cuentaTier.get(t)!.n, venta: cuentaTier.get(t)!.venta,
                costo: cuentaTier.get(t)!.n * PRECIO_TIER[t],
            })),
        estados,
        comisionArreglable: filas
            .filter((f) => f.destacable && f.tags.some((t) => ARREGLABLES.has(t)))
            .reduce((s, f) => s + f.comision, 0),
        leadsAno,
        avisos: filas.map(({ valor: _valor, ...r }) => r),
        calculadoEn: new Date().toISOString(), ms: Date.now() - t0,
    };
    cacheInmo.set(inmo, { d, ts: Date.now() });
    return d;
}

// ───────────────────────────────────────── el índice de inmobiliarias
type Fila = { inmobiliaria: string; kam: string; venta: number; destacados: number };
let cacheLista: { l: Fila[]; ts: number } | null = null;

export async function listaInmobiliarias(forzar = false): Promise<Fila[]> {
    if (!forzar && cacheLista && Date.now() - cacheLista.ts < TTL_INMO) return cacheLista.l;
    const db = await getDb();
    const filas = await db.collection('properties').aggregate([
        { $match: { 'status.last': 'published' } },
        { $group: {
            _id: '$company.name',
            venta: { $sum: { $cond: [{ $eq: ['$listing.operation', 'sale'] }, 1, 0] } },
            destacados: { $sum: { $cond: [{ $in: [
                { $ifNull: ['$portals.inmuebles24.type', ''] },
                ['HOME_COMBO', 'HOME_COMBO_ZONA_DEMAND', 'DESTACADO_COMBO',
                 'DESTACADO_COMBO_ZONA_DEMAND', 'HOME', 'DESTACADO'],
            ] }, 1, 0] } },
        } },
        { $match: { _id: { $ne: null }, venta: { $gte: 1 } } },
        { $sort: { venta: -1 } },
    ]).toArray();
    const l: Fila[] = filas
        .filter((f) => f._id !== 'Circulo Bienes Raices')
        .map((f) => ({
            inmobiliaria: String(f._id), kam: getKam(String(f._id)),
            venta: f.venta as number, destacados: f.destacados as number,
        }));
    cacheLista = { l, ts: Date.now() };
    return l;
}
