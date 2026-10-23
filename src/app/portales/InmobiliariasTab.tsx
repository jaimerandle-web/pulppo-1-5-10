'use client';
// Pestaña "Inmobiliarias" de /portales: leads y funnel comercial por fuente, por asesor, fantasmas,
// descartados y cierres — por inmobiliaria o de toda la red, con comparación contra el periodo
// anterior o el mismo periodo del año pasado. Cálculo en `lib/portales/inmobiliaria.ts`.
//
// Abre con una vista predeterminada (toda la red · último mes completo · vs. mes anterior) y cada
// filtro la actualiza solo (Ale, 2-oct-2026). Para no disparar una consulta por tecla: espera a que
// el filtro se quede quieto (300 ms; 900 ms en fechas libres), cancela la consulta anterior y sólo
// pinta la respuesta de la ÚLTIMA. Mientras carga se queda la vista anterior, atenuada.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Bloque, Cierre, Comparar, DetalleFuente, Fila, InmoView, SpamPub } from '@/lib/portales/inmobiliaria';
import type { InversionRango } from '@/lib/portales/inversion';
import type { DealMes } from '@/lib/portales/deal';
import type { SeccionV2 } from './PortalesApp';
import LeadsPorDia from './LeadsPorDia';
import { porFuente, senales } from '@/lib/portales/senales';

// Canales sin factura (mismo criterio que SIN_COSTO de metrics.ts, que no se puede importar aquí
// porque arrastra mongodb al bundle del navegador).
const SIN_COSTO = new Set(['whatsapp', 'pulppo', 'tokko', 'telefono', 'sitio']);
const MESL = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLargo = (mk: string) => `${MESL[Number(mk.slice(5))]} ${mk.slice(0, 4)}`;
/** Meses 'YYYY-MM' que toca un rango de fechas. */
const mesesDe = (desde: string, hasta: string) => {
    const out: string[] = [];
    let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7));
    const y1 = Number(hasta.slice(0, 4)), m1 = Number(hasta.slice(5, 7));
    while ((y < y1 || (y === y1 && m <= m1)) && out.length < 24) { out.push(`${y}-${String(m).padStart(2, '0')}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1]; }
    return out;
};
const TITULOS: Record<SeccionV2, [string, string]> = {
    resumen: ['Resumen', '¿Cómo vamos? Lo más importante del periodo en una pantalla: qué cambió, qué hay que atender y cómo va cada canal.'],
    inversion: ['Inversión y retorno', '¿Cuánto cuesta cada portal y qué nos regresa? Inversión del Sheet, leads del periodo y la regalía de los cierres del periodo.'],
    leads: ['Leads y calidad', '¿Cuántos leads llegan, de dónde, y qué tan buenos son? Brokers, contacto con el lead y por qué se descartan.'],
    embudo: ['Funnel y cierres', '¿Cuántos visitan, ofertan y cierran, por fuente? Y qué cerró en el periodo.'],
    inmobiliarias: ['Inmobiliarias y asesores', 'Los mismos números por inmobiliaria (vista general) o por asesor (con una inmobiliaria elegida).'],
};

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;

type Op = 'todas' | 'sale' | 'rent';
type Modo = 'mes' | 'trimestre' | 'ytd' | 'rango';
interface Opcion { nombre: string; kam: string | null; tier: string | null; cuentas: number; nota?: string }
interface Asesor { id: string; nombre: string; activo: boolean }
interface Filtros { inmo: string; asesor: string; op: Op; modo: Modo; mes: string; anioQ: number; q: number; rDesde: string; rHasta: string; comparar: Comparar }

const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);
const money = (n?: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
const mins = (n?: number | null) => (n == null ? '—' : n < 60 ? `${n} min` : `${(n / 60).toFixed(1)} h`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Hoy en México (UTC−6), como fecha UTC a medianoche. */
const hoyMx = () => { const d = new Date(Date.now() - 6 * 3600 * 1000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

/** El periodo elegido → [desde, hasta] inclusivo, sin pasarse de hoy. */
function periodo(f: Filtros): { desde: string; hasta: string } {
    const hoy = hoyMx();
    const tope = (d: Date) => (d > hoy ? hoy : d);
    if (f.modo === 'ytd') return { desde: `${hoy.getUTCFullYear()}-01-01`, hasta: iso(hoy) };
    if (f.modo === 'mes') {
        const [y, m] = f.mes.split('-').map(Number);
        return { desde: iso(new Date(Date.UTC(y, m - 1, 1))), hasta: iso(tope(new Date(Date.UTC(y, m, 0)))) };
    }
    if (f.modo === 'trimestre') {
        const m0 = (f.q - 1) * 3;
        return { desde: iso(new Date(Date.UTC(f.anioQ, m0, 1))), hasta: iso(tope(new Date(Date.UTC(f.anioQ, m0 + 3, 0)))) };
    }
    return { desde: f.rDesde, hasta: f.rHasta };
}

/** Copia una tabla como TSV: se pega directo en Excel / Sheets. */
function copiar(filas: Array<Array<string | number | null | undefined>>) {
    const tsv = filas.map((r) => r.map((c) => (c == null ? '' : String(c).replace(/\t|\n/g, ' '))).join('\t')).join('\n');
    navigator.clipboard?.writeText(tsv).catch(() => { /* sin permiso de portapapeles */ });
}

/** Definiciones que van dentro de las ⓘ (un solo lugar para que todas las pestañas digan lo mismo). */
const DEF = {
    leads: <>Leads que <b>entraron</b> en el periodo, de todas las fuentes. «Personas» cuenta a cada contacto una vez aunque haya dejado varios leads.</>,
    visita: <>De las personas que dejaron un lead en el periodo, cuántas visitaron <b>después</b> (cohorte). Con inmobiliaria elegida, la visita tiene que ser con esa inmobiliaria.</>,
    ofertaron: <>Personas de la cohorte que hicieron una oferta después de su lead. Cuenta también las ofertas que se cayeron.</>,
    cierresCohorte: <>Personas de la cohorte que ya cerraron. En periodos recientes sale bajo por construcción: el ciclo de venta va de 43 a 144 días.</>,
    cierresPeriodo: <>Operaciones que <b>cerraron</b> en el periodo, vengan de leads de cuando sea. Cuenta los dos lados (vendedor y comprador) y no repite propiedad + comprador.</>,
    regalia: <>Lo que retiene Pulppo de la comisión de los cierres del periodo. No es la comisión total, que es del broker.</>,
    roi: <>Regalía de los cierres de canales pagados ÷ inversión de esos canales. Sólo se calcula con meses completos, sin inmobiliaria y con «Todo» en operación: la inversión es de toda la red.</>,
    cpl: <>Inversión ÷ leads de los canales que cuestan (WhatsApp, Pulppo, sitio, etc. no entran).</>,
    inversion: <>Sale del Sheet «Investment Strategy 2026», bloque de resultados de cada mes. MeLi = base $152,800 + 6% de la comisión del deal.</>,
    sinRespuesta: <>De los leads que llegaron por <b>WhatsApp o formulario</b>, en cuántos el cliente nunca escribió ni llamó (teléfono válido, sin conversación). Es confiable: cuando el cliente escribe, el mensaje queda guardado. <b>Por teléfono</b> se mide aparte y no es comparable: el cliente ve el número y llama al celular del asesor, y esa llamada no se registra (sólo ~5% de los «ver teléfono» de Inmuebles24 tienen llamada en el call center). Ahí el % es «sin contacto visible», no «no contestó».</>,
    brokers: <>Leads cuyo contacto está etiquetado como broker en Pulppo: no son compradores finales.</>,
    respuesta: <>Mediana de minutos a la primera respuesta, sólo de leads que entraron de 8 am a 8 pm (hora de México).</>,
    descartados: <>Leads cuya búsqueda se cerró como descartada o cancelada. El descarte madura: un periodo reciente siempre se ve más limpio de lo que va a terminar, por eso la variación se apaga si el periodo cerró hace menos de 45 días.</>,
    comision: <>Comisión total de los cierres del periodo (de la operación, no sólo la regalía).</>,
    valor: <>Suma del valor de las propiedades cerradas en el periodo.</>,
};

/** ⓘ con la explicación de método: se abre al pasar el mouse o al hacer clic. */
function Info({ children, ancho = 320 }: { children: ReactNode; ancho?: number }) {
    const [abierto, setAbierto] = useState(false);
    const [fijo, setFijo] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    const [izq, setIzq] = useState(false);
    useEffect(() => {
        if (!fijo) return;
        const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setFijo(false); setAbierto(false); } };
        document.addEventListener('mousedown', fuera);
        return () => document.removeEventListener('mousedown', fuera);
    }, [fijo]);
    const abrir = () => {
        const r = ref.current?.getBoundingClientRect();
        setIzq(!!r && r.left + ancho > window.innerWidth - 16);
        setAbierto(true);
    };
    return (
        <span ref={ref} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}
            onMouseEnter={abrir} onMouseLeave={() => { if (!fijo) setAbierto(false); }}>
            <button type="button" aria-label="Cómo se calcula" onClick={() => { if (fijo) { setFijo(false); setAbierto(false); } else { abrir(); setFijo(true); } }}
                style={{ width: 15, height: 15, borderRadius: '50%', border: `1px solid ${GRY}`, background: abierto ? BLK : '#fff', color: abierto ? '#fff' : GRY, fontSize: 10, lineHeight: '13px', padding: 0, cursor: 'pointer', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700 }}>i</button>
            {abierto && (
                <span style={{ position: 'absolute', top: 20, [izq ? 'right' : 'left']: -6, zIndex: 50, width: ancho, maxWidth: 'calc(100vw - 32px)', background: '#fff', border: `1px solid ${BLK}`, borderRadius: R, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5, color: '#333', fontWeight: 400, fontFamily: 'Nunito Sans, sans-serif', whiteSpace: 'normal', textAlign: 'left' }}>
                    {children}
                </span>
            )}
        </span>
    );
}

function Kpi({ label, value, sub, delta, info }: { label: string; value: string; sub?: string; delta?: ReactNode; info?: ReactNode }) {
    return (
        <div style={{ flex: '1 1 150px', background: '#fff', border: `1px solid ${LGT}`, padding: '12px 14px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}{info && <Info>{info}</Info>}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1.05, margin: '7px 0 3px' }}>{value}</div>
            <div style={{ fontSize: 10.5, color: '#777', lineHeight: 1.35 }}>{delta}{delta && sub ? ' · ' : ''}{sub}</div>
        </div>
    );
}

/** Δ contra el periodo comparado. `pts` = diferencia en puntos (para tasas). */
function Delta({ a, b, pts = false, invertir = false }: { a?: number | null; b?: number | null; pts?: boolean; invertir?: boolean }) {
    if (a == null || b == null) return null;
    const v = pts ? Math.round((a - b) * 10) / 10 : b ? Math.round(((a - b) / b) * 100) : null;
    if (v == null) return null;
    const bueno = invertir ? v <= 0 : v >= 0;
    return <span style={{ color: v === 0 ? GRY : bueno ? SEA : RED, fontWeight: 700 }}>{v > 0 ? '+' : ''}{v}{pts ? ' pts' : '%'}</span>;
}

function Seccion({ titulo, sub, info, onCopiar, children }: { titulo: string; sub?: ReactNode; info?: ReactNode; onCopiar?: () => void; children: ReactNode }) {
    return (
        <div style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, fontWeight: 400, margin: 0 }}>{titulo}{info && <Info ancho={380}>{info}</Info>}</h2>
                <div style={{ flex: 1 }} />
                {onCopiar && <button onClick={onCopiar} style={{ fontSize: 11, padding: '4px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>Copiar tabla</button>}
            </div>
            <div style={{ width: 50, height: 1, background: YEL, margin: '8px 0 10px' }} />
            {sub && <div style={{ fontSize: 12, color: '#666', marginBottom: 10, lineHeight: 1.5 }}>{sub}</div>}
            {children}
        </div>
    );
}

/** Fila de «Para atender». Con `detalle`, se abre al hacer clic y dice QUIÉN y QUÉ hacer (Ale, oct-2026). */
function FilaFlag({ sev, titulo, items, spam, etiqueta, detalle, onAbrir }: {
    sev: 'alta' | 'media'; titulo: string; items: string[]; spam?: boolean; etiqueta?: string;
    detalle?: () => ReactNode; onAbrir?: () => void;
}) {
    const [abierta, setAbierta] = useState(false);
    const abre = !!detalle;
    return (
        <div style={{ borderBottom: `1px solid ${LGT}` }}>
            <div onClick={abre ? () => { if (!abierta) onAbrir?.(); setAbierta(!abierta); } : undefined}
                style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', fontSize: 12.5, lineHeight: 1.5, cursor: abre ? 'pointer' : 'default' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.5px', color: sev === 'alta' ? RED : '#8A6D00', width: 44, flexShrink: 0 }}>{sev === 'alta' ? 'ALTA' : 'MEDIA'}</span>
                <span style={{ width: 150, flexShrink: 0, fontWeight: 700 }}>{titulo}{(spam || etiqueta) && <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: R, background: '#F3D9D3', color: RED }}>{etiqueta ?? 'Posible spam'}</span>}</span>
                <span style={{ flex: 1 }}>{items.length === 1 ? items[0] : items.map((t, i) => <div key={i}>· {t}</div>)}</span>
                {abre && <span style={{ fontSize: 11, color: '#777', flexShrink: 0, whiteSpace: 'nowrap' }}>{abierta ? '▾ cerrar' : '▸ ver detalle'}</span>}
            </div>
            {abre && abierta && <div style={{ margin: '0 0 12px 54px', padding: '12px 14px', background: '#FAFAFA', border: `1px solid ${LGT}`, borderRadius: R }}>{detalle!()}</div>}
        </div>
    );
}

/** Desplegable de una alerta por fuente: la acción sugerida, quién (asesores) y dónde (publicaciones). */
function DetalleAlerta({ d, fuente, red }: { d: DetalleFuente | undefined; fuente: Fila | undefined; red?: boolean }) {
    if (!d) return <div style={{ fontSize: 12, color: GRY }}>Calculando el detalle…</div>;
    // sin respuesta = la de WhatsApp/formulario (la de teléfono no es medible: la llamada no se registra)
    const totSin = fuente?.sinRespuestaWa || d.asesores.reduce((a, x) => a + x.sinRespuestaWa, 0) || 1;
    const base = fuente?.pctSinRespuestaWa ?? null;
    const acciones: string[] = [];
    const top = d.asesores.filter((a) => a.sinRespuestaWa > 0).slice(0, 2);
    const shareTop = top.reduce((a, x) => a + x.sinRespuestaWa, 0) / totSin;
    if (top.length && shareTop > 0.5) acciones.push(`Habla con ${top.map((a) => a.nombre).join(' y ')}: ${top.length === 1 ? 'concentra' : 'concentran'} el ${Math.round(100 * shareTop)}% de los leads sin respuesta.`);
    // si los asesores SÍ contestan, decirlo: el problema es el lead, no la atención (NURA, oct-2026)
    if (!red && (fuente?.pctSinResp ?? 100) <= 5 && (fuente?.pctSinRespuestaWa ?? 0) >= 30)
        acciones.push(`Los asesores sí contestan (${fuente?.pctSinResp}% sin responder en horario, 1ª respuesta ${mins(fuente?.respMed)}): el que no contesta es el cliente. Es un tema de calidad del lead, no de atención.`);
    if ((fuente?.pctSoloClic ?? 0) >= 70) acciones.push(`El portal manda sólo el clic en el ${fuente?.pctSoloClic}% de los leads: que el asesor escriba primero por WhatsApp en los primeros minutos, y revisarlo con el portal.`);
    const p0 = d.pubs[0];
    if (p0 && fuente && fuente.leads && p0.leads / fuente.leads >= 0.2) acciones.push(`La publicación ${p0.codigo ?? '(sin código)'} concentra ${p0.leads} leads (${Math.round((100 * p0.leads) / fuente.leads)}%): revisar si es spam o un precio muy atractivo.`);
    const lento = d.asesores.filter((a) => a.leads >= 5 && (a.pctSinResp ?? 0) >= 20).slice(0, 3);
    if (lento.length) acciones.push(`Sin contestar en horario (8 am – 8 pm): ${lento.map((a) => `${a.nombre} (${a.pctSinResp}%)`).join(', ')}.`);
    const sinWa = d.asesores.filter((a) => a.whatsapp === false && a.leads >= 5).slice(0, 4);
    if (sinWa.length) acciones.push(`Sin WhatsApp vinculado (Pulppo no ve sus chats): ${sinWa.map((a) => a.nombre).join(', ')}.`);
    const th: CSSProperties = { textAlign: 'right', fontSize: 10, color: '#777', fontWeight: 700, padding: '4px 6px', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase' };
    const th0: CSSProperties = { ...th, textAlign: 'left' };
    const c: CSSProperties = { ...td, padding: '4px 6px', fontSize: 11.5 };
    const c0: CSSProperties = { ...td0, padding: '4px 6px', fontSize: 11.5 };
    return (
        <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>Qué hacer</div>
            {acciones.length ? acciones.map((t, i) => <div key={i} style={{ fontSize: 12, margin: '2px 0' }}>→ {t}</div>) : <div style={{ fontSize: 12, color: '#666' }}>No hay un responsable claro: el cambio está repartido.</div>}
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '12px 0 4px' }}>{red ? 'Por asesor (toda la red)' : 'Por asesor'}</div>
            <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
                <thead><tr><th style={th0}>Asesor</th><th style={th}>Leads</th><th style={th}>Sin respuesta · WhatsApp</th><th style={th}>Aporta</th><th style={th}>Asesor sin responder</th><th style={th}>1ª respuesta</th><th style={th}>WhatsApp</th></tr></thead>
                <tbody>{d.asesores.map((a) => {
                    const alto = base != null && a.pctSinRespuestaWa != null && a.baseWa >= 5 && a.pctSinRespuestaWa >= base + 15;
                    return (
                        <tr key={a.key}>
                            <td style={{ ...c0, color: alto ? RED : BLK, fontWeight: alto ? 700 : 400 }}>{a.nombre}</td>
                            <td style={c}>{f0(a.leads)}</td>
                            <td style={{ ...c, color: alto ? RED : BLK }}>{pc(a.pctSinRespuestaWa)}</td>
                            <td style={c}>{Math.round((100 * a.sinRespuestaWa) / totSin)}%</td>
                            <td style={{ ...c, color: (a.pctSinResp ?? 0) >= 20 ? RED : BLK }}>{pc(a.pctSinResp)}</td>
                            <td style={c}>{mins(a.respMed)}</td>
                            <td style={{ ...c, color: a.whatsapp === false ? RED : '#777' }}>{a.whatsapp == null ? '—' : a.whatsapp ? 'vinculado' : 'sin vincular'}</td>
                        </tr>
                    );
                })}</tbody>
            </table></div>
            {d.pubs.length > 0 && <>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '12px 0 4px' }}>Publicaciones con más leads</div>
                <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
                    <thead><tr><th style={th0}>Propiedad</th><th style={th0}>Inmobiliaria</th><th style={th}>Leads</th><th style={th}>Sólo el clic</th><th style={th}>Sin respuesta visible</th></tr></thead>
                    <tbody>{d.pubs.map((p) => (
                        <tr key={p.pid}>
                            <td style={c0}>{p.codigo ? <a href={`/ficha/${encodeURIComponent(p.codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>{p.codigo}</a> : '—'}</td>
                            <td style={c0}>{p.inmo ?? '—'}</td>
                            <td style={c}>{f0(p.leads)}</td>
                            <td style={c}>{pc(p.pctSoloClic)}</td>
                            <td style={c}>{pc(p.pctSinRespuesta)}</td>
                        </tr>
                    ))}</tbody>
                </table></div>
            </>}
        </div>
    );
}

