import { notFound } from 'next/navigation';
import { fetchIndex } from '@/lib/mb';
import { currentUser } from '@/lib/companyAccess';
import MBIndex from './MBIndex';

// Índice de la herramienta Master Brokers: recap de todas las inmobiliarias, filtrable por KAM,
// cada una con su liga a /mb/[companyId]. SOLO interno (lista a todos los competidores). Datos en vivo.
export const dynamic = 'force-dynamic';

export default async function MBIndexPage() {
    // Defensa en profundidad: el middleware ya rutea a los externos a su panel; acá lo reforzamos.
    const u = await currentUser();
    if (!u?.internal) notFound();
    const rows = await fetchIndex();
    return <MBIndex rows={rows} />;
}
