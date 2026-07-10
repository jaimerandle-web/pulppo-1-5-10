import { notFound } from 'next/navigation';
import { renderFicha } from '@/lib/ficha';
import ExportButton from './ExportButton';

// Ficha de desempeño imprimible por propiedad. Datos en vivo (no cache).
export const dynamic = 'force-dynamic';

export default async function FichaPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ficha = await renderFicha(id);
    if (!ficha) notFound();
    return (
        <>
            <ExportButton />
            <div dangerouslySetInnerHTML={{ __html: ficha.html }} />
        </>
    );
}
