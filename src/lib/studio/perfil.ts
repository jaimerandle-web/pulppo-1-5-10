// Perfil EN VIVO del asesor para Studio. Port de `datos_broker()` del motor en Python
// (`herramientas/studio/motor/gen_prototipo_web.py`, líneas 142-344).
//
// **Por qué existe.** El bundle de Studio es un HTML estático con los datos de los 22
// asesores congelados adentro. Eso trae dos problemas distintos:
//
// 1. **Caduca.** Entre el 21 y el 31 de agosto hubo 6 cierres en Diamond House que la app
//    nunca mostró; Miriam cerró dos días después del lanzamiento y no se enteró, porque el
//    archivo seguía diciendo que no había cerrado nada hasta que alguien lo regeneró a mano.
// 2. **Filtra.** El archivo lleva los perfiles de TODOS —nombre, celular, operaciones— y se
//    sirve completo a quien abra el link. La pantalla muestra sólo lo tuyo, pero el archivo
//    entero ya está en el dispositivo: "ver código fuente" alcanza para leer los celulares y
//    las operaciones de los otros 21.
//
// Este endpoint arregla las dos: se consulta al abrir (no caduca) y devuelve SÓLO el perfil
// de quien inició sesión (no filtra). La identidad no la dice el cliente: sale de
// `currentUser()`, que valida la firma `cm-sig` de la cookie contra Mongo.
//
// **Paridad con el Python.** El generador sigue siendo la fuente de la verdad del contenido
// (templates, copy, hechos de zona). Este módulo reproduce SÓLO la parte del perfil, y hay
// un script que compara las dos salidas asesor por asesor: `herramientas/studio/motor/
// comparar_perfil.py`. Si divergen, el que está mal es este archivo.
import { ObjectId } from 'mongodb';
import { getDb } from '../data';

// ── constantes copiadas del motor (si cambian allá, cambian acá) ──────────────
const FILTRO_ACTIVOS = {
    type: { $in: ['associate', 'master'] },
    status: 'active',
    deletedAt: null
};

// Rango de una baja de precio publicable. El piso descarta el ajuste cosmético; el techo,
// el error de dedo y el cambio de operación que se colara.
const BAJA_MIN = 0.01;
const BAJA_MAX = 0.30;

const DIAS_VENTANA = 30;

// listing.operation viene en inglés en Mongo ('sale' 7157 · 'rent' 2041): sin traducir, la
// pieza sale con "[ DEPARTAMENTO EN RENT ]".
const OPERACION: Record<string, string> = { sale: 'VENTA', rent: 'RENTA' };

// El género del tipo de propiedad, para que la pieza no diga "una departamento". Mapa
// explícito y no una regla de sufijo: "Nave industrial" es femenino y termina en -e.
const GENERO: Record<string, string> = {
    'departamento': 'm', 'casa': 'f', 'terreno residencial': 'm', 'oficina': 'f',
    'casa en condominio': 'f', 'local': 'm', 'bodega comercial': 'f',
    'terreno comercial': 'm', 'edificio': 'm', 'nave industrial': 'f',
    'terreno industrial': 'm', 'local en centro comercial': 'm',
    'casa uso de suelo': 'f', 'finca': 'f'
};

const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);

// `development.name` trae relleno de formulario en vez de vacío: "N/A" en 22 avisos
// publicados, más "NA", "Casa", "-". Impreso como titular se lee como un error del sistema.
// Ojo: los nombres CORTOS sí son reales en este mercado —AGOR, Bilú, LUMA, G25—, así que el
// criterio es lista de valores de relleno, no longitud.
const RELLENO = new Set(['n/a', 'na', 'n.a.', 'null', 'none', 'nulo', 's/n', 'sn', '-', '--',
    '---', '.', '0', 'no aplica', 'ninguno', 'ninguna', 'sin nombre', 'sin dato', 'x', 'xx',
    'pendiente', 'por definir', 'casa', 'departamento', 'depto', 'terreno', 'oficina',
    'local', 'bodega', 'edificio']);

