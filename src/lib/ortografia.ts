// Ortografía de títulos y descripciones (/mb → Errores y etiqueta «Corregir ortografía»).
//
// Corrector hunspell en español (diccionario `dictionary-es`, en src/lib/ortografia/) con nspell.
// Crudo marca demasiado: el vocabulario del ramo (ludoteca, antecomedor, tapanco, predial), los
// anglicismos normales en México (roof garden, lobby, coworking) y nombres de colonias escritos en
// minúscula. Por eso sólo se reportan dos cosas, de alta precisión (medido en Diamond House, oct-2026):
//   · ACENTO que falta — «jardin» → «jardín»: la palabra no existe y SÍ existe con un acento (o ñ).
//     Es el error más común (área, salón, también, ubicación, mármol…) y casi sin falsos positivos.
//   · ERROR DE DEDO — «vijilancia» → «vigilancia»: a UNA letra de una palabra real, de 6+ letras y
//     fuera de la lista del ramo. Sale como «posible»: lo confirma una persona.
// Se ignoran palabras con mayúscula inicial (nombres propios), siglas, URLs, correos y HTML.
import fs from 'node:fs';
import path from 'node:path';
import nspell from 'nspell';
import { getDb } from './data';

let _spell: ReturnType<typeof nspell> | null = null;
function spell() {
    if (_spell) return _spell;
    const dir = path.join(process.cwd(), 'src', 'lib', 'ortografia');
    _spell = nspell({ aff: fs.readFileSync(path.join(dir, 'es.aff')), dic: fs.readFileSync(path.join(dir, 'es.dic')) });
    return _spell;
}

// Vocabulario inmobiliario y anglicismos de uso normal: NO son error.
const OK = new Set(`ludoteca closet closets clóset clósets predial antecomedor desayunador cocineta tapanco asoleadero palapa salita preventa
roof garden room family paddle pádel padel paddel center walk walking business valet parking coworking lounge mini loft lofts office country lobby
premium fire living house jogging snack squash friendly working tennis yoga gym spa pet bar grill studio penthouse duplex dúplex triplex
townhouse kids club home smart split boiler hall deck jacuzzi sauna vapor steam pool wifi internet cctv amenidades amenidad roofgarden rooftop
vestidor vestidores cancel canceles cancelería domótica domotica alberca recámara recámaras cajón cajones bodega bodegas cisterna
hidroneumático hidroneumatico calentador mantenimiento condominio condominal privada fraccionamiento residencial departamento depto deptos
estudio airbnb metrobús metrobus ecobici bike sky view views sunset beach front backyard dog park playground laundry lavandería service junior
master suite suites king queen chef bbq barbecue fitness wellness concierge resort parquet lockers locker sushi restaurant garage hielera
vehicular ventanería futbolito golfito lambrines lambrín tzalam interfón dimmer pantry maple hills depa depas semi site juice infant visit
ring dlls usd mxn mts mt mtrs m2 inmuebles portón bungalow bungalows rooftop terraza terrazas multiusos family-room walk-in amenity
accesar básquet basquet enamórate lotificación lotificaciones intercomunicados intercomunicado parrilladas parrillada bardeada bardeado
presurizador vehiculares cuádruplex grifería griferías asalita pergolado domotizado domotizada acondicionado climatizada climatizado
multifamiliar plurifamiliar unifamiliar remodelado remodelada amueblado amueblada semiamueblado semiamueblada equipada equipado
`.split(/\s+/).filter(Boolean));
// Palabras del ramo que tienen PRIORIDAD como corrección: el corrector genérico sugiere «racimaras» para
// «racámaras» y «lacado» para «labado»; en un aviso inmobiliario casi siempre es «recámaras» y «lavado».
const DOMINIO = `recámara recámaras cuarto cuartos baño baños medio despensa lavado lavadero ascensor elevador estacionamiento
estacionamientos cajón cajones terraza terrazas jardín jardines vigilancia seguridad cocina comedor sala estancia vestidor balcón
departamento departamentos casa casas oficina oficinas bodega bodegas alberca gimnasio amenidades mantenimiento ubicación ubicada
ubicado excelente espacios espacio amplio amplia amplios amplias luminoso luminosa iluminación ventilación construcción privada
condominio escuelas centros comerciales encontrar mejores mejor cerca acceso calle avenida piso pisos nivel niveles precio renta venta
abierta abierto abiertos estudio servicio servicios cisterna calentador tinaco medidor seguridad privada familia familiar
pérgola parking encontrar mascota mascotas crédito créditos hipotecario hipotecaria contado
escriturada escriturado escrituras predial vigilancia`.split(/\s+/).filter(Boolean);
const ACC: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
const sinAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const lev = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
};