/** Desplegable de «Posible spam en una publicación». */
function DetalleSpam({ x }: { x: SpamPub }) {
    return (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>Qué hacer</div>
            <div>→ Revisar la publicación {x.codigo ? <a href={`/ficha/${encodeURIComponent(x.codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>{x.codigo}</a> : ''}: ¿el precio o la foto la hacen viral, o los leads son de cuentas en serie?</div>
            <div>→ Pedirle al asesor que escriba a 5 de esos contactos: si casi nadie contesta, es tráfico de baja intención.</div>
            <div>→ Si se confirma, mandar la lista al portal ({x.fuente}) con hora y teléfono para que lo revise, como se hizo con MercadoLibre.</div>
            <div style={{ marginTop: 8, color: '#666' }}>Señales: {x.senales.join(' · ')}. {x.prev ? `Periodo anterior: ${x.prev} leads.` : ''}</div>
        </div>
    );
}

function Aviso({ children }: { children: ReactNode }) {
    return <div style={{ border: `1px solid ${LGT}`, borderLeft: `3px solid ${YEL}`, padding: '9px 12px', borderRadius: R, fontSize: 11.5, lineHeight: 1.5, color: '#444', marginTop: 10 }}>{children}</div>;
}

const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
const th0: CSSProperties = { ...th, textAlign: 'left' };
const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const td0: CSSProperties = { ...td, textAlign: 'left' };

function Tabla({ head, children, min = 760 }: { head: string[]; children: ReactNode; min?: number }) {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: min }}>
                <thead><tr>{head.map((h, i) => <th key={h + i} style={i ? th : th0}>{h}</th>)}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

/** Embudo horizontal del total: únicos → visitas → ofertas → cierres. */
function Embudo({ t, c }: { t: Fila; c: Fila | null }) {
    const pasos: Array<[string, number, number | null, number | null]> = [
        ['Leads únicos', t.unicos, null, c?.unicos ?? null],
        ['Visitaron', t.visitas, t.pVisita, c?.visitas ?? null],
        ['Ofertaron', t.ofertas, t.pOferta, c?.ofertas ?? null],
        ['Cerraron', t.cierres, t.pCierre, c?.cierres ?? null],
    ];
    const max = Math.max(t.unicos, 1);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
            {pasos.map(([l, n, p, cn]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', fontSize: 12 }}>
                    <span style={{ width: 92, fontWeight: 700 }}>{l}</span>
                    <span style={{ flex: 1, background: LGT, height: 18, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max((100 * n) / max, 0.5)}%`, background: SEA }} />
                    </span>
                    <span style={{ width: 70, textAlign: 'right', fontWeight: 700 }}>{f0(n)}</span>
                    <span style={{ width: 64, textAlign: 'right', color: '#666' }}>{p != null ? `${p}%` : ''}</span>
                    <span style={{ width: 60, textAlign: 'right', fontSize: 11 }}><Delta a={n} b={cn} /></span>
                </div>
            ))}
        </div>
    );
}