const CALLEJERO = /^(calle|av\.?|avenida|blvd\.?|boulevard|privada|priv\.?|circuito|carretera|camino|prolongaci[oó]n|retorno|cerrada|and[aá]dor)\b|\bno\.?\s*\d|#\s*\d/i;
const VIALIDAD = /^(calle|av\.?|avenida|blvd\.?|boulevard|privada|priv\.?|circuito|cerrada|and[aá]dor|camino|carretera|retorno|prolongaci[oó]n)\s+/i;

// Sólo el 4% de las descripciones de foto nombra el espacio, así que esto cumple el "nunca
// propongas un baño" A MEDIAS y hay que ser claro sobre el límite: descarta lo que SÍ se
// declara baño y adelanta lo que se declara espacio principal. El 96% sin etiqueta queda en
// medio. Cumplirlo de verdad necesita clasificar con visión una vez por foto.
const FOTO_FUERA = /ba[nñ]o|\bwc\b|lavander|closet|vestidor|cuarto de servicio|medio ba[nñ]o|sanitario/i;
const FOTO_ADELANTE = /fachada|frente|exterior|sala|comedor|estancia|rec[aá]mara|recamara|amenidad|alberca|roof|terraza|jard[íi]n|lobby|vista|render/i;

// Rutas que el cliente puede pedir. El cliente manda la lista de tokens de sus plantillas
// (metadata pública, no secreta) y este endpoint las resuelve: sin allowlist podría pedir
// `contact.phone` del aviso. Son datos de SU propio aviso, pero el principio es que el
// endpoint devuelva lo que las piezas necesitan y nada más.
const RUTAS_PERMITIDAS = [
    /^type$/, /^listing\.operation$/, /^listing\.price\.price$/, /^listing\.title$/,
    /^attributes\.[a-zA-Z]+$/, /^pictures\.\d+\.url$/, /^address\.street$/,
    /^address\.(neighborhood|city|state)\.name$/, /^company\.logo\.[a-zA-Z]+$/,
    /^development\.name$/
];
// tokens sintéticos: no son rutas del documento, se calculan
const SINTETICOS = new Set(['ubicacion', 'titulo_corto', 'colonia', 'articulo_tipo', 'specs',
    'precio_antes', 'precio_ahora', 'baja_pct']);

type Doc = Record<string, unknown>;

// ── helpers ───────────────────────────────────────────────────────────────────

// Mongo guarda el celular de dos formas —`+52 1 55 7893 5745` en personal.phone y
// `525578935745` en la raíz— y las dos salían con la lada pegada. Quien lee marca desde
// México: el +52 1 sólo estorba.
export function telefonoMx(bruto: unknown): string {
    const d = String(bruto ?? '').replace(/\D/g, '');
    if (d.length < 10) return '';
    const u = d.slice(-10);
    return `${u.slice(0, 2)} ${u.slice(2, 6)} ${u.slice(6)}`;
}

// Mongo escribe la misma colonia de varias formas: en Diamond House conviven "Bosques de las
// Lomas" (19 avisos) y "Bosque de las Lomas" (14), que son la misma. Se agrupan por clave
// normalizada: sin acentos, sin conectores, sin plural en las palabras largas.
export function claveColonia(nombre: unknown): string {
    const sinAcentos = String(nombre ?? '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return sinAcentos.replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
        .filter(w => w && !CONECTORES.has(w))
        // sólo se singulariza lo largo: evita convertir nombres cortos en otra cosa
        .map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
        .join(' ');
}

export interface Zona { zona: string; ciudad: string; avisos: number }

// {`colonia|ciudad` → n} → [{zona, ciudad, avisos}] con las variantes ya unidas. De cada
// grupo se muestra la grafía que más avisos tiene.
// Separador de la llave del mapa de conteo. Va un caracter de control porque NO puede
// aparecer en el nombre de una colonia: con un espacio, `split` partiria "Lomas de
// Chapultepec" en "Lomas", que es casi todo el inventario. Se escribe como escape a
// proposito: un byte de control literal en el fuente es invisible al leer el codigo.
export const SEP = '\u0001';

export function agruparColonias(cuenta: Map<string, number>): Zona[] {
    const grupos = new Map<string, { n: number; col: string; ciu: string }[]>();
    for (const [k, n] of cuenta) {
        const [col, ciu] = k.split(SEP);
        const clave = claveColonia(col);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave)!.push({ n, col, ciu });
    }
    const salida: Zona[] = [];
    for (const variantes of grupos.values()) {
        const total = variantes.reduce((s, v) => s + v.n, 0);
        // más avisos gana; a igualdad, la grafía más corta
        const mejor = variantes.reduce((a, b) =>
            (b.n > a.n || (b.n === a.n && b.col.length < a.col.length)) ? b : a);
        salida.push({ zona: mejor.col, ciudad: mejor.ciu, avisos: total });
    }
    // El desempate va por código de caracter, NO por `localeCompare`: hay que reproducir el
    // orden del Python (`sorted(key=(-avisos, zona))`), que es el que hoy ve el asesor. Con
    // collation de locale, "Anáhuac I Sección" se cuela antes de "Anzures" y "Lomas de
    // Bezares" antes de "Lomas Verdes" — la lista es la misma pero en otro orden, y el
    // comparador lo marcó en los 22 perfiles.
    return salida.sort((a, b) =>
        b.avisos - a.avisos || (a.zona < b.zona ? -1 : a.zona > b.zona ? 1 : 0));
}

