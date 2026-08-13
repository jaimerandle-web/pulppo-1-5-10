import { notFound } from 'next/navigation';
import { evaluarElegibilidad } from '@/lib/elegibilidad';
// Alias en vez de ruta relativa: /ficha vive en la raíz (la comparten 1·5·10 y MB) y este
// archivo ya se movió una vez. Con '@/' no se vuelve a romper si cambia de carpeta.
import ExportButton from '@/app/ficha/[id]/ExportButton';

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
