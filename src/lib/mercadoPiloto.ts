// Quién ve la pestaña Mercado (cierres reales de la red).
//
// PILOTO: arranca sólo en Diamond House. Los datos son los mismos para todas las cuentas
// —cierres de toda la red, anonimizados—, así que abrirla a más inmobiliarias es agregar su
// companyId acá. El corte se usa en DOS lados: el menú del panel (MBApp) y la API
// (`/api/mb-mercado`), para que esconder el botón no sea la única barrera.

export const CON_MERCADO = new Set([
    '62bf49012367c77fc24d9220',   // Diamond House
]);

export function tieneMercado(companyId?: string | null): boolean {
    return !!companyId && CON_MERCADO.has(companyId);
}
