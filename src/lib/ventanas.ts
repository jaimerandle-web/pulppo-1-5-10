// Opciones de las ventanas de fecha del análisis. Vive aparte de analisis.ts A PROPÓSITO:
// analisis.ts importa el driver de mongodb, así que un componente 'use client' no puede
// importar valores de ahí (se llevaría Mongo al bundle del navegador). Este archivo no
// tiene dependencias: lo consumen tanto el motor como los formularios.
//
// Dos conceptos, estandarizados (feedback Ale, ago-2026):
//
//   COMPARABLES = el MERCADO (precio competitivo, competencia, demanda).
//     · Oferta (lo que se pide)   → foto de HOY, no configurable: no guardamos su historia.
//     · Cierres (lo que se vende) → mínimo 6 meses (los cierres son pocos).
//     · Demanda (búsquedas)       → mínimo 1 mes.
//
//   DESEMPEÑO = TU OPERACIÓN (funnel comercial, asesores, leads por propiedad, sin actividad).
//     · Una ventana + una base contra la cual compararla.

export const CIERRES_WIN = ['Últimos 6 meses', 'Últimos 12 meses', 'Últimos 24 meses', 'Últimos 36 meses'];
export const DEMANDA_WIN = ['Último mes', 'Últimos 3 meses', 'Últimos 6 meses', 'Últimos 12 meses'];
export const DESEMPENO_WIN = ['Mes actual', 'Mes anterior', 'Mes específico', 'Últimos 3 meses', 'Últimos 6 meses', 'Año en curso (YTD)', 'Últimos 12 meses'];
export const COMPARAR_OPTS = ['Período anterior', 'Mismo período del año pasado', 'Sin comparación'];

// Últimos N meses como opciones de "Mes específico" (para el selector del form).
export const mesesOpts = (n = 18, now = new Date()): { v: string; l: string }[] => {
    const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const out: { v: string; l: string }[] = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        out.push({ v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, l: `${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
    }
    return out;
};