function capitular(palabra: string): string {
    // `title case` a secas convierte "NB23" en "Nb23" y "SITE" en "Site": destroza siglas y
    // nombres con número, que en desarrollos son comunes.
    if (/\d/.test(palabra) || (palabra.length <= 4 && palabra === palabra.toUpperCase())) {
        return palabra;
    }
    return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

export function nombreResidencial(bruto: unknown): string {
    const n = String(bruto ?? '').split(/\s+/).filter(Boolean).join(' ');
    if (!n || CALLEJERO.test(n)) return '';
    if (RELLENO.has(n.toLowerCase().replace(/^[.,;:]+|[.,;:]+$/g, ''))) return '';
    // más de 30 caracteres no cabe en la línea y casi siempre es basura pegada
    if (n.length > 30) return '';
    const tieneMinuscula = /[a-záéíóúüñ]/.test(n);
    const tieneMayuscula = /[A-ZÁÉÍÓÚÜÑ]/.test(n);
    // se capitula cuando viene en un solo registro —GRITADO o en minúsculas— y se respeta el
    // que ya está bien escrito ("La Enramada", "Central Park Interlomas")
    if (!tieneMinuscula || !tieneMayuscula) {
        return n.split(' ').map(capitular).join(' ');
    }
    return n;
}

function txt(v: unknown): string {
    return String(v ?? '').split(/\s+/).filter(Boolean).join(' ');
}

function pick(o: unknown, ...ruta: string[]): unknown {
    let cur: unknown = o;
    for (const k of ruta) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = (cur as Doc)[k];
    }
    return cur;
}

export function ubicacionDe(prop: Doc): string {
    const residencial = nombreResidencial(pick(prop, 'development', 'name'));
    const colonia = txt(pick(prop, 'address', 'neighborhood', 'name'));
    // si el residencial ya nombra la colonia ("Residencial Xcanatún" en Xcanatún) repetirla
    // suena a error; gana el residencial, que es lo más específico
    if (residencial && colonia && !residencial.toLowerCase().includes(colonia.toLowerCase())) {
        return `${residencial} · ${colonia}`;
    }
    return residencial || colonia;
}

export function tituloCortoDe(prop: Doc): string {
    const residencial = nombreResidencial(pick(prop, 'development', 'name'));
    if (residencial) return residencial;
    let calle = txt(pick(prop, 'address', 'street')).replace(VIALIDAD, '').trim();
    // La calle viene con cosas que no son la calle. Casos reales de Diamond House:
    //   "Fraccionamiento Residencial Xcanatún, Mérida Yucatán" → sobra la ciudad y el estado
    //   "Horacio 1825 - 301 (LG)"                              → sobra el interior y el código
    calle = calle.split(',')[0];
    calle = calle.replace(/\s*\([^)]*\)\s*$/, '');
    calle = calle.replace(/\s+-\s+\S+$/, '');
    calle = calle.replace(/^[\s\-,·]+|[\s\-,·]+$/g, '');
    // si aun así es kilométrico no cabe en un titular; antes que dejarlo VACÍO, la colonia
    if (calle && calle.length <= 34) return calle;
    return txt(pick(prop, 'address', 'neighborhood', 'name'));
}

