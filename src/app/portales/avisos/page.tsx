'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Aviso, DatosInmo } from '@/lib/portales/avisos';

/* ------------------------------------------------------------------ *
 * /portales/avisos — Qué destacar en inmuebles24, EN VIVO.
 *
 * Sustituye al HTML estático de /avisos.html, que traía los datos embebidos y se
 * quedó tres semanas atrás: 3,722 avisos vivos no aparecían y 613 ya vendidos
 * seguían en la tabla. Acá cada consulta pega a Mongo (ver lib/portales/avisos.ts).
 *
 * La primera carga del día tarda ~19 s porque arma el mercado (26,590 avisos del MLS
 * de i24 + 92,000 búsquedas guardadas) y lo cachea una hora. Después, cada
 * inmobiliaria son 2–6 s. Por eso hay estado de carga explícito y no spinner mudo.
 * ------------------------------------------------------------------ */

type Fila = { inmobiliaria: string; kam: string; venta: number; destacados: number };

// Las etiquetas, en el orden en que se leen. Un aviso puede traer varias.
const ORDEN = ['destacar', 'falta video o tour', 'faltan fotos', 'calidad i24 baja',
               'precio caro', 'comisión baja', 'no hay demanda', 'poca oferta',
               'terreno', 'renta', 'comercial'];
/** Las que NO impiden destacar: son trabajo, no descarte. */
const ARREGLABLES = new Set(['falta video o tour', 'faltan fotos', 'calidad i24 baja',
                             'precio caro', 'comisión baja']);
const COLOR_TAG = (t: string) =>
    t === 'destacar' ? 'bg-sea/20 text-sea'
    : ARREGLABLES.has(t) ? 'bg-[#F6BE00]/25 text-[#8a6a00]'
    : 'bg-neutral-200 text-neutral-600';

const money = (n?: number | null) =>
    n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const f1 = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 1 });

