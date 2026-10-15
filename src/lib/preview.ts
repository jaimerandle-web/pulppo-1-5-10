// Acceso de PREVIEW: gente de Pulppo que no está en el allowlist interno pero necesita ver el /mb de una
// inmobiliaria puntual — incluida su pestaña de Marketing, que todavía está oculta para la inmobiliaria —
// mientras se arma. Sin dependencias (Edge-safe): lo usan el middleware, canAccessCompany y el permiso de
// Marketing.
//
// No es un acceso interno: sólo abre ESAS inmobiliarias. Su login normal no cambia (si es master de otra
// cuenta, sigue entrando a la suya y abre éstas desde la liga).
//
// 🔴 Cuando el preview termine, sacar a la persona de aquí.

/** correo (en minúsculas) → companies._id que puede ver en preview */
const PREVIEW: Record<string, string[]> = {
    // Juan Pablo Velázquez — pedido por Ale el 14-oct-2026 para ver el preview de Marketing de Diamond
    // House. En Pulppo es master de «Inmobiliaria Demo», por eso el login lo encerraba en ese panel.
    'juan.pablo.velazquez@pulppo.com': ['62bf49012367c77fc24d9220'],
};

export const previewDe = (email?: string | null): string[] => PREVIEW[String(email ?? '').trim().toLowerCase()] ?? [];
export const tienePreview = (email: string | null | undefined, companyId: string) => previewDe(email).includes(companyId);
