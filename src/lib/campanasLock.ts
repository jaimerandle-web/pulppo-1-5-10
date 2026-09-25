// Candado del módulo de campañas de correo (/1-5-10/campanas).
//
// Por qué existe: en agosto de 2026 este módulo mandó 412,389 correos (100% del excedente de la factura
// de SendGrid, USD 734.95) y produjo 7 leads. No hay cron ni nada automático — salieron porque alguien
// apretó "Aprobar y programar todo", que agenda hasta 50 envíos de una. Un solo lote puede ser ~100,000
// correos y la pantalla nunca muestra ese número antes de aprobar.
//
// El candado es FAIL-CLOSED a propósito: sin variable de entorno, bloqueado. Para reactivarlo hay que
// poner CAMPANAS_HABILITADAS=1 en Vercel deliberadamente. Si la variable se pierde o alguien clona el
// proyecto, el default es "no manda", que es el lado barato del error.
//
// Qué NO bloquea: las lecturas (estado de envíos, desempeño, audiencia, preview) y el DELETE de
// /api/campanas/approve, que desprograma. Cancelar un envío ya agendado tiene que seguir funcionando.

export function campanasHabilitadas(): boolean {
    return process.env.CAMPANAS_HABILITADAS === '1';
}

export const MOTIVO_BLOQUEO =
    'El módulo de campañas está bloqueado. En agosto mandó 412,389 correos y generó 7 leads ' +
    '(USD 105 por lead), así que se apagó mientras se decide el futuro del programa. ' +
    'Las lecturas y la cancelación de envíos siguen disponibles. ' +
    'Para reactivarlo: CAMPANAS_HABILITADAS=1 en Vercel.';

// Respuesta estándar para los endpoints que crean o mandan. 423 Locked: no es un error del cliente
// ni una falla del servidor, es un recurso deshabilitado a propósito.
export function respuestaBloqueada(): Response {
    return Response.json({ error: MOTIVO_BLOQUEO, bloqueado: true }, { status: 423 });
}
