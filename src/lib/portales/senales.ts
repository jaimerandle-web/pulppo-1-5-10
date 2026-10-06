// Red flags del Resumen: lo que cambió de forma rara, por fuente. Es lógica pura (sólo tipos de
// inmobiliaria.ts, sin mongodb) para que corra en el cliente sobre la vista que ya llegó.
//
// Dos tipos de señal:
//   · contra el periodo comparado — volumen que se dispara o se cae, y si al mismo tiempo empeoró
//     la atención (el caso «entraron el doble de MeLi y nadie contesta»), brokers, fantasmas, visita.
//   · dentro del periodo, día por día — picos y caídas contra la mediana diaria de esa fuente (una
//     caída a casi cero suele ser una integración rota, no falta de demanda).
// Los umbrales piden una base mínima: con 30 leads un +60% son 18 leads y no es una señal.
import type { Bloque, Fila } from './inmobiliaria';

export type Sev = 'alta' | 'media';
export interface Senal { sev: Sev; fuente: string; txt: string; /** días marcados en la gráfica */ dias?: string[] }

const MIN_VOL = 100;          // leads (el mayor de los dos periodos) para opinar de una fuente
const SUBE = 1.5, BAJA = 0.65; // ×1.5 o −35%
const MIN_DIA = 5;            // mediana diaria mínima para buscar días raros

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);
const pts = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);
const mediana = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const diaCorto = (d: string) => `${Number(d.slice(8))} ${MES[Number(d.slice(5, 7)) - 1]}`;
const rango = (ds: string[]) => (ds.length === 1 ? `el ${diaCorto(ds[0])}` : `del ${diaCorto(ds[0])} al ${diaCorto(ds[ds.length - 1])}`);

/** Fuente vs. la misma fuente del periodo comparado. */
function contraComparado(A: Bloque, C: Bloque, cmp: string): Senal[] {
    const out: Senal[] = [];
    // los periodos pueden no medir lo mismo (año pasado con feb-29, rangos): se compara por día
    const esc = C.dias ? A.dias / C.dias : 1;
    for (const f of A.fuentes) {
        const c: Fila | undefined = C.fuentes.find((y) => y.key === f.key);
        if (!c) continue;
        const cl = c.leads * esc;
        if (Math.max(f.leads, cl) < MIN_VOL) continue;
        const ratio = cl ? f.leads / cl : Infinity;
        const subio = ratio >= SUBE, bajo = ratio <= BAJA;

        // atención: asesor sin responder (horario laboral), 1ª respuesta y respuesta visible del cliente
        const malas: string[] = [];
        const dSin = pts(f.pctSinResp, c.pctSinResp);
        if (dSin != null && dSin >= 5) malas.push(`el asesor deja sin responder el ${f.pctSinResp}% (antes ${c.pctSinResp}%)`);
        if (f.respMed != null && c.respMed != null && f.respMed >= c.respMed * 1.5 && f.respMed - c.respMed >= 10)
            malas.push(`la 1ª respuesta pasó de ${Math.round(c.respMed)} a ${Math.round(f.respMed)} min`);
        const dVis = pts(f.pctSinRespuesta, c.pctSinRespuesta);
        if (dVis != null && dVis >= 8) malas.push(`no vemos respuesta del cliente en el ${f.pctSinRespuesta}% (antes ${c.pctSinRespuesta}%)`);

        if (subio || bajo) {
            const vol = subio
                ? `entraron ${ratio >= 1.95 ? `${(Math.round(ratio * 10) / 10)} veces más` : `${Math.round((ratio - 1) * 100)}% más`} leads ${cmp} (${f.leads.toLocaleString('es-MX')} vs ${Math.round(cl).toLocaleString('es-MX')})`
                : `entraron ${-pct(f.leads, cl)}% menos leads ${cmp} (${f.leads.toLocaleString('es-MX')} vs ${Math.round(cl).toLocaleString('es-MX')})`;
            if (subio && malas.length) out.push({ sev: 'alta', fuente: f.nombre, txt: `${f.nombre}: ${vol} y ${malas.join('; ')}.` });
            else out.push({ sev: bajo && ratio <= 0.5 ? 'alta' : 'media', fuente: f.nombre, txt: `${f.nombre}: ${vol}.${malas.length ? ` Además, ${malas.join('; ')}.` : ''}` });
        } else if (malas.length) {
            out.push({ sev: dSin != null && dSin >= 10 ? 'alta' : 'media', fuente: f.nombre, txt: `${f.nombre}: ${malas.join('; ')}.` });
        }

        const dBrk = pts(f.pctBroker, c.pctBroker);
        if (dBrk != null && dBrk >= 8) out.push({ sev: 'media', fuente: f.nombre, txt: `${f.nombre}: los leads de brokers subieron a ${f.pctBroker}% (antes ${c.pctBroker}%).` });
        const dFan = pts(f.pctFantasma, c.pctFantasma);
        if (dFan != null && dFan >= 5) out.push({ sev: dFan >= 10 ? 'alta' : 'media', fuente: f.nombre, txt: `${f.nombre}: los fantasmas (teléfono inválido) subieron a ${f.pctFantasma}% (antes ${c.pctFantasma}%).` });
        const dVisita = pts(f.pVisita, c.pVisita);
        if (f.unicos >= 200 && dVisita != null && dVisita <= -3) out.push({ sev: 'media', fuente: f.nombre, txt: `${f.nombre}: lead → visita bajó a ${f.pVisita}% (antes ${c.pVisita}%).` });
    }
    return out;
}

