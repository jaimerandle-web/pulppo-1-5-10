'use client';
// Modo presentación: el reporte de UN portal, para enseñárselo a ese portal en una junta.
//
// ⚠️ La regla de este archivo: aquí NUNCA entra el dato de otro portal. Ni comparaciones, ni
// ranking, ni el ROI de la competencia, ni la lista de revisión del deal de MeLi (que trae
// operación por operación con inmobiliaria y comisión). Si alguna sección nueva necesita
// mirar a otro canal, no va aquí: va en la vista de análisis.
//
// El selector de secciones existe para que Ale decida qué proyecta. Todo arranca prendido
// menos costo y retorno, que es el que más conviene decidir a conciencia antes de mostrarlo.
import { useMemo, useState } from 'react';
import type { PortalesView, PortalMes } from '@/lib/portales/view';
import type { PeriodoView } from '@/lib/portales/periodo';
import PrintRoot from '../mb/[companyId]/PrintRoot';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const money = (n?: number | null) => (n == null ? 's/d' : `$${Math.round(n).toLocaleString('es-MX')}`);
const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);

export type SeccionP = 'volumen' | 'mezcla' | 'atencion' | 'embudo' | 'costo' | 'periodo';
export const SECCIONES: Array<[SeccionP, string]> = [
    ['volumen', 'Leads mes a mes'],
    ['mezcla', 'Venta vs renta'],
    ['atencion', 'Atención'],
    ['embudo', 'Visitas y cierres'],
    ['costo', 'Costo y retorno'],
    ['periodo', 'Leads de un periodo exacto'],
];

