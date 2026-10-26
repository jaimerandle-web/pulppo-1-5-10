'use client';

/**
 * Marketing de la inmobiliaria (oct-2026) — HOY SÓLO PARA EL EQUIPO INTERNO (lib/marketingAcceso.ts) y el
 * preview de lib/preview.ts.
 * Arriba, «la semana en corto» (últimos 7 días vs los 7 anteriores + las acciones). Luego asignación,
 * cambios, desempeño por nivel (i24 con leads de i24, MeLi con leads de MeLi; venta / renta), cierres por
 * fuente, estrellas, exposición vs calidad, rotación (lo que el scoring no evalúa va como decisión manual),
 * trabadas (90+ días) y, al final, el top de anuncios de venta y de renta.
 * 🔴 Sin costos ni CPL (Ale): esa lectura es interna de Pulppo. Sin cuentas de Inmuebles24 ni zona forzada.
 * Todas las tablas son <TablaFiltrable>: buscador, filtros rápidos, orden por cualquier columna y
 * «Copiar tabla» con sólo lo filtrado.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import TablaFiltrable, { type Col } from './TablaFiltrable';
import type { AvisoMk, CierreMk, LLMk, MarketingMk, Op, PorNivelMk } from '@/lib/marketingDh';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MES[Number(s.slice(5, 7)) - 1]}` : '—');

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px', cursor: 'pointer', userSelect: 'none' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const sub: CSSProperties = { fontSize: 10.5, color: '#777' };
const inp: CSSProperties = { padding: '5px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };

function Seccion({ n, titulo, nota, children }: { n: number; titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 30 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}><span style={{ color: GRY, marginRight: 8 }}>{n}</span>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 880 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Kpi({ label, value, nota }: { label: string; value: string; nota?: string }) {
    return (
        <div style={{ flex: '1 1 140px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}</div>
            {nota && <div style={sub}>{nota}</div>}
        </div>
    );
}
/** Venta / Renta con color (Ale): venta verde mar, renta amarillo */
export const OpTag = ({ op }: { op: string | null | undefined }) => (op === 'Venta' || op === 'Renta'
    ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: R, background: op === 'Venta' ? SEA : YEL, color: op === 'Venta' ? '#fff' : BLK, marginLeft: 6, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em', verticalAlign: 'middle' }}>{op}</span>
    : null);
/** botón «Actualizar» + hora del último cálculo */
export function Actualizar({ generado, cargando, onClick }: { generado: string; cargando: boolean; onClick: () => void }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, margin: '-6px 0 6px' }}>
            <span style={{ fontSize: 10.5, color: '#777' }}>{cargando ? 'Actualizando…' : `Datos de las ${new Date(generado).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`}</span>
            <button type="button" onClick={onClick} disabled={cargando} style={{ fontSize: 11.5, padding: '4px 11px', border: `1px solid ${BLK}`, borderRadius: R, background: '#fff', cursor: cargando ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>↻ Actualizar</button>
        </div>
    );
}
const Pill = ({ t, bg, fg }: { t: string; bg: string; fg: string }) => <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: R, background: bg, color: fg, whiteSpace: 'nowrap' }}>{t}</span>;
/** ▲▼ contra la semana anterior */
const Delta = ({ a, b }: { a: number; b: number }) => {
    if (!b && !a) return null;
    if (!b) return <span style={{ ...sub, color: SEA, marginLeft: 4 }}>nuevo</span>;
    const d = Math.round(((a - b) / b) * 100);
    return <span style={{ ...sub, color: d > 0 ? SEA : d < 0 ? RED : '#777', marginLeft: 4, whiteSpace: 'nowrap' }}>{d > 0 ? '▲' : d < 0 ? '▼' : '='}{Math.abs(d)}%</span>;
};