export default function AvisosLive() {
    const [lista, setLista] = useState<Fila[]>([]);
    const [kam, setKam] = useState('');
    const [inmo, setInmo] = useState('');
    const [d, setD] = useState<DatosInmo | null>(null);
    const [cargando, setCargando] = useState<'lista' | 'inmo' | null>('lista');
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState<string | null>(null);
    const [q, setQ] = useState('');
    // la respuesta de la inmobiliaria: qué quiere destacar
    const [marcados, setMarcados] = useState<Set<string>>(new Set());
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [guardado, setGuardado] = useState('');
    const [efimero, setEfimero] = useState(false);
    const [sucio, setSucio] = useState(false);

    useEffect(() => {
        fetch('/api/avisos')
            .then((r) => r.json())
            .then((j) => {
                if (j.error) throw new Error(j.error);
                setLista(j.inmobiliarias);
            })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setCargando(null));
    }, []);

    function abrir(nombre: string) {
        setInmo(nombre); setD(null); setFiltro(null); setCargando('inmo'); setError('');
        setGuardado(''); setSucio(false);
        fetch(`/api/avisos?inmo=${encodeURIComponent(nombre)}`)
            .then((r) => r.json())
            .then((j) => { if (j.error) throw new Error(j.error); setD(j); })
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setCargando(null));
        // se recupera lo que ya hubieran marcado antes
        fetch(`/api/avisos/seleccion?inmo=${encodeURIComponent(nombre)}`)
            .then((r) => r.json())
            .then((j) => {
                setEfimero(!!j.efimero);
                setMarcados(new Set<string>(j.seleccion?.ids ?? []));
                setNota(j.seleccion?.nota ?? '');
                if (j.seleccion) setGuardado(
                    `Última respuesta: ${j.seleccion.ids.length} avisos · ${j.seleccion.por}`
                    + ` · ${new Date(j.seleccion.fecha).toLocaleDateString('es-MX')}`);
            })
            .catch(() => { /* sin respuesta previa: se empieza en blanco */ });
    }

    function marcar(id: string) {
        setMarcados((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
        setSucio(true);
    }

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
            setGuardado(`Guardado: ${j.seleccion.ids.length} avisos · ${j.seleccion.por}`
                + ` · ${new Date(j.seleccion.fecha).toLocaleString('es-MX')}`);
            setSucio(false);
        } catch (e) {
            setError(String((e as Error).message));
        } finally { setGuardando(false); }
    }

    /** Respaldo que no depende del servidor: la respuesta en CSV. */
    function descargar() {
        if (!d) return;
        const filas = d.avisos.map((a) => [
            a.id, marcados.has(a.id) ? 'DESTACAR' : '', a.tipo, a.operacion,
            a.colonia ?? '', a.precio, a.comisionPct ?? '', a.demanda, a.competencia,
            a.tierNombre, a.tags.join(' | '), a.falta,
        ]);
        const csv = [['ID', 'Respuesta', 'Tipo', 'Operación', 'Colonia', 'Precio', '% comisión',
                      'Buscando', 'Competencia', 'Tier hoy', 'Etiquetas', 'Qué le falta'],
                     ...filas]
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `avisos-${d.inmobiliaria.replace(/\s+/g, '-')}.csv`;
        a.click();
    }

    const kams = useMemo(
        () => [...new Set(lista.map((l) => l.kam))].filter(Boolean).sort(), [lista]);
    const visibles = useMemo(
        () => (kam ? lista.filter((l) => l.kam === kam) : lista), [lista, kam]);

    // por ETIQUETA: un aviso con dos problemas aparece en los dos filtros
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
        if (t) f = f.filter((a) =>
            a.id.toLowerCase().includes(t) || (a.colonia ?? '').toLowerCase().includes(t)
            || a.broker.toLowerCase().includes(t));
        return f;
    }, [d, filtro, q]);

    return (
        <div className="mx-auto max-w-[1180px] px-7 py-9">
            <header>
                <p className="text-[11px] font-bold uppercase tracking-[1.5px] text-brand-yellow">
                    Pulppo · inmuebles24
                </p>
                <div className="my-[9px] h-0.5 w-[52px] bg-brand-yellow" />
                <h1 className="text-[32px]">Qué destacar</h1>
                <p className="mt-1 text-xs text-brand-gray">
                    Datos en vivo desde Mongo. La primera consulta del día arma el mercado y tarda
                    unos segundos; las siguientes son inmediatas.
                </p>
            </header>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
                <select value={kam} onChange={(e) => setKam(e.target.value)}
                    className="rounded-[2px] border border-neutral-300 px-3 py-2 text-sm">
                    <option value="">Todos los KAM</option>
                    {kams.map((k) => (
                        <option key={k} value={k}>
                            {k} ({lista.filter((l) => l.kam === k).length})
                        </option>
                    ))}
                </select>
                <select value={inmo} onChange={(e) => abrir(e.target.value)}
                    className="min-w-[280px] rounded-[2px] border border-neutral-300 px-3 py-2 text-sm">
                    <option value="">Elige una inmobiliaria…</option>
                    {visibles.map((l) => (
                        <option key={l.inmobiliaria} value={l.inmobiliaria}>
                            {l.inmobiliaria} ({l.venta} de venta · {l.destacados} destacados)
                        </option>
                    ))}
                </select>
                {inmo && (
                    <button onClick={() => abrir(inmo)}
                        className="rounded-[2px] border border-neutral-300 px-3 py-2 text-xs hover:bg-light">
                        Recalcular
                    </button>
                )}
            </div>

            {cargando === 'lista' && <Aviso texto="Cargando el índice de inmobiliarias…" />}
            {cargando === 'inmo' && (
                <Aviso texto={`Calculando ${inmo} en vivo — demanda, competencia y precio contra su colonia…`} />
            )}
            {error && (
                <div className="mt-6 rounded-[2px] border-l-[3px] border-brand-red bg-light p-4 text-sm">
                    <b>No se pudo calcular.</b> {error}
                </div>
            )}

            {d && !cargando && (
                <>
                    {/* ── el cuadre: por qué el total no es igual al de la tabla ── */}
                    <section className="mt-7 rounded-[2px] border border-neutral-200 bg-white p-5">
                        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-3">
                            <Dato n={String(d.ventaViva)} l="avisos de venta" />
                            <Dato n={String(d.destacados)} l="destacados hoy" />
                            <Dato n={money(d.gastoMes)} l="al mes en portal" />
                            <Dato n={String(porTag['destacar']?.length ?? 0)} l="listos para destacar" />
                            <Dato n={money(d.comisionArreglable)} l="comisión de lo arreglable" />
                        </div>
                        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                            De sus <b>{d.ventaViva} avisos de venta</b>, la tabla analiza{' '}
                            <b>{d.analizados}</b>
                            {d.terrenosVenta > 0 && <> · {d.terrenosVenta} son terreno y no compiten por lugares</>}
                            {d.gratis > 0 && <> · {d.gratis} no nos cuestan nada (gratis o apagados en i24)</>}
                            . KAM {d.kam} · {d.leadsAno.toLocaleString('es-MX')} leads en 12 meses ·
                            calculado en {(d.ms / 1000).toFixed(1)} s.
                        </p>
                    </section>

                    {/* ── lo que tiene contratado ── */}
                    <Bloque titulo="Lo que tiene contratado hoy">
                        <table className="w-full text-[12.5px]">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-[9.5px] uppercase tracking-wider text-brand-gray">
                                    <th className="py-2">Tipo de aviso</th>
                                    <th className="py-2 text-right">Avisos</th>
                                    <th className="py-2 text-right">De venta</th>
                                    <th className="py-2 text-right">Costo al mes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {d.tiers.map((t) => (
                                    <tr key={t.tier} className="border-b border-neutral-100">
                                        <td className="py-1.5">{t.tier}</td>
                                        <td className="py-1.5 text-right tabular-nums">{t.n}</td>
                                        <td className="py-1.5 text-right tabular-nums">{t.venta}</td>
                                        <td className="py-1.5 text-right tabular-nums">{money(t.costo)}</td>
                                    </tr>
                                ))}
                                <tr className="font-bold">
                                    <td className="py-2">Total</td>
                                    <td className="py-2 text-right tabular-nums">{d.inventarioTotal}</td>
                                    <td className="py-2 text-right tabular-nums">{d.ventaViva}</td>
                                    <td className="py-2 text-right tabular-nums">{money(d.gastoMes)}</td>
                                </tr>
                            </tbody>
                        </table>
                        <p className="mt-3 text-[11px] leading-relaxed text-brand-gray">
                            Precios de lista: Simple $15 · Destacado $315 · Destacado ZD $420 ·
                            Súper Destacado $523 · Súper Destacado ZD $785. Los <b>apagados en i24</b> y
                            los <b>gratis</b> cuestan $0 — son el 27% de los avisos de la red y cobrarlos
                            a $15 infla el gasto.
                        </p>
                    </Bloque>

                    {/* ── la tabla con la respuesta de la inmobiliaria ── */}
                    <Bloque titulo="Su inventario, aviso por aviso">
                        <div className="flex flex-wrap items-center gap-2">
                            <Pill on={!filtro} onClick={() => setFiltro(null)}>
                                Todos ({d.avisos.length})
                            </Pill>
                            {ORDEN.filter((k) => porTag[k]?.length).map((k) => (
                                <Pill key={k} on={filtro === k} onClick={() => setFiltro(k)}>
                                    {k} ({porTag[k].length})
                                </Pill>
                            ))}
                            <input value={q} onChange={(e) => setQ(e.target.value)}
                                placeholder="Buscar por ID, colonia o asesor…"
                                className="ml-auto min-w-[220px] rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs" />
                        </div>

                        <p className="mt-3 rounded-[2px] border-l-[3px] border-sea bg-light p-3 text-xs leading-relaxed">
                            Están <b>todos</b> los avisos, ninguno se filtró. Un aviso puede traer
                            varias etiquetas — puede estar caro <i>y</i> sin video. Las de{' '}
                            <b>renta</b>, <b>terreno</b> y <b>comercial</b> no compiten por un lugar
                            destacado: por eso no se pueden marcar.
                        </p>

                        {/* ── barra de respuesta, pegada arriba de la tabla ── */}
                        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-[2px] border border-neutral-200 bg-white p-3">
                            <span className="font-serif text-[22px] leading-none">{marcados.size}</span>
                            <span className="text-xs text-brand-gray">
                                marcados para destacar
                                {marcados.size > 0 && (
                                    <> · {money([...marcados].length * 508)}/mes extra si todos suben a Súper Destacado</>
                                )}
                            </span>
                            <input value={nota} onChange={(e) => { setNota(e.target.value); setSucio(true); }}
                                placeholder="Nota (opcional): por qué esta selección…"
                                className="min-w-[220px] flex-1 rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs" />
                            <button onClick={descargar}
                                className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs hover:bg-light">
                                Descargar CSV
                            </button>
                            <button onClick={guardar} disabled={guardando || efimero}
                                className="rounded-[2px] bg-brand-yellow px-4 py-1.5 text-xs font-bold text-soft disabled:opacity-40">
                                {guardando ? 'Guardando…' : 'Guardar'}
                            </button>
                        </div>
                        {efimero && (
                            <p className="mt-2 rounded-[2px] border-l-[3px] border-brand-red bg-light p-3 text-xs">
                                <b>El guardado está apagado en este ambiente.</b> Falta crear el Blob
                                del proyecto en Vercel (Storage → Create → Blob). Mientras tanto usa
                                <b> Descargar CSV</b>, que sí conserva la respuesta.
                            </p>
                        )}
                        {guardado && !sucio && (
                            <p className="mt-2 text-xs text-sea">{guardado}</p>
                        )}
                        {sucio && (
                            <p className="mt-2 text-xs text-[#8a6a00]">Hay cambios sin guardar.</p>
                        )}

                        <div className="mt-3 max-h-[620px] overflow-auto rounded-[2px] border border-neutral-200">
                            <table className="w-full text-[12px]">
                                <thead className="sticky top-0 bg-white">
                                    <tr className="border-b border-neutral-200 text-left text-[9.5px] uppercase tracking-wider text-brand-gray">
                                        <th className="px-2 py-2">Destacar</th>
                                        {['ID', 'Asesor', 'Colonia', 'Tipo', 'Precio', '% com',
                                          'Buscando', 'Compet.', 'Puntaje', 'Tier hoy',
                                          'Etiquetas', 'Qué le falta'].map((h) => (
                                            <th key={h} className="whitespace-nowrap px-2 py-2">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filas.map((a) => (
                                        <tr key={a.id}
                                            className={`border-b border-neutral-100 ${
                                                marcados.has(a.id) ? 'bg-[#F6BE00]/10' : 'hover:bg-light'}`}>
                                            <td className="px-2 py-1.5 text-center">
                                                <input type="checkbox" checked={marcados.has(a.id)}
                                                    disabled={!a.destacable}
                                                    onChange={() => marcar(a.id)}
                                                    title={a.destacable ? 'Marcar para destacar'
                                                        : 'Renta, terreno o comercial: no compite por lugar destacado'}
                                                    className="h-4 w-4 accent-[#F6BE00] disabled:opacity-25" />
                                            </td>
                                            <td className="px-2 py-1.5 font-bold">{a.id}</td>
                                            <td className="px-2 py-1.5">{a.broker}</td>
                                            <td className="px-2 py-1.5">{a.colonia ?? '—'}</td>
                                            <td className="px-2 py-1.5">{a.tipo}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{money(a.precio)}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{a.comisionPct ?? '—'}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{a.demanda}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{a.competencia}</td>
                                            <td className="px-2 py-1.5 text-right font-bold tabular-nums">{a.puntos}</td>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{a.tierNombre}</td>
                                            <td className="px-2 py-1.5">
                                                <span className="flex flex-wrap gap-1">
                                                    {a.tags.map((t) => (
                                                        <span key={t}
                                                            className={`whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold ${COLOR_TAG(t)}`}>
                                                            {t}
                                                        </span>
                                                    ))}
                                                </span>
                                            </td>
                                            <td className="px-2 py-1.5 text-neutral-500">{a.falta}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-3 text-[11px] text-brand-gray">
                            {filas.length} de {d.avisos.length} avisos · el puntaje ordena su
                            inventario (70 potencial×regalía + 15 comisión + 15 calidad de la cuenta)
                            y el percentil se calcula <b>dentro de la cuenta</b>, así que no compara
                            entre inmobiliarias.
                        </p>
                    </Bloque>
                </>
            )}
        </div>
    );
}

function Aviso({ texto }: { texto: string }) {
    return (
        <div className="mt-6 rounded-[2px] border-l-[3px] border-brand-yellow bg-light p-4 text-sm">
            {texto}
        </div>
    );
}
function Dato({ n, l }: { n: string; l: string }) {
    return (
        <div>
            <div className="font-serif text-[27px] leading-none">{n}</div>
            <div className="mt-1.5 text-[9.5px] uppercase tracking-wider text-brand-gray">{l}</div>
        </div>
    );
}
function Pill({ on, onClick, children }:
    { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                on ? 'border-brand-yellow bg-brand-yellow text-soft'
                   : 'border-neutral-200 bg-white hover:bg-light'}`}>
            {children}
        </button>
    );
}
function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <section className="mt-8">
            <p className="text-[10px] font-bold uppercase tracking-[1.2px]">{titulo}</p>
            <div className="my-2 h-px w-[50px] bg-brand-yellow" />
            {children}
        </section>
    );
}
