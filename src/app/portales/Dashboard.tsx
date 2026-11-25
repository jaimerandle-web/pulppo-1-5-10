'use client';
// /portales → Dashboard (Ale, 25-nov-2026): UN solo tablero con filtros en vez de «Tablero / Por portal / Por
// inmobiliaria» y las cinco pestañas de «Detalle de un periodo». Las secciones son las áreas de la tabla de KPIs de
// Marketing + Success: Volumen · Operacional · Calidad / Funnel · Eficiencia · Cobertura · Anuncios. Cada área trae su
// cifra global y una tabla que se desglosa por CANAL o por INMOBILIARIA (el mismo selector para todas). Los focos rojos
// van AL FINAL («para que no ensucie»).
//
// Datos: los mismos cubos mensuales de VistaAnual (mismo cálculo que /mb) + la inversión por mes del Sheet
// (?view=inversion) + la cobertura del inventario de hoy (?view=cobertura) + la foto de publicación (?view=publicacion).
//
// Madurez (para no leer mal): la visita se mide en meses cerrados hace 30+ días y el lead-to-close en meses cerrados
// hace 90+ días (el ciclo de venta va de 43 a 144 días). Cierres, comisión, revenue y ticket son por FECHA DE CIERRE.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { CoberturaView, InversionMeses } from '@/lib/portales/anual';
import type { PublicacionView } from '@/lib/portales/publicacion';
import {
    PORTALES, PORTAL, PORTAL_DE_INVERSION, agregarCierres, avanceMes, etiquetaRango, mesLargo, promedio, sumar, tasa,
    type Agg, type Foco, type ordenar,
} from '@/lib/portales/focos';
import {
    BLK, GRY, LGT, RED, SEA, YEL, R, f0, money, pc, Spark, Delta, Tile, H2, ListaFocos, PorCanalChart, type Ctx, type Opcion,
} from './piezas';

type Dim = 'canal' | 'inmo';
// = MELI_PAQUETE de lib/portales/inversion.ts. No se importa: inversion.ts carga deal.ts en caliente y eso mete el driver
// de Mongo al bundle del navegador. Si cambia el paquete, cambiar las dos.
const MELI_PAQUETE = { precioPublicacion: 1, precioOroPremium: (57_009 - 14_000) / 1_020 } as const;
const DIA = 86400000;
/** benchmarks del funnel (CS handover): visita 14%, lead→cierre 1.6% venta / 6% renta */
const BENCH = { visita: 14, l2cVenta: 1.6, l2cRenta: 6 };
const PAGADOS = PORTALES.filter((p) => p.pagado).map((p) => p.key);

