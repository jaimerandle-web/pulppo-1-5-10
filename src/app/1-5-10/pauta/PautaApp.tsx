'use client';

// Pauta de Meta para las exclusivas 1·5·10. Para quien monta las campañas: por cluster
// (zona × rango de precio), cada propiedad con su inmobiliaria, artes en 4 tamaños, cortes de
// video de Drive, copies, segmentación y la liga con UTM. Las inmobiliarias suspendidas y lo que
// no es vivienda salen aparte, con el motivo, para que nadie les invierta por error.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FORMATOS, precioLargo, urlArte } from '@/lib/pauta/armado';
import type { PautaProp } from '@/lib/pauta';
import type { Excluida } from '@/lib/pauta/excluidas';

interface Payload {
    props: PautaProp[];
    excluidas: Excluida[];
    corteHistorial: string;
    corteVideos: string;
    carpetaVideos: string;
}

const thumb = (raw: string | null) =>
    raw && /^https?:\/\/images\.pulppo\.com\//i.test(raw)
        ? `https://pulppo.com/_next/image?url=${encodeURIComponent(raw)}&w=640&q=70`
        : raw || '';

function Copiar({ texto, label = 'Copiar' }: { texto: string; label?: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1200); }}
            className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        >
            {ok ? 'Copiado' : label}
        </button>
    );
}

