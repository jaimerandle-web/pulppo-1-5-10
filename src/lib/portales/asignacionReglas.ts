// Reglas de la asignación de avisos: lógica PURA (corre en el navegador para moverlas en vivo).
// Sin mongodb aquí: la UI es 'use client' (mismo motivo que ventanas.ts).
//
// Las reglas de Ale (20-nov-2026):
//   1) % del inventario EN VENTA que se destaca:  Equipos Premium 35% SD + 15% D · Equipos 15% SD + 10% D.
//   2) Tope de reinversión sobre su regalía:      Equipos Premium 50% · Equipos 40%.
// Premium que paga 15% (1Crea, iElement, Ponton) se reinvierte con el tope de Equipos (Calculadora, oct-2026).
// Si lo que le toca no cabe en su tope, se recorta parejo (como la Calculadora). Las excepciones de SD/D fijos
// de la pestaña «Asignación» mandan sobre la regla y no respetan el tope. Red/SaaS: sólo simples.
import type { Cuenta, FilaAsig } from './asignacion';

export interface ReglaModelo { sd: number; d: number; tope: number }
export interface Reglas {
    modelos: { 'Equipos Premium': ReglaModelo; Equipos: ReglaModelo };
    /** Premium con regalía ≤15% usa el tope de Equipos */
    premium15ComoEquipos: boolean;
    /** Diamond House va aparte: súper destacados fijos (Premier 130 + ZD) */
    diamondSD: number;
}
export const REGLAS_DEFAULT: Reglas = {
    modelos: { 'Equipos Premium': { sd: 0.35, d: 0.15, tope: 0.5 }, Equipos: { sd: 0.15, d: 0.10, tope: 0.4 } },
    premium15ComoEquipos: true,
    diamondSD: 205,
};

/** Precio de lista mensual sin IVA (hoja Calculadora; esto es el respaldo si no se pudo leer). */
export const PRECIOS_DEFAULT = { sdzd: 650.78, sd: 521.39, dzd: 423.09, d: 338.96, simple: 15 };
export type Precios = typeof PRECIOS_DEFAULT;
export function preciosDe(p: Record<string, number> | undefined): Precios {
    const x = p ?? {};
    return {
        sdzd: x['Súper destacado ZD'] ?? PRECIOS_DEFAULT.sdzd, sd: x['Súper destacado'] ?? PRECIOS_DEFAULT.sd,
        dzd: x['Destacado ZD'] ?? PRECIOS_DEFAULT.dzd, d: x['Destacado'] ?? PRECIOS_DEFAULT.d, simple: x['Simple'] ?? PRECIOS_DEFAULT.simple,
    };
}

export const ELEVADOS = ['sdzd', 'sd', 'dzd', 'd'] as const;
export const esModeloConElevados = (m: string | null) => m === 'Equipos Premium' || m === 'Equipos';
export const esDiamond = (f: FilaAsig) => (f.modelo ?? '').startsWith('Diamond');

/** Tope de reinversión que aplica a la cuenta (null = su modelo no reinvierte en elevados). */
export function topeDe(f: FilaAsig, r: Reglas): number | null {
    if (f.modelo === 'Equipos Premium') return r.premium15ComoEquipos && (f.pctRegalia ?? 1) <= 0.15 ? r.modelos.Equipos.tope : r.modelos['Equipos Premium'].tope;
    if (f.modelo === 'Equipos') return r.modelos.Equipos.tope;
    return null;
}

export const costoI24 = (c: Pick<Cuenta, 'sdzd' | 'sd' | 'dzd' | 'd' | 'simple'>, p: Precios) =>
    c.sdzd * p.sdzd + c.sd * p.sd + c.dzd * p.dzd + c.d * p.d + c.simple * p.simple;
