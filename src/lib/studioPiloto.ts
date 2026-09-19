// Quién puede entrar a Pulppo Studio.
//
// 🔴 **El Studio es SÓLO de Diamond House.** El bundle de `public/studio/index.html` se genera
// para una inmobiliaria (`gen_prototipo_web.py --equipo "DIAMOND HOUSE"`): sus zonas, su
// inventario, su co-marca. Para cualquier otra cuenta no es que se vea incompleto — es que no
// es su herramienta.
//
// **Por qué existe este archivo.** El corte estaba implícito en tres lugares distintos y en
// ninguno se cumplía:
//
// 1. El login mandaba a `/inicio` a CUALQUIER master broker, y ese menú ofrece Studio. Se
//    construyó para el titular de Diamond House —que también publica contenido— y quedó
//    aplicando a los 43 titulares. María Carrera (9 SQUARE) terminó en el Studio en lugar de
//    su panel.
// 2. `asesorIdForEmail()` acepta a cualquier `associate` activo, así que los ~988 asesores de
//    la red podían llegar al Studio de Diamond House.
// 3. El middleware dejaba pasar `/studio*` a todo master broker y a todo asesor.
//
// No hubo fuga de datos: el bundle NO lleva perfiles embebidos, los pide a `/api/studio/perfil`
// con la identidad de la sesión. Quien no es de la casa no ve nada ajeno — ve una herramienta
// que no le sirve, en lugar de la suya.
//
// Cuando el Studio se abra a más inmobiliarias, esto pasa a ser una lista (o una bandera en
// `companies`) y se cambia en UN lugar.

/** Diamond House — la única inmobiliaria del piloto de Studio. */
export const STUDIO_COMPANY = '62bf49012367c77fc24d9220';

/** ¿La inmobiliaria de esta persona tiene Studio? */
export function tieneStudio(companyId?: string | null): boolean {
    return !!companyId && companyId === STUDIO_COMPANY;
}
