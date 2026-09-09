/* ------------------------------------------------------------------ *
 * Centro de Marketing — tipos compartidos.
 *
 * Vocabulario (vale la pena fijarlo porque todo el módulo lo usa):
 *  · BASE      quién. Una consulta a Mongo, no una lista pegada a mano.
 *  · TEMA      de qué le hablamos (garantía de renta, crédito, exclusiva…).
 *              El permiso se da POR TEMA, no global: un asesor puede
 *              autorizar crédito y no garantías.
 *  · MENSAJE   la definición: base + tema + disparador + plantilla + vía.
 *  · ENVÍO     la fila real (mensaje × persona × fecha). El calendario es
 *              esta tabla dibujada; el techo de frecuencia es una regla
 *              sobre esta tabla.
 * ------------------------------------------------------------------ */

/** Las bases de datos del centro. El id viaja en la URL. */
export type BaseId =
    | 'brokers'
    | 'brokers-inactivos'
    | 'inmobiliarias'
    | 'brokers-externos'
    | 'propietarios-renta'
    | 'propietarios'
    | 'inquilinos'
    | 'compradores'
    | 'pulppers';

/* ------------------------- clusters de demanda ------------------------- */

/**
 * Filtros de la base de compradores. Salen de `searches.filters`, que es lo
 * que la persona DIJO que busca (a diferencia del lead, que es lo que hizo).
 */
export interface FiltroDemanda {
    operacion?: 'sale' | 'rent';
    estado?: string;
    colonia?: string;
    tipo?: string;
    /** Índice de banda de presupuesto dentro de BANDAS[operacion]. */
    banda?: number;
}

export interface Banda { label: string; min: number; max: number | null }

/**
 * Bandas de presupuesto, calibradas sobre la distribución real de búsquedas
 * vivas (sep-2026). Las de venta replican las del proyecto de campañas por
 * correo (0-5M, 5-10M, 10-15M, 15-20M) partiendo la primera, que era la más
 * cargada. Las de renta no existían: se cortaron donde la demanda se agrupa.
 */
export const BANDAS: Record<'sale' | 'rent', Banda[]> = {
    sale: [
        { label: 'Hasta $2M', min: 0, max: 2e6 },
        { label: '$2M – $5M', min: 2e6, max: 5e6 },
        { label: '$5M – $10M', min: 5e6, max: 10e6 },
        { label: '$10M – $15M', min: 10e6, max: 15e6 },
        { label: '$15M – $20M', min: 15e6, max: 20e6 },
        { label: '$20M o más', min: 20e6, max: null }
    ],
    rent: [
        { label: 'Hasta $15k', min: 0, max: 15e3 },
        { label: '$15k – $25k', min: 15e3, max: 25e3 },
        { label: '$25k – $40k', min: 25e3, max: 40e3 },
        { label: '$40k – $60k', min: 40e3, max: 60e3 },
        { label: '$60k – $100k', min: 60e3, max: 100e3 },
        { label: '$100k o más', min: 100e3, max: null }
    ]
};

/** Una celda de la parrilla estado × tipo × banda. */
export interface Cluster {
    estado: string;
    tipo: string;
    banda: string;
    bandaIdx: number;
    personas: number;
    /** Las colonias que más pesan dentro del cluster, para saber de qué habla. */
    colonias: { name: string; n: number }[];
}

/** Temas de conversación. El permiso se otorga por tema. */
export type TemaId = 'garantia-renta' | 'credito' | 'exclusiva' | 'workshops' | 'resumen-semanal';

export const TEMAS: { id: TemaId; label: string; color: string }[] = [
    { id: 'garantia-renta', label: 'Garantía de renta', color: '#529999' },
    { id: 'credito', label: 'Crédito hipotecario', color: '#F6BE00' },
    { id: 'exclusiva', label: 'Exclusiva', color: '#212322' },
    { id: 'workshops', label: 'Workshops', color: '#8a8a8a' },
    { id: 'resumen-semanal', label: 'Resumen semanal', color: '#B7B7B7' }
];

