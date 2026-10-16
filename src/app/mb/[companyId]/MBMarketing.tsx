'use client';

/**
 * Marketing de la inmobiliaria (oct-2026) — HOY SÓLO PARA EL EQUIPO INTERNO (lib/marketingAcceso.ts) y el
 * preview de lib/preview.ts.
 * Asignación de anuncios, cambios de la semana, desempeño por nivel (vistas → leads → visitas), propiedades
 * estrella, exposición vs calidad (con «premium sin leads»), rotación, trabadas y, al final, el top de
 * anuncios de venta y de renta.
 * 🔴 Sin costos ni CPL (Ale): esa lectura es interna de Pulppo. Sin cuentas de Inmuebles24 ni zona forzada.
 * Todas las tablas son <TablaFiltrable>: buscador, filtros rápidos, orden por cualquier columna y
 * «Copiar tabla» con sólo lo filtrado.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AvisoMk, MarketingMk, PorNivelMk } from '@/lib/marketingDh';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MES[Number(s.slice(5, 7)) - 1]}` : '—');

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px', cursor: 'pointer', userSelect: 'none' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const sub: CSSProperties = { fontSize: 10.5, color: '#777' };
const inp: CSSProperties = { padding: '5px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };

function Seccion({ n, titulo, nota, children }: { n: number; titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 30 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}><span style={{ color: GRY, marginRight: 8 }}>{n}</span>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 880 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Kpi({ label, value, nota }: { label: string; value: string; nota?: string }) {
    return (
        <div style={{ flex: '1 1 140px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}</div>
            {nota && <div style={sub}>{nota}</div>}
        </div>
    );
}
const Pill = ({ t, bg, fg }: { t: string; bg: string; fg: string }) => <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: R, background: bg, color: fg, whiteSpace: 'nowrap' }}>{t}</span>;
/** ▲▼ contra la semana anterior */
const Delta = ({ a, b }: { a: number; b: number }) => {
    if (!b && !a) return null;
    if (!b) return <span style={{ ...sub, color: SEA, marginLeft: 4 }}>nuevo</span>;
    const d = Math.round(((a - b) / b) * 100);
    return <span style={{ ...sub, color: d > 0 ? SEA : d < 0 ? RED : '#777', marginLeft: 4, whiteSpace: 'nowrap' }}>{d > 0 ? '▲' : d < 0 ? '▼' : '='}{Math.abs(d)}%</span>;
};
const textoCopiar = (filas: Array<Array<string | number | null | undefined>>) => {
    try { void navigator.clipboard.writeText(filas.map((r) => r.map((x) => String(x ?? '')).join('\t')).join('\n')); } catch { /* sin portapapeles */ }
};

