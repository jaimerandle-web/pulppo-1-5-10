import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Inmobiliarias Pulppo',
    description: 'Centro de mando de Inmobiliarias Pulppo'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            <body>{children}</body>
        </html>
    );
}
