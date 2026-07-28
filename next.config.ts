import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // /inventario sirve el reporte estático self-contained (public/inventario.html).
    // Queda detrás del login por el middleware (la ruta no está en la allowlist del matcher).
    async rewrites() {
        return [{ source: '/inventario', destination: '/inventario.html' }];
    }
};

export default nextConfig;
