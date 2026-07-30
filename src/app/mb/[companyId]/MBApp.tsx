'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBData, MBProp } from '@/lib/mb';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
const estadoColor = (e: string) => (e === 'Óptimo' ? SEA : e === 'Fuera de mercado' ? RED : e === 'No competitivo' ? '#8a6d00' : GRY);

type Section = 'overview' | 'props' | 'analisis';
type Seg = '' | 'sinleads' | 'visitasSinOferta' | 'fuera';

// ---------- Overview ----------
function Stat({ n, l, sub, color, onClick }: { n: string; l: string; sub?: string; color?: string; onClick?: () => void }) {
    return (
        <div onClick={onClick} style={{ flex: 1, background: LGT, padding: '14px 16px', borderRadius: 10, cursor: onClick ? 'pointer' : 'default' }}>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1, color: color || BLK }}>{n}</div>
            <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600 }}>{l}</div>
            {sub && <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function Funnel({ d }: { d: MBData }) {
    const max = Math.max(d.vistas, d.leads, d.visitas, d.ofertas, 1);
    const rate = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    const stages: [string, number, string, string][] = [
        ['Vistas', d.vistas, GRY, ''], ['Leads', d.leads, SEA, `${rate(d.leads, d.vistas)} de vistas`],
        ['Visitas', d.visitas, '#2f6b6b', `${rate(d.visitas, d.leads)} de leads`], ['Ofertas', d.ofertas, BLK, `${rate(d.ofertas, d.visitas)} de visitas`]
    ];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stages.map(([lbl, n, c, note]) => (
                <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 64, fontSize: 12, fontWeight: 600 }}>{lbl}</span>
                    <span style={{ flex: 1, background: '#fff', height: 22, borderRadius: 4, overflow: 'hidden', border: `1px solid ${LGT}` }}>
                        <span style={{ display: 'block', height: '100%', width: `${Math.max((100 * n) / max, 1)}%`, background: c }} />
                    </span>
                    <span style={{ width: 70, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{f(n)}</span>
                    <span style={{ width: 84, textAlign: 'right', fontSize: 10, color: GRY }}>{note}</span>
                </div>
            ))}
        </div>
    );
}

