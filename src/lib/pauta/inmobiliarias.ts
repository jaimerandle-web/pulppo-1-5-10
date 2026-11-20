// Planes de pauta por inmobiliaria, fuera del programa 1·5·10: inventario normal (no exclusivas)
// al que se le quitó exposición en portales (SD y destacados) para meterle ese dinero en Meta.
// Los monta Pulppo desde su cuenta, igual que 1·5·10. Lista manual como mes.ts: clusters por
// zona (lo pidió el dueño) y copy con lo que él contó de cada zona.
//
// Una tarjeta que todavía no está publicada (p. ej. le falta el recorrido) sale como pendiente y
// entra sola al carrusel en cuanto se publica.
export interface CarruselInmo {
    nombre: string;
    slug: string;            // va en B2C_CAR_<slug>
    codes: string[];         // en el orden de las tarjetas
    presupuesto: number;     // al mes
    perfil: string;          // para Habi: por qué esta zona y a quién le habla
    textos: string[];        // texto principal, 3 variantes
}

export interface PlanInmo {
    slug: string;            // ?inmo=<slug>
    nombre: string;
    inmobiliaria: string;
    periodo: string;
    desde: string;
    revision: string;
    origen: string;          // de dónde sale el dinero
    carruseles: CarruselInmo[];
    fuera: { codes: string[]; motivo: string }[];
}

