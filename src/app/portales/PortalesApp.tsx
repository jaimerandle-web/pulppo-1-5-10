'use client';
// Análisis de portales — reemplaza el Streamlit local de ~/Documents/Pulppo/Análisis de Portales.
// Aquí lee Mongo en vivo y la inversión sale del Sheet, no de una tabla a mano.
//
// Diseño: los mismos tokens que /mb y /plus (7 colores oficiales, R=2, EB Garamond en cifras,
// sin sombras, sin emoji).
import { useMemo, type CSSProperties } from 'react';
import type { PortalesView, Portal, PortalMes } from '@/lib/portales/view';
import type { PulseView } from '@/lib/portales/pulse';
import type { HistoricoView } from '@/lib/portales/historico';
import type { CalidadView } from '@/lib/portales/calidad';

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

export type Section = 'costo' | 'funnel' | 'deal' | 'calidad' | 'pulso' | 'historico' | 'comoleer';

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

export default function PortalesApp({ d, pulso, hist, calidad, section, setSection, cacheAt, onRefresh, cargando, controles, onPresentar }: {
    d: PortalesView; pulso: PulseView | null; hist: HistoricoView | null; calidad: CalidadView | null;
    section: Section; setSection: (s: Section) => void;
    cacheAt: number | null; onRefresh: () => void; cargando: boolean;
    controles?: React.ReactNode; onPresentar?: () => void;
}) {
    const meses = d.meses;
    const ultimo = meses[meses.length - 1];
    // El mes en curso está incompleto por definición: nunca es el que se juzga.
    const cerrado = meses[meses.length - 2] ?? ultimo;

    const tth: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const tth0: CSSProperties = { ...tth, textAlign: 'left' };
    const ttd: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    const ttd0: CSSProperties = { ...ttd, textAlign: 'left' };

    const nav = (id: Section, label: string) => (
        <div key={id} onClick={() => setSection(id)} style={{ padding: '9px 12px', borderRadius: R, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 2, background: section === id ? BLK : 'transparent', color: section === id ? '#fff' : '#555' }}>{label}</div>
    );

    const pagados = useMemo(() => d.portales.filter((p) => p.pagado), [d.portales]);
    const fila = (p: Portal, mk: string): PortalMes | undefined => p.rows.find((r) => r.mes === mk);

    // Totales del último mes cerrado, sólo con portales cuya inversión SÍ se conoce: sumar
    // s/d como 0 daría un CPL global falsamente barato.
    const tot = useMemo(() => {
        let inv = 0, leads = 0, reg = 0, cierres = 0, sinDato = 0;
        for (const p of pagados) {
            const r = fila(p, cerrado.key);
            if (!r) continue;
            if (r.inversion == null) { sinDato += 1; continue; }
            inv += r.inversion; leads += r.leads; reg += r.regalia; cierres += r.cierres;
        }
        return { inv, leads, reg, cierres, sinDato };
    }, [pagados, cerrado.key]);

    const hace = cacheAt ? Math.round((Date.now() - cacheAt) / 60000) : null;

    return (
        <div style={{ fontFamily: 'Nunito Sans, sans-serif', color: BLK, background: '#fff', minHeight: '100vh', display: 'flex' }}>
            {/* ── nav ── */}
            <div style={{ width: 208, flexShrink: 0, borderRight: `1px solid ${LGT}`, padding: '22px 12px', position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, lineHeight: 1.1, padding: '0 8px 4px' }}>Análisis de portales</div>
                <div style={{ fontSize: 10.5, color: GRY, padding: '0 8px 16px' }}>
                    {meses[0].label} – {ultimo.label}
                </div>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', color: GRY, fontWeight: 700, padding: '0 8px 5px' }}>Mensual · rezagado</div>
                {nav('costo', 'Costo y retorno')}
                {nav('funnel', 'Calidad del funnel')}
                {nav('deal', 'Deal MercadoLibre')}
                {nav('calidad', 'Calidad del lead')}
                {nav('historico', 'Histórico y año vs año')}
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', color: GRY, fontWeight: 700, padding: '14px 8px 5px' }}>Semanal · adelantado</div>
                {nav('pulso', 'Pulso de la semana')}
                <div style={{ height: 14 }} />
                {nav('comoleer', 'Cómo leer esto')}
                <div style={{ marginTop: 20, padding: '0 8px' }}>
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

                {(controles || onPresentar) && (
                    <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 14, marginBottom: 16, borderBottom: `1px solid ${LGT}` }}>
                        {controles}
                        <div style={{ flex: 1 }} />
                        {onPresentar && (
                            <button onClick={onPresentar}
                                title="El reporte de un solo portal, sin datos de los demás, listo para proyectar o exportar"
                                style={{ padding: '7px 13px', borderRadius: R, border: `1px solid ${BLK}`, background: '#fff', color: BLK, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                Modo presentación
                            </button>
                        )}
                    </div>
                )}


                {d.operacion !== 'todas' && (
                    <div style={{ marginBottom: 16 }}>
                        <Aviso tono="alerta">
                            Estás viendo <b>sólo {d.operacion === 'sale' ? 'venta' : 'renta'}</b>. Los leads,
                            las visitas, los cierres y el funnel ya están filtrados, pero{' '}
                            <b>el costo se apaga a propósito</b>: los portales cobran por el aviso, no por la
                            operación, así que no existe una inversión "de venta" o "de renta" que dividir.
                            Repartirla daría un CPL inventado. Para costo y ROI, vuelve a «Todo».
                        </Aviso>
                    </div>
                )}
                {d.sinInversion.length > 0 && d.operacion === 'todas' && (
                    <div style={{ marginBottom: 16 }}>
                        <Aviso tono="alerta">
                            <b>Falta cargar la inversión de {d.sinInversion.map(mesLargo).join(' y ')} en el Sheet.</b>{' '}
                            Mientras no esté, esos meses muestran <b>s/d</b> en CPL, CPV, CPA y ROI —
                            no un cero, porque cero significaría que fue gratis.
                        </Aviso>
                    </div>
                )}

                {/* ═══════════ COSTO Y RETORNO ═══════════ */}
                {section === 'costo' && (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Costo y retorno por portal
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 18 }}>
                            Último mes cerrado: <b>{mesLargo(cerrado.key)}</b>. La inversión sale del Sheet
                            «Investment Strategy», bloque <code>RESULTS</code>, en vivo.
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                            <Kpi label="Inversión del mes" value={money(tot.inv)}
                                sub={tot.sinDato ? `${tot.sinDato} portal(es) sin dato, fuera de la suma` : 'todos los portales con dato'} />
                            <Kpi label="CPL global" value={tot.leads ? money(tot.inv / tot.leads) : '—'}
                                sub={`${f0(tot.leads)} leads`} />
                            <Kpi label="Regalía Pulppo" value={money(tot.reg)} sub={`${f0(tot.cierres)} cierres del mes`} />
                            <Kpi label="ROI global" value={tot.inv ? `${(tot.reg / tot.inv).toFixed(2)}×` : '—'}
                                sub="regalía ÷ inversión" color={tot.inv && tot.reg / tot.inv >= 1 ? SEA : RED} />
                        </div>

                        <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 760 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth}>Inversión</th>
                                        <th style={tth}>Leads</th>
                                        <th style={tth}>CPL</th>
                                        <th style={tth}>Visitas</th>
                                        <th style={tth}>CPV</th>
                                        <th style={tth}>Cierres</th>
                                        <th style={tth}>CPA</th>
                                        <th style={tth}>Regalía</th>
                                        <th style={tth}>ROI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagados.map((p) => {
                                        const r = fila(p, cerrado.key);
                                        if (!r) return null;
                                        return (
                                            <tr key={p.key}>
                                                <td style={ttd0}>
                                                    {p.canal}
                                                    {p.gratis && <span style={{ fontSize: 9.5, color: SEA, marginLeft: 6 }}>gratis</span>}
                                                </td>
                                                <td style={ttd}>{p.gratis ? '$0' : money(r.inversion)}</td>
                                                <td style={ttd}>{f0(r.leads)}</td>
                                                <td style={ttd}>{p.gratis ? '—' : money(r.cpl)}</td>
                                                <td style={ttd}>{f0(r.visitas)}</td>
                                                <td style={ttd}>{p.gratis ? '—' : money(r.cpv)}</td>
                                                <td style={ttd}>{f0(r.cierres)}</td>
                                                <td style={ttd}>{p.gratis ? '—' : money(r.cpa)}</td>
                                                <td style={ttd}>{money(r.regalia)}</td>
                                                <td style={{ ...ttd, fontWeight: 700, color: r.roi == null ? GRY : r.roi >= 1 ? SEA : RED }}>
                                                    {r.roi == null ? (p.gratis ? 'sin costo' : 's/d') : `${r.roi.toFixed(2)}×`}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <Aviso>
                            <b>propiedades.com no tiene ROI y no es un dato faltante:</b> es gratis
                            estructural (mismo grupo que Habi, no paga ni el boost). Sin denominador no hay
                            división; cualquier cierre suyo es margen puro. <b>WhatsApp y Pulppo</b> no
                            aparecen aquí: son canales propios, no portales pagados.
                        </Aviso>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '26px 0 10px' }}>
                            Inversión mes a mes
                        </h2>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
                            Cada fila es la inversión de ese portal en ese mes. Abajo, el total del mes y el
                            CPL global (inversión total ÷ leads de los portales que sí tienen costo cargado).
                            Se corrigió un error de la versión anterior: la tabla a mano tenía el i24 de julio
                            copiado hacia marzo–junio. Aquí cada mes trae su número real.
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 620 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        {meses.map((m) => <th key={m.key} style={tth}>{m.label}{m.parcial ? '*' : ''}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagados.map((p) => (
                                        <tr key={p.key}>
                                            <td style={ttd0}>{p.canal}</td>
                                            {meses.map((m) => {
                                                const r = fila(p, m.key);
                                                return <td key={m.key} style={ttd}>{p.gratis ? '$0' : money(r?.inversion)}</td>;
                                            })}
                                        </tr>
                                    ))}
                                    <tr>
                                        <td style={{ ...ttd0, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>Total del mes</td>
                                        {meses.map((m) => {
                                            const suma = pagados.reduce((a, p) => {
                                                const r = fila(p, m.key);
                                                return r?.inversion == null ? a : a + r.inversion;
                                            }, 0);
                                            return <td key={m.key} style={{ ...ttd, fontWeight: 700, borderTop: `1px solid ${BLK}` }}>{money(suma)}</td>;
                                        })}
                                    </tr>
                                    <tr>
                                        <td style={{ ...ttd0, fontWeight: 700 }}>CPL global</td>
                                        {meses.map((m) => {
                                            // Global de verdad: suma de la inversión de los portales CON dato,
                                            // dividida entre los leads de ESOS MISMOS portales. Meter en el
                                            // divisor los leads de un portal cuya inversión no conocemos
                                            // abarataría el CPL con leads que nadie pagó.
                                            let inv = 0, lds = 0;
                                            for (const p of pagados) {
                                                const r = fila(p, m.key);
                                                if (!r || r.inversion == null) continue;
                                                inv += r.inversion; lds += r.leads;
                                            }
                                            return <td key={m.key} style={{ ...ttd, fontWeight: 700 }}>{lds ? money(inv / lds) : '—'}</td>;
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>* mes en curso, incompleto.</div>
                    </>
                )}

                {/* ═══════════ CALIDAD DEL FUNNEL ═══════════ */}
                {section === 'funnel' && (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Calidad del funnel por portal
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 16 }}>
                            Cohorte de <b>{mesLargo(cerrado.key)}</b>: leads que entraron ese mes y qué pasó
                            con ellos. No se mezcla con los cierres del mes.
                        </div>
                        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 800 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth}>Leads</th>
                                        <th style={tth}>Únicos</th>
                                        <th style={tth}>% venta</th>
                                        <th style={tth}>% broker</th>
                                        <th style={tth}>&lt;1 h</th>
                                        <th style={tth}>Sin responder</th>
                                        <th style={tth}>Visitas</th>
                                        <th style={tth}>Tasa visita</th>
                                        <th style={tth}>Lead→cierre</th>
                                        <th style={tth}>Ciclo</th>
                                        <th style={tth}>Ticket</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {d.portales.map((p) => {
                                        const r = fila(p, cerrado.key);
                                        if (!r) return null;
                                        return (
                                            <tr key={p.key}>
                                                <td style={ttd0}>{p.canal}</td>
                                                <td style={ttd}>{f0(r.leads)}</td>
                                                <td style={ttd}>{f0(r.unicos)}</td>
                                                <td style={ttd}>{pc(r.pctVenta)}</td>
                                                <td style={{ ...ttd, color: (r.pctBroker ?? 0) >= 15 ? RED : BLK }}>{pc(r.pctBroker)}</td>
                                                <td style={ttd}>{pc(r.lt60)}</td>
                                                <td style={{ ...ttd, color: (r.sinResponder ?? 0) >= 5 ? RED : BLK }}>{pc(r.sinResponder)}</td>
                                                <td style={ttd}>{f0(r.visitas)}</td>
                                                <td style={{ ...ttd, fontWeight: 700 }}>{pc(r.tasaVisita)}</td>
                                                <td style={ttd}>{r.l2c == null ? '—' : `${r.l2c}%`}</td>
                                                <td style={ttd}>{r.cicloDias == null ? '—' : `${r.cicloDias} d`}</td>
                                                <td style={ttd}>{money(r.ticket)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <Aviso tono="alerta">
                            <b>Esta tasa de visita sale más baja que la del PDF mensual, y es a propósito.</b>{' '}
                            Aquí la cohorte es estricta: sólo cuenta la visita que ocurrió <i>después</i> del
                            lead. El recap todavía usa la versión sin filtrar, que arrastra la historia previa
                            del contacto (clientes que ya estaban en la cartera del broker) e infla el número.
                            Corregirlo allá <b>baja</b> los números de reportes ya entregados, así que es una
                            decisión de Ale, no un cambio silencioso.
                        </Aviso>
                        <div style={{ marginTop: 12 }}>
                            <Aviso>
                                El <b>ciclo</b> es la mediana de días entre el primer lead de ESE portal y el
                            cierre; el <b>ticket</b> es el valor de cierre promedio, no la comisión. Si un
                            cierre quedó atribuido a un portal del que el comprador nunca tuvo un lead, no
                            entra al ciclo: se cuenta aparte (en {cerrado.label}, {' '}
                            {d.portales.reduce((a, p) => a + (fila(p, cerrado.key)?.cierresSinLead ?? 0), 0)} cierres).
                            El <b>lead→cierre</b> de los últimos ~3 meses está inmaduro por construcción:
                                el ciclo de venta va de 43 a 144 días, así que la cohorte reciente todavía no
                                terminó de cerrar. <b>Atención</b> (&lt;1 h y sin responder) cuenta sólo leads
                                que entraron entre 9:00 y 20:59 de México — sin ese filtro, los de madrugada
                                disparan el «sin responder».
                            </Aviso>
                        </div>
                    </>
                )}

                {/* ═══════════ DEAL MELI ═══════════ */}
                {section === 'deal' && d.deal && (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Deal MercadoLibre — {mesLargo(d.deal.mes)}
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 16 }}>{d.notaMeli}</div>

                        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                            <Kpi label="Base fija" value="$152,800" sub="del contrato" />
                            <Kpi label="6% calculado" value={money(d.deal.seisR2)}
                                sub={`${d.deal.ops.length} operaciones · comisión ${money(d.deal.comisionR2)}`} />
                            <Kpi label="6% conciliado" value={d.deal.seisConfirmado == null ? 'pendiente' : money(d.deal.seisConfirmado)}
                                sub={d.deal.seisConfirmado == null ? 'nadie lo ha revisado' : 'revisado a mano'}
                                color={d.deal.seisConfirmado == null ? RED : SEA} />
                            <Kpi label="Inversión del mes" value={money(d.deal.inversion)}
                                sub={d.deal.fuente === 'conciliado' ? 'base + 6% conciliado' : 'base + 6% calculado (sin revisar)'} />
                        </div>

                        <Aviso tono="alerta">
                            <b>Este número no se puede automatizar del todo.</b> Ninguna regla derivable de
                            Mongo reproduce los tres meses ya conciliados: la estricta clava junio y julio
                            ({money(d.deal.seisR1)} en este mes) y la amplia reproduce la tabla de MeLi de
                            agosto ({money(d.deal.seisR2)}). Se contradicen. Por eso la tabla de abajo es una
                            <b> lista de revisión</b>, no un cobro: las banderas dicen qué mirar antes de pagar.
                        </Aviso>

                        <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 820 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Operación</th>
                                        <th style={tth0}>Inmobiliaria</th>
                                        <th style={tth}>Comisión</th>
                                        <th style={tth}>6%</th>
                                        <th style={tth0}>Revisar</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {d.deal.ops.map((o) => (
                                        <tr key={o.id ?? Math.random()} style={{ background: o.banderas.length ? '#FFFBEF' : '#fff' }}>
                                            <td style={{ ...ttd0, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{o.id ?? '—'}</td>
                                            <td style={ttd0}>{o.inmobiliaria ?? '—'}</td>
                                            <td style={ttd}>{money(o.comision)}</td>
                                            <td style={ttd}>{money(o.seis)}</td>
                                            <td style={{ ...ttd0, whiteSpace: 'normal', fontSize: 11, color: o.banderas.length ? '#8A5333' : GRY, maxWidth: 340 }}>
                                                {o.banderas.length ? o.banderas.join(' · ') : 'sin observaciones'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Aviso>
                            En agosto la única que se sacó fue <code>017-QIRQJFZCD</code>, y aparece arriba con
                            las tres banderas: lead de MeLi de 24 meses, i24 entró después, y se anunció una
                            casa pero cerró un terreno. El corte de <b>12 meses</b> para la bandera de
                            antigüedad viene de ahí: era la única del universo con más de 6.
                        </Aviso>
                    </>
                )}

                {/* ═══════════ CALIDAD DEL LEAD ═══════════ */}
                {section === 'calidad' && (!calidad ? (
                    <div style={{ color: GRY, fontSize: 13 }}>Calculando la calidad del lead…</div>
                ) : (
                    <>
                        <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>
                            Calidad del lead por portal
                        </h1>
                        <div style={{ fontSize: 12.5, color: '#666', marginBottom: 14 }}>
                            Qué proporción del volumen de cada portal termina descartado y por qué.
                            Mes de referencia: <b>{mesLargo(calidad.mesCerrado)}</b>.
                        </div>

                        <Aviso tono="alerta">
                            <b>El descarte madura.</b> Un lead de esta semana casi no ha tenido tiempo de
                            cancelarse, así que el mes en curso <b>siempre</b> se ve más limpio de lo que va a
                            terminar siendo. No leas la última columna como una mejora.
                        </Aviso>

                        <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 780 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        <th style={tth}>Leads</th>
                                        <th style={tth}>Descartados</th>
                                        <th style={tth}>Era broker</th>
                                        <th style={tth}>No responde</th>
                                        <th style={tth}>Incontactable</th>
                                        <th style={tth}>Perdido</th>
                                        <th style={tth}>Broker por tag</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calidad.portales.map((p) => {
                                        const r = p.rows.find((x) => x.mes === calidad.mesCerrado);
                                        if (!r || !r.leads) return null;
                                        return (
                                            <tr key={p.key}>
                                                <td style={ttd0}>{p.canal}</td>
                                                <td style={ttd}>{f0(r.leads)}</td>
                                                <td style={{ ...ttd, fontWeight: 700, color: (r.pctDescartado ?? 0) >= 60 ? RED : BLK }}>{pc(r.pctDescartado)}</td>
                                                <td style={{ ...ttd, color: (r.pctBroker ?? 0) >= 20 ? RED : BLK }}>{pc(r.pctBroker)}</td>
                                                <td style={ttd}>{pc(r.pctNoResponde)}</td>
                                                <td style={ttd}>{pc(r.pctIncontactable)}</td>
                                                <td style={ttd}>{pc(r.pctPerdido)}</td>
                                                <td style={{ ...ttd, color: (r.pctBrokerTag ?? 0) >= 30 ? RED : GRY }}>{pc(r.pctBrokerTag)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <Aviso>
                            <b>«Era broker» y «broker por tag» no son lo mismo.</b> El primero es el motivo que
                            escribió el asesor al descartar. El segundo es la etiqueta del contacto en la base,
                            y aplica al contacto exista o no un descarte. Cuando los dos están altos, el portal
                            te está mandando colegas, no clientes.
                        </Aviso>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '26px 0 10px' }}>
                            Descartados mes a mes
                        </h2>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 620 }}>
                                <thead>
                                    <tr>
                                        <th style={tth0}>Portal</th>
                                        {calidad.meses.map((m) => <th key={m.key} style={tth}>{m.label}{m.parcial ? '*' : ''}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {calidad.portales.map((p) => (
                                        <tr key={p.key}>
                                            <td style={ttd0}>{p.canal}</td>
                                            {calidad.meses.map((m) => {
                                                const r = p.rows.find((x) => x.mes === m.key);
                                                return (
                                                    <td key={m.key} style={{ ...ttd, color: m.parcial ? GRY : BLK }}>
                                                        {r && r.leads ? pc(r.pctDescartado) : '—'}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>* mes en curso: el descarte todavía no madura, se ve artificialmente bajo.</div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '26px 0 10px' }}>
                            Por qué descartan, portal por portal
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
                            {calidad.motivos.filter((m) => m.filas.length).map((m) => (
                                <div key={m.canal} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '11px 13px' }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7 }}>{m.canal}</div>
                                    {m.filas.map((f) => (
                                        <div key={f.motivo} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, padding: '2px 0', color: '#555' }}>
                                            <span>{f.motivo}</span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: BLK }}>{f.pct}%</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 14 }}>
                            <Aviso>
                                Los porcentajes son sobre los descartes CON motivo de ese portal, no sobre sus
                                leads. Si una búsqueda tuvo leads de dos portales, cuenta en los dos.
                            </Aviso>
                        </div>
                    </>
                ))}

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
                                        <th style={tth}>En curso</th>
                                        <th style={tth}>Mes a hoy</th>
                                        <th style={tth}>Mes pasado</th>
                                        <th style={tth}>Ritmo</th>
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
                            «En curso» es la semana que va corriendo y por eso no entra en la comparación.
                            «Mes pasado» está cortado al mismo día del mes, no al mes completo.
                        </div>

                        <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, fontWeight: 400, margin: '0 0 4px' }}>Atención</h2>
                        <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
                            Sólo leads que entraron entre 9:00 y 20:59 de México. Sin ese filtro, los de
                            madrugada disparan el «sin responder» y el número deja de significar algo.
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
                                        <td style={ttd0}>Sin responder</td>
                                        {pulso.resp.map((r, i) => (
                                            <td key={i} style={{ ...ttd, color: r.pctSin >= 5 ? RED : BLK, fontWeight: r.pctSin >= 5 ? 700 : 400 }}>{r.pctSin}%</td>
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
