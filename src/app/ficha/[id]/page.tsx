import { notFound } from 'next/navigation';
import { renderFicha } from '@/lib/ficha';
import { fichaToken } from '@/lib/token';
import ExportButton from './ExportButton';
import ShareButton from './ShareButton';

// Ficha de desempeño imprimible por propiedad. Datos en vivo (no cache).
export const dynamic = 'force-dynamic';

export default async function FichaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
    const { id } = await params;
    const { v } = await searchParams;
    const token = await fichaToken(id);
    const ficha = await renderFicha(id, { token, simple: v === 'simple' });
    if (!ficha) notFound();
    return (
        <>
            <div className="fx-noprint" style={{ position: 'fixed', top: 12, right: 12, zIndex: 50, display: 'flex', gap: 8 }}>
                <ShareButton id={id} token={token} />
                <ExportButton />
            </div>
            <div dangerouslySetInnerHTML={{ __html: ficha.html }} />
        </>
    );
}
