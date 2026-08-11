import { notFound } from 'next/navigation';
import { fetchInmobiliaria } from '@/lib/mb';
import { demoData } from '@/lib/mbDemo';
import { canAccessCompany } from '@/lib/companyAccess';
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
    return <MBApp d={d} />;
}
