'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CarteraRow, ProgramRow, DataPayload } from '@/types';
import CarteraTab from '@/components/CarteraTab';
import ProgramaTab from '@/components/ProgramaTab';
import { Combobox, Dropdown } from '@/components/inputs';

export default function Home() {
    const router = useRouter();
    const [data, setData] = useState<DataPayload | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'cartera' | 'programa'>('cartera');
    const [kam, setKam] = useState('(todos)');
    const [inmo, setInmo] = useState('(todas)');
    const [tipos, setTipos] = useState<string[]>([]);

    async function load(refresh = false) {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/data${refresh ? '?refresh=1' : ''}`);
            if (res.status === 401) {
                router.push('/login');
                return;
            }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error cargando datos');
            setData(d);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error cargando datos');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const df = data?.rows || [];
    const pg = data?.program || [];

    const kams = useMemo(() => ['(todos)', ...Array.from(new Set(df.map((r) => r.kam).filter(Boolean))).sort()], [df]);
    const inmos = useMemo(() => {
        const base = kam === '(todos)' ? df : df.filter((r) => r.kam === kam);
        return ['(todas)', ...Array.from(new Set(base.map((r) => r.inmobiliaria).filter(Boolean) as string[])).sort()];
    }, [df, kam]);
    const tiposAll = useMemo(() => Array.from(new Set(df.map((r) => r.tipo).filter(Boolean) as string[])).sort(), [df]);

    function applyFilters<T extends CarteraRow | ProgramRow>(d: T[]): T[] {
        let out = d;
        if (kam !== '(todos)') out = out.filter((r) => r.kam === kam);
        if (inmo !== '(todas)') out = out.filter((r) => r.inmobiliaria === inmo);
        if (tipos.length) out = out.filter((r) => r.tipo && tipos.includes(r.tipo));
        return out;
    }
    const f = applyFilters(df);
    const fp = applyFilters(pg);

    async function logout() {
        await fetch('/api/auth/login', { method: 'DELETE' });
        router.push('/login');
    }

    return (
        <div className="mx-auto max-w-[1400px] px-5 py-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <h1 className="text-3xl sm:text-4xl">Pulppo · 1 · 5 · 10</h1>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                    <span>Datos live desde Mongo (cache 10 min)</span>
                    <a href="/evaluar" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                        ✅ Evaluar
                    </a>
                    <a href="/campanas" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                        ✉️ Campañas
                    </a>
                    <button onClick={() => load(true)} className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                        🔄 Actualizar
                    </button>
                    <button onClick={logout} className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
                        Salir
                    </button>
                </div>
            </header>

            <div className="mt-5 flex flex-wrap items-end gap-4 rounded-xl bg-light p-4">
                <Dropdown label="KAM" value={kam} options={kams}
                    onChange={(v) => { setKam(v); setInmo('(todas)'); }} className="w-44" />
                <Combobox label="Inmobiliaria" value={inmo} allLabel="(todas)"
                    options={inmos.filter((i) => i !== '(todas)')}
                    placeholder="Buscar inmobiliaria…" onChange={setInmo} />
                <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Tipo</p>
                    <div className="flex flex-wrap gap-2">
                        {tiposAll.map((t) => (
                            <button key={t}
                                onClick={() => setTipos((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${tipos.includes(t)
                                    ? 'border-transparent bg-[#212322] text-white'
                                    : 'border-neutral-300 bg-white hover:bg-neutral-50'}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-6 flex gap-1 border-b border-neutral-200">
                {([['cartera', '📋 Cartera y operación'], ['programa', '📈 Programa (general)']] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)}
                        className={`px-4 py-2.5 text-sm font-semibold transition-colors ${tab === id
                            ? 'border-b-2 border-[#F6BE00] text-[#212322]'
                            : 'text-neutral-400 hover:text-neutral-600'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {loading && <p className="mt-10 text-center text-sm text-neutral-500">Consultando Mongo…</p>}
            {error && <p className="mt-10 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {!loading && !error && data && (tab === 'cartera' ? <CarteraTab f={f} fp={fp} /> : <ProgramaTab fp={fp} />)}
        </div>
    );
}
