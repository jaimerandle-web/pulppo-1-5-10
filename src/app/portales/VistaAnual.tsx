'use client';
// /portales → la vista del año (nov-2026): Tablero · Por portal · Por inmobiliaria · Publicación.
//
// Ale: «poder verlo por portal y filtrar por inmobiliaria, ver el desempeño a través del año y detectar focos
// rojos reales a primera vista (que sea muy gráfico)». Lo que funcionó en /mb de Diamond House: un resumen
// arriba, UNA barra de filtros que mueve todo, cada número contra su referencia y alertas con umbral.
//
// Datos: 13 cubos mensuales (canal × inmobiliaria × operación) + inventario por mes + la foto de publicación,
// pedidos en paralelo a /api/portales/anual. Todo lo demás (filtros, series, focos) se corta aquí, sin volver a
// consultar. Mismo cálculo que /mb (leads únicos, hora México). Lógica en lib/portales/focos.ts.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
    Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { InventarioMeses, MesCubo } from '@/lib/portales/anual';
import type { PublicacionView } from '@/lib/portales/publicacion';
import { ORDEN_INMOBILIARIAS } from '@/lib/portales/ordenInmobiliarias';
import {
    PORTALES, PORTAL, agregarCeldas, agregarCierres, etiquetaRango, focosDe, inventarioDe, mesCorto, mesLargo, ordenar, portalDeCanal, portalDeFuente,
    promedio, referencias, avanceMes, sumar, tasa, vacio, type Agg, type Filtro, type Foco, type MesInfo, type Rango, type Serie,
} from '@/lib/portales/focos';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const money = (n?: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);

export type VistaA = 'tablero' | 'portal' | 'inmos' | 'publicacion';
interface Opcion { nombre: string; kam: string | null; tier: string | null }

