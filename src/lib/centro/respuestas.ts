/* Respuestas compartidas de las APIs del Centro. Vive fuera de los route.ts
 * porque un archivo de ruta sólo puede exportar métodos HTTP y config. */

/**
 * Sin almacenamiento escribible no se finge que se guardó: se dice.
 * Es una función y no una constante porque un Response sólo se consume una vez.
 */
export const sinStore = () => Response.json({
    error: 'Esta versión todavía no puede guardar. Falta crear el Blob store en el proyecto de Vercel (Storage → Create → Blob): el token se inyecta solo y el guardado se prende sin tocar código.',
    efimero: true
}, { status: 503 });
