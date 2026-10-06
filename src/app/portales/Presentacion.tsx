'use client';
// Modo presentación: el reporte de UN portal, para enseñárselo a ese portal en una junta.
//
// ⚠️ La regla de este archivo: aquí NUNCA entra el dato de otro portal. Ni comparaciones, ni
// ranking, ni el ROI de la competencia, ni la lista de revisión del deal de MeLi (que trae
// operación por operación con inmobiliaria y comisión). Si alguna sección nueva necesita
// mirar a otro canal, no va aquí: va en la vista de análisis.
//
// Desde oct-2026 usa el MISMO cálculo que las pestañas de análisis: un `InmoView` (vista general,
// sin comparar) por mes del rango y `inversionRango` por mes. La fila del portal es `f:<key>` de
// `fuentes`; sus cierres son los de `cierres.porFuente` con su nombre (fuente del comprador, con la
// atribución de los `other`). Así un número del PDF es el mismo que se ve en «Funnel y cierres».
//
// El selector de secciones existe para que Ale decida qué proyecta. Todo arranca prendido
// menos costo y retorno, que es el que más conviene decidir a conciencia antes de mostrarlo.
import { useMemo, useState } from 'react';
import type { Fila, InmoView } from '@/lib/portales/inmobiliaria';
import type { InversionRango } from '@/lib/portales/inversion';
import PrintRoot from '../mb/[companyId]/PrintRoot';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const money = (n?: number | null) => (n == null ? 's/d' : `$${Math.round(n).toLocaleString('es-MX')}`);
const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);
const p1 = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export type SeccionP = 'volumen' | 'mezcla' | 'atencion' | 'contacto' | 'embudo' | 'costo' | 'periodo';
export const SECCIONES: Array<[SeccionP, string]> = [
    ['volumen', 'Leads mes a mes'],
    ['mezcla', 'Venta vs renta'],
    ['atencion', 'Atención'],
    ['contacto', 'Contacto con el lead'],
    ['embudo', 'Visitas y cierres'],
    ['costo', 'Costo y retorno'],
    ['periodo', 'Leads de un periodo exacto'],
];
/** Canales con factura: los únicos que tiene sentido presentar (mismo criterio que SIN_COSTO). */
export const PORTALES_PAGADOS: Array<[string, string]> = [
    ['i24', 'Inmuebles24'], ['i24nura', 'Inmuebles24 · NURA'], ['meli', 'MercadoLibre'], ['easybroker', 'EasyBroker'],
    ['propiedades', 'Propiedades.com'], ['cyt', 'Casas y Terrenos'], ['facebook', 'Meta (FB/IG)'], ['doorvel', 'Doorvel'],
];

export interface MesP { key: string; label: string; parcial: boolean }

