'use client';

/**
 * Desempeño comercial de la inmobiliaria (oct-2026). Integra el reporte que armó Lau (KAM) en
 * la app de /mb: hereda el login con Google y `canAccessCompany`.
 *
 *   Comercial — leads únicos, leads por asesor y mes, visitas agendadas y Funnel comercial |
 *               Búsquedas (por cambio de etapa, NO la cohorte de /portales).
 *   Cierres   — resumen, cierres por fuente y detalle con los días de cada etapa del comprador.
 *
 * El PDF lleva las DOS sub-pestañas y las listas abiertas: es para exportar con todos los datos.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { CierreMb, DesempenoMb, Funnel, VisitaMb } from '@/lib/desempenoMb';
import PrintRoot from './PrintRoot';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
type Op = 'sale' | 'rent';
type OpF = 'todas' | Op;
type Modo = 'mes' | 'trimestre' | 'ytd' | 'rango';

const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
const money = (x: number | null | undefined, cur = 'MXN') => (x == null ? '—' : `${cur !== 'MXN' ? cur + ' ' : '$'}${Math.round(x).toLocaleString('es-MX')}`);
const mesLargo = (ym: string) => `${MESL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fechaCorta = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${d} ${MESL[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
};
const fechaHora = (iso: string) => `${fechaCorta(iso)} · ${iso.slice(11, 16)}`;
const opTxt = (op: string) => (op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : '—');
const promedio = (xs: Array<number | null>) => { const a = xs.filter((x): x is number => x != null); return a.length ? Math.round(a.reduce((p, q) => p + q, 0) / a.length) : null; };
const mediana = (xs: Array<number | null>) => { const a = xs.filter((x): x is number => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const hoyMx = () => new Date(Date.now() - 6 * 3600 * 1000);

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px' };
const thN: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const tdN: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sub: CSSProperties = { fontSize: 10.5, color: '#777', marginTop: 2 };

function Seccion({ titulo, nota, children }: { titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 26 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 820 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Kpi({ label, value, nota }: { label: string; value: string; nota?: string }) {
    return (
        <div style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 25, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}</div>
            {nota && <div style={{ fontSize: 10.5, color: '#777' }}>{nota}</div>}
        </div>
    );
}
function Pills<T extends string>({ val, opts, set }: { val: T; opts: Array<[T, string]>; set: (x: T) => void }) {
    return (
        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
            {opts.map(([k, l]) => (
                <button key={k} type="button" onClick={() => set(k)} style={{ padding: '6px 11px', fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: val === k ? BLK : '#fff', color: val === k ? '#fff' : '#555', fontWeight: val === k ? 700 : 400 }}>{l}</button>
            ))}
        </span>
    );
}
function Tabla({ children, min = 560 }: { children: ReactNode; min?: number }) {
    return <div style={{ overflowX: 'auto' }} className="print-wide"><table style={{ width: '100%', minWidth: min, borderCollapse: 'collapse' }}>{children}</table></div>;
}
/** Etiqueta de color (lado del cierre, quién trajo al comprador, asesor inactivo). */
const TAGS: Record<string, CSSProperties> = {
    Comprador: { background: SEA, color: '#fff' },
    Vendedor: { background: YEL, color: BLK },
    Ambos: { background: BLK, color: '#fff' },
    'Broker externo': { background: '#fff', color: BLK, border: `1px solid ${BLK}` },
    'Red Pulppo': { background: LGT, color: BLK },
    inactivo: { background: '#fff', color: '#777', border: `1px solid ${GRY}` },
};
function Tag({ t, children }: { t: string; children?: ReactNode }) {
    return <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: R, lineHeight: '15px', whiteSpace: 'nowrap',
        border: '1px solid transparent', ...(TAGS[t] ?? { background: LGT, color: BLK }) }}>{children ?? t}</span>;
}

/** barra horizontal con su etiqueta (funnel y fuentes) */
function Barra({ etq, detalle, valor, frac, extra }: { etq: string; detalle?: string; valor: string; frac: number; extra?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0', fontSize: 12 }}>
            <span style={{ width: 190, flexShrink: 0 }}>{etq}{detalle && <span style={{ display: 'block', fontSize: 10.5, color: '#777' }}>{detalle}</span>}</span>
            <span style={{ flex: 1, background: LGT, height: 14, position: 'relative', minWidth: 60 }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: BLK }} />
            </span>
            <span style={{ width: 120, textAlign: 'right' }}><b>{valor}</b>{extra && <span style={{ display: 'block', fontSize: 10.5, color: '#777' }}>{extra}</span>}</span>
        </div>
    );
}

