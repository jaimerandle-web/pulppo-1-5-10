// /portales → la lógica del año (nov-2026): cortar el cubo mensual por portal / inmobiliaria / operación y
// encontrar los FOCOS ROJOS REALES. Lógica pura (sin Mongo): corre en el navegador sobre lo que trae
// /api/portales/anual, así que cambiar un filtro no vuelve a consultar.
//
// Orden: por LEADS AFECTADOS (los que se perdieron, los que quedaron sin responder…), no por porcentaje: un −50%
// de iElement (217 leads) pesa más que un −80% de una cuenta de 20. Visitas ×5 y cierres ×15 (valen más que un lead).
//
// Qué es un foco rojo REAL (Ale: «detectar focos rojos reales a primera vista»), y no ruido:
//   · se compara el ÚLTIMO MES CERRADO contra el PROMEDIO DE LOS 3 ANTERIORES (un mes malo suelto contra otro
//     bueno suelto no es tendencia);
//   · con BASE mínima (un −50% sobre 6 leads no es nada);
//   · si los leads bajan pero el INVENTARIO bajó igual (los leads por propiedad se sostienen), no es rojo: es
//     «salió inventario» y va como nota (iElement oct-2026);
//   · la tasa de visita se mide en el último mes MADURO (cerrado hace más de 30 días): los leads de octubre
//     todavía no tienen tiempo de visitar y siempre se verían mal.
//   · el mes en curso sólo alerta si, con 7+ días corridos, su ritmo diario va 30% abajo del mes pasado.
import type { CeldaMes, CierreMes, InvFila } from './anual';

// ── portales (grupos de canales) ──────────────────────────────────────────────────────────────────
export interface PortalDef { key: string; nombre: string; canales: string[]; fuentes: string[]; color: string }
export const PORTALES: PortalDef[] = [
    { key: 'i24', nombre: 'Inmuebles24', canales: ['i24', 'i24nura', 'i24premier'], fuentes: ['Inmuebles24', 'Inmuebles24 · NURA', 'Inmuebles24 · Premier'], color: '#C8642A' },
    { key: 'meli', nombre: 'MercadoLibre', canales: ['meli'], fuentes: ['MercadoLibre'], color: '#2E3A78' },
    { key: 'pcom', nombre: 'Propiedades.com', canales: ['propiedades'], fuentes: ['Propiedades.com'], color: '#B4473A' },
    { key: 'eb', nombre: 'EasyBroker', canales: ['easybroker'], fuentes: ['EasyBroker'], color: '#2F6A9E' },
    { key: 'cyt', nombre: 'Casas y Terrenos', canales: ['cyt'], fuentes: ['Casas y Terrenos'], color: '#3F7F5C' },
    { key: 'meta', nombre: 'Meta (FB/IG)', canales: ['facebook'], fuentes: ['Meta (FB/IG)'], color: '#4A5FA8' },
    { key: 'otros', nombre: 'Canales propios y otros', canales: ['whatsapp', 'pulppo', 'tokko', 'telefono', 'sitio', 'doorvel', 'otros'],
        fuentes: ['WhatsApp', 'Pulppo', 'Tokko', 'Teléfono Pulppo', 'Sitio propio', 'Doorvel', 'Otras fuentes'], color: '#8A8C8B' },
];
export const PORTAL = Object.fromEntries(PORTALES.map((p) => [p.key, p])) as Record<string, PortalDef>;
const PORTAL_DE_CANAL = new Map(PORTALES.flatMap((p) => p.canales.map((c) => [c, p.key] as const)));
export const portalDeCanal = (c: string) => PORTAL_DE_CANAL.get(c) ?? 'otros';
const PORTAL_DE_FUENTE = new Map(PORTALES.flatMap((p) => p.fuentes.map((f) => [f, p.key] as const)));

// ── filtro y agregado ─────────────────────────────────────────────────────────────────────────────
export interface Filtro { portales: string[]; inmos: string[] | null; op: 'todas' | 'sale' | 'rent' }
export interface Agg {
    leads: number; hor: number; r1h: number; resp: number; vis: number; ofe: number; clo: number;
    cierres: number; regalia: number; inventario: number | null;
}
export const vacio = (): Agg => ({ leads: 0, hor: 0, r1h: 0, resp: 0, vis: 0, ofe: 0, clo: 0, cierres: 0, regalia: 0, inventario: null });
const opOk = (o: string, f: Filtro) => f.op === 'todas' || (f.op === 'sale' ? o === 's' : o === 'r');

