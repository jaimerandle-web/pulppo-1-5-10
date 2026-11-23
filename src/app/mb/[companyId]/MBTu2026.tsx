'use client';

/**
 * «Tu 2026»: el cierre de año de la inmobiliaria (Master Experience, 3-dic-2026). Ver `lib/tu2026.ts`.
 *
 *   · Tu año — para el dueño: sus números de 2024, 2025 y 2026 (mismo corte) en tarjetas con mini-gráfica,
 *     y «Logros del año» / «Lo que faltó para romperla» SÓLO contra sí misma. Los pares sólo los ve Pulppo.
 *   · Reconocimientos — para sus asesores: 8 premios dentro de la inmobiliaria (podio de 3), cada lugar con su
 *     carta (PDF, firman el master broker y Pulppo) y sus piezas para redes (post 4:5 e historia 9:16, SIN montos);
 *     y un diploma de cierre de año para todo el equipo, con el badge de su nivel.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Diploma, Ganador, Metrica, NivelKey, Premio, Reconocimientos, TuAnio } from '@/lib/tu2026';
import { PresentacionKam } from './tu2026Presentacion';
import { ensureFonts, loadImg } from '@/app/plus/rankingRender';

const BLK = '#212322', YEL = '#F6BE00', LINE = '#D0D3D4', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const MUTED = 'rgba(33,35,34,.6)', FAINT = 'rgba(33,35,34,.35)';
const serif = 'EB Garamond, serif';
const tag: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' };

const fmt = (v: number | null, f: Metrica['fmt']) => {
    if (v == null) return '—';
    if (f === 'money') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} MDP` : `$${Math.round(v).toLocaleString('es-MX')}`;
    if (f === 'pct') { const p = v * 100; return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`; }
    if (f === 'min') return v >= 90 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
    return Math.round(v).toLocaleString('es-MX');
};

function useApi<T>(url: string) {
    const [d, setD] = useState<T | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        setD(null); setErr('');
        fetch(url).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (vivo) (ok ? setD(j) : setErr(j.error || 'No se pudo calcular')); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [url]);
    return { d, err };
}

const Cargando = ({ err }: { err: string }) => (
    <div style={{ padding: '28px 0', color: err ? RED : MUTED, fontSize: 14 }}>
        {err || 'Calculando el año (la primera vez tarda ~30 segundos)…'}
    </div>
);

export default function MBTu2026({ companyId, abierta, interno }: { companyId: string; abierta: boolean; interno: boolean }) {
    const [vista, setVista] = useState<'anio' | 'rec'>('anio');
    const tab = (k: 'anio' | 'rec', l: string) => (
        <button onClick={() => setVista(k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${vista === k ? BLK : LINE}`, background: vista === k ? BLK : '#fff', color: vista === k ? '#fff' : BLK, borderRadius: 2,
        }}>{l}</button>
    );
    return (
        <div>
            {!abierta && (
                <div style={{ fontSize: 12, color: MUTED, background: LGT, padding: '8px 12px', marginBottom: 14, borderLeft: `3px solid ${YEL}` }}>
                    Oculta para la inmobiliaria: hasta la Master Experience del 3 de diciembre sólo la ve el equipo Pulppo.
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
                {tab('anio', 'Tu año')}{tab('rec', 'Reconocimientos')}
            </div>
            <div style={{ display: vista === 'anio' ? 'block' : 'none' }}><TuAnioView companyId={companyId} interno={interno} /></div>
            {vista === 'rec' && <RecView companyId={companyId} />}
        </div>
    );
}

/** «ⓘ» que se abre al picarle (antes era un `title`: sólo con hover y nunca en el celular). La explicación se
 *  dibuja sobre la tarjeta (`position: relative` en el padre), así no se sale de la pantalla. */
function Ayuda({ texto }: { texto: string }) {
    const [abierta, setAbierta] = useState(false);
    return (
        <>
            <button onClick={() => setAbierta((x) => !x)} aria-label="Qué significa" aria-expanded={abierta}
                style={{ background: 'none', border: 'none', padding: '0 2px', margin: 0, cursor: 'pointer', color: abierta ? BLK : MUTED, fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 400 }}>ⓘ</button>
            {abierta && (
                <div role="note" onClick={() => setAbierta(false)} style={{
                    position: 'absolute', left: 10, right: 10, top: 40, zIndex: 5, background: BLK, color: '#fff', padding: '12px 14px',
                    fontSize: 12.5, fontWeight: 400, lineHeight: 1.5, textTransform: 'none', letterSpacing: 0, cursor: 'pointer',
                }}>
                    {texto}
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 6 }}>Toca para cerrar</div>
                </div>
            )}
        </>
    );
}

