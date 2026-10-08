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
                            La semana
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 16 }}>
                            Última semana completa: <b>{pulso.semanaRef}</b>. Leads por fuente, atención y visitas,
                            semana a semana. Un cierre no se mira semana a semana: el ciclo de venta va de 43 a 144 días.
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
                                        <th style={tth0}>Fuente</th>
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

                        <div style={{ fontSize: 11.5, color: '#777' }}>
                            Brokers, contacto con el lead y por qué se descartan están en <b>Leads y calidad</b>, con el periodo que elijas.
                        </div>
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
                                        <th style={tth0} rowSpan={2}>Fuente del comprador</th>
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
                            En «Cierres» el segundo número gris es el mismo periodo del año pasado. Regalía = lo que retiene Pulppo.
                            Mismo cálculo que «Funnel y cierres»: los cierres sin fuente se atribuyen (broker externo, red Pulppo,
                            primer lead del comprador o cartera).
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 10px' }}>
                            Leads por mes · últimos 12
                        </h2>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%', minWidth: 860 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Fuente</th>
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
                        <div style={{ fontSize: 12.5, color: '#555', lineHeight: 1.6, marginBottom: 20, maxWidth: 820 }}>
                            Cada pestaña contesta una pregunta. Las cinco de arriba comparten filtros (inmobiliaria, operación,
                            periodo y comparación) y se actualizan solas al cambiarlos. Junto a cada número hay una <b>ⓘ</b> con
                            cómo se calcula.
                        </div>
                        {([
                            ['Resumen', '¿Cómo vamos?', 'Los seis números clave, qué cambió contra el periodo comparado, qué hay que atender y cómo va cada canal.'],
                            ['Inversión y retorno', '¿Cuánto costó y qué regresó?', 'Inversión, CPL, CPA y ROI por canal, más el deal de MercadoLibre.'],
                            ['Leads y calidad', '¿Cuántos llegan y qué tan buenos son?', 'Leads por fuente, brokers, tiempo de respuesta, contacto con el lead y por qué se descartan.'],
                            ['Funnel y cierres', '¿Qué pasa con ellos después?', 'Lead → visita → oferta → cierre por fuente, y los cierres del periodo con su fuente.'],
                            ['Inmobiliarias y asesores', '¿Quién convierte?', 'La misma lectura por asesor o por inmobiliaria (las 102 en el orden de siempre).'],
                            ['La semana', '¿Qué pasó esta semana?', 'Atención y respuesta semana a semana, partida por WhatsApp vinculado / no vinculado. Sólo usa el filtro de operación.'],
                            ['Histórico y año vs año', '¿Cómo venimos en el tiempo?', 'Series mensuales; no usa los filtros de arriba.'],
                        ] as const).map(([t, q, txt]) => (
                            <div key={t} style={{ display: 'flex', gap: 16, padding: '9px 0', borderBottom: `1px solid ${LGT}`, fontSize: 12.5, lineHeight: 1.5 }}>
                                <div style={{ width: 190, flexShrink: 0, fontWeight: 700 }}>{t}</div>
                                <div style={{ width: 250, flexShrink: 0, fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{q}</div>
                                <div style={{ color: '#555' }}>{txt}</div>
                            </div>
                        ))}
                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, fontWeight: 400, margin: '30px 0 0' }}>Reglas para no leerlo mal</h2>
                        <div style={{ width: 50, height: 1, background: '#F6BE00', margin: '8px 0 16px' }} />
                        {[
                            ['Cohorte y cierres del periodo no se suman',
                             'El funnel es una cohorte: las personas que dejaron un lead en el periodo y lo que hicieron después (contesta qué tan bueno era lo que entró). «Cierres del periodo» son las operaciones que cerraron en esas fechas, vengan de leads de cuando sea (contesta qué cobramos); de ahí salen regalía y ROI. Sumarlos es el error más común. Y los cierres de una cohorte reciente salen bajos por construcción: el ciclo de venta va de 43 a 144 días.'],
                            ['Las tasas van sobre personas, no sobre leads',
                             'Si alguien escribe tres veces son 3 leads y 1 persona. Visita, oferta y cierre se calculan sobre personas únicas, y una visita sólo cuenta si fue después del lead. El CPL sí va sobre leads: es lo que le compras al portal.'],
                            ['«Sin respuesta visible» no es un lead perdido',
                             'Cada lead cae en una de tres y suman 100%: con conversación, sin respuesta visible (tiene teléfono válido pero no vemos que haya contestado: el asesor responde desde su WhatsApp y ese chat no se guarda en Pulppo) y fantasma (teléfono inválido y sin conversación: no hay cómo contactarlo). «Llegó sólo el clic» es aparte: el portal mandó sólo el evento, sin mensaje.'],
                            ['Los toques son los registrados en Pulppo',
                             'Antes de descartar contamos seguimientos marcados como hechos, propiedades sugeridas, búsquedas compartidas y notas. Lo que el asesor escribió por WhatsApp no queda en la base, así que «sin toque» quiere decir sin nada registrado.'],
                            ['El descarte madura',
                             'Un periodo reciente siempre se ve más limpio de lo que va a terminar: los leads no han tenido tiempo de descartarse. Contra otro periodo, lee la composición (por qué se descartan), no el porcentaje total.'],
                            ['Todo cierre tiene fuente',
                             'La fuente es la del comprador. Cuando la operación no la trae se atribuye: broker de fuera → Broker externo; otra inmobiliaria de la red → Red Pulppo; comprador con un lead previo con esa misma inmobiliaria → el canal de ese primer lead («inferida»); búsqueda sin fuente → Búsqueda creada por el asesor (el asesor dio de alta al contacto); nada → Cartera del asesor. Es la misma regla que usa Desempeño en /mb.'],
                            ['La inversión se escribe en el Sheet, no aquí',
                             'Sale de «Investment Strategy - 2026», un tab por mes, bloque de resultados. Si un tab trae el plan del mes anterior (plan mensual fijo) se usa y se avisa. Si un mes no está cargado, sus canales salen s/d: un cero diría que fue gratis. Inmuebles24 Mérida es NURA y va en su propia línea.'],
                            ['ROI sólo con la red completa y meses completos',
                             'Los portales cobran por aviso, no por inmobiliaria ni por venta/renta: con una inmobiliaria elegida o con Venta/Renta, CPL, CPA y ROI se apagan. Con fechas que no empiezan el día 1, también. ROI = regalía que retiene Pulppo ÷ inversión, no la comisión total.'],
                            ['MeLi se revisa a mano',
                             'Cuesta base fija $152,800 + 6% de la comisión de las operaciones del deal, así que sólo se conoce con el mes cerrado. La tabla del deal es una lista de revisión: las banderas dicen qué mirar antes de pagar.'],
                            ['Habi y las cuentas de prueba están fuera de todo',
                             'Habi se excluye por el email de la inmobiliaria (contiene tuhabi), nunca por el nombre: filtrar por nombre mataría inmobiliarias reales como Habitat o Habix.'],
                        ].map(([t, txt]) => (
                            <div key={t} style={{ marginBottom: 16, maxWidth: 820 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{t}</div>
                                <div style={{ fontSize: 12.5, color: '#555', lineHeight: 1.6 }}>{txt}</div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
