'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Combobox, Dropdown, Select } from '@/components/inputs';
import type { AnalisisData } from '@/lib/analisis';
import { CIERRES_WIN, DEMANDA_WIN, DESEMPENO_WIN, COMPARAR_OPTS, mesesOpts } from '@/lib/ventanas';
import { GlosarioView, InventarioView, PrecioView, FunnelView, RecoView, DestacadosView, YoyView, Top10View, AsesoresView } from './views';

/* ------------------------------------------------------------------ *
 * /analisis — "Análisis general" (configurador del reporte ampliado)
 * Todas las secciones leen datos en vivo de Mongo vía /api/analisis.
 * Las fechas van en DOS bloques estandarizados (ver src/lib/ventanas.ts):
 *   · Desempeño  = tu operación (funnel, asesores, leads, sin actividad)
 *   · Comparables = el mercado  (cierres, demanda; la oferta es de hoy)
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
    { id: 'asesores', label: 'Desempeño por asesor', needs: null },
    { id: 'yoy', label: 'Comparación de períodos', needs: null },
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

const MESES_OPTS = mesesOpts();

export default function AnalisisGeneral() {
    const router = useRouter();
    const [allInmos, setAllInmos] = useState<string[]>([]);
    const [kams, setKams] = useState<string[]>(['(todos)']);
    const [kamByInmo, setKamByInmo] = useState<Record<string, string>>({});

    // ---- estado de la configuración ----
    const [kam, setKam] = useState('(todos)');
    const [inmo, setInmo] = useState('(todas)');
    const [operacion, setOperacion] = useState('Ambas');
    // COMPARABLES (mercado): cierres + demanda. La oferta es foto de hoy, no se configura.
    const [ventCierres, setVentCierres] = useState('Últimos 24 meses');
    const [ventDemanda, setVentDemanda] = useState('Últimos 3 meses');
    // DESEMPEÑO (tu operación): una ventana + una base de comparación. Manda el funnel, los
    // asesores, los leads por propiedad y el "sin actividad" (antes eran 3 controles sueltos).
    const [desempeno, setDesempeno] = useState('Año en curso (YTD)');
    const [desempenoMes, setDesempenoMes] = useState(MESES_OPTS[1].v);
    const [comparar, setComparar] = useState('Mismo período del año pasado');
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
                body: JSON.stringify({ inmo, operacion, ventDemanda, ventCierres, referencias, desempeno, desempenoMes, comparar, mlsGeneral }),
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
    useEffect(() => { setData(null); }, [inmo, operacion, ventDemanda, ventCierres, referencias, desempeno, desempenoMes, comparar, mlsGeneral]);

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
                    <span className="rounded-[2px] bg-[#F6BE00]/20 px-2.5 py-1 font-semibold text-[#8a6d00]">Vista previa · datos en vivo</span>
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

                    <Card title="2 · Desempeño (tu operación)"
                        hint="Manda el funnel comercial, el desempeño por asesor, los leads por propiedad y el “sin actividad”. Es la única ventana que se compara contra otro período.">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Período">
                                <Select value={desempeno} onChange={setDesempeno} options={DESEMPENO_WIN} />
                            </Field>
                            {desempeno === 'Mes específico' && (
                                <Field label="Mes">
                                    <Select value={desempenoMes} onChange={setDesempenoMes} options={MESES_OPTS.map((m) => ({ value: m.v, label: m.l }))} />
                                </Field>
                            )}
                            <Field label="Comparar contra" hint="Alimenta la sección “Comparación de períodos”.">
                                <Select value={comparar} onChange={setComparar} options={COMPARAR_OPTS} />
                            </Field>
                        </div>
                    </Card>

                    <Card title="3 · Comparables (el mercado)"
                        hint="Para comparar precio, competencia y demanda. La oferta (lo que se pide) es siempre una foto de hoy: no se guarda su historia.">
                        <div className="flex flex-col gap-3.5">
                            <Field label="Cierres comparables" hint="Mínimo 6 meses: los cierres son pocos y una ventana corta no junta comparables suficientes.">
                                <Select value={ventCierres} onChange={setVentCierres} options={CIERRES_WIN} />
                            </Field>
                            <Field label="Demanda de zona (búsquedas)" hint="Mínimo 1 mes.">
                                <Select value={ventDemanda} onChange={setVentDemanda} options={DEMANDA_WIN} />
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

                    <Card title="4 · Secciones a incluir" hint="Marca qué páginas entran al documento.">
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

                    <Card title="5 · Recomendaciones">
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
                            {operacion} · publicadas hoy
                            {benchmark !== 'Ninguno' && ` · ${benchmark}`}
                        </p>
                        {/* El reporte declara qué está comparando, sin que haya que adivinarlo. */}
                        {data && (
                            <p className="mt-2 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>
                                <b>Desempeño:</b> {data.leadsLabel}
                                {data.hasComp ? <> · comparado contra <b>{data.compLabels.a}</b></> : <> · <b>sin comparación</b></>}
                                {' · '}<b>Comparables:</b> cierres {data.cierresLabel} · demanda {data.demandaLabel} · oferta hoy
                            </p>
                        )}

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

                        {data && benchmark !== 'Ninguno' && (() => {
                            const bm = data.benchmarkMarket;
                            const sg = (v: number | null) => v == null ? <span style={{ color: GRAY }}>—</span> : <b style={{ color: v > 3 ? RED : v < -3 ? SEA : SOFT }}>{v > 0 ? '+' : ''}{v}%</b>;
                            return (
                                <div className="mt-4 rounded-[2px] border border-neutral-200 bg-[#F9F9F9] p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: SEA_D }}>Tu posición vs. el mercado</p>
                                    {benchmark === 'vs mejores inmobiliarias' ? (
                                        <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: GRAY }}>
                                            “Mejores inmobiliarias” (Top por ROI) <b>no está disponible aún</b>: el ranking de ROI vive fuera de Mongo. Usa <b>“vs. promedio de mercado”</b> mientras tanto.
                                        </p>
                                    ) : (
                                        <div className="mt-1.5 space-y-1 text-[11px] leading-relaxed" style={{ color: SOFT }}>
                                            <p><b>Precio $/m²:</b> tu inventario está en promedio {sg(bm.vsOfertaAvg)} vs. lo que se <b>pide</b> y {sg(bm.vsCierresAvg)} vs. lo que se <b>vende</b> en tus zonas. Estás por encima de cierres en <b>{bm.zonasCaras} de {bm.zonasCierres}</b> zonas.</p>
                                            <p><b>Absorción:</b> {bm.absorcion == null ? '—' : <><b>{bm.absorcion.toFixed(2)}</b> búsquedas por propiedad publicada</>} en tus zonas <span style={{ color: GRAY }}>({f0(bm.demTotal)} búsquedas · {f0(bm.ofertaTotal)} publicadas en MLS i24).</span></p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

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
                                    {data && s.id === 'inventario' ? <InventarioView d={data} referencias={referencias} cortes={cortes} />
                                        : data && s.id === 'precio' ? <PrecioView d={data} />
                                        : data && s.id === 'destacados' ? <DestacadosView d={data} />
                                        : data && s.id === 'funnel' ? <FunnelView d={data} portalMode={portalMode} portales={portales} />
                                        : data && s.id === 'asesores' ? <AsesoresView d={data} />
                                        : data && s.id === 'yoy' ? <YoyView d={data} />
                                        : data && s.id === 'top10' ? <Top10View d={data} />
                                        : data && s.id === 'reco' ? <RecoView d={data} enfoque={recoEnfoque} tono={recoTono} cantidad={recoCantidad} />
                                        : data && s.id === 'glosario' ? <GlosarioView d={data} />
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
                                : 'Elige una inmobiliaria y presiona Generar: todas las secciones leen datos en vivo de Mongo.'}
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
        case 'asesores': return 'Funnel por asesor: leads, respuesta, visitas, ofertas, cierres, comisión y ticket (venta y renta por separado).';
        case 'yoy': return 'La ventana de desempeño contra su base: inventario, leads, cierres y comisión.';
        case 'top10': return 'Propiedades con alta demanda y pocos leads, con la palanca accionable de cada una.';
        case 'reco': return `${c.recoCantidad} recomendaciones (${c.recoEnfoque.join(', ').toLowerCase() || 'sin enfoque'}), tono ${c.recoTono.toLowerCase()}.`;
        case 'glosario': return 'Señales de precio y glosario de términos para leer el reporte.';
        default: return '';
    }
}