const p1 = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const div = (a: number | null | undefined, b: number | null | undefined) => (a == null || !b ? null : a / b);
const dPct = (v: number | null, b: number | null) => (v == null || !b ? null : (100 * (v - b)) / b);
const dPts = (v: number | null, b: number | null) => (v == null || b == null ? null : v - b);
const minTxt = (m: number | null) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());
const mx = (n: number | null) => (n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : money(n));
const roiTxt = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}x`);

/** una fila de desglose (un canal o una inmobiliaria) con su periodo, sus 3 meses previos y sus ventanas maduras */
interface Fila {
    key: string; nombre: string; color?: string; s: Agg[];
    T: Agg; P: Agg; A: Agg | null; V: Agg | null; L: Agg | null;
    inv: number | null | undefined; regPag: number; kam?: string | null;
}

export default function Dashboard({ c, S, focos, irA, inv, cob, pub, opciones, porInmo, alInmo }: {
    c: Ctx; S: Agg[]; focos: ReturnType<typeof ordenar>; irA: (f: Foco) => void;
    inv: InversionMeses | null; cob: CoberturaView | null; pub: PublicacionView | null;
    opciones: Opcion[]; porInmo: Map<string, Agg[]>; alInmo: (n: string) => void;
}) {
    const [dim, setDim] = useState<Dim>('canal');
    const [verNotas, setVerNotas] = useState(false);
    const { info, rango, filtro, cubos, parcialUlt } = c;
    const k = rango.b - rango.a + 1;
    const etq = etiquetaRango(info, rango);
    const ahora = Date.now();

    // ventanas maduras: visita (30 d) y lead-to-close (90 d)
    const j30 = c.ref.maduro;
    let j90 = info.length - 1;
    while (j90 >= 0 && new Date(info[j90].hasta).getTime() > ahora - 90 * DIA) j90--;
    const ventana = (j: number) => { const vb = Math.min(rango.b, j); if (vb < 0) return null; return { a: rango.a <= vb ? rango.a : vb, b: vb }; };
    const W30 = ventana(j30), W90 = ventana(j90);

    // inversión de un mes (prorrateada si va a medias). `keys` = portales; null = toda la inversión del Sheet.
    const invMes = (i: number, keys: string[] | null): number | null => {
        const m = info[i], x = inv?.meses[m.mes];
        if (!x || x.faltante) return null;
        let t = 0;
        for (const [ck, v] of Object.entries(x.porCanal)) {
            const pk = PORTAL_DE_INVERSION[ck];
            if (keys && (!pk || !keys.includes(pk))) continue;
            if (v == null) return null;
            t += v;
        }
        // mes en curso: el plan del Sheet se prorratea a los días corridos (MeLi no: lo facturado ya va a la fecha)
        if (m.parcial) { const av = avanceMes(m); const ml = (!keys || keys.includes('meli')) ? x.porCanal.meli ?? 0 : 0; t = ((t - ml) * av.corridos) / av.total + ml; }
        return t;
    };
    const invPeriodo = (keys: string[] | null): number | null | undefined => {
        if (!inv) return undefined;
        let t = 0;
        for (let i = rango.a; i <= rango.b; i++) { const v = invMes(i, keys); if (v == null) return null; t += v; }
        return t;
    };

    /** regalía de los cierres que vienen de un portal pagado (el numerador del ROI) */
    const regaliaPagada = (portales: string[], inmos: string[] | null) => {
        let t = 0;
        for (let i = rango.a; i <= rango.b; i++) t += agregarCierres(cubos[info[i].mes].cierres, { ...filtro, portales, inmos }).get('')?.regalia ?? 0;
        return t;
    };

    const armar = (key: string, nombre: string, s: Agg[], extra: Partial<Fila> = {}): Fila => ({
        key, nombre, s,
        T: sumar(s.slice(rango.a, rango.b + 1)), P: promedio(s.slice(rango.a, rango.b + 1)),
        A: rango.a >= 3 ? promedio(s.slice(rango.a - 3, rango.a)) : null,
        V: W30 ? sumar(s.slice(W30.a, W30.b + 1)) : null, L: W90 ? sumar(s.slice(W90.a, W90.b + 1)) : null,
        inv: undefined, regPag: 0, ...extra,
    });

    // ── total del filtro ──
    const pagadosFiltro = filtro.portales.length ? filtro.portales.filter((x) => PAGADOS.includes(x)) : PAGADOS;
    const total = useMemo(() => armar('', 'Total', S, {
        // con inmobiliaria elegida la inversión no se puede repartir (es de toda la red): va su ROA abajo
        inv: filtro.inmos ? undefined : invPeriodo(filtro.portales.length ? filtro.portales : null),
        regPag: regaliaPagada(pagadosFiltro, filtro.inmos),
    }), [S, rango, inv, filtro]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── filas por canal ──
    const porCanal: Fila[] = useMemo(() => {
        const ks = filtro.portales.length ? filtro.portales : PORTALES.map((p) => p.key);
        return ks.map((key) => {
            const s = c.serie({ ...filtro, portales: [key] });
            const pagado = !!PORTAL[key].pagado;
            return armar(key, PORTAL[key].nombre, s, {
                color: PORTAL[key].color,
                inv: filtro.inmos ? undefined : pagado ? invPeriodo([key]) : 0,
                regPag: pagado ? regaliaPagada([key], filtro.inmos) : 0,
            });
        }).filter((f) => f.s.some((a) => a.leads > 0 || a.cierres > 0));
    }, [filtro, rango, inv, cubos]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── costo de lista de los avisos de HOY por inmobiliaria (para el ROA) ──
    const costoInmo = useMemo(() => {
        const out = new Map<string, number>();
        if (!pub) return out;
        const precio = (portal: string, nivel: string) => portal === 'Inmuebles24'
            ? (nivel === 'Gratis' ? 0 : pub.plan.precios[nivel] ?? pub.plan.precios[nivel.replace(' ZD', '')] ?? (nivel === 'Simple' ? 15 : 0))
            : portal === 'MercadoLibre' ? MELI_PAQUETE.precioPublicacion + (nivel === 'Oro Premium' ? MELI_PAQUETE.precioOroPremium : 0) : 0;
        for (const [n, portal, nivel, , enLinea] of pub.filas) out.set(n, (out.get(n) ?? 0) + enLinea * precio(portal, nivel));
        return out;
    }, [pub]);

    // ── filas por inmobiliaria ──
    const kamDe = useMemo(() => new Map(opciones.map((o) => [o.nombre, o.kam])), [opciones]);
    const porInmobiliaria: Fila[] = useMemo(() => [...porInmo.entries()].map(([n, s]) => {
        const costo = costoInmo.get(n);
        return armar(n, n, s, { kam: kamDe.get(n), inv: costo == null ? undefined : costo * k, regPag: regaliaPagada(pagadosFiltro, [n]) });
    }).filter((f) => f.T.leads >= 3 || f.T.cierres > 0), [porInmo, rango, costoInmo, kamDe, filtro]); // eslint-disable-line react-hooks/exhaustive-deps

    const filas = dim === 'canal' ? porCanal : porInmobiliaria;
    const T = total;

    // ── el mes en curso: ritmo y proyección contra el mes pasado ──
    const ult = info[info.length - 1];
    const enCurso = parcialUlt ? (() => {
        const av = avanceMes(ult);
        const hoy = S[S.length - 1], prev = S[S.length - 2];
        const f = av.corridos >= 3 ? av.total / av.corridos : null;
        return { av, hoy, prev, f, invHoy: filtro.inmos ? null : invMes(info.length - 1, filtro.portales.length ? filtro.portales : null) };
    })() : null;

    // ── estilos de tabla ──
    const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' };
    const th0: CSSProperties = { ...th, textAlign: 'left' };
    const td: CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 };
    const td0: CSSProperties = { ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 150 };
    const tdT: CSSProperties = { ...td, fontWeight: 800, borderTop: `1px solid ${BLK}` };
    const nombreCelda = (f: Fila) => (
        <td style={{ ...td0, cursor: dim === 'inmo' ? 'pointer' : 'default' }} onClick={dim === 'inmo' ? () => alInmo(f.key) : undefined}>
            {f.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: f.color, marginRight: 6 }} />}
            <b>{f.nombre}</b>
            {dim === 'inmo' && <div style={{ fontSize: 10.5, color: '#888' }}>{f.kam ? `KAM ${f.kam}` : 'fuera de la lista'}</div>}
        </td>
    );
    const limite = dim === 'inmo' ? 40 : 99;
    const primeras = (xs: Fila[], fn: (f: Fila) => number) => [...xs].sort((a, b) => fn(b) - fn(a)).slice(0, limite);
    const pie = dim === 'inmo' && filas.length > limite ? <Nota>Se muestran las {limite} primeras de {filas.length}. Elige una inmobiliaria arriba para ver su tablero.</Nota> : null;

    const DimSel = (
        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: R, overflow: 'hidden' }}>
            {([['canal', 'Por canal'], ['inmo', 'Por inmobiliaria']] as const).map(([kk, l]) => (
                <button key={kk} onClick={() => setDim(kk)} style={{ padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
                    fontWeight: dim === kk ? 700 : 400, background: dim === kk ? BLK : '#fff', color: dim === kk ? '#fff' : '#555' }}>{l}</button>
            ))}
        </span>
    );
    const sufijo = k === 1 ? 'vs prom. 3 m previos' : 'prom./mes vs 3 m previos';

    // meses del periodo cuyo tab del Sheet trae el plan de otro mes copiado (todavía no se actualiza)
    const copias = info.slice(rango.a, rango.b + 1).filter((m) => inv?.meses[m.mes]?.copiaDe).map((m) => `${mesLargo(m.mes).split(' ')[0]} (de ${inv!.meses[m.mes].copiaDe})`);
    // KPIs de cabecera
    const lpl = T.inv ? div(T.inv, T.T.leads) : null;
    const roi = T.inv ? div(T.regPag, T.inv) : null;
    const cpv = T.inv && W30 ? div(T.inv, T.T.vis) : null;
    const vWin = W30 ? etiquetaRango(info, W30) : null, lWin = W90 ? etiquetaRango(info, W90) : null;

    // ── cobertura (foto de hoy; no depende del canal) ──
    const cobF = useMemo(() => {
        if (!cob) return null;
        const iset = filtro.inmos ? new Set(filtro.inmos) : null;
        return cob.filas.filter((f) => (!iset || iset.has(f[0])) && (filtro.op === 'todas' || (filtro.op === 'sale' ? f[1] === 's' : f[1] === 'r')));
    }, [cob, filtro]);
    const sumCob = (xs: NonNullable<typeof cobF>) => xs.reduce((a, f) => ({ n: a.n + f[3], c30: a.c30 + f[4], c60: a.c60 + f[5], c90: a.c90 + f[6], l30: a.l30 + f[7], l60: a.l60 + f[8], l90: a.l90 + f[9], z: a.z + f[10] }),
        { n: 0, c30: 0, c60: 0, c90: 0, l30: 0, l60: 0, l90: 0, z: 0 });

    return (
        <div>
            {/* ═══ ¿Cómo vamos en el mes? ═══ */}
            {enCurso && (
                <div style={{ border: `1px solid ${LGT}`, borderLeft: `4px solid ${YEL}`, borderRadius: R, padding: '12px 14px', margin: '14px 0 4px', background: '#FFFCF2' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                        ¿Cómo vamos en {mesLargo(ult.mes).split(' ')[0]}? · día {Math.floor(enCurso.av.corridos)} de {enCurso.av.total}
                    </div>
                    <div className="db-mes" style={{ marginTop: 8 }}>
                        <Ritmo label="Leads" hoy={enCurso.hoy.leads} f={enCurso.f} prev={enCurso.prev?.leads} />
                        <Ritmo label="Cierres" hoy={enCurso.hoy.cierres} f={enCurso.f} prev={enCurso.prev?.cierres} />
                        <Ritmo label="Revenue (regalía)" hoy={enCurso.hoy.regalia} f={enCurso.f} prev={enCurso.prev?.regalia} dinero />
                        <Ritmo label="Visitaron (hasta hoy)" hoy={enCurso.hoy.vis} f={null} prev={null} nota={`${pc(tasa.vis(enCurso.hoy))} de sus leads; todavía madura`} />
                        {enCurso.invHoy != null && enCurso.hoy.leads > 0 && (
                            <Ritmo label="CPL a la fecha" hoy={enCurso.invHoy / enCurso.hoy.leads} f={null} prev={null} dinero
                                nota={`Inversión prorrateada a ${Math.floor(enCurso.av.corridos)} días: ${mx(enCurso.invHoy)}`} />
                        )}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#888', marginTop: 6 }}>
                        Proyección = lo que lleva ÷ días corridos × días del mes, contra el mes pasado completo. Los cierres se cargan con retraso: su proyección suele quedarse corta.
                    </div>
                </div>
            )}

            {/* ═══ cabecera del periodo ═══ */}
            <div style={{ fontSize: 13, color: '#555', margin: '16px 0 10px', lineHeight: 1.5 }}>
                <b style={{ color: BLK }}>{etq[0].toUpperCase() + etq.slice(1)}</b>{k > 1 ? ` (${k} meses)` : ''} contra el promedio de los 3 meses previos.
                {info[rango.b]?.parcial && <> Incluye el mes en curso, que va a medias.</>}
            </div>
            <div className="va-grid">
                <Tile label="Leads" value={f0(T.T.leads)} delta={<Delta v={dPct(T.P.leads, T.A?.leads ?? null)} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => a.leads)} parcialUlt={parcialUlt} />} />
                <Tile label={`Tasa de visita · ${vWin ?? '—'}`} value={pc(T.V ? tasa.vis(T.V) : null)}
                    delta={<Bench v={T.V ? tasa.vis(T.V) : null} meta={BENCH.visita} />} nota="Meses cerrados hace 30+ días" />
                <Tile label={`Lead-to-close · ${lWin ?? '—'}`} value={T.L && tasa.l2c(T.L) != null ? `${tasa.l2c(T.L)}%` : '—'}
                    nota={`Meses cerrados hace 90+ días · ref. ${BENCH.l2cVenta}% venta, ${BENCH.l2cRenta}% renta`} />
                <Tile label="Cierres" value={f0(T.T.cierres)} delta={<Delta v={dPct(T.P.cierres, T.A?.cierres ?? null)} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => a.cierres)} parcialUlt={parcialUlt} color={SEA} />} nota={`Comisión ${mx(T.T.comision)}`} />
                <Tile label="Revenue (regalía)" value={mx(T.T.regalia)} delta={<Delta v={dPct(T.P.regalia, T.A?.regalia ?? null)} sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => a.regalia)} parcialUlt={parcialUlt} color={SEA} />} />
                <Tile label="Inversión" value={T.inv === undefined ? '—' : T.inv === null ? 's/d' : mx(T.inv)}
                    nota={filtro.inmos ? 'Es de toda la red: con inmobiliaria elegida ve su ROA en Eficiencia' : T.inv === null ? 'Falta cargar un mes en el Sheet' : copias.length ? `Ojo: ${copias.join(', ')} en el Sheet es copia de otro mes` : 'Sheet «Investment Strategy» + deal de MeLi'} />
                <Tile label="CPL" value={lpl == null ? '—' : money(lpl)} nota={cpv != null ? `CPV ${money(cpv)}` : undefined} />
                <Tile label="ROI" value={roiTxt(roi)} nota="Regalía de cierres de portales pagados ÷ inversión" />
            </div>

            {/* ═══ 1. VOLUMEN ═══ */}
            <Area n={1} titulo="Volumen" sub="Cuántos leads llegan, de dónde y de qué operación." derecha={DimSel} />
            <div className="va-grid" style={{ marginBottom: 12 }}>
                <Tile label="Leads venta" value={f0(T.T.venta)} delta={<Delta v={dPct(T.P.venta, T.A?.venta ?? null)} sufijo={sufijo} />} nota={`${pc(p1(T.T.venta, T.T.leads))} del total`} />
                <Tile label="Leads renta" value={f0(T.T.renta)} delta={<Delta v={dPct(T.P.renta, T.A?.renta ?? null)} sufijo={sufijo} />} nota={`${pc(p1(T.T.renta, T.T.leads))} del total`} />
                <Tile label="Leads por propiedad" value={tasa.lpp(T.P) == null ? '—' : String(tasa.lpp(T.P))} delta={<Delta v={dPct(tasa.lpp(T.P), T.A ? tasa.lpp(T.A) : null)} sufijo={sufijo} />}
                    nota={`Al mes · ${f0(T.P.inventario)} propiedades publicadas`} />
                <Tile label="Δ leads vs Δ inventario" value={(() => { const dl = dPct(T.P.leads, T.A?.leads ?? null), di = dPct(T.P.inventario, T.A?.inventario ?? null); return dl == null || di == null ? '—' : `${dl >= 0 ? '+' : ''}${Math.round(dl)}% / ${di >= 0 ? '+' : ''}${Math.round(di)}%`; })()}
                    nota="Si los leads caen más que el inventario, no es inventario: es el canal o la atención" />
            </div>
            <PorCanalChart c={c} que="leads" />
            <div className="va-scroll" style={{ marginTop: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead><tr>
                        <th style={th0}>{dim === 'canal' ? 'Canal' : 'Inmobiliaria'}</th><th style={{ ...th0 }}>13 meses</th>
                        <th style={th}>Leads</th><th style={th}>% del total</th><th style={th}>Venta</th><th style={th}>Renta</th><th style={th}>vs 3 m previos</th>
                    </tr></thead>
                    <tbody>
                        {primeras(filas, (f) => f.T.leads).map((f) => (
                            <tr key={f.key}>
                                {nombreCelda(f)}
                                <td style={{ ...td, textAlign: 'left' }}><Spark vals={f.s.map((a) => a.leads)} parcialUlt={parcialUlt} color={f.color ?? BLK} /></td>
                                <td style={{ ...td, fontWeight: 700 }}>{f0(f.T.leads)}</td>
                                <td style={td}>{pc(p1(f.T.leads, T.T.leads))}</td>
                                <td style={td}>{f0(f.T.venta)}</td><td style={td}>{f0(f.T.renta)}</td>
                                <td style={td}><Delta v={f.A && f.A.leads >= 5 ? dPct(f.P.leads, f.A.leads) : null} /></td>
                            </tr>
                        ))}
                        <tr><td style={{ ...tdT, textAlign: 'left' }}>Total</td><td style={tdT} /><td style={tdT}>{f0(T.T.leads)}</td><td style={tdT}>100%</td><td style={tdT}>{f0(T.T.venta)}</td><td style={tdT}>{f0(T.T.renta)}</td><td style={tdT}><Delta v={dPct(T.P.leads, T.A?.leads ?? null)} /></td></tr>
                    </tbody>
                </table>
            </div>
            {pie}

            {/* ═══ 2. OPERACIONAL ═══ */}
            <Area n={2} titulo="Operacional" sub="Qué tan rápido y cuánto se responde. Respondidos = con respuesta registrada a cualquier hora; < 1 h y tiempo medio sólo con leads de 8 am a 8 pm." derecha={DimSel} />
            <div className="va-grid" style={{ marginBottom: 12 }}>
                <Tile label="Tasa de respuesta" value={pc(tasa.resp(T.T))} delta={<Delta v={dPts(tasa.resp(T.P), T.A ? tasa.resp(T.A) : null)} pts sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => tasa.resp(a) ?? 0)} parcialUlt={parcialUlt} />} />
                <Tile label="Respondidos en < 1 h" value={pc(tasa.r1h(T.T))} delta={<Delta v={dPts(tasa.r1h(T.P), T.A ? tasa.r1h(T.A) : null)} pts sufijo={sufijo} />}
                    spark={<Spark vals={S.map((a) => tasa.r1h(a) ?? 0)} parcialUlt={parcialUlt} />} />
                <Tile label="Tiempo medio 1ª respuesta" value={minTxt(tasa.minResp(T.T))} delta={<Delta v={dPct(tasa.minResp(T.P), T.A ? tasa.minResp(T.A) : null)} invertir sufijo={sufijo} />}
                    nota="Cada lead topado a 24 h" />
                <Tile label="Sin responder" value={pc(tasa.sinResp(T.T))} delta={<Delta v={dPts(tasa.sinResp(T.P), T.A ? tasa.sinResp(T.A) : null)} pts invertir sufijo={sufijo} />}
                    nota="% contacto (con conversación) y por qué se descartan: en Leads y calidad" />
            </div>
            <div className="va-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                    <thead><tr>
                        <th style={th0}>{dim === 'canal' ? 'Canal' : 'Inmobiliaria'}</th><th style={th}>Leads</th><th style={th}>Respondidos</th><th style={th}>Sin responder</th>
                        <th style={th}>{'< 1 h'}</th><th style={th}>Tiempo medio</th><th style={th}>Δ sin responder</th>
                    </tr></thead>
                    <tbody>
                        {primeras(filas, (f) => f.T.leads).map((f) => {
                            const sr = tasa.sinResp(f.T);
                            return (
                                <tr key={f.key}>
                                    {nombreCelda(f)}
                                    <td style={td}>{f0(f.T.leads)}</td><td style={td}>{pc(tasa.resp(f.T))}</td>
                                    <td style={{ ...td, color: (sr ?? 0) >= 10 ? RED : BLK, fontWeight: (sr ?? 0) >= 10 ? 700 : 400 }}>{pc(sr)}</td>
                                    <td style={td}>{pc(tasa.r1h(f.T))}</td><td style={td}>{minTxt(tasa.minResp(f.T))}</td>
                                    <td style={td}><Delta v={f.A && f.A.leads >= 10 ? dPts(tasa.sinResp(f.P), tasa.sinResp(f.A)) : null} pts invertir /></td>
                                </tr>
                            );
                        })}
                        <tr><td style={{ ...tdT, textAlign: 'left' }}>Total</td><td style={tdT}>{f0(T.T.leads)}</td><td style={tdT}>{pc(tasa.resp(T.T))}</td><td style={tdT}>{pc(tasa.sinResp(T.T))}</td><td style={tdT}>{pc(tasa.r1h(T.T))}</td><td style={tdT}>{minTxt(tasa.minResp(T.T))}</td><td style={tdT} /></tr>
                    </tbody>
                </table>
            </div>
            {pie}

            {/* ═══ 3. CALIDAD / FUNNEL ═══ */}
            <Area n={3} titulo="Calidad / Funnel" sub={<>Cohorte: de los leads, cuántos visitaron, ofertaron y cerraron DESPUÉS con esa inmobiliaria. Visita en {vWin ?? '—'} (cerrados hace 30+ días); lead-to-close en {lWin ?? '—'} (cerrados hace 90+ días). Operaciones = cierres por fecha de cierre en {etq}.</>} derecha={DimSel} />
            <Funnel L={T.L} V={T.V} lWin={lWin} vWin={vWin} />
            <div className="va-scroll" style={{ marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                    <thead><tr>
                        <th style={th0}>{dim === 'canal' ? 'Canal' : 'Inmobiliaria'}</th>
                        <th style={th} title={`Leads de ${vWin ?? '—'}`}>Leads · {vWin ?? '—'}</th><th style={th}>Visitaron</th><th style={th}>Tasa de visita</th>
                        <th style={th} title={`Leads de ${lWin ?? '—'}`}>Leads · {lWin ?? '—'}</th><th style={th}>Ofertaron</th><th style={th}>Cerraron</th><th style={th}>Lead-to-close</th>
                        <th style={th}>Operaciones · {etq}</th><th style={th}>Venta / renta</th>
                    </tr></thead>
                    <tbody>
                        {primeras(filas, (f) => f.T.cierres * 1000 + f.T.leads).map((f) => {
                            const tv = f.V ? tasa.vis(f.V) : null;
                            return (
                                <tr key={f.key}>
                                    {nombreCelda(f)}
                                    <td style={td}>{f0(f.V?.leads)}</td><td style={td}>{f0(f.V?.vis)}</td>
                                    <td style={{ ...td, fontWeight: 700, color: tv == null ? GRY : tv >= BENCH.visita ? SEA : tv < BENCH.visita / 2 ? RED : BLK }}>{pc(tv)}</td>
                                    <td style={td}>{f0(f.L?.leads)}</td><td style={td}>{f0(f.L?.ofe)}</td><td style={td}>{f0(f.L?.clo)}</td>
                                    <td style={{ ...td, fontWeight: 700 }}>{f.L && tasa.l2c(f.L) != null ? `${tasa.l2c(f.L)}%` : '—'}</td>
                                    <td style={{ ...td, fontWeight: 700 }}>{f0(f.T.cierres)}</td>
                                    <td style={{ ...td, color: '#777' }}>{f.T.cierres ? `${f0(cierresOp(c, f, dim, 's'))} / ${f0(cierresOp(c, f, dim, 'r'))}` : '—'}</td>
                                </tr>
                            );
                        })}
                        <tr>
                            <td style={{ ...tdT, textAlign: 'left' }}>Total</td><td style={tdT}>{f0(T.V?.leads)}</td><td style={tdT}>{f0(T.V?.vis)}</td><td style={tdT}>{pc(T.V ? tasa.vis(T.V) : null)}</td>
                            <td style={tdT}>{f0(T.L?.leads)}</td><td style={tdT}>{f0(T.L?.ofe)}</td><td style={tdT}>{f0(T.L?.clo)}</td><td style={tdT}>{T.L ? `${tasa.l2c(T.L)}%` : '—'}</td>
                            <td style={tdT}>{f0(T.T.cierres)}</td><td style={tdT} />
                        </tr>
                    </tbody>
                </table>
            </div>
            <Nota>Operaciones de un canal = cierres cuya fuente atribuida es ese canal (los que no vienen de ningún canal —directo, red, sin registro— sólo cuentan en el total). Verde: visita en o sobre el {BENCH.visita}% de referencia; rojo: menos de la mitad.</Nota>
            {pie}

            {/* ═══ 4. EFICIENCIA ═══ */}
            <Area n={4} titulo="Eficiencia" sub={dim === 'canal'
                ? 'Lo que cuesta cada canal y lo que regresa. Inversión: Sheet «Investment Strategy» (MeLi: facturado ago–nov, paquete desde dic); el mes en curso, prorrateado. Revenue = regalía de Pulppo; comisión = la de la inmobiliaria; ticket = valor promedio de la operación.'
                : 'ROA = regalía de los cierres que vinieron de portales pagados ÷ costo de lista de sus avisos de HOY (i24 por nivel + MeLi a costo del paquete) × meses del periodo. Es aproximado: usa la foto de hoy, no lo que tuvo cada mes.'} derecha={DimSel} />
            <div className="va-2">
                <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', margin: '4px 0 6px' }}>Cierres por mes y canal</div>
                    <PorCanalChart c={c} que="cierres" />
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', margin: '4px 0 6px' }}>Mix de inversión · {etq}</div>
                    <MixInversion filas={porCanal} total={porCanal.reduce((a, f) => a + (f.inv ?? 0), 0)} />
                </div>
            </div>
            <div className="va-scroll" style={{ marginTop: 12 }}>
                {dim === 'canal' ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
                        <thead><tr>
                            <th style={th0}>Canal</th><th style={th}>Inversión</th><th style={th}>% mix</th><th style={th}>Leads</th><th style={th}>CPL</th>
                            <th style={th}>Visitaron</th><th style={th}>CPV</th><th style={th}>Cierres</th><th style={th}>Comisión</th><th style={th}>Revenue</th><th style={th}>Ticket</th><th style={th}>ROI</th>
                        </tr></thead>
                        <tbody>
                            {(() => {
                                const invT = porCanal.reduce((a, f) => a + (f.inv ?? 0), 0);
                                return primeras(filas, (f) => (f.inv ?? 0) * 10 + f.T.regalia).map((f) => {
                                    const pag = !!PORTAL[f.key]?.pagado;
                                    const invTxt = filtro.inmos ? '—' : !pag ? 'sin costo' : f.inv == null ? 's/d' : f.inv === 0 ? 'gratis' : mx(f.inv);
                                    const r = f.inv ? div(f.regPag, f.inv) : null;
                                    return (
                                        <tr key={f.key}>
                                            {nombreCelda(f)}
                                            <td style={{ ...td, color: pag ? BLK : GRY }}>{invTxt}</td>
                                            <td style={td}>{f.inv && invT ? pc(p1(f.inv, invT)) : '—'}</td>
                                            <td style={td}>{f0(f.T.leads)}</td>
                                            <td style={{ ...td, fontWeight: 700 }}>{f.inv ? money(div(f.inv, f.T.leads)) : '—'}</td>
                                            <td style={td}>{f0(f.V?.vis)}</td>
                                            <td style={td}>{f.inv && f.V?.vis ? money(div(f.inv, f.T.vis)) : '—'}</td>
                                            <td style={td}>{f0(f.T.cierres)}</td>
                                            <td style={td}>{mx(f.T.comision)}</td>
                                            <td style={{ ...td, fontWeight: 700 }}>{mx(f.T.regalia)}</td>
                                            <td style={td}>{f.T.cierres ? mx(f.T.valor / f.T.cierres) : '—'}</td>
                                            <td style={{ ...td, fontWeight: 800, color: r == null ? GRY : r >= 1 ? SEA : RED }}>{roiTxt(r)}</td>
                                        </tr>
                                    );
                                });
                            })()}
                            <tr>
                                <td style={{ ...tdT, textAlign: 'left' }}>Total</td><td style={tdT}>{T.inv == null ? '—' : mx(T.inv)}</td><td style={tdT} /><td style={tdT}>{f0(T.T.leads)}</td>
                                <td style={tdT}>{lpl == null ? '—' : money(lpl)}</td><td style={tdT}>{f0(T.T.vis)}</td><td style={tdT}>{cpv == null ? '—' : money(cpv)}</td><td style={tdT}>{f0(T.T.cierres)}</td>
                                <td style={tdT}>{mx(T.T.comision)}</td><td style={tdT}>{mx(T.T.regalia)}</td><td style={tdT}>{T.T.cierres ? mx(T.T.valor / T.T.cierres) : '—'}</td><td style={tdT}>{roiTxt(roi)}</td>
                            </tr>
                        </tbody>
                    </table>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                        <thead><tr>
                            <th style={th0}>Inmobiliaria</th><th style={th} title="Costo de lista de sus avisos en línea hoy, por los meses del periodo">Costo avisos</th><th style={th}>Leads</th><th style={th}>Costo / lead</th>
                            <th style={th}>Cierres</th><th style={th}>Comisión</th><th style={th}>Revenue</th><th style={th}>De portales</th><th style={th}>Ticket</th><th style={th}>ROA</th>
                        </tr></thead>
                        <tbody>
                            {primeras(filas, (f) => f.T.regalia).map((f) => {
                                const r = f.inv ? div(f.regPag, f.inv) : null;
                                return (
                                    <tr key={f.key}>
                                        {nombreCelda(f)}
                                        <td style={td}>{f.inv == null ? (pub ? 'sin avisos' : '…') : mx(f.inv)}</td>
                                        <td style={td}>{f0(f.T.leads)}</td>
                                        <td style={td}>{f.inv ? money(div(f.inv, f.T.leads)) : '—'}</td>
                                        <td style={td}>{f0(f.T.cierres)}</td><td style={td}>{mx(f.T.comision)}</td>
                                        <td style={{ ...td, fontWeight: 700 }}>{mx(f.T.regalia)}</td><td style={td}>{mx(f.regPag)}</td>
                                        <td style={td}>{f.T.cierres ? mx(f.T.valor / f.T.cierres) : '—'}</td>
                                        <td style={{ ...td, fontWeight: 800, color: r == null ? GRY : r >= 1 ? SEA : RED }}>{roiTxt(r)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            <Nota>ROI / ROA = regalía de los cierres atribuidos a portales pagados ÷ inversión. Verde: se paga (≥ 1x). Canales sin línea en el Sheet (Monopolio, Tokko, WhatsApp…) salen «sin costo»: si alguno sí se paga, hay que darlo de alta en el Sheet.</Nota>
            {pie}

            {/* ═══ 5. COBERTURA ═══ */}
            <Area n={5} titulo="Cobertura" sub="Foto de HOY del inventario publicado: cuántas propiedades reciben leads (de cualquier fuente) y cuántas están muertas. No cambia con el filtro de canal ni de periodo." derecha={DimSel} />
            {!cobF ? <Cargando txt="Contando leads por propiedad…" /> : (() => {
                const G = sumCob(cobF);
                const venta = sumCob(cobF.filter((f) => f[1] === 's')), renta = sumCob(cobF.filter((f) => f[1] === 'r'));
                const grupos = new Map<string, NonNullable<typeof cobF>>();
                for (const f of cobF) { const kk = dim === 'canal' ? f[2] : f[0]; (grupos.get(kk) ?? grupos.set(kk, []).get(kk)!).push(f); }
                const rows = [...grupos.entries()].map(([n, xs]) => ({ n, x: sumCob(xs) })).sort((a, b) => b.x.n - a.x.n).slice(0, limite);
                return (
                    <>
                        <div className="va-grid" style={{ marginBottom: 12 }}>
                            <Tile label="Propiedades publicadas" value={f0(G.n)} nota={`${f0(venta.n)} venta · ${f0(renta.n)} renta`} />
                            <Tile label="L/L 30 · 60 · 90 d" value={`${(G.l30 / Math.max(G.n, 1)).toFixed(1)} · ${(G.l60 / Math.max(G.n, 1)).toFixed(1)} · ${(G.l90 / Math.max(G.n, 1)).toFixed(1)}`}
                                nota={`Venta ${(venta.l30 / Math.max(venta.n, 1)).toFixed(1)} · renta ${(renta.l30 / Math.max(renta.n, 1)).toFixed(1)} leads/propiedad en 30 d`} />
                            <Tile label="Con ≥ 1 lead · 30 · 60 · 90 d" value={`${pc(p1(G.c30, G.n))}`} nota={`60 d ${pc(p1(G.c60, G.n))} · 90 d ${pc(p1(G.c90, G.n))}`} />
                            <Tile label="Zombies a 30 d" value={f0(G.z)} nota={`${pc(p1(G.z, G.n))} del inventario: publicadas hace 30+ días y sin un solo lead en 30 días`} />
                        </div>
                        <div className="va-scroll">
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                                <thead><tr>
                                    <th style={th0}>{dim === 'canal' ? 'Tipo de inmueble' : 'Inmobiliaria'}</th><th style={th}>Propiedades</th>
                                    <th style={th}>L/L 30 d</th><th style={th}>L/L 60 d</th><th style={th}>L/L 90 d</th>
                                    <th style={th}>Con lead 30 d</th><th style={th}>60 d</th><th style={th}>90 d</th><th style={th}>Zombies</th>
                                </tr></thead>
                                <tbody>
                                    {rows.map(({ n, x }) => (
                                        <tr key={n} onClick={dim === 'inmo' ? () => alInmo(n) : undefined} style={{ cursor: dim === 'inmo' ? 'pointer' : 'default' }}>
                                            <td style={td0}><b>{n}</b></td><td style={td}>{f0(x.n)}</td>
                                            <td style={{ ...td, fontWeight: 700 }}>{(x.l30 / Math.max(x.n, 1)).toFixed(1)}</td><td style={td}>{(x.l60 / Math.max(x.n, 1)).toFixed(1)}</td><td style={td}>{(x.l90 / Math.max(x.n, 1)).toFixed(1)}</td>
                                            <td style={td}>{pc(p1(x.c30, x.n))}</td><td style={td}>{pc(p1(x.c60, x.n))}</td><td style={td}>{pc(p1(x.c90, x.n))}</td>
                                            <td style={{ ...td, color: p1(x.z, x.n)! >= 30 ? RED : BLK, fontWeight: p1(x.z, x.n)! >= 30 ? 700 : 400 }}>{f0(x.z)} <span style={{ color: '#888', fontWeight: 400 }}>({pc(p1(x.z, x.n))})</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Nota>L/L = leads únicos (contacto + propiedad) ÷ propiedades publicadas hoy. {dim === 'canal' ? 'Por canal no aplica (la propiedad es la misma en todos): se desglosa por tipo de inmueble.' : ''}</Nota>
                    </>
                );
            })()}

            {/* ═══ 6. ANUNCIOS ═══ */}
            <Area n={6} titulo="Anuncios" sub="Avisos en línea HOY por nivel y por tipo de inmobiliaria (tier de la lista), con cuántos tuvieron lead en 30 días. El cupo, el plan contratado y los caídos están en «Publicación»." />
            {!pub ? <Cargando txt="Revisando qué está publicado en cada portal…" /> : <Anuncios pub={pub} opciones={opciones} inmos={filtro.inmos} portales={filtro.portales} />}

            {/* ═══ focos al final ═══ */}
            <Area n={7} titulo="Focos rojos y lo que va bien" sub="Último periodo contra el promedio de sus 3 meses previos, ordenados por leads afectados. Clic para filtrar." />
            <div className="va-2b">
                <ListaFocos titulo={`Focos rojos (${focos.rojos.length})`} focos={focos.rojos.slice(0, 10)} onIr={irA}
                    vacio="Nada fuera de lo normal: ningún canal ni inmobiliaria cayó contra su propio promedio." />
                <div>
                    <ListaFocos titulo="Lo que va bien" focos={focos.buenos.slice(0, 6)} onIr={irA} vacio="Nada sobresaliente en el periodo." />
                    {focos.notas.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                            <button onClick={() => setVerNotas((x) => !x)} style={{ fontSize: 11.5, background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}>
                                {verNotas ? 'Ocultar' : 'Ver'} {focos.notas.length} {focos.notas.length === 1 ? 'caída explicada' : 'caídas explicadas'} (inventario o inmobiliarias que se van)
                            </button>
                            {verNotas && <div style={{ marginTop: 8 }}><ListaFocos titulo="" focos={focos.notas} onIr={irA} vacio="" /></div>}
                        </div>
                    )}
                </div>
            </div>
            {focos.rojos.length > 10 && <Nota>Hay {focos.rojos.length - 10} focos más. Elige «Por inmobiliaria» en cualquier tabla para ver todas.</Nota>}
            <style>{`.db-mes{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}`}</style>
        </div>
    );
}

// ── piezas del dashboard ────────────────────────────────────────────────────────────────────────────

function Area({ n, titulo, sub, derecha }: { n: number; titulo: string; sub?: ReactNode; derecha?: ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', borderTop: `2px solid ${BLK}`, marginTop: 34, paddingTop: 10, marginBottom: 12 }}>
            <div style={{ minWidth: 0, flex: '1 1 380px' }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1 }}><span style={{ color: GRY, marginRight: 8 }}>{n}</span>{titulo}</div>
                {sub && <div style={{ fontSize: 11.5, color: '#777', marginTop: 4, lineHeight: 1.45, maxWidth: 820 }}>{sub}</div>}
            </div>
            {derecha}
        </div>
    );
}
function Nota({ children }: { children: ReactNode }) {
    return <div style={{ fontSize: 10.5, color: '#888', marginTop: 6, lineHeight: 1.5 }}>{children}</div>;
}
function Cargando({ txt }: { txt: string }) {
    return <div style={{ padding: '18px 0', color: '#777', fontSize: 12.5 }}>{txt}</div>;
}
function Bench({ v, meta }: { v: number | null; meta: number }) {
    if (v == null) return <span style={{ color: GRY }}>—</span>;
    const d = Math.round((v - meta) * 10) / 10;
    return <span style={{ color: d >= 0 ? SEA : RED, fontWeight: 700 }}>{d >= 0 ? '▲ +' : '▼ '}{d} pts <span style={{ color: '#888', fontWeight: 400 }}>vs ref. {meta}%</span></span>;
}
function Ritmo({ label, hoy, f, prev, dinero, nota }: { label: string; hoy: number; f: number | null; prev: number | null | undefined; dinero?: boolean; nota?: string }) {
    const fmt = (n: number) => (dinero ? mx(n) : f0(n));
    const proy = f != null ? hoy * f : null;
    const d = proy != null && prev ? (100 * (proy - prev)) / prev : null;
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1 }}>{fmt(hoy)}</div>
            {proy != null && <div style={{ fontSize: 11 }}>→ ~{fmt(proy)} al cierre {prev ? <span style={{ color: '#888' }}>vs {fmt(prev)} el mes pasado </span> : null}<Delta v={d} /></div>}
            {nota && <div style={{ fontSize: 10.5, color: '#888' }}>{nota}</div>}
        </div>
    );
}

/** embudo horizontal: leads → visitaron → ofertaron → cerraron (cohortes maduras) */
function Funnel({ L, V, lWin, vWin }: { L: Agg | null; V: Agg | null; lWin: string | null; vWin: string | null }) {
    if (!L && !V) return <Nota>Todavía no hay meses maduros en el periodo.</Nota>;
    const pasos = [
        { l: 'Leads', n: V?.leads ?? 0, t: null as number | null, w: vWin },
        { l: 'Visitaron', n: V?.vis ?? 0, t: V ? tasa.vis(V) : null, w: vWin },
        { l: 'Ofertaron', n: L?.ofe ?? 0, t: L ? tasa.ofe(L) : null, w: lWin },
        { l: 'Cerraron', n: L?.clo ?? 0, t: L ? tasa.l2c(L) : null, w: lWin },
    ];
    const max = Math.max(V?.leads ?? 0, L?.leads ?? 0, 1);
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {pasos.map((p, i) => (
                <div key={p.l} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{p.l}</div>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1 }}>{f0(p.n)}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>{i === 0 ? `leads de ${p.w ?? '—'}` : <><b>{p.t ?? '—'}%</b> de los leads de {p.w ?? '—'}</>}</div>
                    <div style={{ height: 6, background: LGT, borderRadius: R, marginTop: 6 }}>
                        <div style={{ height: 6, width: `${Math.max(1, (100 * p.n) / max)}%`, background: i === 3 ? SEA : BLK, borderRadius: R }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** barra apilada del mix de inversión por canal */
function MixInversion({ filas, total }: { filas: Fila[]; total: number }) {
    const xs = filas.filter((f) => f.inv && f.inv > 0).sort((a, b) => (b.inv ?? 0) - (a.inv ?? 0));
    if (!xs.length || !total) return <Nota>Sin inversión para el filtro (o falta cargar un mes en el Sheet).</Nota>;
    return (
        <div>
            <div style={{ display: 'flex', height: 18, borderRadius: R, overflow: 'hidden', background: LGT }}>
                {xs.map((f) => <span key={f.key} title={`${f.nombre}: ${mx(f.inv!)}`} style={{ width: `${(100 * f.inv!) / total}%`, background: f.color }} />)}
            </div>
            <div style={{ marginTop: 8 }}>
                {xs.map((f) => (
                    <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${LGT}` }}>
                        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: f.color, marginRight: 6 }} />{f.nombre}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{mx(f.inv!)} · <b>{pc(p1(f.inv!, total))}</b></span>
                    </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', fontWeight: 800 }}><span>Total en canales</span><span>{mx(total)}</span></div>
            </div>
        </div>
    );
}