// ─────────────────────────── pantalla ───────────────────────────
export default function MBMarketing({ companyId, interno = false }: { companyId: string; interno?: boolean }) {
    const [d, setD] = useState<MarketingMk | null>(null);
    const [err, setErr] = useState('');
    const [vuelta, setVuelta] = useState(0);   // «Actualizar» fuerza recalcular (salta el caché del servidor)
    const [cargando, setCargando] = useState(false);
    useEffect(() => {
        let vivo = true;
        setCargando(true);
        fetch(`/api/mb-marketing?company=${companyId}${vuelta ? '&refresh=1' : ''}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) { setD(j); setErr(''); } else setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'))
            .finally(() => vivo && setCargando(false));
        return () => { vivo = false; };
    }, [companyId, vuelta]);
    if (err) return <p style={{ fontSize: 13, color: RED }}>{err}</p>;
    if (!d) return <p style={{ fontSize: 13, color: GRY }}>Calculando en vivo… (la primera vez del día tarda ~30 s: corre el scoring de avisos)</p>;
    return (<>
        <Actualizar generado={d.generado} cargando={cargando} onClick={() => setVuelta((x) => x + 1)} />
        <Vista d={d} interno={interno} />
    </>);
}

// Colores de siempre de los niveles (Ale): súper destacado amarillo, destacado azul (verde mar), simple negro
// Premier (cuenta ANUNCIO_PREMIERE de DH): dorado, para distinguirlo del súper destacado normal
const DORADO = '#B8860B', NIVEL_PREMIER = 'Súper destacado · Premier';   // = NIVEL_PREMIER de marketingDh (no se importa: trae mongodb)
const COLOR_I24: Record<string, string> = { 'Súper destacado · Premier': DORADO, 'Súper destacado': YEL, Destacado: SEA, Simple: BLK, Offline: GRY, Gratis: '#9FC7C7', 'Sin aviso': LGT };
const COLOR_MELI: Record<string, string> = { gold_premium: YEL, gold: '#C79A00', silver: GRY, offline: '#D6D6D6', 'sin aviso': LGT };
const MELI_LBL: Record<string, string> = { gold_premium: 'Gold premium', gold: 'Gold', silver: 'Silver', offline: 'Offline', 'sin aviso': 'Sin aviso' };

/** barra apilada horizontal con su leyenda */
function Distribucion({ partes }: { partes: Array<{ k: string; n: number; color: string }> }) {
    const total = partes.reduce((s, x) => s + x.n, 0) || 1;
    return (
        <div>
            <div style={{ display: 'flex', height: 22, borderRadius: R, overflow: 'hidden', background: LGT }}>
                {partes.filter((x) => x.n).map((x) => <div key={x.k} title={`${x.k}: ${f0(x.n)}`} style={{ width: `${(100 * x.n) / total}%`, background: x.color }} />)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6 }}>
                {partes.filter((x) => x.n).map((x) => (
                    <span key={x.k} style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: R, background: x.color, display: 'inline-block' }} />
                        {x.k} <b>{f0(x.n)}</b> <span style={sub}>{pc(x.n, total)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/** Desempeño de un nivel: Vistas → Leads → Visitas con barras comparables entre niveles */
function NivelEmbudo({ x, max, color }: { x: PorNivelMk; max: { v: number; l: number; s: number }; color?: string }) {
    const filas: Array<[string, number, number, number, number, number]> = [
        ...(x.vistas30 != null ? [['Vistas', x.vistasSem ?? 0, x.vistasSemAnt ?? 0, x.vistas30, max.v, 0] as [string, number, number, number, number, number]] : []),
        ['Leads', x.leadsSem, x.leadsSemAnt, x.leads30, max.l, 1],
        ['Visitas', x.visitasSem, x.visitasSemAnt, x.visitas30, max.s, 2],
    ];
    return (
        <div style={{ flex: '1 1 300px', border: `1px solid ${LGT}`, borderLeft: color ? `3px solid ${color}` : `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>{x.nivel}</b><span style={sub}>{f0(x.avisos)} anuncios</span>
            </div>
            {filas.map(([lbl, sem, ant, d30, m, i]) => (
                <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontSize: 11.5 }}>
                    <span style={{ width: 48, color: '#555' }}>{lbl}</span>
                    <span style={{ flex: 1, background: LGT, height: 10, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${m ? (100 * d30) / m : 0}%`, background: [GRY, SEA, BLK][i] }} />
                    </span>
                    <span style={{ width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{f0(d30)}</b> <span style={sub}>30 d</span></span>
                    <span style={{ width: 92, textAlign: 'right' }}><span style={sub}>7 d {f0(sem)}</span><Delta a={sem} b={ant} /></span>
                </div>
            ))}
            <div style={{ ...sub, marginTop: 4 }}>
                {x.vistas30 != null && <>Leads por cada 100 vistas: <b style={{ color: BLK }}>{x.vistas30 ? ((100 * x.leads30) / x.vistas30).toFixed(1) : '—'}</b> · </>}lead → visita: <b style={{ color: BLK }}>{pc(x.visitas30, x.leads30)}</b>
            </div>
        </div>
    );
}

const btnLiga: CSSProperties = { background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, textDecoration: 'underline dotted' };

function Vista({ d, interno }: { d: MarketingMk; interno: boolean }) {
    const [opNivel, setOpNivel] = useState<Op>('Todas');
    const [filtroTop, setFiltroTop] = useState<string>('');
    const [filtroOff, setFiltroOff] = useState<string>('');
    const verFuera = (portal: string) => { setFiltroOff(portal); setTimeout(() => document.getElementById('no-se-muestra')?.scrollIntoView({ behavior: 'smooth' }), 50); };
    // motivo de cada anuncio que no se muestra, para decirlo en la misma celda de «Tus anuncios»
    const motivoDe = useMemo(() => new Map(d.offline.map((x) => [`${x.codigo}|${x.portal}`, x])), [d.offline]);
    const [leadsDe, setLeadsDe] = useState<{ codigo: string; dias: number; portal?: string } | null>(null);
    const verNivel = (nivel: string) => { setFiltroTop(nivel); setTimeout(() => document.getElementById('top-anuncios')?.scrollIntoView({ behavior: 'smooth' }), 50); };
    const porCodigo = useMemo(() => new Map(d.avisos.map((a) => [a.codigo, a])), [d.avisos]);
    const total = d.avisos.length;
    const premium = d.asignacion.porNivel.filter((x) => /Súper|Destacado/.test(x.nivel)).reduce((s, x) => s + x.n, 0);
    const zd = d.asignacion.zonaDemandVenta;

    // identificación (Joshua): tipo, operación, calle y número, colonia y asesor — nunca sólo el código
    const Prop = ({ codigo }: { codigo: string }) => {
        const a = porCodigo.get(codigo);
        return (
            <div style={{ minWidth: 170 }}>
                <a href={`/ficha/${encodeURIComponent(a?.id ?? codigo)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700, textDecoration: 'none' }}>{codigo}</a>
                {a && <><OpTag op={a.operacion} /><span style={{ ...sub, marginLeft: 6 }}>{a.tipo}</span></>}
                <div style={{ fontSize: 11.5, whiteSpace: 'normal' }}>{[a?.calle, a?.colonia].filter(Boolean).join(', ') || 'sin dirección'}</div>
                {a?.asesor && a.asesor !== '—' && <div style={{ ...sub, whiteSpace: 'normal' }}>{a.asesor}</div>}
            </div>
        );
    };
    // liga a la lista de leads (nombre, fuente, medio, teléfono, correo)
    const VerLeads = ({ codigo, n, dias = 30, portal, negritas }: { codigo: string; n: number; dias?: number; portal?: string; negritas?: boolean }) => (n
        ? <button type="button" onClick={() => setLeadsDe({ codigo, dias, portal })} title="Ver la lista de leads"
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: SEA, fontWeight: negritas ? 700 : 600, fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline dotted' }}>{f0(n)}</button>
        : <>{f0(n)}</>);
    const buscar = (codigo: string, extra = '') => {
        const a = porCodigo.get(codigo);
        return [codigo, a?.colonia, a?.calle, a?.asesor, a?.nivel, a?.tipo, extra].filter(Boolean).join(' ');
    };
    const colProp = <T extends { codigo: string }>(): Col<T> => ({ h: 'Propiedad', v: (r) => r.codigo, render: (r) => <Prop codigo={r.codigo} /> });
    const op = <T extends { codigo: string }>() => ({ label: 'Operación', v: (r: T) => porCodigo.get(r.codigo)?.operacion ?? '' });
    const niv = <T extends { nivel: string }>() => ({ label: 'Nivel', v: (r: T) => r.nivel });

    const nivelesI24 = d.porNivel[opNivel].filter((x) => x.nivel !== 'Offline' && x.nivel !== 'Sin aviso');
    const nivelesMeli = d.porNivelMeli[opNivel].filter((x) => x.nivel !== 'offline' && x.nivel !== 'sin aviso');
    const maxDe = (xs: PorNivelMk[]) => ({ v: Math.max(1, ...xs.map((x) => x.vistas30 ?? 0)), l: Math.max(1, ...xs.map((x) => x.leads30)), s: Math.max(1, ...xs.map((x) => x.visitas30)) });
    const rotarAuto = d.rotar.filter((x) => !x.manual), rotarManual = d.rotar.filter((x) => x.manual);
    const conv = (a: { leads30: number; visitas30: number }) => (a.leads30 ? Math.round((100 * a.visitas30) / a.leads30) : null);

    const Estado = ({ e, nivel, codigo, portal }: { e: string; nivel?: string; codigo?: string; portal?: string }) => {
        const m = e !== 'En línea' && e !== 'No difundida' && codigo && portal ? motivoDe.get(`${codigo}|${portal}`) : undefined;
        return (<>
            <span style={{ fontSize: 11.5, color: e === 'En línea' ? (nivel === NIVEL_PREMIER ? DORADO : BLK) : e === 'Fuera de línea' ? RED : GRY, fontWeight: e === 'En línea' ? 600 : 400, whiteSpace: 'nowrap' }}>
                {e === 'En línea' ? (nivel ?? '✓ En línea') : e === 'Fuera de línea' ? '✗ Fuera de línea' : e === 'No difundida' ? '○ No difundida en portales' : '— Sin aviso'}
            </span>
            {m && <div title={`${m.motivo} · ${m.accion}`} style={{ fontSize: 10.5, color: '#777', whiteSpace: 'normal', maxWidth: 190, lineHeight: 1.35, marginTop: 2 }}>
                {m.motivo.length > 70 ? m.motivo.slice(0, 68) + '…' : m.motivo} <span style={{ fontWeight: 700, color: m.quien === 'Inmobiliaria' ? BLK : '#999' }}>· {m.quien === 'Inmobiliaria' ? 'lo corriges tú' : 'lo revisa Pulppo'}</span>
            </div>}
        </>);
    };
    const colsAviso: Col<AvisoMk>[] = [
        colProp<AvisoMk>(),
        { h: 'Precio', num: true, v: (a) => a.precio, render: (a) => (a.precio != null ? `$${f0(Math.round(a.precio))}` : '—') },
        { h: 'Inmuebles24', v: (a) => a.nivel, render: (a) => <><Estado e={a.estado.i24} nivel={a.nivel} codigo={a.codigo} portal="Inmuebles24" />{a.estado.i24 === 'En línea' && a.enNivelDesde && <div style={sub}>desde {fecha(a.enNivelDesde)}</div>}</> },
        { h: 'MercadoLibre', v: (a) => a.meli, render: (a) => <Estado e={a.estado.meli} nivel={MELI_LBL[a.meli] ?? a.meli} codigo={a.codigo} portal="MercadoLibre" /> },
        { h: 'Propiedades.com', v: (a) => a.estado.pcom, render: (a) => <Estado e={a.estado.pcom} codigo={a.codigo} portal="Propiedades.com" /> },
        { h: 'Casas y Terrenos', v: (a) => a.estado.cyt, render: (a) => <Estado e={a.estado.cyt} codigo={a.codigo} portal="Casas y Terrenos" /> },
        { h: 'EasyBroker', v: (a) => a.estado.eb, render: (a) => <Estado e={a.estado.eb} codigo={a.codigo} portal="EasyBroker" /> },
        { h: 'Vistas 7 d', num: true, v: (a) => a.vistasSem, render: (a) => <>{f0(a.vistasSem)}<Delta a={a.vistasSem} b={a.vistasSemAnt} /></> },
        { h: 'Vistas 30 d', num: true, v: (a) => a.vistas30 },
        { h: 'Leads 7 d', num: true, v: (a) => a.leadsSem, render: (a) => <>{f0(a.leadsSem)}<Delta a={a.leadsSem} b={a.leadsSemAnt} /></> },
        { h: 'Leads 30 d', num: true, v: (a) => a.leads30, render: (a) => <VerLeads codigo={a.codigo} n={a.leads30} negritas /> },
        { h: 'Visitas 30 d', num: true, v: (a) => a.visitas30 },
        { h: 'Lead → visita', num: true, v: (a) => conv(a), render: (a) => (conv(a) == null ? '—' : `${conv(a)}%`) },
        { h: 'Vistas i24 / mercado', num: true, v: (a) => a.vistasI24, render: (a) => <span style={{ color: '#666' }}>{a.vistasI24 ?? '—'} / {a.vistasMercadoI24 ?? '—'}</span> },
    ];

    const enLinea = (k: keyof AvisoMk['estado']) => d.avisos.filter((a) => a.estado[k] === 'En línea').length;
    const fuera = (k: keyof AvisoMk['estado']) => d.avisos.filter((a) => a.estado[k] === 'Fuera de línea').length;
    const sinAviso = (k: keyof AvisoMk['estado']) => d.avisos.filter((a) => a.estado[k] === 'Sin aviso').length;
    const noDif = d.avisos.filter((a) => Object.values(a.estado).includes('No difundida')).length;
    const PORTALES: Array<{ k: keyof AvisoMk['estado']; nombre: string; off: string; detalle?: ReactNode }> = [
        { k: 'i24', nombre: 'Inmuebles24', off: 'Inmuebles24', detalle: <>{d.asignacion.porNivel.filter((x) => x.nivel !== 'Offline' && x.nivel !== 'Sin aviso').map((x) => <div key={x.nivel}>{x.nivel}: <b>{f0(x.n)}</b></div>)}</> },
        { k: 'meli', nombre: 'MercadoLibre', off: 'MercadoLibre', detalle: <>{d.asignacion.meli.filter((m) => !['offline', 'sin aviso'].includes(m.tipo)).map((m) => <div key={m.tipo}>{MELI_LBL[m.tipo] ?? m.tipo}: <b>{f0(m.n)}</b></div>)}</> },
        { k: 'pcom', nombre: 'Propiedades.com', off: 'Propiedades.com' },
        { k: 'cyt', nombre: 'Casas y Terrenos', off: 'Casas y Terrenos' },
        { k: 'eb', nombre: 'EasyBroker (tu cuenta)', off: 'EasyBroker' },
    ];

    return (<div>
        <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '9px 13px', fontSize: 11.5, color: '#555', marginBottom: 6 }}>
            {interno && <b>Vista interna (ves también lo que la inmobiliaria no ve, al final). </b>}«7 d» = últimos 7 días (<b>{fecha(d.semana.desde)} – {fecha(d.semana.hasta)}</b>) contra los 7 anteriores ({fecha(d.semanaAnt.desde)} – {fecha(d.semanaAnt.hasta)}).
            Leads únicos (misma persona + misma propiedad = 1), visitas por fecha de la visita y vistas registradas por Pulppo (la mayoría de Inmuebles24).
        </div>

        <Resumen d={d} interno={interno} rotarAuto={rotarAuto.length} rotarAutoCod={rotarAuto.filter((x) => x.leadsEnNivel >= d.reglas.leadsRotar).map((x) => x.codigo)} manual={rotarManual.length} />

        <Seccion n={1} titulo="Qué está publicado y dónde" nota={`Tus ${f0(total)} propiedades publicadas en Pulppo (${f0(d.asignacion.venta)} venta · ${f0(d.asignacion.renta)} renta) y cuántas se están mostrando en cada portal, en qué nivel.${noDif ? ` ${noDif === 1 ? 'Una está marcada' : `${noDif} están marcadas`} como «No difundir en portales» en Pulppo: no cuentan como fuera de línea.` : ''}`}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {PORTALES.map((x) => (
                    <div key={x.k} style={{ flex: '1 1 200px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{x.nombre}</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1.1, margin: '4px 0 2px' }}>{f0(enLinea(x.k))} <span style={{ ...sub, fontFamily: 'Nunito Sans, sans-serif' }}>en línea · {pc(enLinea(x.k), total)}</span></div>
                        {x.detalle && <div style={{ fontSize: 11.5, color: '#555', lineHeight: 1.6 }}>{x.detalle}</div>}
                        {(fuera(x.k) > 0 || sinAviso(x.k) > 0) && <div style={{ fontSize: 11.5, marginTop: 4 }}>
                            {fuera(x.k) > 0 && <button type="button" onClick={() => verFuera(x.off)} title="Ver cuáles son y por qué" style={{ ...btnLiga, color: RED }}>{f0(fuera(x.k))} fuera de línea ↓</button>}{fuera(x.k) > 0 && sinAviso(x.k) > 0 && ' · '}{sinAviso(x.k) > 0 && <button type="button" onClick={() => verFuera(x.off)} title="Ver cuáles son" style={{ ...btnLiga, color: '#777', fontWeight: 600 }}>{f0(sinAviso(x.k))} sin aviso ↓</button>}
                        </div>}
                    </div>
                ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Inmuebles24 por nivel <span style={{ ...sub, fontWeight: 400 }}>· clic en un nivel para ver cuáles son</span></div>
            <Distribucion partes={d.asignacion.i24.map((x) => ({ k: x.nivel, n: x.n, color: COLOR_I24[x.nivel] ?? LGT }))} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 18px' }}>
                {d.asignacion.porNivel.map((x) => (
                    <div key={x.nivel} onClick={() => verNivel(x.nivel)} title="Ver qué propiedades están en este nivel" style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderLeft: `3px solid ${COLOR_I24[x.nivel.replace(/ zona demand$/, '')] ?? LGT}`, borderRadius: R, padding: '8px 10px', background: '#fff', cursor: 'pointer' }}>
                        <div style={{ fontSize: 10.5, color: '#777', fontWeight: 700 }}>{x.nivel} <span style={{ color: SEA }}>↓ ver</span></div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>{f0(x.n)}</div>
                        <div style={sub}>{f0(x.venta)} venta · {f0(x.renta)} renta</div>
                    </div>
                ))}
            </div>
            <div style={{ fontSize: 11.5, color: '#555', margin: '-8px 0 14px' }}>
                De los <b>{f0(zd.zonaDemand + zd.normal)}</b> anuncios en venta, <b>{pc(zd.zonaDemand, zd.zonaDemand + zd.normal)}</b> van en <b>zona demand</b> ({f0(zd.zonaDemand)}) y {pc(zd.normal, zd.zonaDemand + zd.normal)} en su nivel normal ({f0(zd.normal)}).
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>MercadoLibre por nivel</div>
            <Distribucion partes={d.asignacion.meli.map((m) => ({ k: MELI_LBL[m.tipo] ?? m.tipo, n: m.n, color: COLOR_MELI[m.tipo] ?? SEA }))} />
            {interno && (
                <div style={{ marginTop: 14, padding: '10px 12px', border: `1px dashed ${GRY}`, borderRadius: R, fontSize: 11.5, color: '#555' }}>
                    <b>Sólo equipo Pulppo · </b>
                    {d.asignacion.zdProporcion && (() => {
                        const z = d.asignacion.zdProporcion;
                        const inv = z.ventaInv ? (100 * z.ventaEnZd) / z.ventaInv : 0, av = z.premium ? (100 * z.premiumZd) / z.premium : 0;
                        const dif = av - inv;
                        return <>¿Zona demand proporcional? {inv.toFixed(0)}% del inventario de venta está en las 4 alcaldías y {av.toFixed(0)}% de sus premium son zona demand: {Math.abs(dif) <= 10 ? <b style={{ color: SEA }}>va proporcional</b> : <b>{dif > 0 ? '+' : ''}{dif.toFixed(0)} pts</b>}.{z.zdFueraDeZona > 0 && <> Zona demand fuera de las 4 alcaldías: <b>{z.zdFueraCodigos.join(' · ')}</b> (el aviso en i24 está en una colonia vecina de esas alcaldías).</>} </>;
                    })()}
                    {d.asignacion.fijados.length > 0 && <>Fijados a mano: {d.asignacion.fijados.map((x) => `${x.codigo} · ${x.nivel}${x.por ? `, por ${x.por}` : ''}${x.el ? `, ${fecha(x.el)}` : ''}`).join(' · ')}. </>}
                    {d.asignacion.noPromovidos.length > 0 && <>Motivos por los que i24 no promueve: {d.asignacion.noPromovidos.map((x) => `${x.motivo} (${x.n})`).join(' · ')}. </>}
                    EasyBroker = la cuenta propia de la inmobiliaria; el envío de Pulppo a EasyBroker (otra cuenta) hoy está desactivado y no se muestra aquí.
                </div>
            )}
        </Seccion>

        <div id="no-se-muestra" />
        <Seccion n={2} titulo="Lo que no se está mostrando y qué hacer" nota="Anuncios de propiedades publicadas en Pulppo que hoy NO aparecen en algún portal, el motivo que dio el portal y quién lo corrige.">
            {!d.offline.length ? <div style={sub}>Todo se está mostrando.</div> : (<>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <Kpi label="Los corrige la inmobiliaria" value={f0(d.offline.filter((x) => x.quien === 'Inmobiliaria').length)} nota="precio, colonia, duplicados" />
                    <Kpi label="Los revisa Pulppo" value={f0(d.offline.filter((x) => x.quien === 'Pulppo').length)} nota="cupo, envío al portal, errores del portal" />
                </div>
                {filtroOff && <div style={{ fontSize: 12, marginBottom: 6 }}>Mostrando <b>{filtroOff}</b> · <button type="button" onClick={() => setFiltroOff('')} style={{ ...btnLiga, color: SEA }}>ver todos los portales</button></div>}
                <TablaFiltrable key={`off-${filtroOff}`} inicial={filtroOff ? { Portal: filtroOff } : undefined} filas={d.offline} min={980} limite={20} texto={(x) => buscar(x.codigo, `${x.portal} ${x.motivo} ${x.accion}`)}
                    selects={[{ label: 'Portal', v: (x) => x.portal }, { label: 'Quién', v: (x) => x.quien }, op()]}
                    cols={[
                        colProp<(typeof d.offline)[number]>(),
                        { h: 'Portal', v: (x) => x.portal },
                        { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5 }}>{x.motivo}{x.desde ? <span style={sub}> · desde {fecha(x.desde)} {x.desde.slice(0, 4)}{x.nivelAntes ? `, antes ${x.nivelAntes}` : ''}</span> : ''}</span> },
                        { h: 'Qué hacer', v: (x) => x.accion, render: (x) => <span style={{ fontSize: 11.5 }}>{x.accion}</span> },
                        { h: 'Quién', v: (x) => x.quien, render: (x) => <Pill t={x.quien} bg={x.quien === 'Inmobiliaria' ? YEL : LGT} fg={BLK} /> },
                    ]} />
            </>)}
        </Seccion>

        <div id="top-anuncios" />
        <Seccion n={3} titulo="Tus anuncios" nota="Cada propiedad publicada, en qué nivel y portal está y qué está generando. Filtra por portal, nivel, operación, tipo o asesor; ordena con clic en cualquier encabezado.">
            <TablaFiltrable key={`t-${filtroTop}`} inicial={filtroTop ? { 'Nivel i24': filtroTop } : undefined} filas={d.avisos} cols={colsAviso} min={1350} orden={{ i: 10, dir: -1 }}
                texto={(a) => buscar(a.codigo)}
                selects={[
                    { label: 'Nivel i24', v: (a) => a.nivel }, { label: 'MercadoLibre', v: (a) => MELI_LBL[a.meli] ?? a.meli },
                    { label: 'Propiedades.com', v: (a) => a.estado.pcom }, { label: 'Casas y Terrenos', v: (a) => a.estado.cyt }, { label: 'EasyBroker', v: (a) => a.estado.eb },
                    { label: 'Operación', v: (a) => a.operacion }, { label: 'Tipo', v: (a) => a.tipo ?? '' }, { label: 'Asesor', v: (a) => a.asesor },
                ]} />
            <div style={{ ...sub, marginTop: 6 }}>«Vistas i24 / mercado»: vistas del anuncio que reporta Inmuebles24 contra el promedio de anuncios comparables.</div>
        </Seccion>


        <Seccion n={4} titulo="Desempeño por nivel" nota="Vistas → leads → visitas de cada nivel en los últimos 30 días (las barras se comparan entre niveles) y los últimos 7 días contra los 7 anteriores (▲▼). En los niveles de Inmuebles24 cuentan sólo los leads que llegaron por Inmuebles24 (y las visitas de esos compradores); en los de MercadoLibre, sólo los de MercadoLibre. MercadoLibre no reporta vistas.">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {(['Todas', 'Venta', 'Renta'] as Op[]).map((o) => (
                    <button key={o} type="button" onClick={() => setOpNivel(o)} style={{ padding: '5px 13px', fontSize: 12, fontWeight: 600, border: `1px solid ${opNivel === o ? BLK : LGT}`, borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', background: opNivel === o ? BLK : '#fff', color: opNivel === o ? '#fff' : '#555' }}>
                        {o === 'Todas' ? 'Venta y renta' : o}
                    </button>
                ))}
            </div>
            <LLPanel ll={d.ll} op={opNivel} hoy={Object.fromEntries(d.porNivel[opNivel].map((x) => [x.nivel, x.avisos]))} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px' }}>Inmuebles24 · embudo de 30 días <span style={{ ...sub, fontWeight: 400 }}>· leads de Inmuebles24 de los anuncios que hoy están en cada nivel</span></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {nivelesI24.map((x) => <NivelEmbudo key={x.nivel} x={x} max={maxDe(nivelesI24)} color={COLOR_I24[x.nivel.replace(/ zona demand$/, '')]} />)}
                {!nivelesI24.length && <span style={sub}>Sin anuncios en este filtro.</span>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 6px' }}>MercadoLibre <span style={{ ...sub, fontWeight: 400 }}>· leads de MercadoLibre</span></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {nivelesMeli.map((x) => <NivelEmbudo key={x.nivel} x={{ ...x, nivel: MELI_LBL[x.nivel] ?? x.nivel }} max={maxDe(nivelesMeli)} color={COLOR_MELI[x.nivel]} />)}
                {!nivelesMeli.length && <span style={sub}>Sin anuncios en este filtro.</span>}
            </div>
        </Seccion>


        <Seccion n={5} titulo="Cierres por fuente" nota="Cierres de la inmobiliaria (como vendedora o compradora) por el canal por el que llegó el comprador. Revenue = comisión que recibe la inmobiliaria, sin IVA; los % son sobre el revenue. Misma regla de fuente que Desempeño y /portales.">
            <CierresPanel d={d} />
        </Seccion>

        {interno && (<>
        <div style={{ marginTop: 40, padding: '10px 14px', background: BLK, color: '#fff', borderRadius: R, fontSize: 12 }}>
            <b>Sólo equipo Pulppo</b> · lo que la inmobiliaria no ve: lecturas para entender qué funciona y qué rotar.
            {d.scoringPendiente && <div style={{ marginTop: 4, color: YEL }}>El puntaje de anuncios todavía se está calculando (la primera vez del día tarda ~2 min): rotación, exposición y trabadas salen incompletas. Dale «Actualizar» en un par de minutos.</div>}
        </div>
        <Seccion n={6} titulo="Propiedades estrella" nota="Las que más leads reciben (30 días) y si los convierten en visitas. Estrella = 5+ leads y 15%+ visitan. Mucho ruido = 5+ leads y menos de 10% visitan. ">
            <div style={{ fontSize: 11.5, marginBottom: 8 }}><a href="#top-anuncios" onClick={(e) => { e.preventDefault(); document.getElementById('top-anuncios')?.scrollIntoView({ behavior: 'smooth' }); }} style={{ color: SEA, fontWeight: 700 }}>Ver todos tus anuncios ↓</a></div>
            <TablaFiltrable filas={d.estrellas} min={720} texto={(e) => buscar(e.codigo, e.etiqueta)}
                selects={[{ label: 'Lectura', v: (e) => e.etiqueta }, op()]}
                cols={[
                    colProp(),
                    { h: 'Operación', v: (e) => e.operacion },
                    { h: 'Nivel', v: (e) => e.nivel },
                    { h: 'Vistas 30 d', num: true, v: (e) => e.vistas30 },
                    { h: 'Leads 30 d', num: true, v: (e) => e.leads30, render: (e) => <VerLeads codigo={e.codigo} n={e.leads30} negritas /> },
                    { h: 'Visitas 30 d', num: true, v: (e) => e.visitas30 },
                    { h: 'Lead → visita', num: true, v: (e) => (e.conv == null ? null : Math.round(e.conv * 100)), render: (e) => (e.conv == null ? '—' : `${Math.round(e.conv * 100)}%`) },
                    { h: 'Lectura', v: (e) => e.etiqueta, render: (e) => (e.etiqueta === 'Estrella' ? <Pill t="★ Estrella" bg={SEA} fg="#fff" /> : e.etiqueta === 'Mucho ruido, poca visita' ? <Pill t="Mucho ruido, poca visita" bg="#F3D9D3" fg={RED} /> : <Pill t="En camino" bg={LGT} fg={BLK} />) },
                ]} />
        </Seccion>

        <Seccion n={7} titulo="Exposición vs. calidad del inventario" nota="Dónde se está usando un lugar premium sin que rinda, y qué simples merecen subir según el scoring de anuncios. El «por qué» junta vistas, leads, precio contra la colonia, demanda (búsquedas en la zona) y competencia (comparables).">
            <div style={{ fontSize: 12, fontWeight: 700, margin: '4px 0 6px', color: RED }}>Premium sin leads · {f0(d.premiumSinLeads.length)} <span style={{ ...sub, fontWeight: 400 }}>· 2+ semanas en su nivel actual sin un solo lead desde que entró (súper destacados primero)</span></div>
            <TablaFiltrable filas={d.premiumSinLeads} min={860} limite={15} texto={(x) => buscar(x.codigo, x.porque)}
                selects={[niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel },
                    { h: 'Días en el nivel', num: true, v: (x) => x.diasEnNivel, render: (x) => <b>{f0(x.diasEnNivel)}</b> },
                    { h: 'Vistas 30 d', num: true, v: (x) => x.vistas30 },
                    { h: 'Por qué', v: (x) => x.porque, render: (x) => <span style={{ fontSize: 11.5 }}>{x.porque}</span> },
                ]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px' }}>Premium que no está rindiendo · {f0(d.desperdicio.length)} <span style={{ ...sub, fontWeight: 400 }}>· con 2+ semanas en su nivel: sin leads en 30 días, con precio fuera de su zona o ficha incompleta</span></div>
            <TablaFiltrable filas={d.desperdicio} min={860} limite={15} texto={(x) => buscar(x.codigo, x.motivo)}
                selects={[niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel },
                    { h: 'Vistas 30 d', num: true, v: (x) => x.vistas30 },
                    { h: 'Leads 30 d', num: true, v: (x) => x.leads30 },
                    { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5, color: RED }}>{x.motivo}</span> },
                ]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px', color: SEA }}>Simples que merecen subir · {f0(d.subir.length)}</div>
            <TablaFiltrable filas={d.subir} min={560} texto={(x) => buscar(x.codigo)} selects={[op()]}
                vacio="Ninguna simple pasa el scoring esta semana."
                cols={[
                    colProp(),
                    { h: 'Puntaje', num: true, v: (x) => x.puntos, render: (x) => <b style={{ color: SEA }}>{x.puntos}</b> },
                    { h: 'Leads 30 d', num: true, v: (x) => x.leads30 },
                    { h: 'Búsquedas en la zona', num: true, v: (x) => x.demanda },
                    { h: 'Comparables compitiendo', num: true, v: (x) => x.competencia },
                ]} />
        </Seccion>

        <Seccion n={8} titulo="Rotación: qué promover y qué rotar">
            <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '8px 12px', fontSize: 12, color: '#555', marginBottom: 12 }}>
                Cómo funciona el scoring: ver presentación (próximamente).
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: SEA }}>Promover esta semana · {f0(Math.min(10, d.subir.length))}</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 14 }}>
                {d.subir.slice(0, 10).map((x) => <div key={x.codigo} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><Prop codigo={x.codigo} /><span style={sub}>puntaje {x.puntos}</span></div>)}
                {!d.subir.length && <span style={sub}>Ninguna simple pasa el filtro esta semana.</span>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: RED }}>Rotar a Simple · {f0(rotarAuto.length)}</div>
            <TablaFiltrable filas={rotarAuto} min={720} texto={(x) => buscar(x.codigo, x.motivo)} selects={[niv(), op()]}
                vacio="Nada que rotar según el scoring."
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel, render: (x) => <>{x.nivel}<div style={sub}>desde {fecha(x.desde)}</div></> },
                    { h: 'Leads en su lugar', num: true, v: (x) => x.leadsEnNivel },
                    { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5 }}>{x.motivo}</span> },
                ]} />
            <div style={{ fontSize: 12, fontWeight: 700, margin: '18px 0 6px' }}>Decisión manual · {f0(rotarManual.length)} <span style={{ ...sub, fontWeight: 400 }}>· rentas, terrenos, comerciales y zonas sin datos del mercado en un lugar premium: el scoring no las evalúa, decide la persona con los leads que lleva en su lugar</span></div>
            <TablaFiltrable filas={rotarManual} min={720} texto={(x) => buscar(x.codigo, x.motivo)} selects={[niv(), op()]}
                vacio="Nada pendiente de decidir a mano."
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel, render: (x) => <>{x.nivel}<div style={sub}>desde {fecha(x.desde)}</div></> },
                    { h: 'Leads en su lugar', num: true, v: (x) => x.leadsEnNivel, render: (x) => <b>{f0(x.leadsEnNivel)}</b> },
                    { h: 'Leads 30 d', num: true, v: (x) => porCodigo.get(x.codigo)?.leads30 ?? null, render: (x) => <VerLeads codigo={x.codigo} n={porCodigo.get(x.codigo)?.leads30 ?? 0} /> },
                    { h: 'Por qué', v: (x) => x.motivo, render: (x) => <span style={{ fontSize: 11.5, color: '#666' }}>{x.motivo}</span> },
                ]} />
            <div style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6, maxWidth: 880 }}>
                <b>Acciones manuales sugeridas mientras probamos el scoring</b>
                {d.rotar.some((x) => x.leadsEnNivel >= d.reglas.leadsRotar) && <div>· Bajar a Simple las {f0(d.rotar.filter((x) => x.leadsEnNivel >= d.reglas.leadsRotar).length)} que ya juntaron {d.reglas.leadsRotar}+ leads en su lugar y subir en su lugar las de «Promover esta semana».</div>}
                <div>· Las premium sin leads: si la ven y no escriben, conversación de precio con el propietario; si casi nadie la ve, revisar zona y título antes de seguir dándole el lugar.</div>
                <div>· Las premium con ficha incompleta: completar fotos y video esta semana; si no, bajarlas a Simple.</div>
                <div>· Revisar cada lunes esta pestaña contra la semana anterior y ajustar a mano lo que el scoring todavía no resuelve.</div>
            </div>
        </Seccion>

        <Seccion n={9} titulo="Propiedades trabadas que necesitan auxilio" nota="Publicadas hace 90+ días, sin ninguna oferta, y con 2 o menos leads en 90 días, o con 5+ leads pero ninguna visita. El freno probable, por qué y una acción concreta.">
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{f0(d.trabadas.length)}</b> propiedades · {Object.entries(d.trabadas.reduce<Record<string, number>>((m, x) => ({ ...m, [x.freno]: (m[x.freno] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}</div>
            <TablaFiltrable filas={d.trabadas} min={1100} texto={(x) => buscar(x.codigo, `${x.freno} ${x.porque}`)}
                selects={[{ label: 'Freno', v: (x) => x.freno }, niv(), op()]}
                cols={[
                    colProp(),
                    { h: 'Nivel', v: (x) => x.nivel, render: (x) => <span style={{ fontSize: 11 }}>{x.nivel}</span> },
                    { h: 'Días publicada', num: true, v: (x) => x.dias },
                    { h: 'Vistas i24 / mercado', num: true, v: (x) => x.vistasI24, render: (x) => <span style={{ color: x.vistasI24 != null && x.vistasMercadoI24 && x.vistasI24 < 0.5 * x.vistasMercadoI24 ? RED : '#666' }}>{x.vistasI24 ?? '—'} / {x.vistasMercadoI24 ?? '—'}</span> },
                    { h: 'Leads 90 d', num: true, v: (x) => x.leads90 },
                    { h: 'Visitas 90 d', num: true, v: (x) => x.visitas90 },
                    { h: 'Freno', v: (x) => x.freno, render: (x) => <Pill t={x.freno} bg={x.freno.startsWith('Precio') ? '#F3D9D3' : x.freno === 'Ficha' ? YEL : LGT} fg={x.freno.startsWith('Precio') ? RED : BLK} /> },
                    { h: 'Por qué', v: (x) => x.porque, render: (x) => <span style={{ fontSize: 11 }}>{x.porque}</span> },
                    { h: 'Acción', v: (x) => x.accion, render: (x) => <span style={{ fontSize: 11.5 }}>{x.accion}</span> },
                ]} />
        </Seccion>

        </>)}
        <p style={{ fontSize: 10, color: GRY, marginTop: 16 }}>En vivo desde Mongo · {new Date(d.generado).toLocaleString('es-MX')}</p>
        {leadsDe && <LeadsModal companyId={d.companyId} pedido={leadsDe} onClose={() => setLeadsDe(null)} etiqueta={porCodigo.get(leadsDe.codigo)} />}
    </div>);
}

/** Cierres por fuente con filtros de periodo, estatus y operación (Joshua). Revenue = comisión sin IVA que
 *  recibe la inmobiliaria; los % van contra el revenue, no contra el número de operaciones. */
function CierresPanel({ d }: { d: MarketingMk }) {
    const [periodo, setPeriodo] = useState<'d90' | 'anio'>('d90');
    // estatus con casillas (Ale): se suman los que marques. Cerradas y cobrando = cierres; el resto, en curso.
    const ESTATUS_OPC = ['Cerrada', 'Cobrando', 'Contrato', 'Oferta aceptada', 'Oferta'] as const;
    const [estatus, setEstatus] = useState<Set<string>>(new Set(['Cerrada', 'Cobrando']));
    const pasa = (e: string) => estatus.has(e);
    const esperado = [...estatus].some((e) => e !== 'Cerrada' && e !== 'Cobrando');
    const [oper, setOper] = useState<'Total' | 'Venta' | 'Renta'>('Total');
    const base = d.cierres.lista.filter((c) => (periodo === 'anio' || c.fecha >= d.cierres.desde90) && pasa(c.estatus));
    const xs = base.filter((c) => oper === 'Total' || c.operacion === oper);
    const rev = xs.reduce((s, c) => s + c.comision, 0);
    const revBase = base.reduce((s, c) => s + c.comision, 0);
    const porOp = (['Venta', 'Renta'] as const).map((o) => ({ o, n: base.filter((c) => c.operacion === o).length, rev: base.filter((c) => c.operacion === o).reduce((s, c) => s + c.comision, 0) }));
    const fuentes = [...xs.reduce((m, c) => { const e = m.get(c.fuente) ?? { n: 0, rev: 0, venta: 0, renta: 0 }; e.n++; e.rev += c.comision; if (c.operacion === 'Renta') e.renta += c.comision; else e.venta += c.comision; return m.set(c.fuente, e); }, new Map<string, { n: number; rev: number; venta: number; renta: number }>())]
        .map(([fuente, v]) => ({ fuente, ...v })).sort((a, b) => b.rev - a.rev);
    const max = Math.max(1, ...fuentes.map((x) => x.rev));
    const money = (v: number) => `$${f0(Math.round(v))}`;
    const Boton = <K extends string>({ v, act, set, children }: { v: K; act: K; set: (k: K) => void; children: ReactNode }) => (
        <button type="button" onClick={() => set(v)} style={{ padding: '5px 11px', fontSize: 12, border: `1px solid ${act === v ? BLK : LGT}`, borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', background: act === v ? BLK : '#fff', color: act === v ? '#fff' : '#555' }}>{children}</button>);
    return (
        <div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                <span style={{ display: 'flex', gap: 6 }}><Boton v="d90" act={periodo} set={setPeriodo}>Últimos 90 días</Boton><Boton v="anio" act={periodo} set={setPeriodo}>En el año</Boton></span>
                <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, border: `1px solid ${LGT}`, borderRadius: R, padding: '5px 10px' }}>
                    {ESTATUS_OPC.map((k) => (
                        <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={estatus.has(k)} onChange={() => setEstatus((p) => { const x = new Set(p); if (x.has(k)) x.delete(k); else x.add(k); return x; })} />
                            {k === 'Cerrada' ? 'Cerrada (cobrada)' : k}
                        </label>
                    ))}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>{(['Total', 'Venta', 'Renta'] as const).map((k) => <Boton key={k} v={k} act={oper} set={setOper}>{k}</Boton>)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <Kpi label={esperado ? 'Revenue esperado' : 'Revenue'} value={money(rev)} nota={`${f0(xs.length)} ${esperado ? 'operaciones en curso' : 'cierres'} · comisión sin IVA`} />
                {porOp.map((x) => <Kpi key={x.o} label={`${x.o} · % del revenue`} value={pc(x.rev, revBase)} nota={`${money(x.rev)} · ${f0(x.n)} ${esperado ? 'operaciones' : 'cierres'}`} />)}
            </div>
            {!xs.length ? <div style={sub}>Sin cierres con estos filtros.</div> : (
                <div style={{ maxWidth: 820 }}>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, marginBottom: 6 }}>
                        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: SEA, marginRight: 5, verticalAlign: 'middle' }} />Venta</span>
                        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: YEL, marginRight: 5, verticalAlign: 'middle' }} />Renta</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: `1px solid ${BLK}`, padding: '0 0 4px' }}>
                        <span style={{ width: 190 }}>Fuente</span><span style={{ flex: 1 }}>Revenue</span><span style={{ width: 120, textAlign: 'right' }}>Revenue</span><span style={{ width: 70, textAlign: 'right' }}>% revenue</span><span style={{ width: 60, textAlign: 'right' }}>{esperado ? 'Operac.' : 'Cierres'}</span>
                    </div>
                    {fuentes.map((x) => (
                        <div key={x.fuente} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0', fontSize: 12 }}>
                            <span style={{ width: 190, flexShrink: 0 }}>{x.fuente}</span>
                            <span style={{ flex: 1, background: LGT, height: 14, display: 'flex' }} title={`Venta $${f0(Math.round(x.venta))} · Renta $${f0(Math.round(x.renta))}`}>
                                <span style={{ display: 'block', height: 14, width: `${(100 * x.venta) / max}%`, background: SEA }} />
                                <span style={{ display: 'block', height: 14, width: `${(100 * x.renta) / max}%`, background: YEL }} />
                            </span>
                            <span style={{ width: 120, textAlign: 'right' }}>{money(x.rev)}</span>
                            <span style={{ width: 70, textAlign: 'right' }}><b>{pc(x.rev, rev)}</b></span>
                            <span style={{ width: 60, textAlign: 'right', color: '#666' }}>{f0(x.n)}</span>
                        </div>
                    ))}
                </div>
            )}
            {xs.length > 0 && (
                <details style={{ marginTop: 12, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Ver {esperado ? 'las' : 'los'} {f0(xs.length)} {esperado ? 'operaciones' : 'cierres'}</summary>
                    <div style={{ marginTop: 8 }}>
                        <TablaFiltrable filas={xs} min={980} limite={25} orden={{ i: 0, dir: -1 }} texto={(c) => [c.codigo, c.tipo, c.colonia, c.fuente, c.asesor].filter(Boolean).join(' ')}
                            selects={[{ label: 'Fuente', v: (c: CierreMk) => c.fuente }, { label: 'Lado', v: (c: CierreMk) => c.lado }]}
                            cols={[
                                { h: 'Fecha', v: (c) => c.fecha, render: (c) => `${fecha(c.fecha)} ${c.fecha.slice(0, 4)}` },
                                { h: 'Propiedad', v: (c) => c.codigo, render: (c) => <div><b>{c.codigo ?? '—'}</b><OpTag op={c.operacion} /> <span style={sub}>{c.tipo}</span><div style={{ fontSize: 11.5 }}>{c.colonia ?? ''}</div></div> },
                                { h: 'Asesor', v: (c) => c.asesor, render: (c) => <span style={{ fontSize: 11.5 }}>{c.asesor}</span> },
                                { h: 'Lado', v: (c) => c.lado },
                                { h: 'Fuente', v: (c) => c.fuente },
                                { h: 'Estatus', v: (c) => c.estatus },
                                { h: 'Revenue', num: true, v: (c) => c.comision, render: (c) => money(c.comision) },
                            ]} />
                    </div>
                </details>
            )}
        </div>
    );
}

