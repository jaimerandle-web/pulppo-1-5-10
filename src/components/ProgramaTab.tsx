'use client';

import { useMemo, useState } from 'react';
import type { ProgramRow } from '@/types';
import { Metric, Section, Caption, HBar, VBar, GroupBar, Donut, histogram, DataTable, money, SOFT, YELLOW, SEA, GRAY } from './ui';

function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function groupCount<T>(rows: T[], key: (r: T) => string | null | undefined): { name: string; value: number }[] {
    const m: Record<string, number> = {};
    for (const r of rows) {
        const k = key(r);
        if (k) m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).map(([name, value]) => ({ name, value }));
}

export default function ProgramaTab({ fp }: { fp: ProgramRow[] }) {
    const vend = useMemo(() => fp.filter((r) => r.vendida), [fp]);
    const dts = vend.map((r) => r.dias_venta).filter((d): d is number => d != null);
    const med = median(dts);
    const pct6 = dts.length ? (dts.filter((d) => d < 180).length / dts.length) * 100 : 0;

    const captacion = groupCount(fp.filter((r) => r.alta_mes), (r) => r.alta_mes).sort((a, b) => a.name.localeCompare(b.name));
    const ventasMes = groupCount(vend.filter((r) => r.venta_mes), (r) => r.venta_mes).sort((a, b) => a.name.localeCompare(b.name));
    const estatus = groupCount(fp, (r) => r.status);

    // composición tipo · en programa vs vendidas
    const tipos = Array.from(new Set(fp.map((r) => r.tipo).filter(Boolean))) as string[];
    const comp = tipos.map((t) => ({
        name: t,
        'En programa': fp.filter((r) => r.tipo === t).length,
        'Vendidas': vend.filter((r) => r.tipo === t).length
    }));

    // ventas por rango de ticket (MXN)
    const BANDAS: { label: string; min: number; max: number }[] = [
        { label: '0-5M', min: 0, max: 5e6 },
        { label: '5-10M', min: 5e6, max: 10e6 },
        { label: '10-15M', min: 10e6, max: 15e6 },
        { label: '15-20M', min: 15e6, max: 20e6 },
        { label: '20M+', min: 20e6, max: 1e12 }
    ];
    const bandas = BANDAS.map((b) => ({
        name: b.label,
        value: vend.filter((r) => r.precio != null && r.precio > b.min && r.precio <= b.max).length
    }));

    const ventasZona = groupCount(vend, (r) => r.ciudad).sort((a, b) => b.value - a.value).slice(0, 8);

    // recap mensual
    const meses = Array.from(new Set(vend.map((r) => r.venta_mes).filter(Boolean) as string[])).sort().reverse();
    const [mes, setMes] = useState('');
    const mesSel = mes || meses[0] || '';
    const rec = useMemo(() => {
        const rows = vend
            .filter((r) => r.venta_mes === mesSel)
            .map((r) => ({ ...r, precio_venta: r.precio_cierre ?? r.precio }))
            .sort((a, b) => (a.venta_fecha || '').localeCompare(b.venta_fecha || ''));
        return rows;
    }, [vend, mesSel]);
    const bonoTotal = rec.reduce((a, r) => a + (r.bono_est || 0), 0);

    function downloadCsv() {
        const cols = ['op_id', 'internalId', 'inmobiliaria', 'kam', 'colonia', 'tipo', 'side', 'vendedor',
            'broker_comprador', 'inmo_comprador', 'precio_venta', 'comision', 'com_comprador', 'bono_est',
            'regalia', 'cierre_fin', 'dias_venta', 'venta_fecha'];
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = [cols.join(','), ...rec.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vendidas_${mesSel}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    return (
        <div>
            <Section title="Desempeño general del programa">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Metric label="Exclusivas (histórico)" value={fp.length} />
                    <Metric label="Vivas (contrato activo)" value={fp.filter((r) => r.status === 'published').length} />
                    <Metric label="Vendidas" value={vend.length} />
                    <Metric label="En proceso" value={fp.filter((r) => r.en_proceso).length} />
                    <Metric label="Mediana días a venta" value={med ?? '—'} />
                    <Metric label="Vende en <6 meses" value={`${pct6.toFixed(0)}%`} />
                </div>
            </Section>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                    <Caption>Captación por mes (altas)</Caption>
                    <VBar data={captacion} color={SOFT} />
                </div>
                <div>
                    <Caption>Ventas por mes (cierres)</Caption>
                    <VBar data={ventasMes} color={SEA} />
                </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                    <Caption>Tiempo a venta (distribución, días)</Caption>
                    <VBar data={histogram(dts)} color={YELLOW} />
                    <p className="text-[11px]" style={{ color: '#A52003' }}>— — 180 días = 6 meses</p>
                </div>
                <div>
                    <Caption>Estatus de la cartera</Caption>
                    <Donut data={estatus} />
                </div>
            </div>

            <Section title="Composición y conversión">
                <div className="grid gap-6 lg:grid-cols-3">
                    <div>
                        <Caption>Tipo · en programa vs vendidas</Caption>
                        <GroupBar data={comp} keys={['En programa', 'Vendidas']} colors={[GRAY, SEA]} />
                    </div>
                    <div>
                        <Caption>Ventas por rango de ticket (MXN)</Caption>
                        <VBar data={bandas} color={YELLOW} />
                    </div>
                    <div>
                        <Caption>Ventas por zona (top)</Caption>
                        <HBar data={ventasZona} color={SOFT} />
                    </div>
                </div>
            </Section>

            <Section title="Recap mensual · propiedades vendidas (para bonos)">
                {meses.length ? (
                    <>
                        <div className="mb-4 flex flex-wrap items-end gap-6">
                            <div>
                                <Caption>Mes de venta</Caption>
                                <select value={mesSel} onChange={(e) => setMes(e.target.value)}
                                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                                    {meses.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <Metric label={`Vendidas en ${mesSel}`} value={rec.length} />
                            <Metric label="Bono estimado total" value={money(bonoTotal)} />
                            <button onClick={downloadCsv}
                                className="rounded-lg bg-soft px-4 py-2 text-sm text-white hover:opacity-80" style={{ background: SOFT }}>
                                ⬇️ Descargar CSV (para registrar bonos)
                            </button>
                        </div>
                        <DataTable
                            columns={[
                                { key: 'op_id', label: 'ID operación' },
                                { key: 'internalId', label: 'ID propiedad' },
                                { key: 'inmobiliaria', label: 'inmo vendedor' },
                                { key: 'kam', label: 'kam' },
                                { key: 'colonia', label: 'colonia' },
                                { key: 'tipo', label: 'tipo' },
                                { key: 'side', label: 'side' },
                                { key: 'vendedor', label: 'vendedor' },
                                { key: 'broker_comprador', label: 'broker comprador (bono)' },
                                { key: 'inmo_comprador', label: 'inmo comprador' },
                                { key: 'precio_venta', label: 'precio venta', render: (v) => money(v as number) },
                                { key: 'comision', label: 'comisión total', render: (v) => money(v as number) },
                                { key: 'com_comprador', label: 'com. comprador (base bono)', render: (v) => money(v as number) },
                                { key: 'bono_est', label: 'bono estimado (5%)', render: (v) => money(v as number) },
                                { key: 'regalia', label: 'regalía Pulppo', render: (v) => money(v as number) },
                                { key: 'cierre_fin', label: 'cierre financiero' },
                                { key: 'dias_venta', label: 'días a venta' },
                                { key: 'venta_fecha', label: 'fecha venta', render: (v) => (v ? String(v).slice(0, 10) : '—') }
                            ]}
                            rows={rec as unknown as Record<string, unknown>[]}
                        />
                        <p className="mt-2 text-[11px] text-neutral-500">
                            Vendida = propiedad &apos;completed&apos; (diccionario oficial). ID operación + broker comprador = 100% de Mongo.
                            Bono = 5% de la comisión del lado comprador; la &apos;com. comprador&apos; solo viene poblada en pocas ops
                            (el resto admin la captura). &apos;cierre financiero&apos; closed/paying = listo para pagar bono.
                        </p>
                    </>
                ) : (
                    <p className="rounded-lg bg-light px-4 py-3 text-sm">Sin ventas registradas en la selección.</p>
                )}
            </Section>

            <p className="mt-6 text-[11px] text-neutral-500">
                Programa = toda propiedad con contract.exclusive.pulppo. Filtros de KAM/inmobiliaria/tipo aplican aquí también.
            </p>
        </div>
    );
}
