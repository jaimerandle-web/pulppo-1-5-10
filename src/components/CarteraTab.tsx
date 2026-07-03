'use client';

import { useMemo, useState } from 'react';
import { CATS, type CarteraRow, type ProgramRow } from '@/types';
import { Metric, Section, Caption, HBar, DataTable, money, SOFT, YELLOW, SEA } from './ui';
import { Select } from './inputs';

function alertas(r: CarteraRow): string {
    const a: string[] = [];
    if (r.op_status === 'offer') a.push('🟢 EN OFERTA');
    if ((r.leads_total || 0) === 0) a.push('🔴 Sin leads');
    if (!r.material_ok) a.push('🟡 Material incompleto');
    if ((r.dias_activa || 0) >= 150) a.push('🟡 Contrato por vencer');
    if ((r.leads_total || 0) > 0 && (r.visitas || 0) === 0) a.push('🟡 Leads sin visitas');
    return a.join(' · ');
}

const ficha = (v: unknown) => (
    <a href={String(v)} target="_blank" rel="noreferrer" className="text-sea underline" style={{ color: SEA }}>ver</a>
);

export default function CarteraTab({ f, fp }: { f: CarteraRow[]; fp: ProgramRow[] }) {
    const [selIdx, setSelIdx] = useState(0);

    const pipe = useMemo(
        () => f.filter((r) => ['offer', 'contract', 'paying', 'closed'].includes(r.op_status || '')),
        [f]
    );
    const vendidasHist = fp.filter((r) => r.vendida).length;

    const leadsPorFuente = CATS.map((c) => ({ name: c, value: f.reduce((a, r) => a + (r.leads[c] || 0), 0) }));
    const porInmo = useMemo(() => {
        const m: Record<string, number> = {};
        for (const r of f) if (r.inmobiliaria) m[r.inmobiliaria] = (m[r.inmobiliaria] || 0) + 1;
        return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
    }, [f]);

    const precios = f.map((r) => r.precio).filter((p): p is number => p != null);
    const ticketMedio = precios.length ? precios.reduce((a, b) => a + b, 0) / precios.length : null;

    const sel = f[Math.min(selIdx, Math.max(0, f.length - 1))];
    const conAlertas = f.map((r) => ({ ...r, alertas: alertas(r) })).filter((r) => r.alertas !== '');
    const leadColsConDatos = CATS.filter((c) => f.reduce((a, r) => a + (r.leads[c] || 0), 0) > 0);

    return (
        <div>
            <Section title="Avanzando · oferta y venta">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Metric label="🟢 En oferta" value={f.filter((r) => r.op_status === 'offer').length} />
                    <Metric label="En contrato/pagando" value={f.filter((r) => ['contract', 'paying'].includes(r.op_status || '')).length} />
                    <Metric label="Vendidas (histórico)" value={vendidasHist} />
                    <Metric label="Exclusivas vivas" value={f.length} />
                </div>
                <div className="mt-4">
                    {pipe.length ? (
                        <DataTable
                            columns={[
                                { key: 'inmobiliaria', label: 'inmobiliaria' },
                                { key: 'kam', label: 'kam' },
                                { key: 'colonia', label: 'colonia' },
                                { key: 'tipo', label: 'tipo' },
                                { key: 'precio', label: 'precio', render: (v) => money(v as number) },
                                { key: 'leads_total', label: 'leads' },
                                { key: 'visitas', label: 'visitas' },
                                { key: 'op_status', label: 'estatus' },
                                { key: 'url', label: 'ficha', render: ficha }
                            ]}
                            rows={pipe as unknown as Record<string, unknown>[]}
                        />
                    ) : (
                        <p className="rounded-lg bg-light px-4 py-3 text-sm">Ninguna propiedad en oferta/venta en la selección actual.</p>
                    )}
                </div>
            </Section>

            <Section title="Cartera">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Metric label="Vivas" value={f.length} />
                    <Metric label="Leads totales" value={f.reduce((a, r) => a + r.leads_total, 0)} />
                    <Metric label="Visitas" value={f.reduce((a, r) => a + r.visitas, 0)} />
                    <Metric label="Sin leads" value={f.filter((r) => r.leads_total === 0).length} />
                    <Metric label="Material OK" value={`${f.filter((r) => r.material_ok).length}/${f.length}`} />
                    <Metric label="Ticket medio" value={money(ticketMedio)} />
                </div>
                <div className="mt-5 grid gap-6 lg:grid-cols-2">
                    <div>
                        <Caption>Leads por fuente (selección)</Caption>
                        <HBar data={leadsPorFuente} color={SOFT} />
                    </div>
                    <div>
                        <Caption>Exclusivas por inmobiliaria</Caption>
                        <HBar data={porInmo} color={YELLOW} />
                    </div>
                </div>
            </Section>

            <Section title="Desempeño de una propiedad">
                {f.length ? (
                    <>
                        <Select
                            className="mb-4 w-full max-w-xl"
                            value={String(selIdx)}
                            onChange={(v) => setSelIdx(Number(v))}
                            options={f.map((r, i) => ({
                                value: String(i),
                                label: `${r.inmobiliaria} · ${r.colonia} · ${money(r.precio)} (${r.leads_total} leads)`
                            }))}
                        />
                        {sel && (
                            <div className="grid gap-6 lg:grid-cols-3">
                                <div className="space-y-3">
                                    <Metric label="Leads" value={sel.leads_total} />
                                    <Metric label="Visitas" value={sel.visitas} />
                                    <Metric label="Días activa" value={sel.dias_activa ?? '—'} />
                                    <p className="text-sm"><b>{sel.tipo}</b> · {sel.colonia}</p>
                                    <p className="text-sm">📸 {sel.fotos} fotos · {sel.video ? '🎥' : '—'} video · {sel.tour ? '🧭' : '—'} tour</p>
                                    <a href={sel.url} target="_blank" rel="noreferrer" className="text-sm underline" style={{ color: SEA }}>Ver ficha</a>
                                </div>
                                <div className="lg:col-span-2">
                                    <Caption>Leads por fuente de esta propiedad</Caption>
                                    <HBar data={CATS.map((c) => ({ name: c, value: sel.leads[c] || 0 }))} color={SEA} height={260} />
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="text-sm text-neutral-400">Sin propiedades en la selección.</p>
                )}
            </Section>

            <Section title="Alertas">
                {conAlertas.length ? (
                    <DataTable
                        columns={[
                            { key: 'inmobiliaria', label: 'inmobiliaria' },
                            { key: 'kam', label: 'kam' },
                            { key: 'colonia', label: 'colonia' },
                            { key: 'precio', label: 'precio', render: (v) => money(v as number) },
                            { key: 'leads_total', label: 'leads' },
                            { key: 'visitas', label: 'visitas' },
                            { key: 'dias_activa', label: 'días' },
                            { key: 'alertas', label: 'alertas' }
                        ]}
                        rows={conAlertas as unknown as Record<string, unknown>[]}
                    />
                ) : (
                    <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Sin alertas en la selección.</p>
                )}
            </Section>

            <Section title="Desempeño por propiedad (tabla)">
                <DataTable
                    columns={[
                        { key: 'inmobiliaria', label: 'inmobiliaria' },
                        { key: 'kam', label: 'kam' },
                        { key: 'colonia', label: 'colonia' },
                        { key: 'tipo', label: 'tipo' },
                        { key: 'precio', label: 'precio', render: (v) => money(v as number) },
                        { key: 'dias_activa', label: 'días' },
                        { key: 'leads_total', label: 'LEADS' },
                        { key: 'visitas', label: 'visitas' },
                        ...leadColsConDatos.map((c) => ({
                            key: `leads_${c}`,
                            label: c,
                            render: (_: unknown, row: Record<string, unknown>) => String((row.leads as Record<string, number>)[c] || 0)
                        })),
                        { key: 'fotos', label: 'fotos' },
                        { key: 'video', label: 'video', render: (v) => (v ? '🎥' : '—') },
                        { key: 'tour', label: 'tour', render: (v) => (v ? '🧭' : '—') },
                        { key: 'material_ok', label: 'mat.OK', render: (v) => (v ? '✓' : '✗') },
                        { key: 'op_status', label: 'op_status' },
                        { key: 'url', label: 'ficha', render: ficha }
                    ]}
                    rows={f as unknown as Record<string, unknown>[]}
                />
            </Section>
        </div>
    );
}
