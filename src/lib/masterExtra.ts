// Accesos de master broker concedidos DESDE LA APP, para gente que en Pulppo todavía figura
// como asesor.
//
// **Por qué existe.** Mongo es de sólo lectura para esta herramienta: no podemos cambiarle el
// `type` a nadie. Cuando alguien necesita el panel de su inmobiliaria y en la base sigue como
// `associate`, la única salida sin bloquear a la persona es concederlo acá.
//
// 🔴 **Esto es una excepción, no el camino.** Es una segunda fuente de verdad y va a
// desincronizarse: si mañana esa persona cambia de inmobiliaria en Pulppo, este archivo sigue
// apuntando a la vieja. Lo correcto es que alguien con escritura la marque `type: 'master'` en
// Pulppo y que su nombre salga de acá. Mientras eso pasa, esto la desbloquea.
//
// **Qué implica conceder esto.** El panel `/mb` es de la CASA, no de la persona: quien entra ve
// el inventario completo, el desempeño de todos los asesores y los leads de la cuenta. No es un
// permiso de "ver lo mío" — es visibilidad de toda la inmobiliaria.
//
// Mongo manda: si la persona SÍ es master en la base, esa company gana y esta lista se ignora.
// `MASTER_EXTRA` (env) permite agregar sin desplegar: "correo:companyId,correo:companyId".

/** correo (en minúsculas) → `companies._id` que puede administrar. */
const FIJOS: Record<string, string> = {
    // The Property Hub — pedido por Ale el 22-sep-2026. Los cuatro están activos en esa
    // inmobiliaria pero como `associate`. Ojo: la cuenta está PARTIDA en dos compañías con el
    // mismo nombre; ésta es la que tiene el equipo (17 asesores, 25 publicadas), la otra
    // (697bf8f3970aa749c3aecc33) tiene 9 asesores y 3 publicadas.
    'agustin.herencia@pulppo.com': '6a7cfe0f55d783c636b3c303',
    'erik.lugo@pulppo.com': '6a7cfe0f55d783c636b3c303',
    'jeorgina.tavira@pulppo.com': '6a7cfe0f55d783c636b3c303',
    'joel.sanchez@pulppo.com': '6a7cfe0f55d783c636b3c303',
};

function delEntorno(): Record<string, string> {
    const crudo = (process.env.MASTER_EXTRA || '').trim();
    if (!crudo) return {};
    const out: Record<string, string> = {};
    for (const par of crudo.split(',')) {
        const [mail, comp] = par.split(':').map((x) => (x || '').trim());
        if (mail && /^[a-f0-9]{24}$/i.test(comp || '')) out[mail.toLowerCase()] = comp;
    }
    return out;
}

/** La inmobiliaria concedida a este correo, o null. */
export function masterExtra(email?: string | null): string | null {
    const mail = (email || '').trim().toLowerCase();
    if (!mail) return null;
    return delEntorno()[mail] ?? FIJOS[mail] ?? null;
}