// ── TU AÑO ────────────────────────────────────────────────────────────────────
function TuAnioView({ companyId, interno }: { companyId: string; interno: boolean }) {
    const { d, err } = useApi<TuAnio>(`/api/mb-tu2026?company=${companyId}&vista=anio`);
    const [conPares, setConPares] = useState(false);
    if (!d) return <Cargando err={err} />;
    const grupos = [...new Set(d.metricas.map((m) => m.grupo))];
    const ant = d.años[1];
    const sinAnterior = d.metricas.every((m) => !m.valores[ant]);
    // sólo los hallazgos contra el año pasado marcan la tarjeta (los del trimestre o el récord no son ese número)
    const marca = new Map<string, 'logro' | 'falto'>([...d.logros.filter((h) => h.vs === 'año').map((h) => [h.metrica, 'logro'] as const), ...d.falto.map((h) => [h.metrica, 'falto'] as const)]);
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
                <div style={{ fontSize: 13, color: MUTED, maxWidth: 680 }}>
                    Tu inmobiliaria contra sí misma, con el mismo periodo en los tres años: <b style={{ color: BLK }}>{d.corte}</b>.
                </div>
                {interno && <PresentacionKam d={d} companyId={companyId} />}
                {interno && d.pares && (
                    <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', color: MUTED }}>
                        <input type="checkbox" checked={conPares} onChange={(e) => setConPares(e.target.checked)} />
                        Ver contra pares (sólo Pulppo)
                    </label>
                )}
            </div>
            {interno && conPares && d.pares && (
                <div style={{ fontSize: 12, color: MUTED, background: LGT, padding: '8px 12px', marginBottom: 18 }}>
                    Pares = las {d.pares.n} inmobiliarias con {d.pares.desde.toLocaleString('es-MX')}–{d.pares.hasta.toLocaleString('es-MX')} propiedades
                    publicadas (esta tiene {d.pares.publicadas.toLocaleString('es-MX')}). Para preparar la 1:1: la inmobiliaria no lo ve.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 34 }}>
                <Hallazgos titulo="Logros del año" color={SEA} items={d.logros}
                    vacio={sinAnterior ? 'Es tu primer año completo en Pulppo: el próximo ya tendrás contra qué compararte.' : `Ninguna métrica creció 5% o más contra ${ant}, ni 15% o más dentro del año.`} />
                <Hallazgos titulo="Lo que faltó para romperla" color={RED} items={d.falto}
                    vacio={sinAnterior ? '—' : `Nada quedó 5% o más por debajo de ${ant}.`} />
            </div>

            {grupos.map((g) => (
                <div key={g} style={{ marginBottom: 30 }}>
                    <div style={{ ...tag, marginBottom: 12 }}>{g}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
                        {d.metricas.filter((m) => m.grupo === g).map((m) => (
                            <MetricaCard key={m.key} m={m} años={d.años} corte={d.corte} marca={marca.get(m.key)} pares={interno && conPares} grande={g === 'Resultados'} />
                        ))}
                    </div>
                </div>
            ))}

            <MesAMes d={d} />
            <EmbudoView d={d} />
            {d.inventario && <InventarioView inv={d.inventario} />}
            <EquipoView d={d} />
        </div>
    );
}

const Seccion = ({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children: ReactNode }) => (
    <div style={{ marginTop: 40, borderTop: `1px solid ${BLK}`, paddingTop: 22 }}>
        <div style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.15 }}>{titulo}</div>
        {sub && <div style={{ fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 16, maxWidth: 760 }}>{sub}</div>}
        {children}
    </div>
);
const Tile = ({ label, valor, nota, oscuro }: { label: string; valor: ReactNode; nota?: ReactNode; oscuro?: boolean }) => (
    <div style={{ background: oscuro ? BLK : LGT, color: oscuro ? '#fff' : BLK, padding: '16px 18px' }}>
        <div style={{ ...tag }}>{label}</div>
        <div style={{ fontFamily: serif, fontSize: 36, lineHeight: 1.1, marginTop: 10 }}>{valor}</div>
        {nota && <div style={{ fontSize: 12, color: oscuro ? 'rgba(255,255,255,.7)' : MUTED, marginTop: 4, lineHeight: 1.4 }}>{nota}</div>}
    </div>
);

