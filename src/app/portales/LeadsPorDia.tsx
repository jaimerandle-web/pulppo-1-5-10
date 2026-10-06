'use client';

// Leads por día y por fuente (la versión en vivo de la pregunta 162 de Metabase), con los días
// que marcaron las red flags. Con periodos de más de 120 días agrupa por semana: un YTD diario son
// 280 puntos por línea y no se lee nada.
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceDot } from 'recharts';
import type { Bloque } from '@/lib/portales/inmobiliaria';
import { diaCorto, type Senal } from '@/lib/portales/senales';

const BLK = '#212322', GRY = '#B7B7B7', RED = '#A52003', LGT = '#F3F3F3';
// Paleta de marca + tonos de la misma familia (orden = de la fuente con más leads a la de menos).
const COLORES = ['#212322', '#F6BE00', '#529999', '#A52003', '#8C8E8D', '#9FC7C7', '#C79A00', '#D98C7F', '#5C5E5D', '#C9C9C9'];
const MAX_LINEAS = 8;

export default function LeadsPorDia({ A, senales, hoy }: { A: Bloque; senales: Senal[]; hoy: string }) {
    const { dias, series } = A.porDia;
    const semanal = dias.length > 120;
    const [ocultas, setOcultas] = useState<Set<string>>(new Set());

    const visibles = useMemo(() => {
        const top = series.slice(0, MAX_LINEAS);
        const resto = series.slice(MAX_LINEAS);
        if (!resto.length) return top;
        const n = dias.map((_, i) => resto.reduce((a, s) => a + s.n[i], 0));
        return [...top, { key: 'resto', nombre: 'Resto', n, lab: n.map(() => 0), sin: n.map(() => 0) }];
    }, [series, dias]);

    const datos = useMemo(() => {
        // el día en curso va incompleto: se corta para que la línea no "se desplome" al final
        const idx = dias.map((d, i) => [d, i] as const).filter(([d]) => d < hoy);
        if (!semanal) return idx.map(([d, i]) => ({ d, ...Object.fromEntries(visibles.map((s) => [s.key, s.n[i]])) }));
        const sem: Array<Record<string, number | string>> = [];
        for (let j = 0; j < idx.length; j += 7) {
            const blk = idx.slice(j, j + 7);
            if (blk.length < 7) break;                         // semana incompleta fuera
            sem.push({ d: blk[0][0], ...Object.fromEntries(visibles.map((s) => [s.key, blk.reduce((a, [, i]) => a + s.n[i], 0)])) });
        }
        return sem;
    }, [dias, visibles, semanal, hoy]);

    // puntos rojos sobre los días marcados
    const marcas = useMemo(() => {
        if (semanal) return [];
        const out: Array<{ d: string; y: number; key: string }> = [];
        for (const s of senales) {
            if (!s.dias) continue;
            const serie = visibles.find((v) => v.nombre === s.fuente);
            if (!serie || ocultas.has(serie.key)) continue;
            for (const d of s.dias) { const i = dias.indexOf(d); if (i >= 0) out.push({ d, y: serie.n[i], key: `${serie.key}${d}` }); }
        }
        return out;
    }, [senales, visibles, dias, ocultas, semanal]);

    if (!datos.length) return <div style={{ fontSize: 12.5, color: GRY }}>Sin días completos en el periodo.</div>;
    const color = (k: string) => COLORES[visibles.findIndex((s) => s.key === k) % COLORES.length];
    const toggle = (k: string) => setOcultas((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

    return (
        <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 8 }}>
                {visibles.map((s) => {
                    const off = ocultas.has(s.key);
                    return (
                        <button key={s.key} type="button" onClick={() => toggle(s.key)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, color: off ? GRY : BLK, textDecoration: off ? 'line-through' : 'none' }}>
                            <span style={{ width: 14, height: 3, background: off ? LGT : color(s.key), display: 'inline-block' }} />{s.nombre}
                        </button>
                    );
                })}
                <span style={{ fontSize: 11, color: GRY, alignSelf: 'center' }}>· clic para ocultar / mostrar</span>
            </div>
            <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                    <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                        <CartesianGrid stroke={LGT} vertical={false} />
                        <XAxis dataKey="d" tickFormatter={(d: string) => diaCorto(d)} tick={{ fontSize: 10.5, fill: '#777' }} tickLine={false} axisLine={{ stroke: GRY }} minTickGap={18} />
                        <YAxis tick={{ fontSize: 10.5, fill: '#777' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            labelFormatter={(d) => (semanal ? `Semana del ${diaCorto(String(d))}` : diaCorto(String(d)))}
                            formatter={(v, k) => [Number(v).toLocaleString('es-MX'), visibles.find((s) => s.key === k)?.nombre ?? String(k)]}
                            itemSorter={(it) => -Number(it.value)}
                            contentStyle={{ fontSize: 11.5, border: `1px solid ${BLK}`, borderRadius: 4, boxShadow: 'none' }} />
                        {visibles.filter((s) => !ocultas.has(s.key)).map((s) => (
                            <Line key={s.key} dataKey={s.key} name={s.key} stroke={color(s.key)} strokeWidth={s.key === visibles[0].key ? 2 : 1.5} dot={false} isAnimationActive={false} />
                        ))}
                        {marcas.map((m) => <ReferenceDot key={m.key} x={m.d} y={m.y} r={4} fill={RED} stroke="#fff" />)}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
