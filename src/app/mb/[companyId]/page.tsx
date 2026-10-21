import { notFound } from 'next/navigation';
import { fetchInmobiliaria } from '@/lib/mb';
import { demoData } from '@/lib/mbDemo';
import { canAccessCompany, currentUser } from '@/lib/companyAccess';
import { MARKETING_EMPRESAS, puedeVerMarketing } from '@/lib/marketingAcceso';
import MBApp from './MBApp';

// Herramienta Master Brokers — PRIMER BORRADOR. Fetch server-side; la UI (secciones + tabla
// interactiva) vive en MBApp (client). Detrás del allowlist general del app.
export const dynamic = 'force-dynamic';

export default async function MBPage({ params }: { params: Promise<{ companyId: string }> }) {
    const { companyId } = await params;
    // Barrera real de aislamiento: interno ve cualquier company; un master broker SOLO la suya.
    // Recalcula contra Mongo con la identidad firmada (no confía en cookies de ruteo). 404 si no le toca.
    if (!(await canAccessCompany(companyId))) notFound();
    // /mb/demo → cartera sintética para enseñar el panel en vivo sin exponer a nadie (solo internos).
    // No toca Mongo: se arma entera en memoria (ver src/lib/mbDemo.ts).
    if (companyId === 'demo') return <MBApp d={demoData()} />;
    const d = await fetchInmobiliaria(companyId);
    if (!d) notFound();
    // Marketing y Consultas (ver lib/marketingAcceso.ts); la API vuelve a validarlo. `interno` muestra lo de Pulppo.
    const user = await currentUser();
    const verMarketing = MARKETING_EMPRESAS.has(companyId) && puedeVerMarketing(user, companyId);
    return <MBApp d={d} verMarketing={verMarketing} interno={!!user?.internal} />;
}
