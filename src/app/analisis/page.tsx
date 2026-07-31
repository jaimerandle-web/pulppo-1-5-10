'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Combobox, Dropdown, Select } from '@/components/inputs';
import type { AnalisisData } from '@/lib/analisis';

/* ------------------------------------------------------------------ *
 * /analisis — "Análisis general" (configurador del reporte ampliado)
 * Inventario + Precio×calidad ya leen datos reales (/api/analisis).
 * YoY / Top 10 / destacados / funnel: pendientes de portar.
 * ------------------------------------------------------------------ */

const SEA = '#529999', SEA_D = '#2f6b6b', SOFT = '#212322', YEL = '#F6BE00', GRAY = '#B7B7B7', RED = '#A52003';
const f0 = (n: number) => Math.round(n).toLocaleString('es-MX');
const money = (n?: number | null) =>
    n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
const fmtYoy = (v: number, fmt: string) =>
    fmt === 'money' ? money(v) : fmt === 'pct' ? `${Math.round(v * 100)}%` : fmt === 'pct2' ? `${(v * 100).toFixed(2)}%` : fmt === 'dec' ? v.toFixed(1) : f0(v);

// Secciones del documento (el "hasta qué sí / qué no incluir").
const SECCIONES = [
    { id: 'inventario', label: 'Inventario: dónde y cómo', needs: null },
    { id: 'precio', label: 'Precio × calidad + leads', needs: null },
    { id: 'destacados', label: 'Cómo se ha destacado', needs: 'destacados' },
    { id: 'funnel', label: 'Funnel comercial', needs: null },
    { id: 'yoy', label: 'Año vs año (YoY)', needs: null },
    { id: 'top10', label: 'Top 10 críticas', needs: null },
    { id: 'reco', label: 'Recomendaciones', needs: null },
    { id: 'glosario', label: '¿Cómo leer esta información? (glosario)', needs: null },
] as const;

// ---- primitivas de UI, en el look de la app ----
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-[2px] border border-neutral-200 bg-white p-4">
            {/* título de sección en gris (jerarquía), lo que se elige va en soft black */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</p>
            {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
            <div className="mt-3">{children}</div>
        </section>
    );
}

// Etiqueta de cada control (lo que el usuario elige) → soft black.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: SOFT }}>{label}</p>
            {children}
            {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
        </div>
    );
}

function Chips({ options, value, onChange, multi = true }: {
    options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean;
}) {
    const toggle = (o: string) => {
        if (!multi) return onChange([o]);
        onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
    };
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => {
                const on = value.includes(o);
                return (
                    <button key={o} onClick={() => toggle(o)}
                        className={`rounded-[2px] border px-3 py-1.5 text-xs transition-colors ${on
                            ? 'border-transparent bg-[#212322] text-white'
                            : 'border-neutral-300 bg-white text-[#212322] hover:bg-neutral-50'}`}>
                        {o}
                    </button>
                );
            })}
        </div>
    );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <button onClick={() => onChange(!on)} className="flex items-center gap-2.5 text-sm text-[#212322]">
            <span className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-[3px] transition-colors ${on ? 'bg-[#529999]' : 'bg-neutral-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-[2px] bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            <span>{label}</span>
        </button>
    );
}

type Row = { kam?: string; inmobiliaria?: string | null };

