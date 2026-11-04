// Plan de pauta: cómo se reparte el presupuesto entre campañas. Lógica pura (la UI recorta el plan
// al presupuesto disponible en el navegador).
//
// Tres tipos de campaña, en este orden de prioridad:
// 1. ESTRELLA, sola: la demanda en portales ya probó que la propiedad jala (ver esEstrella). Es la
//    apuesta más segura por peso invertido; si recibe oferta se apaga.
// 2. CARRUSEL por cluster (zona × rango de precio): una campaña con una tarjeta por propiedad.
//    Junta el aprendizaje de Meta en un solo conjunto en vez de 50 campañas de $1,500 que nunca
//    salen de aprendizaje, y Meta reporta clics por tarjeta: la que jala se vuelve estrella y la
//    que no se saca. Las estrellas NO van en el carrusel de su cluster: competirían por el mismo
//    público en la misma subasta.
// 3. SUELTA: el cluster quedó con una sola propiedad (Meta pide 2+ tarjetas para carrusel). Antes
//    de dejarla sola se suma al carrusel de su misma zona en otro rango (abajo de $15M): el público
//    es el mismo por geografía.
//
// Montos por vuelo de 14 días. Base: $1,500 por propiedad de las campañas de febrero, las más
// baratas de la cuenta. En carrusel cada tarjeta rinde más porque comparten aprendizaje, por eso
// $500 por tarjeta con piso de $1,500 y techo de $4,000. Arriba de $15M, la mitad (pauta de marca:
// el lead de Meta casi no llega a visita).
import type { PautaProp } from './index';
import { BANDAS, precioCorto, precioLargo } from './armado';

export const DIAS_VUELO = 14;
export const MAX_TARJETAS = 10;

export type TipoCampana = 'estrella' | 'carrusel' | 'suelta';

export interface Tarjeta {
    code: string;
    inmobiliaria: string;
    titulo: string;      // ≤40 caracteres
    descripcion: string; // ≤20 caracteres se ven completos; Meta corta el resto
    url: string;
    estrella: boolean;
    video: boolean;
}

export interface CampanaPlan {
    tipo: TipoCampana;
    nombre: string;
    cluster: string;
    codes: string[];
    presupuesto: number;
    prioridad: number;   // menor = primero
    razon: string;
    // Sólo carrusel:
    textos?: string[];
    tarjetas?: Tarjeta[];
    ubicacion?: string;
    edad?: string;
    intereses?: string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\$/g, '').replace(/–/g, 'a').replace(/[^A-Za-z0-9]+/g, ' ').trim()
        .split(' ').map(cap).join('');
const alta = (p: PautaProp) => (p.precio ?? 0) >= 15e6;
const tasaVisita = (p: PautaProp) => (p.demanda && p.demanda.leads ? p.demanda.visitas / p.demanda.leads : 0);

// Orden dentro del carrusel: la que más visitas trae va primero (Meta muestra primero la 1ª tarjeta).
// Las que juntan leads sin visitas (ráfagas de portal) van al final, no arriba por volumen.
const sinVisitas = (p: PautaProp) => (p.demanda?.leads ?? 0) >= 20 && (p.demanda?.visitas ?? 0) === 0;
const porDemanda = (a: PautaProp, b: PautaProp) =>
    Number(sinVisitas(a)) - Number(sinVisitas(b))
    || (b.demanda?.visitas ?? 0) - (a.demanda?.visitas ?? 0) || (b.demanda?.leads ?? 0) - (a.demanda?.leads ?? 0);

function tituloTarjeta(p: PautaProp): string {
    const tipo = cap((p.tipo || 'Propiedad').toLowerCase());
    const t = p.colonia ? `${tipo} en ${p.colonia}` : tipo;
    return t.length <= 40 ? t : (p.colonia || tipo).slice(0, 40);
}

export function urlTarjeta(p: PautaProp, campana: string): string {
    const q = new URLSearchParams({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: campana, utm_content: p.code });
    return `https://pulppo.com/propiedades/${p.id}?${q.toString()}`;
}

