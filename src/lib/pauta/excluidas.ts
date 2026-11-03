// Inmobiliarias que NO entran a la pauta de Meta de 1·5·10 (suspendidas o por suspender).
// Sin módulo de Mongo a propósito: la UI ('use client') también la lee.
//
// No hay un campo en Mongo que diga "suspendida", así que la lista es manual. Para sacar o
// meter una inmobiliaria se edita aquí; el nombre se compara contra `company.name` sin
// acentos ni mayúsculas.
export interface Excluida {
    inmobiliaria: string;
    motivo: string;
    desde: string; // AAAA-MM-DD
}

export const EXCLUIDAS: Excluida[] = [
    { inmobiliaria: 'NURA', motivo: 'Por suspender: no se invierte en ads', desde: '2026-11-03' }
];

export const normInmo = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function excluidaPor(inmobiliaria: string | null | undefined): Excluida | null {
    const n = normInmo(inmobiliaria || '');
    return EXCLUIDAS.find((e) => normInmo(e.inmobiliaria) === n) ?? null;
}