export const costoElevados = (c: Pick<Cuenta, 'sdzd' | 'sd' | 'dzd' | 'd'>, p: Precios) => c.sdzd * p.sdzd + c.sd * p.sd + c.dzd * p.dzd + c.d * p.d;
/**
 * Costo LITERAL de MeLi de una cuenta, sin IVA (como los precios de i24 de la Calculadora): cada publicación $1 y cada
 * Oro Premium $42.17 encima (el paquete: $14,000 de publicaciones + $43,009 de destaques, con IVA). Antes se repartía el
 * paquete completo entre lo asignado con Oro Premium = 2 Platas, y a NURA le salían $6,300 en vez de $3,358 con IVA.
 */
export const costoMeli = (c: Pick<Cuenta, 'op' | 'oro' | 'plata'>, m: { precioPublicacion: number; precioOroPremium: number }) =>
    ((c.op + c.oro + c.plata) * m.precioPublicacion + c.op * m.precioOroPremium) / 1.16;

export interface Sugerida {
    cuenta: Pick<Cuenta, 'sdzd' | 'sd' | 'dzd' | 'd'>;
    /** % del inventario en venta que pide la regla, y qué tanto cabe en su tope (1 = todo) */
    pide: number; cabe: number;
    presupuesto: number | null;
    motivo: string;
}

/**
 * Lo que le toca por regla. `fijos` = lo que ya gasta aparte de los elevados (simples de i24 + su parte de MeLi),
 * que sale primero de su presupuesto.
 */
export function sugerida(f: FilaAsig, r: Reglas, p: Precios, fijos: number): Sugerida {
    const z = { sdzd: 0, sd: 0, dzd: 0, d: 0 };
    if (esDiamond(f)) {
        const zd = Math.min(f.hoy.sdzd, r.diamondSD);
        return { cuenta: { ...z, sdzd: zd, sd: r.diamondSD - zd }, pide: r.diamondSD, cabe: 1, presupuesto: null, motivo: `Diamond va aparte: ${r.diamondSD} súper destacados fijos (Premier + ZD)` };
    }
    const m = f.modelo;
    if (!esModeloConElevados(m)) {
        return { cuenta: z, pide: 0, cabe: 1, presupuesto: null, motivo: m ? `${m}: sólo simples` : 'Sin modelo en el Sheet: sólo simples hasta que se asigne' };
    }
    const rm = r.modelos[m as 'Equipos' | 'Equipos Premium'];
    const reparte = (n: number) => { const zd = f.invVenta ? Math.round((n * f.invZdVenta) / f.invVenta) : 0; return [zd, n - zd]; };
    const exc = f.excSD != null || f.excD != null;
    const SD = f.excSD ?? Math.round(f.invVenta * rm.sd), D = f.excD ?? Math.round(f.invVenta * rm.d);
    const [sdzd, sd] = reparte(SD), [dzd, d] = reparte(D);
    let cuenta = { sdzd, sd, dzd, d };
    const tope = topeDe(f, r)!;
    const presupuesto = f.regaliaMes != null ? tope * f.regaliaMes : null;
    const pide = SD + D;
    if (exc) return { cuenta, pide, cabe: 1, presupuesto, motivo: 'Excepción del Sheet: manda sobre la regla y no respeta el tope' };
    if (presupuesto == null) return { cuenta, pide, cabe: 1, presupuesto, motivo: 'Sin regalía en el Sheet: no se puede revisar el tope' };
    const costo = costoElevados(cuenta, p), disponible = presupuesto - fijos;
    let cabe = 1;
    if (costo > disponible) {
        cabe = Math.max(0, disponible) / costo;
        cuenta = { sdzd: Math.floor(sdzd * cabe), sd: Math.floor(sd * cabe), dzd: Math.floor(dzd * cabe), d: Math.floor(d * cabe) };
    }
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return {
        cuenta, pide, cabe, presupuesto,
        motivo: `${m}: ${pct(rm.sd)} SD + ${pct(rm.d)} D de ${f.invVenta} en venta, tope ${pct(tope)} de su regalía` + (cabe < 1 ? ` · cabe el ${pct(cabe)}, recortado parejo` : ''),
    };
}
