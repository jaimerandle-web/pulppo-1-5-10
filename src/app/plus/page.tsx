import PlusShell from './PlusShell';

// Pulppo Plus — niveles y competencia de inmobiliarias y asesores.
// Detrás del middleware (allowlist general del app), igual que /1-5-10 y /mb.
// Reemplaza el Streamlit + foto estática mensual en Vercel: aquí lee Mongo en vivo.
export const dynamic = 'force-dynamic';

export default function PlusPage() {
    return <PlusShell />;
}
