'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Buscador del evaluador de elegibilidad 1·5·10: escribes el código y abre /evaluar/[id].
export default function EvaluarBuscador() {
    const router = useRouter();
    const [id, setId] = useState('');
    const go = () => { if (id.trim()) router.push(`/evaluar/${encodeURIComponent(id.trim())}`); };

    return (
        <div className="mx-auto max-w-[900px] px-5 py-6">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <h1 className="text-3xl sm:text-4xl">Evaluar para 1 · 5 · 10</h1>
                </div>
                <a href="/" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">← Dashboard</a>
            </header>

            <p className="mb-4 text-sm text-neutral-600">
                Evalúa si una propiedad tiene la salud suficiente para entrar al programa y valer la inversión de
                superdestacarla: <b>precio competitivo</b> (vs valuación y cierres de la zona), <b>calidad del aviso</b>,
                <b> comisión</b> y <b>demanda de la zona</b>. Requiere venta, residencial y no desarrollo; el material
                (foto + video + tour) se marca aparte.
            </p>

            <div className="flex gap-2">
                <input
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && go()}
                    placeholder="Código de la propiedad (ej. DDB-396) o ID de Mongo"
                />
                <button onClick={go} disabled={!id.trim()}
                    className="rounded-lg bg-[#212322] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Evaluar
                </button>
            </div>
        </div>
    );
}
