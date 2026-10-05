'use client';
// Análisis de portales — reemplaza el Streamlit local de ~/Documents/Pulppo/Análisis de Portales.
// Aquí lee Mongo en vivo y la inversión sale del Sheet, no de una tabla a mano.
//
// Diseño: los mismos tokens que /mb y /plus (7 colores oficiales, R=2, EB Garamond en cifras,
// sin sombras, sin emoji).
import type { CSSProperties } from 'react';
import type { PulseView } from '@/lib/portales/pulse';
import type { HistoricoView } from '@/lib/portales/historico';
import InmobiliariasTab from './InmobiliariasTab';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;

const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const money = (n?: number | null) => (n == null ? 's/d' : `$${Math.round(n).toLocaleString('es-MX')}`);
const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);
const MESL: Record<string, string> = {
    '01': 'enero', '02': 'febrero', '03': 'marzo', '04': 'abril', '05': 'mayo', '06': 'junio',
    '07': 'julio', '08': 'agosto', '09': 'septiembre', '10': 'octubre', '11': 'noviembre', '12': 'diciembre',
};
const mesLargo = (mk: string) => `${MESL[mk.slice(5)]} ${mk.slice(0, 4)}`;

// Menú por PREGUNTA (Ale, 5-oct-2026). Las cuatro primeras comparten una sola consulta y una sola
// barra de filtros (InmobiliariasTab): así un número es el mismo en todas las pestañas.
export type Section = 'resumen' | 'inversion' | 'leads' | 'embudo' | 'inmobiliarias' | 'pulso' | 'historico' | 'comoleer';
export type SeccionV2 = 'resumen' | 'inversion' | 'leads' | 'embudo' | 'inmobiliarias';
const V2: Section[] = ['resumen', 'inversion', 'leads', 'embudo', 'inmobiliarias'];

/** Mini-barras horizontales para una serie semanal. Sin librería: son 8 divs. */
function Spark({ vals, color = BLK }: { vals: number[]; color?: string }) {
    const max = Math.max(...vals, 1);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
            {vals.map((v, i) => (
                <span key={i} title={String(v)} style={{
                    width: 6, height: Math.max(2, Math.round((v / max) * 22)),
                    background: i === vals.length - 1 ? color : GRY, borderRadius: R,
                }} />
            ))}
        </span>
    );
}

/** Δ con signo y color. `pts` = puntos porcentuales en vez de %. */
function Delta({ v, pts = false, invertir = false }: { v?: number | null; pts?: boolean; invertir?: boolean }) {
    if (v == null) return <span style={{ color: GRY }}>—</span>;
    const bueno = invertir ? v <= 0 : v >= 0;
    return (
        <span style={{ color: v === 0 ? GRY : bueno ? SEA : RED, fontWeight: 700 }}>
            {v > 0 ? '+' : ''}{v}{pts ? ' pts' : '%'}
        </span>
    );
}

/** Cifra grande de cabecera. */
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ flex: 1, background: '#fff', border: `1px solid ${LGT}`, padding: '13px 15px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 27, lineHeight: 1.05, margin: '8px 0 3px', color: color || BLK }}>{value}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#777', lineHeight: 1.3 }}>{sub}</div>}
        </div>
    );
}

/** Aviso. `tono`: 'alerta' para lo que puede llevar a leer mal un número. */
function Aviso({ tono = 'nota', children }: { tono?: 'nota' | 'alerta'; children: React.ReactNode }) {
    const c = tono === 'alerta' ? RED : SEA;
    return (
        <div style={{ borderLeft: `3px solid ${c}`, background: '#fff', border: `1px solid ${LGT}`, borderLeftColor: c, padding: '10px 13px', borderRadius: R, fontSize: 12, lineHeight: 1.5, color: '#444' }}>
            {children}
        </div>
    );
}

