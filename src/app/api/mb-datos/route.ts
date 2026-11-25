// Datos: la base de la inmobiliaria para descargar o para un agente de IA.
//
//   GET /api/mb-datos?company=<id>                              → resumen (conteos, fecha, URLs)
//   GET /api/mb-datos?company=<id>&tipo=propiedades|leads|asesores[&formato=json|xlsx]
//   Filtros (opcionales, útiles para el agente):
//     propiedades: &estado=published        leads: &desde=2026-11-01  &estatus=descartado
//
// Acceso: sesión del panel (canAccessCompany) O la URL con clave (&token=…, ver lib/datosPiloto.ts),
// que el middleware deja pasar sin sesión. Piloto: sólo Diamond House.
//
// Se lee de Mongo en vivo y se guarda 10 min por instancia (&refresh=1 lo fuerza). Las respuestas
// van en streaming: el JSON de leads pesa decenas de MB.
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { PassThrough, Readable } from 'node:stream';
import { canAccessCompany } from '@/lib/companyAccess';
import { tieneDatos, tokenValido, datosToken } from '@/lib/datosPiloto';
import { VIGENCIA_DIAS } from '@/lib/datosFoto';
import { base, filasAsesores, filasLeads, filasPropiedades, type Base } from '@/lib/datosExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { t: number; d: Promise<Base> }>();

function cargar(company: string, forzar: boolean): Promise<Base> {
    const c = cache.get(company);
    if (c && !forzar && Date.now() - c.t < CACHE_MS) return c.d;
    const d = base(company);
    cache.set(company, { t: Date.now(), d });
    d.catch(() => cache.delete(company));
    return d;
}

const TIPOS = { propiedades: 'Propiedades', leads: 'Leads', asesores: 'Asesores externos' } as const;
type Tipo = keyof typeof TIPOS;

function jsonStream(meta: Record<string, unknown>, datos: unknown[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let i = -1;
    return new ReadableStream({
        pull(ctrl) {
            if (i === -1) { ctrl.enqueue(enc.encode(JSON.stringify(meta).slice(0, -1) + ',"datos":[')); i = 0; return; }
            if (i >= datos.length) { ctrl.enqueue(enc.encode(']}')); ctrl.close(); return; }
            const fin = Math.min(i + 500, datos.length);
            const trozo = datos.slice(i, fin).map((x) => JSON.stringify(x)).join(',');
            ctrl.enqueue(enc.encode((i ? ',' : '') + trozo));
            i = fin;
        },
    });
}

function xlsxStream(hoja: string, filas: Record<string, unknown>[]): ReadableStream<Uint8Array> {
    const pass = new PassThrough();
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
    const ws = wb.addWorksheet(hoja, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = Object.keys(filas[0] ?? { Vacío: '' });
    ws.columns = cols.map((k) => ({ header: k, key: k, width: Math.min(48, Math.max(12, k.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    (async () => {
        for (const f of filas) ws.addRow(f).commit();
        ws.commit();
        await wb.commit();
    })().catch((e) => pass.destroy(e));
    return Readable.toWeb(pass) as ReadableStream<Uint8Array>;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const company = (q.get('company') || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'company inválido' }, { status: 400 });
    if (!tieneDatos(company)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    const conClave = await tokenValido(company, q.get('token'));
    if (!conClave && !(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    let d: Base;
    try {
        d = await cargar(company, q.get('refresh') === '1');
    } catch (e) {
        console.error('[mb-datos]', e);
        return NextResponse.json({ error: 'no se pudo leer la base' }, { status: 500 });
    }
    const headers = { 'Cache-Control': 'private, no-store' };
    const tipo = q.get('tipo') as Tipo | null;

    if (!tipo) {
        const token = await datosToken(company);
        const raiz = `${req.nextUrl.origin}/api/mb-datos?company=${company}&token=${token}`;
        return NextResponse.json({
            generado: d.generado, asesores_generado: d.asesores_generado, asesores_preparando: d.asesores_preparando, asesores_vigencia_dias: VIGENCIA_DIAS,
            conteos: {
                propiedades: d.propiedades.length, publicadas: d.propiedades.filter((p) => p.estado === 'published').length,
                leads: d.leads.length, asesores: d.asesores.length,
            },
            urls_agente: Object.fromEntries(Object.keys(TIPOS).map((t) => [t, `${raiz}&tipo=${t}`])),
        }, { headers });
    }
    if (!(tipo in TIPOS)) return NextResponse.json({ error: 'tipo inválido (propiedades | leads | asesores)' }, { status: 400 });

    if (tipo === 'asesores' && d.asesores_preparando) {
        return NextResponse.json({ preparando: true, mensaje: 'La base de asesores externos se está preparando (tarda unos minutos la primera vez). Intenta de nuevo en un rato.' }, { status: 503, headers: { ...headers, 'Retry-After': '300' } });
    }
    let datos: unknown[] = tipo === 'propiedades' ? d.propiedades : tipo === 'leads' ? d.leads : d.asesores;
    const estado = q.get('estado'), desde = q.get('desde'), estatus = q.get('estatus');
    // Asesores: &zona=polanco (colonia o municipio) · &con_nosotros=1 · &nivel=cerró
    const zona = q.get('zona')?.toLowerCase(), nivel = q.get('nivel')?.toLowerCase();
    if (tipo === 'asesores' && (zona || nivel || q.get('con_nosotros') === '1')) datos = d.asesores.filter((a) =>
        (!zona || a.patrones.zonas.some((z) => `${z.colonia} ${z.municipio ?? ''}`.toLowerCase().includes(zona)) || a.patrones.municipios.some((m) => m.municipio.toLowerCase().includes(zona)))
        && (!nivel || a.nivel_red.toLowerCase().includes(nivel)) && (q.get('con_nosotros') !== '1' || !!a.contigo.nivel));
    if (tipo === 'propiedades' && estado) datos = d.propiedades.filter((p) => p.estado === estado);
    if (tipo === 'leads' && (desde || estatus)) datos = d.leads.filter((l) => (!desde || String(l.fecha) >= desde) && (!estatus || l.estatus === estatus));

    const generado = tipo === 'asesores' ? d.asesores_generado : d.generado;
    const fecha = (generado ?? d.generado).slice(0, 10);
    const archivo = `diamond-house_${tipo}_${fecha}`;
    if (q.get('formato') === 'xlsx') {
        const filas = tipo === 'propiedades' ? filasPropiedades(datos as Base['propiedades'])
            : tipo === 'leads' ? filasLeads(datos as Base['leads']) : filasAsesores(datos as Base['asesores']);
        return new Response(xlsxStream(TIPOS[tipo], filas), {
            headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${archivo}.xlsx"` },
        });
    }
    const meta = {
        generado, tipo, total: datos.length,
        nota: tipo === 'propiedades' ? 'Sin datos del propietario. productor = asesor que captó; vendedor = asesor a cargo de la venta.'
            : tipo === 'asesores' ? `Brokers externos de toda la red Pulppo (no son asesores de ninguna inmobiliaria Pulppo). Foto que se renueva cada ${VIGENCIA_DIAS} días. contigo = su relación con esta inmobiliaria. patrones = zonas, tipos y presupuesto (MXN, USD × 18.5; típico = percentil 25–75) de TODAS las propiedades de la red por las que preguntó u operó.`
            : undefined,
    };
    const descarga: Record<string, string> = q.get('descargar') === '1' ? { 'Content-Disposition': `attachment; filename="${archivo}.json"` } : {};
    return new Response(jsonStream(meta, datos), { headers: { ...headers, ...descarga, 'Content-Type': 'application/json; charset=utf-8' } });
}
