'use client';

/**
 * El apartado 1·5·10 de la inmobiliaria.
 *
 * Tiene dos estados y los dos son útiles:
 *   · con inventario  → cómo le va a SUS exclusivas, una por una
 *   · sin inventario  → por qué le convendría tener, con los números de la red
 *
 * El segundo no es un placeholder: hoy sólo 27 de 173 inmobiliarias tienen alguna 1·5·10
 * publicada, así que para la mayoría ESA es la pantalla, y su trabajo es que den de alta.
 * Por eso los beneficios y el botón de alta se muestran SIEMPRE, arriba, tenga o no tenga.
 */
import type { MBProp } from '@/lib/mb';
import { BENEFICIOS, ACCESOS, MEDIDO_EN } from '@/lib/p1510';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;

const f = (n: number) => n.toLocaleString('es-MX');
const money = (n: number | null) =>
    n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`;

// `mesesPub` viene crudo de mb.ts como `dias / 30`, así que sin esto la tabla imprime
// "9.566666666666666 meses publicada".
const meses = (m: number) => {
    const n = Math.round(m * 10) / 10;   // en español sólo el 1 exacto va en singular: 1.7 son "meses"
    return `${n.toLocaleString('es-MX')} ${n === 1 ? 'mes' : 'meses'}`;
};

const mediana = (v: number[]) => {
    if (!v.length) return 0;
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const td: React.CSSProperties = { padding: '8px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: GRY, borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };

/** Embudo compacto: leads → visitas → ofertas → cierres, a escala común de toda la tabla. */
function Embudo({ p, max }: { p: MBProp; max: number }) {
    const pasos: [string, number, string][] = [
        ['Leads', p.leads, GRY],
        ['Visitas', p.visitas, '#8fb8b8'],
        ['Ofertas', p.ofertas, YEL],
        ['Cierres', p.cierres, SEA],
    ];
    if (!p.leads && !p.visitas && !p.ofertas && !p.cierres) {
        return <span style={{ fontSize: 11, color: GRY }}>Sin movimiento</span>;
    }
    return (
        <div style={{ display: 'grid', gap: 2, minWidth: 130 }}>
            {pasos.map(([etq, v, color]) => (
                <div key={etq} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 44, fontSize: 9, color: GRY, textAlign: 'right' }}>{etq}</div>
                    <div style={{ flex: 1, height: 7, background: '#fafafa' }}>
                        <div style={{ width: `${max ? Math.max(v ? 3 : 0, (v / max) * 100) : 0}%`,
                                      height: '100%', background: color }} />
                    </div>
                    <div style={{ width: 22, fontSize: 10, fontVariantNumeric: 'tabular-nums',
                                  color: v ? BLK : GRY }}>{v || '—'}</div>
                </div>
            ))}
        </div>
    );
}

export default function MB1510({ props, urlFicha }: {
    props: MBProp[];
    urlFicha: (p: MBProp) => string;
}) {
    const mias = props.filter((p) => p.p1510);
    const tiene = mias.length > 0;

    const leads = mias.reduce((s, p) => s + p.leads, 0);
    const visitas = mias.reduce((s, p) => s + p.visitas, 0);
    const ofertas = mias.reduce((s, p) => s + p.ofertas, 0);
    const medLeads = mediana(mias.map((p) => p.leads));
    const sinLeads = mias.filter((p) => !p.leads).length;
    const maxEmbudo = Math.max(1, ...mias.map((p) => p.leads));

    return (
        <div>
            {/* ---- por qué conviene: los números de la red, tenga o no tenga ---- */}
            <div style={{ background: BLK, color: '#fff', borderRadius: R, padding: '24px 26px' }}>
                <div style={{ width: 44, height: 2, background: YEL, marginBottom: 14 }} />
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1.15, maxWidth: 640 }}>
                    Una exclusiva del programa cierra <b style={{ color: YEL }}>3 veces</b> más seguido
                    que un aviso normal.
                </div>
                <div style={{ display: 'grid', gap: 12, marginTop: 20,
                              gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
                    {BENEFICIOS.map((b) => (
                        <div key={b.clave} style={{ background: '#2c2e2d', borderRadius: R, padding: '14px 15px' }}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8,
                                          color: '#9d9d9b' }}>{b.titulo}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 7 }}>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1,
                                              color: YEL }}>{b.programa}</div>
                                <div style={{ fontSize: 11, color: '#9d9d9b' }}>
                                    vs {b.resto} · <b style={{ color: '#fff' }}>{b.factor}</b>
                                </div>
                            </div>
                            <div style={{ fontSize: 11, color: '#c9c9c7', marginTop: 8, lineHeight: 1.45 }}>
                                {b.lectura}
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ fontSize: 10, color: '#8a8a88', marginTop: 16, lineHeight: 1.5, maxWidth: 680 }}>
                    Toda la red, sólo propiedades en venta, medido el {MEDIDO_EN}. No es que se vendan
                    más rápido —de hecho tardan un poco más— sino que llegan a cerrarse mucho más seguido.
                </div>
            </div>

            {/* ---- ligas de trámite ---- */}
            <div style={{ display: 'grid', gap: 10, marginTop: 16,
                          gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
                {ACCESOS.map((a) => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
                        style={{ display: 'block', textDecoration: 'none', borderRadius: R, padding: '13px 15px',
                                 border: `1px solid ${a.principal ? BLK : '#E5E5E5'}`,
                                 background: a.principal ? YEL : '#fff' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: BLK }}>{a.titulo} ↗</div>
                        <div style={{ fontSize: 11, color: a.principal ? '#5f5300' : '#6f6f6d', marginTop: 3 }}>
                            {a.detalle}
                        </div>
                    </a>
                ))}
            </div>

            {/* ---- sus propiedades ---- */}
            {!tiene ? (
                <div style={{ marginTop: 22, background: LGT, borderLeft: `2px solid ${YEL}`,
                              padding: '16px 18px', maxWidth: 680 }}>
                    <b style={{ fontSize: 13 }}>Todavía no tienes ninguna propiedad en el programa.</b>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 6, lineHeight: 1.55 }}>
                        Cuando des de alta la primera, acá vas a ver cómo le va: leads, visitas, ofertas
                        y las alertas de cada una, con su reporte completo. Empieza por el botón amarillo.
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gap: 10, marginTop: 22,
                                  gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
                        {[['Propiedades 1·5·10', f(mias.length)],
                          ['Leads acumulados', f(leads)],
                          ['Leads por propiedad', f(Math.round(medLeads))],
                          ['Visitas', f(visitas)],
                          ['Ofertas', f(ofertas)]].map(([k, v]) => (
                            <div key={k} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px' }}>
                                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8,
                                              color: GRY }}>{k}</div>
                                <div style={{ fontSize: 22, fontWeight: 700,
                                              fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                            </div>
                        ))}
                    </div>

                    <p style={{ fontSize: 11, color: GRY, margin: '12px 0 0', lineHeight: 1.55, maxWidth: 700 }}>
                        &laquo;Leads por propiedad&raquo; es la mediana, comparable con los 25 de la red.
                        {mias.length < 5 && ' Con tan pocas propiedades un solo aviso mueve el número: léelo como referencia, no como tendencia.'}
                        {sinLeads > 0 && ` ${sinLeads === 1 ? 'Una' : f(sinLeads)} ${sinLeads === 1 ? 'está' : 'están'} sin un solo lead.`}
                    </p>

                    <p style={{ fontSize: 11, fontWeight: 700, margin: '22px 0 6px' }}>Tus propiedades del programa</p>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
                            <thead>
                                <tr><th style={th}>Código</th><th style={th}>Propiedad</th>
                                    <th style={th}>Precio</th><th style={th}>Embudo</th>
                                    <th style={th}>Alertas</th><th style={th} /></tr>
                            </thead>
                            <tbody>
                                {[...mias].sort((a, b) => b.leads - a.leads).map((p) => (
                                    <tr key={p.id}>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                            <a href={urlFicha(p)} target="_blank" rel="noreferrer"
                                                style={{ color: SEA, fontWeight: 700 }}>{p.code}</a>
                                        </td>
                                        <td style={td}>
                                            <div>{p.type} · {p.colonia}</div>
                                            <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>
                                                {p.asesor}{p.mesesPub != null && ` · ${meses(p.mesesPub)} publicada`}
                                            </div>
                                        </td>
                                        <td style={{ ...td, whiteSpace: 'nowrap',
                                                     fontVariantNumeric: 'tabular-nums' }}>{money(p.precio)}</td>
                                        <td style={td}><Embudo p={p} max={maxEmbudo} /></td>
                                        <td style={td}>
                                            {p.diag.length ? (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                    {p.diag.map((x) => (
                                                        <span key={x} style={{ fontSize: 10, padding: '2px 7px',
                                                            borderRadius: 999, background: '#fbeceb', color: RED }}>{x}</span>
                                                    ))}
                                                </div>
                                            ) : <span style={{ fontSize: 11, color: SEA }}>Sin alertas</span>}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <a href={urlFicha(p)} target="_blank" rel="noreferrer"
                                                style={{ color: SEA, fontWeight: 700 }}>Ver reporte ↗</a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