function Paquete({ p }: { p: PautaProp }) {
    const s = p.seg;
    const segTexto = [
        `Ubicación: ${s.ubicacion}`, `Edad: ${s.edad}`, `Intereses: ${s.intereses.join(', ')}`,
        `Público: ${s.publico}`, `Objetivo: ${s.objetivo}`, `Presupuesto: ${s.presupuesto}`, `Ubicaciones: ${s.ubicaciones}`
    ].join('\n');
    return (
        <div className="mt-4 grid gap-6 border-t border-neutral-200 pt-4 lg:grid-cols-2">
            <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Artes</h4>
                <div className="grid grid-cols-4 items-end gap-2">
                    {FORMATOS.map((f) => (
                        <a key={f.id} href={urlArte(p.code, f.id, true)} className="group block" title={`${f.nombre} · ${f.uso}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={urlArte(p.code, f.id)} alt={f.nombre} loading="lazy" className="w-full border border-neutral-200 bg-light" />
                            <span className="mt-1 block text-[11px] text-neutral-600 group-hover:underline">{f.nombre} ↓</span>
                        </a>
                    ))}
                </div>

                <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-500">Video</h4>
                {p.videos.length ? (
                    <ul className="space-y-1 text-sm">
                        {p.videos.map((v) => (
                            <li key={v.formato}><a href={v.url} target="_blank" rel="noreferrer" className="underline">Corte {v.formato.replace('x', ':')} en Drive</a></li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-neutral-600">
                        Sin corte en Drive. {p.youtube ? <>Hay recorrido en <a href={p.youtube} target="_blank" rel="noreferrer" className="underline">YouTube</a>, pero Meta no lo acepta: hay que pedir el .mp4 a multimedia.</> : 'Sale sólo con artes.'}
                    </p>
                )}

                <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-500">Campaña y liga</h4>
                <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2"><code className="break-all text-xs">{p.campana}</code><Copiar texto={p.campana} /></div>
                    <div className="flex items-start gap-2"><code className="break-all text-xs text-neutral-600">{p.urlUtm}</code><Copiar texto={p.urlUtm} /></div>
                    <p className="text-xs text-neutral-500">El nombre de la campaña va igual en el utm_campaign: así el lead llega al CRM ligado a esta campaña.</p>
                </div>
            </div>

            <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Textos principales (creativo dinámico)</h4>
                <ul className="space-y-2">
                    {p.copies.textos.map((t) => (
                        <li key={t.angulo} className="flex items-start gap-2 rounded bg-light p-2 text-sm">
                            <div className="flex-1"><span className="mr-1 text-[11px] font-bold uppercase text-neutral-500">{t.angulo}</span>{t.texto}</div>
                            <Copiar texto={t.texto} />
                        </li>
                    ))}
                </ul>
                <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-neutral-500">Títulos · descripción · botón</h4>
                <ul className="space-y-1 text-sm">
                    {p.copies.titulos.map((t) => <li key={t} className="flex items-center gap-2"><span className="flex-1">{t}</span><Copiar texto={t} /></li>)}
                    <li className="flex items-center gap-2 text-neutral-600"><span className="flex-1">{p.copies.descripcion}</span><Copiar texto={p.copies.descripcion} /></li>
                    <li className="text-neutral-600">Botón: {p.copies.cta}</li>
                </ul>

                <div className="mb-2 mt-4 flex items-center gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Segmentación</h4>
                    <Copiar texto={segTexto} label="Copiar todo" />
                </div>
                <dl className="space-y-1 text-sm">
                    <div><dt className="inline font-semibold">Ubicación: </dt><dd className="inline">{s.ubicacion}</dd></div>
                    <div><dt className="inline font-semibold">Edad: </dt><dd className="inline">{s.edad}</dd></div>
                    <div><dt className="inline font-semibold">Intereses: </dt><dd className="inline">{s.intereses.join(', ')}</dd></div>
                    <div><dt className="inline font-semibold">Público: </dt><dd className="inline">{s.publico}</dd></div>
                    <div><dt className="inline font-semibold">Objetivo: </dt><dd className="inline">{s.objetivo}</dd></div>
                    <div><dt className="inline font-semibold">Presupuesto: </dt><dd className="inline">{s.presupuesto}</dd></div>
                </dl>
            </div>
        </div>
    );
}

function Tarjeta({ p }: { p: PautaProp }) {
    const [abierta, setAbierta] = useState(false);
    const datos = [
        p.rec ? `${p.rec} rec` : null, p.banos ? `${p.banos} baños` : null,
        p.m2 ? `${Math.round(p.m2)} m²` : null, p.park ? `${p.park} est.` : null
    ].filter(Boolean).join(' · ');
    const h = p.historial;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(p.foto)} alt="" loading="lazy" className="h-24 w-32 shrink-0 bg-light object-cover" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                        <a href={p.url} target="_blank" rel="noreferrer" className="font-bold hover:underline">{p.code}</a>
                        <span className="text-sm font-semibold">{p.inmobiliaria}</span>
                        <span className="text-sm text-neutral-500">{p.tipo} · {p.colonia}{p.ciudad ? `, ${p.ciudad}` : ''}</span>
                    </div>
                    <div className="mt-1 font-serif text-xl">{precioLargo(p.precio)}</div>
                    <div className="text-sm text-neutral-600">{datos}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-neutral-500">
                        <span>{p.videos.length ? `Video en Drive (${p.videos.length} cortes)` : 'Sin video en Drive'}</span>
                        {h ? <span>Ya pautada: ${h.gasto.toLocaleString('es-MX')} · {h.leads} leads · {h.visitas} visitas{h.leads ? ` · $${Math.round(h.gasto / h.leads)}/lead` : ''}</span> : <span>Nunca pautada en Meta</span>}
                    </div>
                    {p.avisos.length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-l-2 border-brand-yellow pl-2 text-xs text-neutral-700">
                            {p.avisos.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                    )}
                </div>
                <button type="button" onClick={() => setAbierta(!abierta)}
                    className="h-fit shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
                    {abierta ? 'Cerrar' : 'Ver paquete'}
                </button>
            </div>
            {abierta && <Paquete p={p} />}
        </div>
    );
}

export default function PautaApp() {
    const router = useRouter();
    const [d, setD] = useState<Payload | null>(null);
    const [error, setError] = useState('');
    const [cluster, setCluster] = useState('');
    const [inmo, setInmo] = useState('');
    const [soloVideo, setSoloVideo] = useState(false);

    useEffect(() => {
        fetch('/api/pauta')
            .then(async (r) => {
                if (r.status === 401) { router.push('/login'); return; }
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || 'Error');
                setD(j);
            })
            .catch((e) => setError(e.message));
    }, [router]);

    const pautables = useMemo(() => (d?.props || []).filter((p) => !p.excluida), [d]);
    const fuera = useMemo(() => (d?.props || []).filter((p) => p.excluida), [d]);
    const filtradas = pautables.filter((p) =>
        (!cluster || p.cluster === cluster) && (!inmo || p.inmobiliaria === inmo) && (!soloVideo || p.videos.length));
    const grupos = useMemo(() => {
        const m = new Map<string, PautaProp[]>();
        for (const p of filtradas) m.set(p.cluster, [...(m.get(p.cluster) || []), p]);
        return [...m.entries()];
    }, [filtradas]);
    const clusters = [...new Set(pautables.map((p) => p.cluster))];
    const inmos = [...new Set(pautables.map((p) => p.inmobiliaria))].sort((a, b) => a.localeCompare(b, 'es'));
    const fueraPorMotivo = useMemo(() => {
        const m = new Map<string, PautaProp[]>();
        for (const p of fuera) {
            const k = p.excluida!.motivo.includes('vivienda') ? 'No es vivienda: la pauta B2C es sólo casa y departamento' : `${p.inmobiliaria} · ${p.excluida!.motivo}`;
            m.set(k, [...(m.get(k) || []), p]);
        }
        return [...m.entries()];
    }, [fuera]);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-serif text-3xl">Pauta de Meta · Exclusivas 1·5·10</h1>
                    <p className="text-sm text-neutral-600">Paquete por propiedad para montar las campañas: artes, video, copies, segmentación y liga con UTM.</p>
                </div>
                <div className="flex gap-2 text-sm">
                    <a href="/1-5-10" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">← 1·5·10</a>
                    <a href="/api/pauta?format=csv" className="rounded-lg bg-soft px-3 py-1.5 text-white hover:opacity-90">Descargar todo (CSV)</a>
                </div>
            </div>

            {error && <p className="text-brand-red">{error}</p>}
            {!d && !error && <p className="text-neutral-500">Cargando las exclusivas…</p>}

            {d && (
                <>
                    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            ['Activas en el programa', d.props.length],
                            ['Se pueden pautar', pautables.length],
                            ['Fuera de pauta', fuera.length],
                            ['Con video en Drive', pautables.filter((p) => p.videos.length).length]
                        ].map(([l, v]) => (
                            <div key={l} className="rounded-lg bg-light p-3">
                                <div className="text-xs text-neutral-600">{l}</div>
                                <div className="font-serif text-2xl">{v}</div>
                            </div>
                        ))}
                    </div>

                    {fuera.length > 0 && (
                        <details className="mb-6 rounded-lg border border-neutral-200 p-4">
                            <summary className="cursor-pointer text-sm font-semibold">Fuera de pauta ({fuera.length}) — no invertir</summary>
                            <div className="mt-3 space-y-3 text-sm">
                                {fueraPorMotivo.map(([motivo, ps]) => (
                                    <div key={motivo}>
                                        <div className="font-semibold">{motivo} ({ps.length})</div>
                                        <div className="text-neutral-600">{ps.map((p) => `${p.code} (${p.inmobiliaria}, ${p.colonia || p.ciudad})`).join(' · ')}</div>
                                    </div>
                                ))}
                                <p className="text-xs text-neutral-500">La lista de inmobiliarias suspendidas está en <code>src/lib/pauta/excluidas.ts</code>.</p>
                            </div>
                        </details>
                    )}

                    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                        <select value={cluster} onChange={(e) => setCluster(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5">
                            <option value="">Todos los clusters</option>
                            {clusters.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <select value={inmo} onChange={(e) => setInmo(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5">
                            <option value="">Todas las inmobiliarias</option>
                            {inmos.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={soloVideo} onChange={(e) => setSoloVideo(e.target.checked)} /> Sólo con video
                        </label>
                        <span className="text-neutral-500">{filtradas.length} propiedades</span>
                    </div>

                    <div className="space-y-8">
                        {grupos.map(([c, ps]) => (
                            <section key={c}>
                                <h2 className="mb-2 font-serif text-2xl">{c} <span className="text-base text-neutral-500">· {ps.length}</span></h2>
                                <div className="space-y-3">{ps.map((p) => <Tarjeta key={p.code} p={p} />)}</div>
                            </section>
                        ))}
                    </div>

                    <p className="mt-8 text-xs text-neutral-500">
                        Historial de Meta al {d.corteHistorial} (gasto en Meta y leads/visitas en el CRM). Cortes de video al {d.corteVideos}, de la{' '}
                        <a href={d.carpetaVideos} target="_blank" rel="noreferrer" className="underline">carpeta de multimedia</a>. Foto del arte = la portada de la propiedad.
                    </p>
                </>
            )}
        </main>
    );
}