export function articuloDe(tipo: unknown): string {
    // Si el tipo es desconocido, femenino: el sustantivo implícito es "propiedad".
    return GENERO[String(tipo ?? '').trim().toLowerCase()] === 'm' ? 'Un' : 'Una';
}

// Un terreno no tiene recámaras ni baños, así que una línea escrita token por token imprime
// "rec · baños · m²" con las etiquetas huérfanas. Y la superficie vive en dos campos: una
// casa trae `totalSurface`, un terreno NO (Terra Serena: surface 1803.6, sin totalSurface).
const SPECS: [string, string][] = [['suites', 'rec'], ['bathrooms', 'baños'], ['parkings', 'est']];
const SUPERFICIE = ['totalSurface', 'surface'];

function numero(v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
}

export function specsDe(prop: Doc): string {
    const attrs = (prop.attributes ?? {}) as Doc;
    const partes: string[] = [];
    for (const [campo, etiqueta] of SPECS) {
        // el 0 se descarta a propósito: "0 est" es peor que no decir nada
        const n = numero(attrs[campo]);
        if (n !== null) partes.push(`${n} ${etiqueta}`);
    }
    for (const campo of SUPERFICIE) {
        const n = numero(attrs[campo]);
        if (n !== null) {
            // los decimales de la superficie no aportan y alargan la línea: 1803.6 → 1,804
            partes.push(`${Math.round(n).toLocaleString('en-US')} m²`);
            break;
        }
    }
    return partes.join(' · ');
}

function resolverRuta(doc: Doc, ruta: string): unknown {
    let cur: unknown = doc;
    for (const parte of ruta.split('.')) {
        if (cur === null || cur === undefined) return undefined;
        if (/^\d+$/.test(parte)) {
            const i = Number(parte);
            cur = Array.isArray(cur) && i < cur.length ? cur[i] : undefined;
        } else if (typeof cur === 'object') {
            cur = (cur as Doc)[parte];
        } else {
            return undefined;
        }
    }
    return cur;
}

function formatear(ruta: string, v: unknown): string {
    if (v === null || v === undefined || v === '') return '';
    if (ruta === 'listing.price.price') return Math.trunc(Number(v)).toLocaleString('en-US');
    if (ruta === 'listing.operation') return OPERACION[String(v).toLowerCase()] ?? String(v).toUpperCase();
    if (ruta === 'type') return String(v).toUpperCase();
    if (ruta === 'attributes.totalSurface') {
        const n = Number(v);
        return Number.isInteger(n) ? String(n) : String(v);
    }
    return String(v);
}

// Ale, 2-sep: "si es desarrollo que se vea el edificio, no la foto del comedor". No hay campo
// que diga cuál es la fachada, pero los desarrollos SÍ tienen su propio array de fotos, que
// suele ser render y fachada: se ponen primero y el asesor elige.
function ordenarFotos(pics: Doc[]): string[] {
    const buenas: string[] = [], neutras: string[] = [];
    for (const f of pics) {
        const d = String(f.description ?? '');
        if (FOTO_FUERA.test(d)) continue;
        (FOTO_ADELANTE.test(d) ? buenas : neutras).push(String(f.url));
    }
    return [...buenas, ...neutras];
}

async function fotosDeProp(prop: Doc): Promise<string[]> {
    const db = await getDb();
    const propias = ordenarFotos(((prop.pictures ?? []) as Doc[])
        .filter(p => p.url && p.public && !p.is_blueprint));
    const dev = (typeof prop.development === 'object' ? prop.development : null) as Doc | null;
    const delDesarrollo: string[] = [];
    if (dev?._id) {
        const d = await db.collection('developments').findOne(
            { _id: dev._id as ObjectId }, { projection: { pictures: 1 } });
        for (const x of ((d?.pictures ?? []) as unknown[])) {
            const u = typeof x === 'object' && x !== null ? (x as Doc).url : x;
            if (u && !propias.includes(String(u))) delDesarrollo.push(String(u));
        }
    }
    return [...delDesarrollo, ...propias];
}

