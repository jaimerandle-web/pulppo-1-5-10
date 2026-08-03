// Motor de COMPARABLES compartido (usado por mb.ts y analisis.ts).
// En vez de comparar una propiedad contra TODA la colonia (que mezcla casas, depas y terrenos de
// cualquier tamaño), la compara contra propiedades realmente comparables:
//   misma colonia + mismo tipo + tamaño (m²) ±30% + mismas recámaras (attributes.suites).
// Si no junta al menos MIN_COMPS, baja de nivel gradualmente: quita recámaras → quita banda de m²
// → quita tipo (colonia+ciudad del mismo tipo) → colonia (cualquier tipo). Devuelve el $/m² mediano
// de los comparables encontrados y cuántos comparan (n). Fuente de datos read-only, sin credenciales.

export type PoolItem = { id: string; nb: string | null; ci: string | null; type: string; surf: number | null; suites: number | null; ppm: number };
export type Subj = { id: string; nb: string | null; ci: string | null; type: string; surf: number | null; suites: number | null };
export const SURF_TOL = 0.30, MIN_COMPS = 3;

const median = (xs: number[]): number | null => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Guarda de EXTREMOS: descarta $/m² físicamente imposibles antes de comparar. Portales externos
// (p. ej. propiedadesDotCom) meten anuncios basura que llegan a promediar cientos de millones/m².
// $1.5M MXN/m² es ~10× lo más caro real de México, así que esta banda no descarta ninguna propiedad
// legítima — solo neutraliza outliers absurdos (clave en buckets chicos, donde uno solo movería la mediana).
export const PPM_MIN = 1_000, PPM_MAX = 1_500_000;
export const sanePpm = (p: number) => p >= PPM_MIN && p <= PPM_MAX;

// Indexa un item del pool por colonia y por ciudad (para el fallback). Aplica la guarda de extremos.
export const idxPool = (byNb: Map<string, PoolItem[]>, byCi: Map<string, PoolItem[]>, it: PoolItem) => {
    if (!sanePpm(it.ppm)) return;
    if (it.nb) { const a = byNb.get(it.nb); if (a) a.push(it); else byNb.set(it.nb, [it]); }
    if (it.ci) { const a = byCi.get(it.ci); if (a) a.push(it); else byCi.set(it.ci, [it]); }
};

// $/m² mediano de los comparables + cuántos comparan. Baja de nivel hasta juntar MIN_COMPS.
export function refComps(byNb: Map<string, PoolItem[]>, byCi: Map<string, PoolItem[]>, s: Subj): { med: number | null; n: number } {
    const nbArr = s.nb ? byNb.get(s.nb) ?? [] : [];
    const notSelf = (x: PoolItem) => x.id !== s.id;
    const band = (x: PoolItem) => (s.surf && x.surf ? Math.abs(x.surf / s.surf - 1) <= SURF_TOL : false);
    const nbType = nbArr.filter((x) => notSelf(x) && x.type === s.type);
    let sel: PoolItem[];
    const l1 = s.suites != null ? nbType.filter((x) => band(x) && x.suites === s.suites) : [];
    if (l1.length >= MIN_COMPS) sel = l1;                                    // colonia + tipo + m²±30% + recámaras
    else { const l2 = nbType.filter(band);
        if (l2.length >= MIN_COMPS) sel = l2;                               // …sin recámaras
        else if (nbType.length >= MIN_COMPS) sel = nbType;                  // …sin banda de m²
        else { const ciType = (s.ci ? byCi.get(s.ci) ?? [] : []).filter((x) => notSelf(x) && x.type === s.type);
            if (ciType.length >= MIN_COMPS) sel = ciType;                   // ciudad + tipo
            else { const nbAny = nbArr.filter(notSelf); sel = nbAny.length >= MIN_COMPS ? nbAny : []; } } } // colonia (cualquier tipo) o nada
    return { med: median(sel.map((x) => x.ppm)), n: sel.length };
}
