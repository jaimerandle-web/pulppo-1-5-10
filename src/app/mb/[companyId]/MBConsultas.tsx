'use client';

/**
 * Consultas a detalle (/mb → Consultas) — el seguimiento que Diamond House hacía en el Retool «Reporte de
 * consultas y propiedades», con un solo cálculo y filtros que filtran TODO: si eliges Inmuebles24, los
 * indicadores, la gráfica, las tablas por asesor y por propiedad y la lista de leads son sólo de Inmuebles24.
 * Dos medidas de respuesta, con su nombre (Ale): «abierto por el asesor» (lo que el Retool llama
 * «respondido») y «con conversación visible». Motor: lib/consultas.ts.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ConsultasData, LeadConsulta } from '@/lib/consultas';
import TablaFiltrable, { inp } from './TablaFiltrable';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const MX = 6 * 3600 * 1000;
const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const sub: CSSProperties = { fontSize: 10.5, color: '#777' };
const ymdMx = (d: Date) => new Date(d.getTime() - MX).toISOString().slice(0, 10);
const diaMx = (iso: string) => ymdMx(new Date(iso));
const fCorta = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MES[Number(ymd.slice(5, 7)) - 1]}`;
const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const tiempo = (min: number | null) => (min == null ? '—' : min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} d`);
const COLORES_CANAL = [BLK, YEL, SEA, '#8A8C8B', '#C79A00', '#9FC7C7', '#D6D6D6', '#5E6160', '#E8D48A', '#3E7A7A', '#B7B7B7', '#F0E0A0'];

type Periodo = '7' | '30' | 'mes' | 'mesAnt' | '90' | 'anio' | 'fechas';
const PERIODOS: Array<[Periodo, string]> = [['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['mes', 'Este mes'], ['mesAnt', 'Mes pasado'], ['90', 'Últimos 90 días'], ['anio', 'Este año'], ['fechas', 'Fechas…']];
function rango(p: Periodo, d1: string, d2: string): { desde: string; hasta: string } {
    const hoy = ymdMx(new Date());
    const [y, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
    const menos = (n: number) => ymdMx(new Date(Date.now() - n * 86400000));
    if (p === '7') return { desde: menos(6), hasta: hoy };
    if (p === '30') return { desde: menos(29), hasta: hoy };
    if (p === '90') return { desde: menos(89), hasta: hoy };
    if (p === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    if (p === 'mesAnt') { const a = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; const fin = new Date(Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)), 0)).toISOString().slice(0, 10); return { desde: `${a}-01`, hasta: fin }; }
    if (p === 'anio') return { desde: `${y}-01-01`, hasta: hoy };
    return { desde: d1 || menos(29), hasta: d2 || hoy };
}

function Kpi({ label, value, nota, delta }: { label: string; value: string; nota?: ReactNode; delta?: ReactNode }) {
    return (
        <div style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 25, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}{delta}</div>
            {nota && <div style={sub}>{nota}</div>}
        </div>
    );
}
const Delta = ({ a, b, pts }: { a: number | null; b: number | null; pts?: boolean }) => {
    if (a == null || b == null || (!a && !b)) return null;
    const d = pts ? Math.round(a - b) : b ? Math.round(((a - b) / b) * 100) : null;
    if (d == null) return <span style={{ ...sub, color: SEA, marginLeft: 6, fontFamily: 'Nunito Sans, sans-serif' }}>nuevo</span>;
    return <span style={{ ...sub, color: d > 0 ? SEA : d < 0 ? RED : '#777', marginLeft: 6, fontFamily: 'Nunito Sans, sans-serif' }}>{d > 0 ? '▲' : d < 0 ? '▼' : '='}{Math.abs(d)}{pts ? ' pts' : '%'}</span>;
};
function Seccion({ titulo, nota, children, id }: { titulo: string; nota?: ReactNode; children: ReactNode; id?: string }) {
    return (
        <section id={id} style={{ marginTop: 28 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 900 }}>{nota}</div>}
            {children}
        </section>
    );
}
const chip = (on: boolean): CSSProperties => ({ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: R, cursor: 'pointer', border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555', fontFamily: 'inherit' });

export default function MBConsultas({ companyId }: { companyId: string }) {
    const [periodo, setPeriodo] = useState<Periodo>('30');
    const [d1, setD1] = useState(''), [d2, setD2] = useState('');
    const { desde, hasta } = rango(periodo, d1, d2);
    const [data, setData] = useState<ConsultasData | null>(null);
    const [err, setErr] = useState('');
    const [cargando, setCargando] = useState(false);
    useEffect(() => {
        let vivo = true;
        setCargando(true); setErr('');
        fetch(`/api/mb-consultas?company=${companyId}&desde=${desde}&hasta=${hasta}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) setData(j); else setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'))
            .finally(() => vivo && setCargando(false));
        return () => { vivo = false; };
    }, [companyId, desde, hasta]);

    // filtros que filtran TODO
    const [canales, setCanales] = useState<Set<string>>(new Set());
    const [oper, setOper] = useState<'Todas' | 'Venta' | 'Renta'>('Todas');
    const [asesor, setAsesor] = useState('');
    const [medio, setMedio] = useState('');
    const [q, setQ] = useState('');
    const [verDia, setVerDia] = useState<'canal' | 'abierto'>('canal');

    const pasa = (l: LeadConsulta) => (!canales.size || canales.has(l.canal)) && (oper === 'Todas' || l.operacion === oper)
        && (!asesor || l.asesor === asesor) && (!medio || l.medio === medio)
        && (!q || [l.codigo, l.nombre, l.telefono, l.correo, l.calle, l.colonia].filter(Boolean).join(' ').toLowerCase().includes(q.toLowerCase()));
    const enPeriodo = useMemo(() => (data ? data.leads.filter((l) => l.fecha >= data.desde) : []), [data]);
    const previo = useMemo(() => (data ? data.leads.filter((l) => l.fecha < data.desde) : []), [data]);
    const cur = useMemo(() => enPeriodo.filter(pasa), [enPeriodo, canales, oper, asesor, medio, q]); // eslint-disable-line react-hooks/exhaustive-deps
    const ant = useMemo(() => previo.filter(pasa), [previo, canales, oper, asesor, medio, q]); // eslint-disable-line react-hooks/exhaustive-deps
    const listaCanales = useMemo(() => [...enPeriodo.reduce((m, l) => m.set(l.canal, (m.get(l.canal) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]), [enPeriodo]);
    const asesores = useMemo(() => [...new Set(enPeriodo.map((l) => l.asesor))].sort((a, b) => a.localeCompare(b, 'es')), [enPeriodo]);
    const verLista = () => setTimeout(() => document.getElementById('lista-leads')?.scrollIntoView({ behavior: 'smooth' }), 50);

    const stats = (xs: LeadConsulta[]) => ({
        n: xs.length, venta: xs.filter((l) => l.operacion === 'Venta').length, renta: xs.filter((l) => l.operacion === 'Renta').length,
        abiertos: xs.filter((l) => l.abierto).length, conv: xs.filter((l) => l.conversacion).length,
        visito: xs.filter((l) => l.visito).length, oferto: xs.filter((l) => l.oferto).length,
        med: mediana(xs.map((l) => l.minutosRespuesta).filter((x): x is number => x != null)),
    });
    const a = stats(cur), b = stats(ant);
    const pct = (x: number, n: number) => (n ? (100 * x) / n : null);

    // leads por día
    const dias = useMemo(() => {
        const out: string[] = [];
        for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
        return out;
    }, [desde, hasta]);
    const canalesCur = useMemo(() => [...new Set(cur.map((l) => l.canal))].sort((x, y) => cur.filter((l) => l.canal === y).length - cur.filter((l) => l.canal === x).length), [cur]);
    const serie = useMemo(() => dias.map((dd) => {
        const xs = cur.filter((l) => diaMx(l.fecha) === dd);
        const row: Record<string, number | string> = { dia: fCorta(dd) };
        if (verDia === 'canal') for (const c of canalesCur) row[c] = xs.filter((l) => l.canal === c).length;
        else { row['Abierto por el asesor'] = xs.filter((l) => l.abierto).length; row['Sin abrir'] = xs.filter((l) => !l.abierto).length; }
        return row;
    }), [dias, cur, canalesCur, verDia]);

    const agrupa = (key: (l: LeadConsulta) => string) => [...cur.reduce((m, l) => { const k = key(l); (m.get(k) ?? m.set(k, []).get(k)!).push(l); return m; }, new Map<string, LeadConsulta[]>())]
        .map(([k, xs]) => ({ k, xs, ...stats(xs) })).sort((x, y) => y.n - x.n);
    const porCanal = agrupa((l) => l.canal), porAsesor = agrupa((l) => l.asesor), porProp = agrupa((l) => l.codigo ?? 'Sin propiedad');
    const etapas = ['Buscando', 'Visitando', 'Ofertando', 'Cerró', 'Descartado', 'Sin búsqueda'].map((e) => ({ e, n: cur.filter((l) => l.etapa === e).length }));
    const motivos = [...cur.filter((l) => l.motivo).reduce((m, l) => m.set(l.motivo!, (m.get(l.motivo!) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]);

    type Fila = (typeof porCanal)[number];
    const colsBase = (h: string, render?: (r: Fila) => ReactNode) => [
        { h, v: (r: Fila) => r.k, render },
        { h: 'Leads', num: true, v: (r: Fila) => r.n, render: (r: Fila) => <b>{f0(r.n)}</b> },
        { h: '% del total', num: true, v: (r: Fila) => pct(r.n, a.n), render: (r: Fila) => pc(r.n, a.n) },
        { h: 'Abiertos por el asesor', num: true, v: (r: Fila) => pct(r.abiertos, r.n), render: (r: Fila) => <>{pc(r.abiertos, r.n)} <span style={sub}>({f0(r.n - r.abiertos)} sin abrir)</span></> },
        { h: '1ª apertura (mediana)', num: true, v: (r: Fila) => r.med, render: (r: Fila) => tiempo(r.med) },
        { h: 'Con conversación', num: true, v: (r: Fila) => pct(r.conv, r.n), render: (r: Fila) => pc(r.conv, r.n) },
        { h: 'Visitaron', num: true, v: (r: Fila) => r.visito, render: (r: Fila) => <>{f0(r.visito)} <span style={sub}>{pc(r.visito, r.n)}</span></> },
        { h: 'Ofertaron', num: true, v: (r: Fila) => r.oferto, render: (r: Fila) => <>{f0(r.oferto)} <span style={sub}>{pc(r.oferto, r.n)}</span></> },
    ];
    const link = (t: string, on: () => void) => <button type="button" onClick={on} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: SEA, fontWeight: 700, fontFamily: 'inherit', fontSize: 12, textAlign: 'left' }}>{t}</button>;

    return (
        <div>
            {/* ── filtros ── */}
            <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: `1px solid ${LGT}`, padding: '10px 0', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {PERIODOS.map(([k, t]) => <button key={k} type="button" onClick={() => setPeriodo(k)} style={chip(periodo === k)}>{t}</button>)}
                    {periodo === 'fechas' && <><input type="date" value={d1} onChange={(e) => setD1(e.target.value)} style={inp} /><input type="date" value={d2} onChange={(e) => setD2(e.target.value)} style={inp} /></>}
                    <span style={sub}>{fCorta(desde)} {desde.slice(0, 4)} – {fCorta(hasta)} {hasta.slice(0, 4)}{cargando ? ' · cargando…' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ ...sub, fontWeight: 700 }}>Canal:</span>
                    <button type="button" onClick={() => setCanales(new Set())} style={chip(!canales.size)}>Todos</button>
                    {listaCanales.map(([c, n]) => (
                        <button key={c} type="button" onClick={() => setCanales((p) => { const x = new Set(p); if (x.has(c)) x.delete(c); else x.add(c); return x; })} style={chip(canales.has(c))}>{c} <span style={{ opacity: .7 }}>{f0(n)}</span></button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(['Todas', 'Venta', 'Renta'] as const).map((o) => <button key={o} type="button" onClick={() => setOper(o)} style={chip(oper === o)}>{o === 'Todas' ? 'Venta y renta' : o}</button>)}
                    <select value={asesor} onChange={(e) => setAsesor(e.target.value)} style={inp}><option value="">Asesor: todos</option>{asesores.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                    <select value={medio} onChange={(e) => setMedio(e.target.value)} style={inp}><option value="">Medio: todos</option>{['WhatsApp', 'Teléfono', 'Formulario'].map((x) => <option key={x} value={x}>{x}</option>)}</select>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, nombre, teléfono, calle…" style={{ ...inp, minWidth: 220 }} />
                    {(canales.size > 0 || oper !== 'Todas' || asesor || medio || q) && link('Quitar filtros', () => { setCanales(new Set()); setOper('Todas'); setAsesor(''); setMedio(''); setQ(''); })}
                </div>
            </div>

            {err && <p style={{ color: RED, fontSize: 13 }}>{err}</p>}
            {!data && !err && <p style={{ ...sub, fontSize: 13, marginTop: 14 }}>Calculando…</p>}
            {data && (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                    <Kpi label="Leads" value={f0(a.n)} delta={<Delta a={a.n} b={b.n} />} nota={<>{f0(a.venta)} venta · {f0(a.renta)} renta · vs {f0(b.n)} el periodo anterior</>} />
                    <Kpi label="Abiertos por el asesor" value={a.n ? pc(a.abiertos, a.n) : '—'} delta={<Delta a={pct(a.abiertos, a.n)} b={pct(b.abiertos, b.n)} pts />} nota={<>{f0(a.n - a.abiertos)} sin abrir · 1ª apertura {tiempo(a.med)} (mediana)</>} />
                    <Kpi label="Con conversación visible" value={a.n ? pc(a.conv, a.n) : '—'} delta={<Delta a={pct(a.conv, a.n)} b={pct(b.conv, b.n)} pts />} nota="el cliente escribió o hubo llamada" />
                    <Kpi label="Visitaron" value={f0(a.visito)} delta={<Delta a={a.visito} b={b.visito} />} nota={`${pc(a.visito, a.n)} de los leads`} />
                    <Kpi label="Ofertaron" value={f0(a.oferto)} delta={<Delta a={a.oferto} b={b.oferto} />} nota={`${pc(a.oferto, a.n)} de los leads`} />
                </div>
                <div style={{ ...sub, marginTop: 6, lineHeight: 1.5, maxWidth: 900 }}>
                    <b>Abierto por el asesor</b>: el asesor abrió la conversación desde Pulppo (es lo que el Retool llamaba «respondido»; no prueba que haya contestado, porque su WhatsApp no se guarda). <b>Con conversación visible</b>: el cliente escribió algo real o hubo llamada. Leads únicos: misma persona + misma propiedad = 1.
                </div>

                <Seccion titulo="Leads por día">
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <button type="button" onClick={() => setVerDia('canal')} style={chip(verDia === 'canal')}>Por canal</button>
                        <button type="button" onClick={() => setVerDia('abierto')} style={chip(verDia === 'abierto')}>Abiertos vs sin abrir</button>
                    </div>
                    <div style={{ width: '100%', height: 240 }}>
                        <ResponsiveContainer>
                            <BarChart data={serie} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                                <CartesianGrid stroke={LGT} vertical={false} />
                                <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#777' }} interval={Math.max(0, Math.ceil(serie.length / 15) - 1)} />
                                <YAxis tick={{ fontSize: 10, fill: '#777' }} allowDecimals={false} />
                                <Tooltip contentStyle={{ fontSize: 11, borderRadius: R }} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                {verDia === 'canal'
                                    ? canalesCur.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={COLORES_CANAL[i % COLORES_CANAL.length]} />)
                                    : [<Bar key="ab" dataKey="Abierto por el asesor" stackId="a" fill={SEA} />, <Bar key="sa" dataKey="Sin abrir" stackId="a" fill={RED} />]}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Seccion>

                <Seccion titulo="Por canal" nota="De dónde llegan y qué tan bien se atienden. Clic en un canal para filtrar todo por ese canal.">
                    <TablaFiltrable filas={porCanal} min={900} limite={20} texto={(r) => r.k}
                        cols={colsBase('Canal', (r) => link(r.k, () => setCanales(new Set([r.k]))))} />
                </Seccion>

                <Seccion titulo="Embudo" nota="Qué pasó con estos leads: si visitaron u ofertaron con la inmobiliaria después del lead, y en qué etapa va su búsqueda hoy.">
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {[['Leads', a.n], ['Con conversación', a.conv], ['Visitaron', a.visito], ['Ofertaron', a.oferto]].map(([t, n], i, arr) => (
                            <div key={t as string} style={{ flex: '1 1 140px', background: LGT, borderRadius: R, padding: '10px 12px' }}>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24 }}>{f0(n as number)}</div>
                                <div style={{ fontSize: 11, fontWeight: 700 }}>{t}</div>
                                {i > 0 && <div style={sub}>{pc(n as number, arr[0][1] as number)} de los leads</div>}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, fontSize: 12 }}>
                        <div style={{ flex: '1 1 300px' }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>Etapa de la búsqueda hoy</div>
                            {etapas.filter((x) => x.n).map((x) => (
                                <div key={x.e} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                                    <span style={{ width: 100 }}>{x.e}</span>
                                    <span style={{ flex: 1, background: LGT, height: 12 }}><span style={{ display: 'block', height: 12, width: `${(100 * x.n) / Math.max(1, a.n)}%`, background: x.e === 'Descartado' ? RED : x.e === 'Cerró' ? SEA : BLK }} /></span>
                                    <span style={{ width: 80, textAlign: 'right' }}><b>{f0(x.n)}</b> <span style={sub}>{pc(x.n, a.n)}</span></span>
                                </div>
                            ))}
                        </div>
                        <div style={{ flex: '1 1 300px' }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>Por qué se descartaron</div>
                            {motivos.slice(0, 8).map(([m, n]) => <div key={m} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid ${LGT}` }}><span>{m}</span><b>{f0(n)}</b></div>)}
                            {!motivos.length && <span style={sub}>Ninguno descartado.</span>}
                        </div>
                    </div>
                </Seccion>

                <Seccion titulo="Por asesor" nota="Clic en un asesor para filtrar todo por él y ver sus leads.">
                    <TablaFiltrable filas={porAsesor} min={980} limite={30} texto={(r) => r.k}
                        cols={colsBase('Asesor', (r) => link(r.k, () => { setAsesor(r.k); verLista(); }))} />
                </Seccion>

                <Seccion titulo="Por propiedad" nota="Clic en una propiedad para ver sus leads.">
                    <TablaFiltrable filas={porProp} min={1100} limite={25} orden={{ i: 2, dir: -1 }}
                        texto={(r) => [r.k, r.xs[0]?.calle, r.xs[0]?.colonia, r.xs[0]?.tipo].filter(Boolean).join(' ')}
                        selects={[{ label: 'Operación', v: (r) => r.xs[0]?.operacion ?? '' }, { label: 'Nivel i24', v: (r) => r.xs[0]?.nivel ?? '' }]}
                        cols={[
                            { h: 'Propiedad', v: (r) => r.k, render: (r) => { const l = r.xs[0]; return (
                                <div style={{ minWidth: 170 }}>
                                    {link(r.k, () => { setQ(r.k); verLista(); })} <span style={sub}>{[l?.tipo, l?.operacion].filter(Boolean).join(' · ')}</span>
                                    <div style={{ fontSize: 11.5 }}>{[l?.calle, l?.colonia].filter(Boolean).join(', ')}</div>
                                    <div style={sub}>{[...new Set(r.xs.map((x) => x.asesor))].join(' / ')}</div>
                                </div>); } },
                            { h: 'Precio', num: true, v: (r) => r.xs[0]?.precio ?? null, render: (r) => (r.xs[0]?.precio != null ? `$${f0(Math.round(r.xs[0].precio!))}` : '—') },
                            ...colsBase('').slice(1, 2),
                            { h: 'Nivel i24 hoy', v: (r) => r.xs[0]?.nivel ?? null },
                            ...colsBase('').slice(3),
                        ]} />
                </Seccion>

                <Seccion id="lista-leads" titulo={`Leads · ${f0(cur.length)}`} nota="Todos los leads con los filtros de arriba. «Copiar tabla» copia sólo lo filtrado.">
                    <TablaFiltrable<LeadConsulta> filas={cur} min={1500} limite={50} orden={{ i: 0, dir: -1 }}
                        texto={(l) => [l.nombre, l.telefono, l.correo, l.codigo, l.calle, l.colonia, l.asesor, l.canal].filter(Boolean).join(' ')}
                        selects={[{ label: 'Etapa', v: (l) => l.etapa }, { label: 'Abierto', v: (l) => (l.abierto ? 'Abierto' : 'Sin abrir') }, { label: 'Conversación', v: (l) => (l.conversacion ? 'Con conversación' : 'Sin conversación visible') }]}
                        cols={[
                            { h: 'Fecha', v: (l) => l.fecha, render: (l) => new Date(l.fecha).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' }) },
                            { h: 'Nombre', v: (l) => l.nombre },
                            { h: 'Teléfono', v: (l) => l.telefono },
                            { h: 'Correo', v: (l) => l.correo, render: (l) => <span style={{ fontSize: 11.5 }}>{l.correo ?? '—'}</span> },
                            { h: 'Canal', v: (l) => l.canal },
                            { h: 'Medio', v: (l) => l.medio },
                            { h: 'Propiedad', v: (l) => l.codigo, render: (l) => <div><b>{l.codigo ?? '—'}</b> <span style={sub}>{[l.tipo, l.operacion].filter(Boolean).join(' · ')}</span><div style={{ fontSize: 11 }}>{[l.calle, l.colonia].filter(Boolean).join(', ')}</div></div> },
                            { h: 'Asesor', v: (l) => l.asesor, render: (l) => <span style={{ fontSize: 11.5 }}>{l.asesor}</span> },
                            { h: 'Abierto', v: (l) => l.minutosRespuesta, render: (l) => (l.abierto ? <span>✓ <span style={sub}>{tiempo(l.minutosRespuesta)}</span></span> : <span style={{ color: RED }}>Sin abrir</span>) },
                            { h: 'Conversación', v: (l) => (l.conversacion ? 1 : 0), render: (l) => (l.conversacion ? '✓' : <span style={sub}>—</span>) },
                            { h: 'Etapa', v: (l) => l.etapa, render: (l) => <span>{l.etapa}{l.motivo ? <div style={sub}>{l.motivo}</div> : null}</span> },
                            { h: 'Visitó / ofertó', v: (l) => (l.oferto ? 2 : l.visito ? 1 : 0), render: (l) => (l.oferto ? 'Ofertó' : l.visito ? 'Visitó' : '—') },
                            { h: 'Mensaje', v: (l) => l.mensaje, render: (l) => <span style={{ fontSize: 11, color: '#666' }}>{l.mensaje ?? '—'}</span> },
                        ]} />
                </Seccion>
                <p style={{ fontSize: 10, color: GRY, marginTop: 16 }}>En vivo desde Mongo · {new Date(data.generado).toLocaleString('es-MX')}</p>
            </>)}
        </div>
    );
}
