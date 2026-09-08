import CentroApp from './CentroApp';

// Centro de Marketing. Protegido por el mismo middleware que el resto.
export const dynamic = 'force-dynamic';

export default function Page() {
    return <CentroApp />;
}