/**
 * A quién de su cartera nos deja hablarle. Son dos permisos separados
 * porque son dos relaciones distintas: el propietario le confió una
 * captación, el que busca rentar todavía no le confió nada.
 */
export type Destinatario = 'propietario' | 'cliente';

export const DESTINATARIOS: { id: Destinatario; label: string; hint: string }[] = [
    { id: 'propietario', label: 'Contacto a propietario', hint: 'Dueños de sus rentas captadas' },
    { id: 'cliente', label: 'Contacto a clientes', hint: 'Sus búsquedas activas de renta' }
];

/**
 * La respuesta del asesor. Las tres primeras son lo que él elige; las dos
 * de arriba son estado nuestro (todavía no contestó). Merge deliberado de
 * "¿nos deja?" y "¿desde qué número?": para el asesor es una sola decisión.
 */
export type ViaId = 'sin-preguntar' | 'pedido' | 'pulppo' | 'en-mi-nombre' | 'no';

export const VIAS: { id: ViaId; label: string; hint: string; final: boolean }[] = [
    { id: 'sin-preguntar', label: 'Sin preguntar', hint: 'Todavía no le escribimos', final: false },
    { id: 'pedido', label: 'Le preguntamos', hint: 'Esperando su respuesta', final: false },
    { id: 'pulppo', label: 'Pulppo puede contactarlos', hint: 'Nuestro número. Medimos todo.', final: true },
    { id: 'en-mi-nombre', label: 'Pueden escribir en mi nombre', hint: 'Sale como él. Mejor respuesta, no vemos la conversación.', final: true },
    { id: 'no', label: 'No contactar', hint: 'Cerrado para este tema', final: true }
];

/** Las tres opciones que se le ofrecen al asesor, en orden. */
export const RESPUESTAS = VIAS.filter((v) => v.final);

/** Una persona de cualquier base, ya normalizada. */
export interface Persona {
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    /** Asesor dueño de la relación (si lo hay). Es quien da el permiso. */
    asesorId: string | null;
    asesor: string | null;
    inmobiliaria: string | null;
    /** Columnas extra propias de cada base (# de rentas, código, etc.). */
    extra: Record<string, string | number | null>;
}

export interface BaseResultado {
    id: BaseId;
    label: string;
    total: number;
    personas: Persona[];
    /** Columnas extra a mostrar, en orden. */
    columnas: { key: string; label: string }[];
    /** Advertencias de cobertura de dato, para no leer los números de más. */
    notas: string[];
}

/* --------------------------- estado propio --------------------------- */
/* Mongo es READ-ONLY: permisos y envíos viven en nuestro store. */

export interface Permiso {
    /** Quién autoriza: el asesor (agents._id). */
    asesorId: string;
    tema: TemaId;
    /** A quién de su cartera: propietario o cliente. Son permisos separados. */
    destinatario: Destinatario;
    via: ViaId;
    actualizadoEn: string;
    /** Quién lo fijó: email interno, o 'asesor' si respondió él. */
    actualizadoPor: string;
}

export type EnvioEstado = 'programado' | 'enviado' | 'respondido' | 'cancelado' | 'bloqueado';

export interface Envio {
    id: string;
    mensajeId: string;
    tema: TemaId;
    base: BaseId;
    personaId: string;
    persona: string;
    /** Asesor dueño de la relación, para auditar el permiso. */
    asesorId: string | null;
    via: ViaId;
    /** Fecha programada, ISO. El calendario ordena por esto. */
    fecha: string;
    estado: EnvioEstado;
    /** Por qué se bloqueó (techo de frecuencia, permiso faltante…). */
    motivo?: string;
}

export interface Store {
    permisos: Permiso[];
    envios: Envio[];
}
