'use client';

// Hoja de estilos de impresión para UNA sección de la app: deja en el papel sólo el subárbol
// `id` y esconde el resto (sidebar, filtros, botones).
//
// Dos cosas que antes cortaban el PDF y por eso NO se hacen aquí:
//
// 1. El subárbol se queda en el FLUJO NORMAL y lo demás se oculta con `display: none`. La
//    versión anterior lo sacaba del flujo (`position: absolute` sobre `visibility: hidden` en
//    el resto): al no estar en el flujo, la altura del documento la seguía definiendo la app
//    de atrás, Chrome paginaba con ESA altura y el reporte se cortaba en la última hoja
//    (reportado sep-2026 con Black Brick: el PDF salía "1/3" y la recomendación 3 quedaba
//    partida a media frase).
// 2. Ni `zoom` ni `transform` sobre el subárbol: al imprimir, Chrome pagina con la altura sin
//    escalar y pierde el final. Para que quepa se bajan tipografías y paddings y se permite
//    que las celdas hagan salto de línea — eso sí respeta la paginación.
//
// El `:has()` es lo que deja visibles los ANCESTROS del subárbol: sin él, el `display: none`
// de un padre se lleva al hijo por delante. A esos ancestros además se les quita el layout de
// app (el flex con el sidebar, los paddings, el ancho máximo) para que el reporte use la hoja
// completa.
export default function PrintRoot({ id, orientation = 'portrait', extra = '' }:
    { id: string; orientation?: 'portrait' | 'landscape'; extra?: string }) {
    return (
        <style>{`@media print {
            body :not(:has(#${id})):not(#${id}):not(#${id} *) { display: none !important; }
            body :has(#${id}) {
                display: block !important; position: static !important; overflow: visible !important;
                width: auto !important; max-width: none !important; min-width: 0 !important;
                height: auto !important; min-height: 0 !important; max-height: none !important;
                margin: 0 !important; padding: 0 !important; border: 0 !important; background: #fff !important;
            }
            html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
            #${id} { margin: 0 !important; }

            /* Lo que no tiene sentido en papel: filtros, botones, links "abrir en otra pestaña". */
            #${id} .no-print { display: none !important; }

            /* Nada de scroll horizontal en papel: las tablas anchas sueltan su min-width y sus
               celdas pueden hacer salto de línea. Sin el salto de línea el nowrap de pantalla
               impide que la tabla se comprima y lo que sobra se va fuera de la hoja. */
            #${id} .overflow-x-auto, #${id} .print-wide { overflow: visible !important; }
            #${id} table[class*="min-w-"], #${id} [class*="min-w-"] { min-width: 0 !important; }
            #${id} table { width: 100% !important; table-layout: auto !important; }
            #${id} table th, #${id} table td { white-space: normal !important; word-break: break-word; }

            /* Encabezado de tabla repetido en cada hoja y filas que no se parten por la mitad. */
            #${id} thead { display: table-header-group; }
            #${id} tr, #${id} img { break-inside: avoid; page-break-inside: avoid; }

            /* Un título no se queda solo al final de una hoja. Ojo: NO se usa
               \`break-inside: avoid\` en las secciones — varias son más altas que una carta y
               obligar a no partirlas es justo lo que hace que se pierda el final. */
            #${id} h1, #${id} h2, #${id} h3 { break-after: avoid; page-break-after: avoid; }

            @page { size: letter ${orientation}; margin: 10mm; }
            ${extra}
        }`}</style>
    );
}
