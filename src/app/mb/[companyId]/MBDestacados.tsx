'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Aviso, DatosInmo } from '@/lib/portales/avisos';

/* ------------------------------------------------------------------ *
 * /mb/[companyId] → Destacados
 *
 * TODOS los avisos de la inmobiliaria con sus etiquetas, y la columna donde ella
 * marca cuáles quiere destacar. No se filtra ninguno: renta, terreno y comercial
 * aparecen con su etiqueta y el checkbox deshabilitado, porque no compiten por un
 * lugar pagado pero tampoco deben desaparecer de la vista.
 *
 * Las etiquetas son MÚLTIPLES por aviso a propósito: uno puede estar caro Y sin
 * video, y el asesor necesita ver las dos cosas para saber qué resolver.
 *
 * ⚠️ La primera consulta del día arma el mercado (26,590 avisos del MLS de i24 +
 * 92,000 búsquedas guardadas) y puede tardar un minuto; después queda cacheado una
 * hora y cada cuenta responde en segundos. Por eso el estado de carga dice qué está
 * pasando en vez de dejar un spinner mudo.
 * ------------------------------------------------------------------ */

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const R = 2;

const ORDEN = ['destacar', 'falta video o tour', 'faltan fotos', 'calidad i24 baja',
               'precio caro', 'comisión baja', 'no hay demanda', 'poca oferta',
               'terreno', 'renta', 'comercial'];
/** Las que NO impiden destacar: son trabajo, no descarte. */
const ARREGLABLES = new Set(['falta video o tour', 'faltan fotos', 'calidad i24 baja',
                             'precio caro', 'comisión baja']);
const money = (n?: number | null) =>
    n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

function colorTag(t: string): CSSProperties {
    if (t === 'destacar') return { background: 'rgba(82,153,153,.18)', color: SEA };
    if (ARREGLABLES.has(t)) return { background: 'rgba(246,190,0,.28)', color: '#8a6a00' };
    return { background: '#e9e9e7', color: '#6f6f6d' };
}

