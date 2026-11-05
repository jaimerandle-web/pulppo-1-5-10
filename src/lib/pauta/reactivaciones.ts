// Campañas que ya corrieron, se apagaron por resultados y se vuelven a prender con cambios. Lista
// manual (como excluidas.ts): cada una lleva el brief completo para que Habi la monte sin
// adivinar. La propiedad sale de estrellas/carruseles mientras esté aquí, para no pagar dos veces
// el mismo público.
//
// Los resultados anteriores vienen del cruce Meta (ads_read) vs CRM (leads con
// campaign = código, visitas con lead previo) hecho a mano; no se recalculan en vivo.
export interface Cambio {
    tema: string;
    antes: string;
    despues: string;
}

export interface Reactivacion {
    code: string;
    desde: string;           // AAAA-MM-DD en que se decidió
    presupuesto: number;     // por vuelo de 14 días
    anterior: { nombre: string; id: string; periodo: string; resultado: string };
    condiciones: string[];   // sin esto no se prende
    cambios: Cambio[];
    formulario: string[];    // preguntas del formulario de mayor intención
    textos: string[];
    titulo: string;
    anuncios: string;
    medicion: string[];
    reglaApagado: string;
}

export const REACTIVACIONES: Reactivacion[] = [
    {
        code: 'DLI-815',
        desde: '2026-11-05',
        presupuesto: 750,
        anterior: {
            nombre: 'B2C_DLI-815_mx_exc_BosqueTabachines327',
            id: '120250477579640750',
            periodo: '26-jun al 22-oct-2026',
            resultado: '$12,950 → 45 "leads" en Meta (clic a WhatsApp) = 40 personas en el CRM → 3 visitas, 0 ofertas. $4,317 por visita. ' +
                'Los otros canales (i24, EasyBroker, brokers, correo) trajeron 3 visitas más sin pauta.'
        },
        condiciones: [
            'Diamond House renovó la exclusiva (vence alrededor del 27-nov).',
            'Diamond House revisó el precio: 5 meses publicada sin cambio, 6 visitas y 0 ofertas.',
            'El formulario instantáneo llega al CRM con las respuestas (probar con un lead de prueba antes de prender).'
        ],
        cambios: [
            { tema: 'Campaña', antes: 'La vieja (pausada)', despues: 'Campaña NUEVA: cambia el objetivo, no reactivar la vieja. Copiar de ahí los anuncios V2 y Highlights.' },
            { tema: 'Objetivo', antes: 'Clientes potenciales · conversión en el sitio (clic a WhatsApp)', despues: 'Clientes potenciales · formulario instantáneo de MAYOR INTENCIÓN (con pantalla de revisión)' },
            { tema: 'Ubicación', antes: '20 km alrededor de Parque Interlomas', despues: '6 km alrededor de la propiedad (19.38019, -99.26065): Bosques, Lomas, Interlomas y Santa Fe' },
            { tema: 'Edad', antes: '25–65', despues: '35–65' },
            { tema: 'Público', antes: 'Advantage+ abierto, sin intereses', despues: 'Advantage+ solo como sugerencia; intereses: Viajes de lujo, Bienes raíces de lujo, Golf, Inversión' },
            { tema: 'Exclusiones', antes: 'Ninguna', despues: 'Excluir a las 40 personas que ya escribieron (lista de teléfonos del CRM, la pasa Ale)' },
            { tema: 'Remarketing', antes: 'No', despues: 'Segundo conjunto: vieron 50%+ del video V2 o entraron a la ficha en 90 días' },
            { tema: 'Anuncios', antes: '9 anuncios', despues: '2: V2 y Highlights' },
            { tema: 'Copy', antes: 'Aspiracional ("Vive en una de las zonas más exclusivas…")', despues: 'Precio y m² en la primera línea (textos abajo)' },
            { tema: 'Botón', antes: 'Ver más', despues: 'Más información' },
            { tema: 'Presupuesto', antes: '$50 al día (~$3,100 al mes)', despues: '$750 por 14 días (~$1,500 al mes), 70% público nuevo y 30% remarketing' }
        ],
        formulario: [
            '¿Cuándo planeas comprar? (Este mes · 1 a 3 meses · 3 a 6 meses · Solo estoy viendo)',
            '¿Cómo pagarías? (Recursos propios · Crédito hipotecario · Venta de otra propiedad)',
            '¿Quieres agendar una visita? (Sí · Primero quiero más información)'
        ],
        titulo: 'Depto de 443 m² en Bosques de las Lomas',
        textos: [
            '$24,000,000 · 443 m² · Bosques de las Lomas. Departamento de 3 recámaras, 3.5 baños y 5 estacionamientos, con alberca, gimnasio y asador. Déjanos tus datos y el asesor te agenda la visita.',
            'En venta en Bosques de las Lomas: 443 m² por $24,000,000. 3 recámaras, 3.5 baños, 5 lugares de estacionamiento y amenidades completas. Visitas solo con cita.',
            'Departamento de $24M en Bosques de las Lomas, Cuajimalpa. 443 m² construidos y 5 estacionamientos. Exclusiva Pulppo con Diamond House: un solo asesor con toda la información.'
        ],
        anuncios: 'V2 y Highlights, copiados de la campaña anterior (cortes también en Drive: ver el paquete de la propiedad).',
        medicion: [
            'Liga de la ficha (pantalla final del formulario y remarketing) con utm_content={{ad.id}} para saber qué anuncio trae visitas.',
            'Los DMs de IG/Messenger NO llegan al CRM: quien los conteste los registra como lead de DLI-815.',
            'Diamond House confirma que cada lead del formulario se contactó en menos de 1 hora.'
        ],
        reglaApagado: 'Si al gastar $1,500 (un mes) no hay ninguna visita agendada, se apaga. Meta: $1,500 o menos por visita (antes $4,317).'
    }
];

export const reactivacionDe = (code: string) => REACTIVACIONES.find((r) => r.code === code) ?? null;
