import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Pulppo · Herramientas',
    description: 'Herramientas internas de Pulppo: 1·5·10 y Master Brokers'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            <body>{children}</body>
        </html>
    );
}
