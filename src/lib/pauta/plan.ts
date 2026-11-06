// Plan de pauta del mes: las campañas que define MES (mes.ts), armadas con los datos vivos de cada
// propiedad (artes, demanda, ligas). El reparto lo decide Ale; aquí sólo se arma el paquete y se
// calcula qué queda fuera y por qué.
//
// Tipos de campaña:
// - REACTIVACIÓN (reactivaciones.ts): campaña que ya corrió y vuelve con cambios.
// - SOLA: estrella en su propia campaña (rota cada mes).
// - CARRUSEL: de estrellas (por perfil de comprador) o de prueba (por cluster). Una tarjeta por
//   propiedad; Meta reporta clics por tarjeta.
// - REMARKETING: quien ya vio una ficha de 1·5·10 y no escribió.
//
// Presupuestos AL MES (tope por campaña en MES.tope).
import type { PautaProp } from './index';
import { precioCorto, precioLargo } from './armado';
import { REACTIVACIONES, type Reactivacion } from './reactivaciones';
import { MES, type Mitad } from './mes';

export const MAX_TARJETAS = 5;

export type TipoCampana = 'reactivacion' | 'sola' | 'carrusel' | 'remarketing';

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
    presupuesto: number; // al mes
    mitad: Mitad;
    razon: string;
    // Sólo carrusel:
    textos?: string[];
    tarjetas?: Tarjeta[];
    ubicacion?: string;
    edad?: string;
    intereses?: string[];
    // Sólo reactivación:
    brief?: Reactivacion;
    url?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function tituloTarjeta(p: PautaProp): string {
    const tipo = cap((p.tipo || 'Propiedad').toLowerCase());
    const t = p.colonia ? `${tipo} en ${p.colonia}` : tipo;
    return t.length <= 40 ? t : (p.colonia || tipo).slice(0, 40);
}

export function urlTarjeta(p: PautaProp, campana: string): string {
    const q = new URLSearchParams({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: campana, utm_content: p.code });
    return `https://pulppo.com/propiedades/${p.id}?${q.toString()}`;
}

function carrusel(nombreLegible: string, slugCampana: string, mitad: Mitad, orden: PautaProp[], presupuesto: number, perfil: string): CampanaPlan {
    const nombre = `B2C_CAR_${slugCampana}_exc`;
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
    // Segmentación: un pin por propiedad con el radio de su rango (el más amplio de las tarjetas).
    const radio = Math.max(...orden.map((p) => p.seg.radioKm));
    const intereses = [...new Set(orden.flatMap((p) => p.seg.intereses))];
    return {
        tipo: 'carrusel', nombre, cluster: nombreLegible, codes: orden.map((p) => p.code), presupuesto, mitad,
        razon: `${perfil} ${n} tarjetas.`,
        textos, tarjetas,
        ubicacion: `${radio} km alrededor de cada propiedad (un pin por tarjeta): ${orden.map((p) => p.lat != null ? `${p.code} ${p.lat.toFixed(5)}, ${p.lng!.toFixed(5)}` : `${p.code} sin coordenadas`).join(' · ')}`,
        edad: orden.some((p) => (p.precio ?? 0) >= 10e6) ? '30–65' : '25–65',
        intereses
    };
}

export interface FueraMes {
    code: string;
    inmobiliaria: string;
    donde: string;
    motivo: string;
}

const motivoFuera = (p: PautaProp): string => {
    if (MES.fueraMotivo[p.code]) return MES.fueraMotivo[p.code];
    if ((p.precio ?? 0) >= 15e6) return 'Más de $15M: el lead de Meta casi no llega a visita (DLI-815: $4,317 por visita).';
    if (['Morelos', 'Querétaro', 'Toluca y Valle de Bravo'].includes(p.zona)) return `Fuera del área metropolitana (${p.zona}): poca demanda y otra subasta.`;
    if (!p.foto) return 'Sin foto pública para el arte.';
    if ((p.demanda?.leads ?? 0) >= 20 && !p.demanda?.visitas) return `${p.demanda!.leads} leads y 0 visitas en 60 días: ráfaga sin intención de compra.`;
    const v = p.demanda?.visitas ?? 0;
    return `Poca demanda en 60 días (${p.demanda?.leads ?? 0} personas, ${v} ${v === 1 ? 'visita' : 'visitas'}): entra a la rotación si se libera una tarjeta.`;
};

