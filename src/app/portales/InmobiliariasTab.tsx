'use client';
// Pestaña "Inmobiliarias" de /portales: leads y funnel comercial por fuente, por asesor, fantasmas,
// descartados y cierres — por inmobiliaria o de toda la red, con comparación contra el periodo
// anterior o el mismo periodo del año pasado. Cálculo en `lib/portales/inmobiliaria.ts`.
//
// Igual que el resto de /portales, nada se consulta hasta que le das Aplicar: con fechas libres,
// cada tecla dispararía una consulta de varios segundos.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Bloque, Cierre, Comparar, Fila, InmoView } from '@/lib/portales/inmobiliaria';

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

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: ReactNode }) {
    return (
        <div style={{ flex: '1 1 150px', background: '#fff', border: `1px solid ${LGT}`, padding: '12px 14px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: GRY, fontWeight: 700 }}>{label}</div>
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

function Seccion({ titulo, sub, onCopiar, children }: { titulo: string; sub?: ReactNode; onCopiar?: () => void; children: ReactNode }) {
    return (
        <div style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 22, fontWeight: 400, margin: 0 }}>{titulo}</h2>
                <div style={{ flex: 1 }} />
                {onCopiar && <button onClick={onCopiar} style={{ fontSize: 11, padding: '4px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>Copiar tabla</button>}
            </div>
            <div style={{ width: 50, height: 1, background: YEL, margin: '8px 0 10px' }} />
            {sub && <div style={{ fontSize: 12, color: '#666', marginBottom: 10, lineHeight: 1.5 }}>{sub}</div>}
            {children}
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

export default function InmobiliariasTab() {
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
    const [b, setB] = useState<Filtros>(ini);          // borrador
    const [ap, setAp] = useState<Filtros | null>(null); // aplicado
    const [ops, setOps] = useState<Opcion[]>([]);
    const [asesores, setAsesores] = useState<Asesor[]>([]);
    const [v, setV] = useState<InmoView | null>(null);
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

    const consultar = useCallback((f: Filtros, refresh = false) => {
        const { desde, hasta } = periodo(f);
        if (!desde || !hasta || desde > hasta) { setErr('El periodo termina antes de empezar.'); return; }
        setCargando(true); setErr(null);
        const q = new URLSearchParams({ view: 'datos', desde, hasta, operacion: f.op, comparar: f.comparar });
        if (f.inmo) q.set('inmo', f.inmo);
        if (f.inmo && f.asesor) q.set('asesor', f.asesor);
        if (refresh) q.set('refresh', '1');
        fetch(`/api/portales/inmobiliarias?${q}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { setV(j); setAp(f); })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(false));
    }, []);

    const sucio = !ap || JSON.stringify(ap) !== JSON.stringify(b);
    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };
    const lbl: CSSProperties = { fontSize: 10, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', display: 'block', marginBottom: 3 };
    const pills = <T extends string>(val: T, opts: Array<[T, string]>, set: (x: T) => void) => (
        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
            {opts.map(([k, l]) => (
                <button key={k} onClick={() => set(k)} style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', fontWeight: val === k ? 700 : 400, background: val === k ? BLK : '#fff', color: val === k ? '#fff' : '#555' }}>{l}</button>
            ))}
        </span>
    );
    const set = <K extends keyof Filtros>(k: K, x: Filtros[K]) => setB((p) => ({ ...p, [k]: x, ...(k === 'inmo' ? { asesor: '' } : {}) }));
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
            <button onClick={() => consultar(b)} disabled={cargando || !sucio} style={{
                padding: '7px 15px', borderRadius: R, border: `1px solid ${sucio ? BLK : LGT}`, background: sucio && !cargando ? BLK : '#fff',
                color: sucio && !cargando ? '#fff' : GRY, fontSize: 12, fontWeight: 700, cursor: sucio && !cargando ? 'pointer' : 'default', fontFamily: 'inherit',
            }}>{cargando ? 'Consultando…' : 'Aplicar'}</button>
            {ap && !sucio && !cargando && <button onClick={() => consultar(ap, true)} style={{ ...inp, cursor: 'pointer', fontSize: 11 }}>Recargar</button>}
            {ap && sucio && !cargando && <span style={{ fontSize: 11, color: '#8A6D00' }}>sin aplicar</span>}
        </div>
    );

    const head = (
        <>
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, fontWeight: 400, margin: '0 0 4px' }}>Leads, funnel y cierres por inmobiliaria</h1>
            <div style={{ fontSize: 12.5, color: '#666', marginBottom: 14 }}>
                Desempeño de los leads por fuente, por asesor y por inmobiliaria, con los fantasmas, los descartados y los cierres del periodo.
            </div>
            {filtros}
        </>
    );

    if (err) return <>{head}<div style={{ marginTop: 16, color: RED, fontSize: 13 }}>No pude calcularlo: {err}</div></>;
    if (!v) return (
        <>{head}
            <div style={{ marginTop: 20, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                {cargando ? 'Consultando Mongo… una inmobiliaria tarda unos segundos; la vista general de un trimestre o YTD puede tardar un par de minutos la primera vez.'
                    : <>Elige la inmobiliaria (o «Todas» para la vista general), el periodo y contra qué comparar, y dale <b>Aplicar</b>.</>}
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
            <td style={td}>{pc(x.pctFantasma)}{c && <div style={{ fontSize: 10 }}><Delta a={x.pctFantasma} b={c.pctFantasma} pts invertir /></div>}</td>
            <td style={td}>{f0(x.rescatados)}</td>
            <td style={{ ...td, fontWeight: 700, color: (x.pctMueren ?? 0) >= 30 ? RED : BLK }}>{pc(x.pctMueren)}{c && <div style={{ fontSize: 10, fontWeight: 400 }}><Delta a={x.pctMueren} b={c.pctMueren} pts invertir /></div>}</td>
            <td style={td}>{pc(x.pctDescartado)}{c && descMaduro && <div style={{ fontSize: 10 }}><Delta a={x.pctDescartado} b={c.pctDescartado} pts invertir /></div>}</td>
            <td style={td}>{pc(x.pctSinResp)}</td>
            <td style={{ ...td, color: (x.pctTelInvalido ?? 0) >= 3 ? RED : BLK }}>{pc(x.pctTelInvalido)}</td>
        </tr>
    );
    const HEAD_CAL = ['', 'Leads', 'Sin conversación', 'Rescatados', 'Mueren de verdad', 'Descartados', 'Sin responder', 'Tel. inválido'];

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
            <td style={td}>{pc(x.pctMueren)}</td>
            <td style={td}>{pc(x.pctDescartado)}</td>
            <td style={{ ...td, color: (x.pctDescSinSeg ?? 0) >= 75 ? RED : BLK }}>{pc(x.pctDescSinSeg)}</td>
        </tr>
    );
    const HEAD_EQ = ['', 'Leads', 'Fuente #1', '% visita', 'Visitas', 'Cierres', '< 60 min', '1ª resp.', 'Mueren', 'Descartados', 'Desc. sin toque'];
    const tsvEquipo = (xs: Fila[], primera: string) => copiar([[primera, ...HEAD_EQ.slice(1), 'Nota'],
        ...xs.map((x) => [x.nombre, x.leads, x.topFuente, x.pVisita, x.visitas, x.cierres, x.pctLt60, x.respMed, x.pctMueren, x.pctDescartado, x.pctDescSinSeg, x.nota])]);

    const ladoColor: Record<Cierre['lado'], string> = { ambos: SEA, vendedor: BLK, comprador: '#8A6D00' };

    return (
        <>
            {head}
            <div style={{ marginTop: 16, fontSize: 13 }}>
                <b>{v.inmobiliaria ? v.inmobiliaria.nombre : 'Toda la red'}</b>
                {v.inmobiliaria?.kam && <span style={{ color: '#666' }}> · KAM {v.inmobiliaria.kam}{v.inmobiliaria.tier ? ` · ${v.inmobiliaria.tier}` : ''}</span>}
                {v.filtro.asesorId && <span style={{ color: '#666' }}> · {asesores.find((a) => a.id === v.filtro.asesorId)?.nombre ?? 'un asesor'}</span>}
                {v.filtro.operacion !== 'todas' && <span style={{ color: '#666' }}> · sólo {v.filtro.operacion === 'sale' ? 'venta' : 'renta'}</span>}
                <span style={{ color: '#666' }}> · {A.etiqueta}</span>
                {C && <span style={{ color: GRY }}> · comparado con {C.etiqueta}</span>}
                {v.inmobiliaria && v.inmobiliaria.cuentas > 1 && <div style={{ fontSize: 11, color: GRY, marginTop: 3 }}>La cuenta está partida en {v.inmobiliaria.cuentas} compañías con el mismo nombre en Pulppo; aquí se suman todas.</div>}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <Kpi label="Leads" value={f0(T.leads)} sub={`${f0(T.unicos)} personas · ${f0(T.venta)} venta / ${f0(T.renta)} renta`} delta={<Delta a={T.leads} b={CT?.leads} />} />
                <Kpi label="Lead → visita" value={pc(T.pVisita)} sub={`${f0(T.visitas)} de ${f0(T.unicos)} personas visitaron`} delta={<Delta a={T.pVisita} b={CT?.pVisita} pts />} />
                <Kpi label="Cierres de la cohorte" value={f0(T.cierres)} sub={`${pc(T.pCierre)} de las personas`} delta={<Delta a={T.cierres} b={CT?.cierres} />} />
                <Kpi label="1ª respuesta" value={mins(T.respMed)} sub={`${pc(T.pctLt60)} en < 60 min`} delta={<Delta a={T.respMed} b={CT?.respMed} invertir />} />
                <Kpi label="Leads que mueren" value={pc(T.pctMueren)} sub={`${pc(T.pctFantasma)} sin conversación`} delta={<Delta a={T.pctMueren} b={CT?.pctMueren} pts invertir />} />
                <Kpi label="Cierres del periodo" value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
            </div>
            {cmpTxt && <div style={{ fontSize: 10.5, color: GRY, marginTop: 6 }}>Las variaciones en verde/rojo son {cmpTxt}. En tasas, la diferencia va en puntos.</div>}

            <Seccion titulo="Funnel comercial por fuente" onCopiar={() => tsvFunnel(A.fuentes, 'Fuente')}
                sub={<>Cohorte: los leads que <b>entraron</b> en el periodo y lo que hicieron <b>después</b>{v.inmobiliaria ? <> — la visita, la oferta y el cierre tienen que ser con {v.inmobiliaria.nombre}</> : null}. Las tasas van sobre personas únicas, no sobre registros.</>}>
                <Embudo t={T} c={CT} />
                <div style={{ height: 14 }} />
                <Tabla head={HEAD_FUNNEL}>
                    {A.fuentes.map((x) => filaFunnel(x, buscar(C?.fuentes, x.key)))}
                    {filaFunnel(T, CT)}
                </Tabla>
                {recienteCohorte && <Aviso>Los cierres de una cohorte reciente salen bajos por construcción: el ciclo de venta va de 43 a 144 días. Para juzgar cierres, compara periodos de hace 4 meses o más, o mira «Cierres del periodo» abajo.</Aviso>}
            </Seccion>

            <Seccion titulo="Leads fantasma y descartados" onCopiar={() => copiar([['Fuente', ...HEAD_CAL.slice(1)], ...A.fuentes.map((x) => [x.nombre, x.leads, x.pctFantasma, x.rescatados, x.pctMueren, x.pctDescartado, x.pctSinResp, x.pctTelInvalido])])}
                sub={<><b>Sin conversación</b>: el lead sólo trae el evento del portal («Vio teléfono», «Contactó por WhatsApp») y ni una llamada. La mayoría no se pierde: el comprador abre WhatsApp y la plática entra por otro lado (<b>rescatados</b>). <b>Mueren de verdad</b> los que tampoco aparecen ahí, de un día antes a 14 días después. Un lead con <b>teléfono inválido</b> (menos de 10 dígitos, todos iguales o una secuencia) también cuenta como fantasma; la última columna dice cuántos son.</>}>
                <Tabla head={['Fuente', ...HEAD_CAL.slice(1)]}>
                    {A.fuentes.map((x) => filaCalidad(x, buscar(C?.fuentes, x.key)))}
                    {filaCalidad(T, CT)}
                </Tabla>
                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 18 }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Por qué se descartan · {f0(A.descarte.total)} leads</div>
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
                    <span style={{ flex: 1 }}>Todos los motivos · y cuántos toques registró el asesor antes de descartar</span>
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
                <Aviso><b>Toque registrado</b> = lo que el <b>asesor</b> hizo en Pulppo sobre esa búsqueda antes de descartarla: seguimientos que marcó como hechos, propiedades que le sugirió, búsqueda que le compartió y notas (las tareas que el sistema crea y cierra solo no cuentan). Los WhatsApp del asesor <b>no se guardan en la base</b>, así que «sin ningún toque» quiere decir sin nada <b>registrado</b>: puede que sí le haya escrito por fuera. Aun así, un descarte por «no responde» sin un solo toque registrado es la señal a revisar. Aquí los toques se cuentan por <b>búsqueda</b> (varios leads de la misma persona comparten una); en la tabla por asesor, «Desc. sin toque» va por <b>lead</b>, así que los dos porcentajes no tienen que coincidir.</Aviso>
                <Aviso>«No responde» en los motivos es lo que <b>marcó el asesor</b> al cerrar la búsqueda; no es lo mismo que el lead fantasma de la tabla de arriba, que se mide por si hubo conversación. «Sin motivo específico» junta el «descartado» genérico, «cancelado» y los que se cerraron sin motivo.</Aviso>
                <Aviso>El descarte <b>madura</b>: un lead de esta semana casi no ha tenido tiempo de cancelarse, así que un periodo reciente siempre se ve más limpio de lo que va a terminar. Contra otro periodo, lee la <b>composición</b> (por qué se descartan), no el porcentaje total{!descMaduro && C ? <> — por eso, con un periodo que cerró hace menos de 45 días, la variación del % de descartados no se muestra</> : null}.</Aviso>
            </Seccion>

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

            <Seccion titulo="Cierres del periodo" onCopiar={() => copiar([['Fecha', 'Operación', 'Código', 'Tipo', 'Colonia', 'Valor', 'Comisión', 'Fuente', 'Lado', 'Asesor', 'ID operación'],
                ...A.cierres.lista.map((x) => [x.fecha, x.operacion, x.codigo, x.tipo, x.colonia, x.valor, x.comision, x.inferida ? `${x.fuente} (inferida)` : x.fuente, x.lado, x.asesor, x.id])])}
                sub={<>Las operaciones que <b>cerraron</b> en el periodo, vengan de leads de cuando sea{v.inmobiliaria ? <>, de los dos lados: donde {v.inmobiliaria.nombre} vende la propiedad y donde trae al comprador</> : null}. La fuente es la del comprador.</>}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Kpi label="Cierres" value={f0(A.cierres.n)} sub={`${f0(A.cierres.venta)} venta · ${f0(A.cierres.renta)} renta`} delta={<Delta a={A.cierres.n} b={C?.cierres.n} />} />
                    <Kpi label="Comisión" value={money(A.cierres.comision)} delta={<Delta a={A.cierres.comision} b={C?.cierres.comision} />} />
                    <Kpi label="Valor cerrado" value={money(A.cierres.valor)} delta={<Delta a={A.cierres.valor} b={C?.cierres.valor} />} />
                </div>
                <div style={{ height: 12 }} />
                <Tabla head={['Fuente del comprador', 'Cierres', 'Venta', 'Renta', 'Comisión', 'Inferidas']} min={600}>
                    {A.cierres.porFuente.map((x) => (
                        <tr key={x.fuente}><td style={td0}>{x.fuente}</td><td style={td}>{f0(x.n)}</td><td style={td}>{f0(x.venta)}</td><td style={td}>{f0(x.renta)}</td><td style={td}>{money(x.comision)}</td><td style={{ ...td, color: x.inferidas ? '#8A6D00' : GRY }}>{x.inferidas ? f0(x.inferidas) : '—'}</td></tr>
                    ))}
                </Tabla>
                {A.cierres.sinFuenteOriginal > 0 && (
                    <Aviso>
                        <b>{f0(A.cierres.sinFuenteOriginal)} de {f0(A.cierres.n)}</b> cierres venían sin fuente en la operación (<code>other</code>). Se atribuyeron así:
                        si el comprador lo trajo una inmobiliaria de fuera de Pulppo, <b>Broker externo</b>; si fue otra de la red, <b>Red Pulppo</b>;
                        si el comprador tenía un lead previo, el canal de su <b>primer lead</b> (columna «Inferidas»); y si tenía contacto pero ningún lead, <b>Cartera / sin lead</b> (cliente propio, referido o contacto directo).
                        {A.cierres.sinAtribuir ? <> Quedan <b>{f0(A.cierres.sinAtribuir)}</b> sin poder atribuir.</> : <> No queda ninguno sin atribuir.</>}
                    </Aviso>
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
                            <td style={td0}>{x.fuente}{x.inferida && <div style={{ fontSize: 10, color: '#8A6D00' }}>inferida del 1er lead</div>}</td>
                            <td style={{ ...td0, color: ladoColor[x.lado], fontWeight: 700 }}>{x.lado}</td>
                            <td style={{ ...td0, whiteSpace: 'normal' }}>{x.asesor}</td>
                        </tr>
                    ))}
                    {!A.cierres.lista.length && <tr><td style={{ ...td0, color: GRY }} colSpan={8}>Sin cierres en el periodo.</td></tr>}
                </Tabla>
                {A.cierres.n > A.cierres.lista.length && <div style={{ fontSize: 11, color: GRY, marginTop: 6 }}>Se muestran los {A.cierres.lista.length} más recientes de {f0(A.cierres.n)}.</div>}
            </Seccion>
            <div style={{ fontSize: 10, color: GRY, marginTop: 26 }}>
                Excluye Habi y cuentas de prueba. Calculado {new Date(v.generado).toLocaleString('es-MX')}.
            </div>
        </>
    );
}
