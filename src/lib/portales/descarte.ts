// Taxonomía ÚNICA del descarte (`searches.status.reasonToFinish` + `status.description`), compartida por
// «Calidad del lead» (calidad.ts) y «Leads, funnel y cierres» (inmobiliaria.ts): antes cada una tenía
// su lista y las dos dejaban fuera los descartes sin motivo y contaban las búsquedas GANADAS como
// «perdido». Cualquier cambio de reglas va aquí y cambia las dos pestañas a la vez.

// Los mismos motivos y etiquetas que usa el pulso, para que no haya dos vocabularios.
export const RLBL: Record<string, string> = {
    descartado: 'Descartado (genérico)', asesor: 'Cliente era asesor/broker',
    fantasma: 'Fantasma / no contesta', perdido: 'Perdido', incontactable: 'Incontactable',
    inesperado: 'Inesperado', sent_to_ai: 'Enviado a IA', stop_answering: 'Dejó de responder',
    lost_interest: 'Perdió interés', operaton_with_other_broker: 'Cerró con otro broker',
};

// ── motivos de descarte (`searches.status.reasonToFinish`) ─────────
// Valores reales medidos 1-oct-2026 sobre 12 meses (391k cancelaciones): descartado 30% · asesor 26%
// · fantasma 13% · perdido 13% · SIN MOTIVO 8% · incontactable 5% · cancelado 4% · inesperado 1% ·
// Agent inactive / automatico (sistema) <1% · y restos con grafías distintas del mismo motivo.
// 'fantasma' aquí es lo que MARCÓ EL ASESOR — distinto del lead fantasma técnico (sin conversación).
const MOTIVO_LBL: Record<string, string> = {
    '': 'Sin motivo', cancelado: 'Cancelado (sin detalle)', Perdido: 'Perdido', lost: 'Perdido',
    'Agent inactive': 'Asesor inactivo', automatico: 'Cancelado automático', 'Cancelado de forma automática': 'Cancelado automático',
};
export const NO_ES_DESCARTE = new Set(['success', 'Ganada', 'still_interested', 'test']);
export type FamDesc = 'noResponde' | 'incontactable' | 'broker' | 'perdido' | 'noCalifica' | 'otro' | 'generico' | 'sistema';
const FAM_DESC: Record<string, FamDesc> = {
    fantasma: 'noResponde', stop_answering: 'noResponde', sent_to_ai: 'noResponde',
    incontactable: 'incontactable',
    asesor: 'broker',
    perdido: 'perdido', Perdido: 'perdido', lost: 'perdido', lost_interest: 'perdido', inesperado: 'perdido', operaton_with_other_broker: 'perdido',
    descartado: 'generico', cancelado: 'generico', '': 'generico',
    'Agent inactive': 'sistema', automatico: 'sistema', 'Cancelado de forma automática': 'sistema',
};
export const FAM_ORDEN: FamDesc[] = ['noResponde', 'incontactable', 'broker', 'perdido', 'noCalifica', 'otro', 'generico', 'sistema'];
export const FAM_LBL: Record<FamDesc, string> = {
    noResponde: 'No responde / fantasma (según el asesor)', incontactable: 'Incontactable / datos falsos', broker: 'Era asesor/broker',
    perdido: 'Perdido / ya no busca', noCalifica: 'No califica (presupuesto, requisitos, zona)', otro: 'Otro (duplicado, era el dueño)',
    generico: 'Sin motivo específico', sistema: 'Cerrado por el sistema',
};