/** Lista de leads de una propiedad: nombre, fuente, medio, teléfono y correo (Joshua). Datos personales: se
 *  piden al abrir y no se guardan. */
function LeadsModal({ companyId, pedido, onClose, etiqueta }: { companyId: string; pedido: { codigo: string; dias: number; portal?: string }; onClose: () => void; etiqueta?: AvisoMk }) {
    const [filas, setFilas] = useState<Array<Record<string, string | null>> | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        const qs = new URLSearchParams({ company: companyId, codigo: pedido.codigo, dias: String(pedido.dias), ...(pedido.portal ? { portal: pedido.portal } : {}) });
        fetch(`/api/mb-marketing/leads?${qs}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) setFilas(j.leads); else setErr(j.error || 'No se pudo cargar'); })
            .catch(() => vivo && setErr('No se pudo cargar'));
        return () => { vivo = false; };
    }, [companyId, pedido]);
    type L = Record<string, string | null>;
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(33,35,34,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R, width: 'min(1100px, 100%)', maxHeight: '86vh', overflow: 'auto', padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21 }}>Leads de {pedido.codigo} · últimos {pedido.dias} días</div>
                        {etiqueta && <div style={sub}>{[etiqueta.tipo, etiqueta.operacion, [etiqueta.calle, etiqueta.colonia].filter(Boolean).join(', '), etiqueta.asesor].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <button type="button" onClick={onClose} style={{ border: `1px solid ${LGT}`, background: '#fff', borderRadius: R, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Cerrar ✕</button>
                </div>
                <div style={{ marginTop: 12 }}>
                    {err ? <p style={{ color: RED, fontSize: 13 }}>{err}</p> : !filas ? <p style={{ ...sub, fontSize: 12 }}>Cargando…</p> : (
                        <TablaFiltrable<L> filas={filas} min={900} limite={50} orden={{ i: 0, dir: -1 }}
                            texto={(l) => [l.nombre, l.fuente, l.medio, l.telefono, l.correo, l.asesor].filter(Boolean).join(' ')}
                            selects={[{ label: 'Fuente', v: (l) => l.fuente ?? '' }, { label: 'Medio', v: (l) => l.medio ?? '' }]}
                            vacio="Sin leads en este periodo."
                            cols={[
                                { h: 'Fecha', v: (l) => l.fecha, render: (l) => (l.fecha ? new Date(l.fecha).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—') },
                                { h: 'Nombre', v: (l) => l.nombre },
                                { h: 'Fuente', v: (l) => l.fuente },
                                { h: 'Medio', v: (l) => l.medio },
                                { h: 'Teléfono', v: (l) => l.telefono },
                                { h: 'Correo', v: (l) => l.correo },
                                { h: 'Asesor', v: (l) => l.asesor, render: (l) => <span style={{ fontSize: 11.5 }}>{l.asesor ?? '—'}</span> },
                                { h: 'Mensaje', v: (l) => l.mensaje, render: (l) => <span style={{ fontSize: 11, color: '#666' }}>{l.mensaje ?? '—'}</span> },
                            ]} />
                    )}
                </div>
            </div>
        </div>
    );
}

/** La semana en corto: lo que cambió en 7 días y qué hacer. Todo sale de las mismas secciones de abajo. */
function Resumen({ d, interno, rotarAuto, rotarAutoCod, manual }: { d: MarketingMk; interno: boolean; rotarAuto: number; rotarAutoCod: string[]; manual: number }) {
    const s = (k: (a: AvisoMk) => number) => d.avisos.reduce((t, a) => t + k(a), 0);
    const leads = s((a) => a.leadsSem), leadsAnt = s((a) => a.leadsSemAnt);
    const i24 = s((a) => a.i24.leadsSem), i24Ant = s((a) => a.i24.leadsSemAnt);
    const meli = s((a) => a.meliE.leadsSem), meliAnt = s((a) => a.meliE.leadsSemAnt);
    const vis = s((a) => a.visitasSem), visAnt = s((a) => a.visitasSemAnt);
    const l90 = d.cierres.lista.filter((c) => c.fecha >= d.cierres.desde90 && (c.estatus === 'Cerrada' || c.estatus === 'Cobrando'));
    const f90 = Object.entries(l90.reduce<Record<string, number>>((m, c) => ({ ...m, [c.fuente]: (m[c.fuente] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const frenos = Object.entries(d.trabadas.reduce<Record<string, number>>((m, x) => ({ ...m, [x.freno]: (m[x.freno] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const Linea = ({ children }: { children: ReactNode }) => <div style={{ padding: '6px 0', borderBottom: `1px solid ${LGT}`, fontSize: 12.5 }}>{children}</div>;
    const acciones: ReactNode[] = [];
    const tuyas = d.offline.filter((x) => x.quien === 'Inmobiliaria');
    const irA = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); };
    if (tuyas.length) acciones.push(<><b>{f0(tuyas.length)}</b> {tuyas.length === 1 ? 'anuncio no se muestra' : 'anuncios no se muestran'} por algo que puedes corregir ({[...new Set(tuyas.map((x) => x.portal))].join(', ')}): <a href="#no-se-muestra" onClick={irA('no-se-muestra')} style={{ color: SEA, fontWeight: 700 }}>ver qué hacer ↓</a></>);
    if (d.premiumSinLeads.length) acciones.push(<><b>{f0(d.premiumSinLeads.length)}</b> {d.premiumSinLeads.length === 1 ? 'anuncio destacado lleva' : 'anuncios destacados llevan'} 2+ semanas sin un solo lead ({d.premiumSinLeads.slice(0, 3).map((x) => x.codigo).join(', ')}{d.premiumSinLeads.length > 3 ? '…' : ''}): revisar precio y fotos con el asesor.</>);
    // lo de rotación y scoring es trabajo de Pulppo: sólo en la vista interna
    if (interno) {
    if (rotarAutoCod.length) acciones.push(<>Bajar a Simple <b>{f0(rotarAutoCod.length)}</b> que ya juntaron {d.reglas.leadsRotar}+ leads en su lugar ({rotarAutoCod.slice(0, 4).join(', ')}{rotarAutoCod.length > 4 ? '…' : ''}).</>);
    else if (rotarAuto) acciones.push(<>Revisar <b>{f0(rotarAuto)}</b> premium que el scoring no recomienda (sección 7).</>);
    if (manual) acciones.push(<><b>{f0(manual)}</b> rentas, terrenos o comerciales en premium esperan decisión manual.</>);
    if (d.subir.length) acciones.push(<>Subir <b>{f0(d.subir.length)}</b> simples que pasan el scoring.</>);
    if (d.trabadas.length) acciones.push(<><b>{f0(d.trabadas.length)}</b> trabadas con 90+ días{frenos.length ? <>; el freno más común es <b>{frenos[0][0].toLowerCase()}</b> ({f0(frenos[0][1])})</> : ''}.</>);
    }
    return (
        <section style={{ marginTop: 14, border: `1px solid ${LGT}`, borderTop: `2px solid ${YEL}`, borderRadius: R, padding: '14px 18px', background: '#fff' }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: '0 0 6px' }}>La semana en corto</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0 28px' }}>
                <div>
                    <Linea><b>{f0(leads)}</b> leads en 7 días<Delta a={leads} b={leadsAnt} /> <span style={sub}>· Inmuebles24 {f0(i24)}</span><Delta a={i24} b={i24Ant} /> <span style={sub}>· MercadoLibre {f0(meli)}</span><Delta a={meli} b={meliAnt} /></Linea>
                    <Linea><b>{f0(vis)}</b> visitas en 7 días<Delta a={vis} b={visAnt} /></Linea>
                    <Linea><b>{f0(l90.length)}</b> cierres en 90 días{f90.length ? <> · {f90.slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ')}</> : ''}</Linea>
                </div>
                <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700, padding: '6px 0 2px' }}>Qué hacer esta semana</div>
                    {acciones.length ? acciones.map((x, i) => <Linea key={i}>{x}</Linea>) : <Linea><span style={sub}>Nada urgente.</span></Linea>}
                </div>
            </div>
        </section>
    );
}

/** L/L (leads sobre listing) por nivel de i24: leads de i24 que llegaron con el aviso en ese nivel ÷ avisos
 *  que de verdad estuvieron vivos en ese nivel durante el periodo (aviso-días ÷ días). No es la foto de hoy. */
const COLOR_LL: Record<string, { c: string; dash?: string }> = {
    'Súper destacado · Premier': { c: DORADO },
    'Súper destacado': { c: YEL }, 'Súper destacado zona demand': { c: '#C79A00', dash: '5 3' },
    Destacado: { c: SEA }, 'Destacado zona demand': { c: SEA, dash: '5 3' }, Simple: { c: BLK },
};
function LLPanel({ ll, op, hoy }: { ll: LLMk; op: Op; hoy: Record<string, number> }) {
    const [dias, setDias] = useState(30);
    const niveles = Object.keys(COLOR_LL).filter((n) => ll.series.some((s) => s.nivel === n));
    const suma = (n: string, k: 'avisoDias' | 'leads', a: number, b: number) =>
        ll.series.filter((s) => s.nivel === n && (op === 'Todas' || s.op === op)).reduce((t, s) => t + s[k].slice(a, b).reduce((x, y) => x + y, 0), 0);
    const fin = ll.dias, ini = Math.max(0, fin - dias);
    const filas = niveles.map((n) => {
        const ad = suma(n, 'avisoDias', ini, fin), le = suma(n, 'leads', ini, fin);
        const avisos = ad / (fin - ini);
        return { n, avisos, leads: le, ll: avisos >= 1 ? le / avisos : null };
    }).filter((x) => x.avisos > 0 || x.leads > 0);
    // serie semanal (7 días que terminan hoy, hacia atrás) para seguirlo en el tiempo
    const semanas = Math.floor(ll.dias / 7);
    const serie = Array.from({ length: semanas }, (_, w) => {
        const b = fin - (semanas - 1 - w) * 7, a = b - 7;
        const d0 = new Date(Date.parse(`${ll.desde}T12:00:00Z`) + a * 86400000);
        const row: Record<string, number | string | null> = { semana: `${d0.getUTCDate()} ${MES[d0.getUTCMonth()]}` };
        // con menos de 3 avisos vivos en promedio, 1–2 leads disparan el L/L (Destacado zona demand llegaba a 17): no se grafica
        for (const n of niveles) { const av = suma(n, 'avisoDias', a, b) / 7, le = suma(n, 'leads', a, b); row[n] = av >= 3 ? Math.round((le / av) * 100) / 100 : null; }
        return row;
    });
    if (!ll.dias) return <div style={sub}>No se pudo calcular el L/L.</div>;
    return (
        <div style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '12px 14px', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>L/L por nivel en Inmuebles24 <span style={{ ...sub, fontWeight: 400 }}>· leads sobre listing{op !== 'Todas' ? ` · ${op.toLowerCase()}` : ''}</span></div>
                <span style={{ display: 'flex', gap: 6 }}>
                    {[7, 30, 60, 90, 182].map((x) => (
                        <button key={x} type="button" onClick={() => setDias(x)} style={{ padding: '4px 10px', fontSize: 11.5, border: `1px solid ${dias === x ? BLK : LGT}`, borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', background: dias === x ? BLK : '#fff', color: dias === x ? '#fff' : '#555' }}>
                            {x === 182 ? '6 meses' : `${x} días`}
                        </button>
                    ))}
                </span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0 12px' }}>
                {filas.map((x) => (
                    <div key={x.n} style={{ flex: '1 1 170px', border: `1px solid ${LGT}`, borderLeft: `3px solid ${COLOR_LL[x.n].c}`, borderRadius: R, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10.5, color: '#777', fontWeight: 700 }}>{x.n}</div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24 }}>{x.ll == null ? '—' : x.ll.toFixed(2)} <span style={{ ...sub, fontFamily: 'Nunito Sans, sans-serif' }}>L/L</span></div>
                        <div style={{ fontSize: 12, margin: '2px 0 3px' }}><b>{f0(hoy[x.n] ?? 0)}</b> avisos hoy · <b>{f0(x.leads)}</b> leads en {dias === 182 ? '6 meses' : `${dias} días`}</div>
                        <div style={sub}>{(hoy[x.n] ?? 0) >= 2 * Math.max(1, x.avisos)
                            ? <>Hoy hay más que en el periodo: en promedio estuvieron vivos {x.avisos.toFixed(1)} por día{x.n.includes('Premier') ? ' (la cuenta arrancó el 22 oct)' : ''}. El L/L divide entre los avisos que de verdad estuvieron cada día; no deja fuera los que no tuvieron leads.</>
                            : <>L/L = leads del periodo ÷ {x.avisos.toFixed(1)} avisos vivos en promedio (con o sin leads).{x.avisos < 3 ? ' Pocos avisos: tómalo con cuidado.' : ''}</>}</div>
                    </div>
                ))}
                {!filas.length && <span style={sub}>Sin avisos en este filtro.</span>}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>Semana a semana <span style={{ ...sub, fontWeight: 400 }}>· L/L de cada semana (últimos 6 meses)</span></div>
            <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                    <LineChart data={serie} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={LGT} vertical={false} />
                        <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#777' }} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: '#777' }} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: R }} formatter={(v) => (v == null ? '—' : Number(v).toFixed(2))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {niveles.map((n) => <Line key={n} type="monotone" dataKey={n} stroke={COLOR_LL[n].c} strokeDasharray={COLOR_LL[n].dash} strokeWidth={2} dot={false} connectNulls={false} />)}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <div style={{ ...sub, marginTop: 4, lineHeight: 1.5 }}>
                Semanas con menos de 3 avisos vivos en el nivel no se grafican. Leads = leads únicos de Inmuebles24, contados en el nivel que tenía el aviso cuando llegó el lead. Avisos = los que estuvieron publicados en ese nivel durante el periodo, en promedio por día (incluye los que ya se vendieron o se bajaron). Offline no cuenta.
            </div>
        </div>
    );
}
