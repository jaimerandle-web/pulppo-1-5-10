import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // /inventario sirve el reporte estático self-contained (public/inventario.html).
    // Queda detrás del login por el middleware (la ruta no está en la allowlist del matcher).
    async rewrites() {
        return [{ source: '/inventario', destination: '/inventario.html' }];
    },
    // El bloque de 1·5·10 se movió de la raíz a /1-5-10 (la raíz ahora es el menú).
    // Estos redirects sostienen los bookmarks del equipo. Temporales (no 308) por si
    // más adelante se reacomoda otra vez.
    async redirects() {
        return [
            { source: '/evaluar', destination: '/1-5-10/evaluar', permanent: false },
            { source: '/evaluar/:id', destination: '/1-5-10/evaluar/:id', permanent: false },
            { source: '/campanas', destination: '/1-5-10/campanas', permanent: false }
        ];
    }
};

export default nextConfig;
