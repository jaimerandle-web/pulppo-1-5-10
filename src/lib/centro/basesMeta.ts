/* ------------------------------------------------------------------ *
 * Catálogo de bases (sólo metadatos).
 *
 * Vive aparte de bases.ts por la misma razón que ventanas.ts vive aparte
 * de analisis.ts: la UI es 'use client' y no puede importar un módulo que
 * importa mongodb — se lo llevaría al bundle del navegador.
 * ------------------------------------------------------------------ */

import type { BaseId } from './tipos';

export const BASES: { id: BaseId; label: string; blurb: string }[] = [
    { id: 'brokers', label: 'Brokers', blurb: 'Asesores activos de la red. Acá vive el registro de permisos.' },
    { id: 'brokers-inactivos', label: 'Brokers inactivos', blurb: 'Dados de baja. No reciben nada del programa: son otra conversación.' },
    { id: 'inmobiliarias', label: 'Inmobiliarias', blurb: 'Las agencias activas de la red.' },
    { id: 'propietarios-renta', label: 'Propietarios de renta', blurb: 'Dueño de cada propiedad en renta publicada. La audiencia de garantías.' },
    { id: 'propietarios', label: 'Propietarios', blurb: 'Contactos etiquetados como propietario.' },
    { id: 'inquilinos', label: 'Inquilinos', blurb: 'Contactos etiquetados como inquilino.' },
    { id: 'brokers-externos', label: 'Brokers externos', blurb: 'Colegas de otras agencias en la base de contactos.' },
    { id: 'compradores', label: 'Compradores', blurb: 'Quien dejó un lead en los últimos 90 días.' },
    { id: 'pulppers', label: 'Pulppers', blurb: 'Equipo interno.' }
];