export function armarPlan(props: PautaProp[]): { plan: CampanaPlan[]; fuera: FueraMes[]; faltan: string[] } {
    const plan: CampanaPlan[] = [];
    const vivas = new Map(props.filter((p) => !p.excluida).map((p) => [p.code, p]));
    const faltan: string[] = []; // códigos del MES que ya no están vivos o salieron de pauta
    const tomar = (codes: string[]) => codes.flatMap((k) => { const p = vivas.get(k); if (!p) faltan.push(k); return p ? [p] : []; });

    for (const r of REACTIVACIONES) {
        const [p] = tomar([r.code]);
        if (!p) continue;
        const nombre = `${p.campana}_v2`;
        // utm_content va como macro de Meta, sin codificar, para que Meta la sustituya por el id del anuncio.
        const url = `${urlTarjeta(p, nombre).replace(/&utm_content=[^&]*/, '')}&utm_content={{ad.id}}`;
        plan.push({
            tipo: 'reactivacion', nombre, cluster: `Reactivación · ${p.code}`, codes: [p.code], presupuesto: r.presupuesto, mitad: 'prueba',
            razon: `Vuelve con cambios (decidido ${r.desde}). Antes: ${r.anterior.resultado}`,
            textos: r.textos, brief: r, url,
            ubicacion: r.cambios.find((c) => c.tema === 'Ubicación')?.despues,
            edad: r.cambios.find((c) => c.tema === 'Edad')?.despues
        });
    }

    for (const p of tomar(MES.solas)) {
        const d = p.demanda;
        plan.push({
            tipo: 'sola', nombre: p.campana, cluster: `Estrella sola · ${p.code}`, codes: [p.code], presupuesto: MES.tope, mitad: 'estrellas',
            razon: `${d?.leads ?? 0} personas y ${d?.visitas ?? 0} visitas en 60 días fuera de Meta. Rota a fin de mes: vuelve a su carrusel y entra otra estrella. Si recibe oferta, apagar.`
        });
    }

    for (const c of MES.carruseles) {
        const ps = tomar(c.codes).slice(0, MAX_TARJETAS);
        if (ps.length < 2) continue; // Meta pide 2+ tarjetas
        plan.push(carrusel(c.nombre, c.slug, c.mitad, ps, MES.tope, c.perfil));
    }

    // Remarketing: las tarjetas de las estrellas (lo que más convierte) a quien ya vio una ficha.
    const estrellasMes = [...MES.solas, ...MES.carruseles.filter((c) => c.mitad === 'estrellas').flatMap((c) => c.codes)];
    const rm = tomar(estrellasMes).slice(0, MAX_TARJETAS);
    if (rm.length >= 2) {
        const c = carrusel('Remarketing', 'Remarketing_1510', 'compartido', rm, MES.remarketing, 'Quien ya vio una ficha de 1·5·10 en 30 días y no escribió:');
        plan.push({
            ...c, tipo: 'remarketing',
            textos: [
                '¿Te quedaste pensando en alguna? Estas exclusivas Pulppo siguen disponibles. Un solo asesor te da toda la información y te agenda la visita por WhatsApp.',
                'Siguen disponibles. Desliza, elige la que te late y agenda tu visita por WhatsApp.',
                c.textos![0]
            ],
            ubicacion: 'Sin ubicación: público personalizado (ver instrucciones de remarketing).',
            edad: '25–65',
            intereses: []
        });
    }

    const dentro = new Set(plan.flatMap((c) => c.codes));
    const fuera = props.filter((p) => !p.excluida && !dentro.has(p.code)).map((p) => ({
        code: p.code, inmobiliaria: p.inmobiliaria, donde: `${p.colonia || p.ciudad || ''}${p.precio ? ` · ${precioCorto(p.precio)}` : ''}`, motivo: motivoFuera(p)
    })).sort((a, b) => a.motivo.localeCompare(b.motivo, 'es'));
    return { plan, fuera, faltan: [...new Set(faltan)] };
}
