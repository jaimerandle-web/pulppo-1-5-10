// Armado del paquete de pauta de una exclusiva 1·5·10: copies, segmentación, nombre de campaña
// y UTMs. Lógica pura (sin mongodb) para que la UI también pueda usar los tipos.
//
// De dónde salen las reglas — análisis de la cuenta de Meta del 3-nov-2026 (act_352522417013101,
// 25 campañas de exclusivas, $68K, cruzado contra leads y visitas del CRM):
// · Las de febrero (`B2C_TF_…`) fueron las más baratas: $1,500 por propiedad, video, radio de
//   3–6 km alrededor de la propiedad, 25–65 años, intereses de vivienda e hipoteca y 4–5 textos
//   en creativo dinámico. En CDMX abajo de $12M dieron leads a $49–75.
// · Esos textos NO llevaban emojis y eran los que mejor rendían; los de mayo-agosto con listas de
//   emojis costaron más. Aquí no se usan (además lo pide la marca).
// · Arriba de $15M el lead de Meta casi no llega a visita (5% en may–sep, ver memoria de
//   atribución) y Yucatán dio 0 visitas con Meta → se marcan como aviso, no se excluyen.
// · Siete campañas de febrero llevaban el texto de OTRA propiedad (copiar y pegar). Por eso los
//   copies salen de los datos de la propiedad y nunca se escriben a mano.

export type Formato = '1x1' | '4x5' | '9x16' | '191x1';

export const FORMATOS: { id: Formato; nombre: string; w: number; h: number; uso: string }[] = [
    { id: '1x1', nombre: 'Cuadrado 1:1', w: 1080, h: 1080, uso: 'Feed de Facebook e Instagram' },
    { id: '4x5', nombre: 'Vertical 4:5', w: 1080, h: 1350, uso: 'Feed (ocupa más pantalla)' },
    { id: '9x16', nombre: 'Historia 9:16', w: 1080, h: 1920, uso: 'Stories y Reels' },
    { id: '191x1', nombre: 'Horizontal 1.91:1', w: 1200, h: 628, uso: 'Columna derecha y Audience Network' }
];

export interface DatosProp {
    id: string;
    code: string;
    tipo: string;
    colonia: string | null;
    ciudad: string | null;
    estado: string | null;
    precio: number | null;
    m2: number | null;
    terreno: number | null;
    rec: number | null;
    banos: number | null;
    park: number | null;
    amenidades: string[];
    lat: number | null;
    lng: number | null;
}

export interface Copies {
    textos: { angulo: string; texto: string }[];
    titulos: string[];
    descripcion: string;
    cta: string;
}

export interface Segmentacion {
    ubicacion: string;
    radioKm: number;
    edad: string;
    intereses: string[];
    publico: string;
    objetivo: string;
    presupuesto: string;
    ubicaciones: string;
}

// Tres rangos: el punto dulce de Meta es $4–15M (69% de los leads, ~21% llega a visita); arriba
// de $15M casi nadie visita. Partir más fino dejaba clusters de una sola propiedad.
export const BANDAS = ['Hasta $5M', '$5–15M', '$15M+'] as const;