/** Leads, visitas y cierres por mes; el mejor mes (más cierres) en amarillo en las tres. */
function MesAMes({ d }: { d: TuAnio }) {
    const m = d.mensual;
    const ix = m.mejorMes?.i ?? -1;
    const H = 64;
    return (
        <Seccion titulo="Mes a mes" sub={<>Para ver si una caída fue de todo el año o de unos meses.{m.mejorMes ? <> Tu mejor mes fue <b style={{ color: BLK }}>{m.mejorMes.mes.toLowerCase()}</b>, en amarillo.</> : null}{m.parcial ? ` ${m.meses[m.meses.length - 1]}* va a medias (hasta el corte).` : ''}</>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
                    {m.series.filter((x) => ['leads', 'visitas', 'cierres'].includes(x.key)).map((se) => {
                        const max = Math.max(...se.vals, 1);
                        return (
                            <div key={se.key}>
                                <div style={{ ...tag, marginBottom: 6 }}>{se.label}</div>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: H + 16 }}>
                                    {se.vals.map((v, i) => (
                                        <div key={i} title={`${m.meses[i]}: ${fmt(v, se.fmt)}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch' }}>
                                            {(i === ix || v === max) && <div style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', marginBottom: 2 }}>{fmt(v, se.fmt)}</div>}
                                            <div style={{ height: Math.max(2, Math.round((v / max) * H)), background: i === ix ? YEL : FAINT }} />
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: 4, borderTop: `1px solid ${LINE}`, paddingTop: 3 }}>
                                    {m.meses.map((x, i) => <div key={x} style={{ flex: 1, minWidth: 0, fontSize: 10, color: MUTED, textAlign: 'center' }}>{x}{m.parcial && i === m.meses.length - 1 ? '*' : ''}</div>)}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {m.mejorMes && <Tile label="Mejor mes" valor={m.mejorMes.mes} nota={`${m.mejorMes.cierres} cierres`} />}
                    {m.mayor && <Tile label="Venta más grande" valor={fmt(m.mayor.valor, 'money')} nota={[m.mayor.tipo, m.mayor.codigo, m.mayor.fecha].filter(Boolean).join(' · ')} />}
                </div>
            </div>
        </Seccion>
    );
}

/** Embudo por PERSONAS y las tres tasas contra el promedio de Pulppo (sólo tasas: en volumen sería spoiler). */
function EmbudoView({ d }: { d: TuAnio }) {
    const e = d.embudo, top = Math.max(e.pasos[0]?.n ?? 0, 1);
    return (
        <Seccion titulo="Cómo convierte tu equipo" sub="Personas que te escribieron en el periodo y hasta dónde llegaron. Contra el promedio de Pulppo sólo se comparan tasas, nunca volumen.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 28 }}>
                <div>
                    {e.pasos.map((p, i) => (
                        <div key={p.label} style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</span>
                                <span><span style={{ fontFamily: serif, fontSize: 22 }}>{p.n.toLocaleString('es-MX')}</span>
                                    {i > 0 && e.pasos[i - 1].n > 0 && <span style={{ fontSize: 12, color: MUTED }}> · {fmt(p.n / e.pasos[i - 1].n, 'pct')} del paso anterior</span>}</span>
                            </div>
                            <div style={{ background: LGT, height: 14, marginTop: 4 }}>
                                <div style={{ width: `${Math.max(0.6, (100 * p.n) / top)}%`, height: '100%', background: i === e.pasos.length - 1 ? BLK : FAINT }} />
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ border: `0.5px solid ${LINE}`, padding: '14px 18px', alignSelf: 'start' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px 18px', alignItems: 'baseline' }}>
                        <span style={tag}>Contra Pulppo</span><span style={{ ...tag, textAlign: 'right' }}>Tú</span><span style={{ ...tag, textAlign: 'right', color: MUTED }}>Pulppo</span>
                        {e.tasas.map((t) => {
                            const arriba = t.yo != null && t.red != null && t.yo > t.red;
                            return [
                                <span key={t.key + 'l'} style={{ fontSize: 13, borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>{t.label}</span>,
                                <span key={t.key + 'y'} style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', borderTop: `0.5px solid ${LINE}`, paddingTop: 8, color: t.yo == null ? MUTED : arriba ? SEA : BLK }}>
                                    {t.yo == null ? '—' : <>{arriba && <span style={{ fontSize: 10 }}>▲ </span>}{fmt(t.yo, 'pct')}</>}
                                </span>,
                                <span key={t.key + 'r'} style={{ fontSize: 13, color: MUTED, textAlign: 'right', borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>{fmt(t.red, 'pct')}</span>,
                            ];
                        })}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 10, lineHeight: 1.4 }}>Promedio de las inmobiliarias de Pulppo con al menos 30 personas (o 10 que visitaron). Con menos que eso no se compara.</div>
                </div>
            </div>
        </Seccion>
    );
}

function InventarioView({ inv }: { inv: NonNullable<TuAnio['inventario']> }) {
    const hoy = inv.hoy.venta + inv.hoy.renta, ene = inv.ene.venta + inv.ene.renta, dif = hoy - ene;
    const max = Math.max(inv.hoy.venta, inv.hoy.renta, inv.ene.venta, inv.ene.renta, 1);
    const barra = (v: number, c: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: `${(70 * v) / max}%`, height: 12, background: c }} /><span style={{ fontSize: 13, fontWeight: 700 }}>{v}</span>
        </div>
    );
    return (
        <Seccion titulo="Tu inventario" sub={`Hoy tienes ${hoy.toLocaleString('es-MX')} propiedades publicadas en Pulppo. Calidad y precio son la foto de hoy, con el mismo cálculo de la pestaña Propiedades.`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Tile label="Publicadas hoy" valor={hoy.toLocaleString('es-MX')} nota={`Venta ${inv.hoy.venta} · renta ${inv.hoy.renta}. Al 1 de enero: ${ene} (${dif >= 0 ? '+' : '−'}${Math.abs(dif)})`} />
                <Tile label="Calidad alta" valor={fmt(inv.calidadAlta, 'pct')} nota="De tus fichas publicadas. Lo que más separa Media de Alta es el video." />
                <Tile label="En precio de mercado" valor={fmt(inv.enPrecio, 'pct')} nota={`Precio «Óptimo» contra las comparables de su zona (de ${inv.conPrecio} con comparables).`} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: '8px 16px', marginTop: 18, alignItems: 'center', maxWidth: 640 }}>
                <span /><span style={{ ...tag, color: MUTED }}>Al 1 de enero</span><span style={tag}>Hoy</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Venta</span>{barra(inv.ene.venta, FAINT)}{barra(inv.hoy.venta, BLK)}
                <span style={{ fontSize: 13, fontWeight: 700 }}>Renta</span>{barra(inv.ene.renta, FAINT)}{barra(inv.hoy.renta, BLK)}
            </div>
        </Seccion>
    );
}

const NIV_CORTO: Record<NivelKey, string> = { elite: 'Élite', professional: 'Profesional', standard: 'Estándar' };
function EquipoView({ d }: { d: TuAnio }) {
    const e = d.equipo;
    const [todos, setTodos] = useState(false);
    const filas = todos ? e.filas : e.filas.slice(0, 8);
    const th: CSSProperties = { ...tag, textAlign: 'right', padding: '6px 0 6px 12px', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap' };
    const td: CSSProperties = { fontSize: 13, textAlign: 'right', padding: '7px 0 7px 12px', borderBottom: `0.5px solid ${LINE}` };
    return (
        <Seccion titulo="Tu equipo" sub={`${e.activos} asesores activos hoy. Lo que hizo cada uno en el año y lo que hay que corregir.`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignSelf: 'start' }}>
                    <Tile label="Sin leads 3 meses o más" valor={e.sinLeads.length}
                        nota={e.sinLeads.length ? e.sinLeads.map((x) => `${x.nombre}${x.ultimo ? ` (último: ${x.ultimo})` : ' (sin leads en el año)'}`).join(' · ') : 'Todo tu equipo recibe leads.'} />
                    <Tile label="Tareas vencidas hoy" valor={e.tareasVencidas.toLocaleString('es-MX')} nota={`${e.tareasPendientes.toLocaleString('es-MX')} pendientes en total.`} />
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: MUTED, lineHeight: 1.4 }}>
                        «Sin leads» no cuenta al master broker ni a las cuentas administrativas.
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>Asesor</th><th style={th}>Leads</th><th style={th}>Visitas</th><th style={th}>Cierres</th><th style={th}>Nivel</th></tr></thead>
                        <tbody>{filas.map((f) => (
                            <tr key={f.nombre}><td style={{ ...td, textAlign: 'left', paddingLeft: 0, fontWeight: 700 }}>{f.nombre}</td><td style={td}>{f.leads.toLocaleString('es-MX')}</td>
                                <td style={td}>{f.visitas.toLocaleString('es-MX')}</td><td style={td}>{f.cierres}</td><td style={{ ...td, color: MUTED }}>{NIV_CORTO[f.nivel]}</td></tr>
                        ))}</tbody>
                    </table>
                    {e.filas.length > 8 && <button style={{ ...link, marginTop: 8 }} onClick={() => setTodos((x) => !x)}>{todos ? 'Ver menos' : `Ver los ${e.filas.length}`}</button>}
                </div>
            </div>
        </Seccion>
    );
}

function Hallazgos({ titulo, color, items, vacio }: { titulo: string; color: string; items: TuAnio['logros']; vacio: string }) {
    return (
        <div style={{ background: LGT, padding: '18px 20px', borderLeft: `3px solid ${color}` }}>
            <div style={{ ...tag, fontSize: 12, marginBottom: 12 }}>{titulo}</div>
            {items.length ? items.map((h, i) => (
                <div key={h.metrica} style={{ display: 'flex', gap: 12, marginTop: i ? 14 : 0 }}>
                    <div style={{ fontFamily: serif, fontSize: 28, lineHeight: 1, color: MUTED, minWidth: 18 }}>{i + 1}</div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{h.titulo}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 2 }}>{h.texto}</div>
                    </div>
                </div>
            )) : <div style={{ fontSize: 13, color: MUTED }}>{vacio}</div>}
        </div>
    );
}

function MetricaCard({ m, años, corte, marca, pares, grande }: { m: Metrica; años: number[]; corte: string; marca?: 'logro' | 'falto'; pares: boolean; grande: boolean }) {
    const [a0, a1, a2] = años;
    const v = m.valores[a2], ant = m.valores[a1];
    const ch = v != null && ant != null && ant > 0 ? (v - ant) / ant : null;
    const orient = ch == null || m.dir === 0 ? 0 : ch * m.dir;
    // verde/rojo desde ±5% (Ale: que se sientan los logros); entre −5% y +5%, gris
    // (con el % ya redondeado: si dice «5%», se pinta, igual que en los logros)
    const pct = ch == null ? null : Math.round(Math.abs(ch) * 100);
    const color = pct == null || pct < 5 ? MUTED : orient > 0 ? SEA : RED;
    return (
        <div style={{ position: 'relative', border: `0.5px solid ${LINE}`, borderTop: `2px solid ${marca === 'logro' ? SEA : marca === 'falto' ? RED : LINE}`, padding: '14px 16px 12px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{m.label} <Ayuda texto={`${m.ayuda} Periodo: ${corte}, igual en los tres años.`} /></span>
                {marca && <span style={{ ...tag, fontSize: 9, color: MUTED, whiteSpace: 'nowrap' }}>{marca === 'logro' ? 'Logro' : 'Faltó'}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: serif, fontSize: grande ? 38 : 32, lineHeight: 1 }}>{fmt(v, m.fmt)}</span>
                {pct != null && (
                    <span style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: m.dir === 0 ? MUTED : color }}>
                        {pct === 0 ? null : <span style={{ fontSize: 10 }}>{ch! > 0 ? '▲' : '▼'}</span>}
                        {pct === 0 ? `igual que ${a1}` : `${pct}% vs ${a1}`}
                    </span>
                )}
            </div>
            <Barras vals={[a0, a1, a2].map((y) => m.valores[y])} años={[a0, a1, a2]} f={m.fmt} />
            {pares && m.pares != null && (
                <div style={{ fontSize: 11, color: MUTED, marginTop: 8, borderTop: `0.5px solid ${LINE}`, paddingTop: 6 }}>
                    Pares: {fmt(m.pares, m.fmt)}{m.pctl != null ? ` · supera al ${m.pctl}%` : ''}
                </div>
            )}
        </div>
    );
}

/** Tres barras (un año cada una), la del año en curso en amarillo. Etiqueta directa en cada barra: son sólo tres. */
function Barras({ vals, años, f }: { vals: (number | null)[]; años: number[]; f: Metrica['fmt'] }) {
    const max = Math.max(...vals.map((x) => x ?? 0), 0);
    const H = 54;
    return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 'auto', paddingTop: 14 }}>
            {vals.map((x, i) => {
                const h = x == null || max <= 0 ? 0 : Math.max(2, Math.round((x / max) * H));
                const ultimo = i === vals.length - 1;
                return (
                    <div key={años[i]} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0 }} title={`${años[i]}: ${fmt(x, f)}`}>
                        <div style={{ fontSize: 10, color: ultimo ? BLK : MUTED, fontWeight: ultimo ? 700 : 400, textAlign: 'center', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {fmt(x, f)}
                        </div>
                        <div style={{ height: H, display: 'flex', alignItems: 'flex-end' }}>
                            <div style={{ width: '100%', height: h, background: ultimo ? YEL : FAINT }} />
                        </div>
                        <div style={{ fontSize: 10, color: MUTED, textAlign: 'center', marginTop: 4, borderTop: `1px solid ${LINE}`, paddingTop: 3 }}>{años[i]}</div>
                    </div>
                );
            })}
        </div>
    );
}

// ── RECONOCIMIENTOS ───────────────────────────────────────────────────────────
interface Firmas {
    dueno: string; duenoCargo: string; pulppo: string; pulppoCargo: string; lugarFecha: string; cierre: string;
    msgElite: string; msgProfessional: string; msgStandard: string;
}
const FIRMAS0: Firmas = {
    dueno: '', duenoCargo: 'Master Broker', pulppo: '', pulppoCargo: 'Pulppo',
    lugarFecha: 'Ciudad de México, 3 de diciembre de 2026', cierre: 'Gracias por tu trabajo y tu compromiso durante 2026.',
    msgElite: 'Terminas 2026 como Broker Élite, el nivel más alto de Pulppo. Tu forma de trabajar marca la pauta para tu equipo y para toda la red. Que 2027 sea para sostenerlo y llevar a otros contigo.',
    msgProfessional: 'Terminas 2026 como Broker Profesional. Ya tienes el volumen; el salto a Élite está en la velocidad, en más visitas y en tickets más altos. 2027 es el año para darlo.',
    msgStandard: 'Terminas 2026 como Broker Estándar y con la base puesta. El camino a Profesional se construye con constancia: captar, atender cada lead y convertirlo en visita. En 2027 vamos por ese siguiente nivel.',
};
const NIVEL: Record<NivelKey, { label: string; img: string; msg: 'msgElite' | 'msgProfessional' | 'msgStandard' }> = {
    elite: { label: 'Broker Élite', img: '/tu2026/nivel-elite.png', msg: 'msgElite' },
    professional: { label: 'Broker Profesional', img: '/tu2026/nivel-professional.png', msg: 'msgProfessional' },
    standard: { label: 'Broker Estándar', img: '/tu2026/nivel-standard.png', msg: 'msgStandard' },
};
const LUGAR = ['', 'Primer lugar', 'Segundo lugar', 'Tercer lugar'];

function RecView({ companyId }: { companyId: string }) {
    const { d, err } = useApi<Reconocimientos>(`/api/mb-tu2026?company=${companyId}&vista=reconocimientos`);
    const clave = `tu2026-firmas-${companyId}`;
    const [f, setF] = useState<Firmas>(FIRMAS0);
    useEffect(() => {
        try { const s = localStorage.getItem(clave); if (s) setF({ ...FIRMAS0, ...JSON.parse(s) }); } catch { /* sin storage */ }
    }, [clave]);
    // por default firma el master broker
    useEffect(() => { if (d?.masters.length) setF((x) => (x.dueno ? x : { ...x, dueno: d.masters[0] })); }, [d]);
    const set = (k: keyof Firmas, v: string) => setF((x) => {
        const n = { ...x, [k]: v };
        try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* sin storage */ }
        return n;
    });
    if (!d) return <Cargando err={err} />;
    const con = d.premios.filter((p) => p.podio.length), sin = d.premios.filter((p) => !p.podio.length);
    const inp: CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 2, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' };
    const lbl: CSSProperties = { ...tag, marginBottom: 4, display: 'block' };
    return (
        <div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 18, maxWidth: 760 }}>
                Los mejores de {d.inmobiliaria} del {d.corte} de {d.año}, con las mismas reglas que los premios de la gala (que compiten
                contra toda la red). Cada lugar del podio trae su carta para imprimir y sus piezas para redes; en redes no va ningún monto.
            </div>

            <details style={{ background: LGT, padding: '14px 18px', marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Firmas y textos de las cartas y diplomas</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
                    <label><span style={lbl}>Firma de la inmobiliaria</span>
                        {d.masters.length > 1
                            ? <select style={inp} value={f.dueno} onChange={(e) => set('dueno', e.target.value)}>{d.masters.map((m) => <option key={m}>{m}</option>)}</select>
                            : <input style={inp} value={f.dueno} placeholder="Master broker" onChange={(e) => set('dueno', e.target.value)} />}
                    </label>
                    <label><span style={lbl}>Cargo</span><input style={inp} value={f.duenoCargo} onChange={(e) => set('duenoCargo', e.target.value)} /></label>
                    <label><span style={lbl}>Firma de Pulppo</span><input style={inp} value={f.pulppo} placeholder="Nombre" onChange={(e) => set('pulppo', e.target.value)} /></label>
                    <label><span style={lbl}>Cargo</span><input style={inp} value={f.pulppoCargo} onChange={(e) => set('pulppoCargo', e.target.value)} /></label>
                    <label><span style={lbl}>Lugar y fecha</span><input style={inp} value={f.lugarFecha} onChange={(e) => set('lugarFecha', e.target.value)} /></label>
                    <label><span style={lbl}>Cierre de las cartas</span><input style={inp} value={f.cierre} onChange={(e) => set('cierre', e.target.value)} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
                    {(['elite', 'professional', 'standard'] as NivelKey[]).map((n) => (
                        <label key={n}><span style={lbl}>Diploma · {NIVEL[n].label}</span>
                            <textarea style={{ ...inp, minHeight: 92, resize: 'vertical' }} value={f[NIVEL[n].msg]} onChange={(e) => set(NIVEL[n].msg, e.target.value)} /></label>
                    ))}
                </div>
            </details>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {con.map((p) => <PremioCard key={p.key} p={p} d={d} f={f} />)}
            </div>
            {sin.length > 0 && (
                <div style={{ fontSize: 12, color: MUTED, marginTop: 18 }}>
                    Sin ganador este año (nadie llegó al mínimo): {sin.map((p) => p.titulo).join(', ')}.
                </div>
            )}

            <Diplomas d={d} f={f} />
        </div>
    );
}

const iniciales = (g: { first: string; last: string }) => `${g.first.charAt(0)}${g.last.charAt(0)}`.toUpperCase();
function Foto({ g, size }: { g: { first: string; last: string; photo: string | null }; size: number }) {
    const [ok, setOk] = useState(true);
    const st: CSSProperties = { width: size, height: size, borderRadius: '50%', flex: 'none', objectFit: 'cover', background: LINE };
    return g.photo && ok
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={g.photo} alt="" style={st} onError={() => setOk(false)} />
        : <div style={{ ...st, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700 }}>{iniciales(g)}</div>;
}

const link: CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 700, color: BLK, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' };
function Acciones({ p, g, d, f, compactas }: { p: Premio; g: Ganador; d: Reconocimientos; f: Firmas; compactas?: boolean }) {
    const btn: CSSProperties = { padding: '6px 10px', fontSize: 12, fontWeight: 700, border: `1px solid ${BLK}`, background: '#fff', cursor: 'pointer', borderRadius: 2, fontFamily: 'inherit', whiteSpace: 'nowrap' };
    const st = compactas ? link : btn;
    return (
        <div style={{ display: 'flex', gap: compactas ? 12 : 6, flexWrap: 'wrap', marginTop: compactas ? 4 : 10 }}>
            <button style={st} onClick={() => imprimir([cartaHtml(p, g, d, f)], `Reconocimiento · ${g.nombre}`, 'portrait')}>Carta</button>
            <button style={st} onClick={() => descargarPieza(p, g, d, 'post')}>Post 4:5</button>
            <button style={st} onClick={() => descargarPieza(p, g, d, 'historia')}>Historia 9:16</button>
        </div>
    );
}

function PremioCard({ p, d, f }: { p: Premio; d: Reconocimientos; f: Firmas }) {
    const [g1, ...resto] = p.podio;
    return (
        <div style={{ position: 'relative', border: `0.5px solid ${LINE}`, padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 3, width: 32, background: YEL, marginBottom: 12 }} />
            <div style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.15 }}>{p.titulo}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4, marginBottom: 14 }}>{p.porque} <Ayuda texto={p.regla} /></div>
            {p.varios ? (
                p.podio.map((g) => (
                    <div key={g.email} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: `0.5px solid ${LINE}` }}>
                        <Foto g={g} size={40} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{g.nombre}</div>
                            <div style={{ fontSize: 12, color: MUTED }}>{g.valor} · {g.detalle}</div>
                            <Acciones p={p} g={g} d={d} f={f} compactas />
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {g.badge && <img src={NIVEL[g.badge].img} alt={NIVEL[g.badge].label} title={NIVEL[g.badge].label} style={{ width: 52, height: 52, objectFit: 'contain', flex: 'none' }} />}
                    </div>
                ))
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        <Foto g={g1} size={64} />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700 }}>{g1.nombre}</div>
                            <div style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.1 }}>{g1.valor}</div>
                            <div style={{ fontSize: 12, color: MUTED }}>{g1.detalle}</div>
                        </div>
                    </div>
                    <Acciones p={p} g={g1} d={d} f={f} />
                    {resto.length > 0 && (
                        <div style={{ marginTop: 14, borderTop: `0.5px solid ${LINE}`, paddingTop: 4 }}>
                            {resto.map((g) => (
                                <div key={g.email} style={{ padding: '8px 0', borderBottom: `0.5px solid ${LINE}` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                                        <span><span style={{ color: MUTED }}>{g.lugar}º</span> {g.nombre}</span>
                                        <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>{g.valor}</span>
                                    </div>
                                    <Acciones p={p} g={g} d={d} f={f} compactas />
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function Diplomas({ d, f }: { d: Reconocimientos; f: Firmas }) {
    const [filtro, setFiltro] = useState<NivelKey | 'todos'>('todos');
    const lista = d.equipo.filter((x) => filtro === 'todos' || x.nivel === filtro);
    const n = (k: NivelKey) => d.equipo.filter((x) => x.nivel === k).length;
    const chip = (k: NivelKey | 'todos', l: string): ReactNode => (
        <button key={k} onClick={() => setFiltro(k)} style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${filtro === k ? BLK : LINE}`, background: filtro === k ? BLK : '#fff', color: filtro === k ? '#fff' : BLK }}>{l}</button>
    );
    return (
        <div style={{ marginTop: 40, borderTop: `1px solid ${BLK}`, paddingTop: 22 }}>
            <div style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.15 }}>Un diploma para todo el equipo</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 14, maxWidth: 720 }}>
                Cada broker activo se lleva su diploma de cierre de año con el badge del nivel en el que termina 2026, lo que hizo
                en el año (sin montos) y un mensaje para 2027. Los mensajes se editan en «Firmas y textos».
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                {chip('todos', `Todos (${d.equipo.length})`)}{chip('elite', `Élite (${n('elite')})`)}{chip('professional', `Profesional (${n('professional')})`)}{chip('standard', `Estándar (${n('standard')})`)}
                <button onClick={() => imprimir(lista.map((x) => diplomaHtml(x, d, f)), `Diplomas ${d.año} · ${d.inmobiliaria}`, 'landscape')}
                    style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 13, fontWeight: 700, background: BLK, color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Imprimir {lista.length === d.equipo.length ? 'todos' : 'estos'} ({lista.length})
                </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                {lista.map((x) => (
                    <div key={x.email} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', border: `0.5px solid ${LINE}` }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={NIVEL[x.nivel].img} alt={NIVEL[x.nivel].label} style={{ width: 34, height: 34, objectFit: 'contain', flex: 'none' }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.nombre}</div>
                            <div style={{ fontSize: 11, color: MUTED }}>{NIVEL[x.nivel].label}{x.subio ? ' · subió este año' : ''}</div>
                        </div>
                        <button style={link} onClick={() => imprimir([diplomaHtml(x, d, f)], `Diploma · ${x.nombre}`, 'landscape')}>Diploma</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── documentos para imprimir (se guardan como PDF desde el diálogo de impresión) ──
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const firma = (n: string, c: string) => `<div class="firma"><div class="raya"></div><div class="fn">${esc(n || ' ')}</div><div class="fc">${esc(c)}</div></div>`;
/** Sello de Pulppo en lugar de una firma de persona: anillo con texto + el pulpo al centro sobre un disco amarillo.
 *  Si en «Firmas y textos» escriben un nombre para Pulppo, va debajo del sello. */
let nSello = 0;
function sello(o: string, f: Firmas, año: number): string {
    const id = `anillo${++nSello}`;
    return `<div class="sello"><svg viewBox="0 0 200 200" aria-label="Sello Pulppo">
<defs><path id="${id}" d="M100,100 m-75,0 a75,75 0 1,1 150,0 a75,75 0 1,1 -150,0"/></defs>
<circle cx="100" cy="100" r="97" fill="none" stroke="${BLK}" stroke-width="2.5"/>
<circle cx="100" cy="100" r="90" fill="none" stroke="${BLK}" stroke-width="0.8"/>
<circle cx="100" cy="100" r="58" fill="${YEL}"/>
<text font-family="Nunito Sans, Arial, sans-serif" font-weight="700" font-size="14.5" fill="${BLK}"><textPath href="#${id}" textLength="465" lengthAdjust="spacing">PULPPO · MASTER EXPERIENCE · ${año} ·</textPath></text>
<image href="${o}/tu2026/pulppo-icon.png" x="70" y="70" width="60" height="60"/></svg>
${f.pulppo ? `<div class="fn">${esc(f.pulppo)}</div><div class="fc">${esc(f.pulppoCargo)}</div>` : ''}</div>`;
}
const encabezado = (d: Reconocimientos, origen: string) =>
    `<div class="top">${d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<b style="font-size:14pt">${esc(d.inmobiliaria)}</b>`}<img class="pulppo" src="${origen}/tu2026/pulppo-negro.png" alt="Pulppo"></div>`;

function cartaHtml(p: Premio, g: Ganador, d: Reconocimientos, f: Firmas): string {
    const o = window.location.origin;
    const podio = g.lugar > 1 && !p.varios;
    const motivo = podio ? `por quedar en ${LUGAR[g.lugar].toLowerCase()} de «${p.titulo}»` : p.porque.replace(/^Por /, 'por ').replace(/\.$/, '');
    return `<div class="hoja carta">${encabezado(d, o)}
<div class="eyebrow">Reconocimiento ${d.año}</div><div class="acento"></div>
${g.badge ? `<img class="badge-asc" src="${o}${NIVEL[g.badge].img}" alt="${esc(NIVEL[g.badge].label)}">` : ''}
<h1>${esc(p.titulo)}</h1>${podio ? `<div class="lugar-premio">${LUGAR[g.lugar]}</div>` : ''}
<div class="otorga">Se otorga a</div>
<div class="nombre">${esc(g.nombre)}</div>
<div class="texto">${esc(`De parte de ${d.inmobiliaria} y Pulppo, ${motivo}.`)} ${esc(f.cierre)}</div>
<div class="dato"><span class="v">${esc(g.valor)}</span><span class="s">${esc(g.detalle)}</span></div>
<div class="pie"><div class="lugar">${esc(f.lugarFecha)}</div>
<div class="firmas">${firma(f.dueno, `${f.duenoCargo} · ${d.inmobiliaria}`)}${sello(o, f, d.año)}</div></div>
<div class="barra"></div></div>`;
}

function diplomaHtml(x: Diploma, d: Reconocimientos, f: Firmas): string {
    const o = window.location.origin;
    const nv = NIVEL[x.nivel];
    const pl = (n: number, s: string, p: string) => `${n.toLocaleString('es-MX')} ${n === 1 ? s : p}`;
    const hechos = [
        x.cierres ? pl(x.cierres, 'operación cerrada', 'operaciones cerradas') : '',
        x.visitas ? pl(x.visitas, 'visita', 'visitas') : '',
        x.captaciones ? pl(x.captaciones, 'propiedad captada', 'propiedades captadas') : '',
        x.exclusivas ? pl(x.exclusivas, 'exclusiva', 'exclusivas') : '',
    ].filter(Boolean);
    return `<div class="hoja diploma">
<div class="badge"><img src="${o}${nv.img}" alt=""><div class="nivel">${esc(nv.label)}</div></div>
<div class="cuerpo">${encabezado(d, o)}
<div class="eyebrow">Diploma ${d.año}</div><div class="acento"></div>
<div class="otorga">Se otorga a</div>
<div class="nombre">${esc(x.nombre)}</div>
${x.subio ? `<div class="subio">Este año subió de nivel: ${esc(x.subio)}</div>` : ''}
<div class="texto">${esc(f[nv.msg])}</div>
${hechos.length ? `<div class="hechos">En ${d.año}: ${esc(hechos.join(' · '))}</div>` : ''}
<div class="pie"><div class="lugar">${esc(f.lugarFecha)}</div>
<div class="firmas">${firma(f.dueno, `${f.duenoCargo} · ${d.inmobiliaria}`)}${sello(o, f, d.año)}</div></div>
</div><div class="barra"></div></div>`;
}

function imprimir(hojas: string[], titulo: string, orient: 'portrait' | 'landscape') {
    const w = window.open('', '_blank');
    if (!w) return;
    const o = window.location.origin;
    const [W, H] = orient === 'portrait' ? ['8.5in', '11in'] : ['11in', '8.5in'];
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;700&display=swap" rel="stylesheet">
<style>
@font-face { font-family: 'Heldane'; src: url('${o}/plus/ranking/HeldaneTextRegular.otf'); }
@page { size: letter ${orient}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: ${BLK}; font-family: 'Nunito Sans', Arial, sans-serif; }
.hoja { width: ${W}; height: ${H}; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.hoja:last-child { page-break-after: auto; break-after: auto; }
.carta { padding: 0.9in 0.9in 0.8in; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: center; height: 56px; }
.top img { max-height: 64px; max-width: 220px; object-fit: contain; }
.top .pulppo { height: 40px; max-height: 40px; }
.eyebrow { margin-top: 1.1in; font-size: 11pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.acento { width: 48px; height: 3px; background: ${YEL}; margin: 14px 0 22px; }
h1 { font-family: 'Heldane', 'EB Garamond', serif; font-weight: 400; font-size: 40pt; line-height: 1.05; margin: 0; }
.lugar-premio { font-size: 12pt; font-weight: 700; margin-top: 10px; }
.otorga { margin-top: 0.5in; font-size: 12pt; color: ${MUTED}; }
.nombre { font-family: 'Heldane', 'EB Garamond', serif; font-size: 40pt; line-height: 1.1; margin-top: 6px; }
.texto { margin-top: 0.3in; font-size: 12pt; line-height: 1.6; max-width: 5.6in; }
.dato { margin-top: 0.3in; display: flex; align-items: baseline; gap: 14px; }
.dato .v { font-family: 'Heldane', 'EB Garamond', serif; font-size: 28pt; }
.dato .s, .hechos, .subio { font-size: 11pt; color: ${MUTED}; }
.pie { margin-top: auto; }
.lugar { font-size: 11pt; color: ${MUTED}; margin-bottom: 0.6in; }
.firmas { display: flex; gap: 0.6in; align-items: flex-end; }
.firma { flex: 1; }
.sello { flex: none; text-align: center; transform: rotate(-8deg); }
.sello svg { width: 1.25in; height: 1.25in; display: block; margin: 0 auto; }
.sello .fn { margin-top: 6px; }
.badge-asc { position: absolute; top: 2.55in; right: 0.9in; width: 1.6in; height: 1.6in; object-fit: contain; }
.raya { border-top: 0.5pt solid ${BLK}; margin-bottom: 8px; }
.fn { font-size: 12pt; font-weight: 700; min-height: 16pt; }
.fc { font-size: 11pt; color: ${MUTED}; }
.barra { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: ${YEL}; }
.diploma { display: flex; }
.diploma .badge { width: 3.4in; background: ${LGT}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.diploma .badge img { width: 2.3in; height: 2.3in; object-fit: contain; }
.diploma .nivel { font-family: 'Heldane', 'EB Garamond', serif; font-size: 20pt; }
.diploma .cuerpo { flex: 1; padding: 0.6in 0.7in 0.7in; display: flex; flex-direction: column; }
.diploma .eyebrow { margin-top: 0.45in; }
.diploma .otorga { margin-top: 0.1in; }
.diploma .subio { margin-top: 8px; font-weight: 700; color: ${BLK}; }
.diploma .texto { margin-top: 0.22in; max-width: 6in; }
.diploma .hechos { margin-top: 0.18in; }
.diploma .lugar { margin-bottom: 0.2in; }
.diploma .sello svg { width: 1.1in; height: 1.1in; }
@media screen { body { background: ${LGT}; } .hoja { margin: 24px auto; background: #fff; } }
</style></head><body>${hojas.join('\n')}
<script>Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => setTimeout(() => window.print(), 250));</script>
</body></html>`);
    w.document.close();
}

// ── piezas para redes (canvas → PNG), SIN montos ──
async function descargarPieza(p: Premio, g: Ganador, d: Reconocimientos, tipo: 'post' | 'historia') {
    await ensureFonts();
    await document.fonts.load('700 40px "Nunito Sans"');
    const W = 1080, H = tipo === 'post' ? 1350 : 1920;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')! as CanvasRenderingContext2D & { letterSpacing?: string };
    const HEL = '"HeldaneTextRegular", "EB Garamond", serif', NUN = '"Nunito Sans", Arial, sans-serif';
    ctx.fillStyle = BLK; ctx.fillRect(0, 0, W, H);
    const k = tipo === 'post' ? 1 : 1.25;       // la historia respira más
    const top = tipo === 'post' ? 110 : 250;
    const pieY = H - (tipo === 'post' ? 150 : 260);
    const conDato = !!g.valorRed;
    const lugar = g.lugar > 1 && !p.varios;
    // alto del bloque (foto + premio + lugar + nombre + dato) para centrarlo entre el eyebrow y el pie
    ctx.font = `400 ${Math.round(92 * k)}px ${HEL}`;
    const lTit = partir(ctx, p.titulo, W - 160);
    ctx.font = `700 ${Math.round(50 * k)}px ${NUN}`;
    const lNom = partir(ctx, g.nombre, W - 160);
    const R = Math.round(180 * k);
    const alto = 2 * R + 20 + Math.round(120 * k) + lTit.length * Math.round(100 * k) + (lugar ? Math.round(56 * k) : 0) + Math.round(10 * k)
        + lNom.length * Math.round(60 * k) + (conDato ? Math.round(94 * k) : 0);
    const y0 = top + 40 + Math.max(0, (pieY - 60 - (top + 40) - alto) / 2);

    ctx.fillStyle = YEL; ctx.font = `700 28px ${NUN}`; ctx.textAlign = 'center';
    ctx.letterSpacing = '6px';
    ctx.fillText(`RECONOCIMIENTOS ${d.año}`, W / 2, top);
    ctx.letterSpacing = '0px';

    const cy = y0 + 10 + R;
    ctx.beginPath(); ctx.arc(W / 2, cy, R + 10, 0, Math.PI * 2); ctx.fillStyle = YEL; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const im = g.photo ? await loadImg(g.photo) : null;
    if (im) {
        const s = Math.max((2 * R) / im.naturalWidth, (2 * R) / im.naturalHeight);
        const w = im.naturalWidth * s, h = im.naturalHeight * s;
        ctx.drawImage(im, W / 2 - w / 2, cy - h / 2, w, h);
    } else {
        ctx.fillStyle = LGT; ctx.fillRect(W / 2 - R, cy - R, 2 * R, 2 * R);
        ctx.fillStyle = BLK; ctx.font = `700 ${Math.round(R * 0.7)}px ${NUN}`; ctx.textBaseline = 'middle';
        ctx.fillText(iniciales(g), W / 2, cy); ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    if (g.badge) {
        const bd = await loadImg(NIVEL[g.badge].img);
        if (bd) { const b = Math.round(R * 0.95), bh = (b * bd.naturalHeight) / bd.naturalWidth; ctx.drawImage(bd, W / 2 + R * 0.62, cy + R * 0.62 - bh * 0.75, b, bh); }
    }

    let y = cy + R + Math.round(120 * k);
    ctx.fillStyle = '#fff'; ctx.font = `400 ${Math.round(92 * k)}px ${HEL}`;
    for (const ln of lTit) { ctx.fillText(ln, W / 2, y); y += Math.round(100 * k); }
    if (lugar) {
        ctx.fillStyle = YEL; ctx.font = `700 ${Math.round(30 * k)}px ${NUN}`; ctx.letterSpacing = '4px';
        ctx.fillText(LUGAR[g.lugar].toUpperCase(), W / 2, y - Math.round(30 * k)); ctx.letterSpacing = '0px';
        y += Math.round(56 * k);
    }
    y += Math.round(10 * k);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(50 * k)}px ${NUN}`;
    for (const ln of lNom) { ctx.fillText(ln, W / 2, y); y += Math.round(60 * k); }
    if (conDato) {
        y += Math.round(40 * k);
        ctx.fillStyle = YEL; ctx.font = `400 ${Math.round(64 * k)}px ${HEL}`;
        ctx.fillText(g.valorRed, W / 2, y);
        y += Math.round(54 * k);
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `400 ${Math.round(30 * k)}px ${NUN}`;
        ctx.fillText(g.detalleRed, W / 2, y);
    }

    // pie: logo de la inmobiliaria (en caja blanca: hay logos oscuros) + Pulppo
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(80, pieY - 40, W - 160, 1);
    const logo = d.logo ? await loadImg(d.logo) : null;
    if (logo) {
        const bh = 96, pad = 14;
        const s = Math.min((bh - 2 * pad) / logo.naturalHeight, 300 / logo.naturalWidth);
        const lw = logo.naturalWidth * s, lh = logo.naturalHeight * s;
        ctx.fillStyle = '#fff'; ctx.fillRect(80, pieY, lw + 2 * pad, bh);
        ctx.drawImage(logo, 80 + pad, pieY + (bh - lh) / 2, lw, lh);
    } else {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = `700 34px ${NUN}`;
        ctx.fillText(d.inmobiliaria, 80, pieY + 60); ctx.textAlign = 'center';
    }
    const pl = await loadImg('/tu2026/pulppo-blanco.png');
    if (pl) { const h = 62, w = (pl.naturalWidth * h) / pl.naturalHeight; ctx.drawImage(pl, W - 80 - w, pieY + (96 - h) / 2, w, h); }

    cv.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${p.titulo}${lugar ? ` (${g.lugar}º)` : ''} - ${g.nombre} (${tipo === 'post' ? '4x5' : '9x16'}).png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
}

function partir(ctx: CanvasRenderingContext2D, t: string, maxW: number): string[] {
    const out: string[] = [];
    let cur = '';
    for (const w of t.split(/\s+/)) {
        const n = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(n).width > maxW && cur) { out.push(cur); cur = w; } else cur = n;
    }
    if (cur) out.push(cur);
    return out;
}