// ── piezas visuales ────────────────────────────────────────────────────────────────────────────────
/** mini-barras de 13 meses; el mes en curso va en gris claro (está a medias) */
function Spark({ vals, parcialUlt, color = BLK, alto = 26, ancho = 5 }: { vals: number[]; parcialUlt?: boolean; color?: string; alto?: number; ancho?: number }) {
    const max = Math.max(...vals, 1);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: alto }}>
            {vals.map((v, i) => {
                const ult = i === vals.length - 1;
                return <span key={i} title={f0(v)} style={{ width: ancho, height: Math.max(2, Math.round((v / max) * alto)), borderRadius: 1,
                    background: ult && parcialUlt ? '#E2E2E2' : i >= vals.length - (parcialUlt ? 2 : 1) ? color : GRY }} />;
            })}
        </span>
    );
}
function Delta({ v, pts = false, invertir = false, sufijo }: { v: number | null; pts?: boolean; invertir?: boolean; sufijo?: string }) {
    if (v == null || !isFinite(v)) return <span style={{ color: GRY }}>—</span>;
    const r = Math.round(v * 10) / 10;
    const bueno = invertir ? r < 0 : r > 0;
    return (
        <span style={{ color: r === 0 ? GRY : bueno ? SEA : RED, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {r > 0 ? '▲ +' : r < 0 ? '▼ ' : ''}{pts ? `${r} pts` : `${Math.round(r)}%`}{sufijo ? <span style={{ color: '#888', fontWeight: 400 }}> {sufijo}</span> : null}
        </span>
    );
}
function Tile({ label, value, delta, spark, nota }: { label: string; value: string; delta?: ReactNode; spark?: ReactNode; nota?: string }) {
    return (
        <div style={{ background: '#fff', border: `1px solid ${LGT}`, padding: '12px 14px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, margin: '6px 0 4px' }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, lineHeight: 1 }}>{value}</div>
                {spark}
            </div>
            <div style={{ fontSize: 11 }}>{delta}</div>
            {nota && <div style={{ fontSize: 10, color: '#888', marginTop: 3, lineHeight: 1.3 }}>{nota}</div>}
        </div>
    );
}
function H2({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
    return (
        <div style={{ margin: '26px 0 10px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px' }}>{children}</div>
            {sub && <div style={{ fontSize: 11.5, color: '#777', marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
        </div>
    );
}
const COLOR_SEV: Record<string, string> = { alta: RED, media: YEL, bueno: SEA, nota: GRY };
function ListaFocos({ titulo, focos, vacio: txtVacio, onIr }: { titulo: string; focos: Foco[]; vacio: string; onIr?: (f: Foco) => void }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>{titulo}</div>
            {!focos.length && <div style={{ fontSize: 12, color: '#888', padding: '10px 0' }}>{txtVacio}</div>}
            {focos.map((f, k) => (
                <div key={k} onClick={onIr && f.filtro ? () => onIr(f) : undefined}
                    style={{ borderLeft: `4px solid ${COLOR_SEV[f.sev]}`, background: '#fff', border: `1px solid ${LGT}`, borderLeftColor: COLOR_SEV[f.sev], borderLeftWidth: 4,
                        padding: '9px 12px', borderRadius: R, marginBottom: 6, cursor: onIr && f.filtro ? 'pointer' : 'default' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 12.5 }}>{f.quien}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f.cifra}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#555', marginTop: 2, lineHeight: 1.4 }}>{f.que}</div>
                    {!!f.mas?.length && <div style={{ fontSize: 11, color: '#777', marginTop: 3, lineHeight: 1.4 }}>Además: {f.mas.join(' · ')}</div>}
                </div>
            ))}
        </div>
    );
}
/** las que se van de Pulppo (o ya se fueron): sus caídas son esperadas, no son focos */
const SALIENDO = new Set(ORDEN_INMOBILIARIAS.filter((x) => !x.seQueda || /baja/i.test(x.tier)).map((x) => x.nombre));
const tip = { contentStyle: { fontSize: 11.5, borderRadius: R, border: `1px solid ${LGT}` }, labelStyle: { fontWeight: 700 } };

// ── periodo ────────────────────────────────────────────────────────────────────────────────────────
type ModoP = 'mes' | 'trim' | 'rango' | 'anio';
interface Periodo { modo: ModoP; a: string; b: string }
const TRIM = ['T1', 'T2', 'T3', 'T4'];
const trimDe = (m: string) => `${m.slice(0, 4)}-${TRIM[Math.floor((Number(m.slice(5)) - 1) / 3)]}`;

// ── estatus de operación (cierres + forecast) ─────────────────────────────────────────────────────
const ESTADOS: Array<{ k: 'closed' | 'paying' | 'contract' | 'offer_blocked' | 'offer'; l: string; c: string }> = [
    { k: 'closed', l: 'Cerrada', c: SEA }, { k: 'paying', l: 'Cobrando', c: '#3F7373' },
    { k: 'contract', l: 'Contrato', c: BLK }, { k: 'offer_blocked', l: 'Oferta aceptada', c: '#C79A00' }, { k: 'offer', l: 'Oferta', c: GRY },
];

// ── componente ─────────────────────────────────────────────────────────────────────────────────────
export default function VistaAnual({ vista, setVista }: { vista: VistaA; setVista: (v: VistaA) => void }) {
    const [meses, setMeses] = useState<string[]>([]);
    const [cubos, setCubos] = useState<Record<string, MesCubo>>({});
    const [inv, setInv] = useState<InventarioMeses | null>(null);
    const [pub, setPub] = useState<PublicacionView | null>(null);
    const [opciones, setOpciones] = useState<Opcion[]>([]);
    const [err, setErr] = useState<string | null>(null);

    // filtros (uno solo para las cuatro vistas)
    const [portales, setPortales] = useState<string[]>([]);
    const [kam, setKam] = useState('');
    const [inmo, setInmo] = useState('');
    const [op, setOp] = useState<'todas' | 'sale' | 'rent'>('todas');
    const [portalFoco, setPortalFoco] = useState('i24');
    const [periodo, setPeriodo] = useState<Periodo | null>(null);

    const pedir = (q: string) => fetch(`/api/portales/anual?${q}`).then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))));
    useEffect(() => {
        pedir('view=meses').then((j: { meses: string[] }) => {
            setMeses(j.meses);
            // del más nuevo al más viejo, de 4 en 4: en frío cada mes son 30–90 s de Mongo y los 13 juntos lo ahogan
            const cola = [...j.meses].reverse();
            const sig = (): Promise<void> | undefined => {
                const m = cola.shift();
                if (!m) return;
                return pedir(`view=mes&mes=${m}`).then((c: MesCubo) => { setCubos((p) => ({ ...p, [m]: c })); return sig(); }).catch((e) => setErr(String(e)));
            };
            for (let k = 0; k < 4; k++) sig();
        }).catch((e) => setErr(String(e)));
        pedir('view=inventario').then(setInv).catch(() => setInv({ generado: '', meses: {} }));
        fetch('/api/portales/inmobiliarias?view=opciones').then((r) => r.json()).then((j) => setOpciones(j.inmobiliarias ?? [])).catch(() => {});
    }, []);
    useEffect(() => {
        if (vista === 'publicacion' && !pub) pedir('view=publicacion').then(setPub).catch((e) => setErr(String(e)));
    }, [vista, pub]);

    const listos = meses.length > 0 && meses.every((m) => cubos[m]);
    const info: MesInfo[] = useMemo(() => meses.filter((m) => cubos[m]).map((m) => ({ mes: m, parcial: cubos[m].parcial, desde: cubos[m].desde, hasta: cubos[m].hasta })), [meses, cubos]);
    const kams = useMemo(() => [...new Set(opciones.map((o) => o.kam).filter((x): x is string => !!x))].sort(), [opciones]);
    const opcionesKam = useMemo(() => opciones.filter((o) => !kam || o.kam === kam), [opciones, kam]);
    const inmosFiltro = inmo ? [inmo] : kam ? opcionesKam.map((o) => o.nombre) : null;
    const filtro: Filtro = useMemo(() => ({ portales, inmos: inmosFiltro, op }), [portales, inmosFiltro?.join('|'), op]); // eslint-disable-line react-hooks/exhaustive-deps
    const ref = useMemo(() => referencias(info), [info]);

    // periodo por default: el último mes cerrado
    useEffect(() => {
        if (listos && !periodo && ref.cerrado >= 0) { const m = info[ref.cerrado].mes; setPeriodo({ modo: 'mes', a: m, b: m }); }
    }, [listos, periodo, ref.cerrado, info]);
    const rango: Rango = useMemo(() => {
        if (!periodo || !info.length) return { a: Math.max(ref.cerrado, 0), b: Math.max(ref.cerrado, 0) };
        const idx = (m: string) => info.findIndex((x) => x.mes === m);
        const a = Math.max(0, idx(periodo.a)), b = Math.max(a, idx(periodo.b));
        return { a, b };
    }, [periodo, info, ref.cerrado]);

    /** serie de 13 meses para un filtro */
    const serie = (f: Filtro): Agg[] => info.map((m) => {
        const c = cubos[m.mes];
        const a = agregarCeldas(c.celdas, f).get('') ?? vacio();
        const ci = agregarCierres(c.cierres, f).get('');
        a.cierres = ci?.n ?? 0; a.regalia = ci?.regalia ?? 0;
        a.inventario = inventarioDe(inv?.meses[m.mes], f);
        return a;
    });
    const S = useMemo(() => (listos ? serie(filtro) : []), [listos, filtro, inv]); // eslint-disable-line react-hooks/exhaustive-deps
    const parcialUlt = info.length > 0 && info[info.length - 1].parcial;

    // series por inmobiliaria (un barrido por mes): las usan los focos y «Por inmobiliaria»
    const porInmo = useMemo(() => {
        const out = new Map<string, Agg[]>();
        if (!listos) return out;
        info.forEach((m, i) => {
            const c = cubos[m.mes];
            for (const [k, a] of agregarCeldas(c.celdas, filtro, (x) => x[1])) {
                if (!k) continue;
                const arr = out.get(k) ?? out.set(k, info.map(() => vacio())).get(k)!;
                Object.assign(arr[i], { ...a, cierres: arr[i].cierres, regalia: arr[i].regalia });
            }
            for (const [k, x] of agregarCierres(c.cierres, filtro, (y) => [...new Set([y[1], y[2]].filter(Boolean))])) {
                const arr = out.get(k) ?? out.set(k, info.map(() => vacio())).get(k)!;
                arr[i].cierres = x.n; arr[i].regalia = x.regalia;
            }
        });
        for (const [k, arr] of out) info.forEach((m, i) => { arr[i].inventario = inventarioDe(inv?.meses[m.mes], { ...filtro, inmos: [k] }); });
        return out;
    }, [listos, info, cubos, filtro, inv]);

    // focos del filtro y periodo: por portal y por inmobiliaria (o por portal dentro de la inmobiliaria elegida)
    const focos = useMemo(() => {
        if (!listos) return { rojos: [], buenos: [], notas: [] } as ReturnType<typeof ordenar>;
        const series: Array<[Serie, { leads: number; visita: number }]> = [];
        const ps = (portales.length ? portales : PORTALES.map((p) => p.key)).filter((k) => k !== 'otros');
        const enInmo = !!inmo;
        for (const k of ps) series.push([{ quien: enInmo ? `${inmo} · ${PORTAL[k].nombre}` : PORTAL[k].nombre, filtro: { portal: k },
            meses: serie({ ...filtro, portales: [k] }) }, enInmo ? { leads: 20, visita: 40 } : { leads: 100, visita: 200 }]);
        if (!enInmo) for (const [k, arr] of porInmo) series.push([{ quien: k, filtro: { inmo: k }, meses: arr }, { leads: 30, visita: 60 }]);
        else series.push([{ quien: inmo, filtro: {}, meses: S }, { leads: 20, visita: 40 }]);
        return ordenar(series.flatMap(([s, b]) => focosDe(s, info, b, rango)), SALIENDO);
    }, [listos, filtro, inv, inmo, portales, S, porInmo, rango]); // eslint-disable-line react-hooks/exhaustive-deps

    const irA = (f: Foco) => {
        if (f.filtro?.inmo) { setInmo(f.filtro.inmo); setVista('tablero'); }
        else if (f.filtro?.portal) { setPortalFoco(f.filtro.portal); setVista('portal'); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ── barra de filtros ──
    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff', maxWidth: '100%' };
    const chip = (on: boolean): CSSProperties => ({ padding: '5px 10px', borderRadius: 999, border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555',
        fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });
    const seg = (on: boolean): CSSProperties => ({ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
        fontWeight: on ? 700 : 400, background: on ? BLK : '#fff', color: on ? '#fff' : '#555' });
    const trims = [...new Set(info.map((m) => trimDe(m.mes)))];
    const mesesDeTrim = (t: string) => info.filter((m) => trimDe(m.mes) === t).map((m) => m.mes);
    const etqMes = (m: MesInfo) => `${mesLargo(m.mes)}${m.parcial ? ' (en curso)' : ''}`;
    const cambiarModo = (modo: ModoP) => {
        if (!info.length) return;
        const ult = info[Math.max(ref.cerrado, 0)].mes;
        if (modo === 'mes') setPeriodo({ modo, a: ult, b: ult });
        if (modo === 'trim') { const ms = mesesDeTrim(trimDe(ult)); setPeriodo({ modo, a: ms[0], b: ms[ms.length - 1] }); }
        if (modo === 'rango') setPeriodo({ modo, a: info[Math.max(0, ref.cerrado - 2)].mes, b: ult });
        if (modo === 'anio') { const y = ult.slice(0, 4); const ms = info.filter((m) => m.mes.startsWith(y) && !m.parcial).map((m) => m.mes); setPeriodo({ modo, a: ms[0] ?? ult, b: ult }); }
    };
    const pSel = periodo?.modo ?? 'mes';
    const barra = (
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff', paddingBottom: 10, marginBottom: 6, borderBottom: `1px solid ${LGT}` }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
                <button style={chip(!portales.length)} onClick={() => setPortales([])}>Todos los canales</button>
                {PORTALES.map((p) => (
                    <button key={p.key} style={chip(portales.includes(p.key))}
                        onClick={() => setPortales((xs) => (xs.includes(p.key) ? xs.filter((x) => x !== p.key) : [...xs, p.key]))}>
                        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 7, background: p.color, marginRight: 5 }} />{p.nombre}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                {vista !== 'publicacion' && info.length > 0 && (
                    <>
                        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
                            {([['mes', 'Mes'], ['trim', 'Trimestre'], ['rango', 'Rango'], ['anio', 'Año']] as const).map(([k, l]) => (
                                <button key={k} onClick={() => cambiarModo(k)} style={seg(pSel === k)}>{l}</button>
                            ))}
                        </span>
                        {pSel === 'mes' && periodo && (
                            <select value={periodo.a} onChange={(e) => setPeriodo({ modo: 'mes', a: e.target.value, b: e.target.value })} style={{ ...inp, fontWeight: 700 }}>
                                {[...info].reverse().map((m) => <option key={m.mes} value={m.mes}>{etqMes(m)}</option>)}
                            </select>
                        )}
                        {pSel === 'trim' && periodo && (
                            <select value={trimDe(periodo.a)} onChange={(e) => { const ms = mesesDeTrim(e.target.value); setPeriodo({ modo: 'trim', a: ms[0], b: ms[ms.length - 1] }); }} style={{ ...inp, fontWeight: 700 }}>
                                {[...trims].reverse().map((t) => { const ms = mesesDeTrim(t); return <option key={t} value={t}>{t.slice(5)} {t.slice(0, 4)} ({mesCorto(ms[0]).split(' ')[0]}–{mesCorto(ms[ms.length - 1]).split(' ')[0]}{ms.length < 3 ? ', incompleto' : ''})</option>; })}
                            </select>
                        )}
                        {pSel === 'rango' && periodo && (
                            <>
                                <select value={periodo.a} onChange={(e) => setPeriodo({ ...periodo, a: e.target.value, b: e.target.value > periodo.b ? e.target.value : periodo.b })} style={inp}>
                                    {info.map((m) => <option key={m.mes} value={m.mes}>{mesCorto(m.mes)}</option>)}
                                </select>
                                <span style={{ fontSize: 12, color: '#888' }}>a</span>
                                <select value={periodo.b} onChange={(e) => setPeriodo({ ...periodo, b: e.target.value, a: e.target.value < periodo.a ? e.target.value : periodo.a })} style={inp}>
                                    {info.map((m) => <option key={m.mes} value={m.mes}>{mesCorto(m.mes)}{m.parcial ? '*' : ''}</option>)}
                                </select>
                            </>
                        )}
                        {pSel === 'anio' && periodo && <span style={{ fontSize: 12, fontWeight: 700 }}>{etiquetaRango(info, rango)} {periodo.b.slice(0, 4)}</span>}
                        <span style={{ width: 1, height: 20, background: LGT }} />
                    </>
                )}
                <select value={kam} onChange={(e) => { setKam(e.target.value); setInmo(''); }} style={inp}>
                    <option value="">Todos los KAM</option>
                    {kams.map((k) => <option key={k} value={k}>KAM: {k}</option>)}
                </select>
                <select value={inmo} onChange={(e) => setInmo(e.target.value)} style={{ ...inp, fontWeight: inmo ? 700 : 400, minWidth: 0 }}>
                    <option value="">{kam ? `Todas las de ${kam}` : 'Toda la red (102 inmobiliarias)'}</option>
                    {opcionesKam.map((o) => <option key={o.nombre} value={o.nombre}>{o.nombre}</option>)}
                </select>
                <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
                    {([['todas', 'Venta y renta'], ['sale', 'Venta'], ['rent', 'Renta']] as const).map(([k, l]) => (
                        <button key={k} onClick={() => setOp(k)} style={seg(op === k)}>{l}</button>
                    ))}
                </span>
                {(portales.length > 0 || inmo || kam || op !== 'todas') && (
                    <button onClick={() => { setPortales([]); setInmo(''); setKam(''); setOp('todas'); }} style={{ ...inp, cursor: 'pointer', color: RED, fontWeight: 700 }}>Quitar filtros</button>
                )}
                {!listos && meses.length > 0 && <span style={{ fontSize: 11.5, color: '#8A6D00', fontWeight: 700 }}>Calculando {Object.keys(cubos).length} de {meses.length} meses…</span>}
            </div>
        </div>
    );

    if (err) return <div style={{ padding: 20, color: RED, fontSize: 13 }}>No pude cargar los datos: {err}</div>;
    const titulo: Record<VistaA, string> = { tablero: 'Tablero', portal: 'Por portal', inmos: 'Por inmobiliaria', publicacion: 'Publicación' };
    const quien = [inmo || (kam ? `Cartera de ${kam}` : 'Toda la red'), portales.length ? portales.map((k) => PORTAL[k].nombre).join(' + ') : null, op === 'sale' ? 'Venta' : op === 'rent' ? 'Renta' : null].filter(Boolean).join(' · ');
    const ctx: Ctx = { info, rango, ref, cubos, filtro, inv, parcialUlt, serie };

    return (
        <div className="va">
            <style>{`
                .va-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
                .va-2{display:grid;gap:18px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
                .va-2b{display:grid;gap:18px;grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
                .va-cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
                .va-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
                @media (max-width:760px){.va-2,.va-2b{grid-template-columns:minmax(0,1fr)}}
            `}</style>
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1.1 }}>{titulo[vista]}</div>
                <div style={{ fontSize: 12, color: '#777' }}>{quien}</div>
            </div>
            {barra}
            {vista === 'publicacion'
                ? <Publicacion pub={pub} filtro={filtro} />
                : !listos || !periodo ? <Cargando n={Object.keys(cubos).length} de={meses.length} />
                : vista === 'tablero' ? <Tablero c={ctx} S={S} focos={focos} irA={irA} alPortal={(k) => { setPortalFoco(k); setVista('portal'); }} />
                : vista === 'portal' ? <PorPortal c={ctx} portal={portalFoco} setPortal={setPortalFoco} alInmo={(n) => { setInmo(n); setVista('tablero'); }} />
                : <PorInmobiliaria c={ctx} porInmo={porInmo} opciones={opciones} focos={focos}
                    alInmo={(n) => { setInmo(n); setVista('tablero'); window.scrollTo({ top: 0 }); }} />}
            <div style={{ fontSize: 10.5, color: '#999', marginTop: 28, lineHeight: 1.5 }}>
                Mismo cálculo que /mb: leads únicos (contacto + propiedad, 400 días), meses en hora de México, respondidos a cualquier hora,
                respuesta en menos de 1 h sólo de 8 am a 8 pm, visitaron / ofertaron = de los leads del mes, cuántos lo hicieron después con esa
                inmobiliaria. Cierres por fecha de cierre con su fuente atribuida. Un periodo de varios meses se compara por promedio mensual contra
                los 3 meses previos. Los meses cerrados se recalculan cada 12 h; el mes en curso, cada 30 min.
            </div>
        </div>
    );
}

interface Ctx {
    info: MesInfo[]; rango: Rango; ref: { cerrado: number; maduro: number }; cubos: CubosM; filtro: Filtro;
    inv: InventarioMeses | null; parcialUlt: boolean; serie: (f: Filtro) => Agg[];
}
type CubosM = Record<string, MesCubo>;

function Cargando({ n, de }: { n: number; de: number }) {
    return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>
            Calculando el año… {de ? `${n} de ${de} meses` : ''}
            <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>La primera vez del día tarda un poco; después se queda guardado.</div>
        </div>
    );
}

// ── gráficas compartidas ───────────────────────────────────────────────────────────────────────────
const ejeMes = (info: MesInfo[]) => info.map((m) => mesCorto(m.mes) + (m.parcial ? '*' : ''));
function Grafica({ alto, children }: { alto: number; children: React.ReactElement }) {
    return <div style={{ height: alto }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
}
const ejes = (pct = false) => [
    <CartesianGrid key="g" vertical={false} stroke={LGT} />,
    <XAxis key="x" dataKey="mes" tick={{ fontSize: 10.5 }} interval={0} angle={-30} textAnchor="end" height={44} />,
    <YAxis key="y" tick={{ fontSize: 10.5 }} unit={pct ? '%' : undefined} />,
];
/** sombrea el periodo elegido */
const marcaPeriodo = (c: Ctx) => {
    const x = ejeMes(c.info);
    return <ReferenceArea key="p" x1={x[c.rango.a]} x2={x[c.rango.b]} fill={YEL} fillOpacity={0.12} />;
};
/** barras acumuladas por canal, mes a mes */
function PorCanalChart({ c, que }: { c: Ctx; que: 'leads' | 'cierres' }) {
    const x = ejeMes(c.info);
    const keys = new Set<string>();
    const data = c.info.map((m, i) => {
        const row: Record<string, string | number> = { mes: x[i] };
        if (que === 'leads') {
            for (const [k, a] of agregarCeldas(c.cubos[m.mes].celdas, c.filtro, (y) => portalDeCanal(y[0]))) { row[PORTAL[k].nombre] = a.leads; keys.add(k); }
        } else {
            for (const [k, a] of agregarCierres(c.cubos[m.mes].cierres, c.filtro, (y) => [portalDeFuente(y[0]) ?? 'sin'])) {
                const n = k === 'sin' ? 'Sin portal (directo, red, sin registro)' : PORTAL[k].nombre; row[n] = a.n; keys.add(k);
            }
        }
        return row;
    });
    const orden = [...PORTALES.map((p) => p.key), 'sin'].filter((k) => keys.has(k));
    return (
        <Grafica alto={250}>
            <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>
                {ejes()}{marcaPeriodo(c)}
                <Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
                {orden.map((k, i) => {
                    const n = k === 'sin' ? 'Sin portal (directo, red, sin registro)' : PORTAL[k].nombre;
                    return <Bar key={k} dataKey={n} stackId="a" fill={k === 'sin' ? '#DADADA' : PORTAL[k].color} radius={i === orden.length - 1 ? [2, 2, 0, 0] : undefined} />;
                })}
            </BarChart>
        </Grafica>
    );
}

// ── Tablero ────────────────────────────────────────────────────────────────────────────────────────
function Tablero({ c, S, focos, irA, alPortal }: {
    c: Ctx; S: Agg[]; focos: ReturnType<typeof ordenar>; irA: (f: Foco) => void; alPortal: (k: string) => void;
}) {
    const [verNotas, setVerNotas] = useState(false);
    const { info, rango, parcialUlt, filtro, cubos } = c;
    const j = c.ref.maduro;
    const k = rango.b - rango.a + 1;
    const T = sumar(S.slice(rango.a, rango.b + 1)), P = promedio(S.slice(rango.a, rango.b + 1));
    const ant = S.slice(Math.max(0, rango.a - 3), rango.a);
    const avg = (fn: (a: Agg) => number | null) => { const xs = ant.map(fn).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const dPct = (v: number | null, b: number | null) => (v == null || !b ? null : (100 * (v - b)) / b);
    const dPts = (v: number | null, b: number | null) => (v == null || b == null ? null : v - b);
    const etq = etiquetaRango(info, rango);
    const incluyeParcial = info[rango.b]?.parcial;
    const ult = info[info.length - 1];
    const av = parcialUlt ? avanceMes(ult) : null;
    const proy = parcialUlt && av && av.corridos >= 3 ? Math.round((S[S.length - 1].leads / av.corridos) * av.total) : null;
    // visita: los meses maduros del periodo
    const vb = Math.min(rango.b, j), va = rango.a <= vb ? rango.a : vb;
    const V = vb >= 0 ? promedio(S.slice(va, vb + 1)) : null;
    const vAnt = va >= 3 ? S.slice(va - 3, va).map((a) => tasa.vis(a) ?? 0).reduce((a, b) => a + b, 0) / 3 : null;
    const sufijo = k === 1 ? 'vs prom. 3 m previos' : 'prom. mensual vs 3 m previos';
    const anioAnt = rango.a >= 12 ? sumar(S.slice(rango.a - 12, rango.b - 12 + 1)) : null;

    const ps = (filtro.portales.length ? filtro.portales : PORTALES.map((p) => p.key));
    const porPortal = ps.map((key) => {
        const s = info.map((m) => agregarCeldas(cubos[m.mes].celdas, { ...filtro, portales: [key] }).get('') ?? vacio());
        const pr = promedio(s.slice(rango.a, rango.b + 1)).leads;
        const prev = s.slice(Math.max(0, rango.a - 3), rango.a).map((a) => a.leads);
        const pa = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
        return { key, s, total: sumar(s.slice(rango.a, rango.b + 1)).leads, d: pa ? (100 * (pr - pa)) / pa : null, rojo: focos.rojos.some((f) => f.filtro?.portal === key) };
    }).filter((x) => x.s.some((a) => a.leads > 0));

    return (
        <div>
            <div style={{ fontSize: 13, color: '#555', margin: '14px 0 10px', lineHeight: 1.5 }}>
                <b style={{ color: BLK }}>{etq[0].toUpperCase() + etq.slice(1)}</b>{k > 1 ? ` (${k} meses)` : ''} contra el promedio de los 3 meses previos.
                {incluyeParcial && <> Incluye el mes en curso, que va a medias.</>}
                {proy != null && rango.b === c.ref.cerrado && <> · {mesLargo(ult.mes).split(' ')[0]} lleva <b style={{ color: BLK }}>{f0(S[S.length - 1].leads)}</b> leads en {Math.floor(av!.corridos)} días: a este ritmo cerraría en ~{f0(proy)}.</>}
            </div>
            <div className="va-grid">
                <Tile label="Leads" value={f0(T.leads)} delta={<Delta v={dPct(P.leads, avg((a) => a.leads))} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => a.leads)} parcialUlt={parcialUlt} />} nota={anioAnt?.leads ? `Mismo periodo hace un año: ${f0(anioAnt.leads)}` : undefined} />
                <Tile label="Leads por propiedad" value={tasa.lpp(P) == null ? '—' : String(tasa.lpp(P))} delta={<Delta v={dPct(tasa.lpp(P), avg(tasa.lpp))} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => tasa.lpp(a) ?? 0)} parcialUlt={parcialUlt} />} nota={`Al mes · ${f0(P.inventario)} propiedades publicadas`} />
                <Tile label="Sin responder" value={pc(tasa.sinResp(P))} delta={<Delta v={dPts(tasa.sinResp(P), avg(tasa.sinResp))} pts invertir sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => tasa.sinResp(a) ?? 0)} parcialUlt={parcialUlt} color={RED} />} />
                <Tile label="Respondidos en < 1 h" value={pc(tasa.r1h(P))} delta={<Delta v={dPts(tasa.r1h(P), avg(tasa.r1h))} pts sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => tasa.r1h(a) ?? 0)} parcialUlt={parcialUlt} />} nota="Leads de 8 am a 8 pm" />
                <Tile label={`Visitaron · ${etiquetaRango(info, { a: Math.max(va, 0), b: Math.max(vb, 0) })}`} value={pc(V ? tasa.vis(V) : null)}
                    delta={vAnt != null && V ? <Delta v={dPts(tasa.vis(V), vAnt)} pts sufijo="vs 3 m previos" /> : undefined}
                    spark={<Spark vals={S.map((a, i) => (i <= j ? tasa.vis(a) ?? 0 : 0))} />} nota="Sólo meses maduros: los leads recientes todavía no visitan" />
                <Tile label="Cierres" value={f0(T.cierres)} delta={<Delta v={dPct(P.cierres, avg((a) => a.cierres))} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => a.cierres)} parcialUlt={parcialUlt} color={SEA} />} nota={`Regalía ${money(T.regalia)}`} />
            </div>

            <div className="va-2b" style={{ marginTop: 22 }}>
                <ListaFocos titulo={`Focos rojos (${focos.rojos.length})`} focos={focos.rojos.slice(0, 6)} onIr={irA}
                    vacio="Nada fuera de lo normal: ningún portal ni inmobiliaria cayó contra su propio promedio." />
                <div>
                    <ListaFocos titulo="Lo que va bien" focos={focos.buenos.slice(0, 4)} onIr={irA} vacio="Nada sobresaliente en el periodo." />
                    {focos.notas.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                            <button onClick={() => setVerNotas((x) => !x)} style={{ fontSize: 11.5, background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}>
                                {verNotas ? 'Ocultar' : 'Ver'} {focos.notas.length} {focos.notas.length === 1 ? 'caída explicada' : 'caídas explicadas'} (inventario o inmobiliarias que se van: no son focos)
                            </button>
                            {verNotas && <div style={{ marginTop: 8 }}><ListaFocos titulo="" focos={focos.notas} onIr={irA} vacio="" /></div>}
                        </div>
                    )}
                </div>
            </div>
            {focos.rojos.length > 6 && <div style={{ fontSize: 11.5, color: '#777', marginTop: 4 }}>Hay {focos.rojos.length - 6} focos más: la lista completa está en «Por inmobiliaria».</div>}

            <div className="va-2">
                <div>
                    <H2 sub="Cada color es un canal. Sombreado: el periodo elegido. * mes en curso.">Leads por mes y canal</H2>
                    <PorCanalChart c={c} que="leads" />
                </div>
                <div>
                    <H2 sub="Por fecha de cierre, con la fuente atribuida. Gris: cierres que no vienen de un portal.">Cierres por mes y canal</H2>
                    <PorCanalChart c={c} que="cierres" />
                </div>
            </div>

            <H2 sub={`Leads del periodo y su cambio contra los 3 meses previos. Clic para ver el detalle del portal.`}>Cada canal</H2>
            <div className="va-cards">
                {porPortal.map(({ key, s, total, d, rojo }) => (
                    <div key={key} onClick={() => alPortal(key)} style={{ border: `1px solid ${rojo ? RED : LGT}`, borderTop: `3px solid ${PORTAL[key].color}`, borderRadius: R, padding: '10px 12px', cursor: 'pointer', background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontWeight: 800, fontSize: 12.5 }}>{PORTAL[key].nombre}</span>
                            {rojo && <span style={{ fontSize: 10, fontWeight: 800, color: RED, textTransform: 'uppercase' }}>Foco rojo</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
                            <div>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1 }}>{f0(total)}</div>
                                <div style={{ fontSize: 11 }}><Delta v={d} /></div>
                            </div>
                            <Spark vals={s.map((a) => a.leads)} parcialUlt={parcialUlt} color={PORTAL[key].color} alto={34} ancho={7} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Por portal ─────────────────────────────────────────────────────────────────────────────────────
function PorPortal({ c, portal, setPortal, alInmo }: { c: Ctx; portal: string; setPortal: (k: string) => void; alInmo: (n: string) => void }) {
    const { info, rango, cubos, filtro, serie } = c;
    const [estados, setEstados] = useState<Set<string>>(new Set(['closed', 'paying']));
    const P = PORTAL[portal];
    const S = useMemo(() => serie({ ...filtro, portales: [portal] }), [portal, filtro, c.inv]); // eslint-disable-line react-hooks/exhaustive-deps
    const resto = useMemo(() => serie({ ...filtro, portales: PORTALES.map((p) => p.key).filter((k) => k !== portal && k !== 'otros') }), [portal, filtro, c.inv]); // eslint-disable-line react-hooks/exhaustive-deps
    const j = c.ref.maduro;
    const opF = { ...filtro, portales: [portal] };
    const x = ejeMes(info);
    const fuentes = new Set(P.fuentes);
    const iset = filtro.inmos ? new Set(filtro.inmos) : null;
    const opOk = (o: string) => filtro.op === 'todas' || (filtro.op === 'sale' ? o === 's' : o === 'r');
    const data = info.map((m, k) => {
        const v = agregarCeldas(cubos[m.mes].celdas, { ...opF, op: 'sale' }).get('')?.leads ?? 0;
        const rr = agregarCeldas(cubos[m.mes].celdas, { ...opF, op: 'rent' }).get('')?.leads ?? 0;
        const row: Record<string, string | number | null> = {
            mes: x[k], Venta: filtro.op === 'rent' ? 0 : v, Renta: filtro.op === 'sale' ? 0 : rr,
            'Sin responder': tasa.sinResp(S[k]), 'En < 1 h': tasa.r1h(S[k]),
            [P.nombre]: k <= j ? tasa.vis(S[k]) : null, 'Resto de portales': k <= j ? tasa.vis(resto[k]) : null,
            'Leads por propiedad': tasa.lpp(S[k]),
        };
        // cierres (por fecha de cierre) + forecast (operaciones vivas, por fecha de creación)
        for (const e of ESTADOS) row[e.l] = 0;
        for (const y of cubos[m.mes].cierres) {
            if (!fuentes.has(y[0]) || (iset && !iset.has(y[1]) && !iset.has(y[2])) || !opOk(y[3])) continue;
            row[y[6] === 'paying' ? 'Cobrando' : 'Cerrada'] = (row[y[6] === 'paying' ? 'Cobrando' : 'Cerrada'] as number) + 1;
        }
        for (const y of cubos[m.mes].pipeline ?? []) {
            if (!fuentes.has(y[0]) || (iset && !iset.has(y[1]) && !iset.has(y[2])) || !opOk(y[3])) continue;
            const l = ESTADOS.find((e) => e.k === y[4])!.l;
            row[l] = (row[l] as number) + 1;
        }
        return row;
    });
    const vivo = ESTADOS.filter((e) => ['contract', 'offer_blocked', 'offer'].includes(e.k)).map((e) => ({ ...e, n: data.reduce((a, r) => a + (r[e.l] as number), 0) }));
    const top = useMemo(() => {
        const out: Array<{ n: string; ult: number; avg: number }> = [];
        const pm = info.map((m) => agregarCeldas(cubos[m.mes].celdas, opF, (cc) => cc[1]));
        const nombres = new Set(pm.flatMap((y) => [...y.keys()]).filter(Boolean));
        const kk = rango.b - rango.a + 1;
        for (const n of nombres) {
            let ult = 0; for (let i = rango.a; i <= rango.b; i++) ult += pm[i].get(n)?.leads ?? 0;
            const prev = [1, 2, 3].map((d) => pm[rango.a - d]?.get(n)?.leads ?? 0);
            out.push({ n, ult: ult / kk, avg: prev.reduce((a, b) => a + b, 0) / 3 });
        }
        return out.sort((a, b) => b.ult - a.ult).slice(0, 20);
    }, [portal, filtro, rango]); // eslint-disable-line react-hooks/exhaustive-deps
    const maduroIni = j + 1 < info.length ? x[j + 1] : null;
    const tabs = PORTALES.filter((p) => !filtro.portales.length || filtro.portales.includes(p.key));
    return (
        <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 4px' }}>
                {tabs.map((p) => (
                    <button key={p.key} onClick={() => setPortal(p.key)} style={{ padding: '6px 12px', borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                        border: `1px solid ${p.key === portal ? p.color : LGT}`, background: p.key === portal ? p.color : '#fff', color: p.key === portal ? '#fff' : '#555', fontWeight: 700 }}>{p.nombre}</button>
                ))}
            </div>
            <div className="va-2">
                <div>
                    <H2 sub="Sombreado: el periodo elegido. * mes en curso">Leads por mes</H2>
                    <Grafica alto={230}><BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}{marcaPeriodo(c)}<Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
                        <Bar dataKey="Venta" stackId="a" fill={P.color} /><Bar dataKey="Renta" stackId="a" fill={GRY} radius={[2, 2, 0, 0]} /></BarChart></Grafica>
                </div>
                <div>
                    <H2 sub="Leads del mes ÷ propiedades publicadas: separa «bajó el inventario» de «bajó el portal».">Leads por propiedad</H2>
                    <Grafica alto={230}><LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}{marcaPeriodo(c)}<Tooltip {...tip} />
                        <Line dataKey="Leads por propiedad" stroke={P.color} strokeWidth={2} dot={{ r: 2 }} /></LineChart></Grafica>
                </div>
            </div>
            <div className="va-2">
                <div>
                    <H2 sub="Sin responder = sin respuesta registrada. En < 1 h: sólo leads de 8 am a 8 pm.">Atención</H2>
                    <Grafica alto={220}><LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes(true)}{marcaPeriodo(c)}<Tooltip {...tip} formatter={(v) => pc(v as number)} />
                        <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
                        <Line dataKey="En < 1 h" stroke={SEA} strokeWidth={2} dot={{ r: 2 }} /><Line dataKey="Sin responder" stroke={RED} strokeWidth={2} dot={{ r: 2 }} /></LineChart></Grafica>
                </div>
                <div>
                    <H2 sub="De los leads del mes, cuántos visitaron después. Lo gris todavía está madurando.">Visitaron · contra el resto de portales</H2>
                    <Grafica alto={220}><LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes(true)}
                        {maduroIni && <ReferenceArea x1={maduroIni} x2={x[x.length - 1]} fill={LGT} />}
                        <Tooltip {...tip} formatter={(v) => pc(v as number)} /><Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
                        <Line dataKey={P.nombre} stroke={P.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                        <Line dataKey="Resto de portales" stroke={GRY} strokeDasharray="4 3" strokeWidth={2} dot={false} /></LineChart></Grafica>
                </div>
            </div>

            <H2 sub="Cerrada y cobrando: por fecha de cierre, con la fuente atribuida. Contrato, oferta aceptada y oferta: operaciones que siguen VIVAS, por el mes en que se crearon y con la fuente que trae la operación. Prende los estatus para ver el forecast.">
                Cierres y forecast de {P.nombre}
            </H2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {ESTADOS.map((e) => {
                    const on = estados.has(e.k);
                    return (
                        <button key={e.k} onClick={() => setEstados((s) => { const n = new Set(s); if (on) n.delete(e.k); else n.add(e.k); return n; })}
                            style={{ padding: '5px 10px', borderRadius: 999, border: `1px solid ${on ? e.c : LGT}`, background: on ? e.c : '#fff', color: on ? '#fff' : '#555', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
                            {e.l}
                        </button>
                    );
                })}
                <span style={{ fontSize: 11.5, color: '#666', alignSelf: 'center', marginLeft: 6 }}>
                    Vivas hoy: {vivo.map((v) => `${f0(v.n)} ${v.l.toLowerCase()}`).join(' · ')}
                </span>
            </div>
            <Grafica alto={230}>
                <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}{marcaPeriodo(c)}<Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                    {ESTADOS.filter((e) => estados.has(e.k)).map((e) => <Bar key={e.k} dataKey={e.l} stackId="e" fill={e.c} />)}
                </BarChart>
            </Grafica>

            <H2 sub={`${etiquetaRango(info, rango)} (promedio mensual) contra los 3 meses previos. Clic en una para ver su tablero.`}>Inmobiliarias con más leads de {P.nombre}</H2>
            <BarrasInmo filas={top.map((t) => ({ nombre: t.n, valor: t.ult, base: t.avg }))} alClic={alInmo} color={P.color} />
        </div>
    );
}

