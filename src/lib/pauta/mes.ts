// Plan del mes: qué se pauta, en qué campaña y con cuánto. Lo decide Ale a mano (no se calcula):
// el presupuesto es fijo y el reparto es una apuesta, no una fórmula. Sin módulo de Mongo, como
// excluidas.ts. Para el mes siguiente se edita este archivo.
//
// Reglas (6-nov-2026):
// - $13,000 al mes en total y máximo $1,500 al mes por campaña.
// - Mitad estrellas, mitad prueba. En estrellas comparamos la misma estrella sola contra la
//   estrella en carrusel; las solas rotan cada mes (la que sale vuelve a su carrusel).
// - Carruseles de estrellas por perfil de comprador, no por zona. Carruseles de prueba por cluster.
// - Máximo 5 tarjetas por carrusel: con $1,500 al mes, 10 tarjetas son $150 c/u y Meta no aprende.
// - Revisión a los 14 días: tarjeta con 0 clics se cambia por otra del mismo cluster; la que trae
//   visitas sube a carrusel de estrellas el mes siguiente.
export type Mitad = 'estrellas' | 'prueba' | 'compartido';

export interface CarruselMes {
    nombre: string;          // nombre legible; el de la campaña se arma de aquí
    slug: string;            // va en B2C_CAR_<slug>_exc
    mitad: Mitad;
    codes: string[];         // en el orden de las tarjetas
    perfil: string;          // a quién le habla (texto para Habi)
}

export interface Mes {
    periodo: string;
    desde: string;           // AAAA-MM-DD
    revision: string;        // AAAA-MM-DD, revisión de tarjetas a los 14 días
    total: number;
    tope: number;            // por campaña al mes
    solas: string[];         // estrellas solas (mitad estrellas)
    carruseles: CarruselMes[];
    remarketing: number;
    fueraMotivo: Record<string, string>; // motivos puntuales; el resto se calcula
}

export const MES: Mes = {
    periodo: 'Noviembre 2026',
    desde: '2026-11-06',
    revision: '2026-11-20',
    total: 13000,
    tope: 1500,
    solas: ['DQP-317', 'DLS-615'],
    carruseles: [
        { nombre: 'Estrellas · Primer depa', slug: 'Estrellas_PrimerDepa', mitad: 'estrellas', codes: ['DNT-876', 'DZO-568'],
            perfil: 'Primer depa o cambio de renta a compra: departamentos de $3M a $6.5M (Inmo24).' },
        { nombre: 'Estrellas · Familia', slug: 'Estrellas_Familia', mitad: 'estrellas', codes: ['DHZ-333', 'CBW-121', 'CZG-546'],
            perfil: 'Familia que busca más espacio: casas y departamentos de $8M a $12M.' },
        { nombre: 'Prueba · Poniente $5–15M', slug: 'Poniente_5a15M', mitad: 'prueba', codes: ['DEX-762', 'DHU-306', 'DDA-291', 'COE-049'],
            perfil: 'Cluster Poniente de $5M a $15M (Santa Fe, Huixquilucan, Álvaro Obregón).' },
        { nombre: 'Prueba · Centro $5–15M', slug: 'Centro_5a15M', mitad: 'prueba', codes: ['DMA-712', 'DYO-969', 'DAS-715', 'DCI-438'],
            perfil: 'Cluster Centro y Del Valle de $4M a $8M (Benito Juárez, Cuauhtémoc).' },
        { nombre: 'Prueba · Norte $5–15M', slug: 'Norte_5a15M', mitad: 'prueba', codes: ['DGM-689', 'CEF-186', 'CQM-868', 'PAF-044'],
            perfil: 'Cluster Norte de $5M a $10M (Gustavo A. Madero, Atizapán, Tlalnepantla).' }
    ],
    remarketing: 1000,
    fueraMotivo: {
        'DTJ-191': '255 leads de MercadoLibre y 0 visitas: ráfaga sin intención de compra.',
        'CFZ-053': 'Es estrella, pero cuesta $21M: arriba de $15M el lead de Meta casi no visita.',
        'DFG-183': 'Sin un solo lead en 60 días: el carrusel de Centro queda en 4 tarjetas.'
    }
};
