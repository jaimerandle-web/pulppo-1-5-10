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
import { useEffect, useMemo, useState } from 'react';
import type { MBProp } from '@/lib/mb';
import { BENEFICIOS, ESCALERA, ACCESOS, MEDIDO_EN } from '@/lib/p1510';
import type { Historial } from '@/lib/historial1510';

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

// ---------------------------------------------------------------------------------------
// Candidatas a exclusiva.
//
// **Por qué NO usa el evaluador de /1-5-10/evaluar.** `computeEval()` hace entre 6 y 8
// consultas pesadas POR PROPIEDAD —cierres con $lookup, oferta contra el MLS, velocidad de
// zona, búsquedas—. Sobre una cartera de 337 avisos son más de 2,000 consultas: no cabe en
// una carga de página. Acá se usa lo que `mb.ts` YA trajo en bloque, sin una sola consulta
// extra.
//
// **Y por eso esto NO inventa un puntaje.** Sería fácil armar una cifra propia y tendríamos
// dos autoridades distintas contestando la misma pregunta, que es justo el problema a evitar.
// Esto es un FILTRO PREVIO: aplica los gates del programa (venta · residencial) y lista los
// requisitos OBJETIVOS que le faltan a cada una. El veredicto con % de aceptación lo sigue
// dando el evaluador, propiedad por propiedad.
const RESIDENCIAL = new Set(['Casa', 'Departamento', 'Casa en condominio', 'PH']);
const COMISION_META = 5;        // mismo umbral que sComision en elegibilidad.ts.
// El programa pide 5% **+ IVA**; `contract.comission` guarda el % SIN IVA, así que el
// umbral se compara contra 5 pero la etiqueta tiene que decirlo completo o el broker
// cree que ya cumple.
const SOBREPRECIO = 10;         // % sobre la zona a partir del cual cuenta como "fuera de precio"
const FOTOS_MIN = 12;           // mismo umbral que el gate de material del evaluador