export default function MBDesempeno({ companyId }: { companyId: string }) {
    const hoy = useMemo(hoyMx, []);
    const mesHoy = iso(hoy).slice(0, 7);
    const [modo, setModo] = useState<Modo>('mes');
    const [mes, setMes] = useState(mesHoy);
    const [anioQ, setAnioQ] = useState(hoy.getUTCFullYear());
    const [q, setQ] = useState(Math.floor(hoy.getUTCMonth() / 3) + 1);
    const [rDesde, setRDesde] = useState(`${iso(hoy).slice(0, 7)}-01`);
    const [rHasta, setRHasta] = useState(iso(hoy));
    const [op, setOp] = useState<OpF>('todas');
    const [asesor, setAsesor] = useState('');
    const [vista, setVista] = useState<'comercial' | 'cierres'>('comercial');
    const [d, setD] = useState<DesempenoMb | null>(null);
    const [cargando, setCargando] = useState(false);
    const [err, setErr] = useState('');

    const { desde, hasta } = useMemo(() => {
        const finMes = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
        // Mes y trimestre van COMPLETOS aunque estén en curso (como el reporte de Lau): las visitas ya
        // agendadas para lo que resta del mes son justo las pendientes que hay que confirmar.
        if (modo === 'mes') { const [y, m] = mes.split('-').map(Number); return { desde: `${mes}-01`, hasta: finMes(y, m) }; }
        if (modo === 'trimestre') { const m0 = (q - 1) * 3 + 1; return { desde: `${anioQ}-${String(m0).padStart(2, '0')}-01`, hasta: finMes(anioQ, m0 + 2) }; }
        if (modo === 'ytd') return { desde: `${hoy.getUTCFullYear()}-01-01`, hasta: iso(hoy) };
        return { desde: rDesde, hasta: rHasta };
    }, [modo, mes, q, anioQ, rDesde, rHasta, hoy]);

    useEffect(() => {
        if (!desde || !hasta || desde > hasta) { setErr('El periodo termina antes de empezar.'); return; }
        let vivo = true;
        const t = setTimeout(() => {
            setCargando(true); setErr('');
            const qs = new URLSearchParams({ company: companyId, desde, hasta, ...(asesor ? { asesor } : {}) });
            fetch(`/api/mb-desempeno?${qs}`)
                .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
                .then(({ ok, j }) => { if (!vivo) return; if (ok) setD(j); else setErr(j.error || 'No se pudo calcular'); })
                .catch(() => vivo && setErr('No se pudo calcular'))
                .finally(() => vivo && setCargando(false));
        }, modo === 'rango' ? 700 : 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [companyId, desde, hasta, asesor, modo]);

    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };
    const lbl: CSSProperties = { fontSize: 10, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', display: 'block', marginBottom: 3 };
    const anios = Array.from({ length: 4 }, (_, i) => hoy.getUTCFullYear() - i);
    const nombreAsesor = d?.asesores.find((a) => a.id === asesor)?.nombre;

    return (
        <div>
            <div className="no-print" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', paddingBottom: 14, marginBottom: 6, borderBottom: `1px solid ${LGT}` }}>
                <div>
                    <span style={lbl}>Periodo</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Pills val={modo} set={setModo} opts={[['mes', 'Mes'], ['trimestre', 'Trimestre'], ['ytd', 'YTD'], ['rango', 'Fechas']]} />
                        {modo === 'mes' && <input type="month" value={mes} max={mesHoy} onChange={(e) => e.target.value && setMes(e.target.value)} style={inp} />}
                        {modo === 'trimestre' && (() => {
                            // año con flechas + los 4 trimestres con sus meses; los que no han empezado, apagados
                            const qHoy = Math.floor(hoy.getUTCMonth() / 3) + 1, yHoy = hoy.getUTCFullYear();
                            const futuro = (y: number, x: number) => y > yHoy || (y === yHoy && x > qHoy);
                            const flecha = (dy: number, off: boolean) => (
                                <button type="button" disabled={off} onClick={() => { const y = anioQ + dy; setAnioQ(y); if (futuro(y, q)) setQ(qHoy); }}
                                    style={{ border: 'none', background: 'none', cursor: off ? 'default' : 'pointer', color: off ? LGT : BLK, fontSize: 14, padding: '0 6px', fontFamily: 'inherit' }}>{dy < 0 ? '‹' : '›'}</button>
                            );
                            const MQ = ['ene – mar', 'abr – jun', 'jul – sep', 'oct – dic'];
                            return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${LGT}`, borderRadius: R }}>
                                    {flecha(-1, anioQ <= anios[anios.length - 1])}
                                    <span style={{ fontSize: 12, fontWeight: 700, minWidth: 34, textAlign: 'center' }}>{anioQ}</span>
                                    {flecha(1, anioQ >= yHoy)}
                                    {[1, 2, 3, 4].map((x) => {
                                        const off = futuro(anioQ, x), on = q === x;
                                        return (
                                            <button key={x} type="button" disabled={off} onClick={() => setQ(x)} title={off ? 'Todavía no empieza' : ''}
                                                style={{ border: 'none', borderLeft: `1px solid ${LGT}`, padding: '4px 10px', cursor: off ? 'default' : 'pointer', fontFamily: 'inherit', lineHeight: 1.15,
                                                    background: on ? BLK : '#fff', color: on ? '#fff' : off ? GRY : BLK, textAlign: 'center' }}>
                                                <span style={{ display: 'block', fontSize: 12, fontWeight: 700 }}>T{x}</span>
                                                <span style={{ display: 'block', fontSize: 9.5, color: on ? '#ddd' : off ? GRY : '#777' }}>{MQ[x - 1]}</span>
                                            </button>
                                        );
                                    })}
                                </span>
                            );
                        })()}
                        {modo === 'rango' && <>
                            <input type="date" value={rDesde} max={rHasta} onChange={(e) => e.target.value && setRDesde(e.target.value)} style={inp} />
                            <span style={{ color: GRY, fontSize: 12 }}>a</span>
                            <input type="date" value={rHasta} min={rDesde} max={iso(hoy)} onChange={(e) => e.target.value && setRHasta(e.target.value)} style={inp} />
                        </>}
                    </div>
                </div>
                <div><span style={lbl}>Operación</span><Pills val={op} set={setOp} opts={[['todas', 'Todo'], ['sale', 'Venta'], ['rent', 'Renta']]} /></div>
                <div>
                    <span style={lbl}>Asesor</span>
                    <select value={asesor} onChange={(e) => setAsesor(e.target.value)} style={{ ...inp, minWidth: 200 }}>
                        <option value="">Todos los asesores</option>
                        {(d?.asesores ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.activo ? '' : ' (inactivo)'}</option>)}
                    </select>
                </div>
                <div style={{ flex: 1 }} />
                {cargando && <span style={{ fontSize: 11.5, color: '#8A6D00', fontWeight: 700 }}>Actualizando…</span>}
                <button type="button" onClick={() => window.print()} disabled={!d}
                    style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: R, border: `1px solid ${BLK}`, background: '#fff', color: BLK, cursor: d ? 'pointer' : 'default' }}>
                    Descargar PDF
                </button>
            </div>

            {err && <p style={{ fontSize: 13, color: RED }}>{err}</p>}
            {!d && !err && <p style={{ fontSize: 13, color: GRY }}>Calculando en vivo…</p>}
            {d && (
                <div id="mb-desempeno" style={{ opacity: cargando ? 0.5 : 1, transition: 'opacity .15s' }}>
                    <PrintRoot id="mb-desempeno" orientation="landscape" extra={`
                        #mb-desempeno .print-only { display: block !important; }
                        #mb-desempeno .vista-oculta { display: block !important; }
                        #mb-desempeno .lista-cuerpo { display: block !important; }
                        #mb-desempeno table { font-size: 8px !important; }
                        #mb-desempeno table th, #mb-desempeno table td { padding: 3px !important; }
                    `} />
                    {/* encabezado que sólo existe en el PDF */}
                    <div className="print-only" style={{ display: 'none', background: BLK, color: '#fff', borderRadius: R, padding: '16px 20px', marginBottom: 12 }}>
                        <div style={{ width: 40, height: 2, background: YEL, marginBottom: 10 }} />
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: '#c9c9c7' }}>Desempeño comercial</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, marginTop: 4 }}>{d.inmobiliaria}</div>
                        <div style={{ fontSize: 11, color: '#c9c9c7', marginTop: 4 }}>
                            {fechaCorta(d.desde)} – {fechaCorta(d.hasta)} · {op === 'todas' ? 'venta y renta' : opTxt(op).toLowerCase()} · {nombreAsesor ?? 'todos los asesores'}
                        </div>
                    </div>

                    <div className="no-print" style={{ display: 'flex', gap: 0, margin: '14px 0 0', borderBottom: `1px solid ${LGT}` }}>
                        {([['comercial', 'Comercial'], ['cierres', 'Cierres']] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setVista(k)} style={{ padding: '8px 16px', fontSize: 13, border: 'none', borderBottom: `2px solid ${vista === k ? YEL : 'transparent'}`,
                                background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: vista === k ? 700 : 400, color: vista === k ? BLK : '#777' }}>{l}</button>
                        ))}
                    </div>
                    <div className={vista === 'comercial' ? '' : 'vista-oculta'} style={{ display: vista === 'comercial' ? 'block' : 'none' }}>
                        <Comercial d={d} op={op} conAsesor={!asesor} />
                    </div>
                    <div className={vista === 'cierres' ? '' : 'vista-oculta'} style={{ display: vista === 'cierres' ? 'block' : 'none' }}>
                        <Cierres d={d} op={op} conAsesor={!asesor} />
                    </div>
                    <p style={{ fontSize: 10, color: GRY, marginTop: 18 }}>En vivo desde Mongo · {new Date(d.generado).toLocaleString('es-MX')}</p>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────── Comercial ───────────────────────────────
function Comercial({ d, op, conAsesor }: { d: DesempenoMb; op: OpF; conAsesor: boolean }) {
    const ops: Op[] = op === 'todas' ? ['sale', 'rent'] : [op];
    const suma = (k: 'leads' | 'confirmadas' | 'pendientes') => ops.reduce((s, o) => s + d.totales[o][k], 0);
    const visitas = d.visitas.filter((v) => (ops as string[]).includes(v.op));
    const aten = ops.reduce((a, o) => ({ base: a.base + d.atencion[o].base, sin: a.sin + d.atencion[o].sin }), { base: 0, sin: 0 });
    const cierres = d.cierres.filter((c) => (ops as string[]).includes(c.op));
    const ofertas = ops.reduce((s, o) => s + d.ofertasActivas[o], 0);

    // mapa de calor: leads únicos por asesor y mes
    const filasAsesor = d.porAsesor.map((a) => ({
        nombre: a.nombre, activo: a.activo,
        meses: d.meses.map((m) => ops.reduce((s, o) => s + (a.meses[m.mes]?.[o] ?? 0), 0)),
    })).map((a) => ({ ...a, total: a.meses.reduce((s, x) => s + x, 0) })).filter((a) => a.total > 0).sort((x, y) => y.total - x.total);
    const maxCelda = Math.max(1, ...filasAsesor.flatMap((a) => a.meses));
    const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

    return (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <Kpi label="Leads únicos" value={f0(suma('leads'))} nota="mismo cliente + misma propiedad = 1" />
            <Kpi label="Visitas agendadas" value={f0(suma('confirmadas') + suma('pendientes'))} nota={`${f0(suma('confirmadas'))} confirmadas · ${f0(suma('pendientes'))} pendientes`} />
            <Kpi label="Ofertas activas" value={f0(ofertas)} nota="foto de hoy: en oferta o contrato" />
            <Kpi label="Cierres del periodo" value={f0(cierres.length)} nota={`${f0(cierres.filter((c) => c.op === 'sale').length)} venta · ${f0(cierres.filter((c) => c.op === 'rent').length)} renta`} />
            <Kpi label="Asesor sin responder" value={aten.base ? `${Math.round((1000 * aten.sin) / aten.base) / 10}%` : '—'} nota="leads de 9:00 a 20:59" />
        </div>

        <Seccion titulo="Leads únicos por mes" nota="Consultas de compradores o arrendatarios. Un mismo cliente sobre la misma propiedad cuenta una vez.">
            <Tabla min={420}>
                <thead><tr><th style={th}>Mes</th>{ops.map((o) => <th key={o} style={thN}>{opTxt(o)}</th>)}{ops.length > 1 && <th style={thN}>Total</th>}</tr></thead>
                <tbody>
                    {d.meses.map((m) => (
                        <tr key={m.mes}>
                            <td style={td}>{mesLargo(m.mes)}{m.enCurso && <span style={{ ...sub, display: 'inline', marginLeft: 6 }}>en curso</span>}</td>
                            {ops.map((o) => <td key={o} style={tdN}>{f0(m[o].leads)}</td>)}
                            {ops.length > 1 && <td style={{ ...tdN, fontWeight: 700 }}>{f0(m.sale.leads + m.rent.leads)}</td>}
                        </tr>
                    ))}
                    {d.meses.length > 1 && <tr><td style={{ ...td, fontWeight: 700 }}>Total</td>{ops.map((o) => <td key={o} style={{ ...tdN, fontWeight: 700 }}>{f0(d.totales[o].leads)}</td>)}{ops.length > 1 && <td style={{ ...tdN, fontWeight: 700 }}>{f0(suma('leads'))}</td>}</tr>}
                </tbody>
            </Tabla>
            {d.sinOperacion.leads > 0 && <div style={sub}>Además hay {f0(d.sinOperacion.leads)} leads de propiedades sin operación definida; no se incluyen arriba.</div>}
        </Seccion>

        {conAsesor && <Seccion titulo="Leads únicos por asesor y mes" nota="Dónde está el volumen. El color más intenso es el mes con más leads de toda la tabla.">
            <Tabla min={520}>
                <thead><tr><th style={th}>Asesor</th>{d.meses.map((m) => <th key={m.mes} style={thN}>{MESL[Number(m.mes.slice(5, 7)) - 1].slice(0, 3)}</th>)}<th style={thN}>Total</th></tr></thead>
                <tbody>
                    {filasAsesor.map((a) => (
                        <tr key={a.nombre}>
                            <td style={{ ...td, whiteSpace: 'nowrap', color: a.activo ? BLK : '#777' }}>{a.nombre}{!a.activo && <span style={{ marginLeft: 6 }}><Tag t="inactivo" /></span>}</td>
                            {a.meses.map((v, i) => <td key={i} style={{ ...tdN, background: v ? `rgba(246,190,0,${(v / maxCelda) * .55})` : undefined }}>{v || ''}</td>)}
                            <td style={{ ...tdN, fontWeight: 700 }}>{f0(a.total)}</td>
                        </tr>
                    ))}
                </tbody>
            </Tabla>
        </Seccion>}

        <Seccion titulo="Visitas agendadas" nota="Por fecha de la visita. No incluye canceladas. «Confirmada» significa que la visita se confirmó en la plataforma; no garantiza que el cliente haya asistido.">
            <Tabla min={520}>
                <thead><tr><th style={th}>Mes</th>{ops.flatMap((o) => [<th key={o + 'c'} style={thN}>{opTxt(o)} · confirmadas</th>, <th key={o + 'p'} style={thN}>{opTxt(o)} · pendientes</th>])}<th style={thN}>Total</th></tr></thead>
                <tbody>
                    {d.meses.map((m) => (
                        <tr key={m.mes}>
                            <td style={td}>{mesLargo(m.mes)}</td>
                            {ops.flatMap((o) => [<td key={o + 'c'} style={tdN}>{f0(m[o].confirmadas)}</td>, <td key={o + 'p'} style={tdN}>{f0(m[o].pendientes)}</td>])}
                            <td style={{ ...tdN, fontWeight: 700 }}>{f0(ops.reduce((s, o) => s + m[o].confirmadas + m[o].pendientes, 0))}</td>
                        </tr>
                    ))}
                </tbody>
            </Tabla>
            {([['pending', 'Pendientes de confirmar'], ['confirmed', 'Confirmadas']] as const).map(([st, titulo]) => {
                const vs = visitas.filter((v) => v.status === st);
                const venc = vs.filter((v) => v.vencida).length;
                const abierta = abiertas[st] ?? (st === 'pending' && vs.length > 0);
                return (
                    <div key={st} style={{ marginTop: 12 }}>
                        <button type="button" className="no-print" onClick={() => setAbiertas((p) => ({ ...p, [st]: !abierta }))} disabled={!vs.length}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: vs.length ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12.5, color: BLK }}>
                            {vs.length ? (abierta ? '▾' : '▸') : '·'} {titulo} <b>{f0(vs.length)}</b>{venc > 0 && <span style={{ color: RED, marginLeft: 6 }}>· {f0(venc)} con fecha pasada</span>}
                        </button>
                        <div className="print-only" style={{ display: 'none', fontSize: 12, fontWeight: 700, margin: '8px 0 4px' }}>{titulo} · {f0(vs.length)}</div>
                        {vs.length > 0 && <div className="lista-cuerpo" style={{ display: abierta ? 'block' : 'none', marginTop: 6 }}><ListaVisitas vs={vs} conAsesor={conAsesor} /></div>}
                    </div>
                );
            })}
        </Seccion>

        <Seccion titulo="Funnel comercial | Búsquedas" nota="De las búsquedas abiertas en cada etapa durante el periodo, cuántas pasaron a la siguiente. Mide el avance de las BÚSQUEDAS, no de los leads.">
            <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
                {ops.map((o) => <FunnelOp key={o} f={d.totales[o].funnel} titulo={opTxt(o)} />)}
            </div>
            {d.meses.length > 1 && <>
                <div style={{ marginTop: 14 }} />
                <Tabla min={520}>
                    <thead><tr><th style={th}>Mes</th>{ops.flatMap((o) => (['visita', 'oferta', 'cierre'] as const).map((k) => <th key={o + k} style={thN}>{opTxt(o)} · {k}</th>))}</tr></thead>
                    <tbody>
                        {d.meses.map((m) => (
                            <tr key={m.mes}>
                                <td style={td}>{mesLargo(m.mes)}</td>
                                {ops.flatMap((o) => (['visita', 'oferta', 'cierre'] as const).map((k) => {
                                    const x = m[o].funnel[k];
                                    return <td key={o + k} style={{ ...tdN, color: x.base ? BLK : GRY }} title={x.base ? `${x.n} de ${x.base} búsquedas` : ''}>{x.base ? pc(x.tasa) : '—'}</td>;
                                }))}
                            </tr>
                        ))}
                    </tbody>
                </Tabla>
                <div style={sub}>Cada mes se mide por separado: una búsqueda puede contar en varios meses, así que el total del periodo no es la suma ni el promedio de los meses.</div>
            </>}
            <div style={{ marginTop: 14, padding: '10px 14px', background: LGT, borderRadius: R, fontSize: 11.5, color: '#444', lineHeight: 1.55, maxWidth: 860 }}>
                <b>Cómo se calculan estas tasas.</b> Cada tasa cuenta las búsquedas que <b>cambiaron de etapa dentro del periodo</b>, sobre las búsquedas abiertas que estaban en la etapa anterior. Por ejemplo, si un asesor tenía 10 búsquedas en <i>Buscando</i> y 2 pasaron a <i>Visitando</i>, su tasa de visita es 20%.
                <div style={{ marginTop: 6 }}><b>Por qué no coincide con otras pantallas:</b> aquí sólo cuentan los movimientos que ocurrieron dentro de las fechas elegidas, y la base de cada tasa son las búsquedas que estaban en esa etapa, no el total de leads.</div>
                <div style={{ marginTop: 6, color: '#666' }}><i>Buscando</i> incluye las búsquedas nuevas que aún están pendientes. Saltarse una etapa (de Buscando a Ofertando) cuenta como avance. <i>Cerrando</i> incluye las completadas. Las canceladas en el periodo cuentan en la base pero no como avance. Cada búsqueda cuenta para el asesor que la tiene asignada hoy.</div>
            </div>
        </Seccion>
    </>);
}

function FunnelOp({ f, titulo }: { f: Funnel; titulo: string }) {
    const pasos = [['visita', 'Tasa de visita', 'Buscando → Visitando'], ['oferta', 'Tasa de oferta', 'Visitando → Ofertando'], ['cierre', 'Tasa de cierre', 'Ofertando → Cerrando']] as const;
    const escala = Math.max(0.05, ...pasos.map(([k]) => f[k].tasa ?? 0)) * 1.15;
    return (
        <div style={{ flex: '1 1 380px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>{titulo}</div>
            {pasos.map(([k, l, de]) => (
                <Barra key={k} etq={l} detalle={de} frac={(f[k].tasa ?? 0) / escala} valor={pc(f[k].tasa)} extra={`${f0(f[k].n)} de ${f0(f[k].base)} búsquedas`} />
            ))}
        </div>
    );
}

function ListaVisitas({ vs, conAsesor }: { vs: VisitaMb[]; conAsesor: boolean }) {
    return (
        <Tabla min={640}>
            <thead><tr><th style={th}>Fecha de la visita</th><th style={th}>Búsqueda (cliente)</th><th style={th}>Operación</th><th style={th}>Propiedades</th>{conAsesor && <th style={th}>Asesor</th>}</tr></thead>
            <tbody>
                {vs.map((v) => (
                    <tr key={v.id}>
                        <td style={{ ...td, whiteSpace: 'nowrap', color: v.vencida ? RED : BLK }}>{fechaHora(v.fecha)}{v.vencida && <div style={{ fontSize: 10.5 }}>Fecha pasada</div>}</td>
                        <td style={td}>{v.cliente}</td>
                        <td style={td}>{opTxt(v.op)}</td>
                        <td style={td}>{v.propiedades.map((p, i) => <div key={i}>{[p.codigo, p.titulo, p.colonia].filter(Boolean).join(' · ') || 'Propiedad sin título'}</div>)}</td>
                        {conAsesor && <td style={td}>{v.asesor}</td>}
                    </tr>
                ))}
            </tbody>
        </Tabla>
    );
}

// ─────────────────────────────── Cierres ───────────────────────────────
function Cierres({ d, op, conAsesor }: { d: DesempenoMb; op: OpF; conAsesor: boolean }) {
    const cs = d.cierres.filter((c) => op === 'todas' || c.op === op);
    if (!cs.length) return <p style={{ fontSize: 13, color: '#777', marginTop: 18 }}>No hubo cierres en este periodo.</p>;
    const porFuente = new Map<string, number>();
    for (const c of cs) porFuente.set(c.fuente, (porFuente.get(c.fuente) ?? 0) + 1);
    const fuentes = [...porFuente.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...fuentes.map(([, n]) => n));
    const tile = (o: Op) => {
        const xs = cs.filter((c) => c.op === o && c.inicioTipo === 'busqueda');
        const p = promedio(xs.map((c) => c.diasCierre));
        return <Kpi key={o} label={`Días a cierre · ${opTxt(o).toLowerCase()}`} value={p == null ? '—' : f0(p)}
            nota={xs.length ? `promedio desde la búsqueda · a oferta ${promedio(xs.map((c) => c.diasOferta)) ?? '—'} · mediana ${mediana(xs.map((c) => c.diasCierre))} · ${xs.length} cierres` : 'sin cierres con búsqueda'} />;
    };
    return (<>
        <Seccion titulo="Resumen" nota={`Operaciones cerradas en el periodo, por fecha de cierre. Montos y comisión del lado en el que participó ${d.inmobiliaria}.`}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Kpi label="Cierres" value={f0(cs.length)} nota={`${f0(cs.filter((c) => c.op === 'sale').length)} venta · ${f0(cs.filter((c) => c.op === 'rent').length)} renta`} />
                <Kpi label="Fuente principal" value={fuentes[0][0]} nota={`${fuentes[0][1]} de ${cs.length} cierres (${Math.round((100 * fuentes[0][1]) / cs.length)}%)`} />
                {(op === 'todas' ? (['sale', 'rent'] as Op[]) : [op as Op]).map(tile)}
            </div>
        </Seccion>
        <Seccion titulo="Cierres por fuente" nota={<>El canal por el que llegó el comprador: el que capturó el asesor (o el de la búsqueda). Si no hay, se busca evidencia — el lead del comprador o del broker externo, la búsqueda que se le abrió al broker, un lead con su teléfono u otra operación del mismo inmueble — y al pasar el mouse sobre la fuente se ve cuál se usó; si tiene búsqueda sin fuente, <b>Búsqueda creada por el asesor</b>; y si no, <b>Cartera del asesor</b> (o <b>Sin fuente registrada</b> si al comprador lo trajo otra inmobiliaria). Que lo haya traído un broker externo u otra inmobiliaria de la red no es una fuente: sale como etiqueta en el detalle. Es la misma regla de /portales.</>}>
            {fuentes.map(([f, n]) => <Barra key={f} etq={f} frac={n / max} valor={f0(n)} extra={`${Math.round((100 * n) / cs.length)}%`} />)}
        </Seccion>
        <Seccion titulo="Detalle de cierres" nota="«Por etapa» mide cada paso desde el anterior; «acumulados», todo desde la creación de la búsqueda.">
            <TablaCierres cs={cs} conAsesor={conAsesor} />
            <div style={{ ...sub, maxWidth: 900, lineHeight: 1.5, marginTop: 8 }}>
                Inicio del conteo: la creación de la búsqueda ligada a la operación. Si la operación no tiene búsqueda, su primera visita o, al final, la oferta. Si el comprador es de otra inmobiliaria, Pulppo no tiene su historial. «—» significa que no hay registro de ese paso (por ejemplo, la visita no se capturó en la plataforma). En renta, el monto es la renta mensual. Cuando una venta es entre dos inmobiliarias de la red, cada una ve sólo su lado y su comisión.
            </div>
        </Seccion>
    </>);
}

function TablaCierres({ cs, conAsesor }: { cs: CierreMb[]; conAsesor: boolean }) {
    const dia = (x: number | null) => (x == null ? <span style={{ color: GRY }}>—</span> : f0(x));
    const inicioTxt = (c: CierreMb) => !c.inicio ? '' : c.inicioTipo === 'busqueda' ? `Búsqueda creada el ${fechaCorta(c.inicio)}`
        : c.inicioTipo === 'visita' ? `Primera visita el ${fechaCorta(c.inicio)}` : c.compradorOtraInmo ? `Sin historial del comprador: oferta del ${fechaCorta(c.inicio)}` : `Oferta del ${fechaCorta(c.inicio)}`;
    const g1: CSSProperties = { borderLeft: `1px solid ${LGT}` };
    const total = (o: Op) => {
        const xs = cs.filter((c) => c.op === o);
        if (!xs.length) return null;
        return (
            <tr key={o}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={3}>{opTxt(o)} · total ({xs.length})</td>
                <td style={{ ...tdN, fontWeight: 700 }}>{money(xs.reduce((s, c) => s + (c.monto ?? 0), 0))}{o === 'rent' && <div style={sub}>rentas mensuales</div>}</td>
                <td style={{ ...tdN, fontWeight: 700 }}>{money(xs.reduce((s, c) => s + (c.comision ?? 0), 0))}</td>
                <td style={{ ...td, ...g1 }} colSpan={3} /><td style={{ ...td, ...g1 }} colSpan={3} />{conAsesor && <td style={td} />}
            </tr>
        );
    };
    return (
        <Tabla min={1100}>
            <thead>
                <tr>
                    <th style={th} rowSpan={2}>Cierre</th><th style={th} rowSpan={2}>Cliente y propiedad</th><th style={th} rowSpan={2}>Fuente</th>
                    <th style={thN} rowSpan={2}>Monto de cierre</th><th style={thN} rowSpan={2}>Comisión cobrada</th>
                    <th style={{ ...th, textAlign: 'center', borderBottom: `1px solid ${LGT}`, ...g1 }} colSpan={3}>Días por etapa</th>
                    <th style={{ ...th, textAlign: 'center', borderBottom: `1px solid ${LGT}`, ...g1 }} colSpan={3}>Días acumulados desde la búsqueda</th>
                    {conAsesor && <th style={th} rowSpan={2}>Asesor</th>}
                </tr>
                <tr>
                    <th style={{ ...thN, ...g1 }}>Búsqueda → visita</th><th style={thN}>Visita → oferta</th><th style={thN}>Oferta → cierre</th>
                    <th style={{ ...thN, ...g1 }}>A visita</th><th style={thN}>A oferta</th><th style={thN}>A cierre</th>
                </tr>
            </thead>
            <tbody>
                {cs.map((c) => (
                    <tr key={c.id + c.lado}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fechaCorta(c.fechaCierre)}<div style={sub}>{opTxt(c.op)}</div><div style={{ marginTop: 4 }}><Tag t={c.lado}>{c.lado === 'Ambos' ? 'Ambos lados' : `Lado ${c.lado.toLowerCase()}`}</Tag></div>{c.estado === 'paying' && <div style={{ ...sub, color: '#8A6D00' }}>en cobranza</div>}</td>
                        <td style={td}><b>{c.cliente === 'Sin nombre' && c.inmoComprador ? `Comprador de ${c.inmoComprador}` : c.cliente}</b>
                            <div style={sub}>{[c.codigo, c.tipo].filter(Boolean).join(' · ')}</div><div style={sub}>{c.direccion || 'Sin dirección'}</div></td>
                        <td style={td}><b title={c.evidencia ?? undefined}>{c.fuente}</b>{c.comprador && <div style={{ marginTop: 4 }}><Tag t={c.comprador}>Comprador: {c.comprador.toLowerCase()}</Tag></div>}<div style={sub}>{inicioTxt(c)}</div></td>
                        <td style={tdN}>{money(c.monto, c.moneda)}{c.op === 'rent' && <div style={sub}>al mes</div>}</td>
                        <td style={tdN}>{money(c.comision)}</td>
                        <td style={{ ...tdN, ...g1 }}>{dia(c.etapaVisita)}</td><td style={tdN}>{dia(c.etapaOferta)}</td><td style={tdN}>{dia(c.etapaCierre)}</td>
                        <td style={{ ...tdN, ...g1 }}>{dia(c.diasVisita)}</td><td style={tdN}>{dia(c.diasOferta)}</td><td style={{ ...tdN, fontWeight: 700 }}>{dia(c.diasCierre)}</td>
                        {conAsesor && <td style={td}>{c.asesor}</td>}
                    </tr>
                ))}
                {total('sale')}{total('rent')}
            </tbody>
        </Tabla>
    );
}