export default function Presentacion({
    meses, porMes, inv, periodo, portalKey, operacion, secciones, onSalir, encabezado,
}: {
    meses: MesP[];
    /** un InmoView por mes (mismo orden que `meses`); null = todavía cargando */
    porMes: Array<InmoView | null>;
    inv: Array<InversionRango | null>;
    periodo: InmoView | null;
    portalKey: string;
    operacion: 'todas' | 'sale' | 'rent';
    secciones: Set<SeccionP>;
    onSalir: () => void;
    encabezado: React.ReactNode;
}) {
    const [nota, setNota] = useState('');
    const nombre = PORTALES_PAGADOS.find(([k]) => k === portalKey)?.[1] ?? portalKey;

    const rows = useMemo(() => meses.map((m, i) => {
        const v = porMes[i];
        const f: Fila | undefined = v?.actual.fuentes.find((x) => x.key === `f:${portalKey}`);
        const c = v?.actual.cierres.porFuente.find((x) => x.fuente === (f?.nombre ?? nombre));
        const r = inv[i];
        // s/d (null) si el mes no está en el Sheet; ROI sólo con «Todo» (la inversión es de toda la red)
        const inversion = operacion !== 'todas' || !r || r.faltantes.includes(m.key) ? null : (r.porCanal[portalKey] ?? null);
        return { m, f, cierres: c?.n ?? 0, regalia: c?.regalia ?? 0, inversion, listo: !!v };
    }), [meses, porMes, inv, portalKey, nombre, operacion]);

    const listos = rows.filter((r) => r.listo).length;
    const cargando = listos < rows.length;

    const tot = rows.reduce((a, r) => ({
        leads: a.leads + (r.f?.leads ?? 0), unicos: a.unicos + (r.f?.unicos ?? 0), visitas: a.visitas + (r.f?.visitas ?? 0),
        cierres: a.cierres + r.cierres, regalia: a.regalia + r.regalia,
        inv: r.inversion == null ? a.inv : a.inv + r.inversion, sinInv: a.sinInv + (r.inversion == null ? 1 : 0),
        regInv: r.inversion == null ? a.regInv : a.regInv + r.regalia,
        leadsInv: r.inversion == null ? a.leadsInv : a.leadsInv + (r.f?.leads ?? 0),
        cierresInv: r.inversion == null ? a.cierresInv : a.cierresInv + r.cierres,
        visInv: r.inversion == null ? a.visInv : a.visInv + (r.f?.visitas ?? 0),
    }), { leads: 0, unicos: 0, visitas: 0, cierres: 0, regalia: 0, inv: 0, sinInv: 0, regInv: 0, leadsInv: 0, cierresInv: 0, visInv: 0 });

    const th: React.CSSProperties = { textAlign: 'right', padding: '7px 9px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666' };
    const th0: React.CSSProperties = { ...th, textAlign: 'left' };
    const td: React.CSSProperties = { padding: '7px 9px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    const td0: React.CSSProperties = { ...td, textAlign: 'left' };
    const tdT: React.CSSProperties = { ...td, fontWeight: 700, borderTop: `1px solid ${BLK}` };
    const H = ({ children }: { children: React.ReactNode }) => (
        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '26px 0 10px', breakAfter: 'avoid' }}>{children}</h2>
    );
    const Nota = ({ children }: { children: React.ReactNode }) => (
        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6, lineHeight: 1.5 }}>{children}</div>
    );
    const mesLbl = (m: MesP) => `${m.label}${m.parcial ? ' (en curso)' : ''}`;
    const opLbl = operacion === 'sale' ? ' · sólo venta' : operacion === 'rent' ? ' · sólo renta' : '';
    const pf = periodo?.actual.fuentes.find((x) => x.key === `f:${portalKey}`);

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

            {cargando ? (
                <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 34px', color: GRY, fontSize: 13 }}>
                    Preparando el reporte… {listos} de {rows.length} meses listos (cada mes se calcula con el mismo motor de las pestañas de análisis).
                </div>
            ) : (
            <div id="reporte-portal" style={{ maxWidth: 900, margin: '0 auto', padding: '30px 34px 60px' }}>
                <div style={{ borderBottom: `2px solid ${YEL}`, paddingBottom: 12, marginBottom: 22 }}>
                    <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '1.4px', color: GRY, fontWeight: 700 }}>Pulppo · desempeño del canal</div>
                    <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 34, fontWeight: 400, margin: '6px 0 2px' }}>{nombre}</h1>
                    <div style={{ fontSize: 12.5, color: '#666' }}>
                        {meses[0]?.label} – {meses[meses.length - 1]?.label}{opLbl}
                        {meses[meses.length - 1]?.parcial && ' · el último mes va en curso'}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[['Leads', f0(tot.leads)], ['Personas que visitaron', f0(tot.visitas)],
                      ['Lead → visita', pc(p1(tot.visitas, tot.unicos))], ['Cierres del periodo', f0(tot.cierres)]].map(([k, v]) => (
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
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Leads</th><th style={th}>Personas</th><th style={th}>Leads por persona</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.m.key}>
                                        <td style={td0}>{mesLbl(r.m)}</td>
                                        <td style={td}>{f0(r.f?.leads ?? 0)}</td>
                                        <td style={td}>{f0(r.f?.unicos ?? 0)}</td>
                                        <td style={td}>{r.f?.unicos ? (r.f.leads / r.f.unicos).toFixed(2) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Nota>«Personas» cuenta a cada contacto una vez aunque haya dejado varios leads en el mes.</Nota>
                    </>
                )}

                {secciones.has('mezcla') && (
                    <>
                        <H>Venta y renta</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Venta</th><th style={th}>Renta</th><th style={th}>% venta</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.m.key}>
                                        <td style={td0}>{mesLbl(r.m)}</td>
                                        <td style={td}>{f0(r.f?.venta ?? 0)}</td>
                                        <td style={td}>{f0(r.f?.renta ?? 0)}</td>
                                        <td style={{ ...td, fontWeight: 700 }}>{pc(r.f ? p1(r.f.venta, r.f.venta + r.f.renta) : null)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {secciones.has('atencion') && (
                    <>
                        <H>Atención de los leads</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Respondidos &lt;1 h</th><th style={th}>1ª respuesta (mediana)</th><th style={th}>Asesor sin responder</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.m.key}>
                                        <td style={td0}>{mesLbl(r.m)}</td>
                                        <td style={td}>{pc(r.f?.pctLt60)}</td>
                                        <td style={td}>{r.f?.respMed == null ? '—' : `${Math.round(r.f.respMed)} min`}</td>
                                        <td style={{ ...td, color: (r.f?.pctSinResp ?? 0) >= 5 ? RED : BLK }}>{pc(r.f?.pctSinResp)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Nota>Sobre leads que entraron entre 9:00 y 20:59 hora de México.</Nota>
                    </>
                )}

                {secciones.has('contacto') && (
                    <>
                        <H>Contacto con el lead</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Con conversación</th><th style={th}>Sin respuesta visible</th><th style={th}>Fantasma</th><th style={th}>Llegó sólo el clic</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.m.key}>
                                        <td style={td0}>{mesLbl(r.m)}</td>
                                        <td style={td}>{pc(r.f?.pctConConversacion)}</td>
                                        <td style={td}>{pc(r.f?.pctSinRespuesta)}</td>
                                        <td style={td}>{pc(r.f?.pctFantasma)}</td>
                                        <td style={{ ...td, color: '#666' }}>{pc(r.f?.pctSoloClic)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Nota>
                            Cada lead cae en una de tres y suman 100%: con conversación (hubo plática con el cliente), sin respuesta
                            visible (teléfono válido, pero no vemos que haya contestado; el asesor responde desde su WhatsApp) y fantasma
                            (teléfono inválido y sin conversación). «Llegó sólo el clic» = el lead entró únicamente con el evento
                            («Vio teléfono», «Contactó por WhatsApp»), sin mensaje.
                        </Nota>
                    </>
                )}

                {secciones.has('embudo') && (
                    <>
                        <H>De lead a visita y a cierre</H>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                            <thead><tr><th style={th0}>Mes</th><th style={th}>Personas</th><th style={th}>Visitaron</th><th style={th}>Lead → visita</th><th style={th}>Ofertaron</th><th style={th}>Cierres del mes</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.m.key}>
                                        <td style={td0}>{mesLbl(r.m)}</td>
                                        <td style={td}>{f0(r.f?.unicos ?? 0)}</td>
                                        <td style={td}>{f0(r.f?.visitas ?? 0)}</td>
                                        <td style={{ ...td, fontWeight: 700 }}>{pc(r.f?.pVisita)}</td>
                                        <td style={td}>{f0(r.f?.ofertas ?? 0)}</td>
                                        <td style={td}>{f0(r.cierres)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Nota>
                            Visitaron y ofertaron son una cohorte: las personas que dejaron su lead en ese mes y lo que hicieron
                            después. Los cierres del mes son operaciones que cerraron en ese mes, vengan de leads de cualquier mes,
                            con la fuente del comprador. Con un ciclo de venta de 43 a 144 días no se leen contra los leads de la misma fila.
                        </Nota>
                    </>
                )}

                {secciones.has('costo') && (
                    <>
                        <H>Costo y retorno</H>
                        {operacion !== 'todas' ? (
                            <div style={{ fontSize: 12, color: '#666' }}>
                                La inversión es de toda la operación (el portal cobra por aviso, no por venta o renta): elige «Todo» para ver costo y retorno.
                            </div>
                        ) : (<>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                                <thead><tr><th style={th0}>Mes</th><th style={th}>Inversión</th><th style={th}>CPL</th><th style={th}>CPV</th><th style={th}>CPA</th><th style={th}>Regalía</th><th style={th}>ROI</th></tr></thead>
                                <tbody>
                                    {rows.map((r) => {
                                        const i = r.inversion, l = r.f?.leads ?? 0, vis = r.f?.visitas ?? 0;
                                        const roi = i ? r.regalia / i : null;
                                        return (
                                            <tr key={r.m.key}>
                                                <td style={td0}>{mesLbl(r.m)}</td>
                                                <td style={td}>{money(i)}</td>
                                                <td style={td}>{i && l ? money(i / l) : i == null ? 's/d' : '—'}</td>
                                                <td style={td}>{i && vis ? money(i / vis) : i == null ? 's/d' : '—'}</td>
                                                <td style={td}>{i && r.cierres ? money(i / r.cierres) : i == null ? 's/d' : '—'}</td>
                                                <td style={td}>{money(r.regalia)}</td>
                                                <td style={{ ...td, fontWeight: 700, color: roi == null ? GRY : roi >= 1 ? SEA : RED }}>{roi == null ? 's/d' : `${roi.toFixed(2)}×`}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr>
                                        <td style={{ ...td0, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>Periodo</td>
                                        <td style={tdT}>{tot.inv ? money(tot.inv) : 's/d'}</td>
                                        <td style={{ ...tdT, fontWeight: 400 }}>{tot.inv && tot.leadsInv ? money(tot.inv / tot.leadsInv) : '—'}</td>
                                        <td style={{ ...tdT, fontWeight: 400 }}>{tot.inv && tot.visInv ? money(tot.inv / tot.visInv) : '—'}</td>
                                        <td style={{ ...tdT, fontWeight: 400 }}>{tot.inv && tot.cierresInv ? money(tot.inv / tot.cierresInv) : '—'}</td>
                                        <td style={tdT}>{money(tot.regInv)}</td>
                                        <td style={tdT}>{tot.inv ? `${(tot.regInv / tot.inv).toFixed(2)}×` : '—'}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <Nota>
                                ROI = regalía que retiene Pulppo de los cierres del mes ÷ inversión. CPV = inversión ÷ personas que visitaron.
                                {tot.sinInv > 0 && <span style={{ color: RED }}> {tot.sinInv} mes(es) sin inversión cargada en el Sheet (s/d): quedan fuera del total del periodo.</span>}
                            </Nota>
                        </>)}
                    </>
                )}

                {secciones.has('periodo') && periodo && (
                    <>
                        <H>Leads del {periodo.actual.etiqueta}</H>
                        {!pf ? <div style={{ fontSize: 12, color: GRY }}>Sin leads de este canal en ese rango.</div> : (
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                                <tbody>
                                    {[['Leads', f0(pf.leads)], ['Personas', f0(pf.unicos)],
                                      ['Promedio por día', (pf.leads / Math.max(1, periodo.actual.dias)).toFixed(1)],
                                      ['% venta', pc(p1(pf.venta, pf.venta + pf.renta))],
                                      ['Respondidos <1 h', pc(pf.pctLt60)], ['Asesor sin responder', pc(pf.pctSinResp)],
                                      ['Con conversación', pc(pf.pctConConversacion)], ['Sin respuesta visible', pc(pf.pctSinRespuesta)],
                                      ['Fantasma', pc(pf.pctFantasma)]].map(([k, v]) => (
                                        <tr key={k}>
                                            <td style={{ ...td0, color: '#555' }}>{k}</td>
                                            <td style={{ ...td, fontWeight: 700, width: 140 }}>{v}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        <Nota>
                            Este bloque sí acepta fechas exactas. El de costo no: la inversión se factura
                            por mes, así que un rango partido no tendría con qué dividir.
                        </Nota>
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
            )}
        </div>
    );
}
