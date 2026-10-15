// Quién ve la pestaña «Marketing» de /mb. Sin dependencias de servidor: lo importan la API, la página
// (server) y MBApp (client).
//
// 🔴 Hoy es SÓLO para el equipo interno de Pulppo (Ale, oct-2026): el reporte se está armando y
// Miriam, Joshua y el equipo de Diamond House todavía NO deben verlo, aunque tengan acceso al /mb.
// Cuando esté listo, Ale lo abre cambiando esto a 'inmobiliaria'.
export const MARKETING_VISIBLE_PARA: 'internos' | 'inmobiliaria' = 'internos';

/** Inmobiliarias con la pestaña (hoy sólo Diamond House). */
export const MARKETING_EMPRESAS = new Set(['62bf49012367c77fc24d9220']);

import { tienePreview } from './preview';

export function puedeVerMarketing(user: { internal: boolean; email?: string } | null, companyId?: string): boolean {
    if (!user) return false;
    if (MARKETING_VISIBLE_PARA === 'inmobiliaria' || user.internal) return true;
    // acceso de preview (lib/preview.ts): ve el Marketing sólo de las inmobiliarias que tiene ahí
    return !!companyId && tienePreview(user.email, companyId);
}