export default function InmobiliariasTab({ section = 'inmobiliarias', op, setOp }: {
    section?: SeccionV2;
    /** venta/renta compartido con el pulso (lo controla el contenedor) */
    op?: Op; setOp?: (o: Op) => void;
}) {
    const hoy = useMemo(hoyMx, []);
    const mesActual = iso(hoy).slice(0, 7);
    // Si el mes / trimestre en curso apenas empezó (<7 días), el default es el último completo:
    // el 1 de octubre, "T4" es un día y no dice nada.
    const iniMes = hoy.getUTCDate() < 7 ? iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1))).slice(0, 7) : mesActual;
    const qHoy = Math.floor(hoy.getUTCMonth() / 3) + 1;
    const diasQ = (hoy.getTime() - Date.UTC(hoy.getUTCFullYear(), (qHoy - 1) * 3, 1)) / 86400000;
    const [iniAnioQ, iniQ] = diasQ < 7 ? (qHoy === 1 ? [hoy.getUTCFullYear() - 1, 4] : [hoy.getUTCFullYear(), qHoy - 1]) : [hoy.getUTCFullYear(), qHoy];
    const ini: Filtros = {
        inmo: '', asesor: '', op: 'todas', modo: 'mes', mes: iniMes,
        anioQ: iniAnioQ, q: iniQ,
        rDesde: iso(new Date(hoy.getTime() - 29 * 86400000)), rHasta: iso(hoy), comparar: 'anterior',
    };
    const [bRaw, setB] = useState<Filtros>(ini);
    const b = useMemo<Filtros>(() => (op ? { ...bRaw, op } : bRaw), [bRaw, op]);
    const [ops, setOps] = useState<Opcion[]>([]);
    const [asesores, setAsesores] = useState<Asesor[]>([]);
    const [v, setV] = useState<InmoView | null>(null);
    // detalle de los desplegables de «Para atender»: se pide UNA vez por periodo al abrir el primero
    const [det, setDet] = useState<{ q: string; d: Record<string, DetalleFuente> | null } | null>(null);
    const qDet = v ? new URLSearchParams({ view: 'detalle', desde: v.filtro.desde, hasta: v.filtro.hasta, operacion: v.filtro.operacion,
        ...(v.filtro.inmobiliaria ? { inmo: v.filtro.inmobiliaria } : {}), ...(v.filtro.asesorId ? { asesor: v.filtro.asesorId } : {}) }).toString() : '';
    const pedirDetalle = useCallback(() => {
        if (!qDet || det?.q === qDet) return;
        setDet({ q: qDet, d: null });
        fetch(`/api/portales/inmobiliarias?${qDet}`).then((r) => r.json())
            .then((j) => setDet({ q: qDet, d: j.detalle ?? {} })).catch(() => setDet({ q: qDet, d: {} }));
    }, [qDet, det?.q]);
    const detD = det?.q === qDet ? det.d : null;
    const [cargando, setCargando] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/portales/inmobiliarias?view=opciones').then((r) => r.json()).then((j) => setOps(j.inmobiliarias ?? [])).catch(() => {});
    }, []);
    useEffect(() => {
        setAsesores([]);
        if (!b.inmo) return;
        fetch(`/api/portales/inmobiliarias?view=asesores&inmo=${encodeURIComponent(b.inmo)}`)
            .then((r) => r.json()).then((j) => setAsesores(j.asesores ?? [])).catch(() => {});
    }, [b.inmo]);

    const ctrl = useRef<AbortController | null>(null);
    const consultar = useCallback((f: Filtros, refresh = false) => {
        const { desde, hasta } = periodo(f);
        if (!desde || !hasta || desde > hasta) { setErr('El periodo termina antes de empezar.'); return; }
        ctrl.current?.abort();                      // la consulta anterior ya no importa
        const c = new AbortController(); ctrl.current = c;
        setCargando(true); setErr(null);
        const q = new URLSearchParams({ view: 'datos', desde, hasta, operacion: f.op, comparar: f.comparar });
        if (f.inmo) q.set('inmo', f.inmo);
        if (f.inmo && f.asesor) q.set('asesor', f.asesor);
        if (refresh) q.set('refresh', '1');
        fetch(`/api/portales/inmobiliarias?${q}`, { signal: c.signal })
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { if (ctrl.current === c) setV(j); })
            .catch((e) => { if (ctrl.current === c && e?.name !== 'AbortError') setErr(String(e)); })
            .finally(() => { if (ctrl.current === c) setCargando(false); });
    }, []);
    // Vista predeterminada al entrar + cada cambio de filtro actualiza solo.
    useEffect(() => {
        const t = setTimeout(() => consultar(b), b.modo === 'rango' ? 900 : 300);
        return () => clearTimeout(t);
    }, [b, consultar]);
    useEffect(() => () => ctrl.current?.abort(), []);

    // Inversión (del Sheet, mensual) para el periodo y el comparado. Sólo se pide en «Inversión y retorno».
    const [inv, setInv] = useState<{ key: string; a: InversionRango | null; c: InversionRango | null } | null>(null);
    const [deal, setDeal] = useState<{ mes: string; d: DealMes | null } | null>(null);
    const [mesDeal, setMesDeal] = useState<string>('');
    useEffect(() => {
        if ((section !== 'inversion' && section !== 'resumen') || !v) return;
        const ma = mesesDe(v.actual.desde, v.actual.hasta), mc = v.comparado ? mesesDe(v.comparado.desde, v.comparado.hasta) : [];
        const key = `${ma.join(',')}|${mc.join(',')}`;
        if (inv?.key === key) return;
        const pedir = (ms: string[]) => ms.length
            ? fetch(`/api/portales?view=inversion&desde=${ms[0]}&hasta=${ms[ms.length - 1]}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            : Promise.resolve(null);
        setInv({ key, a: null, c: null });
        Promise.all([pedir(ma), pedir(mc)]).then(([a, c]) => setInv({ key, a, c }));
        setMesDeal((prev) => (ma.includes(prev) ? prev : (ma.filter((m) => m < iso(hoy).slice(0, 7)).pop() ?? ma[ma.length - 1])));
    }, [section, v, inv?.key, hoy]);
    // Alertas de la semana (pulso) para el Resumen.
    const [alertasSemana, setAlertasSemana] = useState<{ op: string; a: Array<{ sev: 'alta' | 'media'; txt: string }> } | null>(null);
    useEffect(() => {
        if (section !== 'resumen' || alertasSemana?.op === b.op) return;
        setAlertasSemana({ op: b.op, a: [] });
        fetch(`/api/portales?view=pulso&operacion=${b.op}`).then((r) => (r.ok ? r.json() : null))
            .then((j) => setAlertasSemana({ op: b.op, a: j?.alerts ?? [] })).catch(() => {});
    }, [section, b.op, alertasSemana?.op]);
    useEffect(() => {
        if (section !== 'inversion' || !mesDeal || deal?.mes === mesDeal) return;
        setDeal({ mes: mesDeal, d: null });
        fetch(`/api/portales?view=deal&desde=${mesDeal}`).then((r) => (r.ok ? r.json() : null)).then((d) => setDeal({ mes: mesDeal, d })).catch(() => {});
    }, [section, mesDeal, deal?.mes]);
    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };
    const lbl: CSSProperties = { fontSize: 10, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', display: 'block', marginBottom: 3 };
    const pills = <T extends string>(val: T, opts: Array<[T, string]>, set: (x: T) => void) => (
        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
            {opts.map(([k, l]) => (
                <button key={k} onClick={() => set(k)} style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', fontWeight: val === k ? 700 : 400, background: val === k ? BLK : '#fff', color: val === k ? '#fff' : '#555' }}>{l}</button>
            ))}
        </span>
    );
    const set = <K extends keyof Filtros>(k: K, x: Filtros[K]) => {
        if (k === 'op' && setOp) { setOp(x as Op); return; }
        setB((p) => ({ ...p, [k]: x, ...(k === 'inmo' ? { asesor: '' } : {}) }));
    };
    const anios = Array.from({ length: 4 }, (_, i) => hoy.getUTCFullYear() - i);

    const filtros = (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', paddingBottom: 14, borderBottom: `1px solid ${LGT}` }}>
            <div>
                <span style={lbl}>Inmobiliaria</span>
                <select value={b.inmo} onChange={(e) => set('inmo', e.target.value)} style={{ ...inp, fontWeight: 700, maxWidth: 260 }}>
                    <option value="">Todas · vista general</option>
                    {ops.map((o) => <option key={o.nombre} value={o.nombre} disabled={!o.cuentas}>{o.nombre}{o.cuentas ? '' : ` — ${o.nota ?? 'sin cuenta'}`}</option>)}
                </select>
            </div>
            {b.inmo && (
                <div>
                    <span style={lbl}>Asesor</span>
                    <select value={b.asesor} onChange={(e) => set('asesor', e.target.value)} style={{ ...inp, maxWidth: 220 }}>
                        <option value="">Todos</option>
                        {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.activo ? '' : ' (inactivo)'}</option>)}
                    </select>
                </div>
            )}
            <div><span style={lbl}>Operación</span>{pills(b.op, [['todas', 'Todo'], ['sale', 'Venta'], ['rent', 'Renta']], (x) => set('op', x))}</div>
            <div>
                <span style={lbl}>Periodo</span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {pills(b.modo, [['mes', 'Mes'], ['trimestre', 'Trimestre'], ['ytd', 'YTD'], ['rango', 'Fechas']], (x) => set('modo', x))}
                    {b.modo === 'mes' && <input type="month" value={b.mes} max={mesActual} onChange={(e) => set('mes', e.target.value)} style={inp} />}
                    {b.modo === 'trimestre' && (<>
                        <select value={b.q} onChange={(e) => set('q', Number(e.target.value))} style={inp}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>T{q}</option>)}</select>
                        <select value={b.anioQ} onChange={(e) => set('anioQ', Number(e.target.value))} style={inp}>{anios.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                    </>)}
                    {b.modo === 'rango' && (<>
                        <input type="date" value={b.rDesde} max={b.rHasta} onChange={(e) => set('rDesde', e.target.value)} style={inp} />
                        <span style={{ color: GRY, fontSize: 12 }}>a</span>
                        <input type="date" value={b.rHasta} min={b.rDesde} max={iso(hoy)} onChange={(e) => set('rHasta', e.target.value)} style={inp} />
                    </>)}
                </span>
            </div>
            <div><span style={lbl}>Comparar contra</span>{pills(b.comparar, [['ninguno', 'Nada'], ['anterior', 'Periodo anterior'], ['anio', 'Año pasado']], (x) => set('comparar', x))}</div>
            {cargando
                ? <span style={{ fontSize: 11.5, color: '#8A6D00', fontWeight: 700, alignSelf: 'center' }}>Actualizando…</span>
                : <button onClick={() => consultar(b, true)} title="Vuelve a consultar Mongo sin usar la caché de 10 min" style={{ ...inp, cursor: 'pointer', fontSize: 11 }}>Recargar</button>}
            {(b.inmo || b.asesor || b.op !== 'todas' || b.modo !== 'mes' || b.mes !== ini.mes || b.comparar !== 'anterior') && (
                <button onClick={() => { setB(ini); setOp?.('todas'); }} style={{ ...inp, cursor: 'pointer', fontSize: 11, color: '#666' }}>Vista predeterminada</button>
            )}
        </div>
    );

    const head = (
        <>
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>{TITULOS[section][0]}</h1>
            <div style={{ fontSize: 12.5, color: '#666', marginBottom: 14 }}>
                {TITULOS[section][1]} Los filtros son los mismos en estas cinco secciones y se aplican solos.
            </div>
            {filtros}
        </>
    );

    if (err) return <>{head}<div style={{ marginTop: 16, color: RED, fontSize: 13 }}>No pude calcularlo: {err}</div></>;
    if (!v) return (
        <>{head}
            <div style={{ marginTop: 20, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                Consultando Mongo… la vista general de un mes tarda unos segundos; un trimestre o YTD de toda la red puede tardar un par de minutos la primera vez (después queda en caché 10 min).
            </div>
        </>
    );

    const A: Bloque = v.actual, C: Bloque | null = v.comparado;
    const T = A.total, CT = C?.total ?? null;
    const buscar = (xs: Fila[] | undefined, k: string) => xs?.find((x) => x.key === k) ?? null;
    const cmpTxt = C ? (v.filtro.comparar === 'anio' ? 'vs. año pasado' : 'vs. periodo anterior') : '';
    const diasDesdeFin = (Date.now() - new Date(A.hasta).getTime()) / 86400000;
    const recienteCohorte = diasDesdeFin < 120;
    // El descarte madura: comparar el % de un periodo que cerró hace días contra uno de hace un año
    // da "−100 pts" en verde, que no es una mejora sino falta de tiempo. Hasta 45 días, sin Δ.
    const descMaduro = diasDesdeFin >= 45;

    const filaFunnel = (x: Fila, c: Fila | null, extra?: ReactNode) => (
        <tr key={x.key}>
            <td style={td0}>{x.nombre}{extra}</td>
            <td style={td}>{f0(x.leads)}{c && <div style={{ fontSize: 10 }}><Delta a={x.leads} b={c.leads} /></div>}</td>
            <td style={td}>{f0(x.unicos)}</td>
            <td style={td}>{pc(x.pVisita)}{c && <div style={{ fontSize: 10 }}><Delta a={x.pVisita} b={c.pVisita} pts /></div>}</td>
            <td style={td}>{pc(x.pOferta)}</td>
            <td style={td}>{pc(x.pCierre)}</td>
            <td style={td}>{f0(x.visitas)}</td>
            <td style={td}>{f0(x.ofertas)}</td>
            <td style={td}>{f0(x.cierres)}{c && <div style={{ fontSize: 10 }}><Delta a={x.cierres} b={c.cierres} /></div>}</td>
            <td style={td}>{pc(x.pctLt60)}</td>
            <td style={td}>{mins(x.respMed)}</td>
        </tr>
    );
    const HEAD_FUNNEL = ['Fuente', 'Leads', 'Únicos', '% visita', '% oferta', '% cierre', 'Visitas', 'Ofertas', 'Cierres', '< 60 min', '1ª resp.'];
    const tsvFunnel = (xs: Fila[], primera: string) => copiar([[primera, ...HEAD_FUNNEL.slice(1)],
        ...xs.map((x) => [x.nombre, x.leads, x.unicos, x.pVisita, x.pOferta, x.pCierre, x.visitas, x.ofertas, x.cierres, x.pctLt60, x.respMed])]);

    const filaCalidad = (x: Fila, c: Fila | null) => (
        <tr key={x.key}>
            <td style={td0}>{x.nombre}{x.nota && <div style={{ fontSize: 10, color: GRY }}>{x.nota}</div>}</td>
            <td style={td}>{f0(x.leads)}</td>
            <td style={td}>{pc(x.pctConConversacion)}{c && <div style={{ fontSize: 10 }}><Delta a={x.pctConConversacion} b={c.pctConConversacion} pts /></div>}</td>
            <td style={{ ...td, fontWeight: 700, color: (x.pctSinRespuesta ?? 0) >= 30 ? RED : BLK }}>{pc(x.pctSinRespuesta)}{c && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={x.pctSinRespuesta} b={c.pctSinRespuesta} pts invertir /></div>}</td>
            <td style={{ ...td, color: (x.pctFantasma ?? 0) >= 3 ? RED : BLK }}>{pc(x.pctFantasma)}</td>
            <td style={{ ...td, fontWeight: 700, color: (x.pctSinRespuestaWa ?? 0) >= 30 ? RED : BLK }}>{pc(x.pctSinRespuestaWa)}<div style={{ fontSize: 10, fontWeight: 400, color: GRY }}>de {f0(x.baseWa)}</div>{c && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={x.pctSinRespuestaWa} b={c.pctSinRespuestaWa} pts invertir /></div>}</td>
            <td style={{ ...td, color: '#666' }}>{pc(x.pctSinRespuestaTel)}<div style={{ fontSize: 10, color: GRY }}>de {f0(x.baseTel)}</div></td>
            <td style={{ ...td, color: '#666' }}>{pc(x.pctSoloClic)}</td>
            <td style={td}>{pc(x.pctDescartado)}{c && descMaduro && <div style={{ fontSize: 10 }}><Delta a={x.pctDescartado} b={c.pctDescartado} pts invertir /></div>}</td>
            <td style={td}>{pc(x.pctSinResp)}</td>
        </tr>
    );
    const HEAD_CAL = ['', 'Leads', 'Con conversación', 'Sin respuesta visible', 'Fantasma', 'Sin resp. · WhatsApp', 'Por teléfono (sin contacto visible)', 'Llegó sólo el clic', 'Descartados', 'Asesor sin responder'];
    // Calidad del lead por fuente: % y Δ en pts; la celda va en rojo cuando dispara la misma red flag de «Para atender».
    const pv = (n: number | null | undefined) => n ?? 0;
    const QCOLS: Array<{ h: string; v: (x: Fila) => number | null | undefined; flag: (x: Fila, c: Fila) => boolean; madura?: boolean }> = [
        { h: 'Sin contacto', v: (x) => x.pctSinContacto, flag: (x, c) => pv(x.pctSinContacto) - pv(c.pctSinContacto) >= 3 },
        { h: 'Fantasma', v: (x) => x.pctFantasma, flag: (x, c) => pv(x.pctFantasma) - pv(c.pctFantasma) >= 5 },
        { h: 'Sólo el clic', v: (x) => x.pctSoloClic, flag: (x, c) => pv(x.pctSoloClic) - pv(c.pctSoloClic) >= 8 },
        { h: 'Sin respuesta · WhatsApp', v: (x) => x.pctSinRespuestaWa, flag: (x, c) => pv(x.pctSinRespuestaWa) - pv(c.pctSinRespuestaWa) >= 8 },
        { h: 'Descartados', v: (x) => x.pctDescartado, flag: (x, c) => pv(x.pctDescartado) - pv(c.pctDescartado) >= 8, madura: true },
        { h: 'Brokers', v: (x) => x.pctBroker, flag: (x, c) => pv(x.pctBroker) - pv(c.pctBroker) >= 8 },
        // las ráfagas son normales en i24/MeLi (los portales mandan leads en tandas): dato, no alarma; sólo
        // cuentan como una de las señales de «posible spam» (Ale, 14-oct-2026)
        { h: 'Ráfagas', v: (x) => x.pctRafaga, flag: () => false },
        { h: 'Madrugada', v: (x) => x.pctMadrugada, flag: (x, c) => pv(x.pctMadrugada) >= 8 && pv(x.pctMadrugada) >= 1.8 * pv(c.pctMadrugada) },
        { h: 'Correos con dígitos', v: (x) => x.pctMailDigitos, flag: (x, c) => pv(x.pctMailDigitos) - pv(c.pctMailDigitos) >= 15 },
        { h: 'Contactos nuevos', v: (x) => x.pctContactoNuevo, flag: (x, c) => pv(x.pctContactoNuevo) - pv(c.pctContactoNuevo) >= 15 },
    ];
    const filaQ = (x: Fila, c: Fila | null) => (
        <tr key={'q' + x.key}>
            <td style={td0}>{x.nombre}</td>
            <td style={td}>{f0(x.leads)}</td>
            {QCOLS.map((q) => {
                const roja = !!c && x.leads >= 100 && (!q.madura || descMaduro) && q.flag(x, c);
                return (
                    <td key={q.h} style={{ ...td, color: roja ? RED : BLK, fontWeight: roja ? 700 : 400 }}>{pc(q.v(x) ?? null)}
                        {c && (!q.madura || descMaduro) && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={q.v(x) ?? null} b={q.v(c) ?? null} pts invertir /></div>}</td>
                );
            })}
        </tr>
    );

    const filaEquipo = (x: Fila, c: Fila | null) => (
        <tr key={x.key}>
            <td style={td0}>{x.nombre}{x.nota && <div style={{ fontSize: 10, color: GRY }}>{x.nota}</div>}</td>
            <td style={td}>{f0(x.leads)}{c && <div style={{ fontSize: 10 }}><Delta a={x.leads} b={c.leads} /></div>}</td>
            <td style={{ ...td0, color: '#666' }}>{x.topFuente ?? '—'}</td>
            <td style={td}>{pc(x.pVisita)}</td>
            <td style={td}>{f0(x.visitas)}</td>
            <td style={td}>{f0(x.cierres)}</td>
            <td style={td}>{pc(x.pctLt60)}</td>
            <td style={td}>{mins(x.respMed)}</td>
            <td style={td}>{pc(x.pctSinRespuestaWa)}</td>
            <td style={td}>{pc(x.pctDescartado)}</td>
            <td style={{ ...td, color: (x.pctDescSinSeg ?? 0) >= 75 ? RED : BLK }}>{pc(x.pctDescSinSeg)}</td>
        </tr>
    );
    const HEAD_EQ = ['', 'Leads', 'Fuente #1', '% visita', 'Visitas', 'Cierres', '< 60 min', '1ª resp.', 'Sin resp. · WhatsApp', 'Descartados', 'Desc. sin toque'];
    const tsvEquipo = (xs: Fila[], primera: string) => copiar([[primera, ...HEAD_EQ.slice(1), 'Nota'],
        ...xs.map((x) => [x.nombre, x.leads, x.topFuente, x.pVisita, x.visitas, x.cierres, x.pctLt60, x.respMed, x.pctSinRespuestaWa, x.pctDescartado, x.pctDescSinSeg, x.nota])]);

    const ladoColor: Record<Cierre['lado'], string> = { ambos: SEA, vendedor: BLK, comprador: '#8A6D00' };

    // ── Inversión y retorno: une leads (cohorte del periodo), cierres del periodo e inversión ──
    const nombreCierre = (n: string) => A.cierres.porFuente.find((x) => x.fuente === n);
    const ia = inv?.a ?? null, ic = inv?.c ?? null;
    const invDe = (r: InversionRango | null, k: string): number | null | undefined => {
        if (!r) return undefined;
        if (k in r.porCanal) return r.porCanal[k];
        return SIN_COSTO.has(k) ? 0 : undefined;
    };
    const sinCostoReal = v.filtro.operacion !== 'todas' || !!v.inmobiliaria;
    // Con un mes sin cargar en el Sheet, el total sólo tendría MeLi: no se muestra un total engañoso.
    const faltaInv = !!ia?.faltantes.length;
    const periodoParcial = (() => {
        const d0 = v.actual.desde, d1 = v.actual.hasta;
        const finMes = new Date(Date.UTC(Number(d1.slice(0, 4)), Number(d1.slice(5, 7)), 0)).toISOString().slice(0, 10);
        return !d0.endsWith('-01') || (d1 !== finMes && d1 !== iso(hoy));
    })();
    const mesEnCurso = v.actual.hasta === iso(hoy) && !periodoParcial;
    const filasInv = A.fuentes.map((f) => {
        const k = f.key.slice(2);
        const ci = nombreCierre(f.nombre), cc = C ? C.cierres.porFuente.find((x) => x.fuente === f.nombre) : undefined;
        const invA = invDe(ia, k), invC = invDe(ic, k);
        const reg = ci?.regalia ?? 0, regC = cc?.regalia ?? 0;
        return {
            k, nombre: f.nombre, leads: f.leads, inv: invA, cierres: ci?.n ?? 0, regalia: reg,
            cpl: invA && f.leads ? invA / f.leads : null, cpa: invA && ci?.n ? invA / ci.n : null,
            roi: invA ? reg / invA : null, roiC: invC && C ? regC / invC : null,
        };
    });
    const conInv = filasInv.filter((x) => typeof x.inv === 'number' && x.inv > 0);
    const totInv = conInv.reduce((a, x) => a + (x.inv as number), 0);
    const totLeadsInv = conInv.reduce((a, x) => a + x.leads, 0);
    const totRegInv = conInv.reduce((a, x) => a + x.regalia, 0);
    const otrasFuentesCierre = A.cierres.porFuente.filter((x) => !A.fuentes.some((f) => f.nombre === x.fuente));
    const mesesA = mesesDe(A.desde, A.hasta);

    const FAM = A.descarte.familias.map((x) => [x.key, x.label] as const);

    return (
        <>
            {head}
            <div style={{ opacity: cargando ? 0.45 : 1, transition: 'opacity .15s', pointerEvents: cargando ? 'none' : 'auto' }}>
            <div style={{ marginTop: 16, fontSize: 13 }}>
                <b>{v.inmobiliaria ? v.inmobiliaria.nombre : 'Toda la red'}</b>
                {v.inmobiliaria?.kam && <span style={{ color: '#666' }}> · KAM {v.inmobiliaria.kam}{v.inmobiliaria.tier ? ` · ${v.inmobiliaria.tier}` : ''}</span>}
                {v.filtro.asesorId && <span style={{ color: '#666' }}> · {asesores.find((a) => a.id === v.filtro.asesorId)?.nombre ?? 'un asesor'}</span>}
                {v.filtro.operacion !== 'todas' && <span style={{ color: '#666' }}> · sólo {v.filtro.operacion === 'sale' ? 'venta' : 'renta'}</span>}
                <span style={{ color: '#666' }}> · {A.etiqueta}</span>
                {C && <span style={{ color: GRY }}> · comparado con {C.etiqueta}</span>}
                {v.inmobiliaria && v.inmobiliaria.cuentas > 1 && <div style={{ fontSize: 11, color: GRY, marginTop: 3 }}>La cuenta está partida en {v.inmobiliaria.cuentas} compañías con el mismo nombre en Pulppo; aquí se suman todas.</div>}
            </div>


            {section === 'resumen' && (() => {
                const roiTot = !sinCostoReal && !periodoParcial && !faltaInv && totInv ? totRegInv / totInv : null;
                const pctD = (a: number, b?: number | null) => (b ? Math.round(((a - b) / b) * 100) : null);
                const signo = (n: number | null, suf = '%') => (n == null ? '' : `${n > 0 ? '+' : ''}${n}${suf}`);
                const cmp = C ? (v.filtro.comparar === 'anio' ? 'que el año pasado' : 'que el periodo anterior') : '';
                // canal que más movió el volumen
                const mov = C ? A.fuentes.map((f) => ({ f, c: buscar(C.fuentes, f.key) })).filter((x) => x.c)
                    .map((x) => ({ n: x.f.nombre, d: x.f.leads - x.c!.leads })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0] : null;
                const conv = C ? A.fuentes.filter((f) => f.unicos >= 200).map((f) => ({ f, c: buscar(C.fuentes, f.key) }))
                    .filter((x) => x.c && x.c.pVisita != null && x.f.pVisita != null)
                    .map((x) => ({ n: x.f.nombre, d: Math.round(((x.f.pVisita as number) - (x.c!.pVisita as number)) * 10) / 10, v: x.f.pVisita }))
                    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0] : null;
                const topReg = [...A.cierres.porFuente].sort((a, b) => b.regalia - a.regalia)[0];
                const lineas: Array<[string, ReactNode]> = [
                    ['Volumen', <>Entraron <b>{f0(T.leads)}</b> leads ({f0(T.unicos)} personas){C ? <>, <b>{signo(pctD(T.leads, CT?.leads))}</b> {cmp}</> : null}.{mov && mov.d !== 0 ? <> El que más lo movió: <b>{mov.n}</b> ({mov.d > 0 ? '+' : ''}{f0(mov.d)}).</> : null}</>],
                    ['Conversión', <>Visitó el <b>{pc(T.pVisita)}</b> de las personas{C && T.pVisita != null && CT?.pVisita != null ? <> ({signo(Math.round((T.pVisita - CT.pVisita) * 10) / 10, ' pts')} {cmp})</> : null}.{conv && Math.abs(conv.d) >= 1 ? <> Mayor cambio: <b>{conv.n}</b> {signo(conv.d, ' pts')} (hoy {pc(conv.v)}).</> : null}{recienteCohorte ? ' Los cierres de esta cohorte todavía están madurando.' : ''}</>],
                    ['Resultado', <>Cerraron <b>{f0(A.cierres.n)}</b> operaciones con <b>{money(A.cierres.regalia)}</b> de regalía{C ? <> ({signo(pctD(A.cierres.regalia, C.cierres.regalia))})</> : null}{topReg ? <>; la fuente que más aportó fue <b>{topReg.fuente}</b> ({money(topReg.regalia)})</> : null}.{roiTot != null ? <> ROI de los canales pagados: <b>{roiTot.toFixed(2)}×</b>.</> : null}</>],
                    ['Calidad', <><b>{pc(T.pctBroker)}</b> de los leads vienen de brokers y de los que escribieron por WhatsApp, en el <b>{pc(T.pctSinRespuestaWa)}</b> el cliente no volvió a escribir{C && T.pctSinRespuestaWa != null && CT?.pctSinRespuestaWa != null ? <> ({signo(Math.round((T.pctSinRespuestaWa - CT.pctSinRespuestaWa) * 10) / 10, ' pts')})</> : null}. Primera respuesta mediana: <b>{mins(T.respMed)}</b>.</>],
                ];
                // Las alertas del pulso son de la última semana: sólo vienen al caso si el periodo la incluye.
                const incluyeSemana = (Date.now() - new Date(A.hasta).getTime()) / 86400000 <= 14;
                const flags = senales(A, C, C ? cmp : '', iso(hoy));
                // alertas generales (la semana, el Sheet) + red flags agrupadas por fuente
                const generales: Array<{ sev: 'alta' | 'media'; txt: string }> = [
                    ...(incluyeSemana ? alertasSemana?.a ?? [] : []),
                    ...(faltaInv && ia ? [{ sev: 'media' as const, txt: `Falta cargar la inversión de ${ia.faltantes.map(mesLargo).join(', ')} en el Sheet: CPL y ROI quedan en s/d.` }] : []),
                ];
                const conFlag = new Set(flags.map((x) => x.fuente));
                const grupos = porFuente([
                    ...flags,
                    // nivel alto sostenido (no un cambio): sólo si la fuente no tiene ya otra señal
                    ...A.fuentes.filter((f) => f.baseWa >= 200 && (f.pctSinRespuestaWa ?? 0) >= 50 && !conFlag.has(f.nombre))
                        .map((f) => ({ sev: 'media' as const, fuente: f.nombre, txt: `De los que escribieron por WhatsApp, en el ${pc(f.pctSinRespuestaWa)} el cliente no volvió a escribir.` })),
                ], A.fuentes.map((f) => f.nombre));
                const atender = [...generales.filter((x) => x.sev === 'alta'), ...generales.filter((x) => x.sev === 'media')];
                // cada alerta por fuente abre su detalle: quién (asesores) y dónde (publicaciones)
                const filaGrupo = (g: (typeof grupos)[number]) => {
                    const fk = A.fuentes.find((x) => x.nombre === g.fuente);
                    return <FilaFlag key={g.fuente + (g.spam ? '|s' : '')} sev={g.sev} titulo={g.fuente} items={g.items} spam={g.spam}
                        onAbrir={fk ? pedirDetalle : undefined}
                        detalle={fk ? () => <DetalleAlerta d={detD?.[fk.key] ?? (detD ? { asesores: [], pubs: [] } : undefined)} fuente={fk} /> : undefined} />;
                };
                const spamPub = A.spamPub ?? [];
                const filaSpam = (x: SpamPub) => (
                    <FilaFlag key={'sp' + x.pid} sev={x.sev} titulo={x.codigo ?? '(sin código)'} etiqueta="Posible spam"
                        items={[`${x.fuente}${x.inmo ? ` · ${x.inmo}` : ''}: ${f0(x.n)} leads — ${x.senales.join(' · ')}`]}
                        detalle={() => <DetalleSpam x={x} />} />
                );
                // los 8 canales con más leads, y siempre las cuentas propias de i24 (NURA, Premier de Diamond House)
                const top = [...A.fuentes.slice(0, 8), ...A.fuentes.slice(8).filter((x) => x.key === 'f:i24nura' || x.key === 'f:i24premier')];
                return (<>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                        <Kpi label="Leads" info={DEF.leads} value={f0(T.leads)} sub={`${f0(T.unicos)} personas`} delta={<Delta a={T.leads} b={CT?.leads} />} />
                        <Kpi label="Lead → visita" info={DEF.visita} value={pc(T.pVisita)} sub={`${f0(T.visitas)} visitaron`} delta={<Delta a={T.pVisita} b={CT?.pVisita} pts />} />
                        <Kpi label="Cierres del periodo" info={DEF.cierresPeriodo} value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
                        <Kpi label="Regalía Pulppo" info={DEF.regalia} value={money(A.cierres.regalia)} delta={<Delta a={A.cierres.regalia} b={C?.cierres.regalia} />} />
                        <Kpi label="ROI" info={DEF.roi} value={roiTot != null ? `${roiTot.toFixed(2)}×` : '—'} sub={roiTot != null ? 'canales pagados' : sinCostoReal ? 'sólo con «Todo» y sin inmobiliaria' : faltaInv ? 'falta la inversión del mes' : periodoParcial ? 'elige meses completos' : '…'} />
                        <Kpi label="Sin respuesta · WhatsApp" info={DEF.sinRespuesta} value={pc(T.pctSinRespuestaWa)} sub={`Por teléfono: ${pc(T.pctSinRespuestaTel)} sin contacto visible (las llamadas al celular del asesor no se registran)`} delta={<Delta a={T.pctSinRespuestaWa} b={CT?.pctSinRespuestaWa} pts invertir />} />
                    </div>
                    <Seccion titulo="Qué cambió">
                        {lineas.map(([k, txt]) => (
                            <div key={k} style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: `1px solid ${LGT}`, fontSize: 13, lineHeight: 1.55 }}>
                                <span style={{ width: 92, flexShrink: 0, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, paddingTop: 2 }}>{k}</span>
                                <span>{txt}</span>
                            </div>
                        ))}
                    </Seccion>
                    <Seccion titulo="Para atender" sub={`Lo que se movió raro por fuente${C ? `, ${cmp}` : ''}, y los días fuera de lo normal.`}
                        info={<>
                            <b>Contra el periodo comparado</b> (fuentes con al menos 100 leads): volumen ×1.5 o −35%; asesor sin responder +5 pts; 1ª respuesta +50% (y +10 min); sin respuesta visible del cliente +8 pts; brokers +8 pts; fantasmas +5 pts; lead → visita −3 pts. Si el volumen se dispara <b>y</b> empeora la atención, sale como una sola alerta alta. <b>Calidad:</b> sin ningún dato de contacto +3 pts; llegan sólo con el clic +8 pts; descartados +8 pts (y qué motivo creció).
                            <p style={{ margin: '6px 0 0' }}><b>Posible spam</b> (va aparte, no es «no responde»): cuando coinciden 2 o más de — ráfagas (leads a ≤2 min de otro a la misma propiedad) ≥3% y el doble que antes; madrugada (0–5 am) ≥8% y 1.8× antes; correos con 4+ dígitos +15 pts; contactos nuevos +15 pts. Alta si coinciden 3 o más.</p>
                            <p style={{ margin: '6px 0 0' }}><b>Posible spam en una publicación</b>: el spam se diluye a nivel portal, así que también se busca por publicación (≥20 leads) cuando coinciden 2 o más de — el triple de leads que el periodo anterior (o publicación nueva); madrugada ≥12%; correos con dígitos ≥40%; contactos nuevos ≥85%; conversa la mitad o menos que su fuente. Alta con 3 o más.</p>
                            <p style={{ margin: '6px 0 0' }}>Haz clic en una alerta para ver <b>quién</b> (asesores) y <b>dónde</b> (publicaciones), con la acción sugerida.</p>
                            <p style={{ margin: '6px 0 0' }}><b>Día por día</b> (fuentes con mediana de 5+ leads diarios): pico = el doble de su mediana; caída = una cuarta parte o menos (suele ser una integración rota o un paquete apagado). El día en curso no cuenta.</p>
                            <p style={{ margin: '6px 0 0' }}>Las de la semana (respuesta, sin responder) salen sólo si el periodo incluye las últimas dos semanas.</p>
                        </>}>
                        {!atender.length && !grupos.length && !(A.spamPub ?? []).length ? <div style={{ fontSize: 12.5, color: GRY }}>{!incluyeSemana || (alertasSemana && alertasSemana.op === b.op) ? 'Nada que atender.' : 'Revisando la semana…'}</div>
                            : <>
                                {grupos.filter((g) => g.sev === 'alta').map((g) => filaGrupo(g))}
                                {spamPub.filter((x) => x.sev === 'alta').map(filaSpam)}
                                {atender.map((x, i) => <FilaFlag key={i} sev={x.sev} titulo="Toda la red" items={[x.txt]} onAbrir={pedirDetalle}
                                    detalle={() => <DetalleAlerta d={detD?.total ?? (detD ? { asesores: [], pubs: [] } : undefined)} fuente={T} red />} />)}
                                {grupos.filter((g) => g.sev === 'media').map((g) => filaGrupo(g))}
                                {spamPub.filter((x) => x.sev === 'media').map(filaSpam)}
                            </>}
                    </Seccion>
                    {A.porDia && <Seccion titulo="Leads por fuente en el tiempo" sub="Cuántos leads entraron de cada fuente y qué parte del total fueron. En vista diaria, los puntos rojos son los días marcados en «Para atender».">
                        <LeadsPorDia A={A} senales={flags} hoy={iso(hoy)} />
                    </Seccion>}
                    <Seccion titulo="Por canal" sub={<>Lo esencial de cada canal. El detalle está en las otras secciones del menú.</>}
                        info={<><b>L/L</b> (leads sobre listing) = leads del periodo ÷ avisos vivos en promedio, llevado a 30 días para comparar periodos de distinto largo. En Inmuebles24 los avisos salen del historial día por día; en MercadoLibre, propiedades.com y Casas y Terrenos no hay historial y se usa la foto de hoy (marcado con *). <b>CPL</b> = inversión ÷ leads. <b>CPV</b> = inversión ÷ visitas de esos leads.</>}>
                        <Tabla head={['Canal', 'Leads', 'L/L', '% visita', 'CPL', 'CPV', 'Cierres', 'Regalía', 'ROI']} min={820}>
                            {top.map((f) => {
                                const fi = filasInv.find((x) => x.k === f.key.slice(2));
                                const c = buscar(C?.fuentes, f.key);
                                const ok = !sinCostoReal && !periodoParcial && !faltaInv;
                                const avC = A.avisos?.canal[f.key.slice(2)];
                                const ll = avC && avC.avisos >= 1 && A.avisos ? (f.leads / avC.avisos) * (30 / A.avisos.dias) : null;
                                const avP = C?.avisos?.canal[f.key.slice(2)];
                                const llC = c && avP && avP.avisos >= 1 && C?.avisos ? (c.leads / avP.avisos) * (30 / C.avisos.dias) : null;
                                const inv = typeof fi?.inv === 'number' && fi.inv > 0 ? fi.inv : null;
                                return (
                                    <tr key={f.key}>
                                        <td style={td0}>{f.nombre}</td>
                                        <td style={td}>{f0(f.leads)}{c && <div style={{ fontSize: 10 }}><Delta a={f.leads} b={c.leads} /></div>}</td>
                                        <td style={td} title={avC ? `${f0(Math.round(avC.avisos))} avisos ${avC.hoy ? 'hoy' : 'vivos en promedio'}` : undefined}>{ll != null ? <>{ll.toFixed(2)}{avC?.hoy ? '*' : ''}</> : '—'}{ll != null && llC != null && <div style={{ fontSize: 10 }}><Delta a={Math.round(ll * 100)} b={Math.round(llC * 100)} /></div>}</td>
                                        <td style={td}>{pc(f.pVisita)}{c && <div style={{ fontSize: 10 }}><Delta a={f.pVisita} b={c.pVisita} pts /></div>}</td>
                                        <td style={td}>{ok && inv && f.leads ? money(inv / f.leads) : '—'}</td>
                                        <td style={td}>{ok && inv && f.visitas ? money(inv / f.visitas) : '—'}</td>
                                        <td style={td}>{f0(fi?.cierres ?? 0)}</td>
                                        <td style={td}>{money(fi?.regalia ?? 0)}</td>
                                        <td style={{ ...td, fontWeight: 700, color: ok && fi?.roi != null ? (fi.roi >= 1 ? SEA : RED) : GRY }}>{ok && fi?.roi != null ? `${fi.roi.toFixed(2)}×` : '—'}</td>
                                    </tr>
                                );
                            })}
                        </Tabla>
                    </Seccion>
                    {A.avisos && A.avisos.tipos.length > 0 && <Seccion titulo="L/L por tipo de aviso" sub="Leads sobre listing de cada tipo de aviso, para seguir qué nivel rinde."
                        info={<>Cada lead cuenta en el tipo que tenía su aviso <b>cuando llegó</b> (Inmuebles24 lo manda en el lead). Avisos = los que estuvieron vivos en ese tipo durante el periodo, en promedio por día (Inmuebles24, desde el historial); MercadoLibre no guarda historial y va con la foto de hoy (*). L/L llevado a 30 días. <b>Costo</b> = precio de lista por aviso al mes × avisos; la cuenta Premier todavía no tiene precio cargado. <b>CPL</b> = ese costo ÷ leads.</>}>
                        <Tabla head={['Portal', 'Tipo de aviso', 'Avisos', 'Leads', 'L/L', 'Costo del periodo', 'CPL']} min={720}>
                            {A.avisos.tipos.map((x) => {
                                const d = A.avisos!.dias;
                                const ll = x.avisos >= 1 ? (x.leads / x.avisos) * (30 / d) : null;
                                const cx = C?.avisos?.tipos.find((y) => y.portal === x.portal && y.tipo === x.tipo);
                                const llC = cx && cx.avisos >= 1 && C?.avisos ? (cx.leads / cx.avisos) * (30 / C.avisos.dias) : null;
                                const costo = x.costoMes != null ? x.costoMes * x.avisos * (d / 30) : null;
                                return (
                                    <tr key={`${x.portal}|${x.tipo}`}>
                                        <td style={td0}>{x.portal}</td>
                                        <td style={{ ...td0, fontWeight: 700 }}>{x.tipo}</td>
                                        <td style={td}>{f0(Math.round(x.avisos))}{x.hoy ? '*' : ''}</td>
                                        <td style={td}>{f0(x.leads)}</td>
                                        <td style={{ ...td, fontWeight: 700 }}>{ll != null ? ll.toFixed(2) : '—'}{ll != null && llC != null && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={Math.round(ll * 100)} b={Math.round(llC * 100)} /></div>}</td>
                                        <td style={td}>{costo != null ? money(costo) : '—'}</td>
                                        <td style={td}>{costo != null && x.leads ? money(costo / x.leads) : '—'}</td>
                                    </tr>
                                );
                            })}
                        </Tabla>
                        <div style={{ fontSize: 11, color: GRY, marginTop: 6 }}>* MercadoLibre: avisos en línea hoy (no guarda historial). Con una inmobiliaria elegida o venta/renta, todo se filtra igual.</div>
                    </Seccion>}
                </>);
            })()}

            {section === 'inversion' && (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                    <Kpi label="Inversión" info={DEF.inversion} value={sinCostoReal || periodoParcial ? '—' : faltaInv ? 's/d' : ia ? money(totInv) : '…'} sub={ia?.faltantes.length ? `falta cargar ${ia.faltantes.map(mesLargo).join(', ')}` : `${mesesA.length} ${mesesA.length === 1 ? 'mes' : 'meses'} · canales con costo`} />
                    <Kpi label="CPL" info={DEF.cpl} value={!sinCostoReal && !periodoParcial && !faltaInv && totLeadsInv ? money(totInv / totLeadsInv) : '—'} sub={`${f0(totLeadsInv)} leads de canales pagados`} />
                    <Kpi label="Cierres del periodo" info={DEF.cierresPeriodo} value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
                    <Kpi label="Regalía Pulppo" info={DEF.regalia} value={money(A.cierres.regalia)} sub="de los cierres del periodo" delta={<Delta a={A.cierres.regalia} b={C?.cierres.regalia} />} />
                    <Kpi label="ROI" info={DEF.roi} value={!sinCostoReal && !periodoParcial && !faltaInv && totInv ? `${(totRegInv / totInv).toFixed(2)}×` : '—'} sub="canales pagados" />
                </div>
                {sinCostoReal && <Aviso>CPL, CPA y ROI se apagan con {v.inmobiliaria ? 'una inmobiliaria elegida' : 'venta o renta'}: la inversión es de toda la red y no hay forma honesta de dividirla. Cierres y regalía sí van filtrados.</Aviso>}
                {periodoParcial && !sinCostoReal && <Aviso>La inversión es <b>mensual</b>. Con fechas que no empiezan el día 1, CPL, CPA y ROI saldrían inventados: elige Mes, Trimestre o YTD.</Aviso>}
                {mesEnCurso && !sinCostoReal && <Aviso>Incluye el <b>mes en curso</b>: la inversión ya está completa y los leads y cierres no, así que el CPL se ve más caro y el ROI más bajo de lo que va a quedar.</Aviso>}
                <Seccion titulo="Por canal" onCopiar={() => copiar([['Canal', 'Inversión', 'Leads', 'CPL', 'Cierres', 'CPA', 'Regalía', 'ROI'], ...filasInv.map((x) => [x.nombre, x.inv ?? '', x.leads, x.cpl ? Math.round(x.cpl) : '', x.cierres, x.cpa ? Math.round(x.cpa) : '', Math.round(x.regalia), x.roi != null ? Number(x.roi.toFixed(2)) : ''])])}
                    sub="Cuánto costó cada canal y qué regresó."
                    info={<><b>Leads</b> = los que entraron en el periodo. <b>Cierres y regalía</b> = operaciones que cerraron en el periodo, por la fuente del comprador. <b>ROI</b> = regalía que retiene Pulppo ÷ inversión (no la comisión total, que es del broker).{C ? ' Debajo del ROI, la diferencia contra el periodo comparado.' : ''}</>}>
                    <Tabla head={['Canal', 'Inversión', 'Leads', 'CPL', 'Cierres', 'CPA', 'Regalía', 'ROI']} min={760}>
                        {filasInv.map((x) => {
                            const invTxt = sinCostoReal || periodoParcial ? '—' : x.inv === undefined ? (ia ? 'sin línea' : '…') : x.inv === null ? 's/d' : x.inv === 0 ? (SIN_COSTO.has(x.k) ? 'sin costo' : 'gratis') : money(x.inv);
                            const ok = !sinCostoReal && !periodoParcial;
                            return (
                                <tr key={x.k}>
                                    <td style={td0}>{x.nombre}</td>
                                    <td style={{ ...td, color: typeof x.inv === 'number' && x.inv > 0 && ok ? BLK : GRY }}>{invTxt}</td>
                                    <td style={td}>{f0(x.leads)}</td>
                                    <td style={td}>{ok && x.cpl ? money(x.cpl) : '—'}</td>
                                    <td style={td}>{f0(x.cierres)}</td>
                                    <td style={td}>{ok && x.cpa ? money(x.cpa) : '—'}</td>
                                    <td style={td}>{money(x.regalia)}</td>
                                    <td style={{ ...td, fontWeight: 700, color: ok && x.roi != null ? (x.roi >= 1 ? SEA : RED) : GRY }}>
                                        {ok && x.roi != null ? `${x.roi.toFixed(2)}×` : '—'}
                                        {ok && x.roi != null && x.roiC != null && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={Math.round(x.roi * 100)} b={Math.round(x.roiC * 100)} /></div>}
                                    </td>
                                </tr>
                            );
                        })}
                    </Tabla>
                    {otrasFuentesCierre.length > 0 && (<>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '18px 0 6px' }}>Cierres que no vienen de un canal de leads</div>
                        <Tabla head={['Fuente del comprador', 'Cierres', 'Regalía']} min={420}>
                            {otrasFuentesCierre.map((x) => <tr key={x.fuente}><td style={td0}>{x.fuente}</td><td style={td}>{f0(x.n)}</td><td style={td}>{money(x.regalia)}</td></tr>)}
                        </Tabla>
                    </>)}
                    {ia?.copiados.length ? <Aviso>{ia.copiados.map(([m, de]) => `${mesLargo(m)} usa el plan de ${de}`).join(' · ')} (plan mensual fijo). Si el gasto real cambia, captúralo en su tab del Sheet.</Aviso> : null}
                {ia?.faltantes.length ? <Aviso><b>Falta cargar la inversión de {ia.faltantes.map(mesLargo).join(' y ')} en el Sheet.</b> Mientras, sus canales muestran <b>s/d</b>.</Aviso> : null}
                </Seccion>

                {!v.inmobiliaria && v.filtro.operacion === 'todas' && (
                    <Seccion titulo="Deal MercadoLibre" sub="Base $152,800 + 6% de la comisión del deal. Las banderas dicen qué revisar antes de pagar."
                        info={<>Ninguna regla de Mongo reproduce los meses ya conciliados, así que la tabla es una <b>lista de revisión</b>, no el monto a pagar.</>}>
                        {ia && <Tabla head={['Mes', 'Inversión MeLi', 'De dónde sale']} min={420}>
                            {ia.meli.map((m) => (
                                <tr key={m.mes} onClick={() => setMesDeal(m.mes)} style={{ cursor: 'pointer', background: m.mes === mesDeal ? LGT : '#fff' }}>
                                    <td style={td0}>{mesLargo(m.mes)}{m.mes === mesDeal ? ' ◂' : ''}</td><td style={td}>{money(m.inversion)}</td>
                                    <td style={{ ...td0, color: m.fuente === 'conciliado' ? SEA : '#8A6D00' }}>{m.fuente === 'conciliado' ? 'base + 6% conciliado a mano' : 'base + 6% calculado (sin revisar)'}</td>
                                </tr>
                            ))}
                        </Tabla>}
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '18px 0 6px' }}>Operaciones de {mesDeal ? mesLargo(mesDeal) : '…'} (clic en un mes para cambiar)</div>
                        {!deal?.d ? <div style={{ fontSize: 12, color: GRY }}>Cargando…</div> : (
                            <Tabla head={['Operación', 'Inmobiliaria', 'Comisión', '6%', 'Revisar']} min={760}>
                                {deal.d.ops.map((o, i) => (
                                    <tr key={(o.id ?? '') + i} style={{ background: o.banderas.length ? '#FFFBEF' : '#fff' }}>
                                        <td style={{ ...td0, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{o.id ?? '—'}</td>
                                        <td style={td0}>{o.inmobiliaria ?? '—'}</td>
                                        <td style={td}>{money(o.comision)}</td>
                                        <td style={td}>{money(o.seis)}</td>
                                        <td style={{ ...td0, whiteSpace: 'normal', fontSize: 11, color: o.banderas.length ? '#8A5333' : GRY }}>{o.banderas.length ? o.banderas.join(' · ') : 'sin observaciones'}</td>
                                    </tr>
                                ))}
                                {!deal.d.ops.length && <tr><td style={{ ...td0, color: GRY }} colSpan={5}>Sin operaciones del deal en el mes.</td></tr>}
                            </Tabla>
                        )}
                    </Seccion>
                )}
            </>)}

            {section === 'leads' && (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                    <Kpi label="Leads" info={DEF.leads} value={f0(T.leads)} sub={`${f0(T.unicos)} personas · ${f0(T.venta)} venta / ${f0(T.renta)} renta`} delta={<Delta a={T.leads} b={CT?.leads} />} />
                    <Kpi label="De brokers" info={DEF.brokers} value={pc(T.pctBroker)} sub={`${f0(T.brokerLeads)} leads de contactos broker`} delta={<Delta a={T.pctBroker} b={CT?.pctBroker} pts invertir />} />
                    <Kpi label="Sin respuesta · WhatsApp" info={DEF.sinRespuesta} value={pc(T.pctSinRespuestaWa)} sub={`Por teléfono: ${pc(T.pctSinRespuestaTel)} sin contacto visible (las llamadas al celular del asesor no se registran)`} delta={<Delta a={T.pctSinRespuestaWa} b={CT?.pctSinRespuestaWa} pts invertir />} />
                    <Kpi label="1ª respuesta" info={DEF.respuesta} value={mins(T.respMed)} sub={`${pc(T.pctLt60)} en < 60 min`} delta={<Delta a={T.respMed} b={CT?.respMed} invertir />} />
                    <Kpi label="Descartados" info={DEF.descartados} value={pc(T.pctDescartado)} sub={`${f0(T.descartados)} leads`} delta={descMaduro ? <Delta a={T.pctDescartado} b={CT?.pctDescartado} pts invertir /> : undefined} />
                </div>
                {cmpTxt && <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>Las variaciones en verde/rojo son {cmpTxt}. En tasas, la diferencia va en puntos.</div>}
                <Seccion titulo="Leads por fuente" onCopiar={() => copiar([['Fuente', 'Leads', 'Personas', 'Venta', 'Renta', '% broker', '< 60 min', '1ª resp. (min)'], ...A.fuentes.map((x) => [x.nombre, x.leads, x.unicos, x.venta, x.renta, x.pctBroker, x.pctLt60, x.respMed])])}
                    sub="Cuántos llegan de cada canal y qué tan rápido se contestan."
                    info={<><b>% broker</b>: {DEF.brokers} <b>&lt; 60 min</b> y <b>1ª resp.</b>: sólo leads que entraron de 8 am a 8 pm de México. El «sin responder» partido por WhatsApp vinculado / no vinculado está en «La semana».</>}>
                    <Tabla head={['Fuente', 'Leads', 'Personas', 'Venta', 'Renta', '% broker', '< 60 min', '1ª resp.']}>
                        {[...A.fuentes, T].map((x) => {
                            const c = x === T ? CT : buscar(C?.fuentes, x.key);
                            return (
                                <tr key={x.key}>
                                    <td style={td0}>{x.nombre}</td>
                                    <td style={td}>{f0(x.leads)}{c && <div style={{ fontSize: 10 }}><Delta a={x.leads} b={c.leads} /></div>}</td>
                                    <td style={td}>{f0(x.unicos)}</td>
                                    <td style={td}>{f0(x.venta)}</td>
                                    <td style={td}>{f0(x.renta)}</td>
                                    <td style={{ ...td, color: (x.pctBroker ?? 0) >= 40 ? RED : BLK }}>{pc(x.pctBroker)}{c && <div style={{ fontSize: 10 }}><Delta a={x.pctBroker} b={c.pctBroker} pts invertir /></div>}</td>
                                    <td style={td}>{pc(x.pctLt60)}</td>
                                    <td style={td}>{mins(x.respMed)}</td>
                                </tr>
                            );
                        })}
                    </Tabla>
                </Seccion>
            <Seccion titulo="Contacto con el lead y descartados" onCopiar={() => copiar([['Fuente', ...HEAD_CAL.slice(1)], ...A.fuentes.map((x) => [x.nombre, x.leads, x.pctConConversacion, x.pctSinRespuesta, x.pctFantasma, x.pctSinRespuestaWa, x.pctSinRespuestaTel, x.pctSoloClic, x.pctDescartado, x.pctSinResp])])}
                sub="Cada lead cae en una de tres — con conversación, sin respuesta visible o fantasma — y suman 100%."
                info={<>Cada lead cae en <b>una</b> de tres: <b>Con conversación</b> — hay plática real, en su registro o por otro lado (el comprador abrió WhatsApp, o ya venía platicando con nosotros: de 30 días antes a 14 después). <b>Sin respuesta visible</b> — tiene teléfono válido y se le puede escribir, pero no vemos que haya respondido: el asesor contesta desde su WhatsApp y ese chat no se guarda en Pulppo, así que <b>no es un lead perdido</b>. <b>Fantasma</b> — teléfono inválido (menos de 10 dígitos, todos iguales o una secuencia) y sin conversación: no hay cómo contactarlo. Las tres suman 100%. «Llegó sólo el clic» es un dato del portal: el lead entró únicamente con el evento («Vio teléfono», «Contactó por WhatsApp»), sin mensaje.</>}>
                <Tabla head={['Fuente', ...HEAD_CAL.slice(1)]}>
                    {A.fuentes.map((x) => filaCalidad(x, buscar(C?.fuentes, x.key)))}
                    {filaCalidad(T, CT)}
                </Tabla>
                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 18 }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Por qué se descartan · {f0(A.descarte.total)} leads<Info><p style={{ margin: '0 0 6px' }}>«No responde» en los motivos es lo que <b>marcó el asesor</b> al cerrar la búsqueda; no es lo mismo que el lead fantasma de la tabla de arriba, que se mide por si hubo conversación. «Sin motivo específico» junta el «descartado» genérico, «cancelado» y los que se cerraron sin motivo.</p>El descarte <b>madura</b>: un lead de esta semana casi no ha tenido tiempo de cancelarse, así que un periodo reciente siempre se ve más limpio de lo que va a terminar. Contra otro periodo, lee la <b>composición</b> (por qué se descartan), no el porcentaje total{!descMaduro && C ? <> — por eso, con un periodo que cerró hace menos de 45 días, la variación del % de descartados no se muestra</> : null}.</Info></div>
                        {A.descarte.familias.map((x) => {
                            const cx = C?.descarte.familias.find((y) => y.key === x.key);
                            return (
                                <div key={x.key} style={{ display: 'flex', alignItems: 'center', fontSize: 12, margin: '5px 0' }}>
                                    <span style={{ width: 160 }}>{x.label}</span>
                                    <span style={{ flex: 1, background: LGT, height: 14, position: 'relative' }}><span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${x.pct}%`, background: BLK }} /></span>
                                    <span style={{ width: 44, textAlign: 'right', fontWeight: 700 }}>{x.pct}%</span>
                                    <span style={{ width: 62, textAlign: 'right', fontSize: 11 }}>{cx && C?.descarte.total && A.descarte.total ? <Delta a={x.pct} b={cx.pct} pts invertir /> : null}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '20px 0 6px', display: 'flex' }}>
                    <span style={{ flex: 1 }}>Todos los motivos · y cuántos toques registró el asesor antes de descartar<Info ancho={380}><b>Toque registrado</b> = lo que el <b>asesor</b> hizo en Pulppo sobre esa búsqueda antes de descartarla: seguimientos que marcó como hechos, propiedades que le sugirió, búsqueda que le compartió y notas (las tareas que el sistema crea y cierra solo no cuentan). Los WhatsApp del asesor <b>no se guardan en la base</b>, así que «sin ningún toque» quiere decir sin nada <b>registrado</b>: puede que sí le haya escrito por fuera. Aun así, un descarte por «no responde» sin un solo toque registrado es la señal a revisar. Aquí los toques se cuentan por <b>búsqueda</b> (varios leads de la misma persona comparten una); en la tabla por asesor, «Desc. sin toque» va por <b>lead</b>, así que los dos porcentajes no tienen que coincidir.</Info></span>
                    <button onClick={() => copiar([['Motivo', 'Familia', 'Leads', '%', 'Toques (mediana)', 'Toques (promedio)', '% sin ningún toque'], ...A.descarte.motivos.map((m) => [m.motivo, m.familia, m.n, m.pct, m.segMediana, m.segProm, m.pctSinSeg])])}
                        style={{ fontSize: 11, padding: '3px 8px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>Copiar tabla</button>
                </div>
                <Tabla head={['Motivo', 'Familia', 'Leads', '%', 'Toques · mediana', 'Promedio', 'Búsquedas sin toque']} min={820}>
                    {A.descarte.motivos.map((m) => (
                        <tr key={m.motivo}>
                            <td style={{ ...td0, whiteSpace: 'normal' }}>{m.motivo}</td>
                            <td style={{ ...td0, color: '#666', whiteSpace: 'normal', fontSize: 11 }}>{m.familia}</td>
                            <td style={td}>{f0(m.n)}</td>
                            <td style={{ ...td, fontWeight: 700 }}>{m.pct}%</td>
                            <td style={td}>{m.segMediana ?? '—'}</td>
                            <td style={td}>{m.segProm ?? '—'}</td>
                            <td style={{ ...td, fontWeight: 700, color: (m.pctSinSeg ?? 0) >= 75 ? RED : BLK }}>{pc(m.pctSinSeg)}</td>
                        </tr>
                    ))}
                    {!A.descarte.motivos.length && <tr><td style={{ ...td0, color: GRY }} colSpan={7}>Sin descartes en el periodo.</td></tr>}
                </Tabla>
            </Seccion>


                <Seccion titulo="Calidad del lead por fuente" onCopiar={() => copiar([['Fuente', 'Leads', ...QCOLS.map((q) => q.h)], ...[...A.fuentes, T].map((x) => [x.nombre, x.leads, ...QCOLS.map((q) => q.v(x) ?? '')])])}
                    sub="Qué tan contactables y qué tan reales son los leads de cada canal. En rojo, lo que dispara una red flag en «Para atender»."
                    info={<><b>Sin contacto</b>: teléfono inválido y sin correo. <b>Fantasma</b>: teléfono inválido y nunca conversó. <b>Sólo el clic</b>: el portal mandó sólo el evento («Vio teléfono»), sin mensaje del cliente. <b>Sin respuesta visible</b>: tiene teléfono pero no vemos que haya contestado. <b>Descartados</b>: búsqueda cerrada como descartada. <b>Brokers</b>: el contacto está etiquetado como broker. <b>Ráfagas</b>: entró a ≤2 min del lead de OTRA persona (distinto contacto, teléfono y correo) a la misma propiedad. Inmuebles24 y MercadoLibre entregan leads en lotes, así que tienen una base normal de 12–20%: lo raro es que se duplique. <b>Madrugada</b>: entró de 0 a 5 am. <b>Correos con dígitos</b>: 4+ números antes de la @ (típico de cuentas hechas en serie). <b>Contactos nuevos</b>: el contacto se creó al mismo tiempo que el lead. Las últimas cuatro juntas son las señales de «Posible spam».</>}>
                    <Tabla head={['Fuente', 'Leads', ...QCOLS.map((q) => q.h)]} min={1180}>
                        {A.fuentes.map((x) => filaQ(x, buscar(C?.fuentes, x.key)))}
                        {filaQ(T, CT)}
                    </Tabla>
                </Seccion>

                <Seccion titulo="Por qué se descartan, por fuente" onCopiar={() => copiar([['Fuente', '% descartados', ...FAM.map(([, l]) => l)], ...A.fuentes.map((x) => [x.nombre, x.pctDescartado, ...FAM.map(([k]) => (x.descartados ? Math.round((100 * (x.descFam[k] ?? 0)) / x.descartados) : ''))])])}
                    sub="Si un portal manda más brokers, más datos falsos o más gente que no responde."
                    info={<>De los leads descartados de cada fuente, en qué familia de motivo cayeron. Cada fila suma 100%.</>}>
                    <Tabla head={['Fuente', '% descartados', ...FAM.map(([, l]) => l)]} min={980}>
                        {[...A.fuentes, T].map((x) => (
                            <tr key={x.key}>
                                <td style={td0}>{x.nombre}</td>
                                <td style={{ ...td, fontWeight: 700 }}>{pc(x.pctDescartado)}</td>
                                {FAM.map(([k]) => {
                                    const p = x.descartados ? Math.round((100 * (x.descFam[k] ?? 0)) / x.descartados) : null;
                                    return <td key={k} style={{ ...td, color: p == null || p === 0 ? GRY : BLK }}>{p == null ? '—' : `${p}%`}</td>;
                                })}
                            </tr>
                        ))}
                    </Tabla>
                </Seccion>
            </>)}

            {section === 'embudo' && (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                    <Kpi label="Lead → visita" info={DEF.visita} value={pc(T.pVisita)} sub={`${f0(T.visitas)} de ${f0(T.unicos)} personas visitaron`} delta={<Delta a={T.pVisita} b={CT?.pVisita} pts />} />
                    <Kpi label="Ofertaron" info={DEF.ofertaron} value={f0(T.ofertas)} sub={`${pc(T.pOferta)} de las personas`} delta={<Delta a={T.ofertas} b={CT?.ofertas} />} />
                    <Kpi label="Cierres de la cohorte" info={DEF.cierresCohorte} value={f0(T.cierres)} sub={`${pc(T.pCierre)} de las personas`} delta={<Delta a={T.cierres} b={CT?.cierres} />} />
                    <Kpi label="Cierres del periodo" info={DEF.cierresPeriodo} value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
                </div>
                {cmpTxt && <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>Las variaciones en verde/rojo son {cmpTxt}. En tasas, la diferencia va en puntos.</div>}
            <Seccion titulo="Funnel comercial por fuente" onCopiar={() => tsvFunnel(A.fuentes, 'Fuente')}
                sub="Los leads que entraron en el periodo y lo que hicieron después."
                info={<>Es una <b>cohorte</b>: se sigue a las personas que dejaron un lead en el periodo, no a la actividad del periodo{v.inmobiliaria ? <> — la visita, la oferta y el cierre tienen que ser con {v.inmobiliaria.nombre}</> : null}. Las tasas van sobre personas únicas, no sobre registros. Los cierres de una cohorte reciente salen bajos por construcción (el ciclo de venta va de 43 a 144 días); para juzgar cierres, mira «Cierres del periodo».</>}>
                <Embudo t={T} c={CT} />
                <div style={{ height: 14 }} />
                <Tabla head={HEAD_FUNNEL}>
                    {A.fuentes.map((x) => filaFunnel(x, buscar(C?.fuentes, x.key)))}
                    {filaFunnel(T, CT)}
                </Tabla>
                {recienteCohorte && <Aviso>Cohorte reciente: sus cierres todavía no maduran. Para juzgar cierres, mira «Cierres del periodo» abajo.</Aviso>}
            </Seccion>

            <Seccion titulo="Cierres del periodo" onCopiar={() => copiar([['Fecha', 'Operación', 'Código', 'Tipo', 'Colonia', 'Valor', 'Comisión', 'Fuente', 'Lado', 'Asesor', 'ID operación'],
                ...A.cierres.lista.map((x) => [x.fecha, x.operacion, x.codigo, x.tipo, x.colonia, x.valor, x.comision, x.inferida ? `${x.fuente} (inferida)` : x.fuente, x.lado, x.asesor, x.id])])}
                sub="Lo que cerró en el periodo, con la fuente del comprador."
                info={<>Operaciones que <b>cerraron</b> en el periodo, vengan de leads de cuando sea{v.inmobiliaria ? <>, de los dos lados: donde {v.inmobiliaria.nombre} vende la propiedad y donde trae al comprador</> : null}. La fuente es el <b>canal</b> por el que llegó el comprador. Cuando la operación no la trae (<code>other</code>): se busca evidencia — el lead del comprador o del <b>broker externo</b>, la búsqueda que se le abrió al broker, un lead con su teléfono u otra operación del mismo inmueble — y al pasar el mouse sobre la fuente se ve cuál se usó (columna «Inferidas»); búsqueda sin fuente → <b>Búsqueda creada por el asesor</b>; nada → <b>Cartera del asesor</b>, o <b>Sin registro</b> si al comprador lo trajo otra inmobiliaria. Que lo trajera un broker externo u otra inmobiliaria de la red no es una fuente: sale aparte, debajo de la fuente.</>}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Kpi label="Cierres" info={DEF.cierresPeriodo} value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
                    <Kpi label="Comisión" info={DEF.comision} value={money(A.cierres.comision)} delta={<Delta a={A.cierres.comision} b={C?.cierres.comision} />} />
                    <Kpi label="Valor cerrado" info={DEF.valor} value={money(A.cierres.valor)} delta={<Delta a={A.cierres.valor} b={C?.cierres.valor} />} />
                </div>
                <div style={{ height: 12 }} />
                <Tabla head={['Fuente del comprador', 'Cierres', 'Venta', 'Renta', 'Comisión', 'Inferidas']} min={600}>
                    {A.cierres.porFuente.map((x) => (
                        <tr key={x.fuente}><td style={td0}>{x.fuente}</td><td style={td}>{f0(x.n)}</td><td style={td}>{f0(x.venta)}</td><td style={td}>{f0(x.renta)}</td><td style={td}>{money(x.comision)}</td><td style={{ ...td, color: x.inferidas ? '#8A6D00' : GRY }}>{x.inferidas ? f0(x.inferidas) : '—'}</td></tr>
                    ))}
                </Tabla>
                {A.cierres.sinFuenteOriginal > 0 && (
                    <div style={{ fontSize: 11.5, color: '#666', marginTop: 8 }}>
                        <b>{f0(A.cierres.sinFuenteOriginal)} de {f0(A.cierres.n)}</b> cierres venían sin fuente y se atribuyeron (ver ⓘ).{A.cierres.sinAtribuir ? <> <b>{f0(A.cierres.sinAtribuir)}</b> quedan como «Sin registro»: al comprador lo trajo otra inmobiliaria y nadie capturó cómo llegó.</> : null}
                    </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '20px 0 6px' }}>Últimos cierres</div>
                <Tabla head={['Fecha', 'Operación', 'Propiedad', 'Valor', 'Comisión', 'Fuente', 'Lado', 'Asesor']} min={880}>
                    {A.cierres.lista.map((x) => (
                        <tr key={x.id + x.fecha}>
                            <td style={td0}>{x.fecha}</td>
                            <td style={td0}>{x.operacion}</td>
                            <td style={{ ...td0, whiteSpace: 'normal' }}>{x.codigo ? <a href={`/ficha/${encodeURIComponent(x.codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>{x.codigo}</a> : '—'}<div style={{ fontSize: 10.5, color: '#666' }}>{[x.tipo, x.colonia].filter(Boolean).join(' · ')}</div></td>
                            <td style={td}>{money(x.valor)}</td>
                            <td style={td}>{money(x.comision)}</td>
                            <td style={td0} title={x.evidencia ?? undefined}>{x.fuente}{x.comprador && <div style={{ fontSize: 10, color: '#666' }}>comprador: {x.comprador.toLowerCase()}</div>}</td>
                            <td style={{ ...td0, color: ladoColor[x.lado], fontWeight: 700 }}>{x.lado}</td>
                            <td style={{ ...td0, whiteSpace: 'normal' }}>{x.asesor}</td>
                        </tr>
                    ))}
                    {!A.cierres.lista.length && <tr><td style={{ ...td0, color: GRY }} colSpan={8}>Sin cierres en el periodo.</td></tr>}
                </Tabla>
                {A.cierres.n > A.cierres.lista.length && <div style={{ fontSize: 11, color: GRY, marginTop: 6 }}>Se muestran los {A.cierres.lista.length} más recientes de {f0(A.cierres.n)}.</div>}
            </Seccion>

            {(A.cierres.sinRegistro?.length ?? 0) > 0 && (
                <Seccion titulo="Cierres sin registro" onCopiar={() => copiar([['Fecha', 'Código', 'Operación', 'Inmobiliaria que vende', 'Asesor', 'Comprador traído por', 'ID operación'],
                    ...A.cierres.sinRegistro.map((x) => [x.fecha, x.codigo, x.operacion, x.vende, x.asesor, x.comprador, x.id])])}
                    sub="Cierres donde no hay ningún rastro de cómo llegó el comprador. Para que el KAM le pregunte al asesor y corrija la fuente en Pulppo."
                    info={<>Al comprador lo trajo otra inmobiliaria (casi siempre un broker externo) y nadie capturó el canal: ni en la operación, ni en la búsqueda, ni hay un lead del comprador o del broker. Sólo el asesor sabe cómo llegó. Cuando corrija la fuente de la operación en Pulppo, este tablero la toma solo en la siguiente carga y el cierre sale de esta lista.</>}>
                    <Tabla head={['Fecha', 'Propiedad', 'Operación', 'Inmobiliaria que vende', 'Asesor', 'Comprador traído por', 'ID operación']} min={880}>
                        {A.cierres.sinRegistro.map((x) => (
                            <tr key={'sr' + x.id + x.fecha}>
                                <td style={td0}>{x.fecha}</td>
                                <td style={td0}>{x.codigo ? <a href={`/ficha/${encodeURIComponent(x.codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700 }}>{x.codigo}</a> : '—'}</td>
                                <td style={td0}>{x.operacion}</td>
                                <td style={{ ...td0, whiteSpace: 'normal' }}>{x.vende ?? '—'}</td>
                                <td style={{ ...td0, whiteSpace: 'normal' }}>{x.asesor}</td>
                                <td style={td0}>{x.comprador ?? '—'}</td>
                                <td style={{ ...td0, color: GRY }}>{x.id}</td>
                            </tr>
                        ))}
                    </Tabla>
                </Seccion>
            )}

            </>)}

            {section === 'inmobiliarias' && (<>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <Kpi label="Leads" info={DEF.leads} value={f0(T.leads)} sub={`${f0(T.unicos)} personas · ${f0(T.venta)} venta / ${f0(T.renta)} renta`} delta={<Delta a={T.leads} b={CT?.leads} />} />
                <Kpi label="Lead → visita" info={DEF.visita} value={pc(T.pVisita)} sub={`${f0(T.visitas)} de ${f0(T.unicos)} personas visitaron`} delta={<Delta a={T.pVisita} b={CT?.pVisita} pts />} />
                <Kpi label="Cierres de la cohorte" info={DEF.cierresCohorte} value={f0(T.cierres)} sub={`${pc(T.pCierre)} de las personas`} delta={<Delta a={T.cierres} b={CT?.cierres} />} />
                <Kpi label="1ª respuesta" info={DEF.respuesta} value={mins(T.respMed)} sub={`${pc(T.pctLt60)} en < 60 min`} delta={<Delta a={T.respMed} b={CT?.respMed} invertir />} />
                <Kpi label="Sin respuesta · WhatsApp" info={DEF.sinRespuesta} value={pc(T.pctSinRespuestaWa)} sub={`Por teléfono: ${pc(T.pctSinRespuestaTel)} sin contacto visible (las llamadas al celular del asesor no se registran)`} delta={<Delta a={T.pctSinRespuestaWa} b={CT?.pctSinRespuestaWa} pts invertir />} />
                <Kpi label="Cierres del periodo" info={DEF.cierresPeriodo} value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
            </div>
            {cmpTxt && <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>Las variaciones en verde/rojo son {cmpTxt}. En tasas, la diferencia va en puntos.</div>}

            {v.inmobiliaria && (
                <Seccion titulo="Por asesor" onCopiar={() => tsvEquipo(A.asesores, 'Asesor')} sub="Quién recibe los leads, de qué fuente le llegan sobre todo y cómo los convierte.">
                    <Tabla head={['Asesor', ...HEAD_EQ.slice(1)]}>
                        {A.asesores.map((x) => filaEquipo(x, buscar(C?.asesores, x.key)))}
                    </Tabla>
                </Seccion>
            )}

            {!v.inmobiliaria && (
                <Seccion titulo="Por inmobiliaria" onCopiar={() => tsvEquipo(A.inmobiliarias, 'Inmobiliaria')}
                    sub="Las 102 en el orden de siempre (se pega directo en el Excel de trabajo); las que no están en la lista van al final.">
                    <Tabla head={['Inmobiliaria', ...HEAD_EQ.slice(1)]}>
                        {A.inmobiliarias.map((x) => filaEquipo(x, buscar(C?.inmobiliarias, x.key)))}
                    </Tabla>
                </Seccion>
            )}


            </>)}
            <div style={{ fontSize: 10, color: GRY, marginTop: 26 }}>
                Excluye Habi y cuentas de prueba. Calculado {new Date(v.generado).toLocaleString('es-MX')}.
            </div>
            </div>
        </>
    );
}
