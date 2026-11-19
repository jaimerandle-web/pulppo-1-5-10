'use client';

/**
 * «Tu 2026»: el cierre de año de la inmobiliaria (Master Experience, 3-dic-2026). Ver `lib/tu2026.ts`.
 *
 *   · Tu año — para el dueño: sus números contra 2025/2024 (mismo corte) y contra sus pares, con
 *     «Logros del año» y «Lo que faltó para romperla».
 *   · Reconocimientos — para sus asesores: 8 premios dentro de la inmobiliaria, cada uno con su carta
 *     (PDF tamaño carta, firman el dueño y Pulppo) y sus piezas para redes (post 4:5 e historia 9:16).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Ganador, Metrica, Premio, Reconocimientos, TuAnio } from '@/lib/tu2026';
import { ensureFonts, loadImg } from '@/app/plus/rankingRender';

const BLK = '#212322', YEL = '#F6BE00', LINE = '#D0D3D4', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const MUTED = 'rgba(33,35,34,.6)';
const serif = 'EB Garamond, serif';

const fmt = (v: number | null, f: Metrica['fmt']) => {
    if (v == null) return '—';
    if (f === 'money') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} MDP` : `$${Math.round(v).toLocaleString('es-MX')}`;
    if (f === 'pct') { const p = v * 100; return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`; }
    if (f === 'min') return v >= 90 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
    return Math.round(v).toLocaleString('es-MX');
};

function useApi<T>(url: string) {
    const [d, setD] = useState<T | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        setD(null); setErr('');
        fetch(url).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (vivo) (ok ? setD(j) : setErr(j.error || 'No se pudo calcular')); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [url]);
    return { d, err };
}

const Cargando = ({ err }: { err: string }) => (
    <div style={{ padding: '28px 0', color: err ? RED : MUTED, fontSize: 14 }}>
        {err || 'Calculando el año de toda la red (la primera vez tarda ~30 segundos)…'}
    </div>
);

export default function MBTu2026({ companyId, abierta }: { companyId: string; abierta: boolean }) {
    const [vista, setVista] = useState<'anio' | 'rec'>('anio');
    const tab = (k: 'anio' | 'rec', l: string) => (
        <button onClick={() => setVista(k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${vista === k ? BLK : LINE}`, background: vista === k ? BLK : '#fff', color: vista === k ? '#fff' : BLK, borderRadius: 2,
        }}>{l}</button>
    );
    return (
        <div>
            {!abierta && (
                <div style={{ fontSize: 12, color: MUTED, background: LGT, padding: '8px 12px', marginBottom: 14, borderLeft: `3px solid ${YEL}` }}>
                    Oculta para la inmobiliaria: hasta la Master Experience del 3 de diciembre sólo la ve el equipo Pulppo.
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
                {tab('anio', 'Tu año')}{tab('rec', 'Reconocimientos')}
            </div>
            <div style={{ display: vista === 'anio' ? 'block' : 'none' }}><TuAnioView companyId={companyId} /></div>
            {vista === 'rec' && <RecView companyId={companyId} />}
        </div>
    );
}

// ── TU AÑO ────────────────────────────────────────────────────────────────────
function TuAnioView({ companyId }: { companyId: string }) {
    const { d, err } = useApi<TuAnio>(`/api/mb-tu2026?company=${companyId}&vista=anio`);
    if (!d) return <Cargando err={err} />;
    const grupos = [...new Set(d.metricas.map((m) => m.grupo))];
    const [a0, a1, a2] = d.años;
    const th: CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: MUTED, borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap' };
    const td: CSSProperties = { textAlign: 'right', padding: '9px 10px', fontSize: 14, borderBottom: `0.5px solid ${LINE}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    return (
        <div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 18, maxWidth: 760 }}>
                Mismo periodo en los tres años: <b style={{ color: BLK }}>{d.corte}</b>. Tus pares son las {d.pares.n} inmobiliarias de la red
                con un inventario parecido al tuyo ({d.pares.desde.toLocaleString('es-MX')}–{d.pares.hasta.toLocaleString('es-MX')} propiedades publicadas; tú tienes {d.pares.publicadas.toLocaleString('es-MX')}).
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 32 }}>
                <Hallazgos titulo="Logros del año" color={SEA} items={d.logros} vacio="Ninguna métrica creció 10% o más ni quedó arriba de tus pares." />
                <Hallazgos titulo="Lo que faltó para romperla" color={RED} items={d.falto} vacio="Nada quedó por debajo de 2025 ni de tus pares." />
            </div>

            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
                    <thead>
                        <tr>
                            <th style={{ ...th, textAlign: 'left' }}>Métrica</th>
                            <th style={{ ...th, color: BLK }}>{a2}</th><th style={th}>vs {a1}</th>
                            <th style={th}>{a1}</th><th style={th}>{a0}</th><th style={th}>Tus pares</th><th style={{ ...th, textAlign: 'left' }}>Dónde quedas</th>
                        </tr>
                    </thead>
                    {grupos.map((g) => (
                        <tbody key={g}>
                            <tr><td colSpan={7} style={{ padding: '18px 10px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{g}</td></tr>
                            {d.metricas.filter((m) => m.grupo === g).map((m) => {
                                const v = m.valores[a2], ant = m.valores[a1];
                                const ch = v != null && ant != null && ant > 0 ? (v - ant) / ant : null;
                                const bueno = ch == null || m.dir === 0 ? null : ch * m.dir >= 0.1 ? true : ch * m.dir <= -0.1 ? false : null;
                                return (
                                    <tr key={m.key}>
                                        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }} title={m.ayuda}>
                                            {m.label} <span style={{ color: MUTED, fontSize: 11, cursor: 'help' }}>ⓘ</span>
                                        </td>
                                        <td style={{ ...td, fontWeight: 700 }}>{fmt(v, m.fmt)}</td>
                                        <td style={{ ...td, fontWeight: 600, color: bueno === true ? SEA : bueno === false ? RED : MUTED }}>
                                            {ch == null ? '—' : Math.round(Math.abs(ch) * 100) === 0 ? '=' : `${ch >= 0 ? '+' : '−'}${Math.round(Math.abs(ch) * 100)}%`}
                                        </td>
                                        <td style={{ ...td, color: MUTED }}>{fmt(ant, m.fmt)}</td>
                                        <td style={{ ...td, color: MUTED }}>{fmt(m.valores[a0], m.fmt)}</td>
                                        <td style={{ ...td, color: MUTED }}>{fmt(m.pares, m.fmt)}</td>
                                        <td style={{ ...td, textAlign: 'left', minWidth: 150 }}>{m.dir === 0 ? <span style={{ color: MUTED, fontSize: 12 }}>descriptiva</span> : <Posicion p={m.pctl} />}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    ))}
                </table>
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
                «Tus pares» = mediana de las inmobiliarias de tu tamaño en {a2}. «Dónde quedas» = a cuántas de ellas superas
                (ya contando que en el tiempo de respuesta menos es mejor).
            </div>
        </div>
    );
}

function Hallazgos({ titulo, color, items, vacio }: { titulo: string; color: string; items: TuAnio['logros']; vacio: string }) {
    return (
        <div style={{ background: LGT, padding: '18px 20px', borderLeft: `3px solid ${color}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>{titulo}</div>
            {items.length ? items.map((h, i) => (
                <div key={h.metrica} style={{ display: 'flex', gap: 12, marginTop: i ? 14 : 0 }}>
                    <div style={{ fontFamily: serif, fontSize: 28, lineHeight: 1, color: MUTED, minWidth: 18 }}>{i + 1}</div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{h.titulo}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 2 }}>{h.texto}</div>
                    </div>
                </div>
            )) : <div style={{ fontSize: 13, color: MUTED }}>{vacio}</div>}
        </div>
    );
}

function Posicion({ p }: { p: number | null }) {
    if (p == null) return <span style={{ color: MUTED, fontSize: 12 }}>sin dato suficiente</span>;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', width: 80, height: 4, background: LINE }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, background: p >= 60 ? BLK : 'rgba(33,35,34,.35)' }} />
            </div>
            <span style={{ fontSize: 12, color: MUTED }}>{p}%</span>
        </div>
    );
}

// ── RECONOCIMIENTOS ───────────────────────────────────────────────────────────
interface Firmas { dueno: string; duenoCargo: string; pulppo: string; pulppoCargo: string; lugarFecha: string; cierre: string }
const FIRMAS0: Firmas = {
    dueno: '', duenoCargo: 'Director(a)', pulppo: '', pulppoCargo: 'Pulppo',
    lugarFecha: 'Ciudad de México, 3 de diciembre de 2026', cierre: 'Gracias por tu trabajo y tu compromiso durante 2026.',
};

function RecView({ companyId }: { companyId: string }) {
    const { d, err } = useApi<Reconocimientos>(`/api/mb-tu2026?company=${companyId}&vista=reconocimientos`);
    const clave = `tu2026-firmas-${companyId}`;
    const [f, setF] = useState<Firmas>(FIRMAS0);
    useEffect(() => {
        try { const s = localStorage.getItem(clave); if (s) setF({ ...FIRMAS0, ...JSON.parse(s) }); } catch { /* sin storage */ }
    }, [clave]);
    const set = (k: keyof Firmas, v: string) => setF((x) => {
        const n = { ...x, [k]: v };
        try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* sin storage */ }
        return n;
    });
    if (!d) return <Cargando err={err} />;
    const con = d.premios.filter((p) => p.podio.length), sin = d.premios.filter((p) => !p.podio.length);
    const inp: CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 2, fontFamily: 'inherit', boxSizing: 'border-box' };
    const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4, display: 'block' };
    return (
        <div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 18, maxWidth: 760 }}>
                Los campeones de {d.inmobiliaria} del {d.corte} de {d.año}, con las mismas reglas que los premios de la gala
                (que compiten contra toda la red). Cada ganador trae su carta de reconocimiento para imprimir y sus piezas para redes.
            </div>

            <details style={{ background: LGT, padding: '14px 18px', marginBottom: 24 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Firmas y texto de la carta</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
                    <label><span style={lbl}>Firma de la inmobiliaria</span><input style={inp} value={f.dueno} placeholder="Nombre del dueño" onChange={(e) => set('dueno', e.target.value)} /></label>
                    <label><span style={lbl}>Cargo</span><input style={inp} value={f.duenoCargo} onChange={(e) => set('duenoCargo', e.target.value)} /></label>
                    <label><span style={lbl}>Firma de Pulppo</span><input style={inp} value={f.pulppo} placeholder="Nombre" onChange={(e) => set('pulppo', e.target.value)} /></label>
                    <label><span style={lbl}>Cargo</span><input style={inp} value={f.pulppoCargo} onChange={(e) => set('pulppoCargo', e.target.value)} /></label>
                    <label><span style={lbl}>Lugar y fecha</span><input style={inp} value={f.lugarFecha} onChange={(e) => set('lugarFecha', e.target.value)} /></label>
                    <label><span style={lbl}>Cierre de la carta</span><input style={inp} value={f.cierre} onChange={(e) => set('cierre', e.target.value)} /></label>
                </div>
            </details>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {con.map((p) => <PremioCard key={p.key} p={p} d={d} f={f} />)}
            </div>
            {sin.length > 0 && (
                <div style={{ fontSize: 12, color: MUTED, marginTop: 18 }}>
                    Sin ganador este año (nadie llegó al mínimo): {sin.map((p) => p.titulo).join(', ')}.
                </div>
            )}
        </div>
    );
}