/** barras horizontales con su Δ contra la base (el tamaño es el valor; el color del Δ dice si subió o bajó) */
function BarrasInmo({ filas, alClic, color = BLK }: { filas: Array<{ nombre: string; valor: number; base: number }>; alClic: (n: string) => void; color?: string }) {
    const max = Math.max(...filas.map((f) => Math.max(f.valor, f.base)), 1);
    return (
        <div>
            {filas.map((f) => {
                const d = f.base ? (100 * (f.valor - f.base)) / f.base : null;
                return (
                    <div key={f.nombre} onClick={() => alClic(f.nombre)} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,190px) 1fr 72px', gap: 8, alignItems: 'center', padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.nombre}>{f.nombre}</span>
                        <span style={{ position: 'relative', height: 14, background: LGT, borderRadius: R }}>
                            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(100 * f.valor) / max}%`, background: color, borderRadius: R }} />
                            <span title="promedio de los 3 meses previos" style={{ position: 'absolute', top: -2, bottom: -2, left: `${(100 * f.base) / max}%`, width: 2, background: BLK }} />
                            <span style={{ position: 'absolute', left: 6, top: 0, fontSize: 10, color: '#fff', fontWeight: 700, lineHeight: '14px', mixBlendMode: 'difference' }}>{f0(f.valor)}</span>
                        </span>
                        <span style={{ textAlign: 'right', fontSize: 11 }}><Delta v={d} /></span>
                    </div>
                );
            })}
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 4 }}>La rayita negra marca el promedio de los 3 meses previos.</div>
        </div>
    );
}

// ── Por inmobiliaria ───────────────────────────────────────────────────────────────────────────────
function PorInmobiliaria({ c, porInmo, opciones, focos, alInmo }: {
    c: Ctx; porInmo: Map<string, Agg[]>; opciones: Opcion[]; focos: ReturnType<typeof ordenar>; alInmo: (n: string) => void;
}) {
    const { info, rango, cubos, filtro, parcialUlt } = c;
    const [orden, setOrden] = useState<'peor' | 'leads' | 'lista'>('peor');
    const [soloFocos, setSoloFocos] = useState(false);
    const j = c.ref.maduro;
    const kamDe = new Map(opciones.map((o) => [o.nombre, o.kam]));
    const posLista = new Map(opciones.map((o, k) => [o.nombre, k]));
    // leads del periodo por inmobiliaria × canal (para la barrita de mezcla)
    const mezcla = useMemo(() => {
        const out = new Map<string, Map<string, number>>();
        for (let i = rango.a; i <= rango.b; i++)
            for (const [key, a] of agregarCeldas(cubos[info[i].mes].celdas, filtro, (y) => `${y[1]}|${portalDeCanal(y[0])}`)) {
                const [n, p] = key.split('|');
                if (!n) continue;
                const m = out.get(n) ?? out.set(n, new Map()).get(n)!;
                m.set(p, (m.get(p) ?? 0) + a.leads);
            }
        return out;
    }, [info, cubos, filtro, rango]);
    const filas = useMemo(() => {
        const rojosDe = new Map<string, Foco[]>();
        for (const f of focos.rojos) if (f.filtro?.inmo) (rojosDe.get(f.filtro.inmo) ?? rojosDe.set(f.filtro.inmo, []).get(f.filtro.inmo)!).push(f);
        return [...porInmo.entries()].map(([n, s]) => {
            const T = sumar(s.slice(rango.a, rango.b + 1)), Pm = promedio(s.slice(rango.a, rango.b + 1));
            const ant = s.slice(Math.max(0, rango.a - 3), rango.a);
            const avg = ant.length ? ant.reduce((a, x) => a + x.leads, 0) / ant.length : 0;
            const lppA = ant.map((x) => tasa.lpp(x)).filter((x): x is number => x != null);
            const lppAv = lppA.length ? lppA.reduce((a, b) => a + b, 0) / lppA.length : 0;
            const lpp = tasa.lpp(Pm);
            const vb = Math.min(rango.b, j), va = rango.a <= vb ? rango.a : vb;
            return { n, s, T, avg, d: avg >= 5 ? (100 * (Pm.leads - avg)) / avg : null, dLpp: lpp != null && lppAv ? (100 * (lpp - lppAv)) / lppAv : null,
                inv: Pm.inventario, sinR: tasa.sinResp(Pm), r1h: tasa.r1h(Pm), vis: vb >= 0 ? tasa.vis(promedio(s.slice(va, vb + 1))) : null,
                focos: rojosDe.get(n) ?? [] };
        }).filter((f) => f.avg >= 3 || f.T.leads >= 3 || f.focos.length);
    }, [porInmo, focos, rango, j]);
    const vis = filas.filter((f) => !soloFocos || f.focos.length)
        .sort((a, b) => orden === 'leads' ? b.T.leads - a.T.leads
            : orden === 'lista' ? (posLista.get(a.n) ?? 999) - (posLista.get(b.n) ?? 999)
            : (b.focos.length ? 1 : 0) - (a.focos.length ? 1 : 0) || (a.d ?? 0) - (b.d ?? 0));
    const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12, verticalAlign: 'middle' };
    const maxD = 60;
    const etq = etiquetaRango(info, rango);
    const nFocos = filas.filter((f) => f.focos.length).length;
    return (
        <div>
            <div className="va-grid" style={{ margin: '14px 0 4px' }}>
                <Tile label="Inmobiliarias con leads" value={f0(filas.length)} nota={etq} />
                <Tile label="Con foco rojo" value={f0(nFocos)} nota="Caída real, atención o visitas" />
                <Tile label="Cayeron más de 25%" value={f0(filas.filter((f) => (f.d ?? 0) <= -25).length)} nota="Leads/mes vs 3 meses previos" />
                <Tile label="Subieron más de 25%" value={f0(filas.filter((f) => (f.d ?? 0) >= 25).length)} nota="Leads/mes vs 3 meses previos" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
                <span style={{ fontSize: 11.5, color: '#666' }}>Ordenar:</span>
                {([['peor', 'Las que más cayeron'], ['leads', 'Más leads'], ['lista', 'Orden de la lista']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setOrden(k)} style={{ padding: '5px 10px', borderRadius: R, border: `1px solid ${orden === k ? BLK : LGT}`, background: orden === k ? BLK : '#fff',
                        color: orden === k ? '#fff' : '#555', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                ))}
                <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={soloFocos} onChange={(e) => setSoloFocos(e.target.checked)} /> Sólo con foco rojo ({nFocos})
                </label>
                <span style={{ fontSize: 11, color: '#888', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                    {PORTALES.map((p) => <span key={p.key}><span style={{ display: 'inline-block', width: 8, height: 8, background: p.color, marginRight: 3 }} />{p.nombre}</span>)}
                </span>
            </div>
            <div className="va-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                    <thead><tr>
                        <th style={{ ...th, textAlign: 'left' }}>Inmobiliaria</th>
                        <th style={{ ...th, textAlign: 'left' }}>Leads · 13 meses</th>
                        <th style={th}>Leads · {etq}</th>
                        <th style={{ ...th, textAlign: 'left', minWidth: 130 }}>De dónde vienen</th>
                        <th style={{ ...th, textAlign: 'center', minWidth: 150 }}>vs 3 meses previos</th>
                        <th style={th} title="Leads por propiedad publicada contra los 3 meses previos: si los leads bajan pero esto no, es inventario">Por propiedad</th>
                        <th style={th}>Propiedades</th>
                        <th style={th}>Sin resp.</th>
                        <th style={th}>{'< 1 h'}</th>
                        <th style={th}>Visitó</th>
                        <th style={th}>Cierres</th>
                        <th style={{ ...th, textAlign: 'left' }}>Foco</th>
                    </tr></thead>
                    <tbody>
                        {vis.map((f) => {
                            const mz = mezcla.get(f.n) ?? new Map<string, number>();
                            const tot = [...mz.values()].reduce((a, b) => a + b, 0) || 1;
                            return (
                                <tr key={f.n} onClick={() => alInmo(f.n)} style={{ cursor: 'pointer', background: f.focos.length ? '#FDF6F4' : undefined }}>
                                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 160 }}>
                                        <div style={{ fontWeight: 700 }}>{f.n}</div>
                                        <div style={{ fontSize: 10.5, color: '#888' }}>{kamDe.get(f.n) ? `KAM ${kamDe.get(f.n)}` : 'fuera de la lista'}{SALIENDO.has(f.n) ? ' · se va de Pulppo' : ''}</div>
                                    </td>
                                    <td style={{ ...td, textAlign: 'left' }}><Spark vals={f.s.map((a) => a.leads)} parcialUlt={parcialUlt} color={f.focos.length ? RED : BLK} /></td>
                                    <td style={{ ...td, fontWeight: 700 }}>{f0(f.T.leads)}</td>
                                    <td style={{ ...td, textAlign: 'left' }}>
                                        <span title={PORTALES.filter((p) => mz.get(p.key)).map((p) => `${p.nombre}: ${mz.get(p.key)}`).join(' · ')}
                                            style={{ display: 'flex', width: 130, height: 10, borderRadius: R, overflow: 'hidden', background: LGT }}>
                                            {PORTALES.map((p) => mz.get(p.key) ? <span key={p.key} style={{ width: `${(100 * mz.get(p.key)!) / tot}%`, background: p.color }} /> : null)}
                                        </span>
                                    </td>
                                    <td style={{ ...td, textAlign: 'center' }}>
                                        {f.d == null ? <span style={{ color: GRY }}>—</span> : (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ position: 'relative', width: 80, height: 10, background: LGT, borderRadius: R, display: 'inline-block' }}>
                                                    <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: '#999' }} />
                                                    <span style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: R, background: f.d < 0 ? RED : SEA,
                                                        ...(f.d < 0 ? { right: '50%', width: `${Math.min(50, (50 * -f.d) / maxD)}%` } : { left: '50%', width: `${Math.min(50, (50 * f.d) / maxD)}%` }) }} />
                                                </span>
                                                <Delta v={f.d} />
                                            </span>
                                        )}
                                    </td>
                                    <td style={td}><Delta v={f.dLpp} /></td>
                                    <td style={{ ...td, color: '#666' }}>{f0(f.inv)}</td>
                                    <td style={{ ...td, color: (f.sinR ?? 0) >= 10 ? RED : BLK, fontWeight: (f.sinR ?? 0) >= 10 ? 700 : 400 }}>{pc(f.sinR)}</td>
                                    <td style={td}>{pc(f.r1h)}</td>
                                    <td style={td}>{pc(f.vis)}</td>
                                    <td style={td}>{f0(f.T.cierres)}</td>
                                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', fontSize: 11, color: RED, maxWidth: 240 }}>{f.focos.map((y) => y.que.split('.')[0]).join(' · ')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                «vs 3 meses previos» y «Por propiedad» comparan el promedio mensual del periodo. Si los leads bajan y «por propiedad» no, salió inventario
                (no es foco). Visitó: sólo meses maduros. Clic en una inmobiliaria para ver su tablero.
            </div>
        </div>
    );
}

// ── Publicación ────────────────────────────────────────────────────────────────────────────────────
// (mismas constantes que lib/portales/publicacion.ts: no se importan para no meter Mongo al navegador)
const CUENTAS_PULPPO = new Set(['ANUNCIO_SIMPLE', 'ANUNCIOS_DEGOHOUSE', 'ANUNCIO_PREMIERE']);
const NIVELES: Record<string, string[]> = {
    Inmuebles24: ['Súper destacado ZD', 'Súper destacado', 'Destacado ZD', 'Destacado', 'Simple', 'Gratis'],
    MercadoLibre: ['Oro Premium', 'Oro', 'Plata', 'Otro'],
    'Propiedades.com': ['En línea'], 'Casas y Terrenos': ['En línea'], EasyBroker: ['En línea'],
};
const ELEVADOS = ['Súper destacado ZD', 'Súper destacado', 'Destacado ZD', 'Destacado'];
const PORTAL_PUB: Record<string, string> = { Inmuebles24: 'i24', MercadoLibre: 'meli', 'Propiedades.com': 'pcom', 'Casas y Terrenos': 'cyt', EasyBroker: 'eb' };
const COLOR_QUIEN: Record<string, string> = { 'Por regla': GRY, Inmobiliaria: YEL, Portal: '#C8642A', Pulppo: RED };
const TXT_QUIEN: Record<string, string> = {
    'Por regla': 'Fuera a propósito (la regla de asignación les quitó el cupo)', Inmobiliaria: 'Lo corrige la inmobiliaria (datos, su plan o su cuenta)',
    Portal: 'Falla del portal (i24 lo marca OFFLINE y lo sigue cobrando como Simple)', Pulppo: 'Lo revisa Pulppo con el portal',
};

function Barra({ partes, total, alto = 14 }: { partes: Array<{ v: number; c: string; t: string }>; total: number; alto?: number }) {
    return (
        <div style={{ display: 'flex', height: alto, borderRadius: R, overflow: 'hidden', background: LGT }}>
            {partes.map((p, i) => p.v > 0 ? <span key={i} title={p.t} style={{ width: `${(100 * p.v) / Math.max(total, 1)}%`, background: p.c }} /> : null)}
        </div>
    );
}

function Publicacion({ pub, filtro }: { pub: PublicacionView | null; filtro: Filtro }) {
    if (!pub) return <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>Revisando qué está publicado en cada portal…</div>;
    const iset = filtro.inmos ? new Set(filtro.inmos) : null;
    const portalesVis = Object.keys(NIVELES).filter((p) => !filtro.portales.length || filtro.portales.includes(PORTAL_PUB[p]));
    const filas = pub.filas.filter((f) => !iset || iset.has(f[0]));
    const off = pub.offline.filter((f) => (!iset || iset.has(f[0])) && portalesVis.includes(f[1]));
    const inventario = pub.inventario.filter(([n]) => !iset || iset.has(n)).reduce((a, [, n]) => a + n, 0);
    const tot = (portal: string, niveles?: string[]) => filas.filter((f) => f[1] === portal && (!niveles || niveles.includes(f[2])))
        .reduce((a, f) => ({ cupo: a.cupo + f[3], pub: a.pub + f[4], lead: a.lead + f[5] }), { cupo: 0, pub: 0, lead: 0 });
    const offDe = (portal: string) => off.filter((f) => f[1] === portal).reduce((a, f) => a + f[4], 0);
    const totalOff = off.reduce((a, f) => a + f[4], 0);

    // ── 1. contra el plan contratado (toda la red) ──
    const plan = pub.plan;
    const precio = (n: string) => plan.precios[n] ?? 0;
    const nuestras = pub.cuentasI24.filter(([cta]) => CUENTAS_PULPPO.has(cta));
    const premierN = nuestras.filter(([cta]) => cta === 'ANUNCIO_PREMIERE').reduce((a, x) => a + x[2], 0);
    const usadoTipo = ELEVADOS.map((n) => {
        const cant = nuestras.filter(([cta, nv]) => cta !== 'ANUNCIO_PREMIERE' && nv === n).reduce((a, x) => a + x[2], 0);
        return { n, cant, pesos: cant * precio(n) };
    });
    const usadoPremier = premierN ? plan.premier ?? 0 : 0;
    const usado = usadoTipo.reduce((a, x) => a + x.pesos, 0) + usadoPremier;
    const bolsa = plan.bolsaI24 ?? 0;
    const libre = bolsa - usado;
    const simplesNuestros = nuestras.filter(([, nv]) => nv === 'Simple').reduce((a, x) => a + x[2], 0);
    const propias = pub.cuentasI24.filter(([cta]) => !CUENTAS_PULPPO.has(cta));
    const opMeli = pub.filas.filter((f) => f[1] === 'MercadoLibre' && f[2] === 'Oro Premium').reduce((a, f) => a + f[4], 0);
    const pubMeli = pub.filas.filter((f) => f[1] === 'MercadoLibre').reduce((a, f) => a + f[4], 0);
    const colorTipo: Record<string, string> = { 'Súper destacado ZD': '#8C3F14', 'Súper destacado': '#C8642A', 'Destacado ZD': '#B9865A', Destacado: '#E0B48A' };

    // ── 3. por inmobiliaria ──
    const porInmo = new Map<string, Record<string, { cupo: number; pub: number; lead: number }>>();
    for (const f of filas) {
        const m = porInmo.get(f[0]) ?? porInmo.set(f[0], {}).get(f[0])!;
        const k = `${f[1]}|${f[2]}`;
        const x = m[k] ?? (m[k] = { cupo: 0, pub: 0, lead: 0 });
        x.cupo += f[3]; x.pub += f[4]; x.lead += f[5];
    }
    const g = (m: Record<string, { cupo: number; pub: number; lead: number }>, ks: string[]) => ks.reduce((a, k) => ({ cupo: a.cupo + (m[k]?.cupo ?? 0), pub: a.pub + (m[k]?.pub ?? 0), lead: a.lead + (m[k]?.lead ?? 0) }), { cupo: 0, pub: 0, lead: 0 });
    const tabla = [...porInmo.entries()].map(([n, m]) => ({
        n, sd: g(m, ['Inmuebles24|Súper destacado', 'Inmuebles24|Súper destacado ZD']), d: g(m, ['Inmuebles24|Destacado', 'Inmuebles24|Destacado ZD']), s: g(m, ['Inmuebles24|Simple']),
        op: g(m, ['MercadoLibre|Oro Premium']), pl: g(m, ['MercadoLibre|Plata']),
        off24: off.filter((f) => f[0] === n && f[1] === 'Inmuebles24').reduce((a, f) => a + f[4], 0),
        offMl: off.filter((f) => f[0] === n && f[1] === 'MercadoLibre').reduce((a, f) => a + f[4], 0),
    })).filter((r) => r.sd.cupo + r.d.cupo + r.s.cupo + r.op.cupo + r.pl.cupo + r.sd.pub + r.s.pub + r.pl.pub > 0);
    const hueco = (r: (typeof tabla)[number]) => Math.max(0, r.sd.cupo - r.sd.pub) + Math.max(0, r.d.cupo - r.d.pub) + Math.max(0, r.op.cupo - r.op.pub);
    tabla.sort((a, b) => hueco(b) - hueco(a));
    const huecoTotal = tabla.reduce((a, r) => a + hueco(r), 0);

    // ── 4. caídos por motivo ──
    const motivos = new Map<string, { portal: string; motivo: string; quien: string; n: number }>();
    for (const f of off) { const k = `${f[1]}|${f[2]}`; const x = motivos.get(k) ?? motivos.set(k, { portal: f[1], motivo: f[2], quien: f[3], n: 0 }).get(k)!; x.n += f[4]; }
    const porQuien = ['Por regla', 'Inmobiliaria', 'Portal', 'Pulppo'].map((q) => ({ q, n: [...motivos.values()].filter((m) => m.quien === q).reduce((a, m) => a + m.n, 0) }));

    const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 };
    const uso = (x: { cupo: number; pub: number }) => {
        if (!x.cupo && !x.pub) return <span style={{ color: GRY }}>—</span>;
        const u = x.cupo ? Math.round((100 * x.pub) / x.cupo) : null;
        const c = u == null ? '#555' : u < 70 ? RED : u > 105 ? '#8A6D00' : SEA;
        return <span><b style={{ color: c }}>{x.pub}</b><span style={{ color: '#888' }}> / {x.cupo}</span></span>;
    };
    return (
        <div>
            <H2 sub={<>Lo que pagamos a cada portal contra lo que tenemos en línea HOY. Plan: hoja «Calculadora» del Sheet de asignación{plan.ok ? '' : ` (no se pudo leer: ${plan.nota})`}. Es de toda la red: no cambia con el filtro de inmobiliaria.</>}>
                ¿Aprovechamos el plan contratado?
            </H2>
            <div className="va-cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
                <div style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${PORTAL.i24.color}`, borderRadius: R, padding: '12px 14px' }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>Inmuebles24 · bolsa de destacados</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0' }}>
                        <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 30 }}>{bolsa ? `${Math.round((100 * usado) / bolsa)}%` : '—'}</span>
                        <span style={{ fontSize: 12, color: '#666' }}>{money(usado)} de {money(bolsa)} al mes</span>
                    </div>
                    <Barra total={Math.max(bolsa, usado)} partes={[...usadoTipo.map((x) => ({ v: x.pesos, c: colorTipo[x.n], t: `${x.n}: ${x.cant} avisos · ${money(x.pesos)}` })),
                        { v: usadoPremier, c: '#A8822B', t: `Premier (Diamond House): ${premierN} avisos · ${money(usadoPremier)}` }, { v: Math.max(0, libre), c: YEL, t: `Sin usar: ${money(libre)}` }]} />
                    <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
                        {usadoTipo.map((x) => <div key={x.n} style={{ display: 'flex', justifyContent: 'space-between' }}><span><span style={{ display: 'inline-block', width: 8, height: 8, background: colorTipo[x.n], marginRight: 5 }} />{x.n}</span><span>{f0(x.cant)} · {money(x.pesos)}</span></div>)}
                        {premierN > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#A8822B', marginRight: 5 }} />Premier (Diamond House)</span><span>{f0(premierN)} · {money(usadoPremier)}</span></div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: libre >= 0 ? '#8A6D00' : RED }}>
                            <span>{libre >= 0 ? 'Sin usar' : 'Nos pasamos'}</span>
                            <span>{money(Math.abs(libre))}{libre > 0 && precio('Súper destacado') ? ` ≈ ${Math.floor(libre / precio('Súper destacado'))} súper destacados` : ''}</span>
                        </div>
                    </div>
                    <div style={{ borderTop: `1px solid ${LGT}`, marginTop: 8, paddingTop: 8, fontSize: 11.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Simples (paquete aparte)</span><b>{f0(simplesNuestros)} de {f0(plan.simplesI24)} · {plan.simplesI24 ? Math.round((100 * simplesNuestros) / plan.simplesI24) : '—'}%</b></div>
                        <div style={{ marginTop: 4 }}><Barra alto={8} total={Math.max(plan.simplesI24 ?? 0, simplesNuestros)} partes={[{ v: simplesNuestros, c: PORTAL.i24.color, t: 'en línea' }, { v: Math.max(0, (plan.simplesI24 ?? 0) - simplesNuestros), c: YEL, t: 'sin usar' }]} /></div>
                    </div>
                    {propias.length > 0 && (
                        <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.4 }}>
                            Fuera de la bolsa (cuenta propia de la inmobiliaria): {propias.reduce((a, x) => a + x[2], 0)} avisos en la cuenta {[...new Set(propias.map((x) => x[0]))].join(', ')}.
                        </div>
                    )}
                </div>
                <div style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${PORTAL.meli.color}`, borderRadius: R, padding: '12px 14px' }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>MercadoLibre · Oro Premium incluidos</div>
                    <div style={{ fontSize: 10.5, color: '#888', marginTop: 2 }}>Paquete desde ago-2026: $57,009 al mes con IVA · 14,000 publicaciones + 1,020 Oro Premium</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0' }}>
                        <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 30 }}>{plan.oroPremiumMeli ? `${Math.round((100 * opMeli) / plan.oroPremiumMeli)}%` : '—'}</span>
                        <span style={{ fontSize: 12, color: '#666' }}>{f0(opMeli)} en línea de {f0(plan.oroPremiumMeli)}</span>
                    </div>
                    <Barra total={Math.max(plan.oroPremiumMeli ?? 0, opMeli)} partes={[{ v: opMeli, c: PORTAL.meli.color, t: 'en línea' }, { v: Math.max(0, (plan.oroPremiumMeli ?? 0) - opMeli), c: YEL, t: 'sin usar' }]} />
                    <div style={{ fontSize: 11.5, marginTop: 8, color: '#555', lineHeight: 1.5 }}>
                        {plan.oroPremiumMeli && opMeli < plan.oroPremiumMeli
                            ? <>Quedan <b>{f0(plan.oroPremiumMeli - opMeli)} Oro Premium</b> que el deal ya incluye y no estamos usando. Asignados en el tool: {f0(tot('MercadoLibre', ['Oro Premium']).cupo)}.</>
                            : plan.oroPremiumMeli && opMeli > plan.oroPremiumMeli
                                ? <>Nos pasamos por <b>{f0(opMeli - plan.oroPremiumMeli)} Oro Premium</b> del paquete. Asignados en el tool: {f0(tot('MercadoLibre', ['Oro Premium']).cupo)}.</>
                                : 'Se usan todos los Oro Premium incluidos.'}
                    </div>
                    {plan.publicacionesMeli != null && (
                        <div style={{ borderTop: `1px solid ${LGT}`, marginTop: 8, paddingTop: 8, fontSize: 11.5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Publicaciones (todos los niveles)</span><b>{f0(pubMeli)} de {f0(plan.publicacionesMeli)} · {Math.round((100 * pubMeli) / plan.publicacionesMeli)}%</b></div>
                            <div style={{ marginTop: 4 }}><Barra alto={8} total={Math.max(plan.publicacionesMeli, pubMeli)} partes={[{ v: pubMeli, c: PORTAL.meli.color, t: 'en línea' }, { v: Math.max(0, plan.publicacionesMeli - pubMeli), c: YEL, t: 'sin usar' }]} /></div>
                        </div>
                    )}
                </div>
            </div>

            <H2 sub="Por nivel: con lead en 30 días (oscuro) · en línea sin lead (gris) · asignado en el tool sin usar (amarillo). El súper destacado de i24 incluye el Premier de Diamond House.">Cupo asignado vs en línea</H2>
            <div className="va-grid" style={{ marginBottom: 12 }}>
                <Tile label="Propiedades publicadas en Pulppo" value={f0(inventario)} nota="Foto de hoy" />
                <Tile label="Lugares asignados sin usar" value={f0(huecoTotal)} nota="Suma por inmobiliaria de (asignado − en línea) en súper destacado, destacado y Oro Premium" />
                <Tile label="Destacados sin un lead" value={f0((['Súper destacado ZD', 'Súper destacado', 'Destacado ZD', 'Destacado'].map((n) => tot('Inmuebles24', [n])).concat([tot('MercadoLibre', ['Oro Premium'])])).reduce((a, x) => a + (x.pub - x.lead), 0))} nota="En línea pero sin ningún lead en 30 días" />
            </div>
            <div className="va-cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
                {portalesVis.map((p) => {
                    const niveles = NIVELES[p].filter((n) => { const t = tot(p, [n]); return t.cupo || t.pub; });
                    const max = Math.max(...niveles.map((n) => { const t = tot(p, [n]); return Math.max(t.cupo, t.pub); }), 1);
                    const t = tot(p);
                    return (
                        <div key={p} style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${PORTAL[PORTAL_PUB[p]].color}`, borderRadius: R, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontWeight: 800, fontSize: 13 }}>{p}</span>
                                <span style={{ fontSize: 11, color: '#666' }}>{f0(t.pub)} en línea · <b style={{ color: offDe(p) ? RED : '#666' }}>{f0(offDe(p))} caídos</b></span>
                            </div>
                            {niveles.map((n) => {
                                const x = tot(p, [n]);
                                const libreN = Math.max(0, x.cupo - x.pub);
                                return (
                                    <div key={n} style={{ marginTop: 9 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                                            <span>{n}</span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                                <b>{f0(x.pub)}</b>{x.cupo ? <span style={{ color: '#888' }}> de {f0(x.cupo)}</span> : null}
                                                <span style={{ color: '#888' }}> · {x.pub ? Math.round((100 * x.lead) / x.pub) : 0}% con lead</span>
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', height: 12, marginTop: 3, background: '#fff', borderRadius: R, overflow: 'hidden' }}>
                                            <span title={`${x.lead} con lead`} style={{ width: `${(100 * x.lead) / max}%`, background: BLK }} />
                                            <span title={`${x.pub - x.lead} sin lead`} style={{ width: `${(100 * (x.pub - x.lead)) / max}%`, background: GRY }} />
                                            <span title={`${libreN} sin usar`} style={{ width: `${(100 * libreN) / max}%`, background: YEL }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            <H2 sub={<>Se cuentan por AVISO: una propiedad caída en 3 portales suma 3. «Caído» = la propiedad está publicada en Pulppo pero su aviso no está en línea en ese portal.</>}>
                Avisos caídos: {f0(totalOff)} · por qué y quién lo corrige
            </H2>
            <div className="va-grid" style={{ marginBottom: 10 }}>
                {porQuien.map((x) => (
                    <div key={x.q} style={{ border: `1px solid ${LGT}`, borderLeft: `4px solid ${COLOR_QUIEN[x.q]}`, borderRadius: R, padding: '10px 12px' }}>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1 }}>{f0(x.n)}</div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 4, lineHeight: 1.35 }}>{TXT_QUIEN[x.q]}</div>
                    </div>
                ))}
            </div>
            <div>
                {[...motivos.values()].sort((a, b) => b.n - a.n).map((m) => (
                    <div key={`${m.portal}|${m.motivo}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 60px', gap: 10, alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${LGT}`, fontSize: 12 }}>
                        <span><b>{m.portal}</b> · {m.motivo}</span>
                        <Barra alto={8} total={Math.max(...[...motivos.values()].map((y) => y.n))} partes={[{ v: m.n, c: COLOR_QUIEN[m.quien], t: m.quien }]} />
                        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{f0(m.n)}</span>
                    </div>
                ))}
            </div>

            <H2 sub="En línea / asignado. Rojo = usa menos del 70% de su cupo. Súper destacado y destacado incluyen sus zona demand (y el Premier). Ordenadas por lugares asignados sin usar.">Uso del cupo por inmobiliaria</H2>
            <div className="va-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                    <thead><tr>
                        <th style={{ ...th, textAlign: 'left' }}>Inmobiliaria</th>
                        <th style={th}>i24 súper dest.</th><th style={th}>i24 destacado</th><th style={th}>i24 simple</th><th style={th}>i24 caídos</th>
                        <th style={th}>MeLi Oro Premium</th><th style={th}>MeLi Plata</th><th style={th}>MeLi caídos</th>
                    </tr></thead>
                    <tbody>
                        {tabla.map((r) => (
                            <tr key={r.n}>
                                <td style={{ ...td, textAlign: 'left', fontWeight: 700, whiteSpace: 'normal' }}>{r.n}</td>
                                <td style={td}>{uso(r.sd)}</td><td style={td}>{uso(r.d)}</td><td style={td}>{uso(r.s)}</td>
                                <td style={{ ...td, color: r.off24 ? RED : GRY }}>{r.off24 || '—'}</td>
                                <td style={td}>{uso(r.op)}</td><td style={td}>{uso(r.pl)}</td>
                                <td style={{ ...td, color: r.offMl ? RED : GRY }}>{r.offMl || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                Asignado = lo que dice el tool de asignación de avisos (registro más reciente por inmobiliaria y portal). En línea = propiedad publicada en
                Pulppo con el aviso activo en ese nivel. Plan contratado y precios de lista: hoja «Calculadora». Foto calculada {new Date(pub.generado).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.
            </div>
        </div>
    );
}
