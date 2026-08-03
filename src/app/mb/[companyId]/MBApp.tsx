'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBData, MBProp, RespKey } from '@/lib/mb';
import MBAnalisis from './MBAnalisis';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2; // design system Pulppo: esquinas cuadradas
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
const calidadColor = (c: string) => (c === 'Alta' ? SEA : c === 'Baja' ? RED : '#8a6d00'); // Media = ámbar
const vsCell = (v: number | null) => {
    if (v == null) return <span style={{ color: GRY }}>—</span>;
    const col = v > 10 ? RED : v < -5 ? SEA : '#555';
    return <span style={{ color: col, fontWeight: 600 }}>{v > 0 ? '+' : ''}{v.toFixed(0)}%</span>;
};
const DIAG_STYLE: Record<string, { bg: string; fg: string }> = { 'Bajar precio': { bg: '#F3D9D3', fg: RED }, 'Mejorar ficha': { bg: '#FBF0CC', fg: '#8a6d00' } };
const diagPill = (t: string) => { const s = DIAG_STYLE[t] ?? { bg: '#DCEBEB', fg: '#2f6b6b' }; return <span key={t} style={{ background: s.bg, color: s.fg, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 11, marginRight: 4, whiteSpace: 'nowrap' }}>{t}</span>; };
const RESP_LBL: Record<RespKey, string> = { flash: 'Flash', rapida: 'Rápida', media: 'Media', lento: 'Lento', sin: 'Sin responder' };

type Section = 'overview' | 'props' | 'analisis' | 'comoleer';
type Seg = '' | 'sinleads' | 'caroSinLeads' | 'visitasSinOferta' | 'mas12' | 'respLenta' | 'muchasVisitas' | 'altaDemanda' | 'ofertasSinCierre';
const SEG_TEST: Record<string, (p: MBProp) => boolean> = {
    sinleads: (p) => p.leads === 0,
    caroSinLeads: (p) => p.leads === 0 && (p.estado === 'Fuera de mercado' || p.estado === 'No competitivo'),
    visitasSinOferta: (p) => p.visitas > 0 && p.ofertas === 0,
    mas12: (p) => (p.mesesPub ?? 0) >= 12,
    respLenta: (p) => p.respMedMin != null && p.respMedMin > 1440,
    muchasVisitas: (p) => p.visitas >= 3 && p.ofertas === 0,
    altaDemanda: (p) => p.op === 'Venta' && p.demanda >= 200 && p.leads <= 1,
    ofertasSinCierre: (p) => p.ofertas > 0 && p.cierres === 0
};
const SEG_LABEL: Record<string, string> = {
    sinleads: 'Sin leads', caroSinLeads: 'Caro sin leads', visitasSinOferta: 'Visitas sin oferta', mas12: '+12 meses', respLenta: 'Respuesta lenta',
    muchasVisitas: 'Muchas visitas, 0 ofertas', altaDemanda: 'Alta demanda, sin leads', ofertasSinCierre: 'Ofertas sin cierre'
};
const CHIP_SEGS: Seg[] = ['sinleads', 'caroSinLeads', 'visitasSinOferta', 'mas12', 'respLenta'];

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