export interface ErrorOrto { palabra: string; bien: string; tipo: 'acento' | 'dedo'; donde: 'título' | 'descripción' }

const cache = new Map<string, { bien: string; tipo: 'acento' | 'dedo' } | null>();
function revisarPalabra(lw: string): { bien: string; tipo: 'acento' | 'dedo' } | null {
    if (cache.has(lw)) return cache.get(lw)!;
    const sp = spell();
    let r: { bien: string; tipo: 'acento' | 'dedo' } | null = null;
    if (!sp.correct(lw)) {
        // acento en la sílaba equivocada («creditó» → «crédito»): sin acento, o con el acento en otra vocal
        const base = sinAcento(lw);
        if (base !== lw) {
            if (sp.correct(base)) r = { bien: base, tipo: 'acento' };
            for (let i = 0; i < base.length && !r; i++) {
                const c = ACC[base[i]] ? base.slice(0, i) + ACC[base[i]] + base.slice(i + 1) : null;
                if (c && c !== lw && sp.correct(c)) r = { bien: c, tipo: 'acento' };
            }
        }
        for (let i = 0; i < lw.length && !r; i++) {
            const c = ACC[lw[i]] ? lw.slice(0, i) + ACC[lw[i]] + lw.slice(i + 1) : lw[i] === 'n' ? lw.slice(0, i) + 'ñ' + lw.slice(i + 1) : null;
            if (c && sp.correct(c)) r = { bien: c, tipo: 'acento' };
        }
        if (!r && lw.length >= 5) {
            // primero el vocabulario del ramo (hasta 2 letras de diferencia), luego el corrector (1 letra)
            const base = sinAcento(lw);
            const dom = DOMINIO.map((x) => [x, lev(sinAcento(x), base)] as const).filter(([, n]) => n <= (base.length >= 7 ? 2 : 1)).sort((a, b) => a[1] - b[1])[0];
            const sug = dom ? dom[0] : lw.length >= 6 ? sp.suggest(lw).find((x) => x === x.toLowerCase() && lev(sinAcento(x), base) === 1) : undefined;
            if (sug) r = { bien: sug, tipo: 'dedo' };
        }
    }
    cache.set(lw, r);
    return r;
}

/** Errores de un texto. `extra`: palabras que no son error en este contexto (colonias, calles). */
export function revisarTexto(txt: unknown, donde: ErrorOrto['donde'], extra: Set<string>): ErrorOrto[] {
    const limpio = String(txt ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
    const out = new Map<string, ErrorOrto>();
    for (const m of limpio.matchAll(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g)) {
        const w = m[0], lw = w.toLowerCase();
        if (lw.length < 4 || out.has(lw) || /^[A-ZÁÉÍÓÚÑ]/.test(w) || OK.has(lw) || OK.has(sinAcento(lw)) || extra.has(lw) || extra.has(sinAcento(lw))) continue;
        const r = revisarPalabra(lw);
        if (r) out.set(lw, { palabra: lw, bien: r.bien, tipo: r.tipo, donde });
    }
    return [...out.values()];
}

// Nombres de colonias, ciudades y estados de TODA la red: en minúscula dentro de una descripción no son
// error («polanco», «anzures»). Se arma una vez al día.
let lugares: { t: number; s: Set<string> } | null = null;
export async function lugaresRed(): Promise<Set<string>> {
    if (lugares && Date.now() - lugares.t < 24 * 3600 * 1000) return lugares.s;
    const db = await getDb();
    const s = new Set<string>();
    for (const campo of ['address.neighborhood.name', 'address.city.name', 'address.state.name'])
        for (const v of await db.collection('properties').distinct(campo))
            for (const w of String(v ?? '').toLowerCase().match(/[a-záéíóúüñ]{4,}/g) ?? []) s.add(w);
    lugares = { t: Date.now(), s };
    return s;
}

/** Faltas del título y la descripción de un aviso. Si el diccionario no carga, devuelve [] (no rompe la ficha). */
export async function revisarAviso(a: { titulo: unknown; descripcion: unknown; calle?: unknown }, lugares?: Set<string>): Promise<ErrorOrto[]> {
    try {
        const base = lugares ?? await lugaresRed();
        const calle = String(a.calle ?? '').toLowerCase().match(/[a-záéíóúüñ]{4,}/g) ?? [];
        const ex = calle.length ? new Set([...base, ...calle]) : base;
        return [...revisarTexto(a.titulo, 'título', ex), ...revisarTexto(a.descripcion, 'descripción', ex)];
    } catch (e) {
        console.error('[ortografia]', e);
        return [];
    }
}
