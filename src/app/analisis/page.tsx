'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DataPayload } from '@/types';
import { Combobox, Dropdown, Select } from '@/components/inputs';

/* ------------------------------------------------------------------ *
 * /analisis — "Análisis general" (configurador del reporte ampliado)
 * Mock: todos los selectores funcionan y el preview refleja la config.
 * Aún NO conecta el motor de datos (gen_reporte_plus.py → endpoint TS).
 * ------------------------------------------------------------------ */

const SEA = '#529999', RED = '#A52003', SOFT = '#212322', YEL = '#F6BE00', GRAY = '#B7B7B7';

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
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</p>
            {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
            <div className="mt-3">{children}</div>
        </section>
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
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${on
                            ? 'border-transparent bg-[#212322] text-white'
                            : 'border-neutral-300 bg-white hover:bg-neutral-50'}`}>
                        {o}
                    </button>
                );
            })}
        </div>
    );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <button onClick={() => onChange(!on)} className="flex items-center gap-2.5 text-sm">
            <span className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-[#529999]' : 'bg-neutral-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            <span>{label}</span>
        </button>
    );
}

export default function AnalisisGeneral() {
    const router = useRouter();
    const [inmos, setInmos] = useState<string[]>([]);
    const [kams, setKams] = useState<string[]>([]);

    // ---- estado de la configuración ----
    const [kam, setKam] = useState('(todos)');
    const [inmo, setInmo] = useState('(todas)');
    const [operacion, setOperacion] = useState('Ambas');
    const [universo, setUniverso] = useState('Solo publicadas hoy');
    const [ventCierres, setVentCierres] = useState('Últimos 24 meses');
    const [ventDemanda, setVentDemanda] = useState('Últimos 12 meses');
    const [referencias, setReferencias] = useState<string[]>(['ACM (valor estimado)', 'Oferta de zona', 'Cierres reales']);
    const [taxonomia, setTaxonomia] = useState('Ale · óptimo / no competitivo / fuera de mercado');
    const [umbralCaro, setUmbralCaro] = useState('+20% (recomendado)');
    const [destacados, setDestacados] = useState(false);
    const [zombieAncla, setZombieAncla] = useState('2026-06-01');
    const [secciones, setSecciones] = useState<string[]>(
        SECCIONES.filter((s) => s.id !== 'destacados').map((s) => s.id)
    );
    const [cortes, setCortes] = useState<string[]>(['Por zona', 'Por tipo', 'Por ticket']);
    const [portales, setPortales] = useState<string[]>(['Inmuebles24', 'MercadoLibre', 'EasyBroker']);
    const [recoEnfoque, setRecoEnfoque] = useState<string[]>(['Precio', 'Ficha', 'Diversificar canales']);
    const [recoTono, setRecoTono] = useState('Directivo');
    const [recoCantidad, setRecoCantidad] = useState('Top 6');
    const [audiencia, setAudiencia] = useState('KAM (interno)');
    const [benchmark, setBenchmark] = useState('vs promedio de mercado');

    // Poblar inmobiliaria/KAM desde el mismo endpoint del home.
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/data');
                if (res.status === 401) { router.push('/login'); return; }
                const d: DataPayload = await res.json();
                const rows = d.rows || [];
                setKams(['(todos)', ...Array.from(new Set(rows.map((r) => r.kam).filter(Boolean))).sort()]);
                setInmos(Array.from(new Set(rows.map((r) => r.inmobiliaria).filter(Boolean) as string[])).sort());
            } catch { /* mock: si falla, los combos quedan vacíos */ }
        })();
    }, [router]);

    const inmosFiltrados = useMemo(() => inmos, [inmos]); // (si luego quieres filtrar por KAM, aquí)

    // Cuando se apaga destacados, quitar esa sección del checklist.
    useEffect(() => {
        if (!destacados) setSecciones((s) => s.filter((x) => x !== 'destacados'));
    }, [destacados]);

    const seccionesElegidas = SECCIONES.filter((s) => secciones.includes(s.id) && (!s.needs || destacados));

    function generar() {
        // MOCK — aquí irá el fetch a /api/analisis con toda la config.
        alert('Preview mock. Conectar /api/analisis (puerto de gen_reporte_plus.py) para datos reales.');
    }

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
                    <span className="rounded-full bg-[#F6BE00]/20 px-2.5 py-1 font-semibold text-[#8a6d00]">Vista previa · datos de ejemplo</span>
                    <a href="/" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">← Inicio</a>
                </div>
            </header>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
                {/* ---------------- CONFIGURADOR ---------------- */}
                <div className="flex flex-col gap-4">
                    <Card title="1 · Inmobiliaria">
                        <div className="flex flex-col gap-3">
                            <Dropdown label="KAM" value={kam} options={kams.length ? kams : ['(todos)']}
                                onChange={(v) => { setKam(v); setInmo('(todas)'); }} />
                            <Combobox label="Inmobiliaria" value={inmo} allLabel="(todas)"
                                options={inmosFiltrados} placeholder="Buscar inmobiliaria…" onChange={setInmo} />
                        </div>
                    </Card>

                    <Card title="Alcance de datos">
                        <div className="flex flex-col gap-3.5">
                            <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Operación</p>
                                <Chips multi={false} options={['Ambas', 'Venta', 'Renta']} value={[operacion]} onChange={(v) => setOperacion(v[0])} />
                            </div>
                            <Select label="Universo de propiedades" value={universo} onChange={setUniverso}
                                options={['Solo publicadas hoy', 'Incluir vendidas y dadas de baja']} />
                            <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Cortes de segmentación</p>
                                <Chips options={['Por zona', 'Por tipo', 'Por ticket', 'Por operación']} value={cortes} onChange={setCortes} />
                            </div>
                        </div>
                    </Card>

                    <Card title="2 · Rangos de comparables (fechas)">
                        <div className="flex flex-col gap-3">
                            <Select label="Comparables de cierres" value={ventCierres} onChange={setVentCierres}
                                options={['Últimos 12 meses', 'Últimos 24 meses', 'Últimos 36 meses']} />
                            <Select label="Demanda de zona (búsquedas)" value={ventDemanda} onChange={setVentDemanda}
                                options={['Últimos 6 meses', 'Últimos 12 meses', 'YTD 2026']} />
                            <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Zombie · sin leads desde</p>
                                <input type="date" value={zombieAncla} onChange={(e) => setZombieAncla(e.target.value)}
                                    className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 px-3.5 text-sm shadow-sm focus:border-[#F6BE00] focus:outline-none focus:ring-2 focus:ring-[#F6BE00]/20" />
                            </div>
                        </div>
                    </Card>

                    <Card title="Referencias y reglas de precio">
                        <div className="flex flex-col gap-3.5">
                            <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Referencias a mostrar</p>
                                <Chips options={['ACM (valor estimado)', 'Oferta de zona', 'Cierres reales']} value={referencias} onChange={setReferencias} />
                            </div>
                            <Select label="Taxonomía de precio" value={taxonomia} onChange={setTaxonomia}
                                options={['Ale · óptimo / no competitivo / fuera de mercado', 'Competitivo / en línea / caro']} />
                            <Select label="Umbral de “caro”" value={umbralCaro} onChange={setUmbralCaro}
                                options={['+15%', '+20% (recomendado)', '+25%']} />
                        </div>
                    </Card>

                    <Card title="3 · Secciones a incluir" hint="Marca qué páginas entran al documento.">
                        <div className="flex flex-col gap-2.5">
                            <div className="pb-1"><Toggle on={destacados} onChange={setDestacados} label="Incluir capa de destacados (ampliado vs. desempeño)" /></div>
                            {SECCIONES.map((s) => {
                                const locked = !!s.needs && !destacados;
                                const on = secciones.includes(s.id) && !locked;
                                return (
                                    <label key={s.id} className={`flex items-center gap-2.5 text-sm ${locked ? 'opacity-40' : 'cursor-pointer'}`}>
                                        <input type="checkbox" disabled={locked} checked={on}
                                            onChange={() => setSecciones((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                                            className="h-4 w-4 accent-[#529999]" />
                                        <span>{s.label}{locked && <span className="ml-1 text-[10px] text-neutral-400">(requiere destacados)</span>}</span>
                                    </label>
                                );
                            })}
                            <div className="mt-1">
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Portales en “qué mueve tus leads”</p>
                                <Chips options={['Inmuebles24', 'MercadoLibre', 'EasyBroker', 'Otros']} value={portales} onChange={setPortales} />
                            </div>
                        </div>
                    </Card>

                    <Card title="4 · Recomendaciones">
                        <div className="flex flex-col gap-3.5">
                            <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Enfoque</p>
                                <Chips options={['Precio', 'Ficha', 'Diversificar canales', 'Visibilidad']} value={recoEnfoque} onChange={setRecoEnfoque} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Select label="Tono" value={recoTono} onChange={setRecoTono} options={['Directivo', 'Sugerente']} />
                                <Select label="Cantidad" value={recoCantidad} onChange={setRecoCantidad} options={['Top 3', 'Top 6', 'Todas']} />
                            </div>
                        </div>
                    </Card>

                    <Card title="Presentación">
                        <div className="grid grid-cols-1 gap-3">
                            <Select label="Audiencia / tono del documento" value={audiencia} onChange={setAudiencia}
                                options={['KAM (interno)', 'Inmobiliaria (cliente)']} />
                            <Select label="Benchmark" value={benchmark} onChange={setBenchmark}
                                options={['Ninguno', 'vs promedio de mercado', 'vs su tier']} />
                        </div>
                    </Card>
                </div>

                {/* ---------------- PREVIEW ---------------- */}
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm text-neutral-500">{seccionesElegidas.length} secciones · {inmo === '(todas)' ? 'sin inmobiliaria' : inmo}</p>
                        <div className="flex gap-2">
                            <button onClick={() => window.print()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">🖨️ PDF</button>
                            <button onClick={generar} className="rounded-lg bg-[#212322] px-4 py-1.5 text-sm font-semibold text-white hover:bg-black">Generar</button>
                        </div>
                    </div>

                    <div id="preview-sheet" className="mx-auto max-w-[8.5in] rounded-lg border border-neutral-200 bg-white p-10 shadow-sm">
                        {/* encabezado del documento (on-brand) */}
                        <p className="text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: SOFT }}>
                            Análisis de inventario · {audiencia === 'KAM (interno)' ? 'Uso interno KAM' : 'Para la inmobiliaria'}
                        </p>
                        <div className="my-2.5 h-px w-16" style={{ background: YEL }} />
                        <h2 className="text-[26px] leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                            {inmo === '(todas)' ? 'Nombre de la inmobiliaria' : inmo}
                        </h2>
                        <p className="mt-1 text-xs" style={{ color: GRAY }}>
                            {operacion} · {universo.toLowerCase()} · cierres {ventCierres.toLowerCase()} · demanda {ventDemanda.toLowerCase()}
                            {benchmark !== 'Ninguno' && ` · ${benchmark}`}
                        </p>

                        {/* fila de stats de ejemplo */}
                        <div className="mt-5 flex gap-2">
                            {[['114', 'propiedades'], ['53%', 'sobre mercado'], ['0.8', 'leads / prop'], ['23', 'listas para vender']].map(([n, l]) => (
                                <div key={l} className="flex-1 bg-[#F3F3F3] p-3">
                                    <p className="text-[26px] leading-none" style={{ fontFamily: 'var(--font-serif)' }}>{n}</p>
                                    <p className="mt-1.5 text-[9px] leading-tight text-neutral-500">{l}</p>
                                </div>
                            ))}
                        </div>

                        {/* índice de secciones elegidas */}
                        <div className="mt-6 space-y-3">
                            {seccionesElegidas.map((s, i) => (
                                <div key={s.id} className="border-b border-neutral-100 pb-3">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[13px]" style={{ fontFamily: 'var(--font-serif)', color: SEA }}>{String(i + 1).padStart(2, '0')}</span>
                                        <h3 className="text-[15px]" style={{ fontFamily: 'var(--font-serif)' }}>{s.label}</h3>
                                    </div>
                                    <p className="mt-1 pl-6 text-[11px] leading-relaxed text-neutral-500">
                                        {previewLine(s.id, { referencias, taxonomia, cortes, portales, recoEnfoque, recoTono, recoCantidad })}
                                    </p>
                                </div>
                            ))}
                            {!seccionesElegidas.length && <p className="py-10 text-center text-sm text-neutral-400">Elige al menos una sección.</p>}
                        </div>

                        <p className="mt-6 border-t border-neutral-100 pt-3 text-[9px] text-neutral-400">
                            Vista previa con datos de ejemplo · el generador conectará a Mongo al aprobar el diseño · corte de datos: julio 2026.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Línea descriptiva por sección, reflejando la configuración elegida.
function previewLine(id: string, c: {
    referencias: string[]; taxonomia: string; cortes: string[]; portales: string[];
    recoEnfoque: string[]; recoTono: string; recoCantidad: string;
}): string {
    switch (id) {
        case 'inventario': return `Distribución del inventario ${c.cortes.map((x) => x.toLowerCase()).join(', ')}, contra la demanda de cada zona.`;
        case 'precio': return `Matriz precio × calidad × leads usando ${c.referencias.join(', ') || 'referencias de precio'}. Taxonomía: ${c.taxonomia.split('·')[0].trim().toLowerCase()}.`;
        case 'destacados': return 'Cómo se ha destacado el inventario y el lift de leads (L/L con vs. sin destacado).';
        case 'funnel': return 'Embudo lead → visita → cierre por tipo de operación, con recap mensual.';
        case 'yoy': return 'Comparación año contra año (2025 vs 2026) de inventario, leads y comisión.';
        case 'top10': return 'Propiedades con alta demanda y pocos leads, con la palanca accionable de cada una.';
        case 'reco': return `${c.recoCantidad} recomendaciones (${c.recoEnfoque.join(', ').toLowerCase() || 'sin enfoque'}), tono ${c.recoTono.toLowerCase()}.`;
        case 'glosario': return 'Señales de precio y glosario de términos para leer el reporte.';
        default: return '';
    }
}
