'use client';

/**
 * Mercado: cierres reales de la red Pulppo. Recreación de ami.pulppo.com con precio de CIERRE
 * (no de lista) y medianas en vez de promedios. Ver `lib/mercado.ts`.
 *
 * Lectura de arriba abajo:
 *   1. filtros (operación, zona, tipo, periodo) — mandan sobre todo lo de abajo
 *   2. KPIs: precio mediano, $/m² mediano, tendencia 6 meses
 *   3. Top 5 alcaldías y colonias por $/m²
 *   4. evolución mensual del $/m²
 *   5. los cierres uno por uno (tarjetas o tabla)
 *
 * 🔒 Lo ven inmobiliarias que compiten entre sí: ningún cierre trae inmobiliaria, broker ni
 * número de calle, y ninguna mediana se muestra con menos de `minCierres` cierres detrás.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Cierre, Mercado, Operacion } from '@/lib/mercado';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const MUTED = '#6f6f6d';
const R = 2;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const f0 = (n: number) => Math.round(n).toLocaleString('es-MX');
const money = (n: number) => `$${f0(n)}`;
const moneyK = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${f0(n)}`);
const mesLbl = (m: string) => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} ${y}`; };

function mediana(xs: number[]): number {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** YYYY-MM de hoy en hora MX */
function mesActual(): string {
    const d = new Date(Date.now() - 6 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function sumaMeses(m: string, k: number): string {
    const [y, mm] = m.split('-').map(Number);
    const t = y * 12 + (mm - 1) + k;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

type Periodo = '12m' | 'todo' | string;   // string = año "2025"

export default function MBMercado({ companyId }: { companyId: string }) {
    const [d, setD] = useState<Mercado | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        fetch(`/api/mb-mercado?company=${companyId}`)
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; ok ? setD(j) : setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [companyId]);

    if (err) return <p style={{ fontSize: 13, color: RED }}>{err}</p>;
    if (!d) return <p style={{ fontSize: 13, color: GRY }}>Leyendo los cierres de la red…</p>;
    return <MBMercadoVista d={d} />;
}

export function MBMercadoVista({ d }: { d: Mercado }) {
    const MIN = d.minCierres;
    const [op, setOp] = useState<Operacion>('venta');
    const [alcaldias, setAlcaldias] = useState<string[]>([]);
    const [colonias, setColonias] = useState<string[]>([]);
    const [tipos, setTipos] = useState<string[]>([]);
    const [periodo, setPeriodo] = useState<Periodo>('12m');

    const hoy = mesActual();
    const anios = useMemo(() => [...new Set(d.cierres.map((c) => c.mes.slice(0, 4)))].sort().reverse(), [d]);
    const enPeriodo = (m: string) =>
        periodo === 'todo' ? true : periodo === '12m' ? m > sumaMeses(hoy, -12) : m.startsWith(periodo);

    // Cada filtro reduce las opciones de los de su derecha (alcaldía → colonia), pero las
    // cuentas que se ven en el menú son las de la operación elegida, para no enseñar opciones vacías.
    const delOp = useMemo(() => d.cierres.filter((c) => c.operacion === op), [d, op]);
    const opcAlcaldia = useMemo(() => contar(delOp, (c) => c.alcaldia), [delOp]);
    const opcColonia = useMemo(() => contar(delOp.filter((c) => !alcaldias.length || alcaldias.includes(c.alcaldia ?? '')), (c) => c.colonia), [delOp, alcaldias]);
    const opcTipo = useMemo(() => contar(delOp, (c) => c.tipo), [delOp]);

    // zona+tipo SIN periodo → alimenta tendencia y evolución (necesitan historia)
    const zona = useMemo(() => delOp.filter((c) =>
        (!alcaldias.length || alcaldias.includes(c.alcaldia ?? ''))
        && (!colonias.length || colonias.includes(c.colonia ?? ''))
        && (!tipos.length || tipos.includes(c.tipo))), [delOp, alcaldias, colonias, tipos]);
    const vis = useMemo(() => zona.filter((c) => enPeriodo(c.mes)), [zona, periodo]); // eslint-disable-line react-hooks/exhaustive-deps

    const hayFiltros = alcaldias.length + colonias.length + tipos.length > 0 || periodo !== '12m';
    const limpiar = () => { setAlcaldias([]); setColonias([]); setTipos([]); setPeriodo('12m'); };

    // Tendencia: 3 meses completos más recientes vs. los mismos 3 meses de hace 6. Un mes contra
    // otro (lo que hacía ami) brinca con dos ventas caras.
    const tendencia = useMemo(() => {
        const fin = sumaMeses(hoy, -1);                       // el mes en curso va incompleto
        const win = (hasta: string) => zona.filter((c) => c.mes <= hasta && c.mes > sumaMeses(hasta, -3)).map((c) => c.precioM2);
        const act = win(fin), ant = win(sumaMeses(fin, -6));
        if (act.length < MIN || ant.length < MIN) return null;
        const a = mediana(act), b = mediana(ant);
        return { a, b, pct: ((a - b) / b) * 100, nA: act.length, nB: ant.length,
                 lblA: `${mesLbl(sumaMeses(fin, -2))} – ${mesLbl(fin)}`,
                 lblB: `${mesLbl(sumaMeses(fin, -8))} – ${mesLbl(sumaMeses(fin, -6))}` };
    }, [zona, hoy, MIN]);

    const filtrosUI = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 18 }}>
            <Seg value={op} onChange={(v) => { setOp(v as Operacion); setColonias([]); }}
                 options={[['venta', 'Venta'], ['renta', 'Renta']]} />
            <Multi label="Alcaldías" opciones={opcAlcaldia} sel={alcaldias}
                   onChange={(v) => { setAlcaldias(v); setColonias((cs) => cs.filter((c) => opcColoniaDe(delOp, v).has(c))); }} />
            <Multi label="Colonias" opciones={opcColonia} sel={colonias} onChange={setColonias} />
            <Multi label="Tipos" opciones={opcTipo} sel={tipos} onChange={setTipos} />
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={control}>
                <option value="12m">Últimos 12 meses</option>
                {anios.map((y) => <option key={y} value={y}>{y}</option>)}
                <option value="todo">Todo (desde 2023)</option>
            </select>
            {hayFiltros && <button onClick={limpiar} style={{ ...control, border: 'none', color: MUTED, textDecoration: 'underline' }}>Limpiar</button>}
        </div>
    );

    const precios = vis.map((c) => c.precio), m2s = vis.map((c) => c.precioM2);
    const suficiente = vis.length >= MIN;

    return (
        <div>
            {filtrosUI}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 22 }}>
                <Kpi eyebrow={op === 'venta' ? 'Precio de cierre' : 'Renta de cierre'}
                     value={suficiente ? money(mediana(precios)) : '—'}
                     note={suficiente ? `Mediana de ${f0(vis.length)} cierres` : `Menos de ${MIN} cierres con estos filtros`} />
                <Kpi eyebrow="Precio por m²" value={suficiente ? `${money(mediana(m2s))}/m²` : '—'}
                     note={suficiente ? `Mediana · ${op === 'venta' ? 'm² construidos' : 'renta mensual'}` : ''} />
                <Kpi eyebrow="Tendencia 6 meses"
                     value={tendencia ? `${tendencia.pct >= 0 ? '+' : '−'}${Math.abs(tendencia.pct).toFixed(1)}%` : '—'}
                     color={tendencia ? (Math.abs(tendencia.pct) < 1 ? BLK : tendencia.pct > 0 ? SEA : RED) : BLK}
                     note={tendencia
                         ? <>{money(tendencia.a)}/m² ({tendencia.lblA}) vs. {money(tendencia.b)}/m² ({tendencia.lblB})</>
                         : `Hacen falta ${MIN} cierres en cada trimestre`} />
            </div>

            {/* Tops */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 22 }}>
                <Top titulo="Top 5 alcaldías" filas={top(vis, (c) => c.alcaldia, MIN)} min={MIN} />
                <Top titulo={alcaldias.length === 1 ? `Top 5 colonias · ${alcaldias[0]}` : 'Top 5 colonias'}
                     filas={top(vis, (c) => c.colonia, MIN)} min={MIN} />
            </div>

            <Evolucion cierres={zona} min={MIN} hasta={hoy} />

            <Lista cierres={vis} />

            <div style={{ fontSize: 11, color: GRY, marginTop: 14, lineHeight: 1.5 }}>
                Cierres registrados en Pulppo (operaciones cerradas o en cobro), con precio de cierre, no de lista.
                Medianas, no promedios. Cierres en dólares convertidos a ${d.usdMxn} MXN.
                Por privacidad no se muestran inmobiliaria, broker ni número exterior. Actualizado {new Date(d.calculadoEn).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.
            </div>
        </div>
    );
}

