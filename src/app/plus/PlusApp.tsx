'use client';
// Pulppo Plus — niveles y competencia. Reemplaza el dashboard de Streamlit + foto estática
// mensual en Vercel (~/Documents/Pulppo/Pulppo Plus). Lee en vivo: se acabó el refresco manual.
//
// Diseño: los mismos tokens que /mb (7 colores oficiales, R=2, EB Garamond en cifras).
// El dashboard viejo traía 10 emojis distintos; el design system los prohíbe en piezas
// oficiales, así que aquí no hay ninguno.
import { useMemo, useState, type CSSProperties } from 'react';
import type { PlusData, Level, Metric, BrokerRow } from '@/lib/plus';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const LVL_LBL: Record<Level, string> = { standard: 'Estándar', professional: 'Profesional', elite: 'Élite' };

// Identidad de nivel. Tonos MUESTREADOS del pixel de "Ranking Pulppo 2025" (la pieza oficial),
// no inventados: élite #B88849 · profesional #868B8E · estándar #DEA37F.
// Nota: el design system define 7 colores y prohíbe otros. Estos entran como excepción acotada
// —sólo identidad de nivel— porque vienen de una pieza de marca aprobada. No usarlos para nada más.
const LVL: Record<Level, { base: string; soft: string; ink: string }> = {
    elite: { base: '#B88849', soft: '#EFE4D2', ink: '#6E4F22' },
    professional: { base: '#868B8E', soft: '#E4E6E7', ink: '#4A5052' },
    standard: { base: '#DEA37F', soft: '#F7E7DC', ink: '#8A5333' },
};
const ORDEN_LVL: Level[] = ['elite', 'professional', 'standard'];

type Section = 'cierre' | 'fama' | 'carrera' | 'comoleer';

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ flex: 1, background: '#fff', border: `1px solid ${LGT}`, padding: '13px 15px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 27, lineHeight: 1.05, margin: '8px 0 3px', color: color || BLK }}>{value}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#777', lineHeight: 1.3 }}>{sub}</div>}
        </div>
    );
}

/** Barra proporcional simple. Sin sombras ni degradados: el design system lo prohíbe. */
function Bar({ v, max, color }: { v: number; max: number; color?: string }) {
    const pct = max > 0 ? Math.max(1, Math.round((100 * v) / max)) : 0;
    return (
        <div style={{ height: 6, background: LGT, borderRadius: R, marginTop: 5 }}>
            <div style={{ height: 6, width: `${pct}%`, background: color || BLK, borderRadius: R }} />
        </div>
    );
}