export default function Presentacion({
    d, periodo, portalKey, secciones, meses, onSalir, encabezado,
}: {
    d: PortalesView;
    periodo: PeriodoView | null;
    portalKey: string;
    secciones: Set<SeccionP>;
    meses: Array<{ key: string; label: string; parcial: boolean }>;
    onSalir: () => void;
    encabezado: React.ReactNode;
}) {
    const portal = useMemo(() => d.portales.find((p) => p.key === portalKey), [d.portales, portalKey]);
    const [nota, setNota] = useState('');

    if (!portal) return <div style={{ padding: 24, color: GRY }}>Ese portal no tiene datos en el rango.</div>;

    const rows = portal.rows;
    const ult = rows[rows.length - 1];
    const tot = rows.reduce((a, r) => ({
        leads: a.leads + r.leads, visitas: a.visitas + r.visitas, cierres: a.cierres + r.cierres,
        regalia: a.regalia + r.regalia,
        inv: r.inversion == null ? a.inv : a.inv + r.inversion,
        sinInv: a.sinInv + (r.inversion == null ? 1 : 0),
    }), { leads: 0, visitas: 0, cierres: 0, regalia: 0, inv: 0, sinInv: 0 });

    const th: React.CSSProperties = { textAlign: 'right', padding: '7px 9px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666' };
    const th0: React.CSSProperties = { ...th, textAlign: 'left' };
    const td: React.CSSProperties = { padding: '7px 9px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    const td0: React.CSSProperties = { ...td, textAlign: 'left' };
    const H = ({ children }: { children: React.ReactNode }) => (
        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '26px 0 10px', breakAfter: 'avoid' }}>{children}</h2>
    );

    return (
        <div style={{ fontFamily: 'Nunito Sans, sans-serif', color: BLK, background: '#fff', minHeight: '100vh' }}>
            <div className="no-print" style={{ borderBottom: `1px solid ${LGT}`, padding: '12px 24px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {encabezado}
                <div style={{ flex: 1 }} />
                <button onClick={() => window.print()}
                    style={{ padding: '8px 14px', borderRadius: R, border: 'none', background: BLK, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Exportar PDF
                </button>
                <button onClick={onSalir}
                    style={{ padding: '8px 14px', borderRadius: R, border: `1px solid ${BLK}`, background: '#fff', color: BLK, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Salir de presentación
                </button>
            </div>

            <PrintRoot id="reporte-portal" orientation="portrait" />

            <div id="reporte-portal" style={{ maxWidth: 900, margin: '0 auto', padding: '30px 34px 60px' }}>
                <div style={{ borderBottom: `2px solid ${YEL}`, paddingBottom: 12, marginBottom: 22 }}>
                    <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '1.4px', color: GRY, fontWeight: 700 }}>Pulppo · desempeño del canal</div>
                    <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 34, fontWeight: 400, margin: '6px 0 2px' }}>{portal.canal}</h1>
                    <div style={{ fontSize: 12.5, color: '#666' }}>
                        {meses[0]?.label} – {meses[meses.length - 1]?.label}
                        {meses[meses.length - 1]?.parcial && ' · el último mes va en curso'}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[['Leads del periodo', f0(tot.leads)], ['Visitas', f0(tot.visitas)],
                      ['Cierres', f0(tot.cierres)],
                      ['Tasa de visita', pc(ult?.tasaVisita)]].map(([k, v]) => (
                        <div key={k} style={{ flex: '1 1 150px', background: '#fff', border: `1px solid ${LGT}`, padding: '13px 15px', borderRadius: R }}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{k}</div>
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 27, lineHeight: 1.05, marginTop: 8 }}>{v}</div>
                        </div>
                    ))}
                </div>

                {secciones.has('volumen') && (
                    <>
                        <H>Leads mes a mes</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Leads</th><th style={th}>Contactos únicos</th><th style={th}>Visitas</th></tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mes}>
                                        <td style={td0}>{meses[i]?.label}{meses[i]?.parcial ? ' (en curso)' : ''}</td>
                                        <td style={td}>{f0(r.leads)}</td>
                                        <td style={td}>{f0(r.unicos)}</td>
                                        <td style={td}>{f0(r.visitas)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {secciones.has('mezcla') && (
                    <>
                        <H>Venta y renta</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>% venta</th><th style={th}>% renta</th></tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mes}>
                                        <td style={td0}>{meses[i]?.label}</td>
                                        <td style={td}>{pc(r.pctVenta)}</td>
                                        <td style={td}>{r.pctVenta == null ? '—' : `${Math.round((100 - r.pctVenta) * 10) / 10}%`}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {secciones.has('atencion') && (
                    <>
                        <H>Atención de los leads</H>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 8 }}>
                            Sobre leads que entraron entre 9:00 y 20:59 hora de México.
                        </div>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Respondidos &lt;1 h</th><th style={th}>Sin responder</th></tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mes}>
                                        <td style={td0}>{meses[i]?.label}</td>
                                        <td style={td}>{pc(r.lt60)}</td>
                                        <td style={{ ...td, color: (r.sinResponder ?? 0) >= 5 ? RED : BLK }}>{pc(r.sinResponder)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {secciones.has('embudo') && (
                    <>
                        <H>De lead a visita y a cierre</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Únicos</th><th style={th}>Visitas</th><th style={th}>Tasa de visita</th><th style={th}>Cierres del mes</th></tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mes}>
                                        <td style={td0}>{meses[i]?.label}</td>
                                        <td style={td}>{f0(r.unicos)}</td>
                                        <td style={td}>{f0(r.visitas)}</td>
                                        <td style={{ ...td, fontWeight: 700 }}>{pc(r.tasaVisita)}</td>
                                        <td style={td}>{f0(r.cierres)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6, lineHeight: 1.5 }}>
                            La tasa de visita cuenta sólo visitas posteriores al lead. Los cierres del mes
                            son operaciones cerradas en ese mes, vengan de leads de cualquier mes: con un
                            ciclo de venta de 43 a 144 días, no se pueden leer contra los leads de la misma fila.
                        </div>
                    </>
                )}

                {secciones.has('costo') && portal.pagado && (
                    <>
                        <H>Costo y retorno</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Inversión</th><th style={th}>CPL</th><th style={th}>CPV</th><th style={th}>CPA</th><th style={th}>ROI</th></tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.mes}>
                                        <td style={td0}>{meses[i]?.label}</td>
                                        <td style={td}>{money(r.inversion)}</td>
                                        <td style={td}>{money(r.cpl)}</td>
                                        <td style={td}>{money(r.cpv)}</td>
                                        <td style={td}>{money(r.cpa)}</td>
                                        <td style={{ ...td, fontWeight: 700, color: r.roi == null ? GRY : r.roi >= 1 ? SEA : RED }}>
                                            {r.roi == null ? 's/d' : `${r.roi.toFixed(2)}×`}
                                        </td>
                                    </tr>
                                ))}
                                <tr>
                                    <td style={{ ...td0, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>Periodo</td>
                                    <td style={{ ...td, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>{money(tot.inv)}</td>
                                    <td style={{ ...td, borderTop: `1px solid ${BLK}` }}>{tot.leads ? money(tot.inv / tot.leads) : '—'}</td>
                                    <td style={{ ...td, borderTop: `1px solid ${BLK}` }}>{tot.visitas ? money(tot.inv / tot.visitas) : '—'}</td>
                                    <td style={{ ...td, borderTop: `1px solid ${BLK}` }}>{tot.cierres ? money(tot.inv / tot.cierres) : '—'}</td>
                                    <td style={{ ...td, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>{tot.inv ? `${(tot.regalia / tot.inv).toFixed(2)}×` : '—'}</td>
                                </tr>
                            </tbody>
                        </table>
                        {tot.sinInv > 0 && (
                            <div style={{ fontSize: 10.5, color: RED, marginTop: 6 }}>
                                {tot.sinInv} mes(es) sin inversión cargada; quedan fuera del total del periodo.
                            </div>
                        )}
                    </>
                )}

                {secciones.has('periodo') && periodo && (
                    <>
                        <H>Leads del {periodo.etiqueta}</H>
                        {(() => {
                            const f = periodo.filas.find((x) => x.key === portalKey);
                            if (!f) return <div style={{ fontSize: 12, color: GRY }}>Sin leads de este canal en ese rango.</div>;
                            return (
                                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                                    <tbody>
                                        {[['Leads', f0(f.leads)], ['Contactos únicos', f0(f.unicos)],
                                          ['Promedio por día', String(f.porDia)], ['% venta', pc(f.pctVenta)],
                                          ['Respondidos <1 h', pc(f.lt60)], ['Sin responder', pc(f.sinResponder)]].map(([k, v]) => (
                                            <tr key={k}>
                                                <td style={{ ...td0, color: '#555' }}>{k}</td>
                                                <td style={{ ...td, fontWeight: 700, width: 140 }}>{v}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()}
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>
                            Este bloque sí acepta fechas exactas. El de costo no: la inversión se factura
                            por mes, así que un rango partido no tendría con qué dividir.
                        </div>
                    </>
                )}

                <div className="no-print" style={{ marginTop: 26 }}>
                    <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3}
                        placeholder="Nota para el PDF (opcional): el acuerdo de la junta, el compromiso, lo que sigue…"
                        style={{ width: '100%', padding: 10, border: `1px solid ${LGT}`, borderRadius: R, fontFamily: 'inherit', fontSize: 12.5, resize: 'vertical' }} />
                </div>
                {nota.trim() && (
                    <div style={{ marginTop: 18, borderLeft: `3px solid ${YEL}`, padding: '10px 14px', background: '#fff', border: `1px solid ${LGT}`, borderLeftColor: YEL, borderRadius: R, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {nota}
                    </div>
                )}

                <div style={{ marginTop: 30, paddingTop: 12, borderTop: `1px solid ${LGT}`, fontSize: 10, color: GRY, lineHeight: 1.6 }}>
                    Fuente: base de datos de Pulppo, consultada en vivo. Excluye cuentas de prueba.
                    Atención medida sobre leads en horario 9:00–20:59 de México.
                </div>
            </div>
        </div>
    );
}
