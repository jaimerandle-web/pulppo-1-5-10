'use client';
// Premios del año en el Salón de la fama: preview en vivo, acumulado y SIEMPRE con comisión
// cobrada. Cambia cada mes hasta diciembre; la lista final sale de aquí mismo.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Premios, Lugar } from '@/lib/premios';
import type { Level } from '@/lib/plus';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
// Mismos tonos de nivel que PlusApp (muestreados de la pieza oficial "Ranking Pulppo").
const LVL: Record<Level, { base: string; soft: string; lbl: string }> = {
    elite: { base: '#B88849', soft: '#EFE4D2', lbl: 'Élite' },
    professional: { base: '#868B8E', soft: '#E4E6E7', lbl: 'Profesional' },
    standard: { base: '#DEA37F', soft: '#F7E7DC', lbl: 'Estándar' },
};
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const mill = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : money(n));
const serif: CSSProperties = { fontFamily: 'EB Garamond, serif' };

function fmtV(l: Lugar): string {
    switch (l.fmt) {
        case 'money': return mill(l.value);
        case 'pct': return `${(l.value * 100).toFixed(1)}%`;
        case 'int': return l.value.toLocaleString('es-MX');
        case 'score': return l.value.toFixed(0);
        case 'dias': return `${l.value.toFixed(l.value < 10 ? 1 : 0)} días`;
        case 'min': return l.value < 60 ? `${Math.round(l.value)} min` : `${(l.value / 60).toFixed(1)} h`;
    }
}

function Avatar({ src, name, color, size = 30 }: { src?: string | null; name: string; color: string; size?: number }) {
    const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
    return src
        ? <img src={src} alt={name} width={size} height={size} loading="lazy"
            style={{ width: size, height: size, borderRadius: size, objectFit: 'cover', border: `2px solid ${color}`, flexShrink: 0, background: LGT }} />
        : <span style={{ width: size, height: size, borderRadius: size, border: `2px solid ${color}`, background: LGT, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...serif, fontSize: size * .42, color: BLK }}>{ini}</span>;
}

function Card({ titulo, nota, children, acento = BLK }: { titulo: string; nota?: string; children: ReactNode; acento?: string }) {
    return (
        <div style={{ background: '#fff', border: `1px solid ${LGT}`, borderTop: `3px solid ${acento}`, borderRadius: R, padding: '13px 15px' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, color: '#555' }}>{titulo}</div>
            {nota && <div style={{ fontSize: 10.5, color: GRY, marginTop: 3, lineHeight: 1.35 }}>{nota}</div>}
            <div style={{ marginTop: 10 }}>{children}</div>
        </div>
    );
}

/** Podio genérico: con foto si es persona (trae `photo` definido), sin foto si es inmobiliaria. */
function Podio({ rows, color, vacio = 'Sin datos suficientes todavía.' }: { rows: Lugar[]; color: string; vacio?: string }) {
    if (!rows.length) return <div style={{ fontSize: 11.5, color: GRY }}>{vacio}</div>;
    return (
        <>
            {rows.map((l, i) => (
                <div key={l.name + i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderBottom: `1px solid ${LGT}` }}>
                    <span style={{ ...serif, fontSize: 16, color: i === 0 ? YEL : GRY, width: 14, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                    {l.photo !== undefined && <Avatar src={l.photo} name={l.name} color={color} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: i === 0 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                        {(l.company || (l.photo === undefined && l.sub)) && (
                            <div style={{ fontSize: 10.5, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {l.photo !== undefined ? l.company : l.sub}
                            </div>
                        )}
                        {l.nota && <div style={{ fontSize: 9.5, color: '#999', lineHeight: 1.3, marginTop: 2 }}>{l.nota}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, maxWidth: 120 }}>
                        <div style={{ ...serif, fontSize: 15 }}>{fmtV(l)}</div>
                        {l.photo !== undefined && l.sub && <div style={{ fontSize: 10, color: GRY }}>{l.sub}</div>}
                    </div>
                </div>
            ))}
        </>
    );
}

const Seccion = ({ t }: { t: string }) => (
    <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, color: '#888', margin: '20px 0 9px', borderBottom: `1px solid ${LGT}`, paddingBottom: 5 }}>{t}</div>
);
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 };