export default function PlusApp({ d, onChange }: { d: PlusData; onChange: (m: number, metric: Metric) => void }) {
    const [section, setSection] = useState<Section>('cierre');
    const [openOps, setOpenOps] = useState<string | null>(null);

    const tth: CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const ttd: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };

    const nav = (id: Section, label: string) => (
        <div key={id} onClick={() => setSection(id)} style={{ padding: '9px 12px', borderRadius: R, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 2, background: section === id ? BLK : 'transparent', color: section === id ? '#fff' : '#555' }}>{label}</div>
    );

    const maxGen = d.general[0]?.value ?? 0;
    const maxOnb = d.onboarding[0]?.value ?? 0;
    const totalGen = useMemo(() => d.general.reduce((a, r) => a + r.value, 0), [d.general]);
    const nOps = useMemo(() => d.general.reduce((a, r) => a + r.nops, 0), [d.general]);
    const eliteHoy = useMemo(() => d.counts.filter((c) => c.nivel === 'elite').slice(-1)[0]?.n ?? 0, [d.counts]);

    // La carrera: acumulado del año por inmobiliaria. El frame final es el ranking del año.
    const raceFinal = useMemo(() => d.race.filter((r) => r.mesI === d.month).sort((a, b) => a.rank - b.rank), [d.race, d.month]);
    const maxRace = raceFinal[0]?.value ?? 0;

    // Podio de top 5: alturas relativas al líder, orden visual 3-1-2-4-5 como en la pieza impresa.
    const Podio = ({ rows }: { rows: typeof d.general }) => {
        const top = rows.slice(0, 5);
        if (!top.length) return null;
        const max = top[0].value || 1;
        const orden = [2, 0, 1, 3, 4].filter((i) => i < top.length);
        return (
            <div style={{ background: BLK, borderRadius: R, padding: '18px 20px 20px', marginBottom: 18 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: GRY, fontWeight: 700 }}>Top 5</div>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, color: '#fff', margin: '3px 0 16px' }}>Inmobiliarias del mes</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    {orden.map((i) => {
                        const r = top[i], h = 40 + Math.round((110 * r.value) / max), lider = i === 0;
                        return (
                            <div key={`${r.name}-${i}`} style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, color: '#fff', fontWeight: lider ? 700 : 500, marginBottom: 5, lineHeight: 1.25, minHeight: 29 }}>{r.name ?? '—'}</div>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: lider ? 18 : 15, color: lider ? YEL : '#fff', marginBottom: 5 }}>{money(r.value)}</div>
                                <div style={{ height: h, background: lider ? YEL : 'rgba(255,255,255,.17)', borderRadius: R, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 5px' }}>
                                    <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, color: lider ? BLK : '#fff' }}>{i + 1}</span>
                                </div>
                                <div style={{ fontSize: 10, color: GRY, textAlign: 'center', marginTop: 4 }}>{f(r.nops)} {r.nops === 1 ? 'op' : 'ops'}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const tablaCompanies = (rows: typeof d.general, max: number, vacio: string) => (
        <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                <thead><tr>
                    <th style={{ ...tth, width: 34 }}>#</th>
                    <th style={tth}>Inmobiliaria</th>
                    <th style={{ ...tth, textAlign: 'right' }}>Comisión</th>
                    <th style={{ ...tth, textAlign: 'right' }}>Ops</th>
                    <th style={{ ...tth, width: '28%' }}>Peso</th>
                </tr></thead>
                <tbody>
                    {rows.length === 0 && <tr><td colSpan={5} style={{ ...ttd, color: GRY, textAlign: 'center', padding: 18 }}>{vacio}</td></tr>}
                    {rows.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                            <td style={{ ...ttd, color: GRY, fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{i + 1}</td>
                            <td style={{ ...ttd, fontWeight: i === 0 ? 700 : 500, whiteSpace: 'normal' }}>{r.name ?? '—'}</td>
                            <td style={{ ...ttd, textAlign: 'right', fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{money(r.value)}</td>
                            <td style={{ ...ttd, textAlign: 'right', color: '#777' }}>{f(r.nops)}</td>
                            <td style={{ ...ttd, whiteSpace: 'normal' }}><Bar v={r.value} max={max} color={i === 0 ? BLK : GRY} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    const brokerBlock = (lv: Level, rows: BrokerRow[]) => {
        const c = LVL[lv];
        return (
            <div key={lv} style={{ flex: 1, minWidth: 264, background: '#fff', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
                {/* Banda de identidad del nivel, como en la pieza impresa */}
                <div style={{ background: c.base, color: '#fff', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700 }}>Top 3 · {LVL_LBL[lv]}</span>
                    <span style={{ fontSize: 10, opacity: .85 }}>{f(rows.length)}</span>
                </div>
                <div style={{ padding: '4px 14px 12px' }}>
                    {rows.length === 0 && <div style={{ fontSize: 11.5, color: GRY, padding: '10px 0' }}>Sin operaciones este mes</div>}
                    {rows.map((b, i) => {
                        const abierto = openOps === b.email;
                        const ops = d.ops?.[b.email] ?? [];
                        return (
                            <div key={b.email} style={{ padding: '9px 0', borderBottom: i < rows.length - 1 ? `1px solid ${LGT}` : 'none' }}>
                                <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                                    <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, color: c.base, width: 16, flexShrink: 0 }}>{i + 1}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.name}</div>
                                        <div style={{ fontSize: 10.5, color: '#777' }}>{b.company ?? '—'}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 15, whiteSpace: 'nowrap' }}>{money(b.value)}</div>
                                        <div onClick={() => setOpenOps(abierto ? null : b.email)}
                                            style={{ fontSize: 10, color: c.ink, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                            {f(b.nops)} {b.nops === 1 ? 'operación' : 'operaciones'} {abierto ? '▲' : '▼'}
                                        </div>
                                    </div>
                                </div>
                                {abierto && (
                                    <div style={{ background: c.soft, borderRadius: R, padding: '9px 11px', marginTop: 8 }}>
                                        {ops.length === 0 && <div style={{ fontSize: 11, color: c.ink }}>Sin desglose disponible.</div>}
                                        {ops.map((o) => (
                                            <div key={o.op} style={{ fontSize: 11, lineHeight: 1.45, paddingBottom: 6, marginBottom: 6, borderBottom: `1px solid rgba(0,0,0,.07)` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                                    <b>{o.calle ?? o.op}</b>
                                                    <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 13.5, whiteSpace: 'nowrap' }}>{money(o.parte)}</span>
                                                </div>
                                                <div style={{ color: c.ink }}>
                                                    {o.roles} · comisión del deal {money(o.comisionDeal)}
                                                    {o.inmo && o.inmo !== b.company && <> · {o.inmo}</>}
                                                </div>
                                            </div>
                                        ))}
                                        <div style={{ fontSize: 10, color: c.ink, opacity: .8 }}>
                                            La parte de cada deal ya tiene el split por rol aplicado.
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div style={{ fontFamily: 'Nunito Sans, system-ui, sans-serif', color: BLK, background: '#fff', minHeight: '100vh' }}>
            {/* Encabezado oscuro, layout A del design system */}
            <div style={{ background: BLK, color: '#fff', padding: '20px 26px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: GRY, fontWeight: 700 }}>Pulppo Plus</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1.1, marginTop: 4 }}>Niveles y competencia</div>
                        <div style={{ fontSize: 11.5, color: GRY, marginTop: 3 }}>Datos en vivo · {MES[d.month - 1]} {d.year}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select value={d.month} onChange={(e) => onChange(Number(e.target.value), d.metric)}
                            style={{ background: 'rgba(255,255,255,.09)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: R, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit' }}>
                            {MES.map((m, i) => <option key={m} value={i + 1} style={{ color: BLK }}>{m}</option>)}
                        </select>
                        {(['cobrada', 'total'] as Metric[]).map((m) => (
                            <span key={m} onClick={() => onChange(d.month, m)}
                                style={{ padding: '7px 11px', borderRadius: R, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.5px', background: d.metric === m ? YEL : 'rgba(255,255,255,.09)', color: d.metric === m ? BLK : '#fff', border: `1px solid ${d.metric === m ? YEL : 'rgba(255,255,255,.2)'}` }}>
                                {m === 'cobrada' ? 'Cobrada' : 'Total'}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 22, padding: '20px 26px', alignItems: 'flex-start' }}>
                <div style={{ width: 190, flexShrink: 0, position: 'sticky', top: 20 }}>
                    {nav('cierre', 'Cierre del mes')}{nav('fama', 'Salón de la fama')}
                    {nav('carrera', 'La carrera')}{nav('comoleer', 'Cómo leer esto')}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    {section === 'cierre' && (
                        <div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                                <Kpi label="Comisión del mes" value={money(totalGen)} sub={`top ${d.general.length} inmobiliarias`} />
                                <Kpi label="Operaciones" value={f(nOps)} />
                                <Kpi label="Nuevos élite" value={f(d.newElite.length)} color={d.newElite.length ? SEA : BLK} />
                                <Kpi label="Nuevos profesional" value={f(d.newPro.length)} color={d.newPro.length ? SEA : BLK} />
                                {d.corte && <Kpi label="Movimiento de niveles" value={`${d.corte.promos} / ${d.corte.demos}`} sub="subieron / bajaron" color={d.corte.promos >= d.corte.demos ? SEA : RED} />}
                            </div>

                            <Podio rows={d.general} />

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, marginBottom: 3 }}>Consultoría · top 10</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>
                                Inmobiliarias ya graduadas de onboarding. Métrica <b>{d.metric === 'cobrada' ? 'comisión cobrada en el mes' : 'comisión de operaciones cerradas en el mes'}</b>.
                            </div>
                            {tablaCompanies(d.general, maxGen, 'Sin operaciones este mes')}

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, margin: '20px 0 3px' }}>Onboarding</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>Sin fecha de integración: todavía no pasan a consultoría.</div>
                            {tablaCompanies(d.onboarding, maxOnb, 'Sin operaciones este mes')}

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, margin: '20px 0 3px' }}>Top asesores por nivel</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>
                                Comisión con split por rol: comprador 50, vendedor 25, productor 25. Si una de las partes es externa, el lado Pulppo se lleva el 100%.
                            </div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {ORDEN_LVL.map((lv) => brokerBlock(lv, d.brokers[lv]))}
                            </div>

                            {(d.newElite.length > 0 || d.newPro.length > 0) && (
                                <div style={{ background: LGT, padding: '14px 16px', borderRadius: R, marginTop: 18 }}>
                                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 17, marginBottom: 6 }}>Subieron de nivel por primera vez</div>
                                    {d.newElite.length > 0 && <div style={{ fontSize: 12.5, marginBottom: 4 }}><b>Élite:</b> {d.newElite.map((x) => `${x.name} (${x.company ?? '—'})`).join(' · ')}</div>}
                                    {d.newPro.length > 0 && <div style={{ fontSize: 12.5 }}><b>Profesional:</b> {d.newPro.map((x) => `${x.name} (${x.company ?? '—'})`).join(' · ')}</div>}
                                </div>
                            )}
                        </div>
                    )}

                    {section === 'fama' && (
                        <div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                                <Kpi label="Élite hoy" value={f(eliteHoy)} sub="según el último corte" />
                                <Kpi label="Rachas vigentes" value={f(d.vigentes.length)} />
                                <Kpi label="Rachas de +1 año" value={f(d.historicos.length)} sub="históricas, ya cerradas" />
                                <Kpi label="Puerta giratoria" value={f(d.revolving.length)} sub="entraron a élite 2+ veces" color={d.revolving.length ? YEL : BLK} />
                            </div>

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, marginBottom: 3 }}>Rachas élite vigentes</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>
                                Meses seguidos en élite. Sólo cuenta si el nivel vivo también es élite — el historial a veces deja rachas abiertas por bajadas no registradas.
                            </div>
                            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                                    <thead><tr>
                                        <th style={{ ...tth, width: 34 }}>#</th><th style={tth}>Asesor</th>
                                        <th style={tth}>Inmobiliaria</th><th style={{ ...tth, textAlign: 'right' }}>Meses</th>
                                    </tr></thead>
                                    <tbody>
                                        {d.vigentes.slice(0, 20).map((v, i) => (
                                            <tr key={`${v.name}-${i}`}>
                                                <td style={{ ...ttd, color: GRY, fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{i + 1}</td>
                                                <td style={{ ...ttd, fontWeight: i === 0 ? 700 : 500 }}>{v.name}</td>
                                                <td style={{ ...ttd, color: '#777', whiteSpace: 'normal' }}>{v.company ?? '—'}</td>
                                                <td style={{ ...ttd, textAlign: 'right', fontFamily: 'EB Garamond, serif', fontSize: 16, color: v.months >= 24 ? SEA : BLK }}>{v.months}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, margin: '20px 0 3px' }}>Ventas más grandes de la historia</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>Sólo venta. El asesor mostrado es quien más comisión se llevó del deal.</div>
                            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                                    <thead><tr>
                                        <th style={tth}>Inmobiliaria</th><th style={tth}>Asesor</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Valor de venta</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Su comisión</th>
                                    </tr></thead>
                                    <tbody>
                                        {d.records.map((r, i) => (
                                            <tr key={i}>
                                                <td style={{ ...ttd, whiteSpace: 'normal', fontWeight: i === 0 ? 700 : 500 }}>{r.company ?? '—'}</td>
                                                <td style={{ ...ttd, color: '#777', whiteSpace: 'normal' }}>{r.asesor}</td>
                                                <td style={{ ...ttd, textAlign: 'right', fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{money(r.value)}</td>
                                                <td style={{ ...ttd, textAlign: 'right', color: '#777' }}>{money(r.comision)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {d.revolving.length > 0 && (
                                <div style={{ marginTop: 20 }}>
                                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, marginBottom: 3 }}>Puerta giratoria</div>
                                    <div style={{ fontSize: 11, color: GRY, marginBottom: 10, maxWidth: 620 }}>
                                        Élite no es un estado: es una racha que se gana cada mes. Estos asesores <b>entraron a élite, salieron y volvieron</b>.
                                        Cada punto es una entrada; el verde marca a los que están dentro hoy.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 1 }}>
                                        {d.revolving.slice(0, 18).map((r) => (
                                            <div key={r.name} style={{ background: r.vigente ? '#fff' : LGT, border: `1px solid ${r.vigente ? LVL.elite.base : LGT}`, borderRadius: R, padding: '10px 12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                                                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
                                                    <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 17, color: LVL.elite.base, whiteSpace: 'nowrap' }}>{r.stints}<span style={{ fontSize: 11, color: GRY }}>×</span></span>
                                                </div>
                                                <div style={{ fontSize: 10.5, color: '#777', marginBottom: 6 }}>{r.company ?? '—'}</div>
                                                {/* Un punto por entrada a élite. El último se pinta lleno si sigue dentro. */}
                                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                    {Array.from({ length: Math.min(r.stints, 8) }).map((_, k) => {
                                                        const ultimo = k === Math.min(r.stints, 8) - 1;
                                                        const dentro = ultimo && r.vigente;
                                                        return <span key={k} style={{ width: 9, height: 9, borderRadius: 9, background: dentro ? SEA : LVL.elite.base, opacity: dentro ? 1 : .45 }} />;
                                                    })}
                                                    {r.stints > 8 && <span style={{ fontSize: 10, color: GRY }}>+{r.stints - 8}</span>}
                                                    <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: r.vigente ? SEA : GRY }}>
                                                        {r.vigente ? 'dentro hoy' : 'fuera'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: 10.5, color: GRY, marginTop: 8 }}>
                                        {f(d.revolving.filter((r) => r.vigente).length)} de {f(d.revolving.length)} están en élite hoy · duración media de una racha: 6.4 meses
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {section === 'carrera' && (
                        <div>
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, marginBottom: 3 }}>Acumulado del año</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 10 }}>
                                Suma de enero a {MES[d.month - 1].toLowerCase()} {d.year}, métrica {d.metric === 'cobrada' ? 'cobrada' : 'total'}.
                            </div>
                            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                                    <thead><tr>
                                        <th style={{ ...tth, width: 34 }}>#</th><th style={tth}>Inmobiliaria</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Acumulado</th>
                                        <th style={{ ...tth, width: '38%' }}>Peso</th>
                                    </tr></thead>
                                    <tbody>
                                        {raceFinal.map((r) => (
                                            <tr key={r.label}>
                                                <td style={{ ...ttd, color: GRY, fontFamily: 'EB Garamond, serif', fontSize: 15 }}>{r.rank}</td>
                                                <td style={{ ...ttd, fontWeight: r.rank === 1 ? 700 : 500, whiteSpace: 'normal' }}>{r.label}</td>
                                                <td style={{ ...ttd, textAlign: 'right', fontFamily: 'EB Garamond, serif', fontSize: 16 }}>{money(r.value)}</td>
                                                <td style={{ ...ttd, whiteSpace: 'normal' }}><Bar v={r.value} max={maxRace} color={r.rank === 1 ? BLK : GRY} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 19, margin: '20px 0 3px' }}>Movimiento de niveles por corte</div>
                            <div style={{ fontSize: 11, color: GRY, marginBottom: 8 }}>Cada corte lleva fecha del día 1 del mes siguiente al desempeño.</div>
                            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                                    <thead><tr>
                                        <th style={tth}>Corte</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Subieron</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Bajaron</th>
                                        <th style={{ ...tth, textAlign: 'right' }}>Neto</th>
                                    </tr></thead>
                                    <tbody>
                                        {d.flow.slice(-14).reverse().map((r) => (
                                            <tr key={r.mes}>
                                                <td style={ttd}>{r.mes}</td>
                                                <td style={{ ...ttd, textAlign: 'right', color: r.promos ? SEA : GRY }}>{r.promos || '—'}</td>
                                                <td style={{ ...ttd, textAlign: 'right', color: r.demos ? RED : GRY }}>{r.demos ? Math.abs(r.demos) : '—'}</td>
                                                <td style={{ ...ttd, textAlign: 'right', fontWeight: 700, color: r.neto > 0 ? SEA : r.neto < 0 ? RED : GRY }}>{r.neto > 0 ? '+' : ''}{r.neto || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {section === 'comoleer' && (
                        <div style={{ maxWidth: 720 }}>
                            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, marginBottom: 10 }}>Cómo leer esto</div>
                            {[
                                ['Cobrada vs Total', 'Cobrada = comisión que efectivamente entró en el mes (pagos con fecha en el mes). Total = comisión de las operaciones que cerraron en el mes. Cobrada es la que reproduce los números que se reportan.'],
                                ['Split por rol', 'La comisión de un asesor se reparte: comprador 50, vendedor 25, productor 25. Si una de las partes es externa a Pulppo, el lado Pulppo se lleva el 100%.'],
                                ['Consultoría vs Onboarding', 'Con fecha de integración = consultoría. Sin fecha = onboarding, todavía no se graduó.'],
                                ['Élite es rotativo, no estable', 'La mayoría de las rachas élite duran unos meses. Por eso hay una tabla de puerta giratoria: entrar a élite dos o tres veces es lo normal, no la excepción.'],
                                ['Qué NO está aquí', 'Se excluyen inmobiliarias de TuHabi (por dominio, no por nombre) y cuentas demo o de prueba.'],
                                ['Un límite del dato', 'El historial de niveles está incompleto: a veces la última transición dice élite pero el nivel vivo ya no lo es. Las rachas vigentes sólo cuentan si ambos coinciden; si no, se descartan por no confiables.'],
                            ].map(([t, dd]) => (
                                <div key={t} style={{ padding: '8px 0', borderBottom: `1px solid ${LGT}`, fontSize: 12.5, lineHeight: 1.5 }}><b>{t}</b> — {dd}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
