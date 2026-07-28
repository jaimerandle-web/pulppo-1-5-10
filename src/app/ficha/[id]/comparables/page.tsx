import { notFound } from 'next/navigation';
import { renderComparables } from '@/lib/ficha';
import { fichaToken } from '@/lib/token';
import ExportButton from '../ExportButton';

// Lista completa de "Qué te alcanza por el mismo presupuesto" (ver más desde la ficha). Datos en vivo.
export const dynamic = 'force-dynamic';

export default async function ComparablesPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const rep = await renderComparables(id, { token: await fichaToken(id) });
    if (!rep) notFound();
    return (
        <>
            <div className="fx-noprint" style={{ position: 'fixed', top: 12, right: 12, zIndex: 50, display: 'flex', gap: 8 }}>
                <ExportButton />
            </div>
            <div dangerouslySetInnerHTML={{ __html: rep.html }} />
        </>
    );
}