export function agregarCeldas(celdas: CeldaMes[], f: Filtro, por?: (c: CeldaMes) => string): Map<string, Agg> {
    const out = new Map<string, Agg>();
    const pset = f.portales.length ? new Set(f.portales) : null;
    const iset = f.inmos ? new Set(f.inmos) : null;
    for (const c of celdas) {
        if (pset && !pset.has(portalDeCanal(c[0]))) continue;
        if (iset && !iset.has(c[1])) continue;
        if (!opOk(c[2], f)) continue;
        const k = por ? por(c) : '';
        const a = out.get(k) ?? out.set(k, vacio()).get(k)!;
        a.leads += c[3]; a.hor += c[4]; a.r1h += c[5]; a.resp += c[6]; a.vis += c[7]; a.ofe += c[8]; a.clo += c[9];
    }
    return out;
}
/** cierres del mes que pasan el filtro. Con portales elegidos sólo cuentan los de esa fuente; con inmobiliaria,
 *  los que la tienen de cualquiera de los dos lados. `por` reparte (un cierre de dos inmobiliarias va a las dos). */
export function agregarCierres(cierres: CierreMes[], f: Filtro, por?: (c: CierreMes) => string[]): Map<string, { n: number; regalia: number }> {
    const out = new Map<string, { n: number; regalia: number }>();
    const pset = f.portales.length ? new Set(f.portales) : null;
    const iset = f.inmos ? new Set(f.inmos) : null;
    for (const c of cierres) {
        if (pset && !pset.has(PORTAL_DE_FUENTE.get(c[0]) ?? '')) continue;
        if (iset && !iset.has(c[1]) && !iset.has(c[2])) continue;
        if (!opOk(c[3], f)) continue;
        for (const k of por ? por(c) : ['']) {
            const a = out.get(k) ?? out.set(k, { n: 0, regalia: 0 }).get(k)!;
            a.n += 1; a.regalia += c[4];
        }
    }
    return out;
}
export const portalDeFuente = (f: string) => PORTAL_DE_FUENTE.get(f) ?? null;

export function inventarioDe(inv: InvFila[] | undefined, f: Filtro): number | null {
    if (!inv) return null;
    const iset = f.inmos ? new Set(f.inmos) : null;
    let n = 0;
    for (const [i, o, k] of inv) if ((!iset || iset.has(i)) && opOk(o, f)) n += k;
    return n;
}

// ── tasas ─────────────────────────────────────────────────────────────────────────────────────────
const p1 = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
export const tasa = {
    resp: (a: Agg) => p1(a.resp, a.leads),
    sinResp: (a: Agg) => p1(a.leads - a.resp, a.leads),
    r1h: (a: Agg) => p1(a.r1h, a.hor),
    vis: (a: Agg) => p1(a.vis, a.leads),
    ofe: (a: Agg) => p1(a.ofe, a.leads),
    lpp: (a: Agg) => (a.inventario ? Math.round((100 * a.leads) / a.inventario) / 100 : null),
};

