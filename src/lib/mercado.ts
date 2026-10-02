// Mercado: cierres reales de la red Pulppo para que un master broker lea precios por zona.
//
// Recreación de ami.pulppo.com ("Análisis de Mercado Inmobiliario"), que vive en Lovable +
// Supabase alimentado por una query de Metabase. Dos cosas que ese panel hacía mal y aquí no:
//   - Descartaba todo precio/m² calculado arriba de $50,000 → se comía Polanco, Condesa y Roma,
//     y por eso Miguel Hidalgo salía a $16k/m² en una vista y a $62k/m² en otra.
//   - Promediaba. Aquí todo es MEDIANA: dos ventas caras no mueven la zona.
//
// Fuente: `operations` con status closed/paying → precio de CIERRE, no de lista. El desarrollo
// se completa con `properties` (el snapshot de la operación no lo trae). Mismo universo que ami:
// Miguel Hidalgo da 206 cierres de venta con $/m² válido vs. 207 allá.
//
// 🔒 Privacidad: lo ven inmobiliarias que compiten entre sí. Por eso cada cierre sale SIN
// inmobiliaria, sin broker, sin id/código de propiedad, con la calle SIN número y fechado sólo
// por mes. El mínimo de cierres por zona/mes (MIN_CIERRES) se aplica en la vista.
//
// Port de `~/Documents/Pulppo/Cierres/etl/extraer_cierres.py` (queda como referencia para validar).
import { ObjectId } from 'mongodb';
import { getDb } from './data';

/** Menos cierres que esto en una zona o un mes → no se muestra su mediana. */
export const MIN_CIERRES = 5;

// FX no vive en Mongo (viene de HubSpot). TODO: tasa histórica por mes.
const USD_MXN = 18.5;

// Rangos sanos de $/m² (MXN). Fuera de rango = captura rota (m² en cero, renta capturada
// como venta…) → se excluye. Muy anchos a propósito: no es para recortar el mercado caro.
const RANGO_M2: Record<string, [number, number]> = { venta: [3_000, 250_000], renta: [30, 1_500] };

const TEST_RE = /\btest\b|testing|\bdemo\b|prueba/i;

export type Operacion = 'venta' | 'renta';

export interface Cierre {
    /** YYYY-MM (hora MX) — sin día, a propósito */
    mes: string;
    operacion: Operacion;
    tipo: string;
    calle: string | null;
    colonia: string | null;
    alcaldia: string | null;
    estado: string | null;
    m2: number;
    recamaras: number | null;
    banos: number | null;
    precio: number;          // MXN
    precioM2: number;        // MXN / m² construido (o total en terrenos)
    desarrollo: string | null;
}

export interface Mercado {
    calculadoEn: string;
    usdMxn: number;
    minCierres: number;
    cierres: Cierre[];
}

type Doc = Record<string, unknown>;

function pick(o: unknown, ...ruta: string[]): unknown {
    let cur: unknown = o;
    for (const k of ruta) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = (cur as Doc)[k];
    }
    return cur;
}

const num = (x: unknown): number | null => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : null;
};
const txt = (x: unknown): string | null => {
    const s = typeof x === 'string' ? x.trim() : '';
    return s || null;
};

/**
 * Calle sin número. Corta en la primera coma y en el primer token con dígito que NO sea la
 * primera palabra: "Via Santa Fe 355 Torre 2" → "Via Santa Fe"; "Tintoreto74" → "Tintoreto";
 * "Filodendro SN L1" → "Filodendro". Respeta las calles que EMPIEZAN con número
 * ("12 de Octubre 88" → "12 de Octubre", "2a. Cerrada de Terrazas"). Lo que parece título de
 * anuncio ("Departamento en Venta…", "VENTA … DESDE $3") se descarta: ahí no hay calle.
 */
