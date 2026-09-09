// Inversión mensual por portal — leída EN VIVO del Sheet "Investment Strategy - 2026".
//
// Por qué no vive en el código: el costo NO está en Mongo. Antes era una tabla a mano
// (`inversion.py` del dashboard local) y se desincronizó: alguien congeló el i24 de julio
// ($618,263) y lo copió hacia marzo–junio, cuando lo real era $817K/$817K/$856K/$625K.
// Resultado: el CPL de esos meses salía más barato y el ROI más alto. La única forma de que
// eso no vuelva a pasar es leer la fuente donde Ale la escribe.
//
// Cómo se lee: el export CSV de Google Sheets responde sin credenciales
//   /gviz/tq?tqx=out:csv&sheet=<Mes>
// (el Sheet es accesible por link — Ale lo sabe y le parece bien). Un tab por mes.
//
// ⚠️ El bloque NO está en una fila fija: enero y febrero traen layout de dos meses y el
// `RESULTS` se mueve entre la fila 17 y la 20. Se localiza buscando la celda que empieza
// con "RESULTS", nunca por índice.

const SHEET_ID = '1nq_fizH2I6qU7kpa1DQS_n7uD3I8I__iWjDT5XjjxPU';

/** Nombre del tab por mes (1..12). Son los que existen en el Sheet. */
const TAB = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
             'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Nombre del canal en el Sheet → clave del dashboard. Se normaliza (minúsculas, sin acentos).
// `i24 mérida` suma a `i24`: así lo hace el número que Ale reporta (jul 579,353 + 38,910 =
// 618,263, que es exactamente lo que tenía la tabla a mano).
const CANAL_KEY: Record<string, string> = {
    'i24': 'i24', 'i24 merida': 'i24', 'inmuebles24': 'i24',
    'meli': 'meli', 'mercadolibre': 'meli',
    'meta': 'facebook', 'fb': 'facebook', 'facebook': 'facebook',
    'easybroker': 'easybroker',
    'casasyterrenos': 'cyt', 'casas y terrenos': 'cyt',
    'propiedades.com': 'propiedades',
    'doorvel': 'doorvel',
    'google ads': 'ads', 'ads': 'ads',
    'lamudi': 'lamudi',
    'others': 'otros',
};

/** Canales que estructuralmente NO cuestan. Un 0 aquí significa "gratis de verdad", no "no sé". */
export const GRATIS = new Set(['propiedades']);

export const NOTA_MELI =
    'MeLi cuesta base fija $152,800 + 6% de la comisión de las operaciones del deal cerradas ' +
    'en el mes, así que su inversión sólo se conoce con el mes cerrado.';

/** Base fija mensual del contrato con MercadoLibre (MXN). El 6% se calcula aparte. */
export const MELI_BASE = 152_800;

// Meses cuyo 6% quedó reconciliado a mano con Ale (operación por operación contra la tabla
// de MeLi). Manda sobre el Sheet y sobre cualquier cálculo: son los que ella ya validó.
// ⚠️ Ver `deal.ts`: ninguna regla automática reproduce los tres, así que estos son el ancla.
export const MELI_CONFIRMADO: Record<string, number> = {
    '2026-06': 42_141.91,
    '2026-07': 32_405.91,
    '2026-08': 48_026.30,
};

export interface InversionMes {
    mes: string;                          // 'YYYY-MM'
    canales: Record<string, number>;      // MXN por clave de canal, tal como está en el Sheet
    /** true = el tab no existe todavía o el bloque RESULTS está en ceros. Mostrar "s/d". */
    faltante: boolean;
    /** Qué dice el Sheet para MeLi, para poder contrastarlo con la fórmula del deal. */
    meliSheet: number | null;
}

// ── CSV ────────────────────────────────────────────────────────────
/** Parser mínimo con comillas dobles y comas dentro de campo (lo que emite gviz). */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
            } else cell += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

const norm = (s: string) =>
    s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** "$1,214,233.31" → 1214233.31 · "" / "#REF!" / "#DIV/0!" → null */
function money(s: string): number | null {
    const t = (s || '').replace(/[$,\s]/g, '');
    if (!t || t.startsWith('#')) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

// ── caché en memoria ───────────────────────────────────────────────
// El mes en curso cambia mientras Ale lo llena, así que se revalida cada 10 min. Los meses
// cerrados ya no se mueven, pero se les da el mismo TTL por simplicidad: son 4 KB por mes.
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; val: InversionMes }>();

async function fetchTab(mes: string): Promise<InversionMes> {
    const m = Number(mes.split('-')[1]);
    const vacio: InversionMes = { mes, canales: {}, faltante: true, meliSheet: null };
    const tab = TAB[m];
    if (!tab) return vacio;

    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
                `?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
    let text: string;
    try {
        const r = await fetch(url, { cache: 'no-store' });
        // Un tab que no existe devuelve 400 (o una página de error): eso es "falta cargarlo".
        if (!r.ok) return vacio;
        text = await r.text();
        if (text.trimStart().startsWith('<')) return vacio;
    } catch {
        return vacio;
    }

    const rows = parseCsv(text);
    // El bloque vive en la columna B (índice 1) en todos los tabs revisados, y su etiqueta
    // SIEMPRE nombra el mes ("RESULTS AGOSTO").
    //
    // ⚠️ Exigir el nombre del mes no es cosmético, tapa dos hoyos reales:
    //   1. Si el tab no existe (septiembre hoy), gviz **no falla: devuelve la PRIMERA hoja**
    //      del libro. Sin este check, septiembre mostraría la inversión de enero como si fuera
    //      suya ($627,275 de i24).
    //   2. Los tabs de julio y agosto arrastran un segundo bloque pegado que sigue diciendo
    //      "RESULTS JUNIO". Buscar sólo "RESULTS" podría caer en el equivocado.
    const mesTab = norm(tab);
    const ini = rows.findIndex((r) => {
        const s = norm(r[1] || '');
        return s.startsWith('results') && s.includes(mesTab);
    });
    if (ini < 0) return vacio;

    const canales: Record<string, number> = {};
    for (let i = ini + 1; i < rows.length; i++) {
        const nombre = norm(rows[i][1] || '');
        if (!nombre) continue;
        if (nombre.startsWith('total')) break;      // fin del bloque
        if (nombre === 'channel') continue;         // encabezado
        const key = CANAL_KEY[nombre];
        if (!key) continue;                         // fila que no es un canal conocido
        const v = money(rows[i][2] || '');
        if (v === null) continue;
        canales[key] = (canales[key] ?? 0) + v;     // i24 + i24 Mérida caen en la misma clave
    }

    // Los canales gratis son 0 real, no "no sé".
    for (const g of GRATIS) if (canales[g] === undefined) canales[g] = 0;

    const suma = Object.entries(canales)
        .filter(([k]) => !GRATIS.has(k))
        .reduce((a, [, v]) => a + v, 0);

    return {
        mes, canales,
        faltante: suma === 0,
        meliSheet: canales.meli ?? null,
    };
}

/** Inversión del mes 'YYYY-MM' desde el Sheet, con caché de 10 min. */
export async function inversionMes(mes: string): Promise<InversionMes> {
    const hit = cache.get(mes);
    if (hit && Date.now() - hit.at < TTL) return hit.val;
    const val = await fetchTab(mes);
    cache.set(mes, { at: Date.now(), val });
    return val;
}

/** Varios meses en paralelo. */
export async function inversionMeses(meses: string[]): Promise<Record<string, InversionMes>> {
    const vals = await Promise.all(meses.map(inversionMes));
    return Object.fromEntries(vals.map((v) => [v.mes, v]));
}