// ---------- Tabla interactiva ----------
type Col = { key: keyof MBProp; label: string; num?: boolean };
const COLS: Col[] = [
    { key: 'code', label: 'Código' }, { key: 'asesor', label: 'Asesor' }, { key: 'op', label: 'Operación' },
    { key: 'colonia', label: 'Colonia' }, { key: 'precio', label: 'Precio', num: true },
    { key: 'sobreprecio', label: 'Precio vs. mercado', num: true }, { key: 'dias', label: 'Días', num: true },
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
    const estados = ['Óptimo', 'No competitivo', 'Fuera de mercado', 'Sin ACM'];

    const rows = useMemo(() => {
        const ql = q.trim().toLowerCase();
        let r = d.props.filter((p) => {
            if (op && p.op !== op) return false;
            if (estado && p.estado !== estado) return false;
            if (asesor && p.asesor !== asesor) return false;
            if (ql && !`${p.code} ${p.colonia} ${p.asesor}`.toLowerCase().includes(ql)) return false;
            if (seg === 'sinleads' && p.leads !== 0) return false;
            if (seg === 'visitasSinOferta' && !(p.visitas > 0 && p.ofertas === 0)) return false;
            if (seg === 'fuera' && p.estado !== 'Fuera de mercado') return false;
            return true;
        });
        r = [...r].sort((a, b) => {
            const va = a[sortKey], vb = b[sortKey];
            if (typeof va === 'number' || typeof vb === 'number') return dir * (((va as number) ?? -1) - ((vb as number) ?? -1));
            return dir * String(va ?? '').localeCompare(String(vb ?? ''), 'es');
        });
        return r;
    }, [d.props, q, op, estado, asesor, seg, sortKey, dir]);

    const onSort = (k: keyof MBProp) => { if (k === sortKey) setDir((x) => (x === 1 ? -1 : 1)); else { setSortKey(k); setDir(k === 'code' || k === 'asesor' || k === 'colonia' || k === 'op' ? 1 : -1); } };
    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const sel: CSSProperties = { fontSize: 12, padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: 8, background: '#fff' };
    const chip = (active: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? BLK : LGT}`, background: active ? BLK : '#fff', color: active ? '#fff' : '#555' });

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                <input placeholder="Buscar código, colonia o asesor…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, width: 240 }} />
                <select value={op} onChange={(e) => setOp(e.target.value)} style={sel}><option value="">Operación: todas</option><option>Venta</option><option>Renta</option></select>
                <select value={estado} onChange={(e) => setEstado(e.target.value)} style={sel}><option value="">Precio: todos</option>{estados.map((x) => <option key={x}>{x}</option>)}</select>
                <select value={asesor} onChange={(e) => setAsesor(e.target.value)} style={sel}><option value="">Asesor: todos</option>{asesores.map((x) => <option key={x}>{x}</option>)}</select>
                <span onClick={() => setSeg(seg === 'sinleads' ? '' : 'sinleads')} style={chip(seg === 'sinleads')}>Sin leads</span>
                <span onClick={() => setSeg(seg === 'visitasSinOferta' ? '' : 'visitasSinOferta')} style={chip(seg === 'visitasSinOferta')}>Con visitas, sin oferta</span>
                <span onClick={() => setSeg(seg === 'fuera' ? '' : 'fuera')} style={chip(seg === 'fuera')}>Fuera de mercado</span>
            </div>
            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                    <thead><tr>{COLS.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? 'right' : 'left' }} onClick={() => onSort(c.key)}>{c.label}{sortKey === c.key ? (dir === 1 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                    <tbody>
                        {rows.map((p) => (
                            <tr key={p.id}>
                                <td style={td}><Link href={`/ficha/${p.id}`} style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
                                <td style={td}>{p.asesor}</td>
                                <td style={td}>{p.op}</td>
                                <td style={{ ...td, color: GRY }}>{p.colonia}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{money(p.precio)}</td>
                                <td style={{ ...td }}><span style={{ color: estadoColor(p.estado), fontWeight: 600 }}>{p.estado}</span>{p.sobreprecio != null && Math.abs(p.sobreprecio) >= 1 ? <span style={{ color: GRY, fontSize: 10 }}> {p.sobreprecio > 0 ? '+' : ''}{p.sobreprecio.toFixed(0)}%</span> : null}</td>
                                <td style={{ ...td, textAlign: 'right', color: GRY }}>{p.dias ?? '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.vistas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.leads)}<span style={{ color: GRY, fontSize: 10 }}> · {p.leadsI24} i24</span></td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(p.visitas)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{p.ofertas || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 11, color: GRY, marginTop: 8 }}>{f(rows.length)} de {f(d.nProps)} propiedades</div>
        </div>
    );
}

// ---------- Shell ----------
export default function MBApp({ d }: { d: MBData }) {
    const [section, setSection] = useState<Section>('overview');
    const [seg, setSeg] = useState<Seg>('');
    const goSeg = (s: Seg) => { setSeg(s); setSection('props'); };

    const h2: CSSProperties = { fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 22, margin: '0 0 3px' };
    const sub: CSSProperties = { fontSize: 12, color: GRY, marginBottom: 14 };
    const nav = (id: Section, label: string) => (
        <div onClick={() => setSection(id)} style={{ padding: '9px 12px', borderRadius: 9, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 2, background: section === id ? BLK : 'transparent', color: section === id ? '#fff' : '#555' }}>{label}</div>
    );

    return (
        <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <aside style={{ width: 230, borderRight: `1px solid ${LGT}`, padding: '22px 14px', position: 'sticky', top: 0, height: '100vh' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 16px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/pulppo-icon.png" alt="Pulppo" style={{ width: 24 }} />
                    <div><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 16, lineHeight: 1 }}>Pulppo</div><div style={{ fontSize: 9, color: GRY, letterSpacing: '.5px' }}>MASTER BROKERS</div></div>
                </div>
                <div style={{ margin: '0 4px 14px', padding: '11px 12px', background: LGT, borderRadius: 10 }}>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{f(d.nProps)} propiedades publicadas</div>
                </div>
                {nav('overview', 'Overview')}
                {nav('props', 'Propiedades')}
                {nav('analisis', 'Generador de análisis')}
                <div style={{ marginTop: 18, padding: '0 8px', fontSize: 9, color: GRY }}>Borrador · datos en vivo</div>
            </aside>

            <main style={{ flex: 1, minWidth: 0, padding: '30px 34px 60px', maxWidth: 1180 }}>
                {section === 'overview' && (
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Overview</div>
                        <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 32, margin: 0 }}>{d.name}</h1>
                        <div style={sub}>Cómo está tu cartera hoy. Haz clic en un foco para ver esas propiedades.</div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                            <Stat n={f(d.nProps)} l="Propiedades publicadas" sub={`${d.nVenta} venta · ${d.nRenta} renta`} />
                            <Stat n={`${d.nProps ? Math.round((100 * d.nVenta) / d.nProps) : 0}%`} l="En venta" sub={`${d.nProps ? 100 - Math.round((100 * d.nVenta) / d.nProps) : 0}% en renta`} />
                            <Stat n={f(d.captaciones90)} l="Captaciones recientes" sub="publicadas ≤ 90 días" />
                        </div>
                        <h2 style={{ ...h2, marginTop: 30 }}>Dónde enfocar</h2>
                        <div style={sub}>Focos accionables — abren el listado ya filtrado.</div>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <Stat n={f(d.sinLeads)} l="Sin leads" sub="clic para verlas" color={d.sinLeads > d.nProps * 0.3 ? RED : BLK} onClick={() => goSeg('sinleads')} />
                            <Stat n={f(d.props.filter((p) => p.visitas > 0 && p.ofertas === 0).length)} l="Con visitas, sin oferta" sub="buen interés, cerrar seguimiento" onClick={() => goSeg('visitasSinOferta')} />
                            <Stat n={f(d.props.filter((p) => p.estado === 'Fuera de mercado').length)} l="Fuera de mercado" sub="precio > +20% vs. ACM" color={RED} onClick={() => goSeg('fuera')} />
                        </div>
                        <div style={{ marginTop: 26, background: LGT, borderLeft: `2px solid ${YEL}`, padding: '12px 14px', borderRadius: '0 8px 8px 0', fontSize: 12, color: '#555' }}>
                            Próximamente aquí: <b>swaps de destacado</b> (baja esta, pon esta) y comparativa vs. otras inmobiliarias de la comunidad.
                        </div>
                    </div>
                )}

                {section === 'props' && (
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Propiedades</div>
                        <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
                        <h2 style={h2}>Funnel comercial</h2>
                        <div style={sub}>Del inventario filtrado abajo se recalcularán las tasas en la próxima iteración. Hoy: total de tu cartera.</div>
                        <Funnel d={d} />
                        <h2 style={{ ...h2, marginTop: 30 }}>Listado</h2>
                        <div style={sub}>Ordena por cualquier columna (clic en el encabezado) y filtra por operación, precio, asesor o busca. Cada código abre su reporte.</div>
                        <PropTable d={d} seg={seg} setSeg={setSeg} />
                    </div>
                )}

                {section === 'analisis' && (
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Generador de análisis</div>
                        <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: 0 }}>Análisis de tu inmobiliaria</h1>
                        <div style={sub}>Reporte on-brand por inmobiliaria (salud, funnel, zonas, año vs. año) con desglose por asesor.</div>
                        <div style={{ marginTop: 20, background: LGT, borderRadius: 12, padding: '28px 24px', textAlign: 'center' }}>
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>En construcción</div>
                            <div style={{ fontSize: 12, color: '#555', marginTop: 8, maxWidth: 520, margin: '8px auto 0' }}>
                                Aquí vivirá el generador del reporte de desempeño (el que ya producimos para inmobiliarias) integrado y en vivo, con la vista partida por asesor/productor. Es el siguiente bloque grande de esta herramienta.
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
