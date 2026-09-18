// Qué gana una propiedad por entrar al programa 1·5·10, medido contra el resto de la red.
//
// **Por qué son constantes y no una consulta en vivo.** Son cifras de TODA la red, iguales para
// las 173 inmobiliarias: calcularlas por cuenta sería repetir el mismo barrido de `properties` +
// `leads` + `visits` en cada carga para llegar siempre al mismo número. Se miden a mano y se
// fechan; la fecha va VISIBLE en pantalla para que envejezcan a la vista y no en silencio.
//
// **Cómo se midieron** (17-sep-2026, Mongo read-only, DB `pulppo`):
//   universo   `listing.operation = 'sale'` en ambos lados. El programa es 100% venta, así que
//              meter rentas en el comparable inflaría la diferencia sin razón.
//   programa   `contract.exclusive.pulppo != null`      resto  `contract.exclusive.pulppo = null`
//   cierre     completed / (published + completed)
//   leads      conteo de `leads` por `property._id`
//   visitas    `visits` con `status.last = 'confirmed'`, unwind de `steps`, deduplicadas por
//              persona (`contact._id`). 🔴 `visits` NO tiene `property._id` en la raíz: el
//              camino es `steps.property._id`. Con el camino equivocado sale 0 en todo y
//              parece que nadie visita nada.
//
// **El sesgo de antigüedad juega en contra del argumento, no a favor.** Lo primero que hay que
// descartar es que las 1·5·10 cierren más sólo por llevar más tiempo publicadas. Llevan 208
// días de antigüedad mediana contra 184: 13% más tiempo, contra una tasa de cierre 3 veces
// mayor. No alcanza ni de lejos para explicarla. La prueba dura es `ESCALERA`: con la ventana
// de tiempo fija, la ventaja se sostiene en los tres cortes.
//
// 🔴 **"Tiempo promedio de venta" NO se usa, y no es un olvido.** Sólo se puede calcular sobre
// las que YA se vendieron, y del resto sólo vende el 16%: ese 16% es la crema, así que comparar
// su velocidad contra el 48% que vende el programa mide selección, no desempeño. Los tres
// estadísticos se contradicen y ninguno concluye: promedio 155 vs 155 (idéntico), mediana 130
// vs 106 (favorece al resto), p90 317 vs 346 (favorece al programa). La forma sana de preguntar
// "¿vende más rápido?" es `ESCALERA`, no promediar días.
//
// **Medidos y descartados**, para que nadie los vuelva a proponer creyendo que faltan:
//   · rebaja de precio para vender — sale AL REVÉS (42% de las 1·5·10 rebajan contra 35% del
//     resto; n=45 y 662). No se muestra porque no favorece, no porque no se haya medido.
//   · días hasta la venta — ver arriba.

/** Un beneficio medido: el número del programa, el del resto y qué tanto los separa. */
export interface Beneficio {
    clave: string;
    titulo: string;
    /** la cifra grande */
    programa: string;
    /** la misma cifra fuera del programa */
    resto: string;
    /** el gancho: "3 veces más" */
    factor: string;
}

export const MEDIDO_EN = '17 de septiembre de 2026';

export const BENEFICIOS: Beneficio[] = [
    // 48.2% (68/141) vs 16.0% (1,372/8,572) = 3.0x — es la cifra del titular
    { clave: 'cierre', titulo: 'Se venden', programa: '48%', resto: '16%', factor: '3 veces más' },
    // mediana de leads por aviso: 25 vs 6
    { clave: 'leads', titulo: 'Leads por propiedad', programa: '25', resto: '6', factor: '4 veces más' },
    // 80.1% vs 27.0% = 3.0x. Va en POSITIVO a propósito: la cifra cruda es que el 73% del resto
    // nunca recibe una visita —la mediana de visitas del resto es CERO— y dicho así el panel
    // quedaba con dos tarjetas de "lo malo que pasa si no entras", que es lo que Ale sacó.
    { clave: 'visitas', titulo: 'Reciben visitas', programa: '80%', resto: '27%', factor: '3 veces más' },
];

/**
 * Cuánto del total ya se vendió a cada plazo. Denominador: avisos con al menos esa antigüedad.
 *
 * **Ya NO se muestra en pantalla** (Ale, 18-sep: cargaba el panel). Se conserva porque es la
 * prueba dura contra el "¿no será que las 1·5·10 llevan más tiempo publicadas?": la ventana es
 * la misma para los dos lados, así que el reclamo no aplica por construcción. Si alguien
 * cuestiona el 3x, la respuesta está acá.
 */
export const ESCALERA = [
    { plazo: '90 días', programa: 17, resto: 7 },
    { plazo: '6 meses', programa: 44, resto: 16 },
    { plazo: '1 año', programa: 77, resto: 31 },
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
