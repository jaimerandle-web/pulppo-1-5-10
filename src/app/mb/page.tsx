import { fetchIndex } from '@/lib/mb';
import MBIndex from './MBIndex';

// Índice de la herramienta Master Brokers: recap de todas las inmobiliarias, filtrable por KAM,
// cada una con su liga a /mb/[companyId]. Detrás del allowlist general. Datos en vivo.
export const dynamic = 'force-dynamic';

export default async function MBIndexPage() {
    const rows = await fetchIndex();
    return <MBIndex rows={rows} />;
}
