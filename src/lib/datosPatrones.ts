// Patrones de un broker (zonas, operación, tipos, presupuesto) a partir de las propiedades que pregunta u opera.
// Qué mueve cada broker, sacado de las propiedades por las que preguntó o con las que operó.
// Precios en MXN (USD × USD_MXN). Rango típico = percentil 25 a 75.
export type Rango = { n: number; mediana: number; tipico_min: number; tipico_max: number };
export type Patrones = {
    zonas: { colonia: string; municipio: string | null; n: number }[];
    municipios: { municipio: string; n: number }[];
    operacion: { venta: number; renta: number };
    tipos: { tipo: string; n: number }[];
    presupuesto: { venta: Rango | null; renta: Rango | null };
    recamaras_mediana: number | null;
};
export const USD_MXN = 18.5;
const pct = (xs: number[], q: number) => { const a = [...xs].sort((x, y) => x - y); const i = (a.length - 1) * q, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const rango = (xs: number[]): Rango | null => xs.length ? { n: xs.length, mediana: Math.round(pct(xs, 0.5)), tipico_min: Math.round(pct(xs, 0.25)), tipico_max: Math.round(pct(xs, 0.75)) } : null;
const top = <T extends string>(xs: (T | null)[], k: number) => {
    const m = new Map<T, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
};

export type PropPatron = {
    operacion: string | null; tipo: string | null; precio: number | null; moneda: string | null; recamaras: number | null;
    ubicacion: { colonia: string | null; municipio: string | null };
};

export function patrones(ps: PropPatron[]): Patrones {
    const mxn = (p: PropPatron) => (p.precio && p.precio > 1 ? p.precio * (String(p.moneda).toUpperCase() === 'USD' ? USD_MXN : 1) : null);
    const precios = (op: string) => ps.filter((p) => p.operacion === op).map(mxn).filter((x): x is number => x != null);
    const zonas = top(ps.map((p) => (p.ubicacion.colonia ? `${p.ubicacion.colonia}|${p.ubicacion.municipio ?? ''}` : null)), 5)
        .map(([k, n]) => { const [colonia, municipio] = k.split('|'); return { colonia, municipio: municipio || null, n }; });
    const rec = ps.map((p) => p.recamaras).filter((x): x is number => typeof x === 'number' && x > 0);
    return {
        zonas,
        municipios: top(ps.map((p) => p.ubicacion.municipio), 3).map(([municipio, n]) => ({ municipio, n })),
        operacion: { venta: ps.filter((p) => p.operacion === 'venta').length, renta: ps.filter((p) => p.operacion === 'renta').length },
        tipos: top(ps.map((p) => p.tipo), 3).map(([tipo, n]) => ({ tipo, n })),
        presupuesto: { venta: rango(precios('venta')), renta: rango(precios('renta')) },
        recamaras_mediana: rec.length ? pct(rec, 0.5) : null,
    };
}

