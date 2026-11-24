'use client';
// /portales → Asignación (fase 3, nov-2026). La hoja de Ale «para jugar en vivo»: escribe el número de avisos de
// cada inmobiliaria, ve al lado lo que le toca por regla y cuánto gasta contra su tope, y arriba lo que queda del
// plan contratado. El borrador se guarda compartido (Blob) para que las KAMs lo vean.
//
// Mismas columnas que tools.pulppo.com → Asignación de avisos (ZD SD · SD · ZD D · D · Simple · Oro Premium · Oro ·
// Plata) y, como allá, «disponible» en verde cuando es cero y en rojo con cualquier otro número.
// Datos: /api/portales/asignacion (lib/portales/asignacion.ts). Reglas: lib/portales/asignacionReglas.ts.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AsignacionView, Cuenta, FilaAsig, Nivel } from '@/lib/portales/asignacion';
import type { Borrador } from '@/lib/portales/asignacionStore';
import {
    REGLAS_DEFAULT, costoElevados, esDiamond, preciosDe, sugerida, topeDe, costoMeli, type Reglas, type Sugerida,
} from '@/lib/portales/asignacionReglas';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
const money = (n?: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
const pct = (x?: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

const NIVELES: Nivel[] = ['sdzd', 'sd', 'dzd', 'd', 'simple', 'op', 'oro', 'plata'];
const ETQ: Record<Nivel, string> = { sdzd: 'ZD Súper dest.', sd: 'Súper dest.', dzd: 'ZD Dest.', d: 'Destacado', simple: 'Simple', op: 'Oro Premium', oro: 'Oro', plata: 'Plata' };
const ETQ_TOOL: Record<Nivel, string> = { sdzd: 'ZD Super Destacado', sd: 'Super Destacado', dzd: 'ZD Destacado', d: 'Destacado', simple: 'Simple', op: 'Oro Premium', oro: 'Oro', plata: 'Plata' };
/** Los 130 súper destacados de la cuenta Premier de Diamond House: costo fijo aparte, no salen de la bolsa. */
const PREMIER_SD = 130;
const LOCAL = 'portales-asignacion-borrador';

type Datos = AsignacionView & { borrador: Borrador; soloLectura: boolean };
type Valores = Record<string, Partial<Cuenta>>;

export default function Asignacion() {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState('');
    const [valores, setValores] = useState<Valores>({});
    const [notas, setNotas] = useState<Record<string, string>>({});
    const [reglas, setReglas] = useState<Reglas>(REGLAS_DEFAULT);
    const [sucio, setSucio] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [msg, setMsg] = useState('');
    const [kam, setKam] = useState('');
    const [modelo, setModelo] = useState('');
    const [q, setQ] = useState('');
    const [soloCambios, setSoloCambios] = useState(false);
    const [orden, setOrden] = useState<'canon' | 'tool'>('canon');

    const cargar = (fresco = false) => {
        setError('');
        fetch(`/api/portales/asignacion${fresco ? '?refresh=1' : ''}`).then((r) => r.json()).then((d) => {
            if (d.error) { setError(d.error); return; }
            setDatos(d);
            // lo no guardado de este navegador gana sobre el borrador compartido (si es más nuevo)
            let local: { valores: Valores; notas: Record<string, string>; reglas: Reglas; base: string } | null = null;
            try { local = JSON.parse(localStorage.getItem(LOCAL) ?? 'null'); } catch { /* sin storage */ }
            if (local && local.base === (d.borrador.fecha || '')) {
                setValores(local.valores); setNotas(local.notas); setReglas(local.reglas ?? REGLAS_DEFAULT); setSucio(true);
            } else {
                setValores(d.borrador.valores ?? {}); setNotas(d.borrador.notas ?? {}); setReglas(d.borrador.reglas ?? REGLAS_DEFAULT); setSucio(false);
            }
        }).catch((e) => setError(String(e)));
    };
    useEffect(() => { cargar(); }, []);
    useEffect(() => {
        if (!datos || !sucio) return;
        try { localStorage.setItem(LOCAL, JSON.stringify({ valores, notas, reglas, base: datos.borrador.fecha || '' })); } catch { /* sin storage */ }
    }, [valores, notas, reglas, sucio, datos]);

    const precios = useMemo(() => preciosDe(datos?.plan.precios), [datos]);
    const final = (f: FilaAsig): Cuenta => ({ ...f.hoy, ...(valores[f.nombre] ?? {}) });

    // MeLi a costo literal del paquete, sin IVA (la Calculadora es sin IVA): $1 por publicación + $42.17 por Oro Premium
    const calc = useMemo(() => {
        if (!datos) return null;
        const fin = new Map(datos.filas.map((f) => [f.nombre, { ...f.hoy, ...(valores[f.nombre] ?? {}) } as Cuenta]));
        const filas = datos.filas.map((f) => {
            const c = fin.get(f.nombre)!;
            const premier = esDiamond(f) ? Math.min(PREMIER_SD, c.sd) : 0;
            const elev = costoElevados({ ...c, sd: c.sd - premier }, precios);
            const meli = costoMeli(c, datos.meli);
            const fijos = c.simple * precios.simple + meli;
            const sug = sugerida(f, reglas, precios, fijos);
            const gasto = elev + fijos + (premier ? (datos.plan.premier ?? 0) : 0);
            const tope = topeDe(f, reglas);
            const presupuesto = tope != null && f.regaliaMes != null ? tope * f.regaliaMes : null;
            const cambios = NIVELES.filter((k) => c[k] !== f.hoy[k]).length;
            const fueraRegla = !esDiamond(f) && (['sdzd', 'sd', 'dzd', 'd'] as const).some((k) => c[k] !== sug.cuenta[k]);
            return { f, c, sug, gasto, elev, meli, presupuesto, cambios, fueraRegla, premier };
        });
        const tot = (sel: (c: Cuenta) => number, base: 'c' | 'hoy' | 'linea') =>
            filas.reduce((a, x) => a + sel(base === 'c' ? x.c : base === 'hoy' ? x.f.hoy : x.f.enLinea), 0);
        const bolsaUsada = filas.reduce((a, x) => a + x.elev, 0);
        const bolsaHoy = datos.filas.reduce((a, f) => a + costoElevados({ ...f.hoy, sd: f.hoy.sd - (esDiamond(f) ? Math.min(PREMIER_SD, f.hoy.sd) : 0) }, precios), 0);
        return { filas, tot, bolsaUsada, bolsaHoy };
    }, [datos, valores, reglas, precios]);

    if (error) return <Aviso>No se pudo cargar la asignación: {error}</Aviso>;
    if (!datos || !calc) return <Aviso>Juntando el cupo de la herramienta, el inventario y tu Sheet de asignación…</Aviso>;

    const setVal = (inmo: string, k: Nivel, v: number) => {
        const f = datos.filas.find((x) => x.nombre === inmo)!;
        setValores((prev) => {
            const nv = { ...(prev[inmo] ?? {}) };
            if (v === f.hoy[k]) delete nv[k]; else nv[k] = v;
            const out = { ...prev, [inmo]: nv };
            if (!Object.keys(nv).length) delete out[inmo];
            return out;
        });
        setSucio(true);
    };
    const aplicarRegla = (inmos: string[]) => {
        setValores((prev) => {
            const out = { ...prev };
            for (const x of calc.filas) {
                if (!inmos.includes(x.f.nombre)) continue;
                const nv = { ...(out[x.f.nombre] ?? {}) };
                for (const k of ['sdzd', 'sd', 'dzd', 'd'] as const) { if (x.sug.cuenta[k] === x.f.hoy[k]) delete nv[k]; else nv[k] = x.sug.cuenta[k]; }
                if (Object.keys(nv).length) out[x.f.nombre] = nv; else delete out[x.f.nombre];
            }
            return out;
        });
        setSucio(true);
    };
    const guardar = async () => {
        setGuardando(true); setMsg('');
        try {
            const r = await fetch('/api/portales/asignacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valores, notas, reglas }) });
            const d = await r.json();
            if (d.error) { setMsg(d.error); return; }
            setDatos({ ...datos, borrador: d.borrador });
            setSucio(false);
            try { localStorage.removeItem(LOCAL); } catch { /* sin storage */ }
            setMsg('Guardado. Las KAMs ya lo ven.');
        } finally { setGuardando(false); }
    };
    const descartar = () => {
        setValores(datos.borrador.valores ?? {}); setNotas(datos.borrador.notas ?? {}); setReglas(datos.borrador.reglas ?? REGLAS_DEFAULT); setSucio(false);
        try { localStorage.removeItem(LOCAL); } catch { /* sin storage */ }
    };

    const kams = [...new Set(datos.filas.map((f) => f.kam).filter(Boolean))] as string[];
    const modelos = [...new Set(datos.filas.map((f) => f.modelo ?? 'Sin modelo'))];
    const ql = q.trim().toLowerCase();
    let vis = calc.filas.filter((x) => (!kam || x.f.kam === kam) && (!modelo || (x.f.modelo ?? 'Sin modelo') === modelo)
        && (!ql || x.f.nombre.toLowerCase().includes(ql)) && (!soloCambios || x.cambios > 0));
    if (orden === 'tool') vis = [...vis].sort((a, b) => (a.f.nombre < b.f.nombre ? -1 : a.f.nombre > b.f.nombre ? 1 : 0)); // ASCII, como la herramienta

    const csv = () => {
        const enc = ['Inmobiliaria', 'KAM', 'Modelo', ...NIVELES.map((k) => ETQ_TOOL[k]), ...NIVELES.map((k) => `Hoy ${ETQ_TOOL[k]}`), 'Nota'];
        const filas = [...calc.filas].sort((a, b) => (a.f.nombre < b.f.nombre ? -1 : 1)).map((x) =>
            [x.f.nombre, x.f.kam ?? '', x.f.modelo ?? '', ...NIVELES.map((k) => x.c[k]), ...NIVELES.map((k) => x.f.hoy[k]), notas[x.f.nombre] ?? '']);
        const txt = [enc, ...filas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
        a.download = `asignacion-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    };

    const T = calc.tot;
    const plan = datos.plan;
    const bolsa = plan.bolsaI24 ?? 0;
    const cambiosTot = calc.filas.reduce((a, x) => a + x.cambios, 0);
    const b = datos.borrador;

    return (
        <div>
            <style>{`
                .as-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
                .as-reglas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
                .as-tabla input{width:52px;padding:4px 5px;border:1px solid ${LGT};border-radius:${R}px;font:inherit;font-size:12px;text-align:right;font-variant-numeric:tabular-nums;background:#fff}
                .as-tabla input:focus{outline:2px solid ${YEL};outline-offset:-1px}
                @media (max-width:900px){.as-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.as-reglas{grid-template-columns:1fr}}
            `}</style>

            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1.1 }}>Asignación de avisos</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.5 }}>
                Escribe el número de avisos de cada inmobiliaria. Al lado sale lo que le toca por regla y su gasto contra su tope; arriba, lo que queda del plan contratado.
                Cupo de hoy = lo cargado en la herramienta de asignación (Mongo). Modelo y regalía = pestaña «Asignación» de tu Sheet.
                {!datos.hoja.ok && <span style={{ color: RED }}> No pude leer el Sheet ({datos.hoja.nota}): sin modelo ni regalía no hay regla ni tope.</span>}
            </div>

            {/* ── barra de acciones ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '14px 0 4px' }}>
                <Btn primario onClick={guardar} disabled={!sucio || guardando || datos.soloLectura}>{guardando ? 'Guardando…' : 'Guardar para el equipo'}</Btn>
                <Btn onClick={descartar} disabled={!sucio}>Descartar cambios</Btn>
                <Btn onClick={() => aplicarRegla(vis.map((x) => x.f.nombre))}>Aplicar la regla a las {vis.length} visibles</Btn>
                <Btn onClick={csv}>Descargar CSV (orden de la herramienta)</Btn>
                <span style={{ fontSize: 11, color: '#777' }}>
                    {sucio ? <b style={{ color: '#8A6D00' }}>Cambios sin guardar ({cambiosTot} celdas)</b>
                        : b.fecha ? <>Guardado por {b.por.split('@')[0]} el {new Date(b.fecha).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</> : 'Sin borrador guardado: todo está como en la herramienta hoy'}
                    {msg && <> · {msg}</>}
                </span>
            </div>
            {datos.soloLectura && <div style={{ fontSize: 11.5, color: RED, marginBottom: 6 }}>Falta configurar Vercel Blob: puedes jugar y descargar el CSV, pero el borrador no se puede compartir todavía (se queda en este navegador).</div>}

            {/* ── plan contratado ── */}
            <H2 sub="Lo que dice la asignación nueva contra lo que pagamos. Verde = se usa exacto; rojo = sobra o nos pasamos, como en la herramienta.">Contra el plan contratado</H2>
            <div className="as-grid">
                <Medidor titulo="i24 · bolsa de elevados" usado={calc.bolsaUsada} total={bolsa} fmt={money}
                    nota={<>Súper destacados y destacados × precio de lista, sin el Premier ({money(plan.premier)} fijo). Hoy: {money(calc.bolsaHoy)}.</>} />
                <Medidor titulo="i24 · simples" usado={T((c) => c.simple, 'c')} total={plan.simplesI24 ?? 0} fmt={f0}
                    nota={<>Cupo en la herramienta. En línea hoy: {f0(T((c) => c.simple, 'linea'))}.</>} />
                <Medidor titulo="MeLi · Oro Premium" usado={T((c) => c.op, 'c')} total={datos.meli.oroPremium} fmt={f0}
                    nota={<>Paquete: {f0(datos.meli.oroPremium)} incluidos. En línea hoy: {f0(T((c) => c.op, 'linea'))}.</>} />
                <Medidor titulo="MeLi · publicaciones" usado={T((c) => c.op + c.oro + c.plata, 'c')} total={datos.meli.publicaciones} fmt={f0}
                    nota={<>Oro Premium + Oro + Plata. En línea hoy: {f0(T((c) => c.op + c.oro + c.plata, 'linea'))}.</>} />
            </div>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 640 }}>
                    <thead><tr><th style={th0} />{NIVELES.map((k) => <th key={k} style={th}>{ETQ[k]}</th>)}</tr></thead>
                    <tbody>
                        <tr><td style={td0}>En línea hoy</td>{NIVELES.map((k) => <td key={k} style={td}>{f0(T((c) => c[k], 'linea'))}</td>)}</tr>
                        <tr><td style={td0}>Cargado hoy en la herramienta</td>{NIVELES.map((k) => <td key={k} style={td}>{f0(T((c) => c[k], 'hoy'))}</td>)}</tr>
                        <tr style={{ fontWeight: 800 }}><td style={td0}>Asignación nueva</td>{NIVELES.map((k) => {
                            const n = T((c) => c[k], 'c'), h = T((c) => c[k], 'hoy');
                            return <td key={k} style={td}>{f0(n)}{n !== h && <div style={{ fontSize: 10, fontWeight: 600, color: n > h ? SEA : RED }}>{n > h ? '+' : ''}{f0(n - h)}</div>}</td>;
                        })}</tr>
                    </tbody>
                </table>
            </div>

            {/* ── reglas ── */}
            <H2 sub="Muévelas y todo se recalcula. Se guardan con el borrador.">Reglas</H2>
            <div className="as-reglas">
                {(['Equipos Premium', 'Equipos'] as const).map((m) => (
                    <div key={m} style={caja}>
                        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{m}</div>
                        {([['sd', '% de la venta en súper destacado'], ['d', '% de la venta en destacado'], ['tope', 'Tope de reinversión (de su regalía)']] as const).map(([k, t]) => (
                            <label key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6, gap: 8 }}>
                                <span>{t}</span>
                                <span><input type="number" min={0} max={100} value={Math.round(reglas.modelos[m][k] * 100)} style={inpRegla}
                                    onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0) / 100; setReglas((r) => ({ ...r, modelos: { ...r.modelos, [m]: { ...r.modelos[m], [k]: v } } })); setSucio(true); }} /> %</span>
                            </label>
                        ))}
                    </div>
                ))}
                <div style={caja}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Excepciones</div>
                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6, gap: 8 }}>
                        <span>Diamond House: súper destacados fijos</span>
                        <input type="number" min={0} value={reglas.diamondSD} style={inpRegla} onChange={(e) => { setReglas((r) => ({ ...r, diamondSD: Math.max(0, Number(e.target.value) || 0) })); setSucio(true); }} />
                    </label>
                    <label style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                        <input type="checkbox" checked={reglas.premium15ComoEquipos} onChange={(e) => { setReglas((r) => ({ ...r, premium15ComoEquipos: e.target.checked })); setSucio(true); }} />
                        <span>Premium que paga 15% se reinvierte con el tope de Equipos</span>
                    </label>
                    <div style={{ fontSize: 10.5, color: '#888', marginTop: 8, lineHeight: 1.4 }}>
                        Red y SaaS: sólo simples. SD y D fijos del Sheet mandan sobre la regla. ZD = la parte de su venta en Miguel Hidalgo, Álvaro Obregón, Cuajimalpa y Magdalena Contreras.
                    </div>
                </div>
            </div>

            {/* ── la hoja ── */}
            <H2 sub={<>Amarillo = cambiaste el número (abajo, en gris, lo de hoy). Rojo en la barra = el gasto se pasa de su tope. «Regla» es lo que le toca con las reglas de arriba; el botón ↺ la aplica a esa fila. Gasto al mes sin IVA: i24 a precio de lista + MeLi a costo literal del paquete ($1 por publicación y $42.17 más por Oro Premium, con IVA; aquí sin IVA).</>}>
                Por inmobiliaria
            </H2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input placeholder="Buscar inmobiliaria" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, width: 190 }} />
                <select value={kam} onChange={(e) => setKam(e.target.value)} style={sel}><option value="">Todas las KAMs</option>{kams.map((k) => <option key={k}>{k}</option>)}</select>
                <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={sel}><option value="">Todos los modelos</option>{modelos.map((k) => <option key={k}>{k}</option>)}</select>
                <select value={orden} onChange={(e) => setOrden(e.target.value as 'canon' | 'tool')} style={sel}><option value="canon">Orden de tu lista</option><option value="tool">Orden de la herramienta (A–Z)</option></select>
                <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={soloCambios} onChange={(e) => setSoloCambios(e.target.checked)} /> Sólo con cambios</label>
            </div>
            <div className="as-tabla" style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ ...th0, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>Inmobiliaria</th>
                            <th style={th}>Venta<div style={sub}>(ZD)</div></th>
                            <th style={th0}>Regla</th>
                            {NIVELES.map((k) => <th key={k} style={{ ...th, borderLeft: k === 'op' ? `2px solid ${LGT}` : undefined }}>{ETQ[k]}</th>)}
                            <th style={{ ...th0, minWidth: 150 }}>Gasto vs tope</th>
                            <th style={th0}>Nota</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vis.map((x) => <FilaUI key={x.f.nombre} x={x} nota={notas[x.f.nombre] ?? ''} setNota={(t) => { setNotas((n) => ({ ...n, [x.f.nombre]: t })); setSucio(true); }}
                            setVal={setVal} aplicar={() => aplicarRegla([x.f.nombre])} />)}
                    </tbody>
                </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 10.5, color: '#888', marginTop: 8 }}>
                <span>Datos de {new Date(datos.generado).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (caché 30 min) · <a onClick={() => cargar(true)} style={{ color: BLK, cursor: 'pointer', textDecoration: 'underline' }}>recalcular</a></span>
                {b.historial.length > 0 && <span>Últimos guardados: {b.historial.slice(0, 5).map((h) => `${h.por.split('@')[0]} (${new Date(h.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${h.cambios})`).join(' · ')}</span>}
            </div>
        </div>
    );
}

type Calc = { f: FilaAsig; c: Cuenta; sug: Sugerida; gasto: number; presupuesto: number | null; cambios: number; fueraRegla: boolean; premier: number };
function FilaUI({ x, nota, setNota, setVal, aplicar }: { x: Calc; nota: string; setNota: (t: string) => void; setVal: (inmo: string, k: Nivel, v: number) => void; aplicar: () => void }) {
    const { f, c, sug } = x;
    const s = sug.cuenta;
    const pasa = x.presupuesto != null && x.gasto > x.presupuesto;
    const chip = (t: string, bg: string, color = BLK) => <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: R, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>;
    const colorModelo: Record<string, string> = { 'Equipos Premium': YEL, Equipos: '#FCE9A6', SaaS: LGT, Fuera: '#F5D9D2' };
    return (
        <tr style={{ background: x.cambios ? '#FFFCF2' : undefined }}>
            <td style={{ ...td0, position: 'sticky', left: 0, background: x.cambios ? '#FFFCF2' : '#fff', zIndex: 1, maxWidth: 200, whiteSpace: 'normal' }}>
                <div style={{ fontWeight: 700, lineHeight: 1.25 }}>{f.nombre}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                    {chip(f.modelo ?? 'Sin modelo', colorModelo[f.modelo ?? ''] ?? LGT, f.modelo === 'Fuera' ? RED : BLK)}
                    {f.kam && <span style={{ fontSize: 10, color: '#888' }}>{f.kam}</span>}
                    {f.pctRegalia != null && <span style={{ fontSize: 10, color: '#888' }}>· {pct(f.pctRegalia)}</span>}
                </div>
            </td>
            <td style={td}>{f0(f.invVenta)}<div style={sub}>({f0(f.invZdVenta)})</div></td>
            <td style={{ ...td0, fontSize: 11, maxWidth: 170, whiteSpace: 'normal' }} title={sug.motivo}>
                {s.sdzd + s.sd + s.dzd + s.d > 0
                    ? <><b>SD {s.sdzd + s.sd}</b> · D {s.dzd + s.d}{sug.cabe < 1 && <span style={{ color: '#8A6D00' }}> · cabe {pct(sug.cabe)}</span>}</>
                    : <span style={{ color: '#888' }}>Sólo simples</span>}
                {x.fueraRegla && !esDiamond(f) && <button onClick={aplicar} title="Poner lo que dice la regla" style={{ marginLeft: 5, border: `1px solid ${LGT}`, background: '#fff', borderRadius: R, cursor: 'pointer', fontSize: 11, padding: '0 5px' }}>↺</button>}
            </td>
            {NIVELES.map((k) => {
                const cambio = c[k] !== f.hoy[k];
                return (
                    <td key={k} style={{ ...td, borderLeft: k === 'op' ? `2px solid ${LGT}` : undefined }}>
                        <input type="number" min={0} value={c[k]} aria-label={`${f.nombre} ${ETQ[k]}`}
                            style={cambio ? { background: '#FFF3C4', borderColor: YEL, fontWeight: 700 } : undefined}
                            onChange={(e) => setVal(f.nombre, k, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                        <div style={sub} title={`En línea hoy: ${f.enLinea[k]}`}>{cambio ? `hoy ${f.hoy[k]}` : `${f.enLinea[k]} en línea`}</div>
                    </td>
                );
            })}
            <td style={{ ...td0, minWidth: 150 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <b style={{ color: pasa ? RED : BLK }}>{money(x.gasto)}</b>
                    <span style={{ color: '#888' }}>{x.presupuesto != null ? `de ${money(x.presupuesto)}` : f.modelo?.startsWith('Diamond') ? 'aparte' : 'sin tope'}</span>
                </div>
                {x.presupuesto != null && x.presupuesto > 0 && (
                    <div style={{ height: 6, background: LGT, borderRadius: R, marginTop: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (100 * x.gasto) / x.presupuesto)}%`, height: '100%', background: pasa ? RED : SEA }} />
                    </div>
                )}
                {x.premier > 0 && <div style={sub}>incluye Premier ({x.premier} SD)</div>}
            </td>
            <td style={{ ...td0, minWidth: 140 }}>
                <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={f.nota || 'Nota para la KAM'} style={{ width: 150, textAlign: 'left' }} />
            </td>
        </tr>
    );
}

function Medidor({ titulo, usado, total, fmt, nota }: { titulo: string; usado: number; total: number; fmt: (n: number) => string; nota: ReactNode }) {
    const disp = total - usado;
    const exacto = Math.abs(disp) < (fmt === money ? 600 : 1);   // en pesos, menos de un súper destacado ya es «exacto»
    return (
        <div style={{ ...caja, borderTop: `3px solid ${exacto ? SEA : RED}` }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{titulo}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '6px 0 4px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{fmt(usado)}</span>
                <span style={{ fontSize: 11.5, color: '#666' }}>de {fmt(total)}</span>
            </div>
            <div style={{ height: 8, background: LGT, borderRadius: R, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, total ? (100 * usado) / total : 0)}%`, height: '100%', background: exacto ? SEA : usado > total ? RED : BLK }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, marginTop: 6, color: exacto ? SEA : RED }}>
                {exacto ? 'Disponible: 0' : disp > 0 ? `Disponible: ${fmt(disp)}` : `Nos pasamos: ${fmt(-disp)}`}
            </div>
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 3, lineHeight: 1.35 }}>{nota}</div>
        </div>
    );
}

function H2({ children, sub: s }: { children: ReactNode; sub?: ReactNode }) {
    return (
        <div style={{ margin: '24px 0 10px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px' }}>{children}</div>
            {s && <div style={{ fontSize: 11.5, color: '#777', marginTop: 3, lineHeight: 1.45 }}>{s}</div>}
        </div>
    );
}
function Btn({ children, onClick, disabled, primario }: { children: ReactNode; onClick: () => void; disabled?: boolean; primario?: boolean }) {
    return (
        <button onClick={onClick} disabled={disabled} style={{
            padding: '7px 12px', borderRadius: R, border: `1px solid ${BLK}`, fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
            background: primario ? BLK : '#fff', color: primario ? '#fff' : BLK,
        }}>{children}</button>
    );
}
function Aviso({ children }: { children: ReactNode }) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>{children}</div>;
}

const caja: CSSProperties = { border: `1px solid ${LGT}`, borderRadius: R, padding: '12px 14px', minWidth: 0, background: '#fff' };
const th: CSSProperties = { textAlign: 'right', padding: '7px 6px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.4px', color: '#666', whiteSpace: 'nowrap', verticalAlign: 'bottom' };
const th0: CSSProperties = { ...th, textAlign: 'left' };
const td: CSSProperties = { padding: '6px 6px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' };
const td0: CSSProperties = { ...td, textAlign: 'left' };
const sub: CSSProperties = { fontSize: 9.5, color: '#999', fontWeight: 400, marginTop: 2 };
const sel: CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontFamily: 'inherit', fontSize: 12, background: '#fff' };
const inpRegla: CSSProperties = { width: 56, padding: '4px 6px', border: `1px solid ${LGT}`, borderRadius: R, fontFamily: 'inherit', fontSize: 12, textAlign: 'right' };
