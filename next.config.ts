import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Sólo afecta a `next dev`. Las rutas protegidas se prueban a través de un proxy local
    // que inyecta la cookie de identidad, y sin esto Next bloquea sus propios recursos de
    // desarrollo por venir de otro origen: la página pinta pero NO hidrata, así que ningún
    // clic ni useEffect corre y parece que la app está rota cuando no lo está.
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
            { source: '/campanas', destination: '/1-5-10/campanas', permanent: false },
            // La herramienta de avisos dejó de ser un HTML estático con los datos embebidos
            // (se quedaba semanas atrás) y ahora se calcula en vivo. Se conserva la URL que el
            // equipo tiene marcada.
            { source: '/avisos.html', destination: '/portales/avisos', permanent: false },
            { source: '/avisos', destination: '/portales/avisos', permanent: false }
        ];
    }
};

export default nextConfig;