// ─────────────────────────── tabla reutilizable ───────────────────────────
interface Col<T> {
    h: string;
    /** valor para ordenar y copiar */
    v: (r: T) => string | number | null;
    num?: boolean;
    render?: (r: T) => ReactNode;
}
function TablaFiltrable<T>({ filas, cols, texto, selects = [], min = 600, limite = 25, orden: ordenIni, vacio = 'Nada que mostrar.' }: {
    filas: T[]; cols: Col<T>[];
    /** texto donde busca el buscador (código, colonia, calle, asesor, nivel…) */
    texto: (r: T) => string;
    selects?: Array<{ label: string; v: (r: T) => string }>;
    min?: number; limite?: number; orden?: { i: number; dir: 1 | -1 }; vacio?: string;
}) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState<Record<string, string>>({});
    const [ord, setOrd] = useState<{ i: number; dir: 1 | -1 } | null>(ordenIni ?? null);
    const [ver, setVer] = useState(limite);
    const opciones = useMemo(() => selects.map((s) => [...new Set(filas.map(s.v).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))), [filas, selects]);
    const filtradas = useMemo(() => {
        const ql = q.trim().toLowerCase();
        let xs = filas.filter((r) => (!ql || texto(r).toLowerCase().includes(ql)) && selects.every((s) => !sel[s.label] || s.v(r) === sel[s.label]));
        if (ord) {
            const c = cols[ord.i];
            xs = [...xs].sort((a, b) => {
                const x = c.v(a), y = c.v(b);
                if (x == null && y == null) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * ord.dir;
            });
        }
        return xs;
    }, [filas, q, sel, ord, cols, texto, selects]);
    const clic = (i: number) => setOrd((o) => (o && o.i === i ? { i, dir: (o.dir === 1 ? -1 : 1) as 1 | -1 } : { i, dir: cols[i].num ? -1 : 1 }));
    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <input value={q} onChange={(e) => { setQ(e.target.value); setVer(limite); }} placeholder="Buscar código, colonia, calle, asesor…" style={{ ...inp, minWidth: 230 }} />
                {selects.map((s, k) => (
                    <select key={s.label} value={sel[s.label] ?? ''} onChange={(e) => { setSel((p) => ({ ...p, [s.label]: e.target.value })); setVer(limite); }} style={inp}>
                        <option value="">{s.label}: todos</option>
                        {opciones[k].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                ))}
                <span style={sub}>{f0(filtradas.length)} de {f0(filas.length)}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => textoCopiar([cols.map((c) => c.h), ...filtradas.map((r) => cols.map((c) => c.v(r)))])}
                    style={{ fontSize: 11, padding: '3px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>Copiar tabla</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: min, borderCollapse: 'collapse' }}>
                    <thead><tr>{cols.map((c, i) => (
                        <th key={c.h} onClick={() => clic(i)} style={{ ...th, textAlign: c.num ? 'right' : 'left', color: ord?.i === i ? BLK : '#777' }}>
                            {c.h}{ord?.i === i ? (ord.dir === 1 ? ' ↑' : ' ↓') : ''}
                        </th>
                    ))}</tr></thead>
                    <tbody>
                        {filtradas.slice(0, ver).map((r, k) => (
                            <tr key={k}>{cols.map((c) => <td key={c.h} style={{ ...td, ...(c.num ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}) }}>{c.render ? c.render(r) : (c.v(r) ?? '—')}</td>)}</tr>
                        ))}
                        {!filtradas.length && <tr><td colSpan={cols.length} style={{ ...td, color: GRY }}>{vacio}</td></tr>}
                    </tbody>
                </table>
            </div>
            {filtradas.length > ver && (
                <button type="button" onClick={() => setVer((v) => v + limite)} style={{ marginTop: 6, fontSize: 12, padding: '5px 12px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Ver más ({f0(filtradas.length - ver)})
                </button>
            )}
        </div>
    );
}

// ─────────────────────────── pantalla ───────────────────────────
export default function MBMarketing({ companyId }: { companyId: string }) {
    const [d, setD] = useState<MarketingMk | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        fetch(`/api/mb-marketing?company=${companyId}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) setD(j); else setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [companyId]);
    if (err) return <p style={{ fontSize: 13, color: RED }}>{err}</p>;
    if (!d) return <p style={{ fontSize: 13, color: GRY }}>Calculando en vivo… (la primera vez del día tarda ~30 s: corre el scoring de avisos)</p>;
    return <Vista d={d} />;
}

// Colores de siempre de los niveles (Ale): súper destacado amarillo, destacado azul (verde mar), simple negro
const COLOR_I24: Record<string, string> = { 'Súper destacado': YEL, Destacado: SEA, Simple: BLK, Offline: GRY, Gratis: '#9FC7C7', 'Sin aviso': LGT };
const COLOR_MELI: Record<string, string> = { gold_premium: YEL, gold: '#C79A00', silver: GRY, offline: '#D6D6D6', 'sin aviso': LGT };
const MELI_LBL: Record<string, string> = { gold_premium: 'Gold premium', gold: 'Gold', silver: 'Silver', offline: 'Offline', 'sin aviso': 'Sin aviso' };

/** barra apilada horizontal con su leyenda */
function Distribucion({ partes }: { partes: Array<{ k: string; n: number; color: string }> }) {
    const total = partes.reduce((s, x) => s + x.n, 0) || 1;
    return (
        <div>
            <div style={{ display: 'flex', height: 22, borderRadius: R, overflow: 'hidden', background: LGT }}>
                {partes.filter((x) => x.n).map((x) => <div key={x.k} title={`${x.k}: ${f0(x.n)}`} style={{ width: `${(100 * x.n) / total}%`, background: x.color }} />)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6 }}>
                {partes.filter((x) => x.n).map((x) => (
                    <span key={x.k} style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: R, background: x.color, display: 'inline-block' }} />
                        {x.k} <b>{f0(x.n)}</b> <span style={sub}>{pc(x.n, total)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/** Desempeño de un nivel: Vistas → Leads → Visitas con barras comparables entre niveles */
function NivelEmbudo({ x, max }: { x: PorNivelMk; max: { v: number; l: number; s: number } }) {
    const filas: Array<[string, number, number, number, number]> = [
        ['Vistas', x.vistasSem, x.vistasSemAnt, x.vistas30, max.v],
        ['Leads', x.leadsSem, x.leadsSemAnt, x.leads30, max.l],
        ['Visitas', x.visitasSem, x.visitasSemAnt, x.visitas30, max.s],
    ];
    return (
        <div style={{ flex: '1 1 300px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>{x.nivel}</b><span style={sub}>{f0(x.avisos)} anuncios</span>
            </div>
            {filas.map(([lbl, sem, ant, d30, m], i) => (
                <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontSize: 11.5 }}>
                    <span style={{ width: 48, color: '#555' }}>{lbl}</span>
                    <span style={{ flex: 1, background: LGT, height: 10, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${m ? (100 * d30) / m : 0}%`, background: [GRY, SEA, BLK][i] }} />
                    </span>
                    <span style={{ width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{f0(d30)}</b> <span style={sub}>30 d</span></span>
                    <span style={{ width: 92, textAlign: 'right' }}><span style={sub}>sem {f0(sem)}</span><Delta a={sem} b={ant} /></span>
                </div>
            ))}
            <div style={{ ...sub, marginTop: 4 }}>
                Leads por cada 100 vistas: <b style={{ color: BLK }}>{x.vistas30 ? ((100 * x.leads30) / x.vistas30).toFixed(1) : '—'}</b> · lead → visita: <b style={{ color: BLK }}>{pc(x.visitas30, x.leads30)}</b> · L/A: <b style={{ color: BLK }} title="leads por anuncio (30 días)">{x.avisos ? (x.leads30 / x.avisos).toFixed(1) : '—'}</b>
            </div>
        </div>
    );
}