export default function MBDestacados({ nombre }: { nombre: string }) {
    const [d, setD] = useState<DatosInmo | null>(null);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState<string | null>(null);
    const [q, setQ] = useState('');
    const [marcados, setMarcados] = useState<Set<string>>(new Set());
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState('');
    const [efimero, setEfimero] = useState(false);
    const [sucio, setSucio] = useState(false);

    useEffect(() => {
        let vivo = true;
        setD(null); setError('');
        fetch(`/api/avisos?inmo=${encodeURIComponent(nombre)}`)
            .then((r) => r.json())
            .then((j) => { if (!vivo) return; if (j.error) throw new Error(j.error); setD(j); })
            .catch((e) => vivo && setError(String(e.message ?? e)));
        fetch(`/api/avisos/seleccion?inmo=${encodeURIComponent(nombre)}`)
            .then((r) => r.json())
            .then((j) => {
                if (!vivo) return;
                setEfimero(!!j.efimero);
                setMarcados(new Set<string>(j.seleccion?.ids ?? []));
                setNota(j.seleccion?.nota ?? '');
                if (j.seleccion) setAviso(
                    `Última respuesta: ${j.seleccion.ids.length} avisos · ${j.seleccion.por}`
                    + ` · ${new Date(j.seleccion.fecha).toLocaleDateString('es-MX')}`);
            })
            .catch(() => { /* sin respuesta previa */ });
        return () => { vivo = false; };
    }, [nombre]);

    const porTag = useMemo(() => {
        const m: Record<string, Aviso[]> = {};
        for (const k of ORDEN) m[k] = [];
        for (const a of d?.avisos ?? []) for (const t of a.tags) (m[t] ??= []).push(a);
        return m;
    }, [d]);

    const filas = useMemo(() => {
        let f = d?.avisos ?? [];
        if (filtro) f = f.filter((a) => a.tags.includes(filtro));
        const t = q.trim().toLowerCase();
        if (t) f = f.filter((a) => a.id.toLowerCase().includes(t)
            || (a.colonia ?? '').toLowerCase().includes(t) || a.broker.toLowerCase().includes(t));
        return f;
    }, [d, filtro, q]);

    async function guardar() {
        if (!d) return;
        setGuardando(true); setError('');
        try {
            const r = await fetch('/api/avisos/seleccion', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inmo: d.inmobiliaria, ids: [...marcados], nota }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? 'No se pudo guardar');
            setAviso(`Guardado: ${j.seleccion.ids.length} avisos · ${j.seleccion.por}`
                + ` · ${new Date(j.seleccion.fecha).toLocaleString('es-MX')}`);
            setSucio(false);
        } catch (e) { setError(String((e as Error).message)); }
        finally { setGuardando(false); }
    }

    /** Respaldo que no depende del servidor. */
    function descargar() {
        if (!d) return;
        const filas2 = d.avisos.map((a) => [a.id, marcados.has(a.id) ? 'DESTACAR' : '', a.tipo,
            a.operacion, a.colonia ?? '', a.precio, a.comisionPct ?? '', a.demanda, a.competencia,
            a.tierNombre, a.tags.join(' | '), a.falta]);
        const csv = [['ID', 'Respuesta', 'Tipo', 'Operación', 'Colonia', 'Precio', '% comisión',
                      'Buscando', 'Competencia', 'Tier hoy', 'Etiquetas', 'Qué le falta'], ...filas2]
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const el = document.createElement('a');
        el.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        el.download = `destacados-${nombre.replace(/\s+/g, '-')}.csv`;
        el.click();
    }

    const th: CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.7px',
        color: GRY, fontWeight: 700, textAlign: 'left', padding: '8px 7px', whiteSpace: 'nowrap',
        position: 'sticky', top: 0, background: '#fff', borderBottom: `1px solid #e8e8e8` };
    const td: CSSProperties = { padding: '6px 7px', borderBottom: '1px solid #f2f2f0', fontSize: 12 };
    const num: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

    if (error) return (
        <div style={{ borderLeft: `3px solid ${RED}`, background: LGT, padding: 14, borderRadius: R }}>
            <b>No se pudo calcular.</b> {error}
        </div>
    );
    if (!d) return (
        <div style={{ borderLeft: `3px solid ${YEL}`, background: LGT, padding: 14, borderRadius: R, fontSize: 13 }}>
            Calculando <b>{nombre}</b> en vivo — demanda, competencia y precio contra su colonia.
            <div style={{ color: GRY, fontSize: 11.5, marginTop: 6 }}>
                La primera consulta del día arma el mercado (26,590 avisos del MLS de i24 y 92,000
                búsquedas guardadas) y puede tardar un minuto. Después queda listo por una hora.
            </div>
        </div>
    );

    return (
        <div>
            {/* ── el cuadre ── */}
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'baseline',
                          border: '1px solid #e8e8e8', borderRadius: R, padding: '18px 20px' }}>
                {[[String(d.avisos.length), 'avisos en total'],
                  [String(porTag['destacar']?.length ?? 0), 'listos para destacar'],
                  [String(d.destacados), 'destacados hoy'],
                  [money(d.gastoMes), 'al mes en portal'],
                  [String(marcados.size), 'marcados por ellos']].map(([n, l]) => (
                    <div key={l}>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 27, lineHeight: 1 }}>{n}</div>
                        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.6px', color: GRY, marginTop: 5 }}>{l}</div>
                    </div>
                ))}
            </div>

            {/* ── barra de respuesta ── */}
            <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 10,
                          flexWrap: 'wrap', alignItems: 'center', background: '#fff',
                          border: '1px solid #e8e8e8', borderRadius: R, padding: 12, marginTop: 14 }}>
                <span style={{ fontSize: 12.5 }}>
                    <b>{marcados.size}</b> marcados
                    {marcados.size > 0 && (
                        <span style={{ color: GRY }}> · {money(marcados.size * 508)}/mes extra si todos suben a Súper Destacado</span>
                    )}
                </span>
                <input value={nota} onChange={(e) => { setNota(e.target.value); setSucio(true); }}
                    placeholder="Nota (opcional): por qué esta selección…"
                    style={{ flex: 1, minWidth: 200, fontSize: 12, padding: '6px 9px',
                             border: '1px solid #d8d8d6', borderRadius: R }} />
                <button onClick={descargar} style={{ fontSize: 11.5, padding: '7px 12px', cursor: 'pointer',
                    border: '1px solid #d8d8d6', background: '#fff', borderRadius: R }}>Descargar CSV</button>
                <button onClick={guardar} disabled={guardando || efimero}
                    style={{ fontSize: 11.5, fontWeight: 700, padding: '7px 16px', borderRadius: R,
                             border: 'none', background: efimero ? '#e9e9e7' : YEL, color: BLK,
                             cursor: efimero ? 'not-allowed' : 'pointer' }}>
                    {guardando ? 'Guardando…' : 'Guardar'}
                </button>
            </div>
            {efimero && (
                <div style={{ borderLeft: `3px solid ${RED}`, background: LGT, padding: 10, marginTop: 8, fontSize: 11.5, borderRadius: R }}>
                    <b>El guardado está apagado en este ambiente.</b> Falta crear el Blob del proyecto
                    en Vercel (Storage → Create → Blob). Mientras tanto usa <b>Descargar CSV</b>.
                </div>
            )}
            {aviso && !sucio && <div style={{ color: SEA, fontSize: 11.5, marginTop: 8 }}>{aviso}</div>}
            {sucio && <div style={{ color: '#8a6a00', fontSize: 11.5, marginTop: 8 }}>Hay cambios sin guardar.</div>}

            {/* ── filtros por etiqueta ── */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                {[['', `Todos (${d.avisos.length})`] as const,
                  ...ORDEN.filter((k) => porTag[k]?.length).map((k) => [k, `${k} (${porTag[k].length})`] as const)]
                    .map(([k, label]) => (
                    <button key={k || 'todos'} onClick={() => setFiltro(k || null)}
                        style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 20,
                                 cursor: 'pointer', border: `1px solid ${(filtro ?? '') === k ? YEL : '#e0e0de'}`,
                                 background: (filtro ?? '') === k ? YEL : '#fff', color: BLK }}>
                        {label}
                    </button>
                ))}
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ID, colonia o asesor…"
                    style={{ marginLeft: 'auto', minWidth: 200, fontSize: 12, padding: '6px 9px',
                             border: '1px solid #d8d8d6', borderRadius: R }} />
            </div>

            <div style={{ borderLeft: `3px solid ${SEA}`, background: LGT, padding: 11, marginTop: 12,
                          fontSize: 11.5, lineHeight: 1.5, borderRadius: R }}>
                Están <b>todos</b> los avisos, ninguno se filtró. Un aviso puede traer varias etiquetas
                —puede estar caro <i>y</i> sin video—. Los de <b>renta</b>, <b>terreno</b> y{' '}
                <b>comercial</b> no compiten por un lugar destacado: por eso no se pueden marcar.
            </div>

            {/* ── la tabla ── */}
            <div style={{ maxHeight: 620, overflow: 'auto', border: '1px solid #e8e8e8',
                          borderRadius: R, marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ ...th, textAlign: 'center' }}>Destacar</th>
                            {['ID', 'Asesor', 'Colonia', 'Tipo', 'Precio', '% com', 'Buscando',
                              'Compet.', 'Puntaje', 'Tier hoy', 'Etiquetas', 'Qué le falta']
                                .map((h) => <th key={h} style={th}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((a) => (
                            <tr key={a.id} style={{ background: marcados.has(a.id) ? 'rgba(246,190,0,.10)' : undefined }}>
                                <td style={{ ...td, textAlign: 'center' }}>
                                    <input type="checkbox" checked={marcados.has(a.id)} disabled={!a.destacable}
                                        onChange={() => { setMarcados((p) => { const n = new Set(p);
                                            n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; }); setSucio(true); }}
                                        title={a.destacable ? 'Marcar para destacar'
                                            : 'Renta, terreno o comercial: no compite por lugar destacado'}
                                        style={{ width: 15, height: 15, accentColor: YEL,
                                                 opacity: a.destacable ? 1 : .25 }} />
                                </td>
                                <td style={{ ...td, fontWeight: 700 }}>{a.id}</td>
                                <td style={td}>{a.broker}</td>
                                <td style={td}>{a.colonia ?? '—'}</td>
                                <td style={td}>{a.tipo}</td>
                                <td style={num}>{money(a.precio)}</td>
                                <td style={num}>{a.comisionPct ?? '—'}</td>
                                <td style={num}>{a.demanda}</td>
                                <td style={num}>{a.competencia}</td>
                                <td style={{ ...num, fontWeight: 700 }}>{a.puntos}</td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.tierNombre}</td>
                                <td style={td}>
                                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        {a.tags.map((t) => (
                                            <span key={t} style={{ ...colorTag(t), fontSize: 10, fontWeight: 700,
                                                padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>{t}</span>
                                        ))}
                                    </span>
                                </td>
                                <td style={{ ...td, color: '#7a7a78' }}>{a.falta}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ color: GRY, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
                {filas.length} de {d.avisos.length} avisos · datos en vivo, calculados en{' '}
                {(d.ms / 1000).toFixed(1)} s. El puntaje ordena su inventario (70 potencial×regalía +
                15 comisión + 15 calidad de la cuenta) y el percentil se calcula <b>dentro de la
                cuenta</b>, así que no compara entre inmobiliarias.
            </div>
        </div>
    );
}
