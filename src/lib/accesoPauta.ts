// Externos con acceso SÓLO a la pauta de Meta de 1·5·10 (/1-5-10/pauta y sus APIs): el equipo de
// Habi que monta las campañas. No ven el resto de la herramienta. Edge-safe (lista estática) porque
// la lee el middleware.
const PAUTA_EMAILS: string[] = [
    'andresaponte@habi.co' // Habi, monta las campañas (6-nov-2026)
];

export const soloPauta = (email?: string | null) => PAUTA_EMAILS.includes((email || '').trim().toLowerCase());

export const rutaPauta = (p: string) => p === '/1-5-10/pauta' || p.startsWith('/1-5-10/pauta/') || p === '/api/pauta' || p.startsWith('/api/pauta/');
