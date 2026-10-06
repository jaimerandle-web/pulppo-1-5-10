'use client';
// Ascensos del año: quién llegó por primera vez a élite o a profesional y el seguimiento para
// que el reconocimiento llegue de verdad — ¿ya se le avisó? ¿ya recogió su pin? Las palomitas
// se guardan (Vercel Blob, ver lib/plusSeguimiento.ts) y dicen quién las marcó y cuándo.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PremioNuevo } from '@/lib/premios';
import type { Campo, Seguimiento } from '@/lib/plusSeguimiento';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;
type Nivel = 'elite' | 'professional';
const LVL: Record<string, { base: string; soft: string; lbl: string }> = {
    elite: { base: '#B88849', soft: '#EFE4D2', lbl: 'Élite' },
    professional: { base: '#868B8E', soft: '#E4E6E7', lbl: 'Profesional' },
    standard: { base: '#DEA37F', soft: '#F7E7DC', lbl: 'Estándar' },
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
type Col = 'broker' | 'inmo' | 'corte' | 'sigue' | 'contactado' | 'pin';
interface Datos { year: number; efimero: boolean; seguimiento: Seguimiento; elite: PremioNuevo[]; professional: PremioNuevo[] }

const cuando = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
const quien = (email: string) => email.split('@')[0];

function Avatar({ src, name, color }: { src?: string | null; name: string; color: string }) {
    const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
    const s: CSSProperties = { width: 28, height: 28, borderRadius: 28, border: `2px solid ${color}`, flexShrink: 0, background: LGT };
    return src ? <img src={src} alt={name} loading="lazy" style={{ ...s, objectFit: 'cover' }} />
        : <span style={{ ...s, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'EB Garamond, serif', fontSize: 12 }}>{ini}</span>;
}

export default function AscensosPanel({ year }: { year: number }) {
    const [d, setD] = useState<Datos | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [nivel, setNivel] = useState<Nivel>('elite');
    const [soloSiguen, setSoloSiguen] = useState(false);
    const [guardando, setGuardando] = useState<string | null>(null);
    // Orden de la tabla: clic en el encabezado alterna ▲/▼. Por defecto, por corte (el orden de llegada).
    const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: 'corte', asc: true });

    useEffect(() => {
        fetch(`/api/plus/ascensos?year=${year}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then(setD).catch((e) => setErr(String(e)));
    }, [year]);

    const clave = (n: PremioNuevo) => `${year}:${nivel}:${n.email}`;
    const filas = useMemo(() => {
        if (!d) return [];
        const k = (n: PremioNuevo) => `${year}:${nivel}:${n.email}`;
        // valor ordenable por columna; las palomitas ordenan por fecha de marcado (sin marcar = al final en ▲)
        const v = (n: PremioNuevo): string | number => {
            switch (orden.col) {
                case 'broker': return n.name.toLowerCase();
                case 'inmo': return (n.company ?? '').toLowerCase();
                case 'corte': return MESES.indexOf(n.mes);
                case 'sigue': return n.sigue ? 1 : 0;
                case 'contactado': case 'pin': { const m = d.seguimiento[k(n)]?.[orden.col]; return m ? Date.parse(m.at) : Infinity; }
            }
        };
        const rows = d[nivel].filter((n) => !soloSiguen || n.sigue);
        return [...rows].sort((a, b) => {
            const x = v(a), y = v(b);
            const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
            return (orden.asc ? c : -c) || a.name.localeCompare(b.name, 'es');
        });
    }, [d, nivel, soloSiguen, orden, year]);

    const toggle = async (n: PremioNuevo, campo: Campo) => {
        if (!d) return;
        const k = clave(n), valor = !d.seguimiento[k]?.[campo];
        const antes = d.seguimiento;
        // optimista: se pinta ya y se revierte si el guardado falla
        const prov: Seguimiento = { ...antes, [k]: { ...(antes[k] ?? {}) } };
        if (valor) prov[k][campo] = { at: new Date().toISOString(), by: 'tú' }; else delete prov[k][campo];
        setD({ ...d, seguimiento: prov });
        setGuardando(k + campo); setErr(null);
        try {
            const r = await fetch('/api/plus/ascensos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: k, campo, valor }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? r.statusText);
            setD((cur) => (cur ? { ...cur, seguimiento: j.seguimiento } : cur));
        } catch (e) {
            setD((cur) => (cur ? { ...cur, seguimiento: antes } : cur));
            setErr(`No se guardó: ${e instanceof Error ? e.message : e}`);
        }
        setGuardando(null);
    };

    if (err && !d) return <div style={{ color: RED, fontSize: 13 }}>No pude cargar los ascensos: {err}</div>;
    if (!d) return <div style={{ color: GRY, fontSize: 13 }}>Cargando ascensos…</div>;

    const tot = (lv: Nivel, campo?: Campo) => d[lv].filter((n) => !campo || d.seguimiento[`${year}:${lv}:${n.email}`]?.[campo]).length;
    const th: CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, fontSize: 12.5, verticalAlign: 'middle' };

    const Check = ({ n, campo }: { n: PremioNuevo; campo: Campo }) => {
        const m = d.seguimiento[clave(n)]?.[campo];
        const busy = guardando === clave(n) + campo;
        return (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: d.efimero ? 'not-allowed' : 'pointer', opacity: busy ? .5 : 1 }}
                title={m ? `Marcado por ${quien(m.by)} el ${cuando(m.at)}` : ''}>
                <input type="checkbox" checked={!!m} disabled={d.efimero || busy} onChange={() => toggle(n, campo)}
                    style={{ width: 16, height: 16, accentColor: SEA, cursor: 'inherit' }} />
                {m && <span style={{ fontSize: 10, color: '#888' }}>{quien(m.by)} · {cuando(m.at)}</span>}
            </label>
        );
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                <div>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 23 }}>Ascensos {year}</div>
                    <div style={{ fontSize: 11.5, color: '#777', marginTop: 2, maxWidth: 640 }}>
                        Asesores que llegaron <b>por primera vez</b> a élite o a profesional este año. Marca cuando ya se les avisó y cuando
                        recibieron su pin: se guarda y queda quién lo marcó.
                    </div>
                </div>
                <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={soloSiguen} onChange={(e) => setSoloSiguen(e.target.checked)} style={{ accentColor: BLK }} />
                    Sólo los que siguen en el nivel
                </label>
            </div>

            {d.efimero && (
                <div style={{ background: '#FBF3D9', padding: '9px 12px', borderRadius: R, fontSize: 11.5, marginBottom: 12 }}>
                    <b>Sólo lectura:</b> falta configurar el almacenamiento en Vercel (Storage → Create → Blob). Sin eso las palomitas no se guardarían.
                </div>
            )}
            {err && <div style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                {(['elite', 'professional'] as Nivel[]).map((lv) => {
                    const on = nivel === lv, c = LVL[lv];
                    return (
                        <div key={lv} onClick={() => setNivel(lv)} style={{ flex: '1 1 240px', cursor: 'pointer', borderRadius: R, padding: '12px 14px',
                            border: `1px solid ${on ? c.base : LGT}`, background: on ? c.soft : '#fff' }}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, color: c.base }}>Nuevos {c.lbl.toLowerCase()}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
                                <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 28 }}>{d[lv].length}</span>
                                <span style={{ fontSize: 11.5, color: '#666' }}>
                                    {d[lv].filter((n) => n.sigue).length} siguen · contactados {tot(lv, 'contactado')}/{tot(lv)} · pin {tot(lv, 'pin')}/{tot(lv)}
                                </span>
                            </div>
                            {/* barra de avance de pines entregados */}
                            <div style={{ height: 5, background: on ? '#fff' : LGT, borderRadius: R, marginTop: 8 }}>
                                <div style={{ height: 5, width: `${tot(lv) ? (100 * tot(lv, 'pin')) / tot(lv) : 0}%`, background: SEA, borderRadius: R }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead><tr>
                        {([['broker', 'Broker'], ['inmo', 'Inmobiliaria'], ['corte', 'Llegó en el corte de'],
                            ['sigue', `Sigue en ${LVL[nivel].lbl.toLowerCase()}`], ['contactado', 'Contactado'], ['pin', 'Pin entregado']] as [Col, string][]).map(([c, lbl]) => {
                            const on = orden.col === c;
                            return (
                                <th key={c} style={{ ...th, cursor: 'pointer', userSelect: 'none', color: on ? BLK : '#666' }}
                                    onClick={() => setOrden((o) => ({ col: c, asc: o.col === c ? !o.asc : true }))}>
                                    {lbl} <span style={{ color: on ? BLK : '#ccc' }}>{on ? (orden.asc ? '▲' : '▼') : '▲▼'}</span>
                                </th>
                            );
                        })}
                    </tr></thead>
                    <tbody>
                        {filas.length === 0 && <tr><td colSpan={6} style={{ ...td, color: GRY, textAlign: 'center', padding: 18 }}>Nadie todavía.</td></tr>}
                        {filas.map((n) => (
                            <tr key={n.email} style={{ background: d.seguimiento[clave(n)]?.pin ? '#F4FAFA' : undefined }}>
                                <td style={td}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <Avatar src={n.photo} name={n.name} color={LVL[nivel].base} />
                                        <span style={{ fontWeight: 600 }}>{n.name.replace(/\s+/g, ' ')}</span>
                                    </div>
                                </td>
                                <td style={{ ...td, color: '#666' }}>{n.company ?? '—'}</td>
                                <td style={{ ...td, textTransform: 'capitalize' }}>{n.mes}</td>
                                <td style={td}>
                                    {n.sigue
                                        ? <span style={{ color: SEA, fontWeight: 700 }}>Sí{n.levelHoy && n.levelHoy !== nivel ? ` · hoy ${LVL[n.levelHoy]?.lbl ?? n.levelHoy}` : ''}</span>
                                        : <span style={{ color: RED }}>No · hoy {LVL[n.levelHoy ?? '']?.lbl ?? '—'}</span>}
                                </td>
                                <td style={td}><Check n={n} campo="contactado" /></td>
                                <td style={td}><Check n={n} campo="pin" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 10.5, color: GRY, marginTop: 8 }}>
                "Llegó en el corte de" = el mes de desempeño con el que subió (el corte sale el día 1 del mes siguiente). Profesional incluye a quien subió directo a élite.
            </div>
        </div>
    );
}
