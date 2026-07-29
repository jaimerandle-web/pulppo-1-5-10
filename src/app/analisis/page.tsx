'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Combobox, Dropdown, Select } from '@/components/inputs';

/* ------------------------------------------------------------------ *
 * /analisis — "Análisis general" (configurador del reporte ampliado)
 * Mock: todos los selectores funcionan y el preview refleja la config.
 * Aún NO conecta el motor de datos (gen_reporte_plus.py → endpoint TS).
 * ------------------------------------------------------------------ */

const SEA = '#529999', SOFT = '#212322', YEL = '#F6BE00', GRAY = '#B7B7B7';

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

    function generar() {
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
                        <p className="text-sm text-neutral-500">{seccionesElegidas.length} secciones · {inmo === '(todas)' ? 'sin inmobiliaria' : inmo}</p>
                        <div className="flex gap-2">
                            <button onClick={() => window.print()} className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">PDF</button>
                            <button onClick={generar} className="rounded-[2px] bg-[#212322] px-4 py-1.5 text-sm font-semibold text-white hover:bg-black">Generar</button>
                        </div>
                    </div>

                    <div id="preview-sheet" className="mx-auto max-w-[8.5in] rounded-[2px] border border-neutral-200 bg-white p-10">
                        <p className="text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: SOFT }}>
                            Análisis de inventario · {audiencia === 'KAM (interno)' ? 'Uso interno KAM' : 'Para la inmobiliaria'}
                        </p>
                        <div className="my-2.5 h-px w-16" style={{ background: YEL }} />
                        <h2 className="text-[26px] leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                            {inmo === '(todas)' ? 'Nombre de la inmobiliaria' : inmo}
                        </h2>
                        <p className="mt-1 text-xs" style={{ color: GRAY }}>
                            {operacion} · publicadas hoy · cierres {ventCierres.toLowerCase()} · demanda {ventDemanda.toLowerCase()} · zombie {zombie.toLowerCase()}
                            {benchmark !== 'Ninguno' && ` · ${benchmark}`}
                        </p>

                        <div className="mt-5 flex gap-2">
                            {[['114', 'propiedades'], ['53%', 'sobre mercado'], ['0.8', 'leads / prop'], ['23', 'listas para vender']].map(([n, l]) => (
                                <div key={l} className="flex-1 bg-[#F3F3F3] p-3">
                                    <p className="text-[26px] leading-none" style={{ fontFamily: 'var(--font-serif)' }}>{n}</p>
                                    <p className="mt-1.5 text-[9px] leading-tight text-neutral-500">{l}</p>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 space-y-3">
                            {seccionesElegidas.map((s, i) => (
                                <div key={s.id} className="border-b border-neutral-100 pb-3">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[13px]" style={{ fontFamily: 'var(--font-serif)', color: SEA }}>{String(i + 1).padStart(2, '0')}</span>
                                        <h3 className="text-[15px]" style={{ fontFamily: 'var(--font-serif)' }}>{s.label}</h3>
                                    </div>
                                    <p className="mt-1 pl-6 text-[11px] leading-relaxed text-neutral-500">
                                        {previewLine(s.id, { referencias, cortes, portalMode, portales, recoEnfoque, recoTono, recoCantidad })}
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