// ─── piezas ──────────────────────────────────────────────────────────────────────────────

const control: CSSProperties = { height: 34, padding: '0 12px', border: `1px solid ${GRY}`, borderRadius: R,
    background: '#fff', font: 'inherit', fontSize: 13, color: BLK, cursor: 'pointer' };
const card: CSSProperties = { background: '#fff', border: `1px solid ${LGT}`, borderRadius: R, padding: '16px 18px' };
const eyebrowS: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: GRY };
const h3: CSSProperties = { fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 20, margin: 0 };

function contar(xs: Cierre[], key: (c: Cierre) => string | null): [string, number][] {
    const m = new Map<string, number>();
    for (const c of xs) { const k = key(c); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}
function opcColoniaDe(xs: Cierre[], alc: string[]): Set<string> {
    return new Set(xs.filter((c) => !alc.length || alc.includes(c.alcaldia ?? '')).map((c) => c.colonia ?? ''));
}
function top(xs: Cierre[], key: (c: Cierre) => string | null, min: number) {
    const g = new Map<string, number[]>();
    for (const c of xs) { const k = key(c); if (k) (g.get(k) ?? g.set(k, []).get(k)!).push(c.precioM2); }
    return [...g.entries()].filter(([, v]) => v.length >= min)
        .map(([k, v]) => ({ k, med: mediana(v), n: v.length }))
        .sort((a, b) => b.med - a.med).slice(0, 5);
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
    return (
        <div style={{ display: 'inline-flex', border: `1px solid ${BLK}`, borderRadius: R, overflow: 'hidden' }}>
            {options.map(([v, l]) => (
                <button key={v} onClick={() => onChange(v)} style={{ height: 32, padding: '0 16px', border: 'none', font: 'inherit',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', background: value === v ? BLK : '#fff', color: value === v ? '#fff' : BLK }}>{l}</button>
            ))}
        </div>
    );
}

function Multi({ label, opciones, sel, onChange }:
    { label: string; opciones: [string, number][]; sel: string[]; onChange: (v: string[]) => void }) {
    const [abierto, setAbierto] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!abierto) return;
        const cerrar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
        document.addEventListener('mousedown', cerrar);
        return () => document.removeEventListener('mousedown', cerrar);
    }, [abierto]);
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const lista = opciones.filter(([k]) => !q || norm(k).includes(norm(q))).slice(0, 80);
    const toggle = (k: string) => onChange(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
    const txt = sel.length === 0 ? label : sel.length === 1 ? sel[0] : `${sel.length} ${label.toLowerCase()}`;
    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button onClick={() => setAbierto((x) => !x)}
                style={{ ...control, borderColor: sel.length ? BLK : GRY, fontWeight: sel.length ? 700 : 400, maxWidth: 220,
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {txt} ▾
            </button>
            {abierto && (
                <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 20, width: 280, background: '#fff',
                              border: `1px solid ${BLK}`, borderRadius: R, padding: 10 }}>
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${label.toLowerCase()}…`}
                        style={{ ...control, width: '100%', cursor: 'text', boxSizing: 'border-box', marginBottom: 8 }} />
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {lista.length === 0 && <div style={{ fontSize: 12, color: GRY, padding: 6 }}>Sin resultados</div>}
                        {lista.map(([k, n]) => (
                            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} style={{ accentColor: BLK }} />
                                <span style={{ flex: 1 }}>{k}</span><span style={{ color: GRY, fontSize: 11 }}>{f0(n)}</span>
                            </label>
                        ))}
                    </div>
                    {sel.length > 0 && (
                        <button onClick={() => onChange([])} style={{ marginTop: 6, border: 'none', background: 'none', padding: 4,
                            font: 'inherit', fontSize: 12, color: MUTED, textDecoration: 'underline', cursor: 'pointer' }}>Quitar selección</button>
                    )}
                </div>
            )}
        </div>
    );
}

function Kpi({ eyebrow, value, note, color = BLK }: { eyebrow: string; value: string; note?: ReactNode; color?: string }) {
    return (
        <div style={{ ...card, background: LGT, border: 'none' }}>
            <div style={eyebrowS}>{eyebrow}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 34, lineHeight: 1.1, margin: '8px 0 6px', color,
                          fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            {note && <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.4 }}>{note}</div>}
        </div>
    );
}

function Top({ titulo, filas, min }: { titulo: string; filas: { k: string; med: number; n: number }[]; min: number }) {
    const max = Math.max(...filas.map((f) => f.med), 1);
    return (
        <div style={card}>
            <h3 style={h3}>{titulo}</h3>
            <div style={{ fontSize: 11.5, color: MUTED, margin: '3px 0 12px' }}>Mediana de $/m² · zonas con {min}+ cierres</div>
            {filas.length === 0 && <div style={{ fontSize: 12.5, color: GRY, padding: '14px 0' }}>Ninguna zona llega a {min} cierres con estos filtros.</div>}
            {filas.map((f, i) => (
                <div key={f.k} style={{ padding: '8px 0', borderTop: i ? `1px solid ${LGT}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: i === 0 ? BLK : GRY }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.k}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(f.med)}/m²</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, paddingLeft: 28 }}>
                        <div style={{ flex: 1, height: 4, background: LGT, borderRadius: 2 }}>
                            <div style={{ width: `${(f.med / max) * 100}%`, height: 4, borderRadius: 2, background: i === 0 ? YEL : BLK }} />
                        </div>
                        <span style={{ fontSize: 11, color: GRY, width: 74, textAlign: 'right' }}>{f0(f.n)} cierres</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Mediana mensual de $/m². Un mes con menos de `min` cierres queda como hueco, no como punto. */