export default function PortalesApp({ pulso, hist, section, setSection, cacheAt, onRefresh, cargando, controles, onPresentar, op, setOp }: {
    pulso: PulseView | null; hist: HistoricoView | null;
    section: Section; setSection: (s: Section) => void;
    cacheAt: number | null; onRefresh: () => void; cargando: boolean;
    controles?: React.ReactNode; onPresentar?: () => void;
    /** venta/renta compartido entre las secciones nuevas y el pulso */
    op: 'todas' | 'sale' | 'rent'; setOp: (o: 'todas' | 'sale' | 'rent') => void;
}) {

    const tth: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const tth0: CSSProperties = { ...tth, textAlign: 'left' };
    const ttd: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    const ttd0: CSSProperties = { ...ttd, textAlign: 'left' };

    const nav = (id: Section, label: string) => (
        <div key={id} onClick={() => setSection(id)} style={{ padding: '9px 12px', borderRadius: R, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 2, background: section === id ? BLK : 'transparent', color: section === id ? '#fff' : '#555' }}>{label}</div>
    );

    const hace = cacheAt ? Math.round((Date.now() - cacheAt) / 60000) : null;

    return (
        <div style={{ fontFamily: 'Nunito Sans, sans-serif', color: BLK, background: '#fff', minHeight: '100vh', display: 'flex' }}>
            {/* ── nav ── */}
            <div style={{ width: 208, flexShrink: 0, borderRight: `1px solid ${LGT}`, padding: '22px 12px', position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, lineHeight: 1.1, padding: '0 8px 4px' }}>Análisis de portales</div>
                <div style={{ fontSize: 10.5, color: GRY, padding: '0 8px 16px' }}>Leads, costo y resultados de cada portal</div>
                {nav('resumen', 'Resumen')}
                {nav('inversion', 'Inversión y retorno')}
                {nav('leads', 'Leads y calidad')}
                {nav('embudo', 'Funnel y cierres')}
                {nav('inmobiliarias', 'Inmobiliarias y asesores')}
                <div style={{ height: 12 }} />
                {nav('pulso', 'La semana')}
                {nav('historico', 'Histórico y año vs año')}
                <div style={{ height: 12 }} />
                {nav('comoleer', 'Cómo leer esto')}
                {onPresentar && (
                    <div style={{ padding: '14px 8px 0' }}>
                        <button onClick={onPresentar} title="El reporte de un solo portal, sin datos de los demás, listo para proyectar o exportar"
                            style={{ width: '100%', padding: '8px 10px', borderRadius: R, border: `1px solid ${LGT}`, background: '#fff', color: BLK, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            Modo presentación
                        </button>
                    </div>
                )}
                <div style={{ marginTop: 20, padding: '0 8px', display: V2.includes(section) ? 'none' : 'block' }}>
                    <button onClick={onRefresh} disabled={cargando}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: R, border: `1px solid ${BLK}`, background: cargando ? LGT : '#fff', color: BLK, fontSize: 11.5, fontWeight: 700, cursor: cargando ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                        {cargando ? 'Consultando Mongo…' : 'Recargar datos'}
                    </button>
                    <div style={{ fontSize: 10, color: GRY, marginTop: 6, lineHeight: 1.4 }}>
                        {hace == null ? 'recién calculado'
                            : hace < 1 ? 'actualizado hace menos de 1 min'
                            : `actualizado hace ${hace} min`}
                    </div>
                </div>
            </div>

            {/* ── contenido ── */}
            <div style={{ flex: 1, padding: '24px 28px', maxWidth: 1180, minWidth: 0 }}>

                {/* Las cuatro secciones nuevas: UNA instancia (mismo lugar del árbol) → comparten filtros y datos. */}
                {V2.includes(section) && <InmobiliariasTab section={section as SeccionV2} op={op} setOp={setOp} />}

                {(section === 'pulso' || section === 'historico') && controles && (
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 14, marginBottom: 16, borderBottom: `1px solid ${LGT}` }}>
                        {controles}
                    </div>
                )}

                {/* ═══════════ PULSO SEMANAL ═══════════ */}
                {section === 'pulso' && (!pulso ? (
                    <div style={{ color: GRY, fontSize: 13 }}>Calculando el pulso… (unos segundos)</div>
                ) : (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Pulso de la semana
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 16 }}>
                            Semana de referencia <b>{pulso.semanaRef}</b>. Sólo indicadores adelantados:
                            leads, atención, visitas y calidad. Un cierre no se mira semana a semana —
                            el ciclo de venta va de 43 a 144 días.
                        </div>

                        {pulso.alerts.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                                {pulso.alerts.map((a, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', border: `1px solid ${LGT}`, borderLeft: `3px solid ${a.sev === 'alta' ? RED : YEL}`, padding: '8px 12px', borderRadius: R, fontSize: 12.5 }}>
                                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: a.sev === 'alta' ? RED : '#8A6D00', flexShrink: 0 }}>{a.sev}</span>
                                        <span>{a.txt}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 720 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth0}>8 semanas</th>
                                        <th style={tth}>Última</th>
                                        <th style={tth}>vs previa</th>
                                        <th style={tth}>Semana en curso</th>
                                        <th style={tth}>Mes a hoy</th>
                                        <th style={tth}>Mes pasado al mismo día</th>
                                        <th style={tth}>Mes vs mes pasado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pulso.series.map((s) => (
                                        <tr key={s.key}>
                                            <td style={ttd0}>{s.canal}</td>
                                            <td style={{ ...ttd0, paddingTop: 4, paddingBottom: 2 }}><Spark vals={s.weeks} /></td>
                                            <td style={ttd}>{f0(s.weeks[s.weeks.length - 1])}</td>
                                            <td style={ttd}><Delta v={s.wow} /></td>
                                            <td style={{ ...ttd, color: GRY }}>{f0(s.wtd)}</td>
                                            <td style={ttd}>{f0(s.mtd)}</td>
                                            <td style={{ ...ttd, color: GRY }}>{f0(s.pmtd)}</td>
                                            <td style={ttd}><Delta v={s.pace} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: -14, marginBottom: 20 }}>
                            «Semana en curso» va corriendo y por eso no entra en la comparación. «Mes vs mes pasado»
                            compara lo que lleva el mes contra el mes pasado cortado al mismo día (no contra el mes completo).
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 4px' }}>Atención</h2>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
                            Sólo leads que entraron entre 9:00 y 20:59 de México. Sin ese filtro, los de
                            madrugada disparan el «sin responder» y el número deja de significar algo.
                            El «sin responder» va partido por asesor <b>con</b> y <b>sin</b> WhatsApp vinculado: sin vincular,
                            el asesor contesta por fuera y Pulppo no lo registra, así que su porcentaje es en buena parte
                            falta de registro, no abandono. El que hay que vigilar es el de los vinculados.
                        </div>
                        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 620 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Semana</th>
                                        {pulso.wlabels.map((w) => <th key={w} style={tth}>{w}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style={ttd0}>Respondidos &lt;1 h</td>
                                        {pulso.resp.map((r, i) => <td key={i} style={ttd}>{r.pctLt60}%</td>)}
                                    </tr>
                                    <tr>
                                        <td style={ttd0}>Sin responder · todos</td>
                                        {pulso.resp.map((r, i) => (
                                            <td key={i} style={{ ...ttd, color: r.pctSin >= 5 ? RED : BLK, fontWeight: r.pctSin >= 5 ? 700 : 400 }}>{r.pctSin}%</td>
                                        ))}
                                    </tr>
                                    <tr>
                                        <td style={{ ...ttd0, paddingLeft: 20 }}>con WhatsApp vinculado</td>
                                        {pulso.resp.map((r, i) => (
                                            <td key={i} style={{ ...ttd, color: r.vinc.pctSin >= 5 ? RED : BLK }}>{r.vinc.pctSin}%<div style={{ fontSize: 10, color: GRY }}>{f0(r.vinc.tot)} leads</div></td>
                                        ))}
                                    </tr>
                                    <tr>
                                        <td style={{ ...ttd0, paddingLeft: 20 }}>sin WhatsApp vinculado</td>
                                        {pulso.resp.map((r, i) => (
                                            <td key={i} style={{ ...ttd, color: GRY }}>{r.noVinc.pctSin}%<div style={{ fontSize: 10 }}>{f0(r.noVinc.tot)} leads</div></td>
                                        ))}
                                    </tr>
                                    <tr>
                                        <td style={{ ...ttd0, color: GRY }}>Base (leads en horario)</td>
                                        {pulso.resp.map((r, i) => <td key={i} style={{ ...ttd, color: GRY }}>{f0(r.tot)}</td>)}
                                    </tr>
                                    <tr>
                                        <td style={{ ...ttd0, borderTop: `1px solid ${BLK}` }}>Visitas agendadas</td>
                                        {pulso.visitas.total.map((v, i) => <td key={i} style={{ ...ttd, borderTop: `1px solid ${BLK}`, fontWeight: 700 }}>{f0(v)}</td>)}
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 4px' }}>
                            Cliente o broker · {pulso.p30Label}
                        </h2>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
                            Global: <b>{pulso.broker.pctNow}%</b> de los leads son broker
                            ({f0(pulso.broker.broker)} de {f0(pulso.broker.total)}), <Delta v={pulso.broker.delta} pts invertir /> vs
                            los 30 días previos. Sólo se listan portales con 50+ leads en la ventana: con
                            menos, un caso mueve el porcentaje entero.
                        </div>
                        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 480 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth}>% broker</th>
                                        <th style={tth}>30d previos</th>
                                        <th style={tth}>Δ</th>
                                        <th style={tth}>Leads</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pulso.broker.porPortal.map((p) => (
                                        <tr key={p.canal}>
                                            <td style={ttd0}>{p.canal}</td>
                                            <td style={{ ...ttd, fontWeight: 700, color: p.pctNow >= 15 ? RED : BLK }}>{p.pctNow}%</td>
                                            <td style={{ ...ttd, color: GRY }}>{p.pctPrev}%</td>
                                            <td style={ttd}><Delta v={p.delta} pts invertir /></td>
                                            <td style={{ ...ttd, color: GRY }}>{f0(p.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 4px' }}>
                            Por qué se descartan
                        </h2>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
                            Composición de {f0(pulso.descartes.totalNow)} descartes de venta en los últimos
                            30 días, contra los 30 previos. Se compara el <b>share</b>, no el volumen: así no
                            confunde que un mes entren más leads.
                        </div>
                        <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 640 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Motivo</th>
                                        <th style={tth}>Casos</th>
                                        <th style={tth}>Share</th>
                                        <th style={tth}>Δ vs 30d</th>
                                        <th style={tth0}>Portales detrás</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pulso.descartes.rows.map((r) => (
                                        <tr key={r.reason}>
                                            <td style={ttd0}>{r.reason}</td>
                                            <td style={ttd}>{f0(r.now)}</td>
                                            <td style={{ ...ttd, fontWeight: 700 }}>{r.pctNow}%</td>
                                            <td style={ttd}><Delta v={r.deltaPct} pts invertir /></td>
                                            <td style={{ ...ttd0, whiteSpace: 'normal', fontSize: 11, color: '#555', maxWidth: 300 }}>
                                                {r.portales.map((p) => `${p.canal} ${p.pct}%`).join(' · ') || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Aviso>
                            Los porcentajes por portal de un motivo <b>pueden pasar de 100 y está bien</b>:
                            si una búsqueda tuvo leads de dos portales cuenta en los dos. La pregunta es qué
                            portales aparecen detrás de cada motivo, no repartir culpa exacta.
                        </Aviso>

                        {pulso.descartes.comentarios.length > 0 && (
                            <>
                                <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '24px 0 8px' }}>
                                    Lo que escribieron los asesores
                                </h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {pulso.descartes.comentarios.map((c, i) => (
                                        <div key={i} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '8px 12px', fontSize: 12, color: '#444', fontStyle: 'italic' }}>
                                            «{c}»
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ))}

                {/* ═══════════ HISTÓRICO ═══════════ */}
                {section === 'historico' && (!hist ? (
                    <div style={{ color: GRY, fontSize: 13 }}>Calculando el histórico…</div>
                ) : (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Histórico y año contra año
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 18 }}>
                            Aquí sí mandan los cierres y la regalía: a 12 meses el ciclo de venta ya maduró.
                            Mes cerrado de referencia: <b>{hist.mesCerrado}</b>. YTD al {hist.ytdHasta}.
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 10px' }}>
                            Cierres y regalía · {hist.anio} contra {hist.anioPrev}
                        </h2>
                        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 820 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0} rowSpan={2}>Portal</th>
                                        <th style={{ ...tth, borderBottom: 'none' }} colSpan={3}>Año a la fecha</th>
                                        <th style={{ ...tth, borderBottom: 'none' }} colSpan={3}>{hist.mesCerrado}</th>
                                        <th style={tth} rowSpan={2}>Ticket YTD</th>
                                    </tr>
                                    <tr>
                                        <th style={tth}>Cierres</th>
                                        <th style={tth}>Regalía</th>
                                        <th style={tth}>vs {hist.anioPrev}</th>
                                        <th style={tth}>Cierres</th>
                                        <th style={tth}>Regalía</th>
                                        <th style={tth}>vs año pasado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {hist.ytdRows.map((r) => (
                                        <tr key={r.canal}>
                                            <td style={ttd0}>{r.canal}</td>
                                            <td style={ttd}>{f0(r.cierresYtd)}<span style={{ color: GRY }}> / {f0(r.cierresYtdPrev)}</span></td>
                                            <td style={{ ...ttd, fontWeight: 700 }}>{money(r.regaliaYtd)}</td>
                                            <td style={ttd}><Delta v={r.varRegaliaYtd} /></td>
                                            <td style={ttd}>{f0(r.cierresMes)}<span style={{ color: GRY }}> / {f0(r.cierresMesPrev)}</span></td>
                                            <td style={ttd}>{money(r.regaliaMes)}</td>
                                            <td style={ttd}><Delta v={r.varRegaliaMes} /></td>
                                            <td style={{ ...ttd, color: GRY }}>{money(r.ticketYtd)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: -14, marginBottom: 22 }}>
                            En «Cierres» el segundo número gris es el mismo periodo del año pasado.
                            Regalía = <code>pulppoComission</code>, lo que Pulppo retiene.
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 10px' }}>
                            Leads por mes · últimos 12
                        </h2>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%', minWidth: 860 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth0}>Tendencia</th>
                                        {hist.mlabels.map((m) => <th key={m} style={tth}>{m}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(hist.leadTrend).map(([canal, vals]) => (
                                        <tr key={canal}>
                                            <td style={ttd0}>{canal}</td>
                                            <td style={{ ...ttd0, paddingTop: 4, paddingBottom: 2 }}><Spark vals={vals} /></td>
                                            {vals.map((v, i) => (
                                                <td key={i} style={{ ...ttd, color: i === vals.length - 1 ? BLK : '#666' }}>{f0(v)}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>
                            El último mes está en curso y por eso siempre se ve más bajo.
                        </div>
                    </>
                ))}

                {/* ═══════════ CÓMO LEER ═══════════ */}
                {section === 'comoleer' && (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 14px' }}>
                            Cómo leer esto
                        </h1>
                        {[
                            ['Lead único = una persona',
                             'Si alguien escribe tres veces son 3 leads y 1 lead único. El embudo son tres pasos: leads → leads únicos → visitas, y la tasa de visita sale sobre los únicos, no sobre los leads. La columna "leads x único" dice cuánto mensaje repetido manda cada portal. El CPL sí va sobre leads: es lo que le compras al portal.'],
                            ['Una visita sólo cuenta si fue DESPUÉS del lead',
                             'Antes se acreditaba al portal cualquier visita del historial del contacto, aunque hubiera ocurrido meses antes de que el lead entrara. Eso casi duplicaba la tasa. Si comparas contra un reporte anterior a septiembre 2026, la diferencia es ésta y no una caída del negocio.'],
                            ['Las dos atribuciones no se suman',
                             'El «adelantado» es la cohorte del mes: leads que entraron y qué pasó con ellos — contesta qué tan bueno era lo que entró. El «rezagado» son las operaciones cerradas en el mes por buyer.source, vengan de leads de cualquier mes — contesta qué cobramos. De ahí salen regalía, ticket y ROI. Sumarlos es el error más común con estos números.'],
                            ['s/d no es cero',
                             'Si un mes no está cargado en el Sheet, su inversión es desconocida y el CPL queda en s/d. Un cero diría «fue gratis», que sólo es cierto para propiedades.com.'],
                            ['La inversión se escribe en el Sheet, no aquí',
                             'La fuente es «Investment Strategy - 2026», un tab por mes, bloque RESULTS. Al cerrar el mes se llena ahí y este tablero lo lee solo. No hay tabla a mano que mantener: eso es justo lo que se rompió antes.'],
                            ['MeLi es el único que no sale del Sheet',
                             'Su costo es base fija más 6% de la comisión de las operaciones que le atribuyen, así que sólo se conoce con el mes cerrado y necesita una revisión a mano. Ver la pestaña del deal.'],
                            ['Habi y las cuentas de prueba están fuera de todo',
                             'Habi se excluye siempre por el email de la inmobiliaria (contiene tuhabi), nunca por el nombre: sus inmobiliarias tienen nombres arbitrarios que no dicen «habi», y filtrar por nombre mata inmobiliarias reales como Habitat o Habix.'],
                        ].map(([t, txt]) => (
                            <div key={t} style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{t}</div>
                                <div style={{ fontSize: 12.5, color: '#555', lineHeight: 1.6 }}>{txt}</div>
                            </div>
                        ))}
                        <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${LGT}`, fontSize: 11.5, color: GRY, lineHeight: 1.6 }}>
                            Adelantado vs rezagado es la división del menú, y es el principio del proyecto:
                            el <b>pulso</b> contesta «¿cómo vamos esta semana?» con leads, atención y
                            visitas; lo <b>mensual</b> contesta «¿qué cobramos y cuánto costó?». Un cierre no
                            se mira semana a semana. Cada vista se calcula aparte y sólo al entrar, para que
                            abrir la página no cueste las tres consultas.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