export function bandaDe(precio: number | null): string {
    if (precio == null) return 'Sin precio';
    if (precio < 5e6) return BANDAS[0];
    if (precio < 15e6) return BANDAS[1];
    return BANDAS[2];
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('es-MX');
export const precioLargo = (n: number | null) => (n == null ? '' : `$${fmtInt(n)}`);
export const precioCorto = (n: number | null) => {
    if (n == null) return '';
    const m = n / 1e6;
    return `$${m >= 10 ? m.toFixed(1).replace(/\.0$/, '') : m.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}M`;
};
const numTxt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// Tipo como sustantivo en minúscula, con su artículo.
function sustantivo(tipo: string): { s: string; un: string } {
    const t = tipo.toLowerCase();
    if (t.startsWith('casa')) return { s: t, un: 'una' };
    if (t === 'ph' || t.includes('penthouse')) return { s: 'penthouse', un: 'un' };
    if (t.startsWith('terreno')) return { s: 'terreno', un: 'un' };
    return { s: t || 'propiedad', un: t ? 'un' : 'una' };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Amenidades que sí venden, en orden de peso. El nombre de Mongo → cómo se dice en el anuncio.
const AMENIDADES: [string, string][] = [
    ['Jardín Privado', 'jardín privado'], ['Roof Garden', 'roof garden'], ['Alberca', 'alberca'],
    ['Terraza', 'terraza'], ['Jardín', 'jardín'], ['Gimnasio', 'gimnasio'], ['Vestidor', 'vestidor'],
    ['Estudio/Oficina', 'estudio'], ['Balcón', 'balcón'], ['Asador', 'asador'],
    ['Seguridad 24 horas', 'seguridad 24 horas'], ['Elevador', 'elevador'], ['Cuarto de servicio', 'cuarto de servicio']
];

export function amenidadesClave(nombres: string[]): string[] {
    const set = new Set(nombres.map((n) => n.toLowerCase()));
    const out: string[] = [];
    for (const [k, v] of AMENIDADES) {
        if (!set.has(k.toLowerCase())) continue;
        if (v === 'jardín' && out.includes('jardín privado')) continue;
        out.push(v);
    }
    return out.slice(0, 3);
}

const lista = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

export function armarCopies(p: DatosProp): Copies {
    const { s, un } = sustantivo(p.tipo);
    const donde = p.colonia || p.ciudad || '';
    const enDonde = donde ? ` en ${donde}` : '';
    const am = amenidadesClave(p.amenidades);
    const m2 = p.m2 != null ? `${fmtInt(p.m2)} m²` : '';
    const rec = p.rec != null && p.rec > 0 ? `${p.rec} recámara${p.rec === 1 ? '' : 's'}` : '';
    const banos = p.banos != null && p.banos > 0 ? `${numTxt(p.banos)} baño${p.banos === 1 ? '' : 's'}` : '';
    const park = p.park != null && p.park > 0 ? `${p.park} estacionamiento${p.park === 1 ? '' : 's'}` : '';
    const precio = precioLargo(p.precio);

    const textos: { angulo: string; texto: string }[] = [];

    // 1. Ficha: lo que el comprador filtra primero. Siempre va.
    const ficha = [m2 && `${m2} construidos`, rec, banos, park].filter(Boolean);
    textos.push({
        angulo: 'Ficha',
        texto: `${cap(s)} en venta${enDonde}${p.ciudad && p.ciudad !== donde ? `, ${p.ciudad}` : ''}. ${ficha.length ? cap(lista(ficha)) + '. ' : ''}${precio ? precio + '. ' : ''}Agenda tu visita por WhatsApp.`
    });

    // 2. Espacio: el ángulo que mejor jaló en febrero ("cada hijo en su cuarto").
    if (m2) {
        textos.push({
            angulo: 'Espacio',
            texto: p.rec != null && p.rec >= 3
                ? `${m2} y ${rec}${enDonde}: espacio para que cada quien tenga el suyo.${am.length ? ` Con ${lista(am)}.` : ''} Agenda tu visita.`
                : `${m2} bien aprovechados${enDonde}.${am.length ? ` Con ${lista(am)}.` : ''} Agenda tu visita.`
        });
    }

    // 3. Lo que tiene: sólo si hay amenidades reales cargadas.
    if (am.length >= 2) {
        textos.push({
            angulo: 'Amenidades',
            texto: `${cap(s)}${enDonde} con ${lista(am)}.${precio ? ` ${precio}.` : ''} Agenda tu visita y conócela.`
        });
    }

    // 4. Escasez: exclusiva = un solo asesor y la información completa.
    textos.push({
        angulo: 'Escasez',
        texto: `Pocas veces sale a la venta ${un} ${s}${m2 ? ` de ${m2}` : ''}${enDonde}. Es exclusiva Pulppo: un solo asesor te da toda la información y te agenda la visita.`
    });

    // 5. Precio por m²: dato duro, sin adjetivos.
    if (p.precio && p.m2) {
        textos.push({
            angulo: 'Precio',
            texto: `${precio} por ${m2}${enDonde}: $${fmtInt(p.precio / p.m2)} por m². Mira las fotos y el recorrido, y agenda tu visita.`
        });
    }

    const titulo1 = `${cap(s)}${enDonde}`;
    const titulos = [
        titulo1.length <= 40 ? titulo1 : `${cap(s)} en venta`,
        [precioCorto(p.precio), m2, rec].filter(Boolean).join(' · '),
        donde ? `Exclusiva en ${donde}`.slice(0, 40) : 'Exclusiva Pulppo'
    ].filter(Boolean);

    return {
        textos,
        titulos,
        descripcion: [rec, banos, m2].filter(Boolean).join(' · '),
        cta: 'Enviar mensaje de WhatsApp'
    };
}

const URBANO = new Set(['ciudad de mexico', 'edo. de mexico', 'estado de mexico']);
const norm = (s: string | null) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function armarSegmentacion(p: DatosProp): Segmentacion {
    const urbano = URBANO.has(norm(p.estado));
    const precio = p.precio ?? 0;
    const radioKm = !urbano ? 10 : precio >= 15e6 ? 8 : precio >= 10e6 ? 5 : 3;
    const intereses = [
        'Casa (bienes raíces)', 'Apartamento (bienes raíces)',
        'Préstamos hipotecarios (banca)', 'Calculadora de hipotecas (crédito y préstamos)'
    ];
    if (precio < 12e6 && (p.rec ?? 0) >= 2) intereses.push('Recién casados');
    if (precio >= 10e6) intereses.push('Personas que prefieren artículos de alto valor en México', 'American Express');

    const pin = p.lat != null && p.lng != null ? ` (pin en ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})` : '';
    return {
        ubicacion: `${radioKm} km alrededor de la propiedad${pin}. Personas que viven o estuvieron recientemente ahí.`,
        radioKm,
        edad: precio >= 10e6 ? '30–65' : '25–65',
        intereses,
        publico: 'Advantage+ encendido, con los intereses como sugerencia (así corrieron las de febrero). '
            + 'Opcional: subir la base de compradores de la zona (CSV en Campañas → Generar base) como público personalizado y crear un similar de 1–3%.',
        objetivo: 'Clientes potenciales · conversión en el sitio (clic al botón de WhatsApp de la ficha)',
        presupuesto: precio >= 15e6
            ? '$750, como pauta de marca: arriba de $15M el lead de Meta casi no llega a visita. Revisar a los 14 días.'
            : '$1,500 por propiedad (lo que costó cada campaña de febrero). Revisar a los 14 días: si el costo por lead en el CRM pasa de $300, pausar.',
        ubicaciones: 'Automáticas (Advantage+). Subir los 4 tamaños para que Meta use el correcto en cada lugar.'
    };
}

const slug = (s: string | null) =>
    norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(cap).join('');

// Nombre con la convención que ya usa el equipo (B2C_<código>_<zona>_exc_<tipo>-<colonia>), para
// que el utm_campaign sea igual al nombre y el lead caiga en el CRM ligado a la campaña.
export function nombreCampana(p: DatosProp, zona: string): string {
    return `B2C_${p.code}_${slug(zona) || 'mx'}_exc_${slug(p.tipo).toLowerCase()}-${slug(p.colonia)}`;
}

export function urlConUtm(p: DatosProp, campana: string): string {
    const q = new URLSearchParams({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: campana });
    return `https://pulppo.com/propiedades/${p.id}?${q.toString()}`;
}

export function urlArte(code: string, formato: Formato, descargar = false): string {
    return `/api/pauta/arte?code=${encodeURIComponent(code)}&formato=${formato}${descargar ? '&descargar=1' : ''}`;
}
