'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const norm = (s: string) =>
    s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Chevron() {
    return (
        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" viewBox="0 0 20 20" fill="none">
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Select estilizado (mismo look en toda la app). options: strings o {value, label}.
export function Select({ label, value, onChange, options, className = '' }: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    options: (string | { value: string; label: string })[];
    className?: string;
}) {
    return (
        <div className={className}>
            {label && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>}
            <div className="relative">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-neutral-200 bg-white py-2.5 pl-3.5 pr-9 text-sm shadow-sm transition-colors hover:border-neutral-300 focus:border-[#F6BE00] focus:outline-none focus:ring-2 focus:ring-[#F6BE00]/20"
                >
                    {options.map((o) => {
                        const v = typeof o === 'string' ? o : o.value;
                        const l = typeof o === 'string' ? o : o.label;
                        return <option key={v} value={v}>{l}</option>;
                    })}
                </select>
                <Chevron />
            </div>
        </div>
    );
}

// Desplegable custom con el mismo look que el Combobox (panel, highlight amarillo), sin búsqueda.
export function Dropdown({ label, value, onChange, options, className = '' }: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    options: string[];
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    return (
        <div ref={wrap} className={`relative ${className}`}>
            {label && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>}
            <button
                onClick={() => setOpen((o) => !o)}
                className="relative w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-3.5 pr-9 text-left text-sm shadow-sm transition-colors hover:border-neutral-300 focus:border-[#F6BE00] focus:outline-none focus:ring-2 focus:ring-[#F6BE00]/20"
            >
                {value}
                <Chevron />
            </button>
            {open && (
                <ul className="absolute z-20 mt-1.5 max-h-64 w-full min-w-44 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
                    {options.map((o) => (
                        <li key={o}>
                            <button
                                onClick={() => { onChange(o); setOpen(false); }}
                                className={`w-full px-3.5 py-2 text-left text-sm hover:bg-[#F6BE00]/15 ${o === value ? 'font-semibold' : ''}`}
                            >
                                {o}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// Input con autocompletado: escribís y filtra por coincidencia (sin acentos/mayúsculas).
export function Combobox({ label, value, onChange, options, placeholder, allLabel }: {
    label?: string;
    value: string;           // opción elegida o allLabel
    onChange: (v: string) => void;
    options: string[];       // sin el allLabel
    placeholder?: string;
    allLabel: string;        // ej. '(todas)'
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [hi, setHi] = useState(0);
    const wrap = useRef<HTMLDivElement>(null);

    const matches = useMemo(() => {
        const q = norm(query.trim());
        const m = q ? options.filter((o) => norm(o).includes(q)) : options;
        return m.slice(0, 50);
    }, [options, query]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    function pick(o: string) {
        onChange(o);
        setQuery('');
        setOpen(false);
    }

    const selected = value !== allLabel ? value : '';

    return (
        <div ref={wrap} className="relative">
            {label && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>}
            <div className="relative">
                <input
                    value={open ? query : selected}
                    placeholder={selected || placeholder || 'Buscar…'}
                    onFocus={() => { setOpen(true); setQuery(''); setHi(0); }}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
                    onKeyDown={(e) => {
                        if (!open) return;
                        if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                        else if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) pick(matches[hi]); }
                        else if (e.key === 'Escape') setOpen(false);
                    }}
                    className="w-64 rounded-xl border border-neutral-200 bg-white py-2.5 pl-3.5 pr-16 text-sm shadow-sm transition-colors placeholder:text-neutral-400 hover:border-neutral-300 focus:border-[#F6BE00] focus:outline-none focus:ring-2 focus:ring-[#F6BE00]/20"
                />
                {selected && !open && (
                    <button
                        onClick={() => pick(allLabel)}
                        className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                        title="Limpiar"
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none">
                            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </button>
                )}
                <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" viewBox="0 0 20 20" fill="none">
                    <path d="M9 3a6 6 0 1 0 3.9 10.6l3.2 3.2 1.4-1.4-3.2-3.2A6 6 0 0 0 9 3Zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" fill="currentColor" />
                </svg>
            </div>
            {open && (
                <ul className="absolute z-20 mt-1.5 max-h-64 w-72 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
                    <li>
                        <button onClick={() => pick(allLabel)}
                            className="w-full px-3.5 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-50">
                            {allLabel}
                        </button>
                    </li>
                    {matches.map((o, i) => (
                        <li key={o}>
                            <button
                                onClick={() => pick(o)}
                                onMouseEnter={() => setHi(i)}
                                className={`w-full px-3.5 py-2 text-left text-sm ${i === hi ? 'bg-[#F6BE00]/15' : ''} ${o === selected ? 'font-semibold' : ''}`}
                            >
                                {o}
                            </button>
                        </li>
                    ))}
                    {!matches.length && <li className="px-3.5 py-2 text-sm text-neutral-400">Sin coincidencias</li>}
                </ul>
            )}
        </div>
    );
}
