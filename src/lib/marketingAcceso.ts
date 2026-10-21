// Quién ve la pestaña «Marketing» de /mb. Sin dependencias de servidor: lo importan la API, la página
// (server) y MBApp (client).
//
// Ale lo abrió a la inmobiliaria el 20-oct-2026 («ya puedes poner públicas PARA ELLOS ambas»): Marketing
// y Consultas los ve quien tenga acceso al /mb de Diamond House (masters, masterExtra, preview). Lo que es
// sólo de Pulppo (rotación, scoring, estrellas, trabadas, proporción de zona demand) se esconde en la UI con
// `interno`. 🔴 Nunca costos ni CPL en estas pestañas.
export const MARKETING_VISIBLE_PARA: 'internos' | 'inmobiliaria' = 'inmobiliaria';

/** Inmobiliarias con las pestañas Marketing y Consultas (hoy sólo Diamond House). */
export const MARKETING_EMPRESAS = new Set(['62bf49012367c77fc24d9220']);

import { tienePreview } from './preview';

export function puedeVerMarketing(user: { internal: boolean; email?: string } | null, companyId?: string): boolean {
    if (!user) return false;
    if (MARKETING_VISIBLE_PARA === 'inmobiliaria' || user.internal) return true;
    // acceso de preview (lib/preview.ts): ve el Marketing sólo de las inmobiliarias que tiene ahí
    return !!companyId && tienePreview(user.email, companyId);
}
