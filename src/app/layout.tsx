import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: '1·5·10 · Centro de mando',
    description: 'Dashboard interno del programa 1·5·10 de Pulppo'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            <body>{children}</body>
        </html>
    );
}