function Vista({ d }: { d: MarketingMk }) {
    const [verCambios, setVerCambios] = useState<'semana' | 'semanaAnt'>('semana');
    const porCodigo = useMemo(() => new Map(d.avisos.map((a) => [a.codigo, a])), [d.avisos]);
    const total = d.avisos.length;
    const premium = d.asignacion.porNivel.filter((x) => /Súper|Destacado/.test(x.nivel)).reduce((s, x) => s + x.n, 0);
    const zd = d.asignacion.zonaDemandVenta;

    // identificación: código con liga + colonia · calle (nada sólo con el ID)
    const Prop = ({ codigo }: { codigo: string }) => {
        const a = porCodigo.get(codigo);
        return (
            <div style={{ minWidth: 150 }}>
                <a href={`/ficha/${encodeURIComponent(a?.id ?? codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700, textDecoration: 'none' }}>{codigo}</a>
                <div style={{ ...sub, whiteSpace: 'normal' }}>{[a?.colonia, a?.calle].filter(Boolean).join(' · ') || 'sin dirección'}</div>
            </div>
        );
    };
    const buscar = (codigo: string, extra = '') => {
        const a = porCodigo.get(codigo);
        return [codigo, a?.colonia, a?.calle, a?.asesor, a?.nivel, a?.tipo, extra].filter(Boolean).join(' ');
    };
    const colProp = <T extends { codigo: string }>(): Col<T> => ({ h: 'Propiedad', v: (r) => r.codigo, render: (r) => <Prop codigo={r.codigo} /> });
    const op = <T extends { codigo: string }>() => ({ label: 'Operación', v: (r: T) => porCodigo.get(r.codigo)?.operacion ?? '' });
    const niv = <T extends { nivel: string }>() => ({ label: 'Nivel', v: (r: T) => r.nivel });

    const maxN = useMemo(() => ({ v: Math.max(1, ...d.porNivel.map((x) => x.vistas30)), l: Math.max(1, ...d.porNivel.map((x) => x.leads30)), s: Math.max(1, ...d.porNivel.map((x) => x.visitas30)) }), [d.porNivel]);
    const cambios = d.cambios[verCambios];
    const conv = (a: { leads30: number; visitas30: number }) => (a.leads30 ? Math.round((100 * a.visitas30) / a.leads30) : null);

    const colsAviso: Col<AvisoMk>[] = [
        colProp<AvisoMk>(),
        { h: 'Nivel', v: (a) => a.nivel },
        { h: 'Vistas sem', num: true, v: (a) => a.vistasSem, render: (a) => <>{f0(a.vistasSem)}<Delta a={a.vistasSem} b={a.vistasSemAnt} /></> },
        { h: 'Vistas 30 d', num: true, v: (a) => a.vistas30 },
        { h: 'Leads sem', num: true, v: (a) => a.leadsSem, render: (a) => <>{f0(a.leadsSem)}<Delta a={a.leadsSem} b={a.leadsSemAnt} /></> },
        { h: 'Leads 30 d', num: true, v: (a) => a.leads30, render: (a) => <b>{f0(a.leads30)}</b> },
        { h: 'Visitas 30 d', num: true, v: (a) => a.visitas30 },
        { h: 'Lead → visita', num: true, v: (a) => conv(a), render: (a) => (conv(a) == null ? '—' : `${conv(a)}%`) },
        { h: 'Vistas i24 / mercado', num: true, v: (a) => a.vistasI24, render: (a) => <span style={{ color: '#666' }}>{a.vistasI24 ?? '—'} / {a.vistasMercadoI24 ?? '—'}</span> },
        { h: 'Asesor', v: (a) => a.asesor, render: (a) => <span style={{ fontSize: 11 }}>{a.asesor}</span> },
    ];

    return (<div>
        <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '9px 13px', fontSize: 11.5, color: '#555', marginBottom: 6 }}>
            Sólo lo ve el equipo de Pulppo. Semana en curso: <b>{fecha(d.semana.desde)} – {fecha(d.semana.hasta)}</b> (en curso) · semana anterior: {fecha(d.semanaAnt.desde)} – {fecha(d.semanaAnt.hasta)}.
            Leads únicos (misma persona + misma propiedad = 1), visitas por fecha de la visita y vistas registradas por Pulppo (la mayoría de Inmuebles24).
        </div>

        <Seccion n={1} titulo="Asignación de hoy" nota="En qué nivel está cada anuncio en Inmuebles24 y en MercadoLibre.">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <Kpi label="Anuncios publicados" value={f0(total)} nota={`${f0(d.asignacion.venta)} venta · ${f0(d.asignacion.renta)} renta`} />
                <Kpi label="Con exposición premium" value={f0(premium)} nota={`${pc(premium, total)} · súper destacado o destacado`} />
                <Kpi label="Fijados a mano" value={f0(d.asignacion.fijados.length)} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Inmuebles24</div>
            <Distribucion partes={d.asignacion.i24.map((x) => ({ k: x.nivel, n: x.n, color: COLOR_I24[x.nivel] ?? LGT }))} />
            <div style={{ fontSize: 11.5, color: '#555', margin: '8px 0 10px' }}>
                De los <b>{f0(zd.zonaDemand + zd.normal)}</b> anuncios en venta, <b>{pc(zd.zonaDemand, zd.zonaDemand + zd.normal)}</b> van en <b>zona demand</b> ({f0(zd.zonaDemand)}) y {pc(zd.normal, zd.zonaDemand + zd.normal)} en su nivel normal ({f0(zd.normal)}).
                {d.asignacion.zdProporcion && (() => {
                    const z = d.asignacion.zdProporcion;
                    const inv = z.ventaInv ? (100 * z.ventaEnZd) / z.ventaInv : 0, av = z.premium ? (100 * z.premiumZd) / z.premium : 0;
                    const dif = av - inv;
                    return (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: LGT, borderRadius: R }}>
                            <b>¿Le damos zona demand en proporción a su inventario?</b> El <b>{inv.toFixed(0)}%</b> de su inventario en venta está en alcaldías zona demand ({f0(z.ventaEnZd)} de {f0(z.ventaInv)}: Miguel Hidalgo, Cuajimalpa, Álvaro Obregón y Magdalena Contreras). De sus avisos premium, el <b>{av.toFixed(0)}%</b> son zona demand ({f0(z.premiumZd)} de {f0(z.premium)}).{' '}
                            {Math.abs(dif) <= 10 ? <span style={{ color: SEA, fontWeight: 700 }}>Va proporcional.</span>
                                : dif > 0 ? <span style={{ color: '#8A6D00', fontWeight: 700 }}>Le damos {dif.toFixed(0)} pts más zona demand de lo que pesa su inventario ahí.</span>
                                : <span style={{ color: '#A52003', fontWeight: 700 }}>Le damos {Math.abs(dif).toFixed(0)} pts menos zona demand de lo que pesa su inventario ahí.</span>}
                            {z.zdFueraDeZona > 0 && <> Ojo: {f0(z.zdFueraDeZona)} {z.zdFueraDeZona === 1 ? 'aviso tiene' : 'avisos tienen'} nivel zona demand pero la propiedad está fuera de esas alcaldías.</>}
                        </div>
                    );
                })()}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                {d.asignacion.porNivel.map((x) => (
                    <div key={x.nivel} style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderLeft: `3px solid ${COLOR_I24[x.nivel.replace(/ zona demand$/, '')] ?? LGT}`, borderRadius: R, padding: '8px 10px', background: '#fff' }}>
                        <div style={{ fontSize: 10.5, color: '#777', fontWeight: 700 }}>{x.nivel}</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>{f0(x.n)}</div>
                        <div style={sub}>{f0(x.venta)} venta · {f0(x.renta)} renta</div>
                    </div>
                ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>MercadoLibre</div>
            <Distribucion partes={d.asignacion.meli.map((m) => ({ k: MELI_LBL[m.tipo] ?? m.tipo, n: m.n, color: COLOR_MELI[m.tipo] ?? SEA }))} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {d.asignacion.meli.map((m) => (
                    <div key={m.tipo} style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderLeft: `3px solid ${COLOR_MELI[m.tipo] ?? SEA}`, borderRadius: R, padding: '8px 10px', background: '#fff' }}>
                        <div style={{ fontSize: 10.5, color: '#777', fontWeight: 700 }}>{MELI_LBL[m.tipo] ?? m.tipo}</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>{f0(m.n)}</div>
                    </div>
                ))}
            </div>
            {d.asignacion.fijados.length > 0 && <div style={{ ...sub, marginTop: 10 }}>Fijados a mano: {d.asignacion.fijados.map((x) => { const a = porCodigo.get(x.codigo); return `${x.codigo}${a?.colonia ? ` (${a.colonia})` : ''} · ${x.nivel}${x.por ? `, por ${x.por}` : ''}${x.el ? `, ${fecha(x.el)}` : ''}`; }).join(' · ')}</div>}
            {d.asignacion.noPromovidos.length > 0 && <div style={{ ...sub, marginTop: 4 }}>Motivos por los que i24 no promueve: {d.asignacion.noPromovidos.map((x) => `${x.motivo} (${x.n})`).join(' · ')}</div>}
        </Seccion>

        <Seccion n={2} titulo="Cambios de la semana" nota="Qué subió o bajó de nivel: el nivel al inicio de la semana contra el de hoy (o el del cierre de la semana anterior). El motivo sale del historial del anuncio.">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['semana', 'semanaAnt'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setVerCambios(k)} style={{ padding: '5px 11px', fontSize: 12, border: `1px solid ${LGT}`, borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', background: verCambios === k ? BLK : '#fff', color: verCambios === k ? '#fff' : '#555' }}>
                        {k === 'semana' ? `Esta semana (en curso) · ${d.cambios.semana.length}` : `Semana anterior · ${d.cambios.semanaAnt.length}`}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{f0(cambios.filter((c) => c.sube).length)}</b> subieron · <b>{f0(cambios.filter((c) => !c.sube).length)}</b> bajaron o rotaron.</div>
            <TablaFiltrable key={verCambios} filas={cambios} min={660} texto={(c) => buscar(c.codigo, `${c.antes} ${c.despues} ${c.motivo ?? ''}`)}
                selects={[{ label: 'Movimiento', v: (c) => (c.sube ? 'Subió' : 'Bajó') }, op()]}
                vacio="Sin cambios de nivel en esta semana."
                cols={[
                    { h: 'Fecha', v: (c) => c.fecha, render: (c) => fecha(c.fecha) },
                    colProp(),
                    { h: 'Antes', v: (c) => c.antes },
                    { h: 'Ahora', v: (c) => c.despues, render: (c) => <><span style={{ color: c.sube ? SEA : RED, fontWeight: 700 }}>{c.sube ? '↑' : '↓'}</span> {c.despues}</> },
                    { h: 'Motivo', v: (c) => c.motivo, render: (c) => <span style={{ color: '#666' }}>{c.motivo ?? '—'}</span> },
                ]} />
        </Seccion>

        <Seccion n={3} titulo="Desempeño por nivel" nota="Vistas → leads → visitas de cada nivel en los últimos 30 días (las barras se comparan entre niveles) y la semana en curso contra la anterior (▲▼).">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {d.porNivel.filter((x) => x.nivel !== 'Offline' && x.nivel !== 'Sin aviso').map((x) => <NivelEmbudo key={x.nivel} x={x} max={maxN} />)}
            </div>
        </Seccion>

        <Seccion n={4} titulo="Propiedades estrella" nota="Las que más leads reciben (30 días) y si los convierten en visitas. Estrella = 5+ leads y 15%+ visitan. Mucho ruido = 5+ leads y menos de 10% visitan. ">
            <div style={{ fontSize: 11.5, marginBottom: 8 }}><a href="#top-anuncios" onClick={(e) => { e.preventDefault(); document.getElementById('top-anuncios')?.scrollIntoView({ behavior: 'smooth' }); }} style={{ color: SEA, fontWeight: 700 }}>Ver el top completo de venta y renta ↓</a></div>
            <TablaFiltrable filas={d.estrellas} min={720} texto={(e) => buscar(e.codigo, e.etiqueta)}
                selects={[{ label: 'Lectura', v: (e) => e.etiqueta }, op()]}
                cols={[
                    colProp(),
                    { h: 'Operación', v: (e) => e.operacion },
                    { h: 'Nivel', v: (e) => e.nivel },
                    { h: 'Vistas 30 d', num: true, v: (e) => e.vistas30 },
                    { h: 'Leads 30 d', num: true, v: (e) => e.leads30, render: (e) => <b>{f0(e.leads30)}</b> },
                    { h: 'Visitas 30 d', num: true, v: (e) => e.visitas30 },
                    { h: 'Lead → visita', num: true, v: (e) => (e.conv == null ? null : Math.round(e.conv * 100)), render: (e) => (e.conv == null ? '—' : `${Math.round(e.conv * 100)}%`) },
                    { h: 'Lectura', v: (e) => e.etiqueta, render: (e) => (e.etiqueta === 'Estrella' ? <Pill t="★ Estrella" bg={SEA} fg="#fff" /> : e.etiqueta === 'Mucho ruido, poca visita' ? <Pill t="Mucho ruido, poca visita" bg="#F3D9D3" fg={RED} /> : <Pill t="En camino" bg={LGT} fg={BLK} />) },
                ]} />
        </Seccion>

        <Seccion n={5} titulo="Exposición vs. calidad del inventario" nota="Dónde se está usando un lugar premium sin que rinda, y qué simples merecen subir según el scoring de anuncios. El «por qué» junta vistas, leads, precio contra la colonia, demanda (búsquedas en la zona) y competencia (comparables).">
            <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0 6px', color: RED }}>Premium sin leads · {f0(d.premiumSinLeads.length)} <span style={{ ...sub, fontWeight: 400 }}>· en su nivel actual sin un solo lead desde que entró (súper destacados primero)</span></div>
            <TablaFiltrable filas={d.premiumSinLeads} min={860} limite={15} texto={(x) => buscar(x.codigo, x.porque)}
                selects={[niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel },
                    { h: 'Días en el nivel', num: true, v: (x) => x.diasEnNivel, render: (x) => <b>{f0(x.diasEnNivel)}</b> },
                    { h: 'Vistas 30 d', num: true, v: (x) => x.vistas30 },
                    { h: 'Por qué', v: (x) => x.porque, render: (x) => <span style={{ fontSize: 11.5 }}>{x.porque}</span> },
                ]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px' }}>Premium que no está rindiendo · {f0(d.desperdicio.length)} <span style={{ ...sub, fontWeight: 400 }}>· sin leads en 30 días, con precio fuera de su zona o ficha incompleta</span></div>
            <TablaFiltrable filas={d.desperdicio} min={860} limite={15} texto={(x) => buscar(x.codigo, x.motivo)}
                selects={[niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel },
                    { h: 'Vistas 30 d', num: true, v: (x) => x.vistas30 },
                    { h: 'Leads 30 d', num: true, v: (x) => x.leads30 },
                    { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5, color: RED }}>{x.motivo}</span> },
                ]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px', color: SEA }}>Simples que merecen subir · {f0(d.subir.length)}</div>
            <TablaFiltrable filas={d.subir} min={560} texto={(x) => buscar(x.codigo)} selects={[op()]}
                vacio="Ninguna simple pasa el scoring esta semana."
                cols={[
                    colProp(),
                    { h: 'Puntaje', num: true, v: (x) => x.puntos, render: (x) => <b style={{ color: SEA }}>{x.puntos}</b> },
                    { h: 'Leads 30 d', num: true, v: (x) => x.leads30 },
                    { h: 'Búsquedas en la zona', num: true, v: (x) => x.demanda },
                    { h: 'Comparables compitiendo', num: true, v: (x) => x.competencia },
                ]} />
        </Seccion>

        <Seccion n={6} titulo="Rotación: qué promover y qué rotar">
            <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '8px 12px', fontSize: 12, color: '#555', marginBottom: 12 }}>
                Cómo funciona el scoring: ver presentación (próximamente).
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: SEA }}>Promover esta semana · {f0(Math.min(10, d.subir.length))}</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
                {d.subir.slice(0, 10).map((x) => <div key={x.codigo} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><Prop codigo={x.codigo} /><span style={sub}>puntaje {x.puntos}</span></div>)}
                {!d.subir.length && <span style={sub}>Ninguna simple pasa el filtro esta semana.</span>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: RED }}>Rotar a Simple · {f0(d.rotar.length)}</div>
            <TablaFiltrable filas={d.rotar} min={720} texto={(x) => buscar(x.codigo, x.motivo)} selects={[niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel, render: (x) => <>{x.nivel}<div style={sub}>desde {fecha(x.desde)}</div></> },
                    { h: 'Leads en su lugar', num: true, v: (x) => x.leadsEnNivel },
                    { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5 }}>{x.motivo}</span> },
                ]} />
            <div style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6, maxWidth: 880 }}>
                <b>Acciones manuales sugeridas mientras probamos el scoring</b>
                {d.rotar.some((x) => x.leadsEnNivel >= d.reglas.leadsRotar) && <div>· Bajar a Simple las {f0(d.rotar.filter((x) => x.leadsEnNivel >= d.reglas.leadsRotar).length)} que ya juntaron {d.reglas.leadsRotar}+ leads en su lugar y subir en su lugar las de «Promover esta semana».</div>}
                <div>· Las premium sin leads: si la ven y no escriben, conversación de precio con el propietario; si casi nadie la ve, revisar zona y título antes de seguir dándole el lugar.</div>
                <div>· Las premium con ficha incompleta: completar fotos y video esta semana; si no, bajarlas a Simple.</div>
                <div>· Revisar cada lunes esta pestaña contra la semana anterior y ajustar a mano lo que el scoring todavía no resuelve.</div>
            </div>
        </Seccion>

        <Seccion n={7} titulo="Propiedades trabadas que necesitan auxilio" nota="Publicadas hace 60+ días, sin ninguna oferta, y con 2 o menos leads en 90 días, o con 5+ leads pero ninguna visita. El freno probable, por qué y una acción concreta.">
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{f0(d.trabadas.length)}</b> propiedades · {Object.entries(d.trabadas.reduce<Record<string, number>>((m, x) => ({ ...m, [x.freno]: (m[x.freno] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}</div>
            <TablaFiltrable filas={d.trabadas} min={1100} texto={(x) => buscar(x.codigo, `${x.freno} ${x.porque}`)}
                selects={[{ label: 'Freno', v: (x) => x.freno }, niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel, render: (x) => <span style={{ fontSize: 11 }}>{x.nivel}</span> },
                    { h: 'Días publicada', num: true, v: (x) => x.dias },
                    { h: 'Vistas 30 d', num: true, v: (x) => x.vistas30 },
                    { h: 'Leads 90 d', num: true, v: (x) => x.leads90 },
                    { h: 'Visitas 90 d', num: true, v: (x) => x.visitas90 },
                    { h: 'Freno', v: (x) => x.freno, render: (x) => <Pill t={x.freno} bg={x.freno.startsWith('Precio') ? '#F3D9D3' : x.freno === 'Ficha' ? YEL : LGT} fg={x.freno.startsWith('Precio') ? RED : BLK} /> },
                    { h: 'Por qué', v: (x) => x.porque, render: (x) => <span style={{ fontSize: 11 }}>{x.porque}</span> },
                    { h: 'Acción', v: (x) => x.accion, render: (x) => <span style={{ fontSize: 11.5 }}>{x.accion}</span> },
                ]} />
        </Seccion>

        <div id="top-anuncios" />
        <Seccion n={8} titulo="Top de anuncios" nota="Todos los anuncios publicados, por operación. Ordena con clic en cualquier encabezado; filtra por nivel o busca por código, colonia, calle o asesor.">
            <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0 6px' }}>Venta · {f0(d.asignacion.venta)}</div>
            <TablaFiltrable filas={d.avisos.filter((a) => a.operacion === 'Venta')} cols={colsAviso} min={1100} orden={{ i: 5, dir: -1 }}
                texto={(a) => buscar(a.codigo)} selects={[{ label: 'Nivel', v: (a) => a.nivel }]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '20px 0 6px' }}>Renta · {f0(d.asignacion.renta)}</div>
            <TablaFiltrable filas={d.avisos.filter((a) => a.operacion === 'Renta')} cols={colsAviso} min={1100} orden={{ i: 5, dir: -1 }}
                texto={(a) => buscar(a.codigo)} selects={[{ label: 'Nivel', v: (a) => a.nivel }]} />
            <div style={{ ...sub, marginTop: 6 }}>«Vistas i24 / mercado»: vistas del anuncio que reporta Inmuebles24 contra el promedio de anuncios comparables (ventana del portal).</div>
        </Seccion>
        <p style={{ fontSize: 10, color: GRY, marginTop: 16 }}>En vivo desde Mongo · {new Date(d.generado).toLocaleString('es-MX')}</p>
    </div>);
}
