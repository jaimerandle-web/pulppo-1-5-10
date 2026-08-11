// Token público por propiedad para compartir la ficha sin login (opción B).
// HMAC-SHA256(id, secret) → un token válido SOLO para su propiedad (no adivinable ni reutilizable).
// Web Crypto: funciona igual en el Edge runtime (middleware) y en Node (server components).
const enc = new TextEncoder();

export async function fichaToken(id: string): Promise<string> {
    const secret = process.env.FICHA_SECRET || 'pulppo-1-5-10-ficha';
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(id)));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// Firma de identidad: HMAC-SHA256(email, secret). Se guarda en la cookie cm-sig y se re-calcula en
// el middleware/servidor para verificar que la cookie cm-user no fue falsificada. Sin esto, cualquiera
// podría setear cm-user=<email de un KAM> y entrar como interno (la cookie no es httpOnly). Web Crypto
// → funciona igual en Edge (middleware) y Node (server components / API).
export async function userToken(email: string): Promise<string> {
    const secret = process.env.AUTH_SECRET || process.env.FICHA_SECRET || 'pulppo-1-5-10-auth';
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode('user:' + String(email).trim().toLowerCase()));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
