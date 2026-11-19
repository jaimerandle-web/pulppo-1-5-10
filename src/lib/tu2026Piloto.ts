// Quién ve la pestaña «Tu 2026» de /mb (cierre de año para la Master Experience del 3-dic-2026).
//
// Se arma SÓLO con Diamond House y SIN que la inmobiliaria la vea: hasta el evento la ve únicamente el
// equipo interno. El 3-dic se prende `ABIERTA` (la ven también los masters) y se agregan las demás
// inmobiliarias a la lista. El corte se usa en DOS lados: el menú (MBApp) y la API (`/api/mb-tu2026`),
// para que esconder el botón no sea la única barrera.

export const CON_TU2026 = new Set([
    '62bf49012367c77fc24d9220',   // Diamond House
]);

/** false = sólo internos (antes del evento) */
export const ABIERTA = false;

export function verTu2026(companyId: string | null | undefined, interno: boolean): boolean {
    return !!companyId && CON_TU2026.has(companyId) && (interno || ABIERTA);
}
