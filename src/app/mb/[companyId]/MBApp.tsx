'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBData, MBProp, RespKey } from '@/lib/mb';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2; // design system Pulppo: esquinas cuadradas
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
const calidadColor = (c: string) => (c === 'Alta' ? SEA : c === 'Baja' ? RED : '#666');
const vsCell = (v: number | null) => {
    if (v == null) return <span style={{ color: GRY }}>—</span>;
    const col = v > 10 ? RED : v < -5 ? SEA : '#555';
    return <span style={{ color: col, fontWeight: 600 }}>{v > 0 ? '+' : ''}{v.toFixed(0)}%</span>;
};

type Section = 'overview' | 'props' | 'analisis';
type Seg = '' | 'sinleads' | 'caroSinLeads' | 'visitasSinOferta' | 'mas12' | 'respLenta';
const CHIPS: { seg: Exclude<Seg, ''>; label: string; test: (p: MBProp) => boolean }[] = [
    { seg: 'sinleads', label: 'Sin leads', test: (p) => p.leads === 0 },
    { seg: 'caroSinLeads', label: 'Caro sin leads', test: (p) => p.leads === 0 && (p.estado === 'Fuera de mercado' || p.estado === 'No competitivo') },
    { seg: 'visitasSinOferta', label: 'Visitas sin oferta', test: (p) => p.visitas > 0 && p.ofertas === 0 },
    { seg: 'mas12', label: '+12 meses', test: (p) => (p.mesesPub ?? 0) >= 12 },
    { seg: 'respLenta', label: 'Respuesta lenta', test: (p) => p.respMedMin != null && p.respMedMin > 1440 }
];
const CHIP_TEST: Record<string, (p: MBProp) => boolean> = Object.fromEntries(CHIPS.map((c) => [c.seg, c.test]));
const RESP_LBL: Record<RespKey, string> = { flash: 'Flash', rapida: 'Rápida', media: 'Media', lento: 'Lento', sin: 'Sin responder' };

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ flex: 1, background: '#fff', border: `1px solid ${LGT}`, padding: '14px 16px', borderRadius: R }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1.05, margin: '8px 0 3px', color: color || BLK }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: '#777' }}>{sub}</div>}
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
    { key: 'calidad', label: 'Calidad' }, { key: 'dias', label: 'Días', num: true },
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
    const asesores = useMemo(() => [...new Set(d.props.map((p) => p.asesor))].sort(), [d.props]);

    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        return d.props.filter((p) => {
            if (op && p.op !== op) return false;
            if (estado && p.estado !== estado) return false;
            if (asesor && p.asesor !== asesor) return false;
            if (ql && !`${p.code} ${p.colonia} ${p.asesor}`.toLowerCase().includes(ql)) return false;
            if (seg && !CHIP_TEST[seg](p)) return false;
            return true;
        });
    }, [d.props, q, op, estado, asesor, seg]);

    const rows = useMemo(() => [...filtered].sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        if (typeof va === 'number' || typeof vb === 'number') return dir * (((va as number) ?? -1e15) - ((vb as number) ?? -1e15));
        return dir * String(va ?? '').localeCompare(String(vb ?? ''), 'es');
    }), [filtered, sortKey, dir]);

    const fn = useMemo(() => filtered.reduce((a, p) => ({ vistas: a.vistas + p.vistas, leads: a.leads + p.leads, visitas: a.visitas + p.visitas, ofertas: a.ofertas + p.ofertas }), { vistas: 0, leads: 0, visitas: 0, ofertas: 0 }), [filtered]);
    const onSort = (k: keyof MBProp) => { if (k === sortKey) setDir((x) => (x === 1 ? -1 : 1)); else { setSortKey(k); setDir(k === 'code' || k === 'asesor' || k === 'colonia' || k === 'op' || k === 'calidad' ? 1 : -1); } };
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
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {CHIPS.map((c) => <span key={c.seg} onClick={() => setSeg(seg === c.seg ? '' : c.seg)} style={chip(seg === c.seg)}>{c.label}</span>)}
            </div>

            <div style={{ background: LGT, padding: '14px 16px', borderRadius: R, marginBottom: 16 }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 17, marginBottom: 6 }}>Funnel comercial</div>
                <Funnel vistas={fn.vistas} leads={fn.leads} visitas={fn.visitas} ofertas={fn.ofertas} n={filtered.length} />
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                    <thead><tr>{COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? 'right' : 'left' }} onClick={() => onSort(c.key)}>{c.label}{sortKey === c.key ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>)}<th style={{ ...th, textAlign: 'right', cursor: 'default' }}>Reporte</th></tr></thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.id}>
                                <td style={td}><Link href={`/ficha/${p.id}`} target="_blank" style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
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
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.visitas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.ofertas || ''}</td>
                                <td style={{ ...td, textAlign: 'right' }}><a href={`/ficha/${p.id}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>Abrir ↗</a></td>
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

    // overview derivados
    const cnt = (fn2: (p: MBProp) => boolean) => d.props.filter(fn2).length;
    const atencion = cnt((p) => CHIPS.some((c) => c.test(p)));
    const answered = d.resp.flash + d.resp.rapida + d.resp.media + d.resp.lento;
    const buckets: RespKey[] = ['flash', 'rapida', 'media', 'lento'];
    const domResp = buckets.reduce((a, b) => (d.resp[b] > d.resp[a] ? b : a), 'flash' as RespKey);
    const flashPct = answered ? Math.round((100 * d.resp.flash) / answered) : 0;
    const dl = d.leads30 - d.leads30prev;
    const calDelta = d.calAltaPct - d.benchAltaPct;
    const redflags: [string, number, string][] = [
        ['Muchas visitas, 0 ofertas', cnt((p) => p.visitas >= 3 && p.ofertas === 0), 'precio, producto o expectativas'],
        ['Alta demanda, pocos leads', cnt((p) => p.op === 'Venta' && p.demanda >= 200 && p.leads <= 1), 'precio, ficha o visibilidad'],
        ['Ofertas sin cierre', cnt((p) => p.ofertas > 0 && p.cierres === 0), 'negociación / propietario / precio'],
        ['Respuesta lenta', cnt((p) => p.respMedMin != null && p.respMedMin > 1440), 'gestión del funnel']
    ];
    const topOpp = d.props.filter((p) => p.op === 'Venta' && p.demanda > 0).sort((a, b) => b.oppScore - a.oppScore).slice(0, 10);
    const tth: CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const ttd: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const heroChip: CSSProperties = { background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.16)', borderRadius: R, padding: '9px 13px', cursor: 'pointer', minWidth: 92 };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <aside style={{ width: 230, borderRight: `1px solid ${LGT}`, padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 16px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/pulppo-icon.png" alt="Pulppo" style={{ width: 24 }} />
                    <div><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 16, lineHeight: 1 }}>Pulppo</div><div style={{ fontSize: 9, color: GRY, letterSpacing: '.5px' }}>MASTER BROKERS</div></div>
                </div>
                <div style={{ margin: '0 4px 14px', padding: '11px 12px', background: LGT, borderRadius: R }}>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{f(d.nProps)} propiedades publicadas</div>
                </div>
                {nav('overview', 'Overview')}{nav('props', 'Propiedades')}{nav('analisis', 'Generador de análisis')}
                <div style={{ marginTop: 18, padding: '0 8px', fontSize: 9, color: GRY }}>Borrador · datos en vivo</div>
            </aside>

            <main style={{ flex: 1, minWidth: 0, padding: '30px 34px 60px', maxWidth: 1220 }}>
                {section === 'overview' && (
                    <div>
                        <div style={eyebrow}>Overview</div><div style={accent} />
                        {/* Hero + chips */}
                        <div style={{ background: BLK, color: '#fff', borderRadius: R, padding: '26px 28px' }}>
                            <div style={{ width: 44, height: 2, background: YEL, marginBottom: 14 }} />
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1.15 }}><b style={{ color: YEL }}>{f(atencion)}</b> propiedades necesitan tu atención.</div>
                            <div style={{ color: '#c9c9c7', fontSize: 13, marginTop: 8, maxWidth: 620 }}>De {f(d.nProps)} publicadas. Prioriza por demanda desperdiciada, precio fuera de mercado y limpieza de cartera. Haz clic en un bloque para verlas.</div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                                {CHIPS.map((c) => (
                                    <div key={c.seg} onClick={() => goSeg(c.seg)} style={heroChip}>
                                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, lineHeight: 1 }}>{f(cnt(c.test))}</div>
                                        <div style={{ fontSize: 11, color: '#c9c9c7', marginTop: 3 }}>{c.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* KPIs */}
                        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                            <Kpi label="Inventario activo" value={f(d.nProps)} sub={`${d.nVenta} venta · ${d.nRenta} renta · vs. 2025 próximamente`} />
                            <Kpi label="Calidad de ficha" value={`${d.calAltaPct}% Alta`} color={calDelta < 0 ? '#8a6d00' : SEA} sub={`comunidad ${d.benchAltaPct}% (top 20%) · ${calDelta >= 0 ? '+' : ''}${calDelta} pts`} />
                            <Kpi label="Leads · 30 días" value={f(d.leads30)} color={dl >= 0 ? SEA : RED} sub={`${dl >= 0 ? '▲' : '▼'} vs. 30 días previos (${f(d.leads30prev)})`} />
                            <Kpi label="Velocidad de respuesta" value={RESP_LBL[domResp]} color={domResp === 'flash' || domResp === 'rapida' ? SEA : domResp === 'lento' ? RED : '#8a6d00'} sub={`${flashPct}% Flash (≤5 min) · ${d.resp.sin} sin responder`} />
                        </div>

                        {/* Venta vs renta */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Venta vs. renta</h2>
                        <div style={sub}>Balance de tu inventario publicado por tipo de operación.</div>
                        <OpSplit venta={d.nVenta} renta={d.nRenta} />

                        {/* Red flags */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Red flags comerciales</h2>
                        <div style={sub}>Patrones de funnel que no aparecen en los KPIs. Cada número son propiedades.</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {redflags.map((r) => (
                                <div key={r[0]} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${LGT}`, borderRadius: R, padding: '11px 14px' }}>
                                    <b style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, width: 40, color: r[1] > 0 ? RED : GRY }}>{f(r[1])}</b>
                                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{r[0]}</div><div style={{ fontSize: 11, color: GRY }}>{r[2]}</div></div>
                                </div>
                            ))}
                        </div>

                        {/* Empieza por aquí */}
                        <h2 style={{ ...h2, marginTop: 30 }}>Empieza por aquí</h2>
                        <div style={sub}>Mayor score de oportunidad = buena demanda de zona pero sin generar leads, con un freno claro y arreglable.</div>
                        <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
                                <thead><tr>{['Código', 'Zona', 'Operación', 'Precio', 'vs. oferta', 'Leads', 'Demanda', 'Diagnóstico', 'Opp.'].map((h, i) => <th key={h} style={{ ...tth, textAlign: i === 3 || i === 4 || i > 4 && i < 7 || i === 8 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                                <tbody>
                                    {topOpp.map((p) => (
                                        <tr key={p.id}>
                                            <td style={ttd}><Link href={`/ficha/${p.id}`} target="_blank" style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
                                            <td style={{ ...ttd, color: GRY }}>{p.colonia}</td><td style={ttd}>{p.op}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{money(p.precio)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{vsCell(p.vsOferta)}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{p.leads}</td>
                                            <td style={{ ...ttd, textAlign: 'right' }}>{f(p.demanda)}</td>
                                            <td style={ttd}>{p.diag.length ? p.diag.join(' · ') : <span style={{ color: GRY }}>revisar</span>}</td>
                                            <td style={{ ...ttd, textAlign: 'right', fontWeight: 700 }}>{f(p.oppScore)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ marginTop: 22, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '11px 14px', fontSize: 12, color: '#555' }}>
                            Próximamente: <b>swaps de destacado</b> (baja esta, pon esta), <b>inventario vs. últimos 6 meses</b> y comparativa vs. otras inmobiliarias de la comunidad.
                        </div>
                    </div>
                )}

                {section === 'props' && (
                    <div>
                        <div style={eyebrow}>Propiedades</div><div style={accent} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: '0 0 3px' }}>Tu inventario</h1>
                        <div style={sub}>El funnel se recalcula con tus filtros. Ordena por cualquier columna y abre el reporte desde el código.</div>
                        <PropTable d={d} seg={seg} setSeg={setSeg} />
                    </div>
                )}

                {section === 'analisis' && (
                    <div>
                        <div style={eyebrow}>Generador de análisis</div><div style={accent} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: 0 }}>Análisis de tu inmobiliaria</h1>
                        <div style={sub}>Reporte on-brand por inmobiliaria (calidad, funnel, zonas, año vs. año) con desglose por asesor.</div>
                        <div style={{ marginTop: 20, background: LGT, borderRadius: R, padding: '28px 24px', textAlign: 'center' }}>
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>En construcción</div>
                            <div style={{ fontSize: 12, color: '#555', marginTop: 8, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>Aquí vivirá el generador del reporte de desempeño integrado y en vivo, con la vista partida por asesor/productor.</div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
