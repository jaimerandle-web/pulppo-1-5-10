import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Inmobiliarias Pulppo',
    description: 'Centro de mando de Inmobiliarias Pulppo'
};

/**
 * Sin esto el navegador del teléfono finge una pantalla de ~980px y encoge la página
 * entera para que quepa: el texto sale ilegible y hay que hacer zoom para todo. Era la
 * causa de que el panel se viera "cero responsive" en el celular — no las pantallas, que
 * ya usan rejillas fluidas, sino que nunca se le dijo al móvil cuál era su propio ancho.
 * Afecta a TODA la app (Studio incluido), no sólo a /analisis.
 *
 * `maximumScale` se deja libre a propósito: fijarlo bloquea el zoom con los dedos y deja
 * fuera a quien necesita acercar para leer.
 */
export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            <body>{children}</body>
        </html>
    );
}
