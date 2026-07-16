import { notFound } from 'next/navigation';
import { evaluarElegibilidad } from '@/lib/elegibilidad';
import ExportButton from '../../ficha/[id]/ExportButton';

// Evaluación de elegibilidad 1·5·10 por propiedad. Datos en vivo. Acepta ObjectId o código (CTA-422).
export const dynamic = 'force-dynamic';

export default async function EvaluarPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const r = await evaluarElegibilidad(id);
    if (!r) notFound();
    return (
        <>
            <div className="fx-noprint" style={{ position: 'fixed', top: 12, right: 12, zIndex: 50, display: 'flex', gap: 8 }}>
                <ExportButton />
            </div>
            <div dangerouslySetInnerHTML={{ __html: r.html }} />
        </>
    );
}
