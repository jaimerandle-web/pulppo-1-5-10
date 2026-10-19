import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/companyAccess';
import { expediente } from '@/lib/propiedad';
import Buscador from '../Buscador';
import Expediente from './Expediente';

// Expediente de una propiedad (Master Brokers → Buscador). SOLO interno. Datos en vivo.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
    const u = await currentUser();
    if (!u?.internal) notFound();
    const { id } = await params;
    const e = await expediente(id);
    if (!e) notFound();
    return (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 60px', fontFamily: "'Nunito Sans', sans-serif", color: '#212322' }}>
            <Buscador titulo={`Expediente · ${e.internalId ?? e.id.slice(-8)}`} />
            <Expediente e={e} />
        </div>
    );
}
