'use client';

import { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, LabelList, ResponsiveContainer,
    PieChart, Pie, Cell, ReferenceLine, Legend, Tooltip,
    LineChart, Line, CartesianGrid
} from 'recharts';

export const SOFT = '#212322';
export const YELLOW = '#F6BE00';
export const GRAY = '#B7B7B7';
export const SEA = '#529999';
export const RED = '#A52003';
export const PALETTE = [SOFT, YELLOW, SEA, GRAY, '#8a8a8a', '#c9a227', '#3f7373', '#d9d9d9'];

export const money = (n?: number | null) =>
    n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

export function Metric({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="text-[1.6rem] font-semibold leading-tight" style={{ fontFamily: 'var(--font-sans)' }}>{value}</p>
        </div>
    );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-8">
            <h3 className="mb-3 text-xl">{title}</h3>
            {children}
        </section>
    );
}

export function Caption({ children }: { children: React.ReactNode }) {
    return <p className="mb-1 text-xs text-neutral-500">{children}</p>;
}

// Barras horizontales ordenadas desc (equivalente al bar() de app.py).
export function HBar({ data, color = SOFT, height = 300 }: {
    data: { name: string; value: number }[]; color?: string; height?: number;
}) {
    const d = data.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    if (!d.length) return <p className="py-8 text-center text-sm text-neutral-400">Sin datos</p>;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={d} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: SOFT }} />
                <Bar dataKey="value" fill={color} isAnimationActive={false}>
                    <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: SOFT }} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

// Barras verticales (captación/ventas por mes, bandas de ticket, etc.).
export function VBar({ data, color = SOFT, height = 300, refLine }: {
    data: { name: string; value: number }[]; color?: string; height?: number;
    refLine?: { x: string | number; label: string };
}) {
    if (!data.length) return <p className="py-8 text-center text-sm text-neutral-400">Sin datos</p>;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: SOFT }} interval={0} angle={data.length > 10 ? -45 : 0} textAnchor={data.length > 10 ? 'end' : 'middle'} height={data.length > 10 ? 50 : 30} />
                <YAxis hide />
                {refLine && <ReferenceLine x={refLine.x} stroke={RED} strokeDasharray="4 4" label={{ value: refLine.label, fontSize: 10, fill: RED, position: 'top' }} />}
                <Bar dataKey="value" fill={color} isAnimationActive={false}>
                    <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: SOFT }} />
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