const iniciales = (g: Ganador) => `${g.first.charAt(0)}${g.last.charAt(0)}`.toUpperCase();
function Foto({ g, size }: { g: Ganador; size: number }) {
    const [ok, setOk] = useState(true);
    const st: CSSProperties = { width: size, height: size, borderRadius: '50%', flex: 'none', objectFit: 'cover', background: LINE };
    return g.photo && ok
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={g.photo} alt="" style={st} onError={() => setOk(false)} />
        : <div style={{ ...st, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700 }}>{iniciales(g)}</div>;
}

function PremioCard({ p, d, f }: { p: Premio; d: Reconocimientos; f: Firmas }) {
    const [g1, ...resto] = p.podio;
    const btn: CSSProperties = { padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 700, border: `1px solid ${BLK}`, background: '#fff', cursor: 'pointer', borderRadius: 2, fontFamily: 'inherit' };
    const Botones = ({ g }: { g: Ganador }) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <button style={btn} onClick={() => abrirCarta(p, g, d, f)}>Carta (PDF)</button>
            <button style={btn} onClick={() => descargarPieza(p, g, d, 'post')}>Post 4:5</button>
            <button style={btn} onClick={() => descargarPieza(p, g, d, 'historia')}>Historia 9:16</button>
        </div>
    );
    return (
        <div style={{ border: `0.5px solid ${LINE}`, padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 3, width: 32, background: YEL, marginBottom: 12 }} />
            <div style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.15 }}>{p.titulo}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4, marginBottom: 14 }} title={p.regla}>{p.porque} <span style={{ cursor: 'help' }}>ⓘ</span></div>
            {p.varios ? (
                p.podio.map((g) => (
                    <div key={g.email} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: `0.5px solid ${LINE}` }}>
                        <Foto g={g} size={44} />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{g.nombre}</div>
                            <div style={{ fontSize: 12, color: MUTED }}>{g.valor} · {g.detalle}</div>
                            <Botones g={g} />
                        </div>
                    </div>
                ))
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        <Foto g={g1} size={64} />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700 }}>{g1.nombre}</div>
                            <div style={{ fontFamily: serif, fontSize: 26, lineHeight: 1.1 }}>{g1.valor}</div>
                            <div style={{ fontSize: 12, color: MUTED }}>{g1.detalle}</div>
                        </div>
                    </div>
                    <Botones g={g1} />
                    {resto.length > 0 && (
                        <div style={{ marginTop: 14, borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>
                            {resto.map((g, i) => (
                                <div key={g.email + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '3px 0' }}>
                                    <span><span style={{ color: MUTED }}>{i + 2}.</span> {g.nombre}</span>
                                    <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>{g.valor}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── carta de reconocimiento (tamaño carta, se guarda como PDF desde el diálogo de impresión) ──
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function abrirCarta(p: Premio, g: Ganador, d: Reconocimientos, f: Firmas) {
    const w = window.open('', '_blank');
    if (!w) return;
    const origen = window.location.origin;
    const porque = p.porque.replace(/^Por /, 'por ');
    const firma = (n: string, c: string) => `<div class="firma"><div class="raya"></div><div class="fn">${esc(n || ' ')}</div><div class="fc">${esc(c)}</div></div>`;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reconocimiento · ${esc(g.nombre)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;700&display=swap" rel="stylesheet">
<style>
@font-face { font-family: 'Heldane'; src: url('${origen}/plus/ranking/HeldaneTextRegular.otf'); }
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: ${BLK}; font-family: 'Nunito Sans', Arial, sans-serif; }
.hoja { width: 8.5in; height: 11in; padding: 0.9in 0.9in 0.8in; display: flex; flex-direction: column; position: relative; }
.top { display: flex; justify-content: space-between; align-items: center; height: 56px; }
.top img { max-height: 56px; max-width: 200px; object-fit: contain; }
.top .pulppo { max-height: 26px; }
.eyebrow { margin-top: 1.1in; font-size: 11pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.acento { width: 48px; height: 3px; background: ${YEL}; margin: 14px 0 22px; }
h1 { font-family: 'Heldane', 'EB Garamond', serif; font-weight: 400; font-size: 40pt; line-height: 1.05; margin: 0; }
.otorga { margin-top: 0.55in; font-size: 12pt; color: ${MUTED}; }
.nombre { font-family: 'Heldane', 'EB Garamond', serif; font-size: 40pt; line-height: 1.1; margin-top: 6px; }
.texto { margin-top: 0.35in; font-size: 12pt; line-height: 1.6; max-width: 5.6in; }
.dato { margin-top: 0.3in; display: flex; align-items: baseline; gap: 14px; }
.dato .v { font-family: 'Heldane', 'EB Garamond', serif; font-size: 28pt; }
.dato .s { font-size: 11pt; color: ${MUTED}; }
.pie { margin-top: auto; }
.lugar { font-size: 11pt; color: ${MUTED}; margin-bottom: 0.7in; }
.firmas { display: flex; gap: 0.6in; }
.firma { flex: 1; }
.raya { border-top: 0.5pt solid ${BLK}; margin-bottom: 8px; }
.fn { font-size: 12pt; font-weight: 700; min-height: 16pt; }
.fc { font-size: 11pt; color: ${MUTED}; }
.barra { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: ${YEL}; }
@media screen { body { background: ${LGT}; } .hoja { margin: 24px auto; background: #fff; } }
</style></head><body><div class="hoja">
<div class="top">${d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<b style="font-size:14pt">${esc(d.inmobiliaria)}</b>`}<img class="pulppo" src="${origen}/pulppo-wordmark-black.png" alt="Pulppo"></div>
<div class="eyebrow">Reconocimiento ${d.año}</div><div class="acento"></div>
<h1>${esc(p.titulo)}</h1>
<div class="otorga">Se otorga a</div>
<div class="nombre">${esc(g.nombre)}</div>
<div class="texto">${esc(`De parte de ${d.inmobiliaria} y Pulppo, ${porque.replace(/\.$/, '')}.`)} ${esc(f.cierre)}</div>
<div class="dato"><span class="v">${esc(g.valor)}</span><span class="s">${esc(g.detalle)}</span></div>
<div class="pie"><div class="lugar">${esc(f.lugarFecha)}</div>
<div class="firmas">${firma(f.dueno, `${f.duenoCargo} · ${d.inmobiliaria}`)}${firma(f.pulppo, f.pulppoCargo)}</div></div>
<div class="barra"></div>
</div>
<script>Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => setTimeout(() => window.print(), 250));</script>
</body></html>`);
    w.document.close();
}

// ── piezas para redes (canvas → PNG) ──
async function descargarPieza(p: Premio, g: Ganador, d: Reconocimientos, tipo: 'post' | 'historia') {
    await ensureFonts();
    await document.fonts.load('700 40px "Nunito Sans"');
    const W = 1080, H = tipo === 'post' ? 1350 : 1920;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')!;
    const HEL = '"HeldaneTextRegular", "EB Garamond", serif', NUN = '"Nunito Sans", Arial, sans-serif';
    ctx.fillStyle = BLK; ctx.fillRect(0, 0, W, H);
    const k = tipo === 'post' ? 1 : 1.25;       // la historia respira más
    const top = tipo === 'post' ? 110 : 250;
    const pieY = H - (tipo === 'post' ? 150 : 260);
    // alto del bloque (foto + premio + nombre + dato) para centrarlo entre el eyebrow y el pie
    ctx.font = `400 ${Math.round(92 * k)}px ${HEL}`;
    const lTit = partir(ctx, p.titulo, W - 160);
    ctx.font = `700 ${Math.round(50 * k)}px ${NUN}`;
    const lNom = partir(ctx, g.nombre, W - 160);
    const R = Math.round(180 * k);
    const alto = 2 * R + 20 + Math.round(120 * k) + lTit.length * Math.round(100 * k) + Math.round(10 * k)
        + lNom.length * Math.round(60 * k) + Math.round(40 * k) + Math.round(54 * k);
    const y0 = top + 40 + Math.max(0, (pieY - 60 - (top + 40) - alto) / 2);

    // eyebrow
    ctx.fillStyle = YEL; ctx.font = `700 28px ${NUN}`; ctx.textAlign = 'center';
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px';
    ctx.fillText(`RECONOCIMIENTOS ${d.año}`, W / 2, top);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';

    // foto
    const cy = y0 + 10 + R;
    ctx.beginPath(); ctx.arc(W / 2, cy, R + 10, 0, Math.PI * 2); ctx.fillStyle = YEL; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const im = g.photo ? await loadImg(g.photo) : null;
    if (im) {
        const s = Math.max((2 * R) / im.naturalWidth, (2 * R) / im.naturalHeight);
        const w = im.naturalWidth * s, h = im.naturalHeight * s;
        ctx.drawImage(im, W / 2 - w / 2, cy - h / 2, w, h);
    } else {
        ctx.fillStyle = LGT; ctx.fillRect(W / 2 - R, cy - R, 2 * R, 2 * R);
        ctx.fillStyle = BLK; ctx.font = `700 ${Math.round(R * 0.7)}px ${NUN}`; ctx.textBaseline = 'middle';
        ctx.fillText(iniciales(g), W / 2, cy); ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    // premio (Heldane, partido en renglones)
    let y = cy + R + Math.round(120 * k);
    ctx.fillStyle = '#fff'; ctx.font = `400 ${Math.round(92 * k)}px ${HEL}`;
    for (const ln of lTit) { ctx.fillText(ln, W / 2, y); y += Math.round(100 * k); }
    // nombre
    y += Math.round(10 * k);
    ctx.font = `700 ${Math.round(50 * k)}px ${NUN}`;
    for (const ln of lNom) { ctx.fillText(ln, W / 2, y); y += Math.round(60 * k); }
    // dato
    y += Math.round(40 * k);
    ctx.fillStyle = YEL; ctx.font = `400 ${Math.round(64 * k)}px ${HEL}`;
    ctx.fillText(g.valor, W / 2, y);
    y += Math.round(54 * k);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `400 ${Math.round(30 * k)}px ${NUN}`;
    ctx.fillText(g.detalle, W / 2, y);

    // pie: logo de la inmobiliaria (en caja blanca: hay logos oscuros) + Pulppo
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(80, pieY - 40, W - 160, 1);
    const logo = d.logo ? await loadImg(d.logo) : null;
    if (logo) {
        const bh = 96, pad = 14;
        const s = Math.min((bh - 2 * pad) / logo.naturalHeight, 300 / logo.naturalWidth);
        const lw = logo.naturalWidth * s, lh = logo.naturalHeight * s;
        ctx.fillStyle = '#fff'; ctx.fillRect(80, pieY, lw + 2 * pad, bh);
        ctx.drawImage(logo, 80 + pad, pieY + (bh - lh) / 2, lw, lh);
    } else {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = `700 34px ${NUN}`;
        ctx.fillText(d.inmobiliaria, 80, pieY + 60); ctx.textAlign = 'center';
    }
    const pl = await loadImg('/pulppo-blanco.png');
    if (pl) { const h = 48, w = (pl.naturalWidth * h) / pl.naturalHeight; ctx.drawImage(pl, W - 80 - w, pieY + 24, w, h); }

    cv.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${p.titulo} - ${g.nombre} (${tipo === 'post' ? '4x5' : '9x16'}).png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
}

function partir(ctx: CanvasRenderingContext2D, t: string, maxW: number): string[] {
    const out: string[] = [];
    let cur = '';
    for (const w of t.split(/\s+/)) {
        const n = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(n).width > maxW && cur) { out.push(cur); cur = w; } else cur = n;
    }
    if (cur) out.push(cur);
    return out;
}