export function calleSinNumero(s: string | null): string | null {
    if (!s) return null;
    const base = s.split(/[,(]/)[0].replace(/\bnull\b/gi, '').trim();
    if (/\$|\b(venta|renta|amueblado|departamento en|casa en|preventa)\b/i.test(base)) return null;
    const out: string[] = [];
    for (const [i, tok] of base.split(/\s+/).entries()) {
        // con dígito: corta, salvo la primera palabra cuando ES el número ("12 de Octubre")
        if (/\d/.test(tok) && (i > 0 || /^[^\d]{3,}\d/.test(tok))) {
            const pegado = tok.match(/^([^\d]{3,})\d/);   // "Tintoreto74" → conserva "Tintoreto"
            if (pegado) out.push(pegado[1]);
            break;
        }
        if (i > 0 && /^(#|no\.?|num\.?|número|numero|int\.?|ext\.?|lote|mz\.?|torre|edificio|depto\.?)$/i.test(tok)) break;
        out.push(tok);
    }
    const c = out.join(' ').replace(/\s+(s\/?n|sn|#|no\.?)$/i, '').trim();
    // "Calle", "Av." o "Privada" sueltos no son una calle
    return c.length >= 3 && !/^(calle|av\.?|avenida|privada|cerrada|blvd\.?|boulevard|carretera)$/i.test(c) ? c : null;
}

const MX_OFFSET_MS = 6 * 60 * 60 * 1000;   // los timestamps están en UTC; México = UTC−6

export async function mercado(): Promise<Mercado> {
    const db = await getDb();
    const ops = await db.collection('operations').find(
        {
            'status.last': { $in: ['closed', 'paying'] },
            closedAt: { $ne: null },
            // Habi se excluye SIEMPRE y por email, nunca por nombre.
            'company.email': { $not: /tuhabi/i },
            'property.company.email': { $not: /tuhabi/i },
        },
        {
            projection: {
                closedAt: 1, closeValue: 1, 'company.name': 1,
                'property._id': 1, 'property.type': 1, 'property.listing.operation': 1,
                'property.address': 1, 'property.attributes': 1, 'property.company.name': 1,
            },
        },
    ).toArray();

    // desarrollo vive en properties (cuyo _id es ObjectId; en operations viene como texto)
    const oids = [...new Set(ops.map((o) => String(pick(o, 'property', '_id') ?? '')))]
        .filter((id) => ObjectId.isValid(id) && id.length === 24)
        .map((id) => new ObjectId(id));
    const devs = new Map<string, string>();
    if (oids.length) {
        const props = await db.collection('properties')
            .find({ _id: { $in: oids } }, { projection: { development: 1 } }).toArray();
        for (const p of props) {
            const d = p.development;
            const nombre = txt(typeof d === 'object' && d ? (d as Doc).name : d);
            if (nombre) devs.set(String(p._id), nombre);
        }
    }

    const cierres: Cierre[] = [];
    for (const o of ops) {
        const comp = String(pick(o, 'company', 'name') ?? '');
        const pcomp = String(pick(o, 'property', 'company', 'name') ?? '');
        if (TEST_RE.test(comp) || TEST_RE.test(pcomp)) continue;

        const opRaw = pick(o, 'property', 'listing', 'operation');
        const operacion: Operacion | null = opRaw === 'sale' ? 'venta' : opRaw === 'rent' ? 'renta' : null;
        if (!operacion) continue;

        const valor = num(pick(o, 'closeValue', 'value'));
        if (!valor) continue;
        const precio = pick(o, 'closeValue', 'currency') === 'USD' ? valor * USD_MXN : valor;

        const m2 = num(pick(o, 'property', 'attributes', 'roofedSurface'))
            ?? num(pick(o, 'property', 'attributes', 'totalSurface'));
        if (!m2) continue;
        const precioM2 = Math.round(precio / m2);
        const [lo, hi] = RANGO_M2[operacion];
        if (precioM2 < lo || precioM2 > hi) continue;

        const fecha = new Date(new Date(o.closedAt as Date).getTime() - MX_OFFSET_MS);
        const a = pick(o, 'property', 'address');
        cierres.push({
            mes: `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`,
            operacion,
            tipo: txt(pick(o, 'property', 'type')) ?? 'Otro',
            calle: calleSinNumero(txt(pick(a, 'street'))),
            colonia: txt(pick(a, 'neighborhood', 'name')),
            alcaldia: txt(pick(a, 'city', 'name')),
            estado: txt(pick(a, 'state', 'name')),
            m2: Math.round(m2),
            recamaras: num(pick(o, 'property', 'attributes', 'suites')),
            banos: num(pick(o, 'property', 'attributes', 'bathrooms')),
            precio: Math.round(precio),
            precioM2,
            desarrollo: devs.get(String(pick(o, 'property', '_id') ?? '')) ?? null,
        });
    }

    cierres.sort((x, y) => (x.mes < y.mes ? 1 : x.mes > y.mes ? -1 : 0));
    return { calculadoEn: new Date().toISOString(), usdMxn: USD_MXN, minCierres: MIN_CIERRES, cierres };
}