export default function AnalisisGeneral() {
    const router = useRouter();
    const [allInmos, setAllInmos] = useState<string[]>([]);
    const [kams, setKams] = useState<string[]>(['(todos)']);
    const [kamByInmo, setKamByInmo] = useState<Record<string, string>>({});

    // ---- estado de la configuración ----
    const [kam, setKam] = useState('(todos)');
    const [inmo, setInmo] = useState('(todas)');
    const [operacion, setOperacion] = useState('Ambas');
    const [ventCierres, setVentCierres] = useState('Últimos 24 meses');
    const [ventDemanda, setVentDemanda] = useState('Últimos 12 meses');
    const [ventLeads, setVentLeads] = useState('YTD 2026');
    const [zombie, setZombie] = useState('Últimos 90 días');
    const [referencias, setReferencias] = useState<string[]>(['ACM (valor estimado)', 'Oferta de zona', 'Cierres reales', 'Qué te alcanza por el mismo precio']);
    const [destacados, setDestacados] = useState(false);
    const [secciones, setSecciones] = useState<string[]>(
        SECCIONES.filter((s) => s.id !== 'destacados').map((s) => s.id)
    );
    const [cortes, setCortes] = useState<string[]>(['Por zona', 'Por tipo', 'Por ticket', 'Por operación']);
    const [portalMode, setPortalMode] = useState('Todas las fuentes');
    const [portales, setPortales] = useState<string[]>(['Inmuebles24', 'MercadoLibre', 'EasyBroker']);
    const [recoEnfoque, setRecoEnfoque] = useState<string[]>(['Precio', 'Ficha', 'Diversificar canales']);
    const [recoTono, setRecoTono] = useState('Directivo');
    const [recoCantidad, setRecoCantidad] = useState('Top 6');
    const [audiencia, setAudiencia] = useState('KAM (interno)');
    const [benchmark, setBenchmark] = useState('vs promedio de mercado');
    const [mlsGeneral, setMlsGeneral] = useState(false);

    // Poblar inmobiliarias: TODAS las compañías con inventario (/api/companies).
    // KAM y el mapa inmobiliaria→KAM salen de /api/data (solo cubre 1·5·10; es filtro opcional).
    useEffect(() => {
        (async () => {
            try {
                const r = await fetch('/api/companies');
                if (r.status === 401) { router.push('/login'); return; }
                const d = await r.json();
                if (Array.isArray(d.companies)) setAllInmos(d.companies);
            } catch { /* mock */ }
            try {
                const r2 = await fetch('/api/data');
                if (r2.ok) {
                    const d2 = await r2.json();
                    const rows: Row[] = d2.rows || [];
                    setKams(['(todos)', ...Array.from(new Set(rows.map((r) => r.kam).filter(Boolean) as string[])).sort()]);
                    const m: Record<string, string> = {};
                    rows.forEach((r) => { if (r.inmobiliaria && r.kam) m[r.inmobiliaria] = r.kam; });
                    setKamByInmo(m);
                }
            } catch { /* mock */ }
        })();
    }, [router]);

    const inmosFiltrados = useMemo(
        () => (kam === '(todos)' ? allInmos : allInmos.filter((i) => kamByInmo[i] === kam)),
        [allInmos, kam, kamByInmo]
    );

    // Cuando se apaga destacados, quitar esa sección del checklist.
    useEffect(() => {
        if (!destacados) setSecciones((s) => s.filter((x) => x !== 'destacados'));
    }, [destacados]);

    const seccionesElegidas = SECCIONES.filter((s) => secciones.includes(s.id) && (!s.needs || destacados));

    const [data, setData] = useState<AnalisisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function generar() {
        if (inmo === '(todas)') { setError('Elige una inmobiliaria.'); return; }
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/analisis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inmo, operacion, ventDemanda, ventLeads, mlsGeneral }),
            });
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error generando el análisis');
            setData(d as AnalisisData);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error generando el análisis');
        } finally { setLoading(false); }
    }
    // La config cambió → el preview actual queda obsoleto.
    useEffect(() => { setData(null); }, [inmo, operacion, ventDemanda, ventLeads, mlsGeneral]);

    return (
        <div className="mx-auto max-w-[1400px] px-5 py-6">
            {/* print: aislar solo la hoja de preview */}
            <style>{`@media print { body * { visibility: hidden !important; } #preview-sheet, #preview-sheet * { visibility: visible !important; } #preview-sheet { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; } }`}</style>

            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <div>
                        <h1 className="text-3xl sm:text-4xl">Análisis general</h1>
                        <p className="text-xs text-neutral-500">Configura y genera el reporte ampliado por inmobiliaria</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                    <span className="rounded-[2px] bg-[#F6BE00]/20 px-2.5 py-1 font-semibold text-[#8a6d00]">Vista previa · datos de ejemplo</span>
                    <a href="/" className="rounded-[2px] border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">← Inicio</a>
                </div>
            </header>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
                {/* ---------------- CONFIGURADOR ---------------- */}
                <div className="flex flex-col gap-4">
                    <Card title="1 · Inmobiliaria" hint={`${allInmos.length || '—'} inmobiliarias con inventario publicado`}>
                        <div className="flex flex-col gap-3">
                            <Field label="KAM (filtro opcional)">
                                <Dropdown value={kam} options={kams} onChange={(v) => { setKam(v); setInmo('(todas)'); }} />
                            </Field>
                            <Field label="Inmobiliaria">
                                <Combobox value={inmo} allLabel="(todas)" options={inmosFiltrados} placeholder="Buscar inmobiliaria…" onChange={setInmo} />
                            </Field>
                        </div>
                    </Card>

                    <Card title="Alcance de datos" hint="Análisis sobre propiedades publicadas hoy.">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Operación">
                                <Chips multi={false} options={['Ambas', 'Venta', 'Renta']} value={[operacion]} onChange={(v) => setOperacion(v[0])} />
                            </Field>
                            <Field label="Cortes de segmentación"
                                hint="Quita “Por operación” para no comparar venta vs. renta; quita “Por ticket” para no hablar de rangos de precio.">
                                <Chips options={['Por zona', 'Por tipo', 'Por ticket', 'Por operación']} value={cortes} onChange={setCortes} />
                            </Field>
                        </div>
                    </Card>

                    <Card title="2 · Rangos de comparables (fechas)">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Comparables de cierres">
                                <Select value={ventCierres} onChange={setVentCierres} options={['Últimos 12 meses', 'Últimos 24 meses', 'Últimos 36 meses']} />
                            </Field>
                            <Field label="Demanda de zona (búsquedas)">
                                <Select value={ventDemanda} onChange={setVentDemanda} options={['Últimos 6 meses', 'Últimos 12 meses', 'YTD 2026']} />
                            </Field>
                            <Field label="Desempeño de leads (inventario)"
                                hint="Ventana de los leads por propiedad (zonas, matriz, Top 10). Alíneala con la demanda para leer las dos comparables.">
                                <Select value={ventLeads} onChange={setVentLeads} options={['Últimos 30 días', 'Últimos 90 días', 'Últimos 6 meses', 'YTD 2026', 'Últimos 12 meses']} />
                            </Field>
                            <Field label="Zombie · sin leads en">
                                <Select value={zombie} onChange={setZombie} options={['Últimos 30 días', 'Últimos 90 días', 'Últimos 6 meses', 'Totales']} />
                            </Field>
                        </div>
                    </Card>

                    <Card title="Referencias de precio">
                        <div className="flex flex-col gap-3">
                            <Field label="Referencias a mostrar">
                                <Chips options={['ACM (valor estimado)', 'Oferta de zona', 'Cierres reales', 'Qué te alcanza por el mismo precio']}
                                    value={referencias} onChange={setReferencias} />
                            </Field>
                            <label className="flex items-start gap-2.5 text-[11px] leading-relaxed text-[#212322]">
                                <input type="checkbox" checked={mlsGeneral} onChange={() => setMlsGeneral((v) => !v)} className="mt-0.5 h-3.5 w-3.5 accent-[#529999]" />
                                <span>Incluir también el <b>MLS general</b> en la oferta de zona (más cobertura, pero más sucio: pcom, inventario ya vendido sin limpiar).</span>
                            </label>
                            <div className="rounded-[2px] bg-[#F3F3F3] px-3 py-2.5 text-[11px] leading-relaxed" style={{ color: SOFT }}>
                                El estado de precio lo trae el <b>ACM</b> (óptimo / no competitivo / fuera de mercado). Regla fija:
                                <b> arriba de +15% sobre ACM = red flag</b>. No es configurable.
                            </div>
                        </div>
                    </Card>

                    <Card title="3 · Secciones a incluir" hint="Marca qué páginas entran al documento.">
                        <div className="flex flex-col gap-2.5">
                            <div className="pb-1"><Toggle on={destacados} onChange={setDestacados} label="Incluir capa de destacados (ampliado vs. desempeño)" /></div>
                            {SECCIONES.map((s) => {
                                const locked = !!s.needs && !destacados;
                                const on = secciones.includes(s.id) && !locked;
                                return (
                                    <label key={s.id} className={`flex items-center gap-2.5 text-sm text-[#212322] ${locked ? 'opacity-40' : 'cursor-pointer'}`}>
                                        <input type="checkbox" disabled={locked} checked={on}
                                            onChange={() => setSecciones((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                                            className="h-4 w-4 accent-[#529999]" />
                                        <span>{s.label}{locked && <span className="ml-1 text-[10px] text-neutral-400">(requiere destacados)</span>}</span>
                                    </label>
                                );
                            })}
                            <div className="mt-2">
                                <Field label="Leads por fuente (“qué mueve tus leads”)">
                                    <Chips multi={false} options={['Todas las fuentes', 'Fuentes principales', 'Análisis general (sin desglose)']}
                                        value={[portalMode]} onChange={(v) => setPortalMode(v[0])} />
                                </Field>
                                {portalMode === 'Fuentes principales' && (
                                    <div className="mt-2.5">
                                        <Chips options={['Inmuebles24', 'MercadoLibre', 'EasyBroker', 'Pulppo', 'Otros']} value={portales} onChange={setPortales} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    <Card title="4 · Recomendaciones">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Enfoque">
                                <Chips options={['Precio', 'Ficha', 'Diversificar canales', 'Visibilidad']} value={recoEnfoque} onChange={setRecoEnfoque} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Tono">
                                    <Select value={recoTono} onChange={setRecoTono} options={['Directivo', 'Sugerente']} />
                                </Field>
                                <Field label="Cantidad">
                                    <Select value={recoCantidad} onChange={setRecoCantidad} options={['Top 3', 'Top 6', 'Top 10']} />
                                </Field>
                            </div>
                            <div className="rounded-[2px] bg-[#F3F3F3] px-3 py-2.5 text-[11px] leading-relaxed" style={{ color: SOFT }}>
                                Regla fija: <b>nunca recomienda priorizar renta sobre venta</b> (venta siempre prioriza por rendimiento).
                                Los cortes de segmentación describen el inventario, <b>no</b> generan recomendaciones de mix.
                            </div>
                        </div>
                    </Card>

                    <Card title="Presentación">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Audiencia / tono del documento">
                                <Select value={audiencia} onChange={setAudiencia} options={['KAM (interno)', 'Inmobiliaria (cliente)']} />
                            </Field>
                            <Field label="Benchmark"
                                hint="“Promedio de mercado” = mix del MLS de Inmuebles24 (oferta publicada) + cierres reales de todas las inmobiliarias, por colonia/ticket. “Mejores inmobiliarias” = referencia contra las de mejor desempeño (sin exponer su nivel).">
                                <Select value={benchmark} onChange={setBenchmark} options={['Ninguno', 'vs promedio de mercado', 'vs mejores inmobiliarias']} />
                            </Field>
                        </div>
                    </Card>
                </div>

                {/* ---------------- PREVIEW ---------------- */}
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm text-neutral-500">{seccionesElegidas.length} secciones · {inmo === '(todas)' ? 'sin inmobiliaria' : (data?.company || inmo)}</p>
                        <div className="flex items-center gap-2">
                            {error && <span className="text-xs" style={{ color: RED }}>{error}</span>}
                            <button onClick={() => window.print()} disabled={!data} className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40">PDF</button>
                            <button onClick={generar} disabled={loading} className="rounded-[2px] bg-[#212322] px-4 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">{loading ? 'Generando…' : 'Generar'}</button>
                        </div>
                    </div>

                    <div id="preview-sheet" className="mx-auto max-w-[8.5in] rounded-[2px] border border-neutral-200 bg-white p-10">
                        <p className="text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: SOFT }}>
                            Análisis de inventario · {audiencia === 'KAM (interno)' ? 'Uso interno KAM' : 'Para la inmobiliaria'}
                        </p>
                        <div className="my-2.5 h-px w-16" style={{ background: YEL }} />
                        <h2 className="text-[26px] leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                            {data?.company || (inmo === '(todas)' ? 'Nombre de la inmobiliaria' : inmo)}
                        </h2>
                        <p className="mt-1 text-xs" style={{ color: GRAY }}>
                            {operacion} · publicadas hoy · demanda {ventDemanda.toLowerCase()}
                            {benchmark !== 'Ninguno' && ` · ${benchmark}`}
                        </p>

                        <div className="mt-5 flex gap-2">
                            {(data
                                ? [[String(data.N), 'propiedades publicadas', `${data.opSplit.sale} venta · ${data.opSplit.rent} renta`],
                                   [`${Math.round(data.pctCaro * 100)}%`, 'de tu venta, fuera de mercado', `${data.nCaro} props +20% sobre ACM`],
                                   [data.llProp.toFixed(1), 'leads únicos / propiedad', data.leadsLabel],
                                   [String(data.joyas), 'listas para vender', `${data.joyasAlta} con calidad Alta`]]
                                : [['—', 'propiedades', ''], ['—', 'sobre mercado', ''], ['—', 'leads / prop', ''], ['—', 'listas para vender', '']]
                            ).map(([n, l, cmp], idx) => (
                                <div key={idx} className="flex-1 bg-[#F3F3F3] p-3">
                                    <p className="text-[26px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: idx === 1 && data && data.pctCaro > 0.4 ? RED : SOFT }}>{n}</p>
                                    <p className="mt-1.5 text-[9px] leading-tight text-neutral-500">{l}</p>
                                    {cmp && <p className="text-[8px] leading-tight" style={{ color: GRAY }}>{cmp}</p>}
                                </div>
                            ))}
                        </div>

                        {!data && !loading && (
                            <p className="mt-6 rounded-[2px] bg-[#F6BE00]/15 px-3 py-2.5 text-[11px]" style={{ color: SOFT }}>
                                Elige una inmobiliaria y presiona <b>Generar</b> para traer los datos en vivo de Mongo.
                            </p>
                        )}

                        <div className="mt-6 space-y-4">
                            {seccionesElegidas.map((s, i) => (
                                <div key={s.id} className="border-b border-neutral-100 pb-4">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[13px]" style={{ fontFamily: 'var(--font-serif)', color: SEA }}>{String(i + 1).padStart(2, '0')}</span>
                                        <h3 className="text-[15px]" style={{ fontFamily: 'var(--font-serif)' }}>{s.label}</h3>
                                    </div>
                                    {data && s.id === 'inventario' ? <InventarioView d={data} />
                                        : data && s.id === 'precio' ? <PrecioView d={data} />
                                        : data && s.id === 'destacados' ? <DestacadosView d={data} />
                                        : data && s.id === 'funnel' ? <FunnelView d={data} />
                                        : data && s.id === 'yoy' ? <YoyView d={data} />
                                        : data && s.id === 'top10' ? <Top10View d={data} />
                                        : data && s.id === 'reco' ? <RecoView d={data} enfoque={recoEnfoque} tono={recoTono} cantidad={recoCantidad} />
                                        : <p className="mt-1 pl-6 text-[11px] leading-relaxed text-neutral-500">
                                            {previewLine(s.id, { referencias, cortes, portalMode, portales, recoEnfoque, recoTono, recoCantidad })}
                                          </p>}
                                </div>
                            ))}
                            {!seccionesElegidas.length && <p className="py-10 text-center text-sm text-neutral-400">Elige al menos una sección.</p>}
                        </div>

                        <p className="mt-6 border-t border-neutral-100 pt-3 text-[9px] text-neutral-400">
                            {data
                                ? `Datos en vivo de Mongo · corte ${new Date(data.corte).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · demanda = búsquedas de compradores en tus zonas (${ventDemanda.toLowerCase()}).`
                                : 'Inventario y Precio×calidad ya leen datos reales; el resto de secciones se conectan por fases.'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Línea descriptiva por sección, reflejando la configuración elegida.
function previewLine(id: string, c: {
    referencias: string[]; cortes: string[]; portalMode: string; portales: string[];
    recoEnfoque: string[]; recoTono: string; recoCantidad: string;
}): string {
    const fuentes = c.portalMode === 'Fuentes principales'
        ? c.portales.join(', ') || 'sin fuentes'
        : c.portalMode === 'Análisis general (sin desglose)' ? 'sin desglose por fuente' : 'todas las fuentes';
    switch (id) {
        case 'inventario': return `Distribución del inventario ${c.cortes.map((x) => x.toLowerCase()).join(', ') || '(sin cortes)'}, contra la demanda de cada zona.`;
        case 'precio': return `Matriz precio × calidad × leads usando ${c.referencias.join(', ') || 'referencias de precio'}. Estado de precio del ACM.`;
        case 'destacados': return 'Cómo se ha destacado el inventario y el lift de leads (L/L con vs. sin destacado).';
        case 'funnel': return `Embudo lead → visita → cierre; leads por fuente: ${fuentes}.`;
        case 'yoy': return 'Comparación año contra año (2025 vs 2026) de inventario, leads y comisión.';
        case 'top10': return 'Propiedades con alta demanda y pocos leads, con la palanca accionable de cada una.';
        case 'reco': return `${c.recoCantidad} recomendaciones (${c.recoEnfoque.join(', ').toLowerCase() || 'sin enfoque'}), tono ${c.recoTono.toLowerCase()}.`;
        case 'glosario': return 'Señales de precio y glosario de términos para leer el reporte.';
        default: return '';
    }
}

// ---------- render de secciones con datos reales ----------
const CAL_COL: Record<string, string> = { Alta: '#2f6b6b', Media: '#9CC4C4', Baja: '#E0CFC0' };

function InventarioView({ d }: { d: AnalisisData }) {
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Tus zonas principales: cuánto inventario tienes, la oferta total de la zona y qué tan competitivo es tu precio.</p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['Colonia', 'Tus props', 'Oferta zona', 'Precio vs. zona', 'Demanda', `Leads · ${d.leadsLabel}`].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {d.zones.map((z) => (
                        <tr key={z.nb} className="border-b border-neutral-100">
                            <td className="py-1 font-semibold">{z.nb}</td>
                            <td className="py-1 text-right">{z.n}</td>
                            <td className="py-1 text-right" style={{ color: GRAY }}>{f0(z.oferta)}</td>
                            <td className="py-1 text-right font-semibold" style={{ color: z.vsZona == null ? GRAY : z.vsZona > 3 ? RED : z.vsZona < -3 ? SEA : SOFT }}>
                                {z.vsZona == null ? '—' : `${z.vsZona > 0 ? '+' : ''}${z.vsZona}%`}
                            </td>
                            <td className="py-1 text-right">{f0(z.dem)}</td>
                            <td className="py-1 text-right">{f0(z.leads)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>
                Oferta zona = propiedades publicadas en esa colonia ({d.ofertaLabel}). Precio vs. zona = tu $/m² mediano vs. la mediana de la zona (<b style={{ color: RED }}>+</b> más caro · <b style={{ color: SEA }}>−</b> más barato).
            </p>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>
                Tu inventario en venta vs. la demanda del mercado, por rango de precio.
                <span style={{ color: GRAY }}> Barra <b style={{ color: SEA }}>azul</b> = tu inventario · <b style={{ color: '#b8901a' }}>amarilla</b> = lo que busca la gente.</span>
            </p>
            {d.invVsDemand.map((r) => (
                <div key={r.band} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="w-12" style={{ color: GRAY }}>{r.band}</span>
                    <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(r.invPct)}%`, background: SEA }} /></span>
                    <span className="w-14 text-right font-bold">{Math.round(r.invPct)}% inv.</span>
                    <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(r.demPct)}%`, background: YEL }} /></span>
                    <span className="w-14 text-right font-bold">{Math.round(r.demPct)}% dem.</span>
                </div>
            ))}
            {d.insightInv && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.insightInv}</p>}
        </div>
    );
}

function PrecioView({ d }: { d: AnalisisData }) {
    const cellBg = (q: string, p: string) =>
        (q === 'Alta' || q === 'Media') && p === 'Óptimo' ? '#DCEBEB' : q === 'Baja' && p === 'Fuera de mercado' ? '#F4DED8' : '#F3F3F3';
    const cols = ['Óptimo', 'No competitivo', 'Fuera de mercado', 'Sin referencia'];
    const mx = Math.max(...d.priceLead.map((x) => x.ll), 0.0001);
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                Solo inventario en <b>venta</b> ({d.nSale} props), por precio vs. mercado (ACM) y calidad de ficha. En cada celda: # de propiedades y su <b>L/L</b> (leads por propiedad).
            </p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr>
                        <th></th>
                        {cols.map((p) => <th key={p} className="pb-1 text-right text-[8px] font-bold uppercase tracking-wide">{p}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {d.matrix.map((row) => (
                        <tr key={row.q}>
                            <td className="py-1 pr-2 text-[11px] font-bold">
                                <span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: CAL_COL[row.q] }} />{row.q}
                            </td>
                            {row.cells.map((c) => (
                                <td key={c.p} className="border-2 border-white p-1.5 text-center align-middle" style={{ background: cellBg(row.q, c.p) }}>
                                    <span className="text-[13px] font-bold">{c.n}</span>
                                    {c.p === 'Sin referencia'
                                        ? <span className="block text-[8px]" style={{ color: '#CFCFCF' }}>—</span>
                                        : <span className="block text-[8px]" style={{ color: GRAY }}>{c.ll.toFixed(1)} L/L</span>}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>
                Taxonomía del ACM: óptimo (≤+5%) · no competitivo (+5% a +20%) · fuera de mercado (&gt;+20%). Sin referencia = sin ACM confiable (sin estimación o ACM atípico); su L/L no se muestra porque no es comparable.
            </p>
            <div className="mt-3 flex gap-2">
                {[[String(d.joyas), 'listas para destacar', SEA, `precio óptimo · ${d.joyasAlta} calidad Alta`],
                  [String(d.caras), 'fuera de mercado', RED, 'ajustar precio antes de invertir'],
                  [`${Math.round(d.pctCaro * 100)}%`, 'de tu venta fuera de mercado', SOFT, 'freno principal de conversión']].map(([n, l, col, sub], i) => (
                    <div key={i} className="flex-1 bg-[#F9F9F9] p-2.5">
                        <p className="text-[20px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{n}</p>
                        <p className="mt-1 text-[9px] leading-tight">{l}</p>
                        <p className="text-[8px] leading-tight" style={{ color: GRAY }}>{sub}</p>
                    </div>
                ))}
            </div>
            <p className="mb-1 mt-4 text-[11px] font-semibold" style={{ color: SOFT }}>Leads por precio de la propiedad.</p>
            {d.priceLead.map((r) => (
                <div key={r.cls} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="w-28 font-bold">{r.cls}</span>
                    <span className="h-[12px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * r.ll / mx)}%`, background: SEA }} /></span>
                    <span className="w-24 text-right font-bold">{r.ll.toFixed(1)} <span style={{ color: GRAY }}>L/L · {r.props} props</span></span>
                </div>
            ))}
            {d.insightPrecio && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.insightPrecio}</p>}
        </div>
    );
}

function FunnelView({ d }: { d: AnalisisData }) {
    const mx = Math.max(...d.funnel.flatMap((c) => c.steps.map((s) => s.value)), 1);
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>Actividad 2026 sobre tu inventario. La tasa es el % que pasa del paso anterior. <span style={{ color: GRAY }}>Únicos = sin duplicados (los incontactables van en la composición).</span></p>
            <div className="flex gap-6">
                {d.funnel.map((col) => (
                    <div key={col.title} className="flex-1">
                        <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#2f6b6b' }}>{col.title}</p>
                        {col.steps.map((s) => (
                            <div key={s.label} className="flex items-center gap-1.5 py-0.5 text-[10px]">
                                <span className="w-16 whitespace-nowrap" style={{ color: GRAY }}>{s.label}</span>
                                <span className="w-8 text-right text-[9px] font-bold" style={{ color: SEA }}>{s.rate == null ? '' : `${Math.round(s.rate * 100)}%`}</span>
                                <span className="h-[13px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * s.value / mx)}%`, background: '#2f6b6b' }} /></span>
                                <span className="w-10 text-right font-bold">{f0(s.value)}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Composición de tus leads únicos 2026</p>
            <div className="flex gap-2">
                {[['Cliente', d.leadsComp.cliente, SEA_D], ['Broker', d.leadsComp.broker, GRAY], ['Sin contacto', d.leadsComp.incontactables, RED],
                  ['Venta', d.leadsComp.totalOp.sale, SEA], ['Renta', d.leadsComp.totalOp.rent, '#9CC4C4']].map(([l, n, col]) => (
                    <div key={l as string} className="flex-1 bg-[#F3F3F3] p-2">
                        <p className="text-[16px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{f0(n as number)}</p>
                        <p className="mt-1 text-[8px] leading-tight text-neutral-500">{l as string}</p>
                    </div>
                ))}
            </div>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>Broker = el contacto está asociado a una empresa/inmobiliaria (no comprador final). Sin contacto = sin teléfono ni correo.</p>
            {(() => {
                const tot = d.leadsComp.total || 1;
                const gross = tot + d.leadsComp.duplicados || 1;
                const brPct = Math.round(100 * d.leadsComp.broker / tot);
                const dupPct = Math.round(100 * d.leadsComp.duplicados / gross);
                return (
                    <p className="mt-2 text-[11px] leading-relaxed" style={{ color: SOFT }}>
                        <b>{brPct}%</b> de tus leads únicos son de <b>brokers</b> (no compradores finales) · se quitaron <b>{f0(d.leadsComp.duplicados)}</b> duplicados ({dupPct}% del bruto: mismo contacto en la misma propiedad).
                    </p>
                );
            })()}
            {d.funnelReading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.funnelReading}</p>}
        </div>
    );
}

function RecoView({ d, enfoque, tono, cantidad }: { d: AnalisisData; enfoque: string[]; tono: string; cantidad: string }) {
    let pool = enfoque.length ? d.recos.filter((r) => enfoque.includes(r.enfoque)) : d.recos;
    if (!pool.length) pool = d.recos;
    const n = cantidad === 'Top 3' ? 3 : cantidad === 'Top 6' ? 6 : 10;
    const list = [...pool].sort((a, b) => b.sev - a.sev).slice(0, n);
    // Tono: sugerente suaviza el imperativo del título.
    const soften = (t: string) => tono === 'Sugerente' ? `Considera ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t;
    return (
        <div className="mt-2 pl-6">
            {list.map((r, i) => (
                <div key={i} className="flex gap-3 border-b border-neutral-100 py-2.5">
                    <span className="text-[22px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: SEA, width: 26, flexShrink: 0 }}>{i + 1}</span>
                    <div>
                        <p className="text-[12px] font-bold">{soften(r.title)} <span className="ml-1 text-[8px] uppercase tracking-wide" style={{ color: GRAY }}>· {r.enfoque}</span></p>
                        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: SOFT }}>{r.body}</p>
                    </div>
                </div>
            ))}
            {!list.length && <p className="py-4 text-[11px]" style={{ color: GRAY }}>Sin recomendaciones para el enfoque elegido.</p>}
        </div>
    );
}

const TIER_COL: Record<string, string> = { 'Súper destacado': SEA_D, 'Destacado': SEA, 'Simple': '#CFCFCF', 'Offline': '#EDEDED' };

function DestacadosView({ d }: { d: AnalisisData }) {
    const de = d.destacados;
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                {de.pctDest < 0.05 ? 'Hoy prácticamente nada de tu inventario está destacado' : `Hoy ${Math.round(de.pctDest * 100)}% de tu inventario está destacado`}. <span style={{ color: GRAY }}>El aviso destacado lo cubre Pulppo.</span>
            </p>
            <div className="flex gap-2">
                {[['Súper destacados', de.sdNow, SEA_D, de.splits.sd], ['Destacados', de.dNow, SEA, de.splits.d], ['Aviso simple', de.simpleNow, GRAY, de.splits.simple]].map(([l, n, col, sp]) => {
                    const s = sp as { sale: number; rent: number };
                    return (
                        <div key={l as string} className="flex-1 bg-[#F3F3F3] p-2.5">
                            <p className="text-[22px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{f0(n as number)}</p>
                            <p className="mt-1 text-[9px] leading-tight">{l as string} hoy</p>
                            <p className="text-[8px] leading-tight" style={{ color: GRAY }}>{s.sale} venta · {s.rent} renta</p>
                        </div>
                    );
                })}
            </div>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Cómo se ha destacado, mes a mes <span style={{ color: GRAY }}>(nivel del aviso al cierre de cada mes)</span></p>
            <div className="mb-1.5 flex flex-wrap gap-3 text-[9px]" style={{ color: GRAY }}>
                {['Súper destacado', 'Destacado', 'Simple'].map((t) => (
                    <span key={t}><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: TIER_COL[t] }} />{t}</span>
                ))}
            </div>
            {de.monthly.map((mo) => {
                const tot = mo.tiers.reduce((a, t) => a + t.n, 0) || 1;
                return (
                    <div key={mo.month} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-8" style={{ color: GRAY }}>{mo.month}</span>
                        <span className="flex h-[12px] flex-1 overflow-hidden bg-[#F3F3F3]">
                            {mo.tiers.filter((t) => t.n > 0).map((t) => (
                                <span key={t.tier} className="block h-full" style={{ width: `${100 * t.n / tot}%`, background: TIER_COL[t.tier] }} />
                            ))}
                        </span>
                        <span className="w-14 text-right font-bold">{mo.dest} dest.</span>
                    </div>
                );
            })}
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Qué tanto rinde destacar — venta vs. renta <span style={{ color: GRAY }}>(L/L = leads por aviso al mes)</span></p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['Nivel de aviso', 'L/L Venta', 'L/L Renta'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {de.llTier.map((r) => (
                        <tr key={r.tier} className="border-b border-neutral-100">
                            <td className="py-1"><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: TIER_COL[r.tier] }} />{r.tier}</td>
                            <td className="py-1 text-right">{r.saleLL == null ? '—' : r.saleLL.toFixed(1)} <span style={{ color: GRAY }}>· {r.saleLeads} leads</span></td>
                            <td className="py-1 text-right">{r.rentLL == null ? '—' : r.rentLL.toFixed(1)} <span style={{ color: GRAY }}>· {r.rentLeads} leads</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>Nivel reconstruido del historial de cada aviso; leads (únicos) atribuidos al nivel que tenía el aviso cuando llegó el contacto. L/L = leads ÷ aviso-meses en ese nivel (— si &lt;3 aviso-meses).</p>
            {de.reading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{de.reading}</p>}
        </div>
    );
}

function YoyView({ d }: { d: AnalisisData }) {
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Enero–junio 2025 vs. enero–junio 2026.</p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['Métrica', '2025', '2026', 'Variación'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {d.yoy.map((r) => {
                        const dv = r.a ? (r.b - r.a) / r.a : 0;
                        const col = (dv >= 0) === r.goodUp ? SEA : RED;
                        return (
                            <tr key={r.label} className="border-b border-neutral-100">
                                <td className="py-1">{r.label}</td>
                                <td className="py-1 text-right">{fmtYoy(r.a, r.fmt)}</td>
                                <td className="py-1 text-right">{fmtYoy(r.b, r.fmt)}</td>
                                <td className="py-1 text-right font-semibold" style={{ color: col }}>{dv >= 0 ? '▲' : '▼'} {dv >= 0 ? '+' : ''}{Math.round(dv * 100)}%</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Mix de cierres <span style={{ color: GRAY }}>(<b style={{ color: SEA_D }}>venta</b> · <b style={{ color: SEA }}>renta</b>)</span></p>
            {d.yoyMix.map((m) => {
                const tot = m.sale + m.rent || 1;
                return (
                    <div key={m.year} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-8" style={{ color: GRAY }}>{m.year}</span>
                        <span className="flex h-[12px] flex-1 overflow-hidden bg-[#F3F3F3]">
                            <span className="block h-full" style={{ width: `${100 * m.sale / tot}%`, background: SEA_D }} />
                            <span className="block h-full" style={{ width: `${100 * m.rent / tot}%`, background: SEA }} />
                        </span>
                        <span className="w-28 text-right font-bold">{m.sale} venta · {m.rent} renta</span>
                    </div>
                );
            })}
            {d.yoyReading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.yoyReading}</p>}
        </div>
    );
}

function Top10View({ d }: { d: AnalisisData }) {
    if (!d.top10.length) return <p className="mt-2 pl-6 text-[11px]" style={{ color: GRAY }}>Sin propiedades críticas con palanca accionable en zonas con demanda.</p>;
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Alta demanda en su zona pero pocos o cero leads, con un freno claro y fácil de arreglar. Prioriza estas.</p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['#', 'Código', 'Zona', 'Precio', 'vs. mercado', 'Leads', 'Demanda', 'Qué cambiar'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i === 1 || i === 2 || i === 7 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {d.top10.map((t, i) => (
                        <tr key={i} className="border-b border-neutral-100">
                            <td className="py-1 text-right">{i + 1}</td>
                            <td className="py-1 font-semibold">{t.code}</td>
                            <td className="py-1">{t.nb}</td>
                            <td className="py-1 text-right">{money(t.val)}</td>
                            <td className="py-1 text-right" style={{ color: t.sp && t.sp > 1.2 ? RED : SOFT }}>{t.sp ? `+${Math.round((t.sp - 1) * 100)}%` : '—'}</td>
                            <td className="py-1 text-right">{t.leads}</td>
                            <td className="py-1 text-right">{f0(t.dz)}</td>
                            <td className="py-1">{t.lev.map((l, j) => {
                                const col = l.startsWith('Bajar') ? RED : l.startsWith('Destacar') ? SEA : SOFT;
                                return <span key={l} style={{ color: col, fontWeight: 700 }}>{j ? ' · ' : ''}{l}</span>;
                            })}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-2 text-[9px]" style={{ color: GRAY }}>Demanda = búsquedas de la colonia en la ventana elegida. Vs. mercado = precio ÷ ACM.</p>
        </div>
    );
}