// `contract.comission` viene en float crudo: sin esto la etiqueta imprime "hoy 3.4799999999999995%".
const pctCom = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('es-MX')}%`;

interface Falta { k: string; texto: string; duro: boolean }

/** Qué le falta para entrar al programa. `duro` = requisito, no mejora opcional. */
function faltantes(p: MBProp): Falta[] {
    const out: Falta[] = [];
    if (p.comision != null && p.comision < COMISION_META) {
        out.push({ k: 'com', texto: `Comisión al ${COMISION_META}% + IVA (hoy ${pctCom(p.comision)})`, duro: true });
    } else if (p.comision == null) {
        out.push({ k: 'com', texto: 'Comisión sin registrar', duro: true });
    }
    if (p.vsOferta != null && p.vsOferta > SOBREPRECIO) {
        out.push({ k: 'precio', texto: `Precio ${Math.round(p.vsOferta)}% arriba de su zona`, duro: true });
    }
    if (p.fotos < FOTOS_MIN) out.push({ k: 'fotos', texto: `${p.fotos} fotos (mínimo ${FOTOS_MIN})`, duro: false });
    if (!p.video) out.push({ k: 'video', texto: 'Falta video', duro: false });
    if (!p.tour) out.push({ k: 'tour', texto: 'Falta tour virtual', duro: false });
    return out;
}

/** Señal de que el mercado la quiere: gente buscando en su zona y leads que ya trae. */
function potencial(p: MBProp): number {
    return p.leads * 3 + p.visitas * 6 + Math.min(p.demanda, 120);
}

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

/**
 * Historial en el programa: TODAS sus exclusivas, no sólo las vivas. Se pide aparte porque
 * `mb.ts` sólo trae publicadas, y para muchas cuentas el pasado es más grande que el presente
 * (Diamond House: 26 exclusivas, 20 ya vendidas; Andina: 5 de 5 vendidas).
 */
function Historico({ companyId }: { companyId: string }) {
    const [h, setH] = useState<Historial | null>(null);
    const [err, setErr] = useState('');

    useEffect(() => {
        let vivo = true;
        setH(null); setErr('');
        fetch(`/api/mb-1510?company=${companyId}`)
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (vivo) ok ? setH(j) : setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [companyId]);

    if (err) return <p style={{ fontSize: 12.5, color: RED }}>{err}</p>;
    if (!h) return <p style={{ fontSize: 12.5, color: GRY }}>Leyendo tu historial…</p>;
    return <HistoricoVista h={h} />;
}

/**
 * La vista, separada de la carga a propósito: recibe los datos ya resueltos. Así se puede
 * renderizar del lado del servidor para revisarla, sin depender de que el navegador hidrate.
 */
export function HistoricoVista({ h }: { h: Historial }) {
    if (!h.props.length) return null;

    const vendidas = h.props.filter((x) => x.estado === 'vendida');
    const vivas = h.props.filter((x) => x.estado === 'publicada');
    const leads = h.props.reduce((a, x) => a + x.leads, 0);
    const cerradas = vendidas.length, total = h.props.length;

    return (
        <>
            <div style={{ marginTop: 34, paddingTop: 22, borderTop: `2px solid ${BLK}` }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, lineHeight: 1.2 }}>
                    Tu historial en el programa
                </div>
                <p style={{ fontSize: 12.5, color: '#6f6f6d', margin: '7px 0 0',
                            maxWidth: '72ch', lineHeight: 1.6 }}>
                    Todas las exclusivas 1·5·10 que has tenido, no sólo las que siguen publicadas.
                </p>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 16,
                          gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
                {[['Entraron al programa', f(total)],
                  ['Ya se vendieron', f(cerradas)],
                  ['Siguen publicadas', f(vivas.length)],
                  ['Días en venderse', h.medianaDiasVenta != null ? f(h.medianaDiasVenta) : '—'],
                  ['Leads acumulados', f(leads)]].map(([k, v]) => (
                    <div key={k} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8,
                                      color: GRY }}>{k}</div>
                        <div style={{ fontSize: 22, fontWeight: 700,
                                      fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    </div>
                ))}
            </div>

            <p style={{ fontSize: 11, color: GRY, margin: '10px 0 0', lineHeight: 1.6, maxWidth: '76ch' }}>
                «Días en venderse» es la mediana de las que ya cerraron, contada desde que se
                publicaron{cerradas > 0 && cerradas < 4 ? ` — con ${cerradas === 1 ? 'una sola venta' : `sólo ${cerradas} ventas`} tómalo como referencia, no como promedio` : ''}.
            </p>

            <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
                    <thead>
                        <tr><th style={th}>Código</th><th style={th}>Propiedad</th>
                            <th style={th}>Estado</th>
                            <th style={{ ...th, textAlign: 'right' }}>Precio</th>
                            <th style={{ ...th, textAlign: 'right' }}>Leads</th>
                            <th style={{ ...th, textAlign: 'right' }}>Visitas</th></tr>
                    </thead>
                    <tbody>
                        {h.props.map((x) => (
                            <tr key={x.id}>
                                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{x.code}</td>
                                <td style={td}>
                                    <div>{x.tipo} · {x.colonia}</div>
                                    <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{x.asesor}</div>
                                </td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    {x.estado === 'vendida' ? (
                                        <span style={{ color: SEA, fontWeight: 700 }}>
                                            Vendida{x.diasVenta != null && (
                                                <span style={{ color: GRY, fontWeight: 400 }}> · {f(x.diasVenta)} días</span>)}
                                        </span>
                                    ) : x.estado === 'publicada' ? (
                                        <span style={{ color: '#6f6f6d' }}>
                                            Publicada{x.mesesVivos != null && (
                                                <span style={{ color: GRY }}> · {x.mesesVivos} meses</span>)}
                                        </span>
                                    ) : <span style={{ color: GRY }}>Fuera del programa</span>}
                                </td>
                                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap',
                                             fontVariantNumeric: 'tabular-nums' }}>{money(x.precio)}</td>
                                <td style={{ ...td, textAlign: 'right',
                                             fontVariantNumeric: 'tabular-nums' }}>{f(x.leads)}</td>
                                <td style={{ ...td, textAlign: 'right',
                                             fontVariantNumeric: 'tabular-nums' }}>{x.visitas || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

export default function MB1510({ props, companyId, urlFicha }: {
    props: MBProp[];
    companyId: string;
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

    // Candidatas: pasan los gates del programa, no están ya dentro, y el mercado da alguna
    // señal. Sin la señal de mercado la lista sería «todo tu inventario residencial en venta»,
    // que no ayuda a decidir por cuál empezar.
    const candidatas = useMemo(() => props
        .filter((p) => !p.p1510 && p.op === 'Venta' && RESIDENCIAL.has(p.type)
                       && (p.leads > 0 || p.visitas > 0 || p.demanda > 0))
        .map((p) => ({ p, falta: faltantes(p), pot: potencial(p) }))
        .sort((a, b) => b.pot - a.pot), [props]);
    const TOPE = 15;
    const listadas = candidatas.slice(0, TOPE);

    return (
        <div>
            {/* ---- por qué conviene: los números de la red, tenga o no tenga ----
                 Va sobre fondo CLARO y no sobre el bloque negro que tenía antes. El problema
                 no era sólo el contraste: la cifra, su comparación y el multiplicador estaban
                 apretados en la misma línea y competían entre sí. Acá cada uno tiene su
                 renglón —cifra, multiplicador, comparación— y se lee en tres saltos. */}
            <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
                {BENEFICIOS.map((b, i) => (
                    <div key={b.clave} style={{ padding: i === 0 ? '0 22px 0 0' : '0 22px',
                                                borderLeft: i === 0 ? undefined : `1px solid ${LGT}` }}>
                        <div style={{ fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase',
                                      fontWeight: 700, color: GRY, marginBottom: 13 }}>{b.titulo}</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 52, lineHeight: .92,
                                      letterSpacing: -.5, fontVariantNumeric: 'tabular-nums' }}>{b.programa}</div>
                        <div style={{ display: 'inline-block', marginTop: 12, padding: '3px 9px',
                                      borderRadius: R, background: YEL, color: BLK,
                                      fontSize: 11.5, fontWeight: 700 }}>{b.factor}</div>
                        <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${LGT}`,
                                      fontSize: 12.5, color: '#6f6f6d' }}>
                            Fuera del programa: <b style={{ color: BLK }}>{b.resto}</b>
                        </div>
                    </div>
                ))}
            </div>

            {/* La escalera de plazos es la respuesta al "¿no será que llevan más tiempo
                publicadas?": la ventana es la misma para los dos lados, así que el reclamo no
                aplica por construcción. Va en chico, de apoyo, no como gráfica principal. */}
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${LGT}`,
                          display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'baseline' }}>
                <div style={{ fontSize: 11.5, color: '#6f6f6d', maxWidth: 230, lineHeight: 1.5 }}>
                    Y se sostiene a todos los plazos — cuántas de cada 100 publicadas ya se
                    vendieron:
                </div>
                {ESCALERA.map((e) => (
                    <div key={e.plazo}>
                        <div style={{ fontSize: 10, letterSpacing: .8, textTransform: 'uppercase',
                                      color: GRY, marginBottom: 4 }}>{e.plazo}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7,
                                      fontVariantNumeric: 'tabular-nums' }}>
                            <b style={{ fontSize: 17 }}>{e.programa}%</b>
                            <span style={{ fontSize: 12, color: GRY }}>vs {e.resto}%</span>
                        </div>
                    </div>
                ))}
            </div>

            <p style={{ fontSize: 11, color: GRY, margin: '16px 0 0', lineHeight: 1.6, maxWidth: '76ch' }}>
                Toda la red, sólo propiedades en venta, medido el {MEDIDO_EN}. Los plazos se
                comparan dentro de la misma ventana de tiempo, así que no es que las del programa
                lleven más publicadas.
            </p>

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

            <Historico companyId={companyId} />

            {/* ---- candidatas a exclusiva ---- */}
            {candidatas.length > 0 && (
                <>
                    <div style={{ marginTop: 34, paddingTop: 22, borderTop: `2px solid ${BLK}` }}>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, lineHeight: 1.2 }}>
                            Propiedades con potencial para convertir en exclusiva
                        </div>
                        <p style={{ fontSize: 12.5, color: '#6f6f6d', margin: '7px 0 0',
                                    maxWidth: '72ch', lineHeight: 1.6 }}>
                            De tu inventario en venta, las que el programa acepta por tipo y que ya
                            tienen movimiento. Ordenadas por la señal del mercado: leads y visitas que
                            ya traen, más gente buscando en su zona. La columna de la derecha es lo que
                            habría que resolver para meterlas.
                        </p>
                    </div>

                    <div style={{ overflowX: 'auto', marginTop: 16 }}>
                        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
                            <thead>
                                <tr><th style={th}>Código</th><th style={th}>Propiedad</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Precio</th>
                                    <th style={th}>Potencial de venta</th>
                                    <th style={th}>Qué le falta para entrar</th></tr>
                            </thead>
                            <tbody>
                                {listadas.map(({ p, falta }) => (
                                    <tr key={p.id}>
                                        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{p.code}</td>
                                        <td style={td}>
                                            <div>{p.type} · {p.colonia}</div>
                                            <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{p.asesor}</div>
                                        </td>
                                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap',
                                                     fontVariantNumeric: 'tabular-nums' }}>{money(p.precio)}</td>
                                        <td style={{ ...td, fontSize: 11.5, color: '#6f6f6d' }}>
                                            <b style={{ color: BLK }}>{f(p.leads)}</b> leads
                                            {p.visitas > 0 && <> · <b style={{ color: BLK }}>{f(p.visitas)}</b> visitas</>}
                                            {p.demanda > 0 && <><br />{f(p.demanda)} buscando en la zona</>}
                                        </td>
                                        <td style={td}>
                                            {falta.length === 0 ? (
                                                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999,
                                                               background: '#e8f2f2', color: SEA, fontWeight: 700 }}>
                                                    Lista para proponerla
                                                </span>
                                            ) : (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                    {falta.map((x) => (
                                                        <span key={x.k} style={{ fontSize: 10.5, padding: '2px 7px',
                                                            borderRadius: 999,
                                                            background: x.duro ? '#fbeceb' : LGT,
                                                            color: x.duro ? RED : '#6f6f6d' }}>{x.texto}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <p style={{ fontSize: 11, color: GRY, marginTop: 12, lineHeight: 1.6, maxWidth: '78ch' }}>
                        {candidatas.length > TOPE
                            ? `Se muestran las ${TOPE} de mayor potencial, de ${f(candidatas.length)} que califican por tipo. `
                            : ''}
                        En rojo van los requisitos del programa y en gris el material, que se puede
                        completar después. Esta lista es un filtro previo: el veredicto con porcentaje
                        de aceptación lo da el evaluador, propiedad por propiedad.
                    </p>
                </>
            )}
        </div>
    );
}
