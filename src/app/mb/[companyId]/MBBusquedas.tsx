'use client';

/**
 * Búsquedas de NURA (oct-2026). Port del tablero que validó Sofía (hand-over «nura-busquedas-dashboard»,
 * prototipo en Claude con corte fijo): aquí lee en vivo de Mongo vía /api/mb-busquedas.
 *
 * Todo se calcula en el navegador sobre las ~2,200 filas, como el prototipo: encabezado, totales,
 * embudo, por mes, motivos de cancelación, por fuente, por asesor y el detalle. Un selector
 * Todas / Venta / Renta cambia el tablero entero.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { BusquedaNura } from '@/lib/nuraBusquedas';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
type Op = 'todas' | 'sale' | 'rent';
const OP_LBL: Record<string, string> = { sale: 'Venta', rent: 'Renta', 'sin dato': 'Sin dato' };
const EST_LBL: Record<string, string> = { pending: 'Pendiente', searching: 'Buscando', visiting: 'En visitas', offer_done: 'Oferta hecha', completed: 'Completada', cancelled: 'Cancelada' };
const MOT_LBL: Record<string, string> = { asesor: 'Es asesor inmobiliario', perdido: 'Cliente perdido', fantasma: 'No responde', incontactable: 'WhatsApp inválido', descartado: 'Nota del asesor', inesperado: 'Inesperado', '': 'Sin motivo' };
const CREADA_LBL: Record<string, string> = { lead: 'Lead', manual: 'Manual' };
// «Activa» = pendiente, buscando, en visitas u oferta hecha
const ABIERTAS = new Set(['pending', 'searching', 'visiting', 'offer_done']);
const MESL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesFmt = (k: string) => `${MESL[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('es-MX')}%`;
const money = (v: number) => (v ? `$${Math.round(v).toLocaleString('es-MX')}` : '—');
const hoyMx = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px' };
const thN: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const tdN: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function Seccion({ titulo, nota, children }: { titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 28 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 820 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Kpi({ label, value, nota }: { label: string; value: string; nota?: string }) {
    return (
        <div style={{ flex: '1 1 150px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 25, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}</div>
            {nota && <div style={{ fontSize: 10.5, color: '#777' }}>{nota}</div>}
        </div>
    );
}
function Tabla({ children, min = 560 }: { children: ReactNode; min?: number }) {
    return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: min, borderCollapse: 'collapse' }}>{children}</table></div>;
}

export default function MBBusquedas({ companyId }: { companyId: string }) {
    const [rows, setRows] = useState<BusquedaNura[] | null>(null);
    const [generado, setGenerado] = useState('');
    const [err, setErr] = useState('');
    const [op, setOp] = useState<Op>('todas');
    useEffect(() => {
        let vivo = true;
        fetch(`/api/mb-busquedas?company=${companyId}`)
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) { setRows(j.busquedas); setGenerado(j.generado); } else setErr(j.error || 'No se pudieron leer las búsquedas'); })
            .catch(() => vivo && setErr('No se pudieron leer las búsquedas'));
        return () => { vivo = false; };
    }, [companyId]);

    const r = useMemo(() => (rows ?? []).filter((b) => op === 'todas' || b.operacion === op), [rows, op]);

    if (err) return <p style={{ fontSize: 13, color: RED }}>{err}</p>;
    if (!rows) return <p style={{ fontSize: 13, color: GRY }}>Leyendo las búsquedas en vivo…</p>;

    return (
        <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                {([['todas', 'Todas'], ['sale', 'Venta'], ['rent', 'Renta']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setOp(k)} style={{ border: `1px solid ${op === k ? BLK : '#E5E5E5'}`, borderRadius: R,
                        background: op === k ? BLK : '#fff', color: op === k ? '#fff' : BLK, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                ))}
            </div>
            <Resumen r={r} />
            <Embudo r={r} />
            <PorMes r={r} />
            <Motivos r={r} />
            <PorFuente r={r} />
            <PorAsesor r={r} />
            <Detalle r={r} />
            <p style={{ fontSize: 10, color: GRY, marginTop: 14 }}>En vivo desde Mongo · {generado ? new Date(generado).toLocaleString('es-MX') : ''}</p>
        </div>
    );
}

const cuenta = (r: BusquedaNura[]) => {
    const total = r.length;
    const visita = r.filter((b) => b.llegoVisita === 1).length;
    const oferta = r.filter((b) => b.llegoOferta === 1).length;
    const completadas = r.filter((b) => b.estatus === 'completed').length;
    const activas = r.filter((b) => ABIERTAS.has(b.estatus ?? '')).length;
    return { total, visita, oferta, completadas, activas };
};

// ── encabezado + totales ──
function Resumen({ r }: { r: BusquedaNura[] }) {
    const k = cuenta(r);
    const pV = k.total ? k.visita / k.total : 0, pO = k.total ? k.oferta / k.total : 0, conv = k.total ? k.completadas / k.total : 0;
    const fugas: Array<[string, number]> = [['entre la creación y la primera visita', 1 - pV], ['entre la visita y la oferta', k.visita ? 1 - k.oferta / k.visita : 0], ['entre la oferta y el cierre', k.oferta ? 1 - k.completadas / k.oferta : 0]];
    const peor = fugas.reduce((a, b) => (b[1] > a[1] ? b : a));
    return (<>
        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 20, lineHeight: 1.35, margin: '14px 0 12px', maxWidth: 860 }}>
            {k.total ? <><b>{pc(conv)}</b> de las búsquedas termina completada. La mayor fuga está {peor[0]}: ahí se pierde el <b style={{ color: RED }}>{pc(peor[1])}</b>.</> : 'Sin búsquedas para esta operación.'}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Kpi label="Creadas" value={f0(k.total)} />
            <Kpi label="Activas hoy" value={f0(k.activas)} nota="pendiente, buscando, en visitas u oferta hecha" />
            <Kpi label="Llegaron a visita" value={f0(k.visita)} nota={`${pc(pV)} de las creadas`} />
            <Kpi label="Llegaron a oferta" value={f0(k.oferta)} nota={`${pc(pO)} de las creadas`} />
            <Kpi label="Completadas" value={f0(k.completadas)} nota={`${pc(conv)} de conversión`} />
        </div>
    </>);
}

// ── embudo ──
function Embudo({ r }: { r: BusquedaNura[] }) {
    const k = cuenta(r);
    const pasos: Array<[string, number]> = [['Creadas', k.total], ['Con visita', k.visita], ['Con oferta', k.oferta], ['Completadas', k.completadas]];
    const perd = pasos.map(([, n], i) => (i && pasos[i - 1][1] ? 1 - n / pasos[i - 1][1] : null));
    const peor = Math.max(...perd.map((x) => x ?? -1));
    return (
        <Seccion titulo="Embudo" nota="Búsquedas que alguna vez llegaron a cada etapa (por su historial) y qué parte se pierde contra la etapa anterior. La mayor pérdida va en rojo.">
            {pasos.map(([etapa, n], i) => (
                <div key={etapa} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '7px 0', fontSize: 12 }}>
                    <span style={{ width: 110, flexShrink: 0, fontWeight: 700 }}>{etapa}</span>
                    <span style={{ flex: 1, background: LGT, height: 16, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(k.total ? (n / k.total) * 100 : 0, 0.4)}%`, background: etapa === 'Completadas' ? SEA : BLK }} />
                    </span>
                    <span style={{ width: 330, flexShrink: 0 }}>
                        <b>{f0(n)}</b> · {pc(k.total ? n / k.total : 0)} del total
                        {perd[i] != null && <span style={{ color: perd[i] === peor ? RED : '#777', fontWeight: perd[i] === peor ? 700 : 400 }}> · se pierde {pc(perd[i]!)} vs. etapa anterior</span>}
                    </span>
                </div>
            ))}
        </Seccion>
    );
}

// ── por mes (desde mayo 2026, alta de NURA) ──
function PorMes({ r }: { r: BusquedaNura[] }) {
    const meses = useMemo(() => {
        const m = new Map<string, { total: number; completadas: number }>();
        for (const b of r) {
            if (!b.creada || b.creada < '2026-05') continue;
            const e = m.get(b.creada.slice(0, 7)) ?? m.set(b.creada.slice(0, 7), { total: 0, completadas: 0 }).get(b.creada.slice(0, 7))!;
            e.total += 1; if (b.estatus === 'completed') e.completadas += 1;
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [r]);
    const max = Math.max(1, ...meses.map(([, x]) => x.total));
    return (
        <Seccion titulo="Por mes" nota="Búsquedas creadas cada mes desde mayo 2026 (alta de NURA) y, al lado, cuántas de ésas ya se completaron. Las 5 búsquedas anteriores no entran en esta gráfica.">
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#666', marginBottom: 8 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: GRY, marginRight: 5 }} />Creadas</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: SEA, marginRight: 5 }} />Completadas</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height: 200, borderBottom: `1px solid ${GRY}`, padding: '0 4px' }}>
                {meses.map(([mes, x]) => (
                    <div key={mes} title={`${mesFmt(mes)} · creadas ${f0(x.total)} · completadas ${f0(x.completadas)} (${pc(x.total ? x.completadas / x.total : 0)})`}
                        style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 4, height: '100%' }}>
                        {([['total', GRY], ['completadas', SEA]] as const).map(([k, c]) => (
                            <div key={k} style={{ width: '38%', maxWidth: 34, height: `${(x[k] / max) * 100}%`, minHeight: x[k] ? 2 : 0, background: c, position: 'relative' }}>
                                <span style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 10.5, color: '#555', whiteSpace: 'nowrap' }}>{f0(x[k])}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 18, padding: '4px 4px 0' }}>
                {meses.map(([mes]) => <div key={mes} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: '#777' }}>{mesFmt(mes)}</div>)}
            </div>
        </Seccion>
    );
}

// ── motivos de cancelación ──
function Motivos({ r }: { r: BusquedaNura[] }) {
    const can = r.filter((b) => b.estatus === 'cancelled');
    const m = new Map<string, number>();
    for (const b of can) m.set(b.motivo || '', (m.get(b.motivo || '') ?? 0) + 1);
    const filas = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...filas.map(([, n]) => n));
    return (
        <Seccion titulo="Por qué se cancelan" nota={`${f0(can.length)} búsquedas canceladas, por el motivo que registró el asesor. «Nota del asesor» = el motivo real está en texto libre (columna Nota del asesor en el detalle).`}>
            {filas.map(([mot, n]) => (
                <div key={mot} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0', fontSize: 12 }}>
                    <span style={{ width: 190, flexShrink: 0 }}>{MOT_LBL[mot] ?? mot}</span>
                    <span style={{ flex: 1, background: LGT, height: 14, position: 'relative' }}><span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(n / max) * 100}%`, background: BLK }} /></span>
                    <span style={{ width: 120, textAlign: 'right' }}><b>{f0(n)}</b> · {pc(can.length ? n / can.length : 0)}</span>
                </div>
            ))}
        </Seccion>
    );
}

// ── por fuente ──
function PorFuente({ r }: { r: BusquedaNura[] }) {
    const g = new Map<string, BusquedaNura[]>();
    for (const b of r) (g.get(b.fuente) ?? g.set(b.fuente, []).get(b.fuente)!).push(b);
    const filas = [...g.entries()].map(([fuente, v]) => ({ fuente, ...cuenta(v) })).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...filas.map((x) => x.total));
    return (
        <Seccion titulo="Por fuente" nota="Fuente con la que se creó la búsqueda (nombres unificados: «Propiedades.com» y «propiedades.com» son la misma).">
            <Tabla min={520}>
                <thead><tr><th style={th}>Fuente</th><th style={thN}>Búsquedas</th><th style={thN}>Con visita</th><th style={thN}>Completadas</th><th style={thN}>Conversión</th></tr></thead>
                <tbody>{filas.map((x) => (
                    <tr key={x.fuente}>
                        <td style={td}>{x.fuente}</td>
                        <td style={tdN}><span style={{ display: 'inline-block', width: (x.total / max) * 60, height: 8, background: LGT, marginRight: 6, verticalAlign: 'middle' }} />{f0(x.total)}</td>
                        <td style={tdN}>{f0(x.visita)}</td><td style={tdN}>{f0(x.completadas)}</td><td style={tdN}>{pc(x.total ? x.completadas / x.total : 0)}</td>
                    </tr>
                ))}</tbody>
            </Tabla>
        </Seccion>
    );
}

// ── por asesor ──
function PorAsesor({ r }: { r: BusquedaNura[] }) {
    const lim = new Date(Date.parse(hoyMx()) - 14 * 864e5).toISOString().slice(0, 10);
    const g = new Map<string, BusquedaNura[]>();
    for (const b of r) (g.get(b.asesor) ?? g.set(b.asesor, []).get(b.asesor)!).push(b);
    const filas = [...g.entries()].map(([asesor, v]) => ({
        asesor, ...cuenta(v),
        sinSeg: v.filter((b) => ABIERTAS.has(b.estatus ?? '') && (b.ultimoSeguimiento || b.creada || '') <= lim).length,
    })).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...filas.map((x) => x.total));
    return (
        <Seccion titulo="Por asesor" nota="«Sin seguimiento 14+ días» = búsquedas activas cuyo último seguimiento (o su creación, si nunca tuvo) fue hace 14 días o más. En amarillo si hay alguna.">
            <Tabla min={760}>
                <thead><tr><th style={th}>Asesor</th><th style={thN}>Búsquedas</th><th style={thN}>Activas</th><th style={thN}>Con visita</th><th style={thN}>Con oferta</th><th style={thN}>Completadas</th><th style={thN}>Conversión</th><th style={thN}>Sin seguimiento 14+ días</th></tr></thead>
                <tbody>{filas.map((x) => (
                    <tr key={x.asesor}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{x.asesor}</td>
                        <td style={tdN}><span style={{ display: 'inline-block', width: (x.total / max) * 60, height: 8, background: LGT, marginRight: 6, verticalAlign: 'middle' }} />{f0(x.total)}</td>
                        <td style={tdN}>{f0(x.activas)}</td><td style={tdN}>{f0(x.visita)}</td><td style={tdN}>{f0(x.oferta)}</td><td style={tdN}>{f0(x.completadas)}</td>
                        <td style={tdN}>{pc(x.total ? x.completadas / x.total : 0)}</td>
                        <td style={{ ...tdN, ...(x.sinSeg > 0 ? { background: '#FDF3CC', fontWeight: 700 } : {}) }}>{f0(x.sinSeg)}</td>
                    </tr>
                ))}</tbody>
            </Tabla>
        </Seccion>
    );
}

// ── detalle ──
type Col = { k: keyof BusquedaNura; l: string; num?: boolean; fecha?: boolean };
const COLS: Col[] = [
    { k: 'creada', l: 'Creada', fecha: true }, { k: 'creadaPor', l: 'Creada por' }, { k: 'cliente', l: 'Cliente' },
    { k: 'clienteTelefono', l: 'Tel. cliente' }, { k: 'clienteEmail', l: 'Email cliente' }, { k: 'asesor', l: 'Asesor' },
    { k: 'fuente', l: 'Fuente' }, { k: 'operacion', l: 'Operación' }, { k: 'estatus', l: 'Estatus' }, { k: 'motivo', l: 'Motivo de cierre' },
    { k: 'descripcion', l: 'Nota del asesor' }, { k: 'cancelada', l: 'Cancelada', fecha: true }, { k: 'actualizada', l: 'Actualizada', fecha: true },
    { k: 'ultimoSeguimiento', l: 'Último seguimiento', fecha: true }, { k: 'ultimaSugerencia', l: 'Última sugerencia', fecha: true },
    { k: 'valor', l: 'Valor buscado', num: true }, { k: 'propiedades', l: 'Propiedades', num: true }, { k: 'visitas', l: 'Visitas', num: true },
];
const PAG = 100;
function Detalle({ r }: { r: BusquedaNura[] }) {
    const [q, setQ] = useState('');
    const [est, setEst] = useState('');
    const [orden, setOrden] = useState<{ k: keyof BusquedaNura; dir: 1 | -1 }>({ k: 'creada', dir: -1 });
    const [n, setN] = useState(PAG);
    const filas = useMemo(() => {
        const t = q.trim().toLowerCase();
        const xs = r.filter((b) => (!est || (est === 'abiertas' ? ABIERTAS.has(b.estatus ?? '') : b.estatus === est))
            && (!t || [b.cliente, b.asesor, b.clienteTelefono, b.clienteEmail, b.fuente, MOT_LBL[b.motivo], b.descripcion].join(' ').toLowerCase().includes(t)));
        const c = COLS.find((x) => x.k === orden.k);
        return xs.slice().sort((a, b) => orden.dir * (c?.num ? Number(a[orden.k]) - Number(b[orden.k]) : String(a[orden.k] ?? '').localeCompare(String(b[orden.k] ?? ''))));
    }, [r, q, est, orden]);
    useEffect(() => setN(PAG), [q, est, orden, r]);
    const clic = (c: Col) => setOrden((o) => ({ k: c.k, dir: o.k === c.k ? (o.dir === 1 ? -1 : 1) : (c.num || c.fecha ? -1 : 1) }));
    const inp: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };
    const pill = (s: string | null) => {
        const st = s === 'completed' ? { background: '#DCEBEB', color: '#2f6b6b' } : ABIERTAS.has(s ?? '') ? { background: '#FDF3CC', color: '#6b5200' } : { background: '#F3D9D3', color: RED };
        return <span style={{ ...st, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: R, whiteSpace: 'nowrap' }}>{EST_LBL[s ?? ''] ?? s ?? '—'}</span>;
    };
    const celda = (b: BusquedaNura, c: Col): ReactNode => {
        const v = b[c.k];
        if (c.k === 'estatus') return pill(b.estatus);
        if (c.k === 'creadaPor') return CREADA_LBL[String(v)] ?? (v || '—');
        if (c.k === 'operacion') return OP_LBL[String(v)] ?? String(v);
        if (c.k === 'motivo') return b.motivo ? (MOT_LBL[b.motivo] ?? b.motivo) : '';
        if (c.k === 'valor') return money(Number(v));
        if (c.num) return f0(Number(v));
        return (v as string) || (c.k === 'descripcion' ? '' : '—');
    };
    return (
        <Seccion titulo="Detalle">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, teléfono, correo, asesor, fuente, motivo o nota…" style={{ ...inp, minWidth: 340 }} />
                <select value={est} onChange={(e) => setEst(e.target.value)} style={inp}>
                    <option value="">Todos los estatus</option>
                    <option value="abiertas">Solo activas</option>
                    {Object.entries(EST_LBL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <span style={{ fontSize: 12, color: '#666' }}>{f0(filas.length)} búsquedas</span>
            </div>
            <Tabla min={1900}>
                <thead><tr>{COLS.map((c) => (
                    <th key={c.k} style={c.num ? thN : th}>
                        <button type="button" onClick={() => clic(c)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: orden.k === c.k ? BLK : 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}>
                            {c.l}{orden.k === c.k ? (orden.dir === 1 ? ' ↑' : ' ↓') : ''}
                        </button>
                    </th>
                ))}</tr></thead>
                <tbody>{filas.slice(0, n).map((b) => (
                    <tr key={b.id}>{COLS.map((c) => (
                        <td key={c.k} style={c.num ? tdN : { ...td, ...(c.k === 'descripcion' ? { minWidth: 220, maxWidth: 360, whiteSpace: 'normal' } : { whiteSpace: 'nowrap' }) }}>{celda(b, c)}</td>
                    ))}</tr>
                ))}</tbody>
            </Tabla>
            {filas.length > n && (
                <button type="button" onClick={() => setN((x) => x + PAG)} style={{ marginTop: 10, fontSize: 12, padding: '6px 14px', border: `1px solid ${BLK}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Ver {f0(Math.min(PAG, filas.length - n))} más (se muestran {f0(n)} de {f0(filas.length)})
                </button>
            )}
        </Seccion>
    );
}
