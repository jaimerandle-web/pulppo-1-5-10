// Quién ve la pestaña «Tu 2026» de /mb (cierre de año para la Master Experience del 3-dic-2026).
//
// - Equipo interno: TODAS las inmobiliarias desde ya (las KAMs preparan sus 1:1 antes del evento).
// - Masters: se abre SOLA el 3-dic-2026 a las 00:00 hora de México, para todas a la vez (Ale, 25-nov).
//   Se evalúa en cada llamada (no al cargar el módulo): una instancia de Vercel que arrancó antes del 3-dic
//   también la abre a tiempo.
// El corte se usa en DOS lados: el menú (MBApp) y la API (`/api/mb-tu2026`), para que esconder el botón no
// sea la única barrera. La demo no la tiene.

/** 3-dic-2026 00:00 en Ciudad de México (UTC−6, sin horario de verano) */
export const ABRE_TU2026 = Date.parse('2026-12-03T00:00:00-06:00');

/** false = sólo internos (antes del evento) */
export function tu2026Abierta(ahora = Date.now()): boolean {
    return ahora >= ABRE_TU2026;
}

export function verTu2026(companyId: string | null | undefined, interno: boolean): boolean {
    if (!companyId || companyId === 'demo') return false;
    return interno || tu2026Abierta();
}
