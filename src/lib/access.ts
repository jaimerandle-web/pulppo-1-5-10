// Allowlist de emails con acceso. Fuente: env ALLOWED_EMAILS (coma-separado) si está
// seteada; si no, la lista de abajo. Si ambas están vacías → no restringe (evita lockout).
const FALLBACK_EMAILS: string[] = [
    'claudio@pulppo.com',
    'alejandra@pulppo.com',
    'jaime.randle@pulppo.com',
    'karen@pulppo.com',
    'laura@pulppo.com',
    'sofia.cedillov@pulppo.com',
    'ulises.chavez@pulppo.com'
];

export function allowedEmails(): string[] {
    const fromEnv = (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : FALLBACK_EMAILS.map((e) => e.trim().toLowerCase());
}

export function isAllowed(email?: string | null): boolean {
    const list = allowedEmails();
    if (!list.length) return true; // sin lista configurada → no restringe
    return !!email && list.includes(email.trim().toLowerCase());
}