function carrusel(cluster: string, ps: PautaProp[], prioridad: number): CampanaPlan {
    const [zona, banda] = cluster.split(' · ');
    const nombre = `B2C_CAR_${slug(zona)}_${slug(banda)}_exc`;
    const orden = [...ps].sort(porDemanda).slice(0, MAX_TARJETAS);
    const precios = orden.map((p) => p.precio).filter((x): x is number => x != null).sort((a, b) => a - b);
    const rango = precios.length ? (precios[0] === precios[precios.length - 1]
        ? precioLargo(precios[0]) : `de ${precioCorto(precios[0])} a ${precioCorto(precios[precios.length - 1])}`) : '';
    // Las zonas son internas ("Norte", "Centro Sur"): en el anuncio van las alcaldías/municipios y colonias.
    const lista = (xs: string[]) => xs.length <= 3 ? xs.join(', ').replace(/, ([^,]*)$/, ' y $1') : `${xs.slice(0, 3).join(', ')} y más`;
    const donde = lista([...new Set(orden.map((p) => p.colonia).filter(Boolean))] as string[]);
    const ciudades = lista([...new Set(orden.map((p) => p.ciudad).filter(Boolean))] as string[]);
    const tipos = new Set(orden.map((p) => (p.tipo || '').toLowerCase().startsWith('casa') ? 'casas' : 'departamentos'));
    const queVende = tipos.size === 2 ? 'Casas y departamentos' : cap([...tipos][0]);
    const n = orden.length;
    const textos = [
        `${queVende} en venta en ${ciudades}${rango ? `, ${rango}` : ''}. ${n} exclusivas Pulppo: cada una con un solo asesor que te da toda la información y te agenda la visita por WhatsApp.`,
        `${queVende} en ${donde}. Desliza, elige la que te late y agenda tu visita por WhatsApp.`,
        `Pocas veces salen a la venta propiedades así en ${ciudades}. ${n} opciones${rango ? ` ${rango}` : ''}, con fotos y recorrido. Agenda tu visita.`
    ];
    const tarjetas: Tarjeta[] = orden.map((p) => ({
        code: p.code,
        inmobiliaria: p.inmobiliaria,
        titulo: tituloTarjeta(p),
        descripcion: [precioCorto(p.precio), p.rec ? `${p.rec} rec` : '', p.m2 ? `${Math.round(p.m2)} m²` : ''].filter(Boolean).join(' · '),
        url: urlTarjeta(p, nombre),
        estrella: p.estrella,
        video: p.videos.length > 0
    }));
    const marca = banda === BANDAS[2];
    const presupuesto = Math.round(Math.min(4000, Math.max(1500, 500 * n)) * (marca ? 0.5 : 1));
    // Segmentación: un pin por propiedad con el radio de su rango (el más amplio de las tarjetas).
    const radio = Math.max(...orden.map((p) => p.seg.radioKm));
    const intereses = [...new Set(orden.flatMap((p) => p.seg.intereses))];
    return {
        tipo: 'carrusel', nombre, cluster, codes: orden.map((p) => p.code), presupuesto, prioridad,
        razon: marca
            ? `${n} propiedades de $15M+: carrusel a la mitad del monto, como pauta de marca.`
            : `${n} propiedades del mismo público en una sola campaña. A los ${DIAS_VUELO} días, revisar clics por tarjeta.`,
        textos, tarjetas,
        ubicacion: `${radio} km alrededor de cada propiedad (un pin por tarjeta): ${orden.map((p) => p.lat != null ? `${p.code} ${p.lat.toFixed(5)}, ${p.lng!.toFixed(5)}` : `${p.code} sin coordenadas`).join(' · ')}`,
        edad: orden.some((p) => (p.precio ?? 0) >= 10e6) ? '30–65' : '25–65',
        intereses
    };
}

export function armarPlan(props: PautaProp[]): CampanaPlan[] {
    const pautables = props.filter((p) => !p.excluida && p.foto);
    const plan: CampanaPlan[] = [];

    for (const p of pautables.filter((x) => x.estrella).sort(porDemanda)) {
        const d = p.demanda!;
        plan.push({
            tipo: 'estrella', nombre: p.campana, cluster: p.cluster, codes: [p.code],
            presupuesto: alta(p) ? 750 : 1500, prioridad: 1,
            razon: `${d.leads} personas y ${d.visitas} visitas en 60 días fuera de Meta (${Math.round(tasaVisita(p) * 100)}% visita). Si recibe oferta, apagar.`
        });
    }

    const resto = new Map<string, PautaProp[]>();
    for (const p of pautables.filter((x) => !x.estrella)) resto.set(p.cluster, [...(resto.get(p.cluster) || []), p]);
    for (const [cluster, ps] of [...resto]) {
        if (ps.length !== 1 || cluster.endsWith(BANDAS[2])) continue;
        const zona = cluster.split(' · ')[0];
        const destino = [...resto.entries()].find(([k, v]) => k !== cluster && k.startsWith(`${zona} · `) && !k.endsWith(BANDAS[2]) && v.length >= 2);
        if (destino) { destino[1].push(ps[0]); resto.delete(cluster); }
    }
    for (const [cluster, ps] of resto) {
        const marca = cluster.endsWith(BANDAS[2]);
        if (ps.length >= 2) {
            plan.push(carrusel(cluster, ps, marca ? 4 : 2));
        } else {
            const p = ps[0];
            plan.push({
                tipo: 'suelta', nombre: p.campana, cluster, codes: [p.code],
                presupuesto: alta(p) ? 500 : 750, prioridad: marca ? 4 : 3,
                razon: 'Única propiedad de su cluster (el carrusel pide 2+ tarjetas): anuncio sencillo con su paquete.'
            });
        }
    }

    // Dentro de cada prioridad, primero lo que más demanda trae por propiedad.
    const visitasDe = (c: CampanaPlan) => {
        const ps = c.codes.map((k) => props.find((p) => p.code === k)!);
        return ps.reduce((s, p) => s + (p.demanda?.visitas ?? 0), 0) / ps.length;
    };
    return plan.sort((a, b) => a.prioridad - b.prioridad || visitasDe(b) - visitasDe(a));
}
