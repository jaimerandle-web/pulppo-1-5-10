import { notFound } from 'next/navigation';
import { fetchInmobiliaria } from '@/lib/mb';
import { demoData } from '@/lib/mbDemo';
import MBApp from './MBApp';

// Herramienta Master Brokers — PRIMER BORRADOR. Fetch server-side; la UI (secciones + tabla
// interactiva) vive en MBApp (client). Detrás del allowlist general del app.
export const dynamic = 'force-dynamic';

export default async function MBPage({ params }: { params: Promise<{ companyId: string }> }) {
    const { companyId } = await params;
    // /mb/demo → cartera sintética para enseñar el panel en vivo sin exponer a nadie.
    // No toca Mongo: se arma entera en memoria (ver src/lib/mbDemo.ts).
    if (companyId === 'demo') return <MBApp d={demoData()} />;
    const d = await fetchInmobiliaria(companyId);
    if (!d) notFound();
    return <MBApp d={d} />;
}
