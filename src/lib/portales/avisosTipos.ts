// Tipos de aviso para el L/L de /portales (sin dependencias de Mongo: lo usan el motor y la UI).
export const CUENTA_PREMIER = 'ANUNCIO_PREMIERE';

/** nivel legible del tipo crudo de i24 (mismo vocabulario que Marketing de /mb); la cuenta Premier va aparte */
export function tipoI24(raw: unknown, cuenta?: unknown): string | null {
    const t = String(raw ?? '').toUpperCase();
    if (!t || t === 'OFFLINE' || t === 'NULL' || t === 'UNDEFINED') return null;
    if (String(cuenta ?? '').toUpperCase() === CUENTA_PREMIER) return 'Súper destacado · Premier';
    const zd = t.includes('ZONA_DEMAND');
    if (t.startsWith('HOME')) return zd ? 'Súper destacado zona demand' : 'Súper destacado';
    if (t.startsWith('DESTACADO')) return zd ? 'Destacado zona demand' : 'Destacado';
    if (t.startsWith('GRATIS')) return 'Gratis';
    return 'Simple';
}
/** nivel de MeLi legible (campaign del lead o type del aviso) */
export const TIPO_MELI: Record<string, string> = { gold_premium: 'Gold premium', gold_pro: 'Gold pro', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', free: 'Gratuito' };
/** precio de lista por aviso al mes en i24 (mismos que /portales/avisos y Marketing de /mb); Premier: sin precio aún */
export const COSTO_TIPO: Record<string, number> = {
    'Súper destacado zona demand': 785, 'Súper destacado': 523.48, 'Destacado zona demand': 420, Destacado: 315, Simple: 15,
};
export const ORDEN_TIPOS = ['Súper destacado · Premier', 'Súper destacado', 'Súper destacado zona demand', 'Destacado', 'Destacado zona demand', 'Simple', 'Gratis'];

/** Lo que devuelve el conteo de avisos vivos de un periodo (`avisosDelPeriodo`). */
export interface AvisosPeriodo {
    dias: number;
    /** aviso-días por tipo de aviso de i24 */
    tiposI24: Record<string, number>;
    /** aviso-días por canal de i24 (i24 · i24nura · i24premier) */
    canalesI24: Record<string, number>;
    /** foto de hoy (sin historial): avisos en línea por nivel de MeLi y por portal */
    meliHoy: Record<string, number>;
    hoy: Record<string, number>;
    /** foto de HOY de i24 por tipo (el promedio del periodo diluye un tipo que arrancó a medio periodo) */
    tiposI24Hoy?: Record<string, number>;
}
export interface AvisosArmados {
    dias: number;
    canal: Record<string, { avisos: number; hoy: boolean }>;
    tipos: Array<{ portal: 'Inmuebles24' | 'MercadoLibre'; tipo: string; avisos: number; hoy: boolean; leads: number; costoMes: number | null; ahora: number | null }>;
}
/** junta los avisos vivos con los leads por tipo de un bloque (clave «Portal|tipo») */
export function armarAvisos(av: AvisosPeriodo, leadsTipo: Record<string, number>): AvisosArmados {
    const prom = (x: number) => Math.round((10 * x) / av.dias) / 10;
    const canal: AvisosArmados['canal'] = {};
    for (const [k, n] of Object.entries(av.canalesI24)) canal[k] = { avisos: prom(n), hoy: false };
    for (const [k, n] of Object.entries(av.hoy)) canal[k] = { avisos: n, hoy: true };
    const tipos: AvisosArmados['tipos'] = [];
    for (const tp of ORDEN_TIPOS) {
        const ad = av.tiposI24[tp] ?? 0, le = leadsTipo[`Inmuebles24|${tp}`] ?? 0;
        const ah = av.tiposI24Hoy ? av.tiposI24Hoy[tp] ?? 0 : null;
        if (ad || le || ah) tipos.push({ portal: 'Inmuebles24', tipo: tp, avisos: prom(ad), hoy: false, leads: le, costoMes: COSTO_TIPO[tp] ?? null, ahora: ah });
    }
    for (const tp of Object.values(TIPO_MELI)) {
        const n = av.meliHoy[tp] ?? 0, le = leadsTipo[`MercadoLibre|${tp}`] ?? 0;
        if (n || le) tipos.push({ portal: 'MercadoLibre', tipo: tp, avisos: n, hoy: true, leads: le, costoMes: null, ahora: n });
    }
    return { dias: av.dias, canal, tipos };
}