/** Días raros dentro del periodo, por fuente. `hoy` (YYYY-MM-DD) se ignora: el día en curso está incompleto. */
function diasRaros(A: Bloque, hoy: string): Senal[] {
    const out: Senal[] = [];
    if (!A.porDia) return out;                                  // vista cacheada de antes de la serie
    const { dias, series } = A.porDia;
    const ok = dias.map((d) => d < hoy);
    if (ok.filter(Boolean).length < 10) return out;            // con menos de 10 días no hay "normal"
    for (const s of series) {
        if (s.key === 'f:otros') continue;
        // Entre semana y fin de semana no se parecen (un domingo flojo no es una integración rota):
        // cada día se mide contra la mediana de los de su tipo.
        const finde = dias.map((d) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w === 0 || w === 6; });
        const medDe = (fs: boolean) => mediana(s.n.filter((_, i) => ok[i] && finde[i] === fs));
        const medES = medDe(false), medFS = finde.filter((f, i) => f && ok[i]).length >= 3 ? medDe(true) : medES;
        const med = medES;
        if (med < MIN_DIA) continue;
        const pico: string[] = [], caida: string[] = [];
        dias.forEach((d, i) => {
            if (!ok[i]) return;
            const m = finde[i] ? medFS : medES;
            if (s.n[i] >= Math.max(2 * m, m + 15)) pico.push(d);
            else if (m >= 10 && s.n[i] <= 0.25 * m) caida.push(d);
        });
        const normal = `normal ~${Math.round(med)}/día entre semana`;
        // días seguidos se cuentan juntos; si son muchos sueltos, sólo se dice cuántos
        const grupos = (ds: string[]) => {
            const g: string[][] = [];
            for (const d of ds) {
                const prev = g[g.length - 1];
                if (prev && (new Date(d).getTime() - new Date(prev[prev.length - 1]).getTime()) === 86400000) prev.push(d);
                else g.push([d]);
            }
            return g;
        };
        for (const g of grupos(caida)) {
            const n = g.reduce((a, d) => a + s.n[dias.indexOf(d)], 0);
            out.push({ sev: 'alta', fuente: s.nombre, dias: g,
                txt: `${s.nombre}: casi no entraron leads ${rango(g)} (${n.toLocaleString('es-MX')}${g.length > 1 ? ' en total' : ''}; ${normal}). ¿Se cayó la integración o se apagó el paquete?` });
        }
        const gp = grupos(pico);
        if (gp.length > 3) {
            out.push({ sev: 'media', fuente: s.nombre, dias: pico, txt: `${s.nombre}: ${pico.length} días con el doble de leads de lo normal (${normal}).` });
        } else for (const g of gp) {
            const top = Math.max(...g.map((d) => s.n[dias.indexOf(d)]));
            const i = dias.indexOf(g[0]);
            const sinR = g.reduce((a, d) => a + s.sin[dias.indexOf(d)], 0), labR = g.reduce((a, d) => a + s.lab[dias.indexOf(d)], 0);
            const pSin = labR >= 20 ? Math.round((100 * sinR) / labR) : null;
            out.push({ sev: pSin != null && pSin >= 20 ? 'alta' : 'media', fuente: s.nombre, dias: g,
                txt: `${s.nombre}: pico ${rango(g)} — ${g.length > 1 ? `hasta ${top.toLocaleString('es-MX')}` : s.n[i].toLocaleString('es-MX')} leads en un día (${normal})${pSin != null && pSin >= 10 ? `; el asesor dejó sin responder el ${pSin}%` : ''}.` });
        }
    }
    return out;
}

export function senales(A: Bloque, C: Bloque | null, cmp: string, hoy: string): Senal[] {
    return [...(C ? contraComparado(A, C, cmp) : []), ...diasRaros(A, hoy)];
}

/** Una fila por fuente: sus hallazgos juntos, con la severidad más alta. Altas primero; dentro de
 *  cada severidad, la fuente con más leads arriba. */
export interface SenalFuente { sev: Sev; fuente: string; items: string[] }
export function porFuente(xs: Senal[], orden: string[]): SenalFuente[] {
    const m = new Map<string, SenalFuente>();
    for (const x of xs) {
        const e = m.get(x.fuente) ?? m.set(x.fuente, { sev: 'media', fuente: x.fuente, items: [] }).get(x.fuente)!;
        if (x.sev === 'alta') e.sev = 'alta';
        const t = x.txt.startsWith(`${x.fuente}: `) ? x.txt.slice(x.fuente.length + 2) : x.txt;
        e.items.push(t.charAt(0).toUpperCase() + t.slice(1));
    }
    const pos = (f: string) => { const i = orden.indexOf(f); return i < 0 ? 99 : i; };
    return [...m.values()].sort((a, b) => (a.sev === b.sev ? pos(a.fuente) - pos(b.fuente) : a.sev === 'alta' ? -1 : 1));
}
