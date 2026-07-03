// Acceso: cualquier cuenta @pulppo.com entra. ALLOWED_EMAILS (coma-separado) permite
// sumar emails puntuales de otros dominios si algún día hace falta.
const ALLOWED_DOMAIN = '@pulppo.com';

export function extraEmails(): string[] {
    return (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

export function isAllowed(email?: string | null): boolean {
    const mail = (email || '').trim().toLowerCase();
    if (!mail) return false;
    return mail.endsWith(ALLOWED_DOMAIN) || extraEmails().includes(mail);
}