export const PLANES_INMO: PlanInmo[] = [
    {
        slug: 'ricoy',
        nombre: 'Ricoy · Querétaro',
        inmobiliaria: 'Ricoy Bienes Raíces',
        periodo: 'Noviembre–diciembre 2026',
        desde: '2026-11-20',
        revision: '2026-12-04',
        origen: 'Lo que se dejó de gastar en superdestacados y destacados de Ricoy: su parte de los $10,394 al mes del plan de Querétaro (Ricoy, Finver y Q), por sus tarjetas en los carruseles. En Querétaro la pauta rinde: el dueño vendió CHD-206 con campañas propias ($695 → 13 mil vistas y 27 consultas).',
        carruseles: [
            {
                nombre: 'Puerta Real · casas separadas', slug: 'Ricoy_PuertaReal_qro', presupuesto: 1200,
                codes: ['CVE-585', 'CWY-385', 'CSA-657', 'CRG-584', 'CJV-564'],
                perfil: 'Fraccionamiento Puerta Real, Corregidora. Su diferencial: ninguna casa está pegada a otra. El dueño dice que la zona no tiene tráfico de leads.',
                textos: [
                    'Casas en Puerta Real, Corregidora, de $3.7M a $6M. Ninguna casa está pegada a otra: más privacidad, más luz y nada de ruido del vecino. Condominios con alberca y áreas verdes. Agenda tu visita por WhatsApp.',
                    '¿Buscas casa en Querétaro sin pared compartida? En Puerta Real cada casa está separada de la otra. De 2 a 4 recámaras, de $3.7M a $6M, en una zona céntrica y sin tráfico. Desliza y elige la tuya.',
                    'Casas de una planta y de dos niveles en Puerta Real, Corregidora, con opciones de recámara en planta baja: ideales si alguien en casa no puede subir escaleras. Agenda tu visita por WhatsApp.'
                ]
            },
            {
                nombre: 'Zibatá · vive o invierte', slug: 'Ricoy_Zibata_qro', presupuesto: 800,
                codes: ['DLG-901', 'CUW-824', 'CQA-676'],
                perfil: 'Zibatá, El Marqués. La primera tarjeta es para inversionista: suite de 2 recámaras, cada una con su baño, para rentar por habitación a estudiantes de la Anáhuac. Después, casas.',
                textos: [
                    'Vive o invierte en Zibatá. Desde $2.4M: suite amueblada de 2 recámaras, cada una con su baño, lista para rentar por habitación a estudiantes de la Anáhuac. También casas en condominio. Agenda tu visita por WhatsApp.',
                    'Departamento para inversionista en Zibatá: 2 recámaras con baño propio, amueblado y equipado, pensado para rentar por habitación desde el primer día. $2.4M. Agenda tu visita por WhatsApp.',
                    'Casas y departamentos en Zibatá, El Marqués, desde $2.4M. Desliza, elige el que te late y agenda tu visita por WhatsApp.'
                ]
            },
            {
                nombre: 'Juriquilla · terrenos', slug: 'Ricoy_JuriquillaTerrenos_qro', presupuesto: 700,
                codes: ['TUR-702', 'TLL-291', 'TMS-214', 'TQD-486'],
                perfil: 'Terrenos en el Pueblo de Juriquilla (105 a 131 m²), muy cerca pero fuera de la colonia del campo de golf, y uno de 300 m² frente a reserva ecológica. Según el dueño, no hay terrenos a este precio en Juriquilla.',
                textos: [
                    'Terrenos en el Pueblo de Juriquilla desde $683 mil, de 105 a 131 m², para construir tu casa en la zona de más crecimiento de Querétaro. No vas a encontrar un terreno a este precio en Juriquilla. Agenda tu visita por WhatsApp.',
                    '¿Quieres construir en Juriquilla? Terrenos desde $683 mil en el Pueblo de Juriquilla, y uno de 300 m² frente a reserva ecológica por $1.35M. Desliza y elige el tuyo.',
                    'Invierte en Juriquilla, una de las zonas con más plusvalía de Querétaro: terrenos residenciales desde $683 mil. Agenda tu visita por WhatsApp.'
                ]
            },
            {
                nombre: 'Ciudad Maderas · amenidades', slug: 'Ricoy_CiudadMaderas_qro', presupuesto: 700,
                codes: ['CIE-136', 'CIP-135'],
                perfil: 'Ciudad Maderas, El Marqués. El condominio es el argumento: de las mejores amenidades de Querétaro. Sin terrenos: ahí hay muchísima competencia.',
                textos: [
                    '¿Buscas las mejores amenidades de Querétaro? Casas en Ciudad Maderas, El Marqués, desde $1.99M, en condominio con alberca, gimnasio, cancha de tenis y áreas recreativas. Agenda tu visita por WhatsApp.',
                    'Casa de una planta en Ciudad Maderas por $1.99M, junto a las áreas comunes: comodidad sin escaleras. O de 3 recámaras por $3.04M. Desliza y elige.',
                    'Vive en un condominio con alberca, gimnasio y cancha de tenis. Casas en Ciudad Maderas, El Marqués, de $1.99M a $3.04M. Agenda tu visita por WhatsApp.'
                ]
            }
        ],
        fuera: [
            { codes: ['DEH-453', 'DMF-403'], motivo: 'Juriquilla, Privada de los Portones: la misma propiedad en venta y en renta, sin leads. Segunda tanda, en campaña propia (venta y renta no van en el mismo carrusel).' },
            { codes: ['CBX-158'], motivo: 'Renta en Cerro Prieto (junto a Zibatá): el plan es de venta.' },
            { codes: ['TKA-505', 'TTM-837'], motivo: 'Terrenos en Ciudad Maderas: muchísima competencia (lo dijo el dueño).' },
            { codes: ['DJO-321'], motivo: 'Depto en Puerta Real: ya trae visitas sin pauta y el carrusel es de casas.' },
            { codes: ['CHK-954'], motivo: 'Coyoacán (CDMX), no Querétaro. Último mes de exclusiva: si sigue vigente, se le pueden pasar $700 de Ciudad Maderas para un último empujón (con campañas propias, $1,400 le dieron 3 visitas).' }
        ]
    }
];

export const planInmo = (slug: string | null) => PLANES_INMO.find((p) => p.slug === slug) ?? null;
export const enPlanInmo = (code: string) => PLANES_INMO.find((p) => p.carruseles.some((c) => c.codes.includes(code))) ?? null;