// `precio_antes` y `precio_ahora` no viven en la propiedad —el precio viejo sólo existe en el
// historial— así que salen del evento y se inyectan aparte.
function tokensDelEvento(ev: Evento | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (!ev) return out;
    if (ev.precio_antes) out.precio_antes = ev.precio_antes.toLocaleString('en-US');
    if (ev.precio_ahora) out.precio_ahora = ev.precio_ahora.toLocaleString('en-US');
    if (ev.baja_pct) out.baja_pct = String(ev.baja_pct);
    return out;
}

function tokensDePropiedad(prop: Doc, comp: Doc, tokens: string[], fotos: string[]) {
    // sólo las fotos publicables, reindexadas: `pictures.0.url` tiene que apuntar a la
    // primera que el asesor puede usar, no a la primera del array crudo
    const doc: Doc = { ...prop, pictures: fotos.map(u => ({ url: u })), company: comp };
    const out: Record<string, string> = {};
    for (const t of tokens) {
        if (t === 'ubicacion') out[t] = ubicacionDe(prop);
        else if (t === 'titulo_corto') out[t] = tituloCortoDe(prop);
        else if (t === 'colonia') out[t] = txt(pick(prop, 'address', 'neighborhood', 'name'));
        else if (t === 'articulo_tipo') out[t] = articuloDe(prop.type);
        else if (t === 'specs') out[t] = specsDe(prop);
        else if (SINTETICOS.has(t)) continue;   // los del evento se inyectan aparte
        else if (RUTAS_PERMITIDAS.some(r => r.test(t))) out[t] = formatear(t, resolverRuta(doc, t));
    }
    return out;
}

// ── el perfil ─────────────────────────────────────────────────────────────────

export interface Evento {
    clase: 'captacion' | 'baja_precio' | 'contrato' | 'venta';
    colonia: string;
    tipo: string;
    titulo: string;
    fecha: string;
    cuando: string;
    precio_antes?: number;
    precio_ahora?: number;
    baja_pct?: number;
}

export interface PerfilStudio {
    email: string;
    emails: string[];
    nombre: string;
    pila: string;
    foto: string;
    telefono: string;
    inmobiliaria: string;
    logo: string;
    logos: Record<string, string>;
    rol: 'titular' | 'asesor';
    zonas: Zona[];
    zonas_inmobiliaria: Zona[];
    tipos: string[];
    fotos_por_zona: Record<string, string[]>;
    evento: Evento | null;
    eventos: Evento[];
    total_publicados: number;
    valores: Record<string, Record<string, string>>;
    fotos_urls: Record<string, string[]>;
    fotos_aviso: Record<string, number>;
}

function cuandoDe(ts: Date, ahora: Date): string {
    const dias = Math.floor((ahora.getTime() - ts.getTime()) / 86400000);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    return `hace ${dias} días`;
}

function fechaISO(ts: Date): string {
    return ts.toISOString().slice(0, 10);
}

/**
 * Perfil completo del asesor, leído de Mongo en el momento.
 *
 * `tokensPorIdea` viene del cliente: son los tokens que sus plantillas piden por idea de
 * operación (metadata pública que ya vive en el bundle). Se resuelven contra el aviso del
 * evento de esa clase. Las rutas pasan por `RUTAS_PERMITIDAS`.
 */