// ── meses de referencia ───────────────────────────────────────────────────────────────────────────
export interface MesInfo { mes: string; parcial: boolean; desde: string; hasta: string }
const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesCorto = (m: string) => `${MESC[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
export const mesLargo = (m: string) => `${MESL[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
/** índice del último mes cerrado y del último mes maduro (cerrado hace más de 30 días) */
export function referencias(meses: MesInfo[], now = Date.now()): { cerrado: number; maduro: number } {
    let cerrado = meses.length - 1;
    while (cerrado >= 0 && meses[cerrado].parcial) cerrado--;
    let maduro = cerrado;
    while (maduro >= 0 && new Date(meses[maduro].hasta).getTime() > now - 30 * 86400000) maduro--;
    return { cerrado, maduro };
}
/** días corridos y días totales del mes en curso (para el ritmo) */
export function avanceMes(m: MesInfo): { corridos: number; total: number } {
    const [y, mm] = m.mes.split('-').map(Number);
    const total = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const corridos = Math.max(0, (new Date(m.hasta).getTime() - new Date(m.desde).getTime()) / 86400000);
    return { corridos, total };
}

// ── focos ─────────────────────────────────────────────────────────────────────────────────────────
export type Sev = 'alta' | 'media' | 'nota' | 'bueno';
export interface Foco { sev: Sev; quien: string; que: string; cifra: string; peso: number; filtro?: Partial<{ portal: string; inmo: string }>; mas?: string[] }
export interface Serie { quien: string; filtro?: Foco['filtro']; meses: Agg[] }

const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pctTxt = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x)}%`;

/** Focos de UNA serie (un portal, una inmobiliaria, o un portal dentro de una inmobiliaria). */
export function focosDe(s: Serie, meses: MesInfo[], base: { leads: number; visita: number }, now = Date.now()): Foco[] {
    const { cerrado: i, maduro: j } = referencias(meses, now);
    if (i < 3) return [];
    const out: Foco[] = [];
    const M = s.meses;
    const ref = M[i], ant = M.slice(i - 3, i);
    const avgL = prom(ant.map((a) => a.leads));
    const mesTxt = mesLargo(meses[i].mes).split(' ')[0];

    // 1) volumen. Primero «se apagó» (≤10% de su promedio): si pasó eso, la caída ya está dicha.
    const apagado = avgL >= base.leads && ref.leads <= avgL * 0.1;
    if (apagado) out.push({ sev: 'alta', quien: s.quien, filtro: s.filtro, peso: avgL,
        que: `Prácticamente dejó de recibir leads en ${mesTxt}. ¿Se cayó la integración o se despublicó?`, cifra: `${ref.leads} vs ${Math.round(avgL)} al mes` });
    if (avgL >= base.leads && !apagado) {
        const d = (100 * (ref.leads - avgL)) / avgL;
        const lppRef = tasa.lpp(ref), lppAnt = prom(ant.map((a) => tasa.lpp(a) ?? 0));
        const dLpp = lppRef != null && lppAnt ? (100 * (lppRef - lppAnt)) / lppAnt : null;
        const racha = M[i].leads < M[i - 1].leads * 0.9 && M[i - 1].leads < M[i - 2].leads * 0.9;
        if (d <= -25 || (racha && d <= -15)) {
            if (dLpp != null && dLpp > -10) {
                out.push({ sev: 'nota', quien: s.quien, filtro: s.filtro, peso: avgL - ref.leads,
                    que: `Bajó también el inventario: por propiedad se sostiene (${pctTxt(dLpp)}).`,
                    cifra: `${ref.leads.toLocaleString('es-MX')} leads en ${mesTxt} · ${pctTxt(d)}` });
            } else {
                out.push({ sev: d <= -40 || racha ? 'alta' : 'media', quien: s.quien, filtro: s.filtro, peso: avgL - ref.leads,
                    que: `${racha ? 'Dos meses seguidos bajando. ' : ''}${dLpp != null ? `No es inventario: por propiedad también cae (${pctTxt(dLpp)}).` : 'Leads abajo de su promedio de 3 meses.'}`,
                    cifra: `${ref.leads.toLocaleString('es-MX')} en ${mesTxt} vs ${Math.round(avgL).toLocaleString('es-MX')} prom. · ${pctTxt(d)}` });
            }
        } else if (d >= 25) {
            out.push({ sev: 'bueno', quien: s.quien, filtro: s.filtro, peso: ref.leads - avgL,
                que: 'Leads arriba de su promedio de 3 meses.',
                cifra: `${ref.leads.toLocaleString('es-MX')} en ${mesTxt} vs ${Math.round(avgL).toLocaleString('es-MX')} prom. · ${pctTxt(d)}` });
        }
    }

    // 2) atención (sin responder) — sólo con volumen
    if (ref.leads >= base.leads) {
        const sr = tasa.sinResp(ref) ?? 0, srAnt = prom(ant.map((a) => tasa.sinResp(a) ?? 0));
        if (sr >= 8 && sr - srAnt >= 3) out.push({ sev: sr >= 15 ? 'alta' : 'media', quien: s.quien, filtro: s.filtro, peso: ((sr - srAnt) / 100) * ref.leads,
            que: `Más leads sin responder en ${mesTxt}.`, cifra: `${sr}% sin responder (antes ${Math.round(srAnt * 10) / 10}%)` });
        else if (srAnt >= 8 && srAnt - sr >= 3) out.push({ sev: 'bueno', quien: s.quien, filtro: s.filtro, peso: ((srAnt - sr) / 100) * ref.leads,
            que: `Mejoró la atención en ${mesTxt}: menos leads sin responder.`, cifra: `${sr}% sin responder (antes ${Math.round(srAnt * 10) / 10}%)` });
        const r = tasa.r1h(ref), rAnt = prom(ant.map((a) => tasa.r1h(a) ?? 0));
        if (r != null && ref.hor >= base.leads && rAnt - r >= 10) out.push({ sev: 'media', quien: s.quien, filtro: s.filtro, peso: ((rAnt - r) / 100) * ref.hor * 0.5,
            que: `Se alentó la primera respuesta en ${mesTxt} (leads de 8 am a 8 pm).`, cifra: `${r}% en menos de 1 h (antes ${Math.round(rAnt)}%)` });
    }

    // 3) conversión a visita en el último mes maduro
    if (j >= 3 && M[j].leads >= base.visita) {
        const v = tasa.vis(M[j]) ?? 0, vAnt = prom(M.slice(j - 3, j).map((a) => tasa.vis(a) ?? 0));
        const mj = mesLargo(meses[j].mes).split(' ')[0];
        if (vAnt > 0 && vAnt - v >= 2 && (vAnt - v) / vAnt >= 0.25) out.push({ sev: 'media', quien: s.quien, filtro: s.filtro, peso: ((vAnt - v) / 100) * M[j].leads * 5,
            que: `Los leads de ${mj} visitaron menos que los meses anteriores.`, cifra: `${v}% visitó (antes ${Math.round(vAnt * 10) / 10}%)` });
        else if (vAnt > 0 && v - vAnt >= 2 && (v - vAnt) / vAnt >= 0.25) out.push({ sev: 'bueno', quien: s.quien, filtro: s.filtro, peso: ((v - vAnt) / 100) * M[j].leads * 5,
            que: `Los leads de ${mj} visitaron más que los meses anteriores.`, cifra: `${v}% visitó (antes ${Math.round(vAnt * 10) / 10}%)` });
    }

    // 4) cierres: los últimos 3 meses cerrados contra los 3 de antes
    if (i >= 5) {
        const c3 = M.slice(i - 2, i + 1).reduce((a, x) => a + x.cierres, 0), c3a = M.slice(i - 5, i - 2).reduce((a, x) => a + x.cierres, 0);
        if (c3a >= 5 && c3 <= c3a * 0.5) out.push({ sev: 'media', quien: s.quien, filtro: s.filtro, peso: (c3a - c3) * 15,
            que: 'Cierra la mitad o menos que el trimestre anterior.', cifra: `${c3} cierres en 3 meses vs ${c3a}` });
        else if (c3 >= 5 && c3 >= c3a * 1.5) out.push({ sev: 'bueno', quien: s.quien, filtro: s.filtro, peso: (c3 - c3a) * 15,
            que: 'Cierra bastante más que el trimestre anterior.', cifra: `${c3} cierres en 3 meses vs ${c3a}` });
    }

    // 5) el mes en curso, si ya lleva una semana y viene muy abajo
    const ult = meses[meses.length - 1];
    if (ult.parcial && i === meses.length - 2) {
        const { corridos } = avanceMes(ult);
        const prev = meses[i], dPrev = avanceMes(prev).total;
        const ritmo = M[meses.length - 1].leads / Math.max(corridos, 1), ritmoPrev = M[i].leads / dPrev;
        if (corridos >= 7 && M[i].leads >= base.leads && ritmo <= ritmoPrev * 0.7) out.push({ sev: 'media', quien: s.quien, filtro: s.filtro, peso: (ritmoPrev - ritmo) * avanceMes(ult).total,
            que: `${mesLargo(ult.mes).split(' ')[0][0].toUpperCase()}${mesLargo(ult.mes).split(' ')[0].slice(1)} viene abajo: a este ritmo cerraría muy por debajo de ${mesTxt}.`,
            cifra: `${Math.round(ritmo * 10) / 10} leads/día vs ${Math.round(ritmoPrev * 10) / 10}` });
    }
    return out;
}

/** Junta y ordena: UNA tarjeta por quién (lo más grave al frente, lo demás en `mas`), primero lo urgente.
 *  `saliendo` = inmobiliarias que dejan Pulppo (lista canónica): sus caídas son esperadas y van a notas. */
export function ordenar(fs: Foco[], saliendo: Set<string> = new Set()): { rojos: Foco[]; buenos: Foco[]; notas: Foco[] } {
    const w = (f: Foco) => (f.sev === 'alta' ? 1e6 : 0) + f.peso;
    const juntar = (xs: Foco[]) => {
        const por = new Map<string, Foco>();
        for (const f of [...xs].sort((a, b) => w(b) - w(a))) {
            const k = `${f.quien}`;
            const y = por.get(k);
            if (!y) por.set(k, { ...f, mas: [] });
            else y.mas!.push(`${f.que.replace(/\.$/, '')} (${f.cifra})`);
        }
        return [...por.values()];
    };
    const sale = (f: Foco) => !!f.filtro?.inmo && saliendo.has(f.filtro.inmo);
    const rojos = fs.filter((f) => (f.sev === 'alta' || f.sev === 'media') && !sale(f));
    const notas = [...fs.filter((f) => f.sev === 'nota'),
        ...fs.filter((f) => (f.sev === 'alta' || f.sev === 'media') && sale(f)).map((f) => ({ ...f, sev: 'nota' as const, que: `Está dejando Pulppo. ${f.que}` }))];
    return {
        rojos: juntar(rojos).sort((a, b) => w(b) - w(a)),
        buenos: juntar(fs.filter((f) => f.sev === 'bueno' && !sale(f))).sort((a, b) => b.peso - a.peso),
        notas: juntar(notas).sort((a, b) => b.peso - a.peso),
    };
}