function Evolucion({ cierres, min, hasta }: { cierres: Cierre[]; min: number; hasta: string }) {
    const [hover, setHover] = useState<number | null>(null);
    const serie = useMemo(() => {
        if (!cierres.length) return [];
        const g = new Map<string, number[]>();
        for (const c of cierres) (g.get(c.mes) ?? g.set(c.mes, []).get(c.mes)!).push(c.precioM2);
        const meses = [...g.keys()].sort();
        const out: { mes: string; med: number | null; n: number }[] = [];
        for (let m = meses[0]; m <= hasta; m = sumaMeses(m, 1)) {
            const v = g.get(m) ?? [];
            out.push({ mes: m, med: v.length >= min ? mediana(v) : null, n: v.length });
        }
        return out;
    }, [cierres, min, hasta]);

    const W = 960, H = 260, P = { l: 56, r: 16, t: 14, b: 30 };
    const vals = serie.map((s) => s.med).filter((v): v is number => v !== null);
    const conDatos = vals.length >= 2;
    let lo = conDatos ? Math.min(...vals) : 0, hi = conDatos ? Math.max(...vals) : 1;
    const pad = (hi - lo) * 0.12 || hi * 0.1; lo = Math.max(0, lo - pad); hi += pad;
    const x = (i: number) => P.l + (serie.length <= 1 ? 0 : (i / (serie.length - 1)) * (W - P.l - P.r));
    const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);

    // tramos continuos (los huecos cortan la línea)
    const tramos: string[] = [];
    let cur = '';
    serie.forEach((s, i) => {
        if (s.med === null) { if (cur) tramos.push(cur); cur = ''; return; }
        cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.med).toFixed(1)}`;
    });
    if (cur) tramos.push(cur);

    const ultimo = [...serie].reverse().find((s) => s.med !== null);
    const h = hover !== null ? serie[hover] : null;

    return (
        <div style={{ ...card, marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={h3}>Evolución del precio por m²</h3>
                {ultimo?.med && <span style={{ fontSize: 12.5, fontWeight: 700 }}>{money(ultimo.med)}/m² <span style={{ color: GRY, fontWeight: 400 }}>· {mesLbl(ultimo.mes)}</span></span>}
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, margin: '3px 0 10px' }}>
                Mediana mensual con los filtros de zona y tipo. Los meses con menos de {min} cierres quedan en blanco.
            </div>
            {!conDatos ? (
                <div style={{ fontSize: 12.5, color: GRY, padding: '30px 0' }}>No hay suficientes meses con {min}+ cierres para dibujar la tendencia.</div>
            ) : (
                <div style={{ position: 'relative' }}>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
                         onMouseLeave={() => setHover(null)} role="img" aria-label="Evolución mensual del precio por m²">
                        {ticks.map((t) => (
                            <g key={t}>
                                <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={LGT} />
                                <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{moneyK(t)}</text>
                            </g>
                        ))}
                        {serie.map((s, i) => (s.mes.endsWith('-01') || i === 0) && (
                            <text key={s.mes} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'middle'} fontSize={11} fill={MUTED}>
                                {s.mes.endsWith('-01') ? s.mes.slice(0, 4) : mesLbl(s.mes)}
                            </text>
                        ))}
                        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke={GRY} strokeDasharray="3 3" />}
                        {tramos.map((t, i) => <path key={i} d={t} fill="none" stroke={BLK} strokeWidth={2} strokeLinejoin="round" />)}
                        {serie.map((s, i) => s.med !== null && (
                            <circle key={s.mes} cx={x(i)} cy={y(s.med)} r={hover === i ? 5 : 3}
                                    fill={hover === i ? YEL : BLK} stroke="#fff" strokeWidth={2} />
                        ))}
                        {/* zonas de hover más anchas que el punto */}
                        {serie.map((s, i) => (
                            <rect key={`h${s.mes}`} x={x(i) - (W - P.l - P.r) / serie.length / 2} y={P.t}
                                  width={(W - P.l - P.r) / serie.length} height={H - P.t - P.b} fill="transparent"
                                  onMouseEnter={() => setHover(i)} />
                        ))}
                    </svg>
                    {h && (
                        <div style={{ position: 'absolute', top: 0, left: `${(x(hover!) / W) * 100}%`,
                                      transform: `translateX(${x(hover!) > W * 0.7 ? '-105%' : '8px'})`, pointerEvents: 'none',
                                      background: BLK, color: '#fff', borderRadius: R, padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 700 }}>{mesLbl(h.mes)}</div>
                            <div>{h.med !== null ? `${money(h.med)}/m²` : `Menos de ${min} cierres`}</div>
                            <div style={{ color: GRY }}>{f0(h.n)} {h.n === 1 ? 'cierre' : 'cierres'}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

type Orden = 'mes' | 'precio' | 'precioM2' | 'm2';
const POR_PAG = 12;

function Lista({ cierres }: { cierres: Cierre[] }) {
    const [vista, setVista] = useState<'cards' | 'tabla'>('cards');
    const [q, setQ] = useState('');
    const [orden, setOrden] = useState<{ k: Orden; desc: boolean }>({ k: 'mes', desc: true });
    const [pag, setPag] = useState(0);

    const filas = useMemo(() => {
        const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const nq = norm(q.trim());
        const xs = nq ? cierres.filter((c) => norm([c.calle, c.colonia, c.alcaldia, c.desarrollo, c.tipo].filter(Boolean).join(' ')).includes(nq)) : cierres;
        const s = orden.desc ? -1 : 1;
        return [...xs].sort((a, b) => (a[orden.k] < b[orden.k] ? -s : a[orden.k] > b[orden.k] ? s : 0));
    }, [cierres, q, orden]);
    useEffect(() => setPag(0), [cierres, q, orden]);

    const nPag = Math.max(1, Math.ceil(filas.length / POR_PAG));
    const pagina = filas.slice(pag * POR_PAG, (pag + 1) * POR_PAG);
    const ordBtn = (k: Orden, l: string) => (
        <button key={k} onClick={() => setOrden((o) => ({ k, desc: o.k === k ? !o.desc : true }))}
            style={{ border: 'none', background: 'none', font: 'inherit', fontSize: 12.5, cursor: 'pointer', padding: '4px 6px',
                     fontWeight: orden.k === k ? 700 : 400, color: orden.k === k ? BLK : MUTED }}>
            {l}{orden.k === k ? (orden.desc ? ' ↓' : ' ↑') : ''}
        </button>
    );

    return (
        <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                <div>
                    <h3 style={h3}>Cierres</h3>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>{f0(filas.length)} cierres con estos filtros</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Seg value={vista} onChange={(v) => setVista(v as 'cards' | 'tabla')} options={[['cards', 'Tarjetas'], ['tabla', 'Tabla']]} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar calle, colonia, desarrollo…"
                        style={{ ...control, cursor: 'text', width: 230 }} />
                </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: GRY, marginRight: 4 }}>Ordenar por</span>
                {ordBtn('mes', 'Fecha')}{ordBtn('precio', 'Precio')}{ordBtn('precioM2', 'Precio/m²')}{ordBtn('m2', 'Superficie')}
            </div>

            {pagina.length === 0 && <div style={{ fontSize: 12.5, color: GRY, padding: '20px 0' }}>Sin cierres con estos filtros.</div>}

            {vista === 'cards' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                    {pagina.map((c, i) => (
                        <div key={i} style={{ border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 16px 12px' }}>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 18, lineHeight: 1.2 }}>{c.calle ?? c.colonia ?? 'Sin dirección'}</div>
                                <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{[c.colonia, c.alcaldia].filter(Boolean).join(' · ')}</div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                                    <Tag>{c.operacion}</Tag><Tag>{c.tipo}</Tag>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: 12 }}>
                                    <Dato k="Fecha" v={mesLbl(c.mes)} />
                                    <Dato k="Superficie" v={`${f0(c.m2)} m²`} />
                                    <Dato k="Recámaras" v={c.recamaras ? f0(c.recamaras) : '—'} />
                                    <Dato k="Desarrollo" v={c.desarrollo ?? '—'} />
                                </div>
                            </div>
                            <div style={{ background: LGT, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                <div><div style={eyebrowS}>Precio de cierre</div><div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(c.precio)}</div></div>
                                <div style={{ textAlign: 'right' }}><div style={eyebrowS}>Por m²</div><div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(c.precioM2)}</div></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead><tr>{['Fecha', 'Calle', 'Colonia', 'Alcaldía', 'Tipo', 'Desarrollo', 'm²', 'Precio', '$/m²'].map((t, i) => (
                            <th key={t} style={{ textAlign: i >= 6 ? 'right' : 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 10,
                                                 textTransform: 'uppercase', letterSpacing: '.5px', color: MUTED, whiteSpace: 'nowrap' }}>{t}</th>))}</tr></thead>
                        <tbody>{pagina.map((c, i) => (
                            <tr key={i}>
                                {[mesLbl(c.mes), c.calle ?? '—', c.colonia ?? '—', c.alcaldia ?? '—', c.tipo, c.desarrollo ?? '—'].map((v, j) => (
                                    <td key={j} style={{ padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' }}>{v}</td>))}
                                {[f0(c.m2), money(c.precio), money(c.precioM2)].map((v, j) => (
                                    <td key={`n${j}`} style={{ padding: '7px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: j ? 700 : 400 }}>{v}</td>))}
                            </tr>))}
                        </tbody>
                    </table>
                </div>
            )}

            {nPag > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14, fontSize: 13 }}>
                    <button disabled={pag === 0} onClick={() => setPag((p) => p - 1)} style={{ ...control, opacity: pag === 0 ? 0.4 : 1 }}>← Anterior</button>
                    <span style={{ color: MUTED }}>Página {pag + 1} de {nPag}</span>
                    <button disabled={pag >= nPag - 1} onClick={() => setPag((p) => p + 1)} style={{ ...control, opacity: pag >= nPag - 1 ? 0.4 : 1 }}>Siguiente →</button>
                </div>
            )}
        </div>
    );
}

function Tag({ children }: { children: ReactNode }) {
    return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.8px', textTransform: 'uppercase', border: `1px solid ${GRY}`,
                          borderRadius: R, padding: '2px 7px', color: BLK }}>{children}</span>;
}
function Dato({ k, v }: { k: string; v: string }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.8px', textTransform: 'uppercase', color: GRY }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
        </div>
    );
}
