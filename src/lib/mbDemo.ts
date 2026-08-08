// Inmobiliaria DEMO para enseñar el panel en vivo sin exponer datos de nadie.
//
// Por qué existe: en la sesión con master brokers hay que proyectar la herramienta funcionando.
// Usar una inmobiliaria real expone su cartera frente a sus competidores; usar una vacía no
// enseña nada. Esto genera una cartera sintética pero verosímil.
//
// Reglas que se respetaron:
//   · NO escribe nada en Mongo. Todo se arma en memoria, en este archivo.
//   · Las proporciones salen de los agregados reales de la red (ago-2026): 77/23 venta-renta,
//     calidad 19/63/18, 57% sin video, 77% sin documento, 82% sin contrato.
//   · Los nombres de asesor son inventados y se verificaron contra los 1,876 asesores reales
//     de la base: ninguno coincide, ni por nombre completo ni por apellido.
//   · Las colonias sí son reales, porque son lo que hace que la demo se sienta creíble.
//   · Generación DETERMINISTA (semilla fija): la demo se ve igual en cada recarga. En vivo eso
//     importa — no se puede ensayar sobre datos que cambian.

import type { MBData, MBProp, MBZona, MBAsesor, PorOpCal, PorOpFalta, RespKey } from './mb';

// PRNG con semilla (mulberry32). Math.random() haría que la demo cambie entre recargas.
function rng(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const r = rng(20260808);
const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
const ent = (a: number, b: number) => Math.floor(a + r() * (b - a + 1));

const ASESORES = ['Paulina Bracamontes', 'Andrés Quintanar', 'Lucero Madrigal', 'Joaquín Berriozábal',
    'Bruno Aramburu', 'Ivanna Isunza', 'Rodrigo Necoechea', 'Camila Tagle'];

// Colonia, demanda de la zona, y $/m² de referencia. Mezcla de zonas caras y medias para que la
// tabla "Tus zonas" tenga contraste y no se vea toda igual.
const ZONAS: [string, number, number][] = [
    ['Polanco', 727, 92000], ['Del Valle Centro', 512, 62000], ['Nápoles', 341, 55000],
    ['Roma Norte', 468, 71000], ['Interlomas', 289, 58000], ['Lomas de Chapultepec', 396, 105000],
    ['Santa Fe', 254, 64000], ['Narvarte Poniente', 297, 47000],
];
const TIPOS = ['Departamento', 'Casa', 'Casa en condominio', 'Oficina'];
const CALLES = ['Av. Horacio', 'Gabriel Mancera', 'Pensilvania', 'Colima', 'Paseo de los Laureles',
    'Monte Líbano', 'Vasco de Quiroga', 'Diagonal San Antonio'];

const N_VENTA = 108, N_RENTA = 32;      // 140 propiedades · 77/23, como la red

function codigo(i: number) {
    const L = 'BCDFGHJKLMNPQRSTVWXZ';
    return `${L[i % 20]}${L[(i * 7) % 20]}${L[(i * 3) % 20]}-${String(100 + ((i * 37) % 900))}`;
}

export function demoData(): MBData {
    const props: MBProp[] = [];
    // El expediente no vive en MBProp (el panel solo lo consume agregado), así que se guarda
    // aparte por propiedad. Calcularlo como porcentaje del total no cuadraba con la suma de
    // venta + renta; contándolo por propiedad, todo cierra.
    const exp: { doc: boolean; contrato: boolean; prop: boolean }[] = [];
    const total = N_VENTA + N_RENTA;

    for (let i = 0; i < total; i++) {
        const esVenta = i < N_VENTA;
        const [colonia, demandaZona, ppmRef] = ZONAS[i % ZONAS.length];
        const type = esVenta ? pick(TIPOS) : pick(TIPOS.slice(0, 3));
        const surf = ent(60, 320);

        // Precio: alrededor de la referencia de la zona, con una cola de propiedades caras
        // (para que "vs. oferta" tenga casos a los dos lados, que es lo que hay que enseñar).
        const desvio = r() < 0.22 ? 0.20 + r() * 0.45 : -0.18 + r() * 0.30;
        const precio = esVenta
            ? Math.round((ppmRef * surf * (1 + desvio)) / 10000) * 10000
            : Math.round((ppmRef * surf * 0.0042 * (1 + desvio)) / 500) * 500;
        const vsOferta = Math.round(desvio * 100);
        // Solo 2 de cada 3 tienen referencia de cierres: es exactamente el punto que se explica
        // en la lámina 11 (hacen falta 3 ventas cerradas comparables).
        const vsCierres = r() < 0.66 ? Math.round((desvio + 0.06 + (r() - 0.5) * 0.12) * 100) : null;

        // Calidad: 19/63/18 como la red, y el video es lo que la separa.
        const q = r();
        const calidad = q < 0.19 ? 'Alta' : q < 0.82 ? 'Media' : 'Baja';
        const video = calidad === 'Alta' ? true : r() < 0.32;
        const fotos = calidad === 'Baja' ? ent(3, 8) : ent(9, 26);
        const tour = r() < 0.06;
        const amenidades = r() < 0.29 ? 0 : ent(3, 11);

        const dias = ent(12, 640);
        // Embudo: la demanda de la zona y el precio mandan sobre las vistas y los leads.
        const castigoPrecio = vsOferta > 25 ? 0.35 : vsOferta > 12 ? 0.7 : 1;
        const vistas = Math.round((demandaZona / 8) * (0.5 + r()) * castigoPrecio);
        let leads = Math.round(vistas * (0.02 + r() * 0.05) * castigoPrecio);
        // Unas cuantas con MUCHAS vistas y CERO leads: es el caso que se busca en vivo
        // (lámina 16) porque enseña de un golpe que la ven y no la contactan.
        if (i % 23 === 0) leads = 0;
        const respondidos = Math.max(0, leads - (r() < 0.25 ? ent(0, 2) : 0));
        const visitas = Math.round(leads * (0.10 + r() * 0.16));
        const ofertas = r() < 0.12 ? ent(1, 2) : 0;
        const cierres = 0;

        const asesor = ASESORES[i % ASESORES.length];
        // Dos asesores lentos a propósito: sin contraste no hay nada que mostrar en el equipo.
        const lento = asesor === 'Joaquín Berriozábal' || asesor === 'Camila Tagle';
        const respMedMin = leads === 0 ? null
            : lento ? ent(600, 5200) : r() < 0.55 ? ent(1, 25) : ent(30, 400);

        const errores: string[] = [];
        let sugerencia: string | null = null;
        if (!esVenta && i % 31 === 0) {
            errores.push('Renta capturada por m²');
            sugerencia = `${(precio * surf).toLocaleString('es-MX')}/mes (× ${surf} m²)`;
        }
        if (i % 47 === 0) errores.push('Superficie imposible');

        const diag: string[] = [];
        if (esVenta && vsOferta > 15) diag.push('Bajar precio');
        if (calidad !== 'Alta') diag.push('Mejorar ficha');

        // Renta llega peor que venta al expediente: 87% vs 74% sin documento en la red real.
        exp.push({
            doc: r() < (esVenta ? 0.74 : 0.87),
            contrato: r() < (esVenta ? 0.79 : 0.91),
            prop: r() < 0.05,
        });
        props.push({
            id: `demo-${i}`, code: codigo(i), type, op: esVenta ? 'Venta' : 'Renta',
            colonia, calle: pick(CALLES), asesor, precio,
            estado: vsOferta > 15 ? 'Caro' : vsOferta < -15 ? 'Barato' : 'En precio',
            demanda: demandaZona, vsOferta, vsCierres,
            compite: esVenta ? ent(2, 48) : null,
            calidad, dias, mesesPub: dias / 30,
            vistas, leads, respondidos, visitas, ofertas, cierres, respMedMin,
            oppScore: demandaZona / (1 + leads), diag, tier: 'SIMPLE',
            fotos, video, tour, amenidades, errores, sugerencia,
        });
    }

    // ---- agregados, contados desde las propiedades para que nada se contradiga -------------
    const V = props.filter((p) => p.op === 'Venta'), R = props.filter((p) => p.op === 'Renta');
    const cal = (xs: MBProp[]): PorOpCal => ({
        alta: xs.filter((p) => p.calidad === 'Alta').length,
        media: xs.filter((p) => p.calidad === 'Media').length,
        baja: xs.filter((p) => p.calidad === 'Baja').length, total: xs.length,
    });
    const fal = (idx: number[]): PorOpFalta => {
        const xs = idx.map((i) => props[i]);
        return {
            video: xs.filter((p) => !p.video).length,
            fotos: xs.filter((p) => p.fotos < 8).length,
            amenidades: xs.filter((p) => !p.amenidades).length,
            tour: xs.filter((p) => !p.tour).length,
            acm: idx.filter((i) => i % 4 === 0).length,
            doc: idx.filter((i) => exp[i].doc).length,
            contrato: idx.filter((i) => exp[i].contrato).length,
            propietario: idx.filter((i) => exp[i].prop).length,
            total: xs.length,
        };
    };
    const iTodas = props.map((_, i) => i);
    const iVenta = iTodas.filter((i) => props[i].op === 'Venta');
    const iRenta = iTodas.filter((i) => props[i].op === 'Renta');

    const bucket = (m: number | null): RespKey =>
        m == null ? 'sin' : m <= 5 ? 'flash' : m <= 60 ? 'rapida' : m <= 1440 ? 'media' : 'lento';
    const cuenta = (xs: MBProp[]): Record<RespKey, number> => {
        const o: Record<RespKey, number> = { flash: 0, rapida: 0, media: 0, lento: 0, sin: 0 };
        xs.forEach((p) => { for (let k = 0; k < p.leads; k++) o[bucket(p.respMedMin)]++; });
        return o;
    };
    const sum = (xs: MBProp[], f: (p: MBProp) => number) => xs.reduce((a, p) => a + f(p), 0);
    const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

    const zonas: MBZona[] = ZONAS.map(([nb, dem]) => {
        const xs = props.filter((p) => p.colonia === nb);
        const vs = xs.map((p) => p.vsOferta).filter((x): x is number => x != null);
        const vc = xs.map((p) => p.vsCierres).filter((x): x is number => x != null);
        return {
            nb, n: xs.length, leads: sum(xs, (p) => p.leads), demanda: dem,
            oferta: ent(120, 3400), vsOferta: mediana(vs), vsCierres: mediana(vc),
        };
    }).sort((a, b) => b.n - a.n);

    const asesores: MBAsesor[] = ASESORES.map((name) => {
        const xs = props.filter((p) => p.asesor === name);
        const leads = sum(xs, (p) => p.leads);
        const rm = mediana(xs.map((p) => p.respMedMin).filter((x): x is number => x != null));
        const visitas = sum(xs, (p) => p.visitas);
        const fueraSla = xs.filter((p) => (p.respMedMin ?? 0) > 1440).length;
        const green: string[] = [], red: string[] = [];
        if (rm != null && rm <= 60) green.push('responde en minutos y no abandona');
        if (leads && visitas / leads > 0.2) green.push(`${Math.round((visitas / leads) * 100)}% de sus leads llega a visita`);
        if (rm != null && rm > 1440) red.push(`${Math.round((fueraSla / Math.max(xs.length, 1)) * 100)}% de sus leads fuera de 24 h`);
        if (leads && visitas / leads < 0.12) red.push(`solo ${Math.round((visitas / leads) * 100)}% de sus leads llega a visita`);
        return {
            name, leads, respondidos: sum(xs, (p) => p.respondidos), fueraSla, respMedMin: rm,
            visitas, cierres: ent(0, 4), comision: 0, busquedas: ent(4, 40),
            clientes: ent(3, 28), propsCompartidas: 1 + r() * 4, green, red,
        };
    }).sort((a, b) => b.leads - a.leads);

    const conError = props.filter((p) => p.errores.length);
    const errTipos = [...new Set(conError.flatMap((p) => p.errores))].map((tipo) => ({
        tipo, n: conError.filter((p) => p.errores.includes(tipo)).length,
        nota: tipo === 'Renta capturada por m²'
            ? 'el monto parece el precio POR M² al mes, no la renta total'
            : 'los m² capturados no corresponden al tipo de propiedad',
        ejemplo: conError.find((p) => p.errores.includes(tipo))?.sugerencia ?? null,
    }));

    const leadsTot = sum(props, (p) => p.leads);
    const respAll = cuenta(props);

    return {
        companyId: 'demo', name: 'Inmobiliaria Demo',
        nProps: total, nVenta: V.length, nRenta: R.length,
        captaciones90: props.filter((p) => (p.dias ?? 999) <= 90).length,
        vistas: sum(props, (p) => p.vistas), leads: leadsTot,
        respondidos: sum(props, (p) => p.respondidos), visitas: sum(props, (p) => p.visitas),
        ofertas: sum(props, (p) => p.ofertas), cierres: 0,
        sinLeads: props.filter((p) => !p.leads).length,
        leads30: Math.round(leadsTot * 0.17), leads30prev: Math.round(leadsTot * 0.14),
        leads30V: Math.round(leadsTot * 0.13), leads30R: Math.round(leadsTot * 0.04),
        leads30prevV: Math.round(leadsTot * 0.11), leads30prevR: Math.round(leadsTot * 0.03),
        resp: respAll, respV: cuenta(V), respR: cuenta(R),
        respMedMin: mediana(props.map((p) => p.respMedMin).filter((x): x is number => x != null)),
        calAltaPct: Math.round((cal(props).alta / total) * 100),
        calAltaVenta: cal(V).alta, calAltaRenta: cal(R).alta,
        benchAltaPct: 49,                                   // benchmark real de la comunidad
        calidad: cal(props), calidadVenta: cal(V), calidadRenta: cal(R),
        falta: fal(iTodas), faltaVenta: fal(iVenta), faltaRenta: fal(iRenta),
        errores: errTipos, nErrores: conError.length,
        zonas, demandaLabel: 'últimos 3 meses', asesores, props,
    };
}
