'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Row {
    code: string; title?: string; typ?: string | null; col?: string | null; city?: string | null;
    score?: number; banda?: string; okIntr?: boolean; esDesarrollo?: boolean; okMat?: boolean; faltaMat?: string[];
    ppm2?: number | null; vsAcm?: number | null; vsOferta?: number | null; vsCierre?: number | null;
    velocidadMed?: number | null; meses?: number | null; notFound?: boolean; error?: string;
}

// Evaluador de elegibilidad 1·5·10. Uno o varios códigos → corre el análisis de todas a la par.
export default function EvaluarBuscador() {
    const router = useRouter();
    const [codes, setCodes] = useState('');
    const [rows, setRows] = useState<Row[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function run() {
        const list = codes.split(/[\s,;\n]+/).map((c) => c.trim()).filter(Boolean);
        if (!list.length) return;
        setLoading(true); setError(''); setRows(null);
        try {
            const res = await fetch('/api/evaluar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: list }) });
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error');
            setRows((d.results as Row[]).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally { setLoading(false); }
    }

    const bandaColor = (b?: string) => b === 'Alta' ? '#529999' : b === 'Media' ? '#F6BE00' : b === 'No aplica' ? '#B7B7B7' : '#A52003';
    const dpct = (n?: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n}%`;

    return (
        <div className="mx-auto max-w-[1200px] px-5 py-6">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <h1 className="text-3xl sm:text-4xl">Evaluar para 1 · 5 · 10</h1>
                </div>
                <a href="/1-5-10" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">← Dashboard</a>
            </header>

            <p className="mb-4 text-sm text-neutral-600">
                Evalúa si una propiedad tiene la salud para entrar al programa y valer la inversión de superdestacarla:
                <b> precio competitivo</b> (mix ACM · oferta · cierres), <b>calidad del aviso</b>, <b>comisión</b> y
                <b> demanda de zona</b>. Requiere venta y residencial; si es desarrollo hay posible rechazo (se revisa caso a caso); el material (foto+video+tour) se marca aparte.
                Puedes pegar <b>uno o varios códigos</b> (uno por línea o separados por coma).
            </p>

            <div className="flex flex-col gap-2 lg:flex-row">
                <textarea className="min-h-[80px] w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm lg:w-96"
                    value={codes} onChange={(e) => setCodes(e.target.value)} placeholder={'DDB-396\nCAA-478'} />
                <div className="flex flex-col gap-2">
                    <button onClick={run} disabled={loading || !codes.trim()}
                        className="rounded-lg bg-[#212322] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        {loading ? 'Evaluando…' : 'Evaluar'}
                    </button>
                    <span className="text-[11px] text-neutral-400">Máx. 15 a la vez</span>
                </div>
            </div>

            {error && <div className="mt-3 rounded-lg bg-[#fdeeea] px-3 py-2 text-xs text-[#A52003]">{error}</div>}

            {rows && (
                <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
                                <th className="py-2 pr-3">Propiedad</th><th className="py-2 pr-3">Aceptación</th>
                                <th className="py-2 pr-3">vs ACM</th><th className="py-2 pr-3">vs oferta</th><th className="py-2 pr-3">vs cierres</th>
                                <th className="py-2 pr-3">Velocidad zona</th><th className="py-2 pr-3">Material</th><th className="py-2 pr-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.code} className="border-b border-neutral-100">
                                    {r.notFound || r.error ? (
                                        <><td className="py-2 pr-3 font-mono">{r.code}</td><td className="py-2 pr-3 text-neutral-400" colSpan={7}>{r.notFound ? 'no encontrada' : r.error}</td></>
                                    ) : (
                                        <>
                                            <td className="py-2 pr-3"><b className="font-mono">{r.code}</b><div className="text-xs text-neutral-500">{r.typ} · {r.col}, {r.city}</div>{r.esDesarrollo && <div className="mt-0.5 inline-block rounded bg-[#F6BE00] px-1.5 py-0.5 text-[10px] font-bold text-[#212322]">⚠️ desarrollo · posible rechazo</div>}</td>
                                            <td className="py-2 pr-3">
                                                <span className="rounded px-2 py-0.5 text-xs font-bold text-white" style={{ background: bandaColor(r.banda) }}>
                                                    {r.okIntr ? `${r.score}% · ${r.banda}` : 'No aplica'}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3">{dpct(r.vsAcm)}</td>
                                            <td className="py-2 pr-3">{dpct(r.vsOferta)}</td>
                                            <td className="py-2 pr-3">{dpct(r.vsCierre)}</td>
                                            <td className="py-2 pr-3">{r.velocidadMed != null ? `${Math.round(r.velocidadMed)} d` : '—'}</td>
                                            <td className="py-2 pr-3">{r.okMat ? '✓ completo' : <span className="text-[#A5700a]">falta {r.faltaMat?.join(', ').toLowerCase()}</span>}</td>
                                            <td className="py-2 pr-3"><a className="text-[#529999] underline" href={`/1-5-10/evaluar/${encodeURIComponent(r.code)}`} target="_blank" rel="noreferrer">ver ficha</a></td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-xs text-neutral-400">Ordenadas por % de aceptación. &quot;vs&quot; = tu $/m² contra cada referencia (negativo = más barato).</p>
                </div>
            )}
        </div>
    );
}
