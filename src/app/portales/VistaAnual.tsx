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
    Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { InventarioMeses, MesCubo } from '@/lib/portales/anual';
import type { PublicacionView } from '@/lib/portales/publicacion';
import { ORDEN_INMOBILIARIAS } from '@/lib/portales/ordenInmobiliarias';
import {
    PORTALES, PORTAL, agregarCeldas, agregarCierres, focosDe, inventarioDe, mesCorto, mesLargo, ordenar, referencias, avanceMes,
    tasa, vacio, type Agg, type Filtro, type Foco, type MesInfo, type Serie,
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
    const ref = useMemo(() => referencias(info), [info]);
    const parcialUlt = info.length > 0 && info[info.length - 1].parcial;

    // focos del filtro actual: por portal y por inmobiliaria (o por portal dentro de la inmobiliaria elegida)
    const focos = useMemo(() => {
        if (!listos) return { rojos: [], buenos: [], notas: [] } as ReturnType<typeof ordenar>;
        const series: Array<[Serie, { leads: number; visita: number }]> = [];
        const ps = (portales.length ? portales : PORTALES.map((p) => p.key)).filter((k) => k !== 'otros');
        const enInmo = !!inmo;
        for (const k of ps) series.push([{ quien: enInmo ? `${inmo} · ${PORTAL[k].nombre}` : PORTAL[k].nombre, filtro: { portal: k },
            meses: serie({ ...filtro, portales: [k] }) }, enInmo ? { leads: 20, visita: 40 } : { leads: 100, visita: 200 }]);
        if (!enInmo) {
            // por inmobiliaria: un solo barrido por mes con `por`
            const porInmo = new Map<string, Agg[]>();
            info.forEach((m, i) => {
                const c = cubos[m.mes];
                for (const [k, a] of agregarCeldas(c.celdas, filtro, (x) => x[1])) {
                    if (!k) continue;
                    const arr = porInmo.get(k) ?? porInmo.set(k, info.map(() => vacio())).get(k)!;
                    Object.assign(arr[i], { ...a, cierres: arr[i].cierres, regalia: arr[i].regalia });
                }
                for (const [k, x] of agregarCierres(c.cierres, filtro, (y) => [...new Set([y[1], y[2]].filter(Boolean))])) {
                    const arr = porInmo.get(k) ?? porInmo.set(k, info.map(() => vacio())).get(k)!;
                    arr[i].cierres = x.n; arr[i].regalia = x.regalia;
                }
            });
            for (const [k, arr] of porInmo) {
                info.forEach((m, i) => { arr[i].inventario = inventarioDe(inv?.meses[m.mes], { ...filtro, inmos: [k] }); });
                series.push([{ quien: k, filtro: { inmo: k }, meses: arr }, { leads: 30, visita: 60 }]);
            }
        } else {
            series.push([{ quien: inmo, filtro: {}, meses: S }, { leads: 20, visita: 40 }]);
        }
        return ordenar(series.flatMap(([s, b]) => focosDe(s, info, b)), SALIENDO);
    }, [listos, filtro, inv, inmo, portales, S]); // eslint-disable-line react-hooks/exhaustive-deps

    const irA = (f: Foco) => {
        if (f.filtro?.inmo) { setInmo(f.filtro.inmo); setVista('tablero'); }
        else if (f.filtro?.portal) { setPortalFoco(f.filtro.portal); setVista('portal'); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ── barra de filtros ──
    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff', maxWidth: '100%' };
    const chip = (on: boolean): CSSProperties => ({ padding: '5px 10px', borderRadius: 999, border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555',
        fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });
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
                        <button key={k} onClick={() => setOp(k)} style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
                            fontWeight: op === k ? 700 : 400, background: op === k ? BLK : '#fff', color: op === k ? '#fff' : '#555' }}>{l}</button>
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

    return (
        <div className="va">
            <style>{`
                .va-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
                .va-2{display:grid;gap:18px;grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
                .va-cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
                .va-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
                @media (max-width:760px){.va-2{grid-template-columns:minmax(0,1fr)}}
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                <div>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1.1 }}>{titulo[vista]}</div>
                    <div style={{ fontSize: 12, color: '#777' }}>{quien}</div>
                </div>
            </div>
            {barra}
            {vista === 'publicacion'
                ? <Publicacion pub={pub} filtro={filtro} />
                : !listos ? <Cargando n={Object.keys(cubos).length} de={meses.length} />
                : vista === 'tablero' ? <Tablero S={S} info={info} ref_={ref} parcialUlt={parcialUlt} focos={focos} irA={irA} cubos={cubos} filtro={filtro} inv={inv}
                    alPortal={(k) => { setPortalFoco(k); setVista('portal'); }} />
                : vista === 'portal' ? <PorPortal portal={portalFoco} setPortal={setPortalFoco} info={info} ref_={ref} cubos={cubos} filtro={filtro} inv={inv} serie={serie}
                    alInmo={(n) => { setInmo(n); setVista('tablero'); }} />
                : <PorInmobiliaria info={info} ref_={ref} cubos={cubos} filtro={filtro} inv={inv} opciones={opciones} focos={focos}
                    alInmo={(n) => { setInmo(n); setVista('tablero'); window.scrollTo({ top: 0 }); }} />}
            <div style={{ fontSize: 10.5, color: '#999', marginTop: 28, lineHeight: 1.5 }}>
                Mismo cálculo que /mb: leads únicos (contacto + propiedad, 400 días), meses en hora de México, respondidos a cualquier hora,
                respuesta en menos de 1 h sólo de 8 am a 8 pm, visitaron / ofertaron = de los leads del mes, cuántos lo hicieron después con esa
                inmobiliaria. Cierres por fecha de cierre con su fuente atribuida. Los meses cerrados se recalculan cada 12 h; el mes en curso, cada 30 min.
            </div>
        </div>
    );
}

function Cargando({ n, de }: { n: number; de: number }) {
    return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>
            Calculando el año… {de ? `${n} de ${de} meses` : ''}
            <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>La primera vez del día tarda un poco; después se queda guardado.</div>
        </div>
    );
}

// ── Tablero ────────────────────────────────────────────────────────────────────────────────────────
type CubosM = Record<string, MesCubo>;
function Tablero({ S, info, ref_, parcialUlt, focos, irA, cubos, filtro, inv, alPortal }: {
    S: Agg[]; info: MesInfo[]; ref_: { cerrado: number; maduro: number }; parcialUlt: boolean; focos: ReturnType<typeof ordenar>;
    irA: (f: Foco) => void; cubos: CubosM; filtro: Filtro; inv: InventarioMeses | null; alPortal: (k: string) => void;
}) {
    const [verNotas, setVerNotas] = useState(false);
    const i = ref_.cerrado, j = ref_.maduro;
    if (i < 0) return null;
    const r = S[i], ant = S.slice(Math.max(0, i - 3), i);
    const avg = (fn: (a: Agg) => number | null) => { const xs = ant.map(fn).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const dPct = (v: number | null, b: number | null) => (v == null || !b ? null : (100 * (v - b)) / b);
    const dPts = (v: number | null, b: number | null) => (v == null || b == null ? null : v - b);
    const mesRef = mesLargo(info[i].mes);
    const ult = info[info.length - 1];
    const av = parcialUlt ? avanceMes(ult) : null;
    const proy = parcialUlt && av && av.corridos >= 3 ? Math.round((S[S.length - 1].leads / av.corridos) * av.total) : null;
    const leadsVals = S.map((a) => a.leads);
    const anioAnt = i >= 12 ? S[i - 12] : null;

    // cada portal en el año
    const ps = (filtro.portales.length ? filtro.portales : PORTALES.map((p) => p.key));
    const porPortal = ps.map((k) => {
        const s = info.map((m) => agregarCeldas(cubos[m.mes].celdas, { ...filtro, portales: [k] }).get('') ?? vacio());
        const prev = s.slice(Math.max(0, i - 3), i).map((a) => a.leads);
        const pa = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
        const d = pa ? (100 * (s[i].leads - pa)) / pa : null;
        const rojo = focos.rojos.some((f) => f.filtro?.portal === k);
        return { k, s, d, rojo };
    }).filter((x) => x.s.some((a) => a.leads > 0));

    return (
        <div>
            <div style={{ fontSize: 13, color: '#555', margin: '14px 0 10px', lineHeight: 1.5 }}>
                <b style={{ color: BLK }}>{mesRef[0].toUpperCase() + mesRef.slice(1)}</b> (último mes cerrado) contra el promedio de los 3 meses anteriores.
                {proy != null && <> · {mesLargo(ult.mes).split(' ')[0]} lleva <b style={{ color: BLK }}>{f0(S[S.length - 1].leads)}</b> leads en {Math.floor(av!.corridos)} días: a este ritmo cerraría en ~{f0(proy)}.</>}
            </div>
            <div className="va-grid">
                <Tile label="Leads" value={f0(r.leads)} delta={<Delta v={dPct(r.leads, avg((a) => a.leads))} sufijo="vs prom. 3 m" />}
                    spark={<Spark vals={leadsVals} parcialUlt={parcialUlt} />} nota={anioAnt?.leads ? `Hace un año: ${f0(anioAnt.leads)}` : undefined} />
                <Tile label="Leads por propiedad" value={tasa.lpp(r) == null ? '—' : String(tasa.lpp(r))} delta={<Delta v={dPct(tasa.lpp(r), avg(tasa.lpp))} sufijo="vs prom. 3 m" />}
                    spark={<Spark vals={S.map((a) => tasa.lpp(a) ?? 0)} parcialUlt={parcialUlt} />} nota={`${f0(r.inventario)} propiedades publicadas`} />
                <Tile label="Sin responder" value={pc(tasa.sinResp(r))} delta={<Delta v={dPts(tasa.sinResp(r), avg(tasa.sinResp))} pts invertir sufijo="vs prom. 3 m" />}
                    spark={<Spark vals={S.map((a) => tasa.sinResp(a) ?? 0)} parcialUlt={parcialUlt} color={RED} />} />
                <Tile label="Respondidos en < 1 h" value={pc(tasa.r1h(r))} delta={<Delta v={dPts(tasa.r1h(r), avg(tasa.r1h))} pts sufijo="vs prom. 3 m" />}
                    spark={<Spark vals={S.map((a) => tasa.r1h(a) ?? 0)} parcialUlt={parcialUlt} />} nota="Leads de 8 am a 8 pm" />
                <Tile label={`Visitaron · ${mesCorto(info[Math.max(j, 0)].mes)}`} value={pc(j >= 0 ? tasa.vis(S[j]) : null)}
                    delta={j >= 3 ? <Delta v={dPts(tasa.vis(S[j]), (() => { const xs = S.slice(j - 3, j).map((a) => tasa.vis(a) ?? 0); return xs.reduce((a, b) => a + b, 0) / xs.length; })())} pts sufijo="vs 3 m antes" /> : undefined}
                    spark={<Spark vals={S.map((a, k) => (k <= j ? tasa.vis(a) ?? 0 : 0))} />} nota="Último mes maduro: los leads recientes todavía no visitan" />
                <Tile label="Cierres" value={f0(r.cierres)} delta={<Delta v={dPct(r.cierres, avg((a) => a.cierres))} sufijo="vs prom. 3 m" />}
                    spark={<Spark vals={S.map((a) => a.cierres)} parcialUlt={parcialUlt} color={SEA} />} nota={`Regalía ${money(r.regalia)}`} />
            </div>

            <div className="va-2" style={{ marginTop: 22 }}>
                <ListaFocos titulo={`Focos rojos (${focos.rojos.length})`} focos={focos.rojos.slice(0, 6)} onIr={irA}
                    vacio="Nada fuera de lo normal: ningún portal ni inmobiliaria cayó contra su propio promedio." />
                <div>
                    <ListaFocos titulo="Lo que va bien" focos={focos.buenos.slice(0, 4)} onIr={irA} vacio="Nada sobresaliente este mes." />
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

            <H2 sub="Leads por mes de cada canal. La barra oscura es el último mes cerrado; la clara, el mes en curso. Clic para ver el detalle del portal.">Cada canal en el año</H2>
            <div className="va-cards">
                {porPortal.map(({ k, s, d, rojo }) => (
                    <div key={k} onClick={() => alPortal(k)} style={{ border: `1px solid ${rojo ? RED : LGT}`, borderTop: `3px solid ${PORTAL[k].color}`, borderRadius: R, padding: '10px 12px', cursor: 'pointer', background: '#fff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontWeight: 800, fontSize: 12.5 }}>{PORTAL[k].nombre}</span>
                            {rojo && <span style={{ fontSize: 10, fontWeight: 800, color: RED, textTransform: 'uppercase' }}>Foco rojo</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
                            <div>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1 }}>{f0(s[i].leads)}</div>
                                <div style={{ fontSize: 11 }}><Delta v={d} /></div>
                            </div>
                            <Spark vals={s.map((a) => a.leads)} parcialUlt={parcialUlt} color={PORTAL[k].color} alto={34} ancho={7} />
                        </div>
                    </div>
                ))}
            </div>
            <LeadsMesChart S={S} info={info} />
        </div>
    );
}

function LeadsMesChart({ S, info }: { S: Agg[]; info: MesInfo[] }) {
    const data = info.map((m, k) => ({ mes: mesCorto(m.mes) + (m.parcial ? '*' : ''), Leads: S[k].leads, Cierres: S[k].cierres }));
    return (
        <>
            <H2 sub="* mes en curso">Leads y cierres por mes</H2>
            <div style={{ height: 230 }}>
                <ResponsiveContainer>
                    <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>
                        <CartesianGrid vertical={false} stroke={LGT} />
                        <XAxis dataKey="mes" tick={{ fontSize: 10.5 }} interval={0} angle={-30} textAnchor="end" height={44} />
                        <YAxis tick={{ fontSize: 10.5 }} />
                        <Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                        <Bar dataKey="Leads" fill={BLK} radius={[2, 2, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </>
    );
}

// ── Por portal ─────────────────────────────────────────────────────────────────────────────────────
function PorPortal({ portal, setPortal, info, ref_, cubos, filtro, inv, serie, alInmo }: {
    portal: string; setPortal: (k: string) => void; info: MesInfo[]; ref_: { cerrado: number; maduro: number }; cubos: CubosM; filtro: Filtro;
    inv: InventarioMeses | null; serie: (f: Filtro) => Agg[]; alInmo: (n: string) => void;
}) {
    const P = PORTAL[portal];
    const S = useMemo(() => serie({ ...filtro, portales: [portal] }), [portal, filtro, inv]); // eslint-disable-line react-hooks/exhaustive-deps
    const resto = useMemo(() => serie({ ...filtro, portales: PORTALES.map((p) => p.key).filter((k) => k !== portal && k !== 'otros') }), [portal, filtro, inv]); // eslint-disable-line react-hooks/exhaustive-deps
    const i = ref_.cerrado, j = ref_.maduro;
    const opF = { ...filtro, portales: [portal] };
    const data = info.map((m, k) => {
        const v = agregarCeldas(cubos[m.mes].celdas, { ...opF, op: 'sale' }).get('')?.leads ?? 0;
        const rr = agregarCeldas(cubos[m.mes].celdas, { ...opF, op: 'rent' }).get('')?.leads ?? 0;
        return {
            mes: mesCorto(m.mes) + (m.parcial ? '*' : ''),
            Venta: filtro.op === 'rent' ? 0 : v, Renta: filtro.op === 'sale' ? 0 : rr,
            'Sin responder': tasa.sinResp(S[k]), 'En < 1 h': tasa.r1h(S[k]),
            [P.nombre]: k <= j ? tasa.vis(S[k]) : null, 'Resto de portales': k <= j ? tasa.vis(resto[k]) : null,
            Cierres: S[k].cierres, Regalía: S[k].regalia,
            'Leads por propiedad': tasa.lpp(S[k]),
        };
    });
    // inmobiliarias de este portal: último mes cerrado vs prom. 3 m
    const top = useMemo(() => {
        const out: Array<{ n: string; ult: number; avg: number }> = [];
        const pm = info.map((m) => agregarCeldas(cubos[m.mes].celdas, opF, (c) => c[1]));
        const nombres = new Set(pm.flatMap((x) => [...x.keys()]).filter(Boolean));
        for (const n of nombres) {
            const ult = pm[i].get(n)?.leads ?? 0;
            const prev = [1, 2, 3].map((d) => pm[i - d]?.get(n)?.leads ?? 0);
            out.push({ n, ult, avg: prev.reduce((a, b) => a + b, 0) / 3 });
        }
        return out.sort((a, b) => b.ult - a.ult).slice(0, 20);
    }, [portal, filtro]); // eslint-disable-line react-hooks/exhaustive-deps
    const maduroIni = j + 1 < info.length ? mesCorto(info[j + 1].mes) + (info[j + 1].parcial ? '*' : '') : null;
    const ultMes = data[data.length - 1]?.mes;
    const tabs = PORTALES.filter((p) => !filtro.portales.length || filtro.portales.includes(p.key));
    const ch = (alto: number, c: ReactNode) => <div style={{ height: alto }}><ResponsiveContainer>{c as React.ReactElement}</ResponsiveContainer></div>;
    const ejes = (pct = false) => [
        <CartesianGrid key="g" vertical={false} stroke={LGT} />,
        <XAxis key="x" dataKey="mes" tick={{ fontSize: 10.5 }} interval={0} angle={-30} textAnchor="end" height={44} />,
        <YAxis key="y" tick={{ fontSize: 10.5 }} unit={pct ? '%' : undefined} />,
    ];
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
                    <H2 sub="* mes en curso">Leads por mes</H2>
                    {ch(230, <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}<Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                        <Bar dataKey="Venta" stackId="a" fill={P.color} /><Bar dataKey="Renta" stackId="a" fill={GRY} radius={[2, 2, 0, 0]} /></BarChart>)}
                </div>
                <div>
                    <H2 sub="Leads del mes ÷ propiedades publicadas: separa «bajó el inventario» de «bajó el portal».">Leads por propiedad</H2>
                    {ch(230, <LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}<Tooltip {...tip} />
                        <Line dataKey="Leads por propiedad" stroke={P.color} strokeWidth={2} dot={{ r: 2 }} /></LineChart>)}
                </div>
            </div>
            <div className="va-2">
                <div>
                    <H2 sub="Sin responder = sin respuesta registrada. En < 1 h: sólo leads de 8 am a 8 pm.">Atención</H2>
                    {ch(220, <LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes(true)}<Tooltip {...tip} formatter={(v) => pc(v as number)} />
                        <Line dataKey="En < 1 h" stroke={SEA} strokeWidth={2} dot={{ r: 2 }} /><Line dataKey="Sin responder" stroke={RED} strokeWidth={2} dot={{ r: 2 }} /></LineChart>)}
                </div>
                <div>
                    <H2 sub="De los leads del mes, cuántos visitaron después. Lo sombreado todavía está madurando.">Visitaron · contra el resto de portales</H2>
                    {ch(220, <LineChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes(true)}<Tooltip {...tip} formatter={(v) => pc(v as number)} />
                        {maduroIni && <ReferenceArea x1={maduroIni} x2={ultMes} fill={LGT} />}
                        <Line dataKey={P.nombre} stroke={P.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                        <Line dataKey="Resto de portales" stroke={GRY} strokeDasharray="4 3" strokeWidth={2} dot={false} /></LineChart>)}
                </div>
            </div>
            <H2 sub="Por fecha de cierre, con la fuente atribuida al portal.">Cierres por mes</H2>
            {ch(200, <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>{ejes()}<Tooltip {...tip} formatter={(v, n) => (n === 'Regalía' ? money(Number(v)) : f0(Number(v)))} />
                <Bar dataKey="Cierres" fill={SEA} radius={[2, 2, 0, 0]} /></BarChart>)}

            <H2 sub={`${mesLargo(info[i].mes)} contra el promedio de los 3 meses anteriores. Clic en una para ver su tablero.`}>Inmobiliarias con más leads de {P.nombre}</H2>
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
                            <span title="promedio de los 3 meses anteriores" style={{ position: 'absolute', top: -2, bottom: -2, left: `${(100 * f.base) / max}%`, width: 2, background: BLK }} />
                            <span style={{ position: 'absolute', left: 6, top: 0, fontSize: 10, color: '#fff', fontWeight: 700, lineHeight: '14px', mixBlendMode: 'difference' }}>{f0(f.valor)}</span>
                        </span>
                        <span style={{ textAlign: 'right', fontSize: 11 }}><Delta v={d} /></span>
                    </div>
                );
            })}
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 4 }}>La rayita negra marca el promedio de los 3 meses anteriores.</div>
        </div>
    );
}

// ── Por inmobiliaria ───────────────────────────────────────────────────────────────────────────────
function PorInmobiliaria({ info, ref_, cubos, filtro, inv, opciones, focos, alInmo }: {
    info: MesInfo[]; ref_: { cerrado: number; maduro: number }; cubos: CubosM; filtro: Filtro; inv: InventarioMeses | null;
    opciones: Opcion[]; focos: ReturnType<typeof ordenar>; alInmo: (n: string) => void;
}) {
    const [orden, setOrden] = useState<'peor' | 'leads' | 'lista'>('peor');
    const [soloFocos, setSoloFocos] = useState(false);
    const i = ref_.cerrado, j = ref_.maduro;
    const parcialUlt = info[info.length - 1]?.parcial ?? false;
    const kamDe = new Map(opciones.map((o) => [o.nombre, o.kam]));
    const posLista = new Map(opciones.map((o, k) => [o.nombre, k]));
    const filas = useMemo(() => {
        const pm = info.map((m) => agregarCeldas(cubos[m.mes].celdas, filtro, (c) => c[1]));
        const cm = info.map((m) => agregarCierres(cubos[m.mes].cierres, filtro, (y) => [...new Set([y[1], y[2]].filter(Boolean))]));
        const nombres = new Set(pm.flatMap((x) => [...x.keys()]).filter(Boolean));
        const rojosDe = new Map<string, Foco[]>();
        for (const f of focos.rojos) if (f.filtro?.inmo) (rojosDe.get(f.filtro.inmo) ?? rojosDe.set(f.filtro.inmo, []).get(f.filtro.inmo)!).push(f);
        return [...nombres].map((n) => {
            const s = pm.map((x) => x.get(n) ?? vacio());
            const ult = s[i];
            const avg = [1, 2, 3].reduce((a, d) => a + (s[i - d]?.leads ?? 0), 0) / 3;
            const invU = inventarioDe(inv?.meses[info[i].mes], { ...filtro, inmos: [n] });
            const invA = [1, 2, 3].map((d) => inventarioDe(inv?.meses[info[i - d]?.mes ?? ''], { ...filtro, inmos: [n] }) ?? 0);
            const lppU = invU ? ult.leads / invU : null;
            const lppA = invA.reduce((a, x, k) => a + (x ? (s[i - k - 1]?.leads ?? 0) / x : 0), 0) / 3;
            const c3 = [0, 1, 2].reduce((a, d) => a + (cm[i - d]?.get(n)?.n ?? 0), 0);
            return { n, s, ult, avg, d: avg >= 5 ? (100 * (ult.leads - avg)) / avg : null, dLpp: lppU != null && lppA ? (100 * (lppU - lppA)) / lppA : null,
                sinR: tasa.sinResp(ult), vis: j >= 0 ? tasa.vis(s[j]) : null, c3, focos: rojosDe.get(n) ?? [] };
        }).filter((f) => f.avg >= 3 || f.ult.leads >= 3 || f.focos.length);
    }, [info, cubos, filtro, inv, focos]); // eslint-disable-line react-hooks/exhaustive-deps
    const vis = filas.filter((f) => !soloFocos || f.focos.length)
        .sort((a, b) => orden === 'leads' ? b.ult.leads - a.ult.leads
            : orden === 'lista' ? (posLista.get(a.n) ?? 999) - (posLista.get(b.n) ?? 999)
            : (b.focos.length ? 1 : 0) - (a.focos.length ? 1 : 0) || (a.d ?? 0) - (b.d ?? 0));
    const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 };
    const maxD = 60;
    return (
        <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
                <span style={{ fontSize: 11.5, color: '#666' }}>Ordenar:</span>
                {([['peor', 'Las que más cayeron'], ['leads', 'Más leads'], ['lista', 'Orden de la lista']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setOrden(k)} style={{ padding: '5px 10px', borderRadius: R, border: `1px solid ${orden === k ? BLK : LGT}`, background: orden === k ? BLK : '#fff',
                        color: orden === k ? '#fff' : '#555', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                ))}
                <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={soloFocos} onChange={(e) => setSoloFocos(e.target.checked)} /> Sólo con foco rojo ({filas.filter((f) => f.focos.length).length})
                </label>
            </div>
            <div className="va-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                    <thead><tr>
                        <th style={{ ...th, textAlign: 'left' }}>Inmobiliaria</th>
                        <th style={{ ...th, textAlign: 'left' }}>Leads · 13 meses</th>
                        <th style={th}>{mesCorto(info[i].mes)}</th>
                        <th style={{ ...th, textAlign: 'center', minWidth: 150 }}>vs prom. 3 m</th>
                        <th style={th} title="Leads por propiedad publicada contra los 3 meses anteriores: si los leads bajan pero esto no, es inventario">Por propiedad</th>
                        <th style={th}>Sin responder</th>
                        <th style={th}>Visitó · {mesCorto(info[Math.max(j, 0)].mes)}</th>
                        <th style={th}>Cierres 3 m</th>
                        <th style={{ ...th, textAlign: 'left' }}>Foco</th>
                    </tr></thead>
                    <tbody>
                        {vis.map((f) => (
                            <tr key={f.n} onClick={() => alInmo(f.n)} style={{ cursor: 'pointer' }}>
                                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 160 }}>
                                    <div style={{ fontWeight: 700 }}>{f.n}</div>
                                    <div style={{ fontSize: 10.5, color: '#888' }}>{kamDe.get(f.n) ? `KAM ${kamDe.get(f.n)}` : 'fuera de la lista'}</div>
                                </td>
                                <td style={{ ...td, textAlign: 'left' }}><Spark vals={f.s.map((a) => a.leads)} parcialUlt={parcialUlt} color={f.focos.length ? RED : BLK} /></td>
                                <td style={{ ...td, fontWeight: 700 }}>{f0(f.ult.leads)}</td>
                                <td style={{ ...td, textAlign: 'center' }}>
                                    {f.d == null ? <span style={{ color: GRY }}>—</span> : (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ position: 'relative', width: 90, height: 10, background: LGT, borderRadius: R, display: 'inline-block' }}>
                                                <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: '#999' }} />
                                                <span style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: R, background: f.d < 0 ? RED : SEA,
                                                    ...(f.d < 0 ? { right: '50%', width: `${Math.min(50, (50 * -f.d) / maxD)}%` } : { left: '50%', width: `${Math.min(50, (50 * f.d) / maxD)}%` }) }} />
                                            </span>
                                            <Delta v={f.d} />
                                        </span>
                                    )}
                                </td>
                                <td style={td}><Delta v={f.dLpp} /></td>
                                <td style={{ ...td, color: (f.sinR ?? 0) >= 10 ? RED : BLK, fontWeight: (f.sinR ?? 0) >= 10 ? 700 : 400 }}>{pc(f.sinR)}</td>
                                <td style={td}>{pc(f.vis)}</td>
                                <td style={td}>{f0(f.c3)}</td>
                                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', fontSize: 11, color: RED, maxWidth: 260 }}>{f.focos.map((x) => x.que.split('.')[0]).join(' · ')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                «Por propiedad» compara los leads por propiedad publicada contra los 3 meses anteriores: si los leads bajan y esto no, salió inventario (no es foco).
                Clic en una inmobiliaria para ver su tablero.
            </div>
        </div>
    );
}

// ── Publicación ────────────────────────────────────────────────────────────────────────────────────
const NIVELES: Record<string, string[]> = {
    Inmuebles24: ['Súper destacado · Premier', 'Súper destacado', 'Destacado', 'Simple', 'Gratis'],
    MercadoLibre: ['Oro Premium', 'Oro', 'Plata', 'Otro'],
    'Propiedades.com': ['En línea'], 'Casas y Terrenos': ['En línea'], EasyBroker: ['En línea'],
};
const PORTAL_PUB: Record<string, string> = { Inmuebles24: 'i24', MercadoLibre: 'meli', 'Propiedades.com': 'pcom', 'Casas y Terrenos': 'cyt', EasyBroker: 'eb' };
function Publicacion({ pub, filtro }: { pub: PublicacionView | null; filtro: Filtro }) {
    if (!pub) return <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>Revisando qué está publicado en cada portal…</div>;
    const iset = filtro.inmos ? new Set(filtro.inmos) : null;
    const portalesVis = Object.keys(NIVELES).filter((p) => !filtro.portales.length || filtro.portales.includes(PORTAL_PUB[p]));
    const filas = pub.filas.filter((f) => !iset || iset.has(f[0]));
    const off = pub.offline.filter((f) => !iset || iset.has(f[0]));
    const inventario = pub.inventario.filter(([n]) => !iset || iset.has(n)).reduce((a, [, n]) => a + n, 0);
    const tot = (portal: string, nivel?: string) => filas.filter((f) => f[1] === portal && (!nivel || f[2] === nivel))
        .reduce((a, f) => ({ cupo: a.cupo + f[3], pub: a.pub + f[4], lead: a.lead + f[5] }), { cupo: 0, pub: 0, lead: 0 });
    const offDe = (portal: string) => off.filter((f) => f[1] === portal).reduce((a, f) => a + f[2], 0);

    // por inmobiliaria: uso del cupo pagado (i24 súper destacado + destacado, MeLi Oro Premium) y de Simple / Plata
    const porInmo = new Map<string, Record<string, { cupo: number; pub: number; lead: number }>>();
    for (const f of filas) {
        const m = porInmo.get(f[0]) ?? porInmo.set(f[0], {}).get(f[0])!;
        const k = `${f[1]}|${f[2]}`;
        const x = m[k] ?? (m[k] = { cupo: 0, pub: 0, lead: 0 });
        x.cupo += f[3]; x.pub += f[4]; x.lead += f[5];
    }
    const g = (m: Record<string, { cupo: number; pub: number; lead: number }>, ks: string[]) => ks.reduce((a, k) => ({ cupo: a.cupo + (m[k]?.cupo ?? 0), pub: a.pub + (m[k]?.pub ?? 0), lead: a.lead + (m[k]?.lead ?? 0) }), { cupo: 0, pub: 0, lead: 0 });
    const tabla = [...porInmo.entries()].map(([n, m]) => ({
        n, sd: g(m, ['Inmuebles24|Súper destacado']), d: g(m, ['Inmuebles24|Destacado']), s: g(m, ['Inmuebles24|Simple']),
        op: g(m, ['MercadoLibre|Oro Premium']), pl: g(m, ['MercadoLibre|Plata']),
        off24: off.filter((f) => f[0] === n && f[1] === 'Inmuebles24').reduce((a, f) => a + f[2], 0),
        offMl: off.filter((f) => f[0] === n && f[1] === 'MercadoLibre').reduce((a, f) => a + f[2], 0),
    })).filter((r) => r.sd.cupo + r.d.cupo + r.s.cupo + r.op.cupo + r.pl.cupo + r.sd.pub + r.s.pub + r.pl.pub > 0)
        .sort((a, b) => (b.sd.cupo + b.op.cupo - b.sd.pub - b.op.pub) - (a.sd.cupo + a.op.cupo - a.sd.pub - a.op.pub));

    const pagado24 = tot('Inmuebles24', 'Súper destacado'), d24 = tot('Inmuebles24', 'Destacado'), op = tot('MercadoLibre', 'Oro Premium');
    const libres = Math.max(0, pagado24.cupo - pagado24.pub) + Math.max(0, d24.cupo - d24.pub) + Math.max(0, op.cupo - op.pub);
    const sinLead = (['Súper destacado', 'Destacado'].map((n) => tot('Inmuebles24', n)).concat([op])).reduce((a, x) => a + (x.pub - x.lead), 0);

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
            <div className="va-grid" style={{ marginTop: 14 }}>
                <Tile label="Propiedades publicadas en Pulppo" value={f0(inventario)} nota="Foto de hoy" />
                <Tile label="Lugares pagados sin usar" value={f0(libres)} nota="Súper destacado y destacado de i24 + Oro Premium de MeLi: cupo asignado − avisos en línea" />
                <Tile label="Lugares pagados sin un lead" value={f0(sinLead)} nota="Avisos destacados en línea que no recibieron ningún lead en 30 días" />
                <Tile label="Avisos fuera de línea" value={f0(off.reduce((a, f) => a + f[2], 0))} nota="Publicada en Pulppo pero el aviso no está en línea en el portal" />
            </div>

            <H2 sub="Por nivel: con lead en 30 días (oscuro) · en línea sin lead (gris) · cupo asignado sin usar (amarillo). i24 y MeLi tienen cupo asignado; los demás no.">¿Estamos aprovechando los avisos?</H2>
            <div className="va-cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
                {portalesVis.map((p) => {
                    const niveles = NIVELES[p].filter((n) => { const t = tot(p, n); return t.cupo || t.pub; });
                    const max = Math.max(...niveles.map((n) => { const t = tot(p, n); return Math.max(t.cupo, t.pub); }), 1);
                    const t = tot(p);
                    return (
                        <div key={p} style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${PORTAL[PORTAL_PUB[p]].color}`, borderRadius: R, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontWeight: 800, fontSize: 13 }}>{p}</span>
                                <span style={{ fontSize: 11, color: '#666' }}>{f0(t.pub)} en línea · <b style={{ color: offDe(p) ? RED : '#666' }}>{f0(offDe(p))} caídos</b></span>
                            </div>
                            {niveles.map((n) => {
                                const x = tot(p, n);
                                const libre = Math.max(0, x.cupo - x.pub);
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
                                            <span title={`${libre} sin usar`} style={{ width: `${(100 * libre) / max}%`, background: YEL }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            <H2 sub="En línea / asignado. Rojo = usa menos del 70% de su cupo. Ordenadas por lugares pagados sin usar.">Uso del cupo por inmobiliaria</H2>
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
                Cupo = lo asignado en el tool de asignación de avisos (registro más reciente por inmobiliaria y portal). En línea = propiedad publicada en
                Pulppo con el aviso activo en ese nivel. i24 OFFLINE cuenta como caído aunque se cobre como Simple (bug de la API key de i24).
                Foto calculada {new Date(pub.generado).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.
            </div>
        </div>
    );
}
