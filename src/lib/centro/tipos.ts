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
    | 'inmobiliarias'
    | 'brokers-externos'
    | 'propietarios-renta'
    | 'propietarios'
    | 'inquilinos'
    | 'compradores'
    | 'pulppers';

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
 * Las tres formas de gestionar el contacto. No son un detalle de canal:
 * cambian quién aparece como remitente y cuánto podemos medir.
 */
export type ViaId = 'pulppo' | 'asesor' | 'reenvio';

export const VIAS: { id: ViaId; label: string; hint: string }[] = [
    { id: 'pulppo', label: 'Le escribe Pulppo', hint: 'Nuestro número. Medimos todo.' },
    { id: 'asesor', label: 'Desde el WhatsApp del asesor', hint: 'Mejor respuesta, no vemos la conversación.' },
    { id: 'reenvio', label: 'Se lo pasamos al asesor', hint: 'Él reenvía. No sabemos si lo mandó.' }
];

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

export type PermisoEstado = 'sin-preguntar' | 'pedido' | 'si' | 'no';

export interface Permiso {
    /** Quién autoriza: el asesor (agents._id). */
    asesorId: string;
    tema: TemaId;
    estado: PermisoEstado;
    /** Vía que el asesor prefiere para sus clientes. */
    via: ViaId | null;
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
