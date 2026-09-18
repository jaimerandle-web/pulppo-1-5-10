// Qué gana una propiedad por entrar al programa 1·5·10, medido contra el resto de la red.
//
// **Por qué son constantes y no una consulta en vivo.** Son cifras de TODA la red, iguales para
// las 173 inmobiliarias: calcularlas por cuenta sería repetir el mismo barrido de `properties` +
// `leads` en cada carga para llegar siempre al mismo número. Se miden a mano y se fechan; la
// fecha va VISIBLE en pantalla para que envejezcan a la vista y no en silencio.
//
// **Cómo se midieron** (17-sep-2026, Mongo read-only, DB `pulppo`):
//   universo   `listing.operation = 'sale'` en ambos lados. El programa es 100% venta, así que
//              meter rentas en el comparable inflaría la diferencia sin razón.
//   programa   `contract.exclusive.pulppo != null`
//   resto      `contract.exclusive.pulppo = null`
//   cierre     completed / (published + completed)
//   leads      conteo de `leads` por `property._id`
//
// **El sesgo juega en contra del argumento, no a favor.** Lo primero que hay que descartar es que
// las 1·5·10 cierren más sólo por llevar más tiempo publicadas. Llevan 208 días de antigüedad
// mediana contra 184 del resto: 13% más tiempo, contra una tasa de cierre 3 veces mayor. La
// diferencia de edad no alcanza ni de lejos para explicarla.
//
// 🔴 **Por qué NO se usa "tiempo promedio de venta".** Es la métrica que pide todo el mundo y
// está rota: sólo se puede calcular sobre las que YA se vendieron, y del resto sólo vende el
// 16%. Ese 16% es la crema —las fáciles— así que comparar su velocidad contra el 48% que vende
// el programa mide selección, no desempeño, y el sesgo va EN CONTRA de 1·5·10. Los números:
//   promedio  155 vs 155 días  (idéntico)
//   mediana   130 vs 106       (favorece al resto)
//   p90       317 vs 346       (favorece al programa)
// Ninguno dice nada. La versión sana es fijar la ventana y preguntar cuánto del total ya se
// vendió a ese plazo — así el "es que llevan más tiempo publicadas" no aplica por construcción:
//   a 90 días   17% vs 7%   (2.4x)
//   a 6 meses   44% vs 16%  (2.8x)   ← el que se muestra
//   a 1 año     77% vs 31%  (2.5x)
// Denominador = avisos con al menos esa antigüedad, para no contar como "no vendida" una que
// apenas lleva un mes publicada. n del programa: 126 / 79 / 52.

/** Un beneficio medido: el número del programa, el del resto y qué tanto los separa. */
export interface Beneficio {
    clave: string;
    titulo: string;
    programa: string;
    resto: string;
    /** el titular: "3x" — lo que se lee de lejos */
    factor: string;
    /** qué significa, en una línea */
    lectura: string;
}

export const MEDIDO_EN = '17 de septiembre de 2026';

export const BENEFICIOS: Beneficio[] = [
    {
        clave: 'cierre',
        titulo: 'Vendidas en 6 meses',
        programa: '44%',
        resto: '16%',
        factor: '2.8x',
        lectura: 'De cada 100 exclusivas 1·5·10 publicadas, 44 ya se vendieron al medio año. '
               + 'Fuera del programa, 16.',
    },
    {
        clave: 'leads',
        titulo: 'Leads por propiedad',
        programa: '25',
        resto: '6',
        factor: '4x',
        lectura: 'La mediana de interesados que recibe un aviso mientras está publicado.',
    },
    {
        clave: 'sinleads',
        titulo: 'Se quedan sin un solo lead',
        programa: '3%',
        resto: '16%',
        factor: '6x menos',
        lectura: 'El riesgo real no es vender lento: es publicar y que no pase nada.',
    },
];

/** Las tres ligas de trámite que el master broker necesita a mano. */
export const ACCESOS = [
    {
        titulo: 'Dar de alta propiedades 1·5·10',
        detalle: 'El formato para meter una exclusiva al programa.',
        url: 'https://forms.gle/tbRoh6PeZNoDr9XJA',
        principal: true,
    },
    {
        titulo: 'Edición de videos para redes sociales',
        detalle: 'Solicita el corte de un video para publicarlo.',
        url: 'https://forms.gle/ekVtQyQ2p6pW32FC9',
        principal: false,
    },
    {
        titulo: 'Paquetes multimedia — Vioo x Pulppo',
        detalle: 'Fotografía, video y tour para tus propiedades.',
        url: 'https://www.vioo.com.mx/vioo-x-pulppo',
        principal: false,
    },
];
