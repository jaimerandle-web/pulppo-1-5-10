// Pestaña Datos: la base completa de la inmobiliaria para descargar (JSON y Excel) y para que la
// lea un agente de IA con una URL con clave.
//
// PILOTO: sólo Diamond House. El corte se usa en TRES lados: el menú del panel (MBApp), la API
// (`/api/mb-datos`) y el middleware (la URL con clave entra sin sesión). Abrirla a otra cuenta es
// agregar su companyId acá.
//
// 🔒 Leads y asesores externos traen teléfonos y correos de clientes y brokers. La URL con clave
// es HMAC de la company con AUTH_SECRET: no se adivina, y para revocarla basta con cambiar el
// prefijo de versión (`v1`) o el secreto.
const enc = new TextEncoder();

export const CON_DATOS = new Set([
    '62bf49012367c77fc24d9220',   // Diamond House
]);

export function tieneDatos(companyId?: string | null): boolean {
    return !!companyId && CON_DATOS.has(companyId);
}

export async function datosToken(companyId: string): Promise<string> {
    const secret = process.env.AUTH_SECRET || process.env.FICHA_SECRET || 'pulppo-1-5-10-auth';
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode('datos:v1:' + companyId));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** ¿La petición trae la clave válida de esa company? Edge-safe (lo usa el middleware). */
export async function tokenValido(companyId: string, token?: string | null): Promise<boolean> {
    if (!tieneDatos(companyId) || !token) return false;
    return token === (await datosToken(companyId));
}
