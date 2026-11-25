'use client';
// Piezas compartidas de la vista del año de /portales (VistaAnual + Dashboard): tokens, mini-gráficas, tarjetas,
// focos y las gráficas por canal. Vive aparte para que Dashboard.tsx no importe a VistaAnual (import circular).
import { type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { InventarioMeses, MesCubo } from '@/lib/portales/anual';
import { ORDEN_INMOBILIARIAS } from '@/lib/portales/ordenInmobiliarias';
import { PORTALES, PORTAL, agregarCeldas, agregarCierres, mesCorto, portalDeCanal, portalDeFuente, type Agg, type Filtro, type Foco, type MesInfo, type Rango } from '@/lib/portales/focos';

export const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
export const R = 2;
export const f0 = (n?: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
export const money = (n?: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
export const pc = (n?: number | null) => (n == null ? '—' : `${n}%`);

export interface Opcion { nombre: string; kam: string | null; tier: string | null }

// ── piezas visuales ────────────────────────────────────────────────────────────────────────────────
/** mini-barras de 13 meses; el mes en curso va en gris claro (está a medias) */
export function Spark({ vals, parcialUlt, color = BLK, alto = 26, ancho = 5 }: { vals: number[]; parcialUlt?: boolean; color?: string; alto?: number; ancho?: number }) {
    const max = Math.max(...vals, 1);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: alto }}>
            {vals.map((v, i) => {
                const ult = i === vals.length - 1;
                return <span key={i} title={f0(v)} style={{ width: ancho, height: Math.max(2, Math.round((v / max) * alto)), borderRadius: 1,
                    background: ult && parcialUlt ? '#E2E2E2' : i >= vals.length - (parcialUlt ? 2 : 1) ? color : GRY }} />;
            })}
        </span>
    );
}
export function Delta({ v, pts = false, invertir = false, sufijo }: { v: number | null; pts?: boolean; invertir?: boolean; sufijo?: string }) {
    if (v == null || !isFinite(v)) return <span style={{ color: GRY }}>—</span>;
    const r = Math.round(v * 10) / 10;
    const bueno = invertir ? r < 0 : r > 0;
    return (
        <span style={{ color: r === 0 ? GRY : bueno ? SEA : RED, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {r > 0 ? '▲ +' : r < 0 ? '▼ ' : ''}{pts ? `${r} pts` : `${Math.round(r)}%`}{sufijo ? <span style={{ color: '#888', fontWeight: 400 }}> {sufijo}</span> : null}
        </span>
    );
}
export function Tile({ label, value, delta, spark, nota }: { label: string; value: string; delta?: ReactNode; spark?: ReactNode; nota?: string }) {
    return (
        <div style={{ background: '#fff', border: `1px solid ${LGT}`, padding: '12px 14px', borderRadius: R, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', fontWeight: 700 }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, margin: '6px 0 4px' }}>
                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 28, lineHeight: 1 }}>{value}</div>
                {spark}
            </div>
            <div style={{ fontSize: 11 }}>{delta}</div>
            {nota && <div style={{ fontSize: 10, color: '#888', marginTop: 3, lineHeight: 1.3 }}>{nota}</div>}
        </div>
    );
}
export function H2({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
    return (
        <div style={{ margin: '26px 0 10px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.6px' }}>{children}</div>
            {sub && <div style={{ fontSize: 11.5, color: '#777', marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
        </div>
    );
}
export const COLOR_SEV: Record<string, string> = { alta: RED, media: YEL, bueno: SEA, nota: GRY };
export function ListaFocos({ titulo, focos, vacio: txtVacio, onIr }: { titulo: string; focos: Foco[]; vacio: string; onIr?: (f: Foco) => void }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>{titulo}</div>
            {!focos.length && <div style={{ fontSize: 12, color: '#888', padding: '10px 0' }}>{txtVacio}</div>}
            {focos.map((f, k) => (
                <div key={k} onClick={onIr && f.filtro ? () => onIr(f) : undefined}
                    style={{ borderLeft: `4px solid ${COLOR_SEV[f.sev]}`, background: '#fff', border: `1px solid ${LGT}`, borderLeftColor: COLOR_SEV[f.sev], borderLeftWidth: 4,
                        padding: '9px 12px', borderRadius: R, marginBottom: 6, cursor: onIr && f.filtro ? 'pointer' : 'default' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: 12.5 }}>{f.quien}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f.cifra}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#555', marginTop: 2, lineHeight: 1.4 }}>{f.que}</div>
                    {!!f.mas?.length && <div style={{ fontSize: 11, color: '#777', marginTop: 3, lineHeight: 1.4 }}>Además: {f.mas.join(' · ')}</div>}
                </div>
            ))}
        </div>
    );
}
/** las que se van de Pulppo (o ya se fueron): sus caídas son esperadas, no son focos */
export const SALIENDO = new Set(ORDEN_INMOBILIARIAS.filter((x) => !x.seQueda || /baja/i.test(x.tier)).map((x) => x.nombre));
export const tip = { contentStyle: { fontSize: 11.5, borderRadius: R, border: `1px solid ${LGT}` }, labelStyle: { fontWeight: 700 } };

export interface Ctx {
    info: MesInfo[]; rango: Rango; ref: { cerrado: number; maduro: number }; cubos: CubosM; filtro: Filtro;
    inv: InventarioMeses | null; parcialUlt: boolean; serie: (f: Filtro) => Agg[];
}
export type CubosM = Record<string, MesCubo>;

export function Cargando({ n, de }: { n: number; de: number }) {
    return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#777', fontSize: 13 }}>
            Calculando el año… {de ? `${n} de ${de} meses` : ''}
            <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>La primera vez del día tarda un poco; después se queda guardado.</div>
        </div>
    );
}

// ── gráficas compartidas ───────────────────────────────────────────────────────────────────────────
export const ejeMes = (info: MesInfo[]) => info.map((m) => mesCorto(m.mes) + (m.parcial ? '*' : ''));
export function Grafica({ alto, children }: { alto: number; children: React.ReactElement }) {
    return <div style={{ height: alto }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
}
export const ejes = (pct = false) => [
    <CartesianGrid key="g" vertical={false} stroke={LGT} />,
    <XAxis key="x" dataKey="mes" tick={{ fontSize: 10.5 }} interval={0} angle={-30} textAnchor="end" height={44} />,
    <YAxis key="y" tick={{ fontSize: 10.5 }} unit={pct ? '%' : undefined} />,
];
/** sombrea el periodo elegido */
export const marcaPeriodo = (c: Ctx) => {
    const x = ejeMes(c.info);
    return <ReferenceArea key="p" x1={x[c.rango.a]} x2={x[c.rango.b]} fill={YEL} fillOpacity={0.12} />;
};
/** barras acumuladas por canal, mes a mes */
export function PorCanalChart({ c, que }: { c: Ctx; que: 'leads' | 'cierres' }) {
    const x = ejeMes(c.info);
    const keys = new Set<string>();
    const data = c.info.map((m, i) => {
        const row: Record<string, string | number> = { mes: x[i] };
        if (que === 'leads') {
            for (const [k, a] of agregarCeldas(c.cubos[m.mes].celdas, c.filtro, (y) => portalDeCanal(y[0]))) { row[PORTAL[k].nombre] = a.leads; keys.add(k); }
        } else {
            for (const [k, a] of agregarCierres(c.cubos[m.mes].cierres, c.filtro, (y) => [portalDeFuente(y[0]) ?? 'sin'])) {
                const n = k === 'sin' ? 'Sin portal (directo, red, sin registro)' : PORTAL[k].nombre; row[n] = a.n; keys.add(k);
            }
        }
        return row;
    });
    const orden = [...PORTALES.map((p) => p.key), 'sin'].filter((k) => keys.has(k));
    return (
        <Grafica alto={250}>
            <BarChart data={data} margin={{ left: -10, right: 6, top: 4 }}>
                {ejes()}{marcaPeriodo(c)}
                <Tooltip {...tip} formatter={(v) => f0(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10.5 }} iconSize={8} />
                {orden.map((k, i) => {
                    const n = k === 'sin' ? 'Sin portal (directo, red, sin registro)' : PORTAL[k].nombre;
                    return <Bar key={k} dataKey={n} stackId="a" isAnimationActive={false} fill={k === 'sin' ? '#DADADA' : PORTAL[k].color} radius={i === orden.length - 1 ? [2, 2, 0, 0] : undefined} />;
                })}
            </BarChart>
        </Grafica>
    );
}