export async function perfilDeAsesor(
    email: string,
    tokensPorIdea: Record<string, { clase: string; tokens: string[] }> = {}
): Promise<PerfilStudio | null> {
    const db = await getDb();
    const mail = email.trim().toLowerCase();
    const a = await db.collection('agents').findOne(
        { ...FILTRO_ACTIVOS, $or: [{ email: mail }, { 'personal.email': mail }] },
        { collation: { locale: 'en', strength: 2 } }
    ) as Doc | null;
    if (!a) return null;
    const comp = (a.company ?? {}) as Doc;
    // el email de trabajo del agente, que es la llave con la que Mongo indexa sus avisos:
    // quien entra con su Google personal tiene que resolver igual (11 de 22 en Diamond House)
    const suEmail = String(a.email ?? mail).trim().toLowerCase();

    const ahora = new Date();
    const corte = new Date(ahora.getTime() - DIAS_VENTANA * 86400000);
    const mios = { 'agent.email': suEmail, 'status.last': 'published' };

    // ── zonas, fotos y tipos, de una sola pasada por su inventario publicado
    const cuenta = new Map<string, number>();
    const tipos = new Map<string, number>();
    const fotosCrudas = new Map<string, string[]>();
    const idsPropios: ObjectId[] = [];
    const publicadas = await db.collection('properties').find(mios,
        { projection: { address: 1, type: 1, pictures: 1, 'status.history': 1, 'listing.title': 1 } }
    ).toArray() as Doc[];

    for (const p of publicadas) {
        idsPropios.push(p._id as ObjectId);
        const col = txt(pick(p, 'address', 'neighborhood', 'name'));
        const ciu = txt(pick(p, 'address', 'city', 'name'));
        if (p.type) tipos.set(String(p.type), (tipos.get(String(p.type)) ?? 0) + 1);
        if (!col) continue;
        const k = col + SEP + ciu;
        cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
        const buenas = ((p.pictures ?? []) as Doc[])
            .filter(x => x.url && x.public && !x.is_blueprint).map(x => String(x.url));
        if (buenas.length) {
            fotosCrudas.set(col, [...(fotosCrudas.get(col) ?? []), ...buenas.slice(0, 6)]);
        }
    }

    // ── eventos. La captación sale de `properties` —publicar un aviso es un hecho del
    // aviso— pero el cierre NO: sale de `operations`. `properties.status.last` es el estado
    // de la PROPIEDAD y no sabe qué es una oferta, así que no permitía distinguir "hay una
    // oferta" de "está cerrado". Decisión de Ale: sólo disparan `contract` y `closed`.
    type Cand = { ts: Date; ev: Omit<Evento, 'cuando' | 'fecha'>; propId: ObjectId };
    const cands: Cand[] = [];

    for (const p of publicadas) {
        const hist = (pick(p, 'status', 'history') ?? []) as Doc[];
        const ts = hist.filter(h => h.status === 'published' && h.timestamp instanceof Date)
            .map(h => h.timestamp as Date);
        if (!ts.length) continue;
        const ult = new Date(Math.max(...ts.map(d => d.getTime())));
        if (ult < corte) continue;
        cands.push({
            ts: ult, propId: p._id as ObjectId,
            ev: {
                clase: 'captacion',
                colonia: txt(pick(p, 'address', 'neighborhood', 'name')),
                tipo: String(p.type ?? 'Propiedad'),
                titulo: String(pick(p, 'listing', 'title') ?? '')
            }
        });
    }

    // ── baja de precio, de `propertyhistories.changes[]`. Dos filtros que NO son
    // opcionales, medidos sobre 30 días: de 620 bajas, 46 eran un cambio de VENTA A RENTA en
    // el mismo movimiento —producen caídas como 22,000,000 → 100,000— y 89 quedaban fuera de
    // rango. Sin esto la pieza sale diciendo "¡Baja de precio! antes $22,000,000, ahora
    // $100,000".
    if (idsPropios.length) {
        const hs = await db.collection('propertyhistories').find(
            {
                propertyId: { $in: idsPropios },
                updatedAt: { $gte: corte },
                'changes.path': 'listing.price.price'
            },
            { projection: { changes: 1, propertyId: 1, updatedAt: 1 }, sort: { updatedAt: -1 } }
        ).toArray() as Doc[];

        for (const h of hs) {
            const cambios = (h.changes ?? []) as Doc[];
            // si la operación cambió en el mismo movimiento, el precio no es comparable
            if (cambios.some(c => c.path === 'listing.operation')) continue;
            const precio = cambios.filter(c => c.path === 'listing.price.price');
            if (!precio.length) continue;
            const antes = Number(precio[precio.length - 1].from);
            const ahoraP = Number(precio[precio.length - 1].to);
            if (!Number.isFinite(antes) || !Number.isFinite(ahoraP)) continue;
            if (!(antes > ahoraP && ahoraP > 0)) continue;
            const pct = (antes - ahoraP) / antes;
            if (pct < BAJA_MIN || pct > BAJA_MAX) continue;
            const prop = await db.collection('properties').findOne(
                { _id: h.propertyId as ObjectId },
                { projection: { address: 1, type: 1, 'listing.title': 1 } }) as Doc | null;
            if (!prop) continue;
            cands.push({
                ts: h.updatedAt as Date, propId: h.propertyId as ObjectId,
                ev: {
                    clase: 'baja_precio',
                    colonia: txt(pick(prop, 'address', 'neighborhood', 'name')),
                    tipo: String(prop.type ?? 'Propiedad'),
                    titulo: String(pick(prop, 'listing', 'title') ?? ''),
                    precio_antes: Math.trunc(antes), precio_ahora: Math.trunc(ahoraP),
                    baja_pct: Math.round(pct * 100)
                }
            });
            break;   // una sola: la más reciente
        }
    }

    // ── contrato y venta. Sólo si ése es el estado ACTUAL: una operación que ya cerró
    // también tiene `contract` en su historial, y celebrar el contrato de algo ya vendido
    // sería mirar al pasado. El asesor cuenta de CUALQUIER lado (captó o trajo al comprador);
    // `user.email` no sirve de criterio: es quien creó el registro, no quien operó.
    const lado = { $or: [{ 'seller.broker.email': suEmail }, { 'buyer.broker.email': suEmail }] };
    for (const [clase, estado] of [['contrato', 'contract'], ['venta', 'closed']] as const) {
        const ops = await db.collection('operations').find(
            { ...lado, 'status.last': estado },
            {
                projection: {
                    'status.history': 1, 'property._id': 1, 'property.address': 1,
                    'property.type': 1, 'property.listing.title': 1
                }
            }
        ).toArray() as Doc[];
        for (const o of ops) {
            const hist = (pick(o, 'status', 'history') ?? []) as Doc[];
            const ts = hist.filter(h => h.status === estado && h.timestamp instanceof Date)
                .map(h => h.timestamp as Date);
            const prop = (o.property ?? {}) as Doc;
            if (!ts.length || !prop._id) continue;
            const ult = new Date(Math.max(...ts.map(d => d.getTime())));
            if (ult < corte) continue;
            cands.push({
                ts: ult, propId: prop._id as ObjectId,
                ev: {
                    clase,
                    colonia: txt(pick(prop, 'address', 'neighborhood', 'name')),
                    tipo: String(prop.type ?? 'Propiedad'),
                    titulo: String(pick(prop, 'listing', 'title') ?? '')
                }
            });
        }
    }

    cands.sort((x, y) => y.ts.getTime() - x.ts.getTime());
    const eventos: Evento[] = cands.map(c => ({
        ...c.ev,
        fecha: fechaISO(c.ts),
        cuando: cuandoDe(c.ts, ahora)
    }));

    // ── el documento completo del aviso del evento más reciente de cada clase: es lo que
    // llena los templates de propiedad/operación
    const PROY = {
        type: 1, 'listing.operation': 1, 'listing.price': 1, address: 1,
        attributes: 1, pictures: 1, development: 1
    };
    const props = new Map<string, Doc>();
    for (const c of cands) {
        if (props.has(c.ev.clase)) continue;
        const d = await db.collection('properties').findOne({ _id: c.propId },
            { projection: PROY }) as Doc | null;
        if (d) props.set(c.ev.clase, d);
    }
    // La pieza de captación sirve para CUALQUIER aviso publicado, no sólo uno reciente: el
    // banner aparece si hay uno nuevo, pero el asesor puede compartir el que quiera.
    if (!props.has('captacion')) {
        const d = await db.collection('properties').findOne(mios,
            { projection: PROY, sort: { publishedAt: -1 } }) as Doc | null;
        if (d) props.set('captacion', d);
    }

    // ── zonas: las suyas primero (van preseleccionadas); después las de la inmobiliaria que
    // no sean ya suyas, comparadas por clave normalizada para no ofrecerle "Bosque de las
    // Lomas" cuando ya tiene "Bosques de las Lomas".
    const mias = agruparColonias(cuenta).slice(0, 5);
    const clavesMias = new Set(mias.map(z => claveColonia(z.zona)));
    let otras: Zona[] = [];
    if (comp._id) {
        const cuentaEmpresa = new Map<string, number>();
        const dela = await db.collection('properties').find(
            { 'company._id': comp._id, 'status.last': 'published' },
            { projection: { 'address.neighborhood.name': 1, 'address.city.name': 1 } }
        ).toArray() as Doc[];
        for (const p of dela) {
            const col = txt(pick(p, 'address', 'neighborhood', 'name'));
            if (!col) continue;
            const k = col + SEP + txt(pick(p, 'address', 'city', 'name'));
            cuentaEmpresa.set(k, (cuentaEmpresa.get(k) ?? 0) + 1);
        }
        otras = agruparColonias(cuentaEmpresa).filter(z => !clavesMias.has(claveColonia(z.zona)));
    }

    // las fotos se guardaron con la grafía cruda; se reindexan a la grafía que ganó el grupo
    // para que la pieza encuentre la foto de la zona y no caiga a "cualquiera"
    const fotosNorm: Record<string, string[]> = {};
    for (const [col, urls] of fotosCrudas) {
        const k = claveColonia(col);
        const nombre = mias.find(z => claveColonia(z.zona) === k)?.zona ?? col;
        fotosNorm[nombre] = [...(fotosNorm[nombre] ?? []), ...urls];
    }

    // ── valores por idea de operación
    const valores: Record<string, Record<string, string>> = {};
    const fotosUrls: Record<string, string[]> = {};
    const fotosAviso: Record<string, number> = {};
    for (const [ideaId, cfg] of Object.entries(tokensPorIdea)) {
        const prop = props.get(cfg.clase);
        if (!prop) continue;
        const fotos = await fotosDeProp(prop);
        const ev = eventos.find(e => e.clase === cfg.clase) ?? null;
        valores[ideaId] = { ...tokensDePropiedad(prop, comp, cfg.tokens ?? [], fotos), ...tokensDelEvento(ev) };
        fotosUrls[ideaId] = fotos.slice(0, 6);
        fotosAviso[ideaId] = fotos.length;
    }

    const personal = String(pick(a, 'personal', 'email') ?? '').trim().toLowerCase();
    const logos = (typeof comp.logo === 'object' && comp.logo !== null ? comp.logo : {}) as Record<string, string>;

    return {
        email: suEmail,
        // El login acepta el email de TRABAJO o el PERSONAL, así que el perfil reconoce los
        // dos: quien entraba con su Google personal pasaba la puerta y después el archivo le
        // decía "todavía no está para tu equipo" (11 de 22 en Diamond House, 7 con Gmail).
        emails: [...new Set([suEmail, personal].filter(Boolean))].sort(),
        nombre: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim(),
        pila: String(a.firstName ?? '').trim(),
        foto: String(a.profilePicture ?? ''),
        // `||` y NO `??`: en Mongo hay agentes con `personal.phone: ''` y el celular bueno en
        // la raíz (`phone: '525559893999'`). Con `??` la cadena vacía no es nula, así que no
        // caía al de la raíz y el perfil salía sin teléfono. Son 2 de los 988 activos, y el
        // comparador contra el Python fue lo que lo cachó.
        telefono: telefonoMx(pick(a, 'personal', 'phone') || a.phone),
        inmobiliaria: String(comp.name ?? ''),
        logo: String(logos.default ?? ''),
        // las 3 variantes: `default` es la inmobiliaria sola (negra), `pulppo` y
        // `pulppoInverted` son el lockup co-marca. El co-brand va en todas las piezas.
        logos,
        rol: a.type === 'master' ? 'titular' : 'asesor',
        zonas: mias,
        // el resto del inventario de la inmobiliaria: el asesor trabaja zonas donde todavía
        // no tiene aviso propio
        zonas_inmobiliaria: otras,
        tipos: [...tipos.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(t => t[0]),
        fotos_por_zona: fotosNorm,
        evento: eventos[0] ?? null,
        eventos: eventos.slice(0, 4),
        total_publicados: [...cuenta.values()].reduce((s, n) => s + n, 0),
        valores,
        fotos_urls: fotosUrls,
        fotos_aviso: fotosAviso
    };
}
