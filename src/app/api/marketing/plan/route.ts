import { asesoresDe, audienciaRentaNueva } from '@/lib/centro/bases';
import { autoriza, envios, idEnvio, permisos, personasSaturadas, VENTANA_DIAS, viaPermiso } from '@/lib/centro/store';
import type { Envio, Persona, ViaId } from '@/lib/centro/tipos';

/* ------------------------------------------------------------------ *
 * Plan del MVP: garantía de renta.
 *
 * El flujo NO es un mensaje, son dos encadenados por el permiso:
 *   paso 1 · al ASESOR    "captaste esta renta, ¿te ayudamos con la
 *                          garantía? ¿podemos hablar con tu propietario?"
 *   paso 2 · al PROPIETARIO (sólo si el asesor dijo que sí)
 *
 * Todo lo que no pasa el permiso o el techo de frecuencia sale igual en la
 * respuesta, pero marcado y con motivo: la herramienta muestra lo que NO
 * va a mandar, no lo esconde.
 * ------------------------------------------------------------------ */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TEMA = 'garantia-renta' as const;
const MSG_ASESOR = 'garantia-renta:asesor';
const MSG_PROPIETARIO = 'garantia-renta:propietario';

export async function GET(req: Request) {
    const url = new URL(req.url);
    const dias = Math.min(90, Math.max(1, Number(url.searchParams.get('dias') || 7)));
    const fecha = (url.searchParams.get('fecha') || new Date().toISOString().slice(0, 10)).slice(0, 10);

    try {
        const audiencia = await audienciaRentaNueva(dias);
        const [asesores, ps, hechos] = await Promise.all([asesoresDe(audiencia), permisos(), envios()]);
        const saturadas = personasSaturadas(hechos, fecha);
        const yaProgramado = new Set(hechos.filter((e) => e.estado !== 'cancelado').map((e) => e.id));

        const alAsesor: Envio[] = [];
        const alPropietario: Envio[] = [];
        const bloqueados: Envio[] = [];
        // Al asesor se le escribe UNA vez aunque haya captado cinco rentas.
        const asesorYaEnEstePlan = new Set<string>();

        const fila = (
            mensajeId: string, base: Envio['base'], personaId: string, persona: string,
            asesorId: string | null, via: ViaId
        ): Envio => ({
            id: idEnvio(mensajeId, personaId, fecha),
            mensajeId, tema: TEMA, base, personaId, persona, asesorId, via, fecha,
            estado: 'programado'
        });

        for (const p of audiencia as Persona[]) {
            // El permiso que manda acá es el de PROPIETARIO: el mensaje va al dueño.
            const permiso = viaPermiso(ps, p.asesorId, TEMA, 'propietario');

            if (permiso === 'no') {
                bloqueados.push({ ...fila(MSG_PROPIETARIO, 'propietarios-renta', p.id, p.nombre, p.asesorId, 'no'), estado: 'bloqueado', motivo: 'El asesor pidió no contactar a sus propietarios' });
                continue;
            }

            // Sin respuesta todavía → el mensaje que sale es al asesor, no al dueño.
            if (!autoriza(permiso)) {
                if (!p.asesorId) {
                    bloqueados.push({ ...fila(MSG_PROPIETARIO, 'propietarios-renta', p.id, p.nombre, null, 'pulppo'), estado: 'bloqueado', motivo: 'La propiedad no tiene asesor a quién pedirle permiso' });
                    continue;
                }
                if (asesorYaEnEstePlan.has(p.asesorId)) continue;
                asesorYaEnEstePlan.add(p.asesorId);

                const a = asesores.get(p.asesorId);
                const e = fila(MSG_ASESOR, 'brokers', p.asesorId, a?.nombre || 'Asesor', p.asesorId, 'pulppo');
                if (yaProgramado.has(e.id)) continue;
                if (saturadas.has(p.asesorId)) {
                    bloqueados.push({ ...e, estado: 'bloqueado', motivo: `Ya recibe otro mensaje dentro de ±${VENTANA_DIAS} días` });
                } else {
                    alAsesor.push(e);
                }
                continue;
            }

            // Autorizado → va al propietario, por la vía que eligió el asesor.
            const e = fila(MSG_PROPIETARIO, 'propietarios-renta', p.id, p.nombre, p.asesorId, permiso);
            if (yaProgramado.has(e.id)) continue;
            if (saturadas.has(p.id)) {
                bloqueados.push({ ...e, estado: 'bloqueado', motivo: `Ya recibe otro mensaje dentro de ±${VENTANA_DIAS} días` });
            } else {
                alPropietario.push(e);
            }
        }

        return Response.json({
            tema: TEMA, dias, fecha,
            audiencia: audiencia.length,
            asesores: asesores.size,
            alAsesor, alPropietario, bloqueados,
            detalle: Object.fromEntries(audiencia.map((p) => [p.id, p]))
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error armando el plan' }, { status: 500 });
    }
}
