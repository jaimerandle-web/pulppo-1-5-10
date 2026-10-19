'use client';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Expediente as Exp, Evento } from '@/lib/propiedad';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const ESTATUS: Record<string, string> = { published: 'publicada', completed: 'vendida / rentada', cancelled: 'cancelada', edition: 'en edición', valuation: 'en valuación', documentation: 'en documentación' };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// fecha en hora de México (UTC−6, sin horario de verano)
const fch = (x: string | null | undefined) => {
    if (!x) return '—';
    const d = new Date(new Date(x).getTime() - 6 * 3600 * 1000);
    return `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const money = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);
const f0 = (v: number) => v.toLocaleString('es-MX');

const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: GRY };
const th: CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '8px', borderBottom: `1px solid ${LGT}`, fontSize: 12.5, verticalAlign: 'top' };
const a: CSSProperties = { color: SEA, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' };

function Seccion({ titulo, nota, children }: { titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 30 }}>
            <div style={eyebrow}>{titulo}</div>
            <div style={{ width: 50, height: 1, background: YEL, margin: '8px 0 12px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#777', margin: '-4px 0 10px', lineHeight: 1.5 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Chip({ children, fondo = '#fff', color = BLK, borde }: { children: ReactNode; fondo?: string; color?: string; borde?: string }) {
    return <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: R, background: fondo, color, border: `1px solid ${borde ?? fondo}`, marginRight: 6, marginTop: 6, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Copiar({ v }: { v: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button type="button" title="Copiar" onClick={() => { navigator.clipboard?.writeText(v).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {}); }}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: BLK, textAlign: 'left' }}>
            {v} <span style={{ fontSize: 10, color: ok ? SEA : GRY }}>{ok ? '✓ copiado' : '⧉'}</span>
        </button>
    );
}
function Fila({ l, children }: { l: string; children: ReactNode }) {
    return (
        <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: `1px solid ${LGT}`, fontSize: 12.5 }}>
            <div style={{ width: 150, flexShrink: 0, color: '#777' }}>{l}</div>
            <div style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>{children}</div>
        </div>
    );
}
const tonoEstatus = (k: string): { fondo: string; color: string; borde?: string } =>
    k === 'published' ? { fondo: SEA, color: '#fff' } : k === 'completed' ? { fondo: BLK, color: '#fff' } : k === 'cancelled' ? { fondo: '#fff', color: RED, borde: RED } : { fondo: LGT, color: BLK };
const tonoOp = (k: string): { fondo: string; color: string; borde?: string } =>
    k === 'closed' || k === 'paying' ? { fondo: BLK, color: '#fff' } : k === 'cancelled' ? { fondo: '#fff', color: RED, borde: RED } : { fondo: YEL, color: BLK };

// Contrato de una propiedad de Pulppo en la tabla de duplicados: comisión, exclusiva, documento y si el
// propietario es el mismo — para ver de un vistazo quién la tiene y en qué condiciones.
function ContratoCelda({ c, renta, mismo }: { c: { comision: number | null; exclusiva: string; documento: string }; renta: boolean; mismo?: boolean | null }) {
    return (
        <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            <b>{c.comision == null ? 'sin comisión' : renta ? `${c.comision} ${c.comision === 1 ? 'mes' : 'meses'}` : `${c.comision}%`}</b>
            {' · '}<span style={{ color: c.exclusiva === 'Exclusiva vigente' ? SEA : BLK, fontWeight: c.exclusiva === 'Exclusiva vigente' ? 700 : 400 }}>{c.exclusiva.toLowerCase()}</span>
            <div style={{ color: c.documento === 'firmado' ? '#666' : RED }}>contrato {c.documento}</div>
            {mismo != null && <div style={{ color: mismo ? '#666' : RED }}>{mismo ? 'mismo propietario' : 'otro propietario'}</div>}
        </div>
    );
}

export default function Expediente({ e }: { e: Exp }) {
    const [tipos, setTipos] = useState<Set<Evento['tipo']>>(new Set());
    const tiposLinea = [...new Set(e.linea.map((x) => x.tipo))];
    const linea = tipos.size ? e.linea.filter((x) => tipos.has(x.tipo)) : e.linea;
    const [verTodo, setVerTodo] = useState(false);
    const maxF = Math.max(1, ...e.funnel.porFuente.map((x) => x.n));
    const ex = e.contrato.exclusiva;
    const hayPulppo = e.duplicados.some((d) => d.origen === 'pulppo');
    const kpis: Array<[string, string, string?]> = [
        [f0(e.funnel.vistas), 'vistas'],
        [f0(e.funnel.leads), 'leads', `${f0(e.funnel.leadsUnicos)} personas`],
        [f0(e.funnel.visitas), 'visitas', e.funnel.visitasPendientes ? `+${e.funnel.visitasPendientes} pendientes` : undefined],
        [f0(e.funnel.ofertas), 'ofertas', 'incluye las que se cayeron'],
        [e.funnel.wa.base ? `${Math.round((100 * e.funnel.wa.sinRespuesta) / e.funnel.wa.base)}%` : '—', 'sin respuesta · WhatsApp', e.funnel.wa.base ? `${e.funnel.wa.sinRespuesta} de ${e.funnel.wa.base}` : 'sin leads por WhatsApp'],
    ];

    return (
        <div>
            {/* ── encabezado ── */}
            <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
                {e.foto && <img src={e.foto} alt="" style={{ width: 220, height: 150, objectFit: 'cover', borderRadius: R, flexShrink: 0, background: LGT }} />}
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.15 }}>{e.titulo || e.direccion.calle || '—'}</div>
                    <div style={{ fontSize: 12.5, color: '#666', marginTop: 4 }}>
                        {[e.tipo, e.operacion, [e.direccion.calle, e.direccion.colonia, e.direccion.ciudad].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: 17, marginTop: 8 }}>
                        <b>{money(e.precio)}</b>{e.moneda !== 'MXN' ? ` ${e.moneda}` : ''}{e.operacion === 'Renta' ? ' /mes' : ''}
                        <span style={{ fontSize: 12.5, color: '#666' }}> · {e.m2 ?? '—'} m² · {e.rec ?? '—'} rec · {e.banos ?? '—'} baños</span>
                    </div>
                    <div>
                        <Chip {...tonoEstatus(e.estatus.key)}>{e.estatus.label}</Chip>
                        <Chip fondo="#fff" color={e.estatus.activa ? SEA : '#777'} borde={e.estatus.activa ? SEA : GRY}>{e.estatus.activa ? 'Activa' : 'Inactiva'}</Chip>
                        {e.estatusOperacion && <Chip {...tonoOp(e.estatusOperacion.key)}>{e.estatusOperacion.label} · {e.estatusOperacion.codigo}</Chip>}
                        {e.contrato.en1510 && <Chip fondo={LGT}>1·5·10</Chip>}
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5 }}>
                        <a href={e.links.ficha} target="_blank" rel="noreferrer" style={a}>Ficha de desempeño ↗</a>
                        <a href={e.links.publica} target="_blank" rel="noreferrer" style={a}>Ver en pulppo.com ↗</a>
                        {e.links.mb && <a href={e.links.mb} target="_blank" rel="noreferrer" style={a}>/mb de {e.inmobiliaria.nombre} ↗</a>}
                    </div>
                </div>
            </div>

            {/* ── KPIs ── */}
            <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
                {kpis.map(([v, l, s]) => (
                    <div key={l} style={{ flex: '1 1 150px', background: LGT, padding: '12px 15px', borderRadius: R }}>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 11, marginTop: 5, fontWeight: 700 }}>{l}</div>
                        {s && <div style={{ fontSize: 10.5, color: '#777', marginTop: 2 }}>{s}</div>}
                    </div>
                ))}
            </div>

            {/* ── códigos y portales ── */}
            <Seccion titulo="Códigos y portales" nota="Estado actual de cada portal. El costo es el precio de lista del nivel en Inmuebles24.">
                <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 10, fontSize: 12 }}>
                    {e.internalId && <div><div style={{ ...eyebrow, fontSize: 9 }}>Código Pulppo</div><Copiar v={e.internalId} /></div>}
                    <div><div style={{ ...eyebrow, fontSize: 9 }}>ID de Pulppo</div><Copiar v={e.id} /></div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                        <thead><tr><th style={th}>Portal</th><th style={th}>Código</th><th style={th}>Estatus</th><th style={th}>Nivel</th><th style={th}>Costo/mes</th><th style={th}>Notas</th><th style={th}></th></tr></thead>
                        <tbody>
                            {e.portales.map((p) => (
                                <tr key={p.portal}>
                                    <td style={{ ...td, fontWeight: 700 }}>{p.portal}</td>
                                    <td style={td}>{p.id ? <Copiar v={p.id} /> : '—'}</td>
                                    <td style={{ ...td, color: p.estatus === 'En línea' ? SEA : p.estatus === 'Fuera de línea' ? RED : BLK, fontWeight: 600 }}>{p.estatus ?? '—'}</td>
                                    <td style={td}>{p.nivel ?? '—'}</td>
                                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{p.costoMes != null ? money(p.costoMes) : '—'}</td>
                                    <td style={{ ...td, fontSize: 11.5 }}>
                                        {p.error && <div style={{ color: RED, fontWeight: 600 }}>⚠ {p.error}</div>}
                                        {p.nota && <div style={{ color: '#666' }}>{p.nota}</div>}
                                        {!p.error && !p.nota && '—'}
                                    </td>
                                    <td style={td}>{p.url ? <a href={p.url} target="_blank" rel="noreferrer" style={a}>Ver aviso ↗</a> : ''}</td>
                                </tr>
                            ))}
                            {!e.portales.length && <tr><td colSpan={7} style={{ ...td, color: '#777' }}>No está dada de alta en ningún portal.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </Seccion>

            {/* ── propiedad y contrato | leads por fuente ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 28 }}>
                <Seccion titulo="Propiedad y contrato">
                    <Fila l="Inmobiliaria">{e.inmobiliaria.nombre}</Fila>
                    <Fila l="Asesor">
                        {e.asesor.nombre}
                        {e.asesor.activo === false && <span style={{ color: RED, fontSize: 11, marginLeft: 6 }}>· dado de baja</span>}
                        {e.asesor.whatsapp === false && <span style={{ color: '#777', fontSize: 11, marginLeft: 6 }}>· sin WhatsApp vinculado</span>}
                        <div style={{ fontWeight: 400, fontSize: 11.5, color: '#666' }}>{[e.asesor.correo, e.asesor.telefono].filter(Boolean).join(' · ')}</div>
                    </Fila>
                    <Fila l="Estatus">{e.estatus.label}{e.estatus.desde ? <span style={{ fontWeight: 400, color: '#666' }}> desde {fch(e.estatus.desde)}</span> : ''}</Fila>
                    <Fila l="Primera publicación">{fch(e.estatus.primeraPublicacion)}{e.estatus.diasPublicada != null && <span style={{ fontWeight: 400, color: '#666' }}> · {f0(e.estatus.diasPublicada)} días</span>}</Fila>
                    <Fila l="Comisión cargada">
                        {e.contrato.comision != null ? (e.operacion === 'Renta' ? `${e.contrato.comision} ${e.contrato.comision === 1 ? 'mes' : 'meses'} de renta` : `${e.contrato.comision}%${e.contrato.ivaIncluido ? ' (con IVA)' : ' sin IVA'}`) : '—'}
                        {e.operacion === 'Venta' && e.contrato.comision != null && !e.contrato.ivaIncluido && (() => {
                            // 4.64 = 4% + IVA, 5.80 = 5% + IVA: alguien lo capturó con IVA (ver Comisión Cargada)
                            const base = e.contrato.comision / 1.16;
                            return Math.abs(base - Math.round(base * 2) / 2) < 0.02 && Math.abs(e.contrato.comision - Math.round(e.contrato.comision)) > 0.05
                                ? <span style={{ fontWeight: 400, color: RED, fontSize: 11.5 }}> · parece {Math.round(base * 2) / 2}% + IVA capturado</span> : null;
                        })()}
                    </Fila>
                    <Fila l="Exclusiva">
                        {ex ? <>
                            {fch(ex.inicio)} → {ex.fin ? fch(ex.fin) : 'sin término'}
                            <span style={{ fontWeight: 400, color: ex.vigente ? SEA : RED }}> · {ex.vigente ? 'vigente' : 'vencida'}</span>
                            <span style={{ fontWeight: 400, color: ex.firmada ? '#666' : RED }}> · {ex.firmada ? 'contrato firmado' : `contrato ${e.contrato.estatus ?? 'sin cargar'}`}</span>
                        </> : 'No'}
                    </Fila>
                    {e.contrato.en1510 && <Fila l="1·5·10">Desde {fch(e.contrato.en1510)}</Fila>}
                    <Fila l="Material">{e.material.fotos} fotos · {e.material.video ? 'con video' : 'sin video'} · {e.material.tour ? 'con tour' : 'sin tour'}{e.material.calidad ? ` · calidad ${e.material.calidad.toLowerCase()}` : ''}</Fila>
                </Seccion>
                <Seccion titulo="Leads por fuente" nota={`${f0(e.funnel.leads30)} en 30 días · ${f0(e.funnel.leads90)} en 90 días · último ${fch(e.funnel.ultimoLead)}`}>
                    {e.funnel.porFuente.map((x) => (
                        <div key={x.fuente} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0', fontSize: 12 }}>
                            <span style={{ width: 120, flexShrink: 0 }}>{x.fuente}</span>
                            <span style={{ flex: 1, background: LGT, height: 14 }}><span style={{ display: 'block', height: 14, width: `${(100 * x.n) / maxF}%`, background: BLK }} /></span>
                            <span style={{ width: 40, textAlign: 'right', fontWeight: 700 }}>{f0(x.n)}</span>
                        </div>
                    ))}
                    {!e.funnel.porFuente.length && <div style={{ fontSize: 12, color: '#777' }}>Sin leads.</div>}
                    <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                        Sin respuesta · WhatsApp: leads por WhatsApp con teléfono válido y sin conversación visible (misma regla que /portales). El asesor contesta desde su WhatsApp y ese chat no se guarda: no es lead perdido.
                    </div>
                </Seccion>
            </div>

            {/* ── operaciones ── */}
            <Seccion titulo={`Operaciones · ${e.operaciones.length}`} nota="Todas, incluidas las canceladas. La fuente del cierre sigue la misma regla que /portales y Desempeño.">
                {!e.operaciones.length && <div style={{ fontSize: 12.5, color: '#777' }}>Nunca ha tenido una oferta.</div>}
                <div style={{ display: 'grid', gap: 12 }}>
                    {e.operaciones.map((o) => (
                        <div key={o.id} style={{ border: `1px solid ${LGT}`, borderLeft: `3px solid ${tonoOp(o.estatusKey).borde ?? tonoOp(o.estatusKey).fondo}`, borderRadius: R, padding: '12px 16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                                <div><b style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{o.codigo}</b> <Chip {...tonoOp(o.estatusKey)}>{o.estatus}</Chip><span style={{ fontSize: 11.5, color: '#666' }}>{o.lado}</span></div>
                                <div style={{ fontSize: 11.5, color: '#666' }}>Creada {fch(o.creada)}{o.cerrada ? ` · cerrada ${fch(o.cerrada)}` : ''}</div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '4px 24px', marginTop: 8, fontSize: 12 }}>
                                <div><span style={{ color: '#777' }}>Valor:</span> <b>{money(o.valor)}</b></div>
                                <div><span style={{ color: '#777' }}>Comisión:</span> <b>{money(o.comision)}</b> <span style={{ color: '#777' }}>· regalía</span> <b>{money(o.regalia)}</b></div>
                                <div><span style={{ color: '#777' }}>Comprador:</span> <b>{o.comprador}</b></div>
                                <div><span style={{ color: '#777' }}>Lo trajo:</span> <b>{o.asesorComprador}</b> <span style={{ color: '#777' }}>({o.inmoComprador})</span></div>
                                <div><span style={{ color: '#777' }}>Vende:</span> <b>{o.asesorVendedor}</b> <span style={{ color: '#777' }}>({o.inmoVendedora})</span></div>
                                {o.fuente && (
                                    <div>
                                        <span style={{ color: '#777' }}>Fuente del cierre:</span>{' '}
                                        <b title={o.fuente.evidencia ?? undefined} style={{ borderBottom: o.fuente.evidencia ? `1px dotted ${GRY}` : undefined, cursor: o.fuente.evidencia ? 'help' : undefined }}>{o.fuente.fuente}</b>
                                        {o.fuente.inferida && <span style={{ color: '#777' }}> · inferida</span>}
                                        {o.fuente.comprador && <span style={{ color: '#777' }}> · {o.fuente.comprador}</span>}
                                    </div>
                                )}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12, background: LGT, padding: '7px 10px', borderRadius: R }}>
                                <span style={{ color: '#777' }}>Lead del comprador:</span>{' '}
                                {o.lead ? <><b>{fch(o.lead.fecha)}</b> · {o.lead.fuente} · atendió {o.lead.asesor}{!o.lead.mismaPropiedad && <span style={{ color: '#777' }}> (entró por otra propiedad)</span>}</> : <span style={{ color: '#777' }}>no tiene ningún lead registrado antes de la operación</span>}
                            </div>
                            {o.historia.length > 0 && (
                                <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
                                    {o.historia.map((h, i) => <span key={i}>{i ? ' → ' : ''}{h.estatus} <span style={{ color: GRY }}>{fch(h.t)}</span></span>)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </Seccion>

            {/* ── duplicados ── */}
            <Seccion titulo={`¿Dónde más está publicada? · ${e.duplicados.length}`}
                nota="El mismo inmueble en el MLS (otras agencias, el propietario) o cargado dos veces en Pulppo. «Muy probable»: misma superficie y precio (±3%) en la misma calle o a menos de 300 m. «Posible»: misma superficie, precio ±15% y la misma calle o a menos de 150 m. Nuestro propio aviso no cuenta.">
                {!e.duplicados.length ? <div style={{ fontSize: 12.5, color: '#777' }}>No encontramos otra publicación de este inmueble.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                            <thead><tr><th style={th}>Coincidencia</th><th style={th}>Dónde</th><th style={th}>Quién la publica</th><th style={th}>Precio</th><th style={th}>Sup.</th><th style={th}>Calle · distancia</th>{hayPulppo && <th style={th}>Contrato</th>}<th style={th}></th></tr></thead>
                            <tbody>
                                {hayPulppo && (
                                    <tr style={{ background: LGT }}>
                                        <td style={{ ...td, fontWeight: 700 }}>Esta propiedad</td>
                                        <td style={td}>Pulppo<div style={{ fontWeight: 700 }}>{e.internalId}</div></td>
                                        <td style={td}>{e.inmobiliaria.nombre} · {e.asesor.nombre}</td>
                                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{money(e.precio)}</td>
                                        <td style={td}>{e.m2 ?? '—'} m²</td>
                                        <td style={td}>{e.direccion.calle || '—'}</td>
                                        <td style={td}><ContratoCelda c={e.miContrato} renta={e.operacion === 'Renta'} /></td>
                                        <td style={td}></td>
                                    </tr>
                                )}
                                {e.duplicados.map((d, i) => (
                                <tr key={i}>
                                    <td style={{ ...td, fontWeight: 700, color: d.nivel === 'Muy probable' ? RED : BLK }}>{d.nivel}</td>
                                    <td style={td}>{d.portal}{d.origen === 'pulppo' && d.internalId && <div><a href={`/propiedad/${d.pulppoId}`} style={a}>{d.internalId}</a> <span style={{ fontSize: 11, color: '#777' }}>{ESTATUS[d.estatus ?? ''] ?? d.estatus}</span></div>}</td>
                                    <td style={td}>{d.quien}</td>
                                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{money(d.precio)}{d.difPrecio != null && Math.abs(d.difPrecio) >= 0.5 && <div style={{ fontSize: 11, color: '#777' }}>{d.difPrecio > 0 ? '+' : ''}{d.difPrecio}%</div>}</td>
                                    <td style={td}>{d.m2 ?? '—'} m²{d.rec != null ? <div style={{ fontSize: 11, color: '#777' }}>{d.rec} rec</div> : null}</td>
                                    <td style={td}>{d.calle || '—'}{d.distancia != null && <div style={{ fontSize: 11, color: '#777' }}>a {f0(d.distancia)} m</div>}</td>
                                    {hayPulppo && <td style={td}>{d.contrato ? <ContratoCelda c={d.contrato} renta={e.operacion === 'Renta'} mismo={d.contrato.mismoPropietario} /> : <span style={{ color: GRY }}>—</span>}</td>}
                                    <td style={td}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" style={a}>Ver aviso ↗</a> : ''}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </Seccion>

            {/* ── ortografía ── */}
            {e.ortografia.length > 0 && (
                <Seccion titulo={`Ortografía · ${e.ortografia.length}`}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                        {e.ortografia.map((o, i) => <span key={i} style={{ marginRight: 14, whiteSpace: 'nowrap' }}><s style={{ color: RED }}>{o.palabra}</s> → <b>{o.bien}</b>{o.tipo === 'dedo' && <span style={{ color: '#777' }}> (posible)</span>}</span>)}
                    </div>
                </Seccion>
            )}

            {/* ── línea de tiempo ── */}
            <Seccion titulo="Línea de tiempo" nota="Lo más reciente arriba. Cambios de precio y movimientos de cada operación: ofertas, ofertas aceptadas, contratos, cierres y las que se cayeron.">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {tiposLinea.map((t) => {
                        const on = tipos.has(t);
                        return (
                            <button key={t} type="button" onClick={() => setTipos((p) => { const x = new Set(p); if (x.has(t)) x.delete(t); else x.add(t); return x; })}
                                style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: R, cursor: 'pointer', border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555' }}>
                                {t} · {e.linea.filter((x) => x.tipo === t).length}
                            </button>
                        );
                    })}
                    {tipos.size > 0 && <button type="button" onClick={() => setTipos(new Set())} style={{ fontSize: 11.5, background: 'none', border: 0, color: SEA, cursor: 'pointer', fontWeight: 700 }}>Ver todo</button>}
                </div>
                <div style={{ borderLeft: `2px solid ${LGT}`, marginLeft: 6 }}>
                    {(verTodo ? linea : linea.slice(0, 40)).map((x, i) => (
                        <div key={i} style={{ position: 'relative', padding: '6px 0 6px 18px', fontSize: 12.5 }}>
                            <span style={{ position: 'absolute', left: -6, top: 11, width: 10, height: 10, borderRadius: 5, background: x.tono === 'ok' ? SEA : x.tono === 'mal' ? RED : x.tipo === 'Operación' ? YEL : GRY }} />
                            <span style={{ display: 'inline-block', width: 96, color: '#666', fontSize: 11.5 }}>{fch(x.t)}</span>
                            <span style={{ display: 'inline-block', width: 100, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: GRY }}>{x.tipo}</span>
                            <span style={{ fontWeight: 600 }}>{x.texto}</span>
                        </div>
                    ))}
                </div>
                {linea.length > 40 && !verTodo && <button type="button" onClick={() => setVerTodo(true)} style={{ marginTop: 8, fontSize: 12, background: 'none', border: 0, color: SEA, cursor: 'pointer', fontWeight: 700 }}>Ver los {linea.length} eventos</button>}
            </Seccion>
        </div>
    );
}