// El «descartado» genérico es 30% de todo el descarte, pero el asesor casi siempre escribe la razón en
// `status.description` (95% trae texto). Se clasifica por palabras clave. Medido 1-oct-2026 sobre 30k
// descartes genéricos (abr–sep): separa ~68% tras revisar muestras a mano; el resto queda como «Descartado · otro / sin detalle».
// Orden = prioridad (gana la primera que coincide). Patrones SIN acentos: el texto se normaliza.
const DESC_TXT: Array<{ k: string; lbl: string; fam: FamDesc; rx: RegExp }> = [
    // Revisadas a mano sobre muestras (2-oct-2026). Ojo con «inmobiliaria» suelto: «ya compró con otra
    // inmobiliaria» NO es un broker, por eso «Era broker» exige «es (un/una) asesor/agente/…».
    { k: 'datos', lbl: 'Número o datos falsos', fam: 'incontactable', rx: /no existe|no exite|falso|fake|equivocad|numero (incorrecto|erroneo|mal|invalido)|es invalido|no es (el|su) numero|spam|extorsion|fraude|\bbot\b|sin numero|numero invalido|no le llegan|(telefono|numero) (registrado )?no funciona|no funciona (el|su) (telefono|numero)/ },
    { k: 'broker', lbl: 'Era broker (según el comentario)', fam: 'broker', rx: /\bbroker|\bes (un |una )?(asesor|asesora|agente|colega|inmobiliaria)\b|\b(asesor|asesora|agente)s? inmobiliari|\bes de (una|otra) inmobiliaria/ },
    { k: 'noresp', lbl: 'No responde (según el comentario)', fam: 'noResponde', rx: /no contesta|no responde|fantasma|(no|nunca|jamas) (me )?(respondio|contesto|regreso)|sin respuesta|dejo de (contestar|responder)|no hubo respuesta|ghost|no ha (contestado|respondido)|no volvio a (contestar|responder)/ },
    { k: 'nodisp', lbl: 'La propiedad ya no estaba disponible', fam: 'noCalifica', rx: /ya se (rento|vendio)|no (esta|se encuentra) disponible|ya no (esta|se encuentra)|rentada|vendida|apartad|ya fue aprobad|ya esta (rentad|vendid)/ },
    { k: 'requisitos', lbl: 'No cumple requisitos (mascota, plazo, aval…)', fam: 'noCalifica', rx: /mascota|perro|gato|aval|fiador|poliza|investigacion|credito|infonavit|fovissste|bancari|corto plazo|temporal|requisit|deposito|ingresos|no califica|historial|\d+ meses|extranjer/ },
    { k: 'presupuesto', lbl: 'Presupuesto', fam: 'noCalifica', rx: /presupuesto|caro|precio|economic|barat|no le alcanza|fuera de (su )?rango|monto/ },
    { k: 'yanobusca', lbl: 'Ya compró / rentó o ya no busca', fam: 'perdido', rx: /ya (rento|compro|encontro|consiguio|no busca|no le interesa|decidio)|no le interes|ya no (quiere|busca|le interesa|quiso)|cambio de opinion|desist|pospon|por el momento no|mas adelante|solo (estaba )?viendo|curiosidad|otra (opcion|inmobiliaria|propiedad)|no continu/ },
    { k: 'zona', lbl: 'Zona o características', fam: 'noCalifica', rx: /zona|ubicacion|lejos|elevador|estacionamiento|recamaras|tamano|metros|amueblad|\bpiso\b|vista|no es lo que (busca|necesita)|no (le )?gusto/ },
    { k: 'duplicado', lbl: 'Duplicado / ya lo atiende alguien', fam: 'otro', rx: /duplicad|repetid|mismo cliente|ya se le esta atendiendo|ya lo atiende|ya esta en seguimiento/ },
    { k: 'propietario', lbl: 'Era el propietario', fam: 'otro', rx: /propietari|duen/ },
];
const sinAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Clave del motivo: el crudo, o `descartado:<sub>` si es genérico y el comentario dice por qué. */
export function motivoDe(crudo: string, descripcion: unknown): string {
    if (FAM_DESC[crudo] !== 'generico') return crudo;
    const t = sinAcento(String(descripcion ?? '')).trim();
    if (t.length < 3) return crudo;
    const hit = DESC_TXT.find((x) => x.rx.test(t));
    return hit ? `descartado:${hit.k}` : crudo;
}
export const familiaDe = (m: string): FamDesc =>
    m.startsWith('descartado:') ? DESC_TXT.find((x) => `descartado:${x.k}` === m)?.fam ?? 'generico' : FAM_DESC[m] ?? 'perdido';
export const etiquetaMotivo = (m: string): string => {
    if (m.startsWith('descartado:')) return `Descartado · ${DESC_TXT.find((x) => `descartado:${x.k}` === m)?.lbl ?? 'otro'}`;
    if (m === 'descartado') return 'Descartado · otro / sin detalle';
    return MOTIVO_LBL[m] ?? RLBL[m] ?? (m ? m.replace(/_/g, ' ') : 'Sin motivo');
};
