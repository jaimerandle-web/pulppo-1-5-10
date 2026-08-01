import { notFound } from 'next/navigation';
import { renderComparables } from '@/lib/ficha';
import { fichaToken } from '@/lib/token';
import ExportButton from '../ExportButton';

// Lista completa desde "ver más" en la ficha (datos en vivo). tipo=zona → con qué compite en la zona;
// por defecto → qué te alcanza por el mismo presupuesto.
export const dynamic = 'force-dynamic';

export default async function ComparablesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string }> }) {
    const { id } = await params;
    const { tipo } = await searchParams;
    const rep = await renderComparables(id, { token: await fichaToken(id), mode: tipo === 'zona' ? 'zona' : 'alcance' });
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