export default function PremiosPanel({ year }: { year: number }) {
    const [p, setP] = useState<Premios | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [verPro, setVerPro] = useState(false);

    useEffect(() => {
        let vivo = true;
        setP(null); setErr(null);
        fetch(`/api/plus/premios?year=${year}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { if (vivo) setP(j); })
            .catch((e) => { if (vivo) setErr(String(e)); });
        return () => { vivo = false; };
    }, [year]);

    const head = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div>
                <div style={{ ...serif, fontSize: 23 }}>Premios {year}</div>
                <div style={{ fontSize: 11.5, color: '#777', marginTop: 2 }}>
                    Preview en vivo · acumulado <b>cobrado</b>{p ? ` al ${p.hasta}` : ''}. Se mueve cada mes hasta cerrar diciembre.
                </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', padding: '5px 9px', background: YEL, color: BLK, borderRadius: R }}>Preliminar</span>
        </div>
    );

    if (err) return <div style={{ marginBottom: 26 }}>{head}<div style={{ color: RED, fontSize: 12.5 }}>No pude calcular los premios: {err}</div></div>;
    if (!p) return <div style={{ marginBottom: 26 }}>{head}<div style={{ color: GRY, fontSize: 12.5 }}>Calculando el año desde Mongo (≈40 s la primera vez)…</div></div>;

    const bda = p.brokerDelAño;

    return (
        <div style={{ marginBottom: 30 }}>
            {head}

            {/* Los dos premios mayores, arriba y en grande */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                <div style={{ background: BLK, color: '#fff', borderRadius: R, padding: '16px 18px' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700, color: GRY }}>Inmobiliaria del año</div>
                    {p.inmoDelAño[0] && <>
                        <div style={{ ...serif, fontSize: 28, margin: '6px 0 2px' }}>{p.inmoDelAño[0].name}</div>
                        <div style={{ ...serif, fontSize: 19, color: YEL }}>{money(p.inmoDelAño[0].value)} <span style={{ fontSize: 12, color: GRY, fontFamily: 'inherit' }}>cobrados · {p.inmoDelAño[0].sub}</span></div>
                    </>}
                    <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,.12)' }}>
                        {p.inmoDelAño.slice(1).map((r, i) => (
                            <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                                <span><span style={{ ...serif, color: GRY, marginRight: 8 }}>{i + 2}</span>{r.name}{r.nota && <span style={{ color: GRY }}> · {r.nota}</span>}</span>
                                <span style={serif}>{mill(r.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div style={{ background: LVL.elite.soft, border: `1px solid ${LVL.elite.base}`, borderRadius: R, padding: '16px 18px' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 700, color: LVL.elite.base }}>Broker del año</div>
                    {bda ? (
                        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10 }}>
                            <Avatar src={bda.photo} name={bda.name} color={LVL.elite.base} size={72} />
                            <div>
                                <div style={{ ...serif, fontSize: 26, lineHeight: 1.1 }}>{bda.name}</div>
                                <div style={{ fontSize: 12, color: '#6E4F22', marginTop: 2 }}>{bda.company}</div>
                                <div style={{ ...serif, fontSize: 19, marginTop: 6 }}>{money(bda.value)} <span style={{ fontSize: 11.5, color: '#777', fontFamily: 'inherit' }}>cobrados en el año · {bda.sub}</span></div>
                            </div>
                        </div>
                    ) : <div style={{ fontSize: 12, color: GRY, marginTop: 8 }}>Sin datos.</div>}
                    <div style={{ fontSize: 10.5, color: '#777', marginTop: 12 }}>El #1 de los que hoy son élite. Su parte por rol (comprador 50 / vendedor 25 / productor 25).</div>
                </div>
            </div>

            <Seccion t="Brokers por nivel" />
            <div style={grid}>
                {(['elite', 'professional', 'standard'] as Level[]).map((lv) => (
                    <Card key={lv} titulo={`Premio Broker ${LVL[lv].lbl}`} acento={LVL[lv].base}
                        nota="Top 5. Compiten en el nivel que tienen hoy, con todo lo cobrado en el año.">
                        <Podio rows={p.brokers[lv]} color={LVL[lv].base} />
                    </Card>
                ))}
            </div>

            <Seccion t="Inmobiliarias" />
            <div style={grid}>
                <Card titulo="Mejor desempeño" acento={SEA}
                    nota="Puntaje 0–100: cobrado, crecimiento vs mismo periodo del año pasado, conversión lead→cierre y visitas por lead (25% c/u). Mínimo 200 leads.">
                    <Podio rows={p.desempeño} color={SEA} />
                </Card>
                <Card titulo="Ticket promedio de facturación" nota="Valor promedio de lo vendido. Mínimo 5 ventas con cobro en el año.">
                    <Podio rows={p.ticket} color={BLK} />
                </Card>
                <Card titulo="Inmobiliarias nuevas · top 3" acento={YEL} nota="Las que entraron a Pulppo este año, por lo cobrado.">
                    <Podio rows={p.nuevasInmo} color={YEL} />
                </Card>
                <Card titulo="Mejor tasa de visita" acento={SEA} nota="De los contactos con lead en el año, cuántos llegaron a visita con la misma inmobiliaria. Mínimo 200 leads.">
                    <Podio rows={p.tasaVisita} color={SEA} />
                </Card>
                <Card titulo="Mejor calidad de inventario" nota="% del inventario publicado hoy con ficha en calidad Alta. Mínimo 30 propiedades.">
                    <Podio rows={p.calidad} color={BLK} />
                </Card>
                <Card titulo="Más operaciones en conjunto" acento={YEL} nota="Pares de inmobiliarias de la red que más operaciones cobraron juntas (una de cada lado).">
                    <Podio rows={p.conjunto} color={YEL} />
                </Card>
            </div>

            <Seccion t="Asesores" />
            <div style={grid}>
                <Card titulo="Racha élite" acento={LVL.elite.base} nota="Más meses seguidos en élite, vigentes hoy.">
                    <Podio rows={p.racha} color={LVL.elite.base} />
                </Card>
                <Card titulo="Revelación del año" acento={YEL} nota="Más niveles subidos de enero a hoy. Empate → más cobrado.">
                    <Podio rows={p.revelacion} color={YEL} />
                </Card>
                <Card titulo="Respuesta relámpago" acento={SEA} nota="Mediana del tiempo de respuesta a sus leads del año, sin respuestas automáticas (<10 s). Mínimo 50 leads respondidos.">
                    <Podio rows={p.relampago} color={SEA} />
                </Card>
                <Card titulo="Mejor lead a cierre" acento={SEA} nota="Contactos que le llegaron como lead este año y le compraron. Mínimo 100 leads.">
                    <Podio rows={p.leadCierre} color={SEA} />
                </Card>
                <Card titulo="Captador del año" nota="Exclusivas firmadas con fecha de inicio en el año (contrato completado).">
                    <Podio rows={p.captador} color={BLK} />
                </Card>
                <Card titulo="Más rentas cerradas" nota="Rentas con cobro en el año en las que participó (cualquier rol).">
                    <Podio rows={p.rentas} color={BLK} />
                </Card>
                <Card titulo="Mayor cantidad de insignias" acento={YEL} nota="Ganadas en el año, sin Academy. Empate → gana quien tiene las más difíciles.">
                    <Podio rows={p.insignias} color={YEL} />
                </Card>
            </div>

            <Seccion t="Récords" />
            <div style={grid}>
                <Card titulo="Venta de mayor valor" acento={YEL} nota="Valor de cierre, ventas con cobro en el año.">
                    <Podio rows={p.ventaMayor} color={YEL} />
                </Card>
                <Card titulo="Venta más rápida" acento={SEA} nota="Del primer lead del comprador al cierre. Ventas de $2M o más, sin terrenos, y sólo si el lead llegó antes de abrir la operación.">
                    <Podio rows={p.ventaRapida} color={SEA} />
                </Card>
            </div>

            <Seccion t="Ascensos del año" />
            <div style={grid}>
                <Card titulo={`Nuevos élite · ${p.nuevosElite.length}`} acento={LVL.elite.base} nota="Llegaron a élite por primera vez este año. En gris: ya bajaron.">
                    <div style={{ display: 'grid', gap: 6 }}>
                        {p.nuevosElite.map((n) => (
                            <div key={n.name} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: n.sigue ? 1 : .45 }}>
                                <Avatar src={n.photo} name={n.name} color={LVL.elite.base} size={26} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n.name}</div>
                                    <div style={{ fontSize: 10.5, color: '#888' }}>{n.company}</div>
                                </div>
                                <span style={{ fontSize: 10.5, color: '#888', textTransform: 'capitalize' }}>{n.mes}</span>
                            </div>
                        ))}
                    </div>
                </Card>
                <Card titulo={`Nuevos profesionales · ${p.nuevosPro.length}`} acento={LVL.professional.base} nota="Llegaron a profesional (o directo a élite) por primera vez este año. En gris: ya bajaron.">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {(verPro ? p.nuevosPro : p.nuevosPro.slice(0, 18)).map((n) => (
                            <span key={n.name} title={`${n.company ?? ''} · ${n.mes}`}
                                style={{ fontSize: 11, padding: '3px 7px', borderRadius: R, background: n.sigue ? LVL.professional.soft : LGT, color: n.sigue ? BLK : '#999' }}>
                                {n.name}
                            </span>
                        ))}
                    </div>
                    {p.nuevosPro.length > 18 && (
                        <div onClick={() => setVerPro(!verPro)} style={{ fontSize: 11, fontWeight: 700, marginTop: 8, cursor: 'pointer', color: '#555' }}>
                            {verPro ? 'Ver menos' : `Ver los ${p.nuevosPro.length}`}
                        </div>
                    )}
                </Card>
            </div>

            {p.pendiente.length > 0 && (
                <div style={{ marginTop: 14, padding: '10px 13px', background: '#FBF3D9', borderRadius: R, fontSize: 11.5, lineHeight: 1.5 }}>
                    <b>Ojo antes de anunciar:</b> estas inmobiliarias tienen operaciones cerradas en el año que todavía no se cobran, y con cobrada no cuentan:{' '}
                    {p.pendiente.map((x, i) => (
                        <span key={x.name}>{i > 0 && ' · '}<b>{x.name}</b> {mill(x.porCobrar)} por cobrar</span>
                    ))}.
                </div>
            )}
        </div>
    );
}
