// Validador de correos alineado con lo que acepta SendGrid (que rechaza el lote entero si uno es
// inválido). La base de leads viene sucia: teléfonos, nombres, espacios, comas, dobles puntos, dominios
// truncados. Descartamos todo lo que no sea un email con forma real. Conservador a propósito: mejor dejar
// fuera un dudoso que tumbar la subida completa.
export function validEmail(raw: string): boolean {
    const s = (raw || '').trim().toLowerCase();
    if (!s || /\s/.test(s)) return false;          // vacío o con espacios
    if (s.includes('..')) return false;            // dobles puntos (hotmail..com, e.m..ly)
    const at = s.indexOf('@');
    if (at < 1 || at !== s.lastIndexOf('@')) return false;   // sin @, @ al inicio, o múltiples @
    const local = s.slice(0, at);
    const domain = s.slice(at + 1);
    if (local.startsWith('.') || local.endsWith('.')) return false;
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;   // sin comas ni caracteres raros
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;      // etiquetas alfanuméricas separadas por punto
    if (domain.startsWith('-') || domain.endsWith('.')) return false;
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    return /^[a-z]{2,}$/.test(tld);                 // TLD de 2+ letras
}

// Rescata el correo de un campo sucio. Muchos leads traen el mail JUNTO con el teléfono u otra basura
// (ej. "correo@dom.com 5551234567" o "es correo@dom.com"). Tomamos el primer token separado por espacios
// que sea un mail válido y tiramos el resto (el teléfono). Devuelve null solo si NO hay ningún mail bueno
// (puro teléfono/nombre). No se parte por comas a propósito: "gina.escoto,taboada@gmail.com" es un mail
// mal tecleado, no un mail + basura, y adivinar mandaría al destinatario equivocado → mejor descartarlo.
export function extractEmail(raw: string): string | null {
    const s = (raw || '').trim().toLowerCase();
    if (!s) return null;
    if (validEmail(s)) return s;
    for (const token of s.split(/\s+/)) {
        const clean = token.replace(/^[<"'(]+/, '').replace(/[>"'),;:]+$/, '');
        if (validEmail(clean)) return clean;
    }
    return null;
}