/** cierres de una fila (canal o inmobiliaria) en una operación, dentro del periodo */
function cierresOp(c: Ctx, f: Fila, dim: Dim, op: 's' | 'r'): number {
    let n = 0;
    for (let i = c.rango.a; i <= c.rango.b; i++) {
        const filtro = dim === 'canal' ? { ...c.filtro, portales: [f.key], op: op === 's' ? 'sale' as const : 'rent' as const }
            : { ...c.filtro, inmos: [f.key], op: op === 's' ? 'sale' as const : 'rent' as const };
        n += agregarCierres(c.cubos[c.info[i].mes].cierres, filtro).get('')?.n ?? 0;
    }
    return n;
}

/** avisos en línea por nivel × tier de la inmobiliaria (foto de hoy) */
function Anuncios({ pub, opciones, inmos, portales }: { pub: PublicacionView; opciones: Opcion[]; inmos: string[] | null; portales: string[] }) {
    const tierDe = new Map(opciones.map((o) => [o.nombre, o.tier || 'Sin tier']));
    const iset = inmos ? new Set(inmos) : null;
    const COLS: Array<[string, string, string]> = [
        ['Inmuebles24', 'Súper destacado', 'i24'], ['Inmuebles24', 'Destacado', 'i24'], ['Inmuebles24', 'Simple', 'i24'],
        ['MercadoLibre', 'Oro Premium', 'meli'], ['MercadoLibre', 'Oro', 'meli'], ['MercadoLibre', 'Plata', 'meli'],
        ['Propiedades.com', 'En línea', 'pcom'], ['Casas y Terrenos', 'En línea', 'cyt'], ['EasyBroker', 'En línea', 'eb'],
    ];
    const cols = COLS.filter(([, , pk]) => !portales.length || portales.includes(pk));
    const nivelDe = (n: string) => n.replace(' ZD', '');
    const acc = new Map<string, Map<string, { pub: number; lead: number }>>();
    for (const [n, portal, nivel, , enLinea, conLead] of pub.filas) {
        if (iset && !iset.has(n)) continue;
        const t = tierDe.get(n) ?? 'Fuera de la lista';
        const m = acc.get(t) ?? acc.set(t, new Map()).get(t)!;
        const kk = `${portal}|${nivelDe(nivel)}`;
        const x = m.get(kk) ?? m.set(kk, { pub: 0, lead: 0 }).get(kk)!;
        x.pub += enLinea; x.lead += conLead;
    }
    const tiers = [...acc.keys()].sort((a, b) => ORDEN_TIER(a) - ORDEN_TIER(b));
    const th: CSSProperties = { textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${LGT}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 };
    const celda = (x?: { pub: number; lead: number }) => !x || !x.pub ? <span style={{ color: GRY }}>—</span>
        : <span><b>{f0(x.pub)}</b> <span style={{ color: '#888' }}>· {Math.round((100 * x.lead) / x.pub)}%</span></span>;
    const tot = (kk: string) => tiers.reduce((a, t) => { const x = acc.get(t)!.get(kk); return { pub: a.pub + (x?.pub ?? 0), lead: a.lead + (x?.lead ?? 0) }; }, { pub: 0, lead: 0 });
    return (
        <div className="va-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                    <tr>
                        <th style={{ ...th, textAlign: 'left' }}>Tier</th>
                        {cols.map(([p, n, pk]) => <th key={p + n} style={{ ...th, borderTop: `3px solid ${PORTAL[pk].color}` }}>{p === 'Inmuebles24' ? 'i24' : p === 'MercadoLibre' ? 'MeLi' : p}<br />{n}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {tiers.map((t) => (
                        <tr key={t}>
                            <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{t}</td>
                            {cols.map(([p, n]) => <td key={p + n} style={td}>{celda(acc.get(t)!.get(`${p}|${n}`))}</td>)}
                        </tr>
                    ))}
                    <tr>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 800, borderTop: `1px solid ${BLK}` }}>Total</td>
                        {cols.map(([p, n]) => <td key={p + n} style={{ ...td, borderTop: `1px solid ${BLK}` }}>{celda(tot(`${p}|${n}`))}</td>)}
                    </tr>
                </tbody>
            </table>
            <Nota>Avisos en línea · % con al menos un lead en 30 días. Súper destacado y destacado incluyen sus zona demand (y el Premier de Diamond House).</Nota>
        </div>
    );
}
const ORDEN_TIER = (t: string) => { const i = ['TOP', 'MID', 'BOTTOM', 'Baja', 'Sin tier', 'Fuera de la lista'].indexOf(t); return i < 0 ? 50 : i; };
