'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBData, MBProp, RespKey } from '@/lib/mb';
import MBAnalisis from './MBAnalisis';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2; // design system Pulppo: esquinas cuadradas
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
// Media / No competitivo van en negro de marca (el amarillo no se lee sobre blanco; se usa
// como fondo del tag, no como color de texto).
const calidadColor = (c: string) => (c === 'Alta' ? SEA : c === 'Baja' ? RED : BLK);
const vsCell = (v: number | null) => {
    if (v == null) return <span style={{ color: GRY }}>—</span>;
    const col = v > 10 ? RED : v < -5 ? SEA : '#555';
    return <span style={{ color: col, fontWeight: 600 }}>{v > 0 ? '+' : ''}{v.toFixed(0)}%</span>;
};
const DIAG_STYLE: Record<string, { bg: string; fg: string }> = {
    'Bajar precio': { bg: '#F3D9D3', fg: RED },
    'Mejorar ficha': { bg: YEL, fg: BLK },
    'Corregir datos': { bg: '#F3D9D3', fg: RED },
    'Contestar más rápido': { bg: '#DCEBEB', fg: '#2f6b6b' },
    'Convertir a visita': { bg: '#DCEBEB', fg: '#2f6b6b' },
    'Cerrar la visita': { bg: '#DCEBEB', fg: '#2f6b6b' },
    'Compartir similares': { bg: '#DCEBEB', fg: '#2f6b6b' }
};
const diagPill = (t: string) => { const s = DIAG_STYLE[t] ?? { bg: '#DCEBEB', fg: '#2f6b6b' }; return <span key={t} style={{ background: s.bg, color: s.fg, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 2, marginRight: 4, whiteSpace: 'nowrap' }}>{t}</span>; };
// "Media" se leía como promedio, no como intermedia. Ahora los rangos se llaman por lo que
// significan y siempre traen el tiempo a la vista.
const RESP_LBL: Record<RespKey, string> = { flash: 'Flash', rapida: 'Rápida', media: 'Aceptable', lento: 'Fuera de SLA', sin: 'Sin responder' };
const RESP_RANGO: Record<RespKey, string> = { flash: '≤ 5 min', rapida: '≤ 1 hora', media: '≤ 24 horas', lento: '> 24 horas', sin: 'nunca' };
// minutos → texto corto legible
const dur = (m: number | null) => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} días`);

type Section = 'overview' | 'props' | 'analisis' | 'comoleer';
type Seg = '' | 'sinleads' | 'caroSinLeads' | 'visitasSinOferta' | 'mas12' | 'respLenta' | 'muchasVisitas' | 'altaDemanda' | 'ofertasSinCierre'
    | 'sinVideo' | 'pocasFotos' | 'sinAmenidades' | 'sinAcm' | 'sinTour' | 'conErrores';
const SEG_TEST: Record<string, (p: MBProp) => boolean> = {
    sinleads: (p) => p.leads === 0,
    caroSinLeads: (p) => p.leads === 0 && (p.estado === 'Fuera de mercado' || p.estado === 'No competitivo'),
    visitasSinOferta: (p) => p.visitas > 0 && p.ofertas === 0,
    mas12: (p) => (p.mesesPub ?? 0) >= 12,
    respLenta: (p) => p.respMedMin != null && p.respMedMin > 1440,
    muchasVisitas: (p) => p.visitas >= 3 && p.ofertas === 0,
    altaDemanda: (p) => p.op === 'Venta' && p.demanda >= 200 && p.leads <= 1,
    ofertasSinCierre: (p) => p.ofertas > 0 && p.cierres === 0,
    sinVideo: (p) => !p.video,
    pocasFotos: (p) => p.fotos < 8,
    sinAmenidades: (p) => !p.amenidades,
    sinAcm: (p) => p.estado === 'Haz ACM',
    sinTour: (p) => !p.tour,
    conErrores: (p) => p.errores.length > 0
};
// cada hueco de ficha del overview abre el listado ya filtrado
const FALTA_SEG: Record<string, Seg> = { video: 'sinVideo', fotos: 'pocasFotos', amenidades: 'sinAmenidades', acm: 'sinAcm', tour: 'sinTour' };
const SEG_LABEL: Record<string, string> = {
    sinleads: 'Sin leads', caroSinLeads: 'Caro sin leads', visitasSinOferta: 'Visitas sin oferta', mas12: '+12 meses', respLenta: 'Respuesta lenta',
    muchasVisitas: 'Muchas visitas, 0 ofertas', altaDemanda: 'Alta demanda, sin leads', ofertasSinCierre: 'Ofertas sin cierre',
    sinVideo: 'Sin video', pocasFotos: 'Menos de 8 fotos', sinAmenidades: 'Sin amenidades', sinAcm: 'Sin ACM',
    sinTour: 'Sin tour virtual', conErrores: 'Con errores de captura'
};
const CHIP_SEGS: Seg[] = ['sinleads', 'caroSinLeads', 'visitasSinOferta', 'mas12', 'respLenta'];

// Qué hacer con esta propiedad. Además de precio y ficha (que ya venían), acciones de DESEMPEÑO:
// lo que el asesor puede cambiar mañana sin tocar el precio ni volver a fotografiar.
const accionesDe = (p: MBProp): string[] => {
    const a = [...p.diag];
    if (p.errores.length) a.push('Corregir datos');
    if (p.respMedMin != null && p.respMedMin > 1440) a.push('Contestar más rápido');
    if (p.leads >= 5 && p.visitas === 0) a.push('Convertir a visita');
    if (p.visitas >= 3 && p.ofertas === 0) a.push('Cerrar la visita');
    if (p.demanda >= 200 && p.leads === 0) a.push('Compartir similares');
    return a;
};

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ flex: 1, background: '#fff', border: `1px solid ${LGT}`, padding: '13px 15px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 27, lineHeight: 1.05, margin: '8px 0 3px', color: color || BLK }}>{value}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#777', lineHeight: 1.3 }}>{sub}</div>}
        </div>
    );
}

function OpSplit({ venta, renta }: { venta: number; renta: number }) {
    const tot = venta + renta || 1, pv = Math.round((100 * venta) / tot);
    return (
        <div>
            <div style={{ display: 'flex', height: 26, borderRadius: R, overflow: 'hidden', border: `1px solid ${LGT}` }}>
                <div style={{ width: `${pv}%`, background: BLK }} /><div style={{ width: `${100 - pv}%`, background: YEL }} />
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 12 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: BLK, marginRight: 6 }} /><b>{f(venta)}</b> venta · {pv}%</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: YEL, marginRight: 6 }} /><b>{f(renta)}</b> renta · {100 - pv}%</span>
            </div>
        </div>
    );
}

function Funnel({ vistas, leads, respondidos, visitas, ofertas, cierres, respMed, n }:
    { vistas: number; leads: number; respondidos: number; visitas: number; ofertas: number; cierres: number; respMed: number | null; n: number }) {
    const max = Math.max(vistas, leads, respondidos, visitas, ofertas, 1);
    const rate = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    // Respondidos entra en el funnel: es el primer paso que el equipo controla.
    const stages: [string, number, string, string][] = [
        ['Vistas', vistas, GRY, ''],
        ['Leads', leads, SEA, `${rate(leads, vistas)} de vistas`],
        ['Respondidos', respondidos, '#3f8080', `${rate(respondidos, leads)} de leads`],
        ['Visitas', visitas, '#2f6b6b', `${rate(visitas, respondidos)} de respondidos`],
        ['Ofertas', ofertas, BLK, `${rate(ofertas, visitas)} de visitas`],
        ['Cierres', cierres, BLK, `${rate(cierres, visitas)} de visitas`]
    ];
    const kpi = (l: string, v: string, s: string, col?: string) => (
        <div key={l} style={{ flex: 1, background: '#fff', border: `1px solid ${LGT}`, borderRadius: R, padding: '8px 11px', minWidth: 0 }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{l}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, lineHeight: 1.1, color: col || BLK }}>{v}</div>
            <div style={{ fontSize: 9.5, color: GRY }}>{s}</div>
        </div>
    );
    return (
        <div>
            <div style={{ fontSize: 11, color: GRY, marginBottom: 10 }}>Sobre las <b>{f(n)}</b> propiedades filtradas. Tasas contra el paso anterior.</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {kpi('Tasa de respuesta', rate(respondidos, leads), `${f(leads - respondidos)} sin responder`, leads && respondidos / leads < 0.8 ? RED : BLK)}
                {kpi('1ª respuesta (mediana)', dur(respMed), 'meta ≤ 24 horas', respMed != null && respMed > 1440 ? RED : BLK)}
                {kpi('Tasa de visita', rate(visitas, leads), 'visitas ÷ leads')}
                {kpi('Lead → cierre', leads ? `${((100 * cierres) / leads).toFixed(2)}%` : '—', 'cierres ÷ leads')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {stages.map(([lbl, v, c, note]) => (
                    <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 82, fontSize: 12, fontWeight: 600 }}>{lbl}</span>
                        <span style={{ flex: 1, background: '#fff', height: 20, borderRadius: R, overflow: 'hidden', border: `1px solid ${LGT}` }}>
                            <span style={{ display: 'block', height: '100%', width: `${Math.max((100 * v) / max, 1)}%`, background: c }} />
                        </span>
                        <span style={{ width: 66, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{f(v)}</span>
                        <span style={{ width: 108, textAlign: 'right', fontSize: 10, color: GRY }}>{note}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

type Col = { key: keyof MBProp; label: string; num?: boolean };
const COLS: Col[] = [
    { key: 'code', label: 'Código' }, { key: 'type', label: 'Tipo' }, { key: 'asesor', label: 'Asesor' },
    { key: 'op', label: 'Operación' },
    { key: 'colonia', label: 'Colonia' }, { key: 'precio', label: 'Precio', num: true },
    { key: 'vsOferta', label: 'vs. oferta', num: true }, { key: 'vsCierres', label: 'vs. cierres', num: true },
    { key: 'compite', label: 'Compite', num: true }, { key: 'demanda', label: 'Demanda', num: true },
    { key: 'calidad', label: 'Calidad' }, { key: 'dias', label: 'Días', num: true },
    { key: 'vistas', label: 'Vistas', num: true }, { key: 'leads', label: 'Leads', num: true },
    { key: 'respondidos', label: 'Respondidos', num: true },
    { key: 'respMedMin', label: '1ª respuesta', num: true },
    { key: 'visitas', label: 'Visitas', num: true }, { key: 'ofertas', label: 'Ofertas', num: true }
];
// Columnas que se ordenan alfabéticamente (el resto, de mayor a menor).
const TEXT_COLS: (keyof MBProp)[] = ['code', 'type', 'asesor', 'colonia', 'op', 'calidad'];

function PropTable({ d, seg, setSeg }: { d: MBData; seg: Seg; setSeg: (s: Seg) => void }) {
    const [sortKey, setSortKey] = useState<keyof MBProp>('leads');
    const [dir, setDir] = useState<1 | -1>(-1);
    const [q, setQ] = useState('');
    const [op, setOp] = useState('');
    const [estado, setEstado] = useState('');
    const [asesor, setAsesor] = useState('');
    const [tipo, setTipo] = useState('');
    const [colf, setColf] = useState<Record<string, string>>({}); // filtro por columna (texto = contiene · número = ≥)
    const asesores = useMemo(() => [...new Set(d.props.map((p) => p.asesor))].sort(), [d.props]);
    const tipos = useMemo(() => [...new Set(d.props.map((p) => p.type))].filter(Boolean).sort(), [d.props]);

    // filtro de fechas: recalcula vistas/leads/visitas/ofertas del rango (endpoint /api/mb-metrics)
    // Por default el listado (y su funnel) muestra los ÚLTIMOS 30 DÍAS, no el histórico: un
    // acumulado de años no dice nada de cómo va la operación hoy. El filtro lo refleja.
    const [rango, setRango] = useState('Últimos 30 días');
    const [cfrom, setCfrom] = useState('');
    const [cto, setCto] = useState('');
    type Ovr = Record<string, { vistas: number; leads: number; respondidos: number; visitas: number; ofertas: number; cierres: number }>;
    const [ovr, setOvr] = useState<Ovr | null>(null);
    const [rloading, setRloading] = useState(false);
    useEffect(() => {
        const now = new Date();
        let from: Date | null = null; let to: Date = now;
        if (rango === 'Últimos 30 días') from = new Date(Date.now() - 30 * 864e5);
        else if (rango === 'Últimos 90 días') from = new Date(Date.now() - 90 * 864e5);
        else if (rango === 'Este año') from = new Date(now.getFullYear(), 0, 1);
        else if (rango === 'Personalizado' && cfrom && cto) { from = new Date(cfrom); to = new Date(`${cto}T23:59:59`); }
        if (!from) { setOvr(null); return; }
        let cancel = false; setRloading(true);
        fetch('/api/mb-metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: d.companyId, from: from.toISOString(), to: to.toISOString() }) })
            .then((r) => r.json())
            .then((m: { error?: string; leads?: Record<string, number>; respondidos?: Record<string, number>; vistas?: Record<string, number>; visitas?: Record<string, number>; ofertas?: Record<string, number>; cierres?: Record<string, number> }) => {
                if (cancel || m.error) return;
                const o: Ovr = {};
                const ids = new Set([...Object.keys(m.leads || {}), ...Object.keys(m.vistas || {}), ...Object.keys(m.visitas || {}), ...Object.keys(m.ofertas || {}), ...Object.keys(m.cierres || {})]);
                ids.forEach((id) => { o[id] = { vistas: m.vistas?.[id] ?? 0, leads: m.leads?.[id] ?? 0, respondidos: m.respondidos?.[id] ?? 0, visitas: m.visitas?.[id] ?? 0, ofertas: m.ofertas?.[id] ?? 0, cierres: m.cierres?.[id] ?? 0 }; });
                setOvr(o);
            }).finally(() => { if (!cancel) setRloading(false); });
        return () => { cancel = true; };
    }, [rango, cfrom, cto, d.companyId]);
    // props con las métricas del rango (si hay rango); si no, históricas
    const dprops = useMemo(() => ovr ? d.props.map((p) => ({ ...p,
        vistas: ovr[p.id]?.vistas ?? 0, leads: ovr[p.id]?.leads ?? 0, respondidos: ovr[p.id]?.respondidos ?? 0,
        visitas: ovr[p.id]?.visitas ?? 0, ofertas: ovr[p.id]?.ofertas ?? 0, cierres: ovr[p.id]?.cierres ?? 0 })) : d.props, [d.props, ovr]);

    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        return dprops.filter((p) => {
            if (op && p.op !== op) return false;
            if (tipo && p.type !== tipo) return false;
            if (estado && p.estado !== estado) return false;
            if (asesor && p.asesor !== asesor) return false;
            if (ql && !`${p.code} ${p.colonia} ${p.asesor}`.toLowerCase().includes(ql)) return false;
            if (seg && !SEG_TEST[seg](p)) return false;
            for (const c of COLS) {
                const fv = (colf[c.key] ?? '').trim();
                if (!fv) continue;
                const cell = p[c.key];
                if (c.num) {
                    const n = parseFloat(fv.replace(/[^0-9.\-]/g, ''));
                    if (isNaN(n)) continue;
                    // el tiempo de respuesta se busca al revés: "contéstame quién tardó ESTO o menos"
                    const okNum = c.key === 'respMedMin'
                        ? typeof cell === 'number' && cell <= n
                        : typeof cell === 'number' && cell >= n;
                    if (!okNum) return false;
                }
                else if (!String(cell ?? '').toLowerCase().includes(fv.toLowerCase())) return false;
            }
            return true;
        });
    }, [dprops, q, op, tipo, estado, asesor, seg, colf]);

    const rows = useMemo(() => [...filtered].sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        if (typeof va === 'number' || typeof vb === 'number') return dir * (((va as number) ?? -1e15) - ((vb as number) ?? -1e15));
        return dir * String(va ?? '').localeCompare(String(vb ?? ''), 'es');
    }), [filtered, sortKey, dir]);

    const fn = useMemo(() => filtered.reduce((a, p) => ({
        vistas: a.vistas + p.vistas, leads: a.leads + p.leads, respondidos: a.respondidos + p.respondidos,
        visitas: a.visitas + p.visitas, ofertas: a.ofertas + p.ofertas, cierres: a.cierres + p.cierres,
    }), { vistas: 0, leads: 0, respondidos: 0, visitas: 0, ofertas: 0, cierres: 0 }), [filtered]);
    // mediana de las medianas por propiedad (no se pueden promediar medianas)
    const fnRespMed = useMemo(() => {
        const xs = filtered.map((p) => p.respMedMin).filter((x): x is number => x != null).sort((a, b) => a - b);
        return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    }, [filtered]);
    const onSort = (k: keyof MBProp) => { if (k === sortKey) setDir((x) => (x === 1 ? -1 : 1)); else { setSortKey(k); setDir(TEXT_COLS.includes(k) ? 1 : -1); } };
    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const sel: CSSProperties = { fontSize: 12, padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff' };
    const chip = (active: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '6px 11px', borderRadius: R, cursor: 'pointer', border: `1px solid ${active ? BLK : LGT}`, background: active ? BLK : '#fff', color: active ? '#fff' : '#555' });
    const nFiltrosCol = Object.values(colf).filter((v) => v.trim()).length;

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input placeholder="Buscar código, colonia o asesor…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, width: 220 }} />
                <select value={op} onChange={(e) => setOp(e.target.value)} style={sel}><option value="">Operación: todas</option><option>Venta</option><option>Renta</option></select>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={sel}><option value="">Tipo: todos</option>{tipos.map((x) => <option key={x}>{x}</option>)}</select>
                <select value={estado} onChange={(e) => setEstado(e.target.value)} style={sel}><option value="">Precio: todos</option>{['Óptimo', 'No competitivo', 'Fuera de mercado', 'Haz ACM'].map((x) => <option key={x}>{x}</option>)}</select>
                <select value={asesor} onChange={(e) => setAsesor(e.target.value)} style={sel}><option value="">Asesor: todos</option>{asesores.map((x) => <option key={x}>{x}</option>)}</select>
                <select value={rango} onChange={(e) => setRango(e.target.value)} style={sel} title="Ventana de fechas para vistas/leads/visitas/ofertas">{['Todo (histórico)', 'Últimos 30 días', 'Últimos 90 días', 'Este año', 'Personalizado'].map((x) => <option key={x}>{x}</option>)}</select>
                {rango === 'Personalizado' && <><input type="date" value={cfrom} onChange={(e) => setCfrom(e.target.value)} style={sel} /><span style={{ color: GRY, fontSize: 12 }}>→</span><input type="date" value={cto} onChange={(e) => setCto(e.target.value)} style={sel} /></>}
                {rloading && <span style={{ fontSize: 11, color: GRY }}>calculando…</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                {CHIP_SEGS.map((s) => <span key={s} onClick={() => setSeg(seg === s ? '' : s)} style={chip(seg === s)}>{SEG_LABEL[s]}</span>)}
                {seg && !CHIP_SEGS.includes(seg) && <span onClick={() => setSeg('')} style={{ ...chip(true), background: SEA, borderColor: SEA }}>{SEG_LABEL[seg]} ✕</span>}
            </div>

            <div style={{ background: LGT, padding: '14px 16px', borderRadius: R, marginBottom: 16 }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 17, marginBottom: 2 }}>Funnel comercial</div>
                <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>Vistas/leads/visitas/ofertas: <b>{ovr ? rango.toLowerCase() : 'histórico'}</b>.</div>
                <Funnel vistas={fn.vistas} leads={fn.leads} respondidos={fn.respondidos} visitas={fn.visitas} ofertas={fn.ofertas} cierres={fn.cierres} respMed={fnRespMed} n={filtered.length} />
            </div>

            {/* Fila de filtros por columna: va sobre fondo gris claro y con su propio rótulo, para que
                se lea como "filtros" y no como una fila más de datos (feedback: "no se entiende"). */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: BLK }}>Filtrar por columna</span>
                <span style={{ fontSize: 11, color: GRY }}>en texto escribe parte de la palabra · en números el mínimo (ej. <b>3</b> = 3 o más)</span>
                {nFiltrosCol > 0 && (
                    <span onClick={() => setColf({})} style={{ fontSize: 11, color: SEA, fontWeight: 700, cursor: 'pointer' }}>
                        limpiar {nFiltrosCol} {nFiltrosCol === 1 ? 'filtro' : 'filtros'} ✕
                    </span>
                )}
            </div>
            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                    <thead>
                        <tr>{COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? 'right' : 'left' }} onClick={() => onSort(c.key)} title="Clic para ordenar">{c.label}{sortKey === c.key ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>)}<th style={{ ...th, cursor: 'default' }}>Acción</th><th style={{ ...th, textAlign: 'right', cursor: 'default' }}>Reporte</th></tr>
                        <tr>{COLS.map((c) => {
                            const on = !!(colf[c.key] ?? '').trim();
                            return (
                                <th key={c.key} style={{ padding: '4px 6px', borderBottom: `1px solid ${LGT}`, background: LGT }}>
                                    <input value={colf[c.key] ?? ''} onChange={(e) => setColf((s) => ({ ...s, [c.key]: e.target.value }))}
                                        placeholder={c.key === 'respMedMin' ? 'máx. min' : c.num ? 'mín.' : 'contiene…'}
                                        title={c.key === 'respMedMin' ? '1ª respuesta: muestra las que respondieron en ESE número de minutos o menos'
                                            : c.num ? `${c.label}: muestra las que sean mayores o iguales a este número` : `${c.label}: muestra las que contengan este texto`}
                                        style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '3px 5px', border: `1px solid ${on ? SEA : '#e2e2e2'}`, borderRadius: R, textAlign: c.num ? 'right' : 'left', color: BLK, background: '#fff', fontWeight: on ? 700 : 400 }} />
                                </th>
                            );
                        })}<th style={{ borderBottom: `1px solid ${LGT}`, background: LGT }} /><th style={{ borderBottom: `1px solid ${LGT}`, background: LGT }} /></tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.id}>
                                <td style={td}><Link href={`/ficha/${p.id}?v=simple`} target="_blank" style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
                                <td style={td}>{p.type}</td>
                                <td style={td}>{p.asesor}</td><td style={td}>{p.op}</td><td style={{ ...td, color: GRY }}>{p.colonia}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{money(p.precio)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{vsCell(p.vsOferta)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{vsCell(p.vsCierres)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.compite ?? '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.demanda)}</td>
                                <td style={td}><span style={{ color: calidadColor(p.calidad), fontWeight: 600 }}>{p.calidad}</span></td>
                                <td style={{ ...td, textAlign: 'right', color: GRY }}>{p.dias ?? '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.vistas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.leads)}</td>
                                <td style={{ ...td, textAlign: 'right', color: p.leads && p.respondidos < p.leads ? RED : BLK }}>{p.leads ? f(p.respondidos) : ''}</td>
                                <td style={{ ...td, textAlign: 'right', color: p.respMedMin == null ? GRY : p.respMedMin > 1440 ? RED : BLK }}>{dur(p.respMedMin)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.visitas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.ofertas || ''}</td>
                                <td style={td}>{(() => { const t = accionesDe(p); return t.length ? t.map(diagPill) : <span style={{ color: SEA, fontSize: 10.5, fontWeight: 700 }}>OK</span>; })()}</td>
                                <td style={{ ...td, textAlign: 'right' }}><a href={`/ficha/${p.id}?v=simple`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>Abrir ↗</a></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 11, color: GRY, marginTop: 8 }}>{f(rows.length)} de {f(d.nProps)} propiedades</div>
        </div>
    );
}

export default function MBApp({ d }: { d: MBData }) {
    const [section, setSection] = useState<Section>('overview');
    const [seg, setSeg] = useState<Seg>('');
    const goSeg = (s: Seg) => { setSeg(s); setSection('props'); };
    const h2: CSSProperties = { fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 22, margin: '0 0 3px' };
    const sub: CSSProperties = { fontSize: 12, color: GRY, marginBottom: 14 };
    const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY };
    const accent: CSSProperties = { width: 52, height: 2, background: YEL, margin: '9px 0 12px' };
    const nav = (id: Section, label: string) => (
        <div key={id} onClick={() => setSection(id)} style={{ padding: '9px 12px', borderRadius: R, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 2, background: section === id ? BLK : 'transparent', color: section === id ? '#fff' : '#555' }}>{label}</div>
    );

    const cnt = (fn2: (p: MBProp) => boolean) => d.props.filter(fn2).length;
    const answered = d.resp.flash + d.resp.rapida + d.resp.media + d.resp.lento;
    const buckets: RespKey[] = ['flash', 'rapida', 'media', 'lento'];
    const domOf = (r: Record<RespKey, number>) => buckets.reduce((a, b) => (r[b] > r[a] ? b : a), 'flash' as RespKey);
    const domResp = domOf(d.resp), domV = domOf(d.respV), domR = domOf(d.respR);
    const flashPct = answered ? Math.round((100 * d.resp.flash) / answered) : 0;
    const dl = d.leads30 - d.leads30prev;
    const dlPct = d.leads30prev ? Math.round((100 * dl) / d.leads30prev) : null;
    const calDelta = d.calAltaPct - d.benchAltaPct;
    const REDFLAGS: { seg: Seg; tip: string }[] = [
        { seg: 'muchasVisitas', tip: 'Revisa precio y expectativas; refuerza el cierre después de la visita.' },
        { seg: 'altaDemanda', tip: 'Hay compradores buscando: revisa precio, ficha o visibilidad.' },
        { seg: 'ofertasSinCierre', tip: 'Acompaña la negociación con el propietario.' },
        { seg: 'respLenta', tip: 'Acelera la 1ª respuesta; los leads se enfrían rápido.' }
    ];
    const topOpp = d.props.filter((p) => p.op === 'Venta' && p.demanda > 0).sort((a, b) => b.oppScore - a.oppScore).slice(0, 10);
    // asesores de la inmobiliaria (de su inventario publicado) → filtro del reporte
    const asesoresInmo = [...new Set(d.props.map((p) => p.asesor))].filter((a) => a && a !== '—').sort();
    // Rojo por severidad (más banderas primero, luego más leads en juego).
    const redTop = d.asesores.filter((a) => a.red.length > 0)
        .sort((a, b) => b.red.length - a.red.length || b.leads - a.leads).slice(0, 3);
    // Verde SOLO para quien no trae ninguna bandera roja: si alguien cierra pero quema leads,
    // felicitarlo en una columna y señalarlo en la otra deja al dueño sin saber qué hacer.
    const greenTop = d.asesores.filter((a) => a.green.length > 0 && a.red.length === 0)
        .sort((a, b) => b.green.length - a.green.length || b.cierres - a.cierres || b.leads - a.leads).slice(0, 3);
    // El matiz que sí importa: quien produce Y tiene banderas rojas. No es para felicitar ni
    // para regañar, es para arreglarle el proceso porque es el que más tiene en juego.
    const ojoTop = d.asesores.filter((a) => a.red.length > 0 && a.cierres > 0)
        .sort((a, b) => b.cierres - a.cierres || b.leads - a.leads).slice(0, 2);
    const nDest = cnt((p) => p.tier === 'Super' || p.tier === 'Destacado');
    // Los bloques de propiedades van de MAYOR a MENOR volumen: lo que más pesa, primero.
    const porVolumen = <T,>(xs: T[], segOf: (x: T) => string) =>
        [...xs].sort((a, b) => cnt(SEG_TEST[segOf(b)]) - cnt(SEG_TEST[segOf(a)]));
    const chipSegsOrd = porVolumen(CHIP_SEGS, (s) => s as string);
    const redflagsOrd = porVolumen(REDFLAGS, (r) => r.seg as string);

    const tth: CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const ttd: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const heroChip: CSSProperties = { background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.16)', borderRadius: R, padding: '9px 13px', cursor: 'pointer', minWidth: 92 };
    const dfn = (t: string, dd: string) => <div key={t} style={{ padding: '5px 0', borderBottom: `1px solid ${LGT}`, fontSize: 11.5, lineHeight: 1.4 }}><b>{t}</b> — {dd}</div>;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <aside style={{ width: 230, borderRight: `1px solid ${LGT}`, padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
                <div style={{ padding: '0 8px 16px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/pulppo-wordmark-black.png" alt="Pulppo" style={{ height: 22, display: 'block' }} />
                    <div style={{ fontSize: 9, color: GRY, letterSpacing: '.5px', marginTop: 6 }}>MASTER BROKERS</div>
                </div>
                <div style={{ margin: '0 4px 14px', padding: '11px 12px', background: LGT, borderRadius: R }}>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{f(d.nProps)} propiedades publicadas</div>
                </div>
                {nav('overview', 'Overview')}{nav('props', 'Propiedades')}{nav('analisis', 'Generador de análisis')}{nav('comoleer', 'Cómo leer esto')}
                <div style={{ marginTop: 18, padding: '0 8px', fontSize: 9, color: GRY }}>Borrador · datos en vivo</div>
            </aside>

            <main style={{ flex: 1, minWidth: 0, padding: '30px 34px 60px', maxWidth: 1260 }}>
                {section === 'overview' && (
                    <div>
                        <div style={eyebrow}>Overview</div><div style={accent} />
                        <div style={{ background: BLK, color: '#fff', borderRadius: R, padding: '26px 28px' }}>
                            <div style={{ width: 44, height: 2, background: YEL, marginBottom: 14 }} />
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1.15 }}><b style={{ color: YEL }}>{f(cnt((p) => CHIP_SEGS.some((s) => SEG_TEST[s](p))))}</b> propiedades necesitan tu atención.</div>
                            <div style={{ color: '#c9c9c7', fontSize: 13, marginTop: 8, maxWidth: 620 }}>De {f(d.nProps)} publicadas. Prioriza por demanda desperdiciada, precio fuera de mercado y limpieza de cartera. Haz clic en un bloque para verlas.</div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                                {chipSegsOrd.map((s) => (
                                    <div key={s} onClick={() => goSeg(s)} style={heroChip}>
                                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, lineHeight: 1 }}>{f(cnt(SEG_TEST[s]))}</div>
                                        <div style={{ fontSize: 11, color: '#c9c9c7', marginTop: 3 }}>{SEG_LABEL[s]}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* KPIs */}
                        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                            <Kpi label="Inventario activo" value={f(d.nProps)} sub={`${d.nVenta} venta · ${d.nRenta} renta`} />
                            <Kpi label="Leads · últimos 30 días" value={f(d.leads30)} color={dl >= 0 ? SEA : RED}
                                sub={`${dl >= 0 ? '▲' : '▼'} ${dlPct == null ? `${dl >= 0 ? '+' : ''}${f(dl)}` : `${dl >= 0 ? '+' : ''}${dlPct}%`} vs. los 30 días anteriores (${f(d.leads30prev)}) · venta ${f(d.leads30V)} · renta ${f(d.leads30R)}`} />
                            <Kpi label="Sin responder" value={f(d.resp.sin)} color={d.resp.sin > 0 ? RED : SEA} sub={`venta ${f(d.respV.sin)} · renta ${f(d.respR.sin)}`} />
                            <Kpi label="1ª respuesta (mediana)" value={dur(d.respMedMin)}
                                color={d.respMedMin == null ? GRY : d.respMedMin <= 60 ? SEA : d.respMedMin > 1440 ? RED : BLK}
                                sub={`la mitad de tus leads se contesta antes de eso · el grupo más común es ${RESP_LBL[domResp].toLowerCase()} (${RESP_RANGO[domResp]})`} />
                        </div>

                        {/* Venta vs renta */}
                        <h2 style={{ ...h2, marginTop: 28 }}>Venta vs. renta</h2>
                        <div style={sub}>Balance de tu inventario publicado por tipo de operación.</div>
                        <OpSplit venta={d.nVenta} renta={d.nRenta} />

                        {/* Calidad de ficha: bajó de los KPIs de arriba a aquí, con # y % por nivel */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Calidad de tus fichas</h2>
                        <div style={sub}>Cuántas propiedades tienes en cada nivel. Las mejores inmobiliarias de la comunidad traen <b>{d.benchAltaPct}%</b> en Alta{calDelta < 0 ? <> y tú <b style={{ color: BLK }}>{d.calAltaPct}%</b></> : <> y tú <b style={{ color: SEA }}>{d.calAltaPct}%</b></>}.</div>
                        {/* partido venta/renta: en la red la renta trae mucho mejor ficha que la
                            venta, y un total los promedia y esconde el problema */}
                        <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                                <thead><tr>{['', 'Alta', 'Media', 'Baja', 'Total'].map((hh, i) => (
                                    <th key={hh} style={{ ...tth, textAlign: i ? 'right' : 'left' }}>{hh}</th>
                                ))}</tr></thead>
                                <tbody>
                                    {([['Venta', d.calidadVenta], ['Renta', d.calidadRenta], ['Total', d.calidad]] as [string, typeof d.calidad][]).map(([lbl, c]) => {
                                        const pct = (x: number) => (c.total ? `${Math.round((100 * x) / c.total)}%` : '—');
                                        const bold = lbl === 'Total';
                                        return (
                                            <tr key={lbl} style={bold ? { borderTop: `1px solid ${BLK}` } : undefined}>
                                                <td style={{ ...ttd, fontWeight: 700 }}>{lbl}</td>
                                                <td style={{ ...ttd, textAlign: 'right', fontWeight: bold ? 700 : 400 }}><b style={{ color: SEA }}>{f(c.alta)}</b> <span style={{ color: GRY }}>· {pct(c.alta)}</span></td>
                                                <td style={{ ...ttd, textAlign: 'right', fontWeight: bold ? 700 : 400 }}>{f(c.media)} <span style={{ color: GRY }}>· {pct(c.media)}</span></td>
                                                <td style={{ ...ttd, textAlign: 'right', fontWeight: bold ? 700 : 400 }}><b style={{ color: c.baja ? RED : BLK }}>{f(c.baja)}</b> <span style={{ color: GRY }}>· {pct(c.baja)}</span></td>
                                                <td style={{ ...ttd, textAlign: 'right', color: GRY }}>{f(c.total)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ marginTop: 12, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '13px 16px', fontSize: 12.5, color: '#444', lineHeight: 1.55 }}>
                            <b style={{ color: BLK }}>¿Qué le falta a tus propiedades para ser Alta?</b>
                            <div style={{ marginTop: 6 }}>
                                Medimos toda la red Pulppo y el <b>video es el único factor que separa Media de Alta</b>:
                                el 100% de las fichas Alta tiene video, contra 32% de las Media. Fotos, descripción y tour
                                virtual están casi iguales en los tres niveles, así que <b>subir un tour no mejora tu calificación</b>.
                                {' '}Haz clic en cualquiera para ver esas propiedades.
                            </div>
                            <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {([
                                    ['Sin video', 'video', 'la palanca #1', true],
                                    ['Con menos de 8 fotos', 'fotos', 'ayuda a salir de Baja', false],
                                    ['Sin amenidades capturadas', 'amenidades', 'ayuda a salir de Baja', false],
                                    ['Sin ACM', 'acm', 'sin esto no sabes si tu precio compite', false],
                                    ['Sin tour virtual', 'tour', 'no mueve la calidad, es solo referencia', false]
                                ] as [string, keyof typeof d.falta, string, boolean][]).map(([lbl, k, nota, fuerte]) => {
                                    const tot = d.falta[k] as number, v = d.faltaVenta[k] as number, r = d.faltaRenta[k] as number;
                                    const seg = FALTA_SEG[k];
                                    return (
                                        <div key={lbl} onClick={() => seg && goSeg(seg)}
                                            style={{ background: '#fff', border: `1px solid ${fuerte && tot ? YEL : LGT}`, borderRadius: R, padding: '8px 11px', minWidth: 152, cursor: seg && tot ? 'pointer' : 'default' }}>
                                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, color: fuerte && tot ? BLK : GRY }}>{f(tot)}</div>
                                            <div style={{ fontSize: 11, fontWeight: 600 }}>{lbl}{seg && tot ? ' ↗' : ''}</div>
                                            <div style={{ fontSize: 10, color: GRY }}>{f(v)} venta · {f(r)} renta</div>
                                            <div style={{ fontSize: 10, color: GRY }}>{nota}</div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Expediente. Va en su propia fila y NO bajo la pregunta de "para ser
                                Alta": la documentación no mueve la calificación de la ficha, así
                                que mezclarlas afirmaría algo falso. */}
                            <div style={{ marginTop: 14, paddingTop: 11, borderTop: `1px solid ${LGT}` }}>
                                <b style={{ color: BLK }}>Expediente y contacto del propietario</b>
                                <div style={{ fontSize: 11.5, color: GRY, marginTop: 3 }}>
                                    No cambia la calificación de la ficha, pero sin esto la operación se frena cuando llega el momento de cerrar.
                                </div>
                                <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {([
                                        ['Sin ningún documento', 'doc', 'ni escritura, ni contrato, ni identificación'],
                                        ['Sin contrato', 'contrato', 'ni firmado en la plataforma ni escaneado'],
                                        ['Sin datos del propietario', 'propietario', 'sin teléfono ni correo para contactarlo']
                                    ] as [string, keyof typeof d.falta, string][]).map(([lbl, k, nota]) => {
                                        const tot = d.falta[k] as number, v = d.faltaVenta[k] as number, r = d.faltaRenta[k] as number;
                                        return (
                                            <div key={lbl} style={{ background: '#fff', border: `1px solid ${LGT}`, borderRadius: R, padding: '8px 11px', minWidth: 152, flex: 1 }}>
                                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, color: tot ? BLK : GRY }}>{f(tot)}</div>
                                                <div style={{ fontSize: 11, fontWeight: 600 }}>{lbl}</div>
                                                <div style={{ fontSize: 10, color: GRY }}>{f(v)} venta · {f(r)} renta</div>
                                                <div style={{ fontSize: 10, color: GRY }}>{nota}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div style={{ marginTop: 9, fontSize: 11.5 }}>
                                {diagPill('Mejorar ficha')} <span style={{ color: '#666' }}>es el tag que verás en el listado sobre estas mismas propiedades.</span>
                            </div>
                        </div>

                        {/* Focos comerciales (red flags accionables) */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Focos comerciales</h2>
                        <div style={sub}>Patrones accionables. Cada número son propiedades — haz clic para verlas y actuar.</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {redflagsOrd.map((r) => {
                                const n = cnt(SEG_TEST[r.seg as string]);
                                return (
                                    <div key={r.seg} onClick={() => n && goSeg(r.seg)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: `1px solid ${LGT}`, borderRadius: R, padding: '12px 14px', cursor: n ? 'pointer' : 'default' }}>
                                        <b style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, width: 44, color: n > 0 ? RED : GRY }}>{f(n)}</b>
                                        <div><div style={{ fontSize: 13, fontWeight: 700 }}>{SEG_LABEL[r.seg as string]} <span style={{ fontWeight: 400, color: GRY }}>· {n === 1 ? 'propiedad' : 'propiedades'}</span></div><div style={{ fontSize: 11.5, color: '#666', marginTop: 2 }}>{r.tip}{n ? ' ↗' : ''}</div></div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Zonas — la lectura de mercado, ahora también en el overview */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Tus zonas</h2>
                        <div style={sub}>Dónde está tu inventario, cuánto pesas dentro de Pulppo ahí, qué tan grande es el mercado y qué tan competitivo es tu precio. <b>Mercado</b> cuenta cada propiedad <b>una sola vez</b>: el mismo inmueble suele estar repetido en varios portales. <b>vs. oferta</b> y <b>vs. cierres</b> son la <b>mediana</b> contra propiedades comparables. Demanda = búsquedas de {d.demandaLabel}.</div>
                        <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                                <thead><tr>{['Colonia', 'Tus props / Pulppo', 'Mercado en la colonia', 'Demanda', 'Leads', 'vs. oferta', 'vs. cierres'].map((hh, i) => (
                                    <th key={hh} style={{ ...tth, textAlign: i ? 'right' : 'left' }}>{hh}</th>
                                ))}</tr></thead>
                                <tbody>
                                    {d.zonas.map((z) => (
                                        <tr key={z.nb}>
                                            <td style={{ ...ttd, fontWeight: 600 }}>{z.nb}</td>
                                            {/* tuyo / lo que tiene toda la red Pulppo en esa colonia */}
                                            <td style={{ ...ttd, textAlign: 'right' }}
                                                title={z.pulppo ? `Tienes ${f(z.n)} de las ${f(z.pulppo)} propiedades que Pulppo tiene publicadas en ${z.nb} (${Math.round(100 * z.n / z.pulppo)}%). Es tu peso dentro de la red, no dentro del mercado.` : undefined}>
                                                {f(z.n)} <span style={{ color: GRY }}>/ {z.pulppo ? f(z.pulppo) : '—'}</span>
                                            </td>
                                            {/* mercado deduplicado; el bruto queda a la vista para que el número sea auditable */}
                                            <td style={{ ...ttd, textAlign: 'right', color: GRY }}
                                                title={z.oferta && z.ofertaBruta > z.oferta ? `${f(z.ofertaBruta)} anuncios publicados en la colonia, pero muchos son la misma propiedad repetida entre portales y agencias. Contando cada propiedad una sola vez quedan ${f(z.oferta)}. Incluye las de Pulppo: también son mercado.` : undefined}>
                                                {z.oferta ? f(z.oferta) : '—'}
                                                {z.oferta && z.ofertaBruta > z.oferta
                                                    ? <span style={{ fontSize: 10, color: GRY }}> · {f(z.ofertaBruta)} anuncios</span> : null}
                                            </td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{f(z.demanda)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{f(z.leads)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{vsCell(z.vsOferta)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{vsCell(z.vsCierres)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Recap de asesores: flags, no ranking */}
                        {(greenTop.length > 0 || redTop.length > 0) && (
                            <>
                                <h2 style={{ ...h2, marginTop: 30 }}>Cómo va tu equipo</h2>
                                <div style={sub}>Últimos 90 días, solo asesores de tu inmobiliaria con al menos 10 leads. Son <b>señales</b>, no un ranking: alguien puede ser el que más cierra y a la vez estar quemando leads.</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    {([['Lo que va bien', greenTop, SEA], ['Lo que hay que atender', redTop, RED]] as [string, typeof greenTop, string][]).map(([titulo, lista, col]) => (
                                        <div key={titulo} style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${col}`, borderRadius: R, padding: '12px 14px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: col, marginBottom: 8 }}>{titulo}</div>
                                            {lista.length === 0 && <div style={{ fontSize: 12, color: GRY }}>Nada que destacar en esta ventana.</div>}
                                            {lista.map((a) => (
                                                <div key={a.name} style={{ padding: '6px 0', borderBottom: `1px solid ${LGT}` }}>
                                                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{a.name} <span style={{ fontWeight: 400, color: GRY }}>· {f(a.leads)} leads</span></div>
                                                    <div style={{ fontSize: 11.5, color: '#666', marginTop: 1 }}>{(titulo.startsWith('Lo que va') ? a.green : a.red).join(' · ')}</div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                                {ojoTop.length > 0 && (
                                    <div style={{ marginTop: 10, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '11px 14px', fontSize: 12, color: '#555', lineHeight: 1.5 }}>
                                        <b style={{ color: BLK }}>Ojo con estos:</b>{' '}
                                        {ojoTop.map((a, i) => (
                                            <span key={a.name}>{i > 0 && ' · '}<b style={{ color: BLK }}>{a.name}</b> cerró {f(a.cierres)} {a.cierres === 1 ? 'operación' : 'operaciones'} y aun así {a.red[0]}</span>
                                        ))}. Son los que más tienen en juego: no es para regañarlos, es para arreglarles el proceso.
                                    </div>
                                )}
                            </>
                        )}

                        {/* Empieza por aquí */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Empieza por aquí</h2>
                        <div style={sub}>Buena demanda de zona pero sin generar leads, con un freno claro. Demanda = búsquedas de venta de la zona (2026) · Leads = históricos · vs. oferta = tu $/m² contra el asking del <b>MLS</b> en <b>propiedades comparables</b> (mismo tipo, tamaño ±30% y recámaras).</div>
                        <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                                <thead><tr>{['Código', 'Zona', 'Operación', 'Precio', 'vs. oferta', 'Leads', 'Demanda', 'Diagnóstico'].map((h, i) => <th key={h} style={{ ...tth, textAlign: i === 3 || i === 4 || i === 5 || i === 6 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                                <tbody>
                                    {topOpp.map((p) => (
                                        <tr key={p.id}>
                                            <td style={ttd}><Link href={`/ficha/${p.id}?v=simple`} target="_blank" style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
                                            <td style={{ ...ttd, color: GRY }}>{p.colonia}</td><td style={ttd}>{p.op}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{money(p.precio)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{vsCell(p.vsOferta)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{p.leads}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{f(p.demanda)}</td>
                                            <td style={ttd}>{(() => { const a = accionesDe(p); return a.length ? a.map(diagPill) : <span style={{ color: GRY }}>revisar</span>; })()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {/* Errores de CAPTURA, no de venta: una propiedad en $30 o con 7 millones
                            de m² no es un problema comercial, es un dedazo que además rompe todo
                            el análisis de precio de esa propiedad. */}
                        {d.nErrores > 0 && (
                            <>
                                <h2 style={{ ...h2, marginTop: 30 }}>¡Ojo con estas!</h2>
                                <div style={sub}><b>{f(d.nErrores)}</b> {d.nErrores === 1 ? 'propiedad tiene' : 'propiedades tienen'} algo mal capturado. No es que se vendan mal: es que el dato está mal escrito, y mientras siga así esa propiedad no se puede comparar contra el mercado.</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    {d.errores.map((er) => (
                                        <div key={er.tipo} onClick={() => goSeg('conErrores')} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: `1px solid ${LGT}`, borderLeft: `3px solid ${RED}`, borderRadius: R, padding: '12px 14px', cursor: 'pointer' }}>
                                            <b style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, width: 44, color: RED }}>{f(er.n)}</b>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700 }}>{er.tipo} ↗</div>
                                                <div style={{ fontSize: 11.5, color: '#666', marginTop: 2 }}>{er.nota}</div>
                                                {er.ejemplo && <div style={{ fontSize: 11, color: BLK, marginTop: 4, background: LGT, padding: '4px 7px', borderRadius: R }}>Ej. {er.ejemplo}</div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ fontSize: 11, color: GRY, marginTop: 8 }}>Clic para ver la lista completa. Una propiedad puede tener más de un error, por eso la suma de los bloques puede pasar de {f(d.nErrores)}.</div>
                            </>
                        )}

                        <div style={{ marginTop: 30, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '13px 16px', fontSize: 12, color: '#555' }}>
                            Tienes <b>{f(nDest)}</b> propiedades en destacado o súper destacado en Inmuebles24. Estamos trabajando
                            en <b>inventario vs. últimos 6 meses</b> y en la comparativa ampliada contra la comunidad.
                        </div>
                    </div>
                )}

                {section === 'props' && (
                    <div>
                        <div style={eyebrow}>Propiedades</div><div style={accent} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: '0 0 3px' }}>Tu inventario</h1>
                        <div style={sub}>El funnel se recalcula con tus filtros. Haz clic en un encabezado para <b>ordenar</b> y usa la fila gris para <b>filtrar por columna</b>; abre el reporte de cada propiedad desde su código. <b>vs. oferta</b> y <b>vs. cierres</b> comparan tu $/m² contra la <b>mediana</b> de tus comparables (no el promedio). Vistas = sitios de Pulppo + Inmuebles24.</div>
                        <PropTable d={d} seg={seg} setSeg={setSeg} />
                    </div>
                )}

                {section === 'analisis' && (d.companyId === 'demo' ? (
                    /* La cartera demo no existe en Mongo, así que el generador —que sí consulta la
                       base— no puede correr sobre ella. Se avisa en vez de reventar en pantalla. */
                    <div>
                        <div style={eyebrow}>Generador de análisis</div><div style={accent} />
                        <div style={{ marginTop: 14, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '14px 16px', fontSize: 13, maxWidth: 640 }}>
                            <b style={{ color: BLK }}>No disponible en la cartera de ejemplo.</b>
                            <div style={{ marginTop: 6, color: '#555' }}>
                                Esta inmobiliaria es una cartera de ejemplo para mostrar el panel; sus propiedades no existen en la base, así que el generador no tiene de dónde leer. En tu inmobiliaria funciona normal.
                            </div>
                        </div>
                    </div>
                ) : <MBAnalisis companyId={d.companyId} name={d.name} asesores={asesoresInmo} />)}

                {section === 'comoleer' && (
                    <div style={{ maxWidth: 780 }}>
                        <div style={eyebrow}>Metodología</div><div style={accent} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: 0 }}>¿Cómo leer esto?</h1>
                        <div style={sub}>Todo sale de <b>datos en vivo de Pulppo</b>. Aquí de dónde viene cada número.</div>
                        <h2 style={{ ...h2, marginTop: 20 }}>De dónde salen los datos</h2>
                        <div>
                            {dfn('Inventario', 'tus propiedades publicadas en Pulppo (precio, superficie, calidad de ficha, destacado).')}
                            {dfn('Leads', 'contactos reales de todos los canales. Tiempo de 1ª respuesta = answeredAt − createdAt del lead.')}
                            {dfn('Visitas', 'visitantes únicos confirmados (una misma persona no cuenta doble).')}
                            {dfn('Vistas', 'vistas del anuncio en los sitios de Pulppo (pulppo.com y broker.pulppo.com) y en Inmuebles24. NO incluye otros portales (Mercado Libre, propiedades.com, etc.): es lo único que hoy nos reporta vistas.')}
                            {dfn('Demanda', 'búsquedas de compradores en tu zona en los ÚLTIMOS 3 MESES, partidas por operación: a cada propiedad se le asigna la demanda de su operación (venta/renta).')}
                            {dfn('vs. oferta / vs. cierres', 'tu $/m² contra la MEDIANA de tus propiedades COMPARABLES (nunca el promedio: un solo anuncio con precio absurdo lo movería). Comparable = misma colonia, mismo tipo, tamaño ±30% y mismas recámaras. "Oferta" = lo que se PIDE hoy en el MLS completo (Inmuebles24 + otras fuentes) + red Pulppo, con filtro de extremos que descarta $/m² imposibles; "cierres" = lo que realmente se VENDIÓ vía Pulppo (24m) en comparables (solo Pulppo: no hay data de cierres de mercado). Si no hay suficientes comparables, ampliamos el criterio (quitamos recámaras, luego tamaño, luego tipo) hasta juntar al menos 3.')}
                            {dfn('Compite', 'cuántos anuncios COMPARABLES (mismos filtros de arriba) hay hoy en el MLS de la zona. Es tu competencia directa, no todo el inventario de la colonia.')}
                            {dfn('Calidad de ficha', 'clasificación Pulppo (Alta/Media/Baja), siempre partida entre venta y renta porque suelen estar muy desparejas. El benchmark es la media de las mejores inmobiliarias de la comunidad (top 20%). Medimos toda la red y el VIDEO es el único factor que separa Media de Alta: 100% de las Alta lo tiene contra 32% de las Media. Fotos, descripción y tour están casi iguales en los tres niveles, así que subir un tour NO mejora la calificación.')}
                            {dfn('Errores de captura', 'datos evidentemente mal escritos: venta por debajo de $100,000, renta por debajo de $1,000 o arriba de $500,000 al mes, sin superficie, superficie fuera de rango, $/m² imposible, más de 15 recámaras o sin fotos. No es un problema de venta: mientras el dato esté mal, esa propiedad no se puede comparar contra el mercado.')}
                            {dfn('Respondidos', 'leads que sí tienen fecha de primera respuesta. Ojo: esa fecha se llena tarde, así que "sin responder" se encoge con el tiempo; el número estable es cuántos se contestaron fuera de las 24 horas.')}
                        </div>
                        <h2 style={{ ...h2, marginTop: 22 }}>Cómo se leen las secciones</h2>
                        <div>
                            {dfn('Necesitan tu atención', 'propiedades con algún foco (sin leads, caras sin leads, visitas sin oferta, +12 meses, respuesta lenta). Clic → las abre filtradas.')}
                            {dfn('Velocidad de respuesta', 'Flash ≤5 min · Rápida ≤1 h · Aceptable ≤24 h · Fuera de SLA >24 h. Arriba se muestra la MEDIANA (la mitad de tus leads se contesta antes de ese tiempo), no el promedio: unos pocos leads contestados días después destruyen el promedio.')}
                            {dfn('Calidad de tus fichas', 'cuántas propiedades hay en cada nivel, partido venta/renta. Debajo, qué le falta a las que no son Alta; haz clic en cualquiera para ver esa lista.')}
                            {dfn('Tus zonas', 'dónde está tu inventario y qué tan competitivo es tu precio ahí. "Tus props / Pulppo" es cuánto del inventario que la red tiene en esa colonia es tuyo — es tu peso dentro de Pulppo, no dentro del mercado. "Mercado en la colonia" son las propiedades distintas en venta que hay hoy (red Pulppo + MLS de portales), contando cada una una sola vez: el mismo inmueble se re-publica en varios portales y por varias agencias, así que el número de anuncios es bastante mayor. Incluye las de Pulppo, que también son oferta.')}
                            {dfn('Cómo va tu equipo', 'últimos 90 días, solo asesores de tu inmobiliaria y con al menos 10 leads. Son señales, no un ranking: el que más cierra puede a la vez estar quemando leads, y por eso aparece en "ojo con estos" en vez de en la columna verde.')}
                            {dfn('Empieza por aquí', 'ordenado por oportunidad (demanda ÷ (1+leads)). El diagnóstico dice el freno más probable (bajar precio / mejorar ficha).')}
                            {dfn('¡Ojo con estas!', 'propiedades con errores de captura. Una propiedad puede tener más de un error, por eso la suma de los bloques puede pasar del total.')}
                            {dfn('Tu inventario (listado)', 'por default muestra los ÚLTIMOS 30 DÍAS; cámbialo en el filtro de fechas si quieres otra ventana. La fila gris debajo de los encabezados filtra por columna: en las de texto escribe parte de la palabra, en las de número el mínimo (3 = 3 o más), salvo "1ª respuesta" donde es el máximo. Clic en un encabezado ordena.')}
                            {dfn('Acción', 'qué hacer con esa propiedad. De precio y ficha (bajar precio, mejorar ficha, corregir datos) y de desempeño (contestar más rápido, convertir a visita, cerrar la visita, compartir con clientes).')}
                            {dfn('Generador de análisis', 'las fechas van en dos bloques. DESEMPEÑO = tu operación (funnel, asesores, leads, sin actividad): un período y contra qué compararlo. COMPARABLES = el mercado (cierres mín. 6 meses, demanda mín. 1 mes); la oferta es siempre foto de hoy porque no se guarda su historia.')}
                        </div>
                        <div style={{ fontSize: 10, color: GRY, marginTop: 18 }}>Corte: hoy, datos en vivo. Borrador.</div>
                    </div>
                )}
            </main>
        </div>
    );
}
