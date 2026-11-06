import { fetchPauta, CORTE_HISTORIAL, CORTE_VIDEOS, CARPETA_VIDEOS } from '@/lib/pauta';
import { EXCLUIDAS } from '@/lib/pauta/excluidas';
import { armarPlan } from '@/lib/pauta/plan';
import { MES } from '@/lib/pauta/mes';

// Paquete de pauta de Meta de todas las exclusivas 1·5·10 vivas.
//   GET            → JSON para la página /1-5-10/pauta
//   GET ?format=csv → una fila por propiedad pautable, para quien monta las campañas
//   GET ?format=csv&tipo=plan → una fila por campaña del plan del mes (reactivación, estrellas solas, carruseles y remarketing) y las que quedan fuera,
//                     y en los carruseles una fila por tarjeta
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const csvCell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
    try {
        const props = await fetchPauta();
        const { plan, fuera, faltan } = armarPlan(props);
        const q = new URL(req.url).searchParams;
        const csvResp = (rows: unknown[][], nombre: string) => new Response('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${nombre}-${new Date().toISOString().slice(0, 10)}.csv"`
            }
        });
        if (q.get('format') === 'csv' && q.get('tipo') === 'plan') {
            const head = ['mitad', 'tipo', 'campana', 'nombre', 'presupuesto_mes', 'razon', 'texto_1', 'texto_2', 'texto_3',
                'ubicacion', 'edad', 'intereses', 'tarjeta', 'codigo', 'inmobiliaria', 'titulo_tarjeta', 'descripcion_tarjeta', 'url_tarjeta', 'arte_tarjeta'];
            const base = new URL(req.url).origin;
            const rows: unknown[][] = [];
            for (const c of plan) {
                const razon = c.brief
                    ? [c.razon, `Antes de prender: ${c.brief.condiciones.join(' / ')}`, `Cambios: ${c.brief.cambios.map((x) => `${x.tema}: ${x.despues}`).join(' / ')}`,
                        `Formulario: ${c.brief.formulario.join(' / ')}`, `Liga: ${c.url}`, `Apagar: ${c.brief.reglaApagado}`].join(' || ')
                    : c.razon;
                const cab = [c.mitad, c.tipo, c.nombre, c.cluster, c.presupuesto, razon, c.textos?.[0], c.textos?.[1], c.textos?.[2],
                    c.ubicacion, c.edad, c.intereses?.join(' | ')];
                if (c.tarjetas) c.tarjetas.forEach((t, i) => rows.push([...cab, i + 1, t.code, t.inmobiliaria, t.titulo, t.descripcion, t.url,
                    `${base}/api/pauta/arte?code=${t.code}&formato=card&descargar=1`]));
                else rows.push([...cab, '', c.codes[0], props.find((p) => p.code === c.codes[0])?.inmobiliaria, '', '', '', '']);
            }
            for (const x of fuera) rows.push(['fuera este mes', '', '', '', 0, x.motivo, '', '', '', '', '', '', '', x.code, x.inmobiliaria, '', '', '', '']);
            return csvResp([head, ...rows], 'plan-pauta-1510');
        }
        if (q.get('format') === 'csv') {
            const head = ['codigo', 'inmobiliaria', 'cluster', 'tipo', 'colonia', 'ciudad', 'precio', 'campana', 'url_con_utm',
                'texto_1', 'texto_2', 'texto_3', 'texto_4', 'texto_5', 'titulo_1', 'titulo_2', 'titulo_3', 'descripcion', 'cta',
                'radio_km', 'lat', 'lng', 'edad', 'intereses', 'presupuesto', 'videos_drive', 'estrella', 'leads_60d', 'visitas_60d', 'avisos'];
            const rows = props.filter((p) => !p.excluida).map((p) => [
                p.code, p.inmobiliaria, p.cluster, p.tipo, p.colonia, p.ciudad, p.precio, p.campana, p.urlUtm,
                ...[0, 1, 2, 3, 4].map((i) => p.copies.textos[i]?.texto ?? ''),
                ...[0, 1, 2].map((i) => p.copies.titulos[i] ?? ''),
                p.copies.descripcion, p.copies.cta,
                p.seg.radioKm, p.lat, p.lng, p.seg.edad, p.seg.intereses.join(' | '), p.seg.presupuesto,
                p.videos.map((v) => `${v.formato}: ${v.url}`).join(' | '), p.estrella ? 'sí' : '', p.demanda?.leads, p.demanda?.visitas, p.avisos.join(' | ')
            ]);
            return csvResp([head, ...rows], 'pauta-1510');
        }
        return Response.json({
            props, plan, fuera, faltan, mes: MES, excluidas: EXCLUIDAS,
            corteHistorial: CORTE_HISTORIAL, corteVideos: CORTE_VIDEOS, carpetaVideos: CARPETA_VIDEOS
        });
    } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Error armando la pauta' }, { status: 500 });
    }
}
