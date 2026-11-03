import { fetchPauta, CORTE_HISTORIAL, CORTE_VIDEOS, CARPETA_VIDEOS } from '@/lib/pauta';
import { EXCLUIDAS } from '@/lib/pauta/excluidas';

// Paquete de pauta de Meta de todas las exclusivas 1·5·10 vivas.
//   GET            → JSON para la página /1-5-10/pauta
//   GET ?format=csv → una fila por propiedad pautable, para quien monta las campañas
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const csvCell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
    try {
        const props = await fetchPauta();
        if (new URL(req.url).searchParams.get('format') === 'csv') {
            const head = ['codigo', 'inmobiliaria', 'cluster', 'tipo', 'colonia', 'ciudad', 'precio', 'campana', 'url_con_utm',
                'texto_1', 'texto_2', 'texto_3', 'texto_4', 'texto_5', 'titulo_1', 'titulo_2', 'titulo_3', 'descripcion', 'cta',
                'radio_km', 'lat', 'lng', 'edad', 'intereses', 'presupuesto', 'videos_drive', 'avisos'];
            const rows = props.filter((p) => !p.excluida).map((p) => [
                p.code, p.inmobiliaria, p.cluster, p.tipo, p.colonia, p.ciudad, p.precio, p.campana, p.urlUtm,
                ...[0, 1, 2, 3, 4].map((i) => p.copies.textos[i]?.texto ?? ''),
                ...[0, 1, 2].map((i) => p.copies.titulos[i] ?? ''),
                p.copies.descripcion, p.copies.cta,
                p.seg.radioKm, p.lat, p.lng, p.seg.edad, p.seg.intereses.join(' | '), p.seg.presupuesto,
                p.videos.map((v) => `${v.formato}: ${v.url}`).join(' | '), p.avisos.join(' | ')
            ]);
            const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
            return new Response(csv, {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="pauta-1510-${new Date().toISOString().slice(0, 10)}.csv"`
                }
            });
        }
        return Response.json({
            props, excluidas: EXCLUIDAS,
            corteHistorial: CORTE_HISTORIAL, corteVideos: CORTE_VIDEOS, carpetaVideos: CARPETA_VIDEOS
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error armando la pauta' }, { status: 500 });
    }
}