// Barras agrupadas (tipo · en programa vs vendidas).
export function GroupBar({ data, keys, colors, height = 300 }: {
    data: Record<string, string | number>[]; keys: string[]; colors: string[]; height?: number;
}) {
    if (!data.length) return <p className="py-8 text-center text-sm text-neutral-400">Sin datos</p>;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: SOFT }} />
                <YAxis hide />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {keys.map((k, i) => (
                    <Bar key={k} dataKey={k} fill={colors[i]} isAnimationActive={false}>
                        <LabelList dataKey={k} position="top" style={{ fontSize: 10, fill: SOFT }} />
                    </Bar>
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}

// Líneas en el tiempo (desempeño semanal: leads/visitas por semana).
export function TimeLine({ data, keys, colors, height = 260 }: {
    data: Record<string, string | number>[]; keys: string[]; colors: string[]; height?: number;
}) {
    if (!data.length) return <p className="py-8 text-center text-sm text-neutral-400">Sin datos</p>;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: SOFT }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10, fill: SOFT }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip />
                {keys.map((k, i) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={colors[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

// Dona (estatus de la cartera).
export function Donut({ data, height = 300 }: { data: { name: string; value: number }[]; height?: number }) {
    if (!data.length) return <p className="py-8 text-center text-sm text-neutral-400">Sin datos</p>;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="80%" isAnimationActive={false}
                    label={(p) => `${p.name} (${p.value})`} fontSize={11}>
                    {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip />
            </PieChart>
        </ResponsiveContainer>
    );
}

// Histograma simple: binnea valores y los muestra como VBar.
export function histogram(values: number[], nbins = 20): { name: string; value: number }[] {
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const width = Math.max(1, Math.ceil((max - min + 1) / nbins));
    const bins: Record<number, number> = {};
    for (const v of values) {
        const b = Math.floor((v - min) / width);
        bins[b] = (bins[b] || 0) + 1;
    }
    return Array.from({ length: Math.max(...Object.keys(bins).map(Number)) + 1 }, (_, b) => ({
        name: `${min + b * width}`,
        value: bins[b] || 0
    }));
}

// Tabla genérica con scroll horizontal. Opcionalmente ordenable (click en el header), con buscador
// (searchable) y descarga CSV (csvName). `value(row)` da el valor crudo para ordenar/buscar/exportar
// cuando `render` muestra algo distinto (links, formato); si no se da, se usa row[key].
export interface Column {
    key: string;
    label: string;
    render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode;
    value?: (row: Record<string, unknown>) => string | number;
}

function cellValue(c: Column, r: Record<string, unknown>): string | number {
    if (c.value) return c.value(r);
    const v = r[c.key];
    return v == null ? '' : (v as string | number);
}

function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = columns.map((c) => esc(c.label)).join(',');
    const body = rows.map((r) => columns.map((c) => esc(cellValue(c, r))).join(',')).join('\n');
    return '﻿' + head + '\n' + body; // BOM para que Excel respete acentos
}

export function DataTable({ columns, rows, sortable, searchable, csvName }: {
    columns: Column[];
    rows: Record<string, unknown>[];
    sortable?: boolean;
    searchable?: boolean;
    csvName?: string;
}) {
    const [q, setQ] = useState('');
    const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

    const view = useMemo(() => {
        let out = rows;
        if (q.trim()) {
            const s = q.toLowerCase();
            out = out.filter((r) => columns.some((c) => String(cellValue(c, r)).toLowerCase().includes(s)));
        }
        if (sort) {
            const c = columns.find((x) => x.key === sort.key);
            if (c) {
                out = [...out].sort((a, b) => {
                    const av = cellValue(c, a), bv = cellValue(c, b);
                    const cmp = typeof av === 'number' && typeof bv === 'number'
                        ? av - bv
                        : String(av).localeCompare(String(bv), 'es', { numeric: true });
                    return cmp * sort.dir;
                });
            }
        }
        return out;
    }, [rows, columns, q, sort]);

    const toggleSort = (key: string) =>
        setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

    function download() {
        const blob = new Blob([toCsv(columns, view)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${csvName}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div>
            {(searchable || csvName) && (
                <div className="mb-2 flex items-center gap-2">
                    {searchable && (
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
                            className="w-56 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs focus:border-neutral-500 focus:outline-none" />
                    )}
                    {csvName && (
                        <button onClick={download} disabled={!view.length}
                            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40">
                            ⬇️ CSV
                        </button>
                    )}
                    {searchable && <span className="text-xs text-neutral-400">{view.length} filas</span>}
                </div>
            )}
            {!view.length ? (
                <p className="py-4 text-sm text-neutral-400">Sin filas.</p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-light">
                            <tr>
                                {columns.map((c) => (
                                    <th key={c.key}
                                        onClick={sortable ? () => toggleSort(c.key) : undefined}
                                        className={`whitespace-nowrap px-3 py-2 font-semibold ${sortable ? 'cursor-pointer select-none hover:bg-neutral-100' : ''}`}>
                                        {c.label}{sortable && sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {view.map((r, i) => (
                                <tr key={i} className="border-t border-neutral-100 hover:bg-neutral-50">
                                    {columns.map((c) => (
                                        <td key={c.key} className="whitespace-nowrap px-3 py-1.5">
                                            {c.render ? c.render(r[c.key], r) : String(r[c.key] ?? '—')}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
