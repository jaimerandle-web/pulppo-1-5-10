import PortalesShell from './PortalesShell';

// /portales — Análisis de portales: costo, retorno y calidad del funnel por canal.
// Detrás del middleware (allowlist general del app), igual que /1-5-10, /mb y /plus.
// Reemplaza el Streamlit que corría SOLO en la laptop de Ale (~/Documents/Pulppo/Análisis de
// Portales/dashboard): ahí no había URL que heredar y el día que ella se fuera desaparecía.
// Ojo: /analisis es otra cosa (el configurador del reporte por inmobiliaria).
export const dynamic = 'force-dynamic';

export default function PortalesPage() {
    return <PortalesShell />;
}
