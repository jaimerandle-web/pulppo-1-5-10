'use client';

// Leads por fuente en el tiempo (la versión en vivo de la pregunta 162 de Metabase): barras
// apiladas, diario / semanal / mensual, en leads o en % del total de cada barra. En vista diaria
// marca con un punto rojo los días que señalaron las red flags.
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Bloque } from '@/lib/portales/inmobiliaria';
import { diaCorto, type Senal } from '@/lib/portales/senales';

const BLK = '#212322', GRY = '#B7B7B7', RED = '#A52003', LGT = '#F3F3F3';
// Paleta de marca + tonos de la misma familia (orden = de la fuente con más leads a la de menos).
const COLORES = ['#212322', '#F6BE00', '#529999', '#A52003', '#8C8E8D', '#9FC7C7', '#C79A00', '#D98C7F', '#5C5E5D', '#D6D6D6'];
const MAX_SERIES = 8;
const MESL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Gran = 'dia' | 'semana' | 'mes';
type Modo = 'n' | 'pct';
type Punto = { d: string; etiqueta: string; total: number; parcial: boolean } & Record<string, number | string | boolean>;

/** Lunes de la semana de `d` (YYYY-MM-DD). */
const lunes = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
};

export default function LeadsPorDia({ A, senales, hoy }: { A: Bloque; senales: Senal[]; hoy: string }) {
    const { dias, series } = A.porDia;
    const auto: Gran = dias.length <= 62 ? 'dia' : dias.length <= 190 ? 'semana' : 'mes';
    const [gran, setGran] = useState<Gran>(auto);
    useEffect(() => setGran(auto), [auto]);             // al cambiar el periodo vuelve a la vista que le queda
    const [modo, setModo] = useState<Modo>('n');
    const [ocultas, setOcultas] = useState<Set<string>>(new Set());

    const visibles = useMemo(() => {
        const top = series.slice(0, MAX_SERIES);
        const resto = series.slice(MAX_SERIES);
        if (!resto.length) return top;
        const n = dias.map((_, i) => resto.reduce((a, s) => a + s.n[i], 0));
        return [...top, { key: 'resto', nombre: 'Resto', n, lab: n.map(() => 0), sin: n.map(() => 0) }];
    }, [series, dias]);
    const activas = visibles.filter((s) => !ocultas.has(s.key));

    const datos = useMemo<Punto[]>(() => {
        // el día en curso va incompleto: fuera, para que la última barra no "se desplome"
        const idx = dias.map((d, i) => [d, i] as const).filter(([d]) => d < hoy);
        const cubeta = (d: string) => (gran === 'dia' ? d : gran === 'semana' ? lunes(d) : `${d.slice(0, 7)}-01`);
        const grupos = new Map<string, number[]>();
        for (const [d, i] of idx) (grupos.get(cubeta(d)) ?? grupos.set(cubeta(d), []).get(cubeta(d))!).push(i);
        return [...grupos.entries()].map(([d, is]) => {
            const fila: Record<string, number> = {};
            for (const s of activas) fila[s.key] = is.reduce((a, i) => a + s.n[i], 0);
            const total = Object.values(fila).reduce((a, v) => a + v, 0);
            // semana o mes cortados por el periodo (o por hoy): se marcan, no se esconden
            const parcial = gran === 'semana' ? is.length < 7
                : gran === 'mes' ? is.length < new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate() : false;
            const etiqueta = (gran === 'mes' ? `${MESL[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : diaCorto(d)) + (parcial ? '*' : '');
            const out: Punto = { d, etiqueta, total, parcial };
            for (const s of activas) out[s.key] = modo === 'pct' ? (total ? (100 * fila[s.key]) / total : 0) : fila[s.key];
            for (const s of activas) out[`n:${s.key}`] = fila[s.key];
            return out;
        });
    }, [dias, activas, gran, modo, hoy]);

    // punto rojo arriba del tramo de la fuente marcada (sólo en diario)
    const marcas = useMemo(() => {
        if (gran !== 'dia') return [];
        const out: Array<{ d: string; y: number; key: string }> = [];
        for (const s of senales) {
            if (!s.dias) continue;
            const pos = activas.findIndex((v) => v.nombre === s.fuente);
            if (pos < 0) continue;
            for (const d of s.dias) {
                const p = datos.find((x) => x.d === d);
                if (!p) continue;
                const y = activas.slice(0, pos + 1).reduce((a, v) => a + Number(p[v.key] ?? 0), 0);
                out.push({ d: p.etiqueta, y, key: `${s.fuente}${d}` });
            }
        }
        return out;
    }, [senales, activas, datos, gran]);

    // eje en números redondos (1, 2, 2.5, 5 × 10^k): el automático daba 950, 1,900, 2,850…
    const ticks = useMemo(() => {
        if (modo === 'pct') return [0, 25, 50, 75, 100];
        const max = Math.max(1, ...datos.map((p) => p.total));
        const bruto = max / 4, e = 10 ** Math.floor(Math.log10(bruto));
        const paso = [1, 2, 2.5, 5, 10].map((m) => m * e).find((x) => x >= bruto)!;
        return Array.from({ length: Math.ceil(max / paso) + 1 }, (_, i) => i * paso);
    }, [datos, modo]);

    if (!datos.length) return <div style={{ fontSize: 12.5, color: GRY }}>Sin días completos en el periodo.</div>;
    const color = (k: string) => COLORES[visibles.findIndex((s) => s.key === k) % COLORES.length];
    const toggle = (k: string) => setOcultas((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const pills = <T extends string>(val: T, opts: Array<[T, string]>, set: (x: T) => void) => (
        <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: 4, overflow: 'hidden' }}>
            {opts.map(([k, l]) => (
                <button key={k} type="button" onClick={() => set(k)}
                    style={{ padding: '5px 11px', fontSize: 11.5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: val === k ? BLK : '#fff', color: val === k ? '#fff' : '#555', fontWeight: val === k ? 700 : 400 }}>{l}</button>
            ))}
        </span>
    );

    return (
        <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                {pills(gran, [['dia', 'Diario'], ['semana', 'Semanal'], ['mes', 'Mensual']], setGran)}
                {pills(modo, [['n', 'Leads'], ['pct', '% del total']], setModo)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 8 }}>
                {visibles.map((s) => {
                    const off = ocultas.has(s.key);
                    return (
                        <button key={s.key} type="button" onClick={() => toggle(s.key)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, color: off ? GRY : BLK, textDecoration: off ? 'line-through' : 'none' }}>
                            <span style={{ width: 10, height: 10, background: off ? LGT : color(s.key), display: 'inline-block', borderRadius: 2 }} />{s.nombre}
                        </button>
                    );
                })}
                <span style={{ fontSize: 11, color: GRY, alignSelf: 'center' }}>· clic para ocultar / mostrar{modo === 'pct' ? ' (el % se recalcula sobre las visibles)' : ''}</span>
            </div>
            <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                    <BarChart data={datos} margin={{ top: 10, right: 8, bottom: 0, left: -10 }} barCategoryGap={gran === 'dia' ? '18%' : '28%'}>
                        <CartesianGrid stroke={LGT} vertical={false} />
                        <XAxis dataKey="etiqueta" tick={{ fontSize: 10.5, fill: '#777' }} tickLine={false} axisLine={{ stroke: GRY }} minTickGap={14} />
                        <YAxis tick={{ fontSize: 10.5, fill: '#777' }} tickLine={false} axisLine={false} allowDecimals={false}
                            ticks={ticks} domain={[0, ticks[ticks.length - 1]]} tickFormatter={(v: number) => (modo === 'pct' ? `${v}%` : v.toLocaleString('es-MX'))} />
                        <Tooltip cursor={{ fill: 'rgba(33,35,34,.05)' }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0].payload as Punto;
                                const filas = activas.map((s) => ({ s, n: Number(p[`n:${s.key}`] ?? 0) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
                                const lbl = gran === 'semana' ? `Semana del ${diaCorto(p.d)}` : gran === 'mes' ? p.etiqueta : diaCorto(p.d);
                                return (
                                    <div style={{ background: '#fff', border: `1px solid ${BLK}`, borderRadius: 4, padding: '8px 10px', fontSize: 11.5, minWidth: 220 }}>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{lbl}{p.parcial ? ' · incompleta' : ''} — {p.total.toLocaleString('es-MX')} leads</div>
                                        {filas.map(({ s, n }) => (
                                            <div key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center', lineHeight: 1.6 }}>
                                                <span style={{ width: 8, height: 8, background: color(s.key), borderRadius: 2 }} />
                                                <span style={{ flex: 1 }}>{s.nombre}</span>
                                                <span style={{ fontWeight: 700 }}>{n.toLocaleString('es-MX')}</span>
                                                <span style={{ width: 42, textAlign: 'right', color: '#777' }}>{p.total ? `${((100 * n) / p.total).toFixed(1)}%` : ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            }} />
                        {activas.map((s) => (
                            <Bar key={s.key} dataKey={s.key} stackId="a" fill={color(s.key)} isAnimationActive={false}>
                                {datos.map((p) => <Cell key={p.d} fillOpacity={p.parcial ? 0.4 : 1} />)}
                            </Bar>
                        ))}
                        {marcas.map((m) => <ReferenceDot key={m.key} x={m.d} y={m.y} r={4} fill={RED} stroke="#fff" />)}
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {datos.some((p) => p.parcial) && (
                <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                    * {gran === 'semana' ? 'Semana incompleta' : 'Mes incompleto'}: el periodo (o el día de hoy) lo corta, así que la barra no se compara con las demás.
                </div>
            )}
        </div>
    );
}
