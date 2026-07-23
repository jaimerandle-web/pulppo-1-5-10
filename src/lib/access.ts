// Allowlist de emails con acceso. Fuente: env ALLOWED_EMAILS (coma-separado) si está
// seteada; si no, la lista de abajo.
const FALLBACK_EMAILS: string[] = [
    'jaime.randle@pulppo.com',
    'alejandra@pulppo.com',
    'ezequiel@pulppo.com',
    'matias@pulppo.com',
    'agustin@pulppo.com',
    'karen@pulppo.com',
    'laura@pulppo.com',
    'sofia.cedillov@pulppo.com',
    'ulises.chavez@pulppo.com',
    'alonso@pulppo.com',
    'luis@pulppo.com',
    'leonardoherrera@tuhabi.mx' // externo (Habi)
];

export function allowedEmails(): string[] {
    const fromEnv = (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return fromEnv.length ? fromEnv : FALLBACK_EMAILS;
}

export function isAllowed(email?: string | null): boolean {
    const mail = (email || '').trim().toLowerCase();
    return !!mail && allowedEmails().includes(mail);
}