function Funnel({ vistas, leads, visitas, ofertas, n }: { vistas: number; leads: number; visitas: number; ofertas: number; n: number }) {
    const max = Math.max(vistas, leads, visitas, ofertas, 1);
    const rate = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    const stages: [string, number, string, string][] = [
        ['Vistas', vistas, GRY, ''], ['Leads', leads, SEA, `${rate(leads, vistas)} de vistas`],
        ['Visitas', visitas, '#2f6b6b', `${rate(visitas, leads)} de leads`], ['Ofertas', ofertas, BLK, `${rate(ofertas, visitas)} de visitas`]
    ];
    return (
        <div>
            <div style={{ fontSize: 11, color: GRY, marginBottom: 10 }}>Sobre las <b>{f(n)}</b> propiedades filtradas. Tasas contra el paso anterior.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {stages.map(([lbl, v, c, note]) => (
                    <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 60, fontSize: 12, fontWeight: 600 }}>{lbl}</span>
                        <span style={{ flex: 1, background: '#fff', height: 20, borderRadius: R, overflow: 'hidden', border: `1px solid ${LGT}` }}>
                            <span style={{ display: 'block', height: '100%', width: `${Math.max((100 * v) / max, 1)}%`, background: c }} />
                        </span>
                        <span style={{ width: 66, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{f(v)}</span>
                        <span style={{ width: 84, textAlign: 'right', fontSize: 10, color: GRY }}>{note}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

type Col = { key: keyof MBProp; label: string; num?: boolean };
const COLS: Col[] = [
    { key: 'code', label: 'Código' }, { key: 'asesor', label: 'Asesor' }, { key: 'op', label: 'Operación' },
    { key: 'colonia', label: 'Colonia' }, { key: 'precio', label: 'Precio', num: true },
    { key: 'vsOferta', label: 'vs. oferta', num: true }, { key: 'vsCierres', label: 'vs. cierres', num: true },
    { key: 'compite', label: 'Compite', num: true }, { key: 'demanda', label: 'Demanda', num: true },
    { key: 'calidad', label: 'Calidad' }, { key: 'tier', label: 'Destacado' }, { key: 'dias', label: 'Días', num: true },
    { key: 'vistas', label: 'Vistas', num: true }, { key: 'leads', label: 'Leads', num: true },
    { key: 'visitas', label: 'Visitas', num: true }, { key: 'ofertas', label: 'Ofertas', num: true }
];

function PropTable({ d, seg, setSeg }: { d: MBData; seg: Seg; setSeg: (s: Seg) => void }) {
    const [sortKey, setSortKey] = useState<keyof MBProp>('leads');
    const [dir, setDir] = useState<1 | -1>(-1);
    const [q, setQ] = useState('');
    const [op, setOp] = useState('');
    const [estado, setEstado] = useState('');
    const [asesor, setAsesor] = useState('');
    const [colf, setColf] = useState<Record<string, string>>({}); // filtro por columna (texto = contiene · número = ≥)
    const asesores = useMemo(() => [...new Set(d.props.map((p) => p.asesor))].sort(), [d.props]);

    // filtro de fechas: recalcula vistas/leads/visitas/ofertas del rango (endpoint /api/mb-metrics)
    const [rango, setRango] = useState('Todo (histórico)');
    const [cfrom, setCfrom] = useState('');
    const [cto, setCto] = useState('');
    type Ovr = Record<string, { vistas: number; leads: number; visitas: number; ofertas: number }>;
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
            .then((m: { error?: string; leads?: Record<string, number>; vistas?: Record<string, number>; visitas?: Record<string, number>; ofertas?: Record<string, number> }) => {
                if (cancel || m.error) return;
                const o: Ovr = {}; const ids = new Set([...Object.keys(m.leads || {}), ...Object.keys(m.vistas || {}), ...Object.keys(m.visitas || {}), ...Object.keys(m.ofertas || {})]);
                ids.forEach((id) => { o[id] = { vistas: m.vistas?.[id] ?? 0, leads: m.leads?.[id] ?? 0, visitas: m.visitas?.[id] ?? 0, ofertas: m.ofertas?.[id] ?? 0 }; });
                setOvr(o);
            }).finally(() => { if (!cancel) setRloading(false); });
        return () => { cancel = true; };
    }, [rango, cfrom, cto, d.companyId]);
    // props con las métricas del rango (si hay rango); si no, históricas
    const dprops = useMemo(() => ovr ? d.props.map((p) => ({ ...p, vistas: ovr[p.id]?.vistas ?? 0, leads: ovr[p.id]?.leads ?? 0, visitas: ovr[p.id]?.visitas ?? 0, ofertas: ovr[p.id]?.ofertas ?? 0 })) : d.props, [d.props, ovr]);

    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        return dprops.filter((p) => {
            if (op && p.op !== op) return false;
            if (estado && p.estado !== estado) return false;
            if (asesor && p.asesor !== asesor) return false;
            if (ql && !`${p.code} ${p.colonia} ${p.asesor}`.toLowerCase().includes(ql)) return false;
            if (seg && !SEG_TEST[seg](p)) return false;
            for (const c of COLS) {
                const fv = (colf[c.key] ?? '').trim();
                if (!fv) continue;
                const cell = p[c.key];
                if (c.num) { const n = parseFloat(fv.replace(/[^0-9.\-]/g, '')); if (isNaN(n)) continue; if (!(typeof cell === 'number' && cell >= n)) return false; }
                else if (!String(cell ?? '').toLowerCase().includes(fv.toLowerCase())) return false;
            }
            return true;
        });
    }, [dprops, q, op, estado, asesor, seg, colf]);

    const rows = useMemo(() => [...filtered].sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        if (typeof va === 'number' || typeof vb === 'number') return dir * (((va as number) ?? -1e15) - ((vb as number) ?? -1e15));
        return dir * String(va ?? '').localeCompare(String(vb ?? ''), 'es');
    }), [filtered, sortKey, dir]);

    const fn = useMemo(() => filtered.reduce((a, p) => ({ vistas: a.vistas + p.vistas, leads: a.leads + p.leads, visitas: a.visitas + p.visitas, ofertas: a.ofertas + p.ofertas }), { vistas: 0, leads: 0, visitas: 0, ofertas: 0 }), [filtered]);
    const onSort = (k: keyof MBProp) => { if (k === sortKey) setDir((x) => (x === 1 ? -1 : 1)); else { setSortKey(k); setDir(k === 'code' || k === 'asesor' || k === 'colonia' || k === 'op' || k === 'calidad' || k === 'tier' ? 1 : -1); } };
    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const sel: CSSProperties = { fontSize: 12, padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff' };
    const chip = (active: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '6px 11px', borderRadius: R, cursor: 'pointer', border: `1px solid ${active ? BLK : LGT}`, background: active ? BLK : '#fff', color: active ? '#fff' : '#555' });

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input placeholder="Buscar código, colonia o asesor…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, width: 220 }} />
                <select value={op} onChange={(e) => setOp(e.target.value)} style={sel}><option value="">Operación: todas</option><option>Venta</option><option>Renta</option></select>
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
                <Funnel vistas={fn.vistas} leads={fn.leads} visitas={fn.visitas} ofertas={fn.ofertas} n={filtered.length} />
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                    <thead>
                        <tr>{COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? 'right' : 'left' }} onClick={() => onSort(c.key)}>{c.label}{sortKey === c.key ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>)}<th style={{ ...th, textAlign: 'right', cursor: 'default' }}>Reporte</th></tr>
                        <tr>{COLS.map((c) => <th key={c.key} style={{ padding: '3px 6px', borderBottom: `1px solid ${LGT}`, background: '#fff' }}><input value={colf[c.key] ?? ''} onChange={(e) => setColf((s) => ({ ...s, [c.key]: e.target.value }))} placeholder={c.num ? '≥' : 'filtrar'} style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '3px 5px', border: `1px solid ${LGT}`, borderRadius: R, textAlign: c.num ? 'right' : 'left', color: BLK }} /></th>)}<th style={{ borderBottom: `1px solid ${LGT}`, background: '#fff' }} /></tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.id}>
                                <td style={td}><Link href={`/ficha/${p.id}?v=simple`} target="_blank" style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
                                <td style={td}>{p.asesor}</td><td style={td}>{p.op}</td><td style={{ ...td, color: GRY }}>{p.colonia}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{money(p.precio)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{vsCell(p.vsOferta)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{vsCell(p.vsCierres)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.compite ?? '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.demanda)}</td>
                                <td style={td}><span style={{ color: calidadColor(p.calidad), fontWeight: 600 }}>{p.calidad}</span></td>
                                <td style={{ ...td, color: p.tier === 'Super' || p.tier === 'Destacado' ? SEA : GRY }}>{p.tier}</td>
                                <td style={{ ...td, textAlign: 'right', color: GRY }}>{p.dias ?? '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.vistas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.leads)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.visitas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.ofertas || ''}</td>
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
    const calDelta = d.calAltaPct - d.benchAltaPct;
    const REDFLAGS: { seg: Seg; tip: string }[] = [
        { seg: 'muchasVisitas', tip: 'Revisa precio y expectativas; refuerza el cierre después de la visita.' },
        { seg: 'altaDemanda', tip: 'Hay compradores buscando: revisa precio, ficha o visibilidad.' },
        { seg: 'ofertasSinCierre', tip: 'Acompaña la negociación con el propietario.' },
        { seg: 'respLenta', tip: 'Acelera la 1ª respuesta; los leads se enfrían rápido.' }
    ];
    const topOpp = d.props.filter((p) => p.op === 'Venta' && p.demanda > 0).sort((a, b) => b.oppScore - a.oppScore).slice(0, 10);
    const nDest = cnt((p) => p.tier === 'Super' || p.tier === 'Destacado');

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
                                {CHIP_SEGS.map((s) => (
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
                            <Kpi label="Calidad de ficha" value={`${d.calAltaPct}% Alta`} color={calDelta < 0 ? '#8a6d00' : SEA} sub={`venta ${d.calAltaVenta}% · renta ${d.calAltaRenta}% · mejores* ${d.benchAltaPct}%`} />
                            <Kpi label="Leads · 30 días" value={f(d.leads30)} color={dl >= 0 ? SEA : RED} sub={`venta ${f(d.leads30V)} · renta ${f(d.leads30R)} · ${dl >= 0 ? '▲' : '▼'} vs. previos`} />
                            <Kpi label="Respuesta" value={f(d.resp.sin)} color={d.resp.sin > 0 ? RED : SEA} sub={`sin responder · venta ${f(d.respV.sin)} · renta ${f(d.respR.sin)}`} />
                            <Kpi label="Velocidad de respuesta" value={RESP_LBL[domResp]} color={domResp === 'flash' || domResp === 'rapida' ? SEA : domResp === 'lento' ? RED : '#8a6d00'} sub={`venta ${RESP_LBL[domV]} · renta ${RESP_LBL[domR]}`} />
                        </div>
                        <div style={{ fontSize: 10, color: GRY, marginTop: 6 }}>*media de las mejores inmobiliarias de la comunidad (top 20% por calidad).</div>

                        {/* Venta vs renta */}
                        <h2 style={{ ...h2, marginTop: 28 }}>Venta vs. renta</h2>
                        <div style={sub}>Balance de tu inventario publicado por tipo de operación.</div>
                        <OpSplit venta={d.nVenta} renta={d.nRenta} />

                        {/* Focos comerciales (red flags accionables) */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Focos comerciales</h2>
                        <div style={sub}>Patrones accionables. Cada número son propiedades — haz clic para verlas y actuar.</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {REDFLAGS.map((r) => {
                                const n = cnt(SEG_TEST[r.seg as string]);
                                return (
                                    <div key={r.seg} onClick={() => n && goSeg(r.seg)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: `1px solid ${LGT}`, borderRadius: R, padding: '12px 14px', cursor: n ? 'pointer' : 'default' }}>
                                        <b style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, width: 44, color: n > 0 ? RED : GRY }}>{f(n)}</b>
                                        <div><div style={{ fontSize: 13, fontWeight: 700 }}>{SEG_LABEL[r.seg as string]} <span style={{ fontWeight: 400, color: GRY }}>· {n === 1 ? 'propiedad' : 'propiedades'}</span></div><div style={{ fontSize: 11.5, color: '#666', marginTop: 2 }}>{r.tip}{n ? ' ↗' : ''}</div></div>
                                    </div>
                                );
                            })}
                        </div>

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
                                            <td style={ttd}>{p.diag.length ? p.diag.map(diagPill) : <span style={{ color: GRY }}>revisar</span>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ marginTop: 30, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '13px 16px', fontSize: 12, color: '#555' }}>
                            Tienes <b>{f(nDest)}</b> propiedades en destacado/súper. Estamos afinando el criterio de <b>swaps de destacado</b>
                            {' '}(qué aviso conviene mover según precio, oferta, demanda y calidad — no solo si recibe leads) y estará aquí pronto,
                            {' '}junto con <b>inventario vs. últimos 6 meses</b> y la comparativa ampliada vs. la comunidad.
                        </div>
                    </div>
                )}

                {section === 'props' && (
                    <div>
                        <div style={eyebrow}>Propiedades</div><div style={accent} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: '0 0 3px' }}>Tu inventario</h1>
                        <div style={sub}>El funnel se recalcula con tus filtros. Ordena o <b>filtra por cualquier columna</b> (texto = contiene · números = ≥) y abre el reporte desde el código. Vistas = sitios de Pulppo + Inmuebles24.</div>
                        <PropTable d={d} seg={seg} setSeg={setSeg} />
                    </div>
                )}

                {section === 'analisis' && <MBAnalisis companyId={d.companyId} name={d.name} />}

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
                            {dfn('Demanda', 'búsquedas de compradores en tu zona (2026), partidas por operación: a cada propiedad se le asigna la demanda de su operación (venta/renta).')}
                            {dfn('vs. oferta / vs. cierres', 'tu $/m² contra propiedades COMPARABLES: misma colonia, mismo tipo, tamaño ±30% y mismas recámaras. "Oferta" = asking mediano del MLS de esos comparables; "cierres" = lo que cerró Pulppo (24m) en comparables. Si no hay suficientes comparables, ampliamos el criterio (quitamos recámaras, luego tamaño, luego tipo) hasta juntar al menos 3.')}
                            {dfn('Compite', 'cuántos anuncios COMPARABLES (mismos filtros de arriba) hay hoy en el MLS de la zona. Es tu competencia directa, no todo el inventario de la colonia.')}
                            {dfn('Calidad de ficha', 'clasificación Pulppo (Alta/Media/Baja). El benchmark es la media de las mejores inmobiliarias de la comunidad (top 20%).')}
                            {dfn('Destacado', 'nivel informativo del aviso en Inmuebles24 (Súper / Destacado / Simple / Offline). Solo referencia; aquí no recomendamos aún qué destacar.')}
                        </div>
                        <h2 style={{ ...h2, marginTop: 22 }}>Cómo se leen las secciones</h2>
                        <div>
                            {dfn('Necesitan tu atención', 'propiedades con algún foco (sin leads, caras sin leads, visitas sin oferta, +12 meses, respuesta lenta). Clic → las abre filtradas.')}
                            {dfn('Velocidad de respuesta', 'Flash ≤5 min · Rápida ≤1 h · Media ≤24 h · Lento >24 h. "Respuesta" muestra los leads que siguen sin responder.')}
                            {dfn('Empieza por aquí', 'ordenado por oportunidad (demanda ÷ (1+leads)). El diagnóstico dice el freno más probable (bajar precio / mejorar ficha).')}
                        </div>
                        <div style={{ fontSize: 10, color: GRY, marginTop: 18 }}>Corte: hoy, datos en vivo. Borrador.</div>
                    </div>
                )}
            </main>
        </div>
    );
}
