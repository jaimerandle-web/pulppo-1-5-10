'use client';
// Vistas del análisis de inventario — COMPARTIDAS por /analisis (KAM) y /mb (Master Brokers).
// Extraídas de analisis/page.tsx sin cambios (mismo look). El modo MB omite DestacadosView y ajusta wording en el consumidor.
import { useState, type ReactNode } from 'react';
import type { AnalisisData, AsesorRow } from '@/lib/analisis';

const SEA = '#529999', SEA_D = '#2f6b6b', SOFT = '#212322', YEL = '#F6BE00', GRAY = '#B7B7B7', RED = '#A52003';
const f0 = (n: number) => Math.round(n).toLocaleString('es-MX');
const money = (n?: number | null) =>
    n == null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
const fmtYoy = (v: number, fmt: string) =>
    fmt === 'money' ? money(v) : fmt === 'pct' ? `${Math.round(v * 100)}%` : fmt === 'pct2' ? `${(v * 100).toFixed(2)}%` : fmt === 'dec' ? v.toFixed(1) : f0(v);

export function GlosarioView({ d, mb = false }: { d: AnalisisData; mb?: boolean }) {
    const terms: [string, ReactNode][] = [
        ['Lead único', <>Un interesado que contacta por la propiedad. Se descartan los <b>duplicados</b> (mismo contacto en la misma propiedad).</>],
        ['L/L · leads por propiedad', <>Promedio de leads que recibe cada propiedad; mide cuánto interés genera tu inventario.</>],
        ['ACM · valor estimado', <>Estimación automática de Pulppo del valor de mercado, a partir de comparables de la zona.</>],
        ['Oferta ($/m²)', <>La <b>mediana</b> del $/m² que se <b>pide</b> en venta en <b>propiedades comparables</b> (misma colonia, tipo, tamaño ±30% y recámaras — mls + red Pulppo). Mediana, no promedio: un solo anuncio absurdo movería el promedio.</>],
        ['Cierres ($/m²)', <>La <b>mediana</b> del $/m² de lo que realmente se <b>vende</b> en comparables ({d.cierresLabel}). Si no hay ≥3 comparables, se amplía el criterio; si aún no, no se muestra.</>],
        ['Demanda de zona', <>Búsquedas de compradores en la colonia ({d.demandaLabel}). Alta demanda + pocos leads = oportunidad.</>],
        ['Absorción', <>Búsquedas ÷ propiedades publicadas en tus zonas (MLS): qué tan caliente está el mercado.</>],
        [mb ? 'Sin actividad reciente' : 'Zombie', <>Propiedad sin un solo lead en la ventana de desempeño ({d.zombie.label}). Primeras a bajar precio o mejorar ficha.</>],
        ['Calidad de ficha', <>Qué tan completa está la publicación (fotos, descripción, video, tour): Alta / Media / Baja.</>],
        ['Destacado · L/L por nivel', <>Inversión en visibilidad. El L/L por nivel dice si destacar rinde más que el aviso simple.</>],
        ['Cliente vs. broker', <>Broker = el contacto está asociado a una inmobiliaria (no comprador final).</>],
        ['Ventana de comparables', <>Las fechas del <b>mercado</b>: cierres ({d.cierresLabel}) y demanda ({d.demandaLabel}). La <b>oferta</b> es una foto de <b>hoy</b>: no se guarda su historia, solo lo que está publicado en este momento.</>],
        ['Ventana de desempeño', <>Las fechas de <b>tu operación</b> ({d.leadsLabel}): funnel, asesores, leads por propiedad y sin actividad. Es la única ventana que se compara contra otro período.</>],
        ['Comparación de períodos', <>La ventana de desempeño contra su base: <b>{d.hasComp ? `${d.compLabels.b} vs. ${d.compLabels.a}` : 'sin comparación'}</b>.</>],
        ['Tasa de respuesta · 1ª respuesta', <>De los leads que le tocaron a un asesor, cuántos contestó y en cuánto tiempo (de <i>createdAt</i> a <i>answeredAt</i>). Se muestra promedio y mediana.</>],
    ];
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px] font-semibold" style={{ color: SOFT }}>Señales de precio <span style={{ color: GRAY }}>(taxonomía del ACM: precio ÷ valor estimado)</span></p>
            <div className="mb-4 flex gap-2">
                {[['Óptimo', '≤ +5%: en línea o por debajo del estimado. El que más interesados atrae.', SEA_D, SEA],
                  ['No competitivo', '+5% a +20% sobre el estimado. Con margen para ajustarse.', SOFT, GRAY],
                  ['Fuera de mercado', '> +20% sobre el estimado. El freno #1 de leads.', RED, RED]].map(([t, desc, txtCol, barCol]) => (
                    <div key={t as string} className="flex-1 bg-[#F3F3F3] p-2.5" style={{ borderTop: `3px solid ${barCol as string}` }}>
                        <p className="text-[11px] font-bold" style={{ color: txtCol as string }}>{t as string}</p>
                        <p className="mt-1 text-[9px] leading-tight" style={{ color: GRAY }}>{desc as string}</p>
                    </div>
                ))}
            </div>
            <p className="mb-1.5 text-[11px] font-semibold" style={{ color: SOFT }}>Glosario de términos</p>
            <div className="grid grid-cols-2 gap-x-6">
                {terms.filter(([term]) => !mb || !term.includes('Destacado')).map(([term, def]) => (
                    <div key={term} className="border-b border-neutral-100 py-1.5">
                        <p className="text-[11px] font-bold">{term}</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: SOFT }}>{def}</p>
                    </div>
                ))}
            </div>
            <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>
                La lógica del reporte: separar un problema de <b>propiedad</b> (precio o ficha, que tú controlas) de uno de <b>mercado</b> (poca demanda en la zona). Donde hay demanda pero no hay leads, casi siempre el freno es precio o ficha.
            </p>
        </div>
    );
}

// ---------- render de secciones con datos reales ----------
const CAL_COL: Record<string, string> = { Alta: '#2f6b6b', Media: '#9CC4C4', Baja: '#E0CFC0' };

export function InventarioView({ d, referencias, cortes, mb = false }: { d: AnalisisData; referencias: string[]; cortes: string[]; mb?: boolean }) {
    const showOferta = referencias.includes('Oferta de zona');
    const showCierres = referencias.includes('Cierres reales');
    const has = (c: string) => cortes.includes(c);
    const delta = (v: number | null) => (
        <span style={{ color: v == null ? GRAY : v > 3 ? RED : v < -3 ? SEA : SOFT, fontWeight: 600 }}>
            {v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`}
        </span>
    );
    const cols = ['Colonia', 'Tus props', 'Oferta zona', ...(showOferta ? ['vs. oferta (mediana)'] : []), ...(showCierres ? ['vs. cierres (mediana)'] : []), `Demanda · ${d.demandaLabel}`, `Leads · ${d.leadsLabel}`];
    // barra simple reutilizable (# de props + leads) para los cortes por tipo/operación
    const maxTipo = Math.max(...d.segTipo.map((t) => t.n), 1);
    const maxOp = Math.max(...d.segOp.map((o) => o.n), 1);
    return (
        <div className="mt-2 pl-6">
            {has('Por zona') && <>
                <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Tus zonas principales: cuánto inventario tienes, la oferta total de la zona y qué tan competitivo es tu precio vs. lo que se pide y lo que se vende.</p>
                <table className="w-full border-collapse text-[11px]">
                    <thead>
                        <tr className="border-b" style={{ borderColor: SOFT }}>
                            {cols.map((h, i) => (
                                <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {d.zones.map((z) => (
                            <tr key={z.nb} className="border-b border-neutral-100">
                                <td className="py-1 font-semibold">{z.nb}</td>
                                <td className="py-1 text-right">{z.n}</td>
                                <td className="py-1 text-right" style={{ color: GRAY }}>{f0(z.oferta)}</td>
                                {showOferta && <td className="py-1 text-right">{delta(z.vsOferta)}</td>}
                                {showCierres && <td className="py-1 text-right">{delta(z.vsCierres)} <span className="text-[8px]" style={{ color: GRAY }}>({z.nCierres})</span></td>}
                                <td className="py-1 text-right">{f0(z.dem)}</td>
                                <td className="py-1 text-right">{f0(z.leads)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-1 text-[9px]" style={{ color: GRAY }}>
                    Oferta zona = propiedades publicadas en la colonia ({d.ofertaLabel}). <b>Siempre mediana, nunca promedio</b> (un solo anuncio con precio absurdo movería el promedio): a cada propiedad tuya se le calcula su $/m² contra la <b>mediana de sus comparables</b> (misma colonia, tipo, tamaño ±30% y recámaras) y de esas diferencias se muestra la <b>mediana de la zona</b>. <b>vs. oferta</b> = contra lo que se <b>pide</b> hoy (MLS completo + red Pulppo, con filtro de extremos); <b>vs. cierres</b> = contra lo que se <b>vendió</b> ({d.cierresLabel}, solo cierres Pulppo). El número entre paréntesis es cuántas de tus propiedades encontraron cierres comparables. <b style={{ color: RED }}>+</b> más caro · <b style={{ color: SEA }}>−</b> más barato. — = sin comparables suficientes.
                </p>
            </>}

            <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: d.zombie.pct > 0.3 ? RED : YEL, background: '#F3F3F3', color: SOFT }}>
                <b style={{ color: d.zombie.pct > 0.3 ? RED : SOFT }}>{f0(d.zombie.n)} propiedades ({Math.round(d.zombie.pct * 100)}%)</b> no han recibido un solo lead en {d.zombie.label} <span style={{ color: GRAY }}>({mb ? 'sin actividad reciente' : '“zombies”'})</span>. Son las primeras candidatas a bajar precio o mejorar ficha.
            </p>

            {has('Por ticket') && <>
                <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>
                    Tu inventario en venta vs. la demanda del mercado, por rango de precio.
                    <span style={{ color: GRAY }}> Barra <b style={{ color: SEA }}>azul</b> = tu inventario · <b style={{ color: '#b8901a' }}>amarilla</b> = lo que busca la gente.</span>
                </p>
                {d.invVsDemand.map((r) => (
                    <div key={r.band} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-12" style={{ color: GRAY }}>{r.band}</span>
                        <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(r.invPct)}%`, background: SEA }} /></span>
                        <span className="w-14 text-right font-bold">{Math.round(r.invPct)}% inv.</span>
                        <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(r.demPct)}%`, background: YEL }} /></span>
                        <span className="w-14 text-right font-bold">{Math.round(r.demPct)}% dem.</span>
                    </div>
                ))}
            </>}

            {has('Por tipo') && d.segTipo.length > 0 && <>
                <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Tu inventario por tipo de propiedad <span style={{ color: GRAY }}>(props · leads {d.leadsLabel})</span></p>
                {d.segTipo.map((t) => (
                    <div key={t.tipo} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-28" style={{ color: GRAY }}>{t.tipo}</span>
                        <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * t.n / maxTipo)}%`, background: SEA }} /></span>
                        <span className="w-24 text-right font-bold">{f0(t.n)} <span style={{ color: GRAY }}>· {f0(t.leads)} leads</span></span>
                    </div>
                ))}
            </>}

            {has('Por operación') && <>
                <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Tu inventario por operación <span style={{ color: GRAY }}>(props · leads {d.leadsLabel})</span></p>
                {d.segOp.map((o) => (
                    <div key={o.op} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-28" style={{ color: GRAY }}>{o.op}</span>
                        <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * o.n / maxOp)}%`, background: o.op === 'Venta' ? SEA_D : SEA }} /></span>
                        <span className="w-24 text-right font-bold">{f0(o.n)} <span style={{ color: GRAY }}>· {f0(o.leads)} leads</span></span>
                    </div>
                ))}
            </>}

            {d.insightInv && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.insightInv}</p>}
        </div>
    );
}

export function PrecioView({ d }: { d: AnalisisData }) {
    const cellBg = (q: string, p: string) =>
        (q === 'Alta' || q === 'Media') && p === 'Óptimo' ? '#DCEBEB' : q === 'Baja' && p === 'Fuera de mercado' ? '#F4DED8' : '#F3F3F3';
    const cols = ['Óptimo', 'No competitivo', 'Fuera de mercado', 'Sin referencia'];
    const mx = Math.max(...d.priceLead.map((x) => x.ll), 0.0001);
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                Solo inventario en <b>venta</b> ({d.nSale} props), por precio vs. mercado (ACM) y calidad de ficha. En cada celda: # de propiedades y su <b>L/L</b> (leads por propiedad).
            </p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr>
                        <th></th>
                        {cols.map((p) => <th key={p} className="pb-1 text-right text-[8px] font-bold uppercase tracking-wide">{p}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {d.matrix.map((row) => (
                        <tr key={row.q}>
                            <td className="py-1 pr-2 text-[11px] font-bold">
                                <span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: CAL_COL[row.q] }} />{row.q}
                            </td>
                            {row.cells.map((c) => (
                                <td key={c.p} className="border-2 border-white p-1.5 text-center align-middle" style={{ background: cellBg(row.q, c.p) }}>
                                    <span className="text-[13px] font-bold">{c.n}</span>
                                    {c.p === 'Sin referencia'
                                        ? <span className="block text-[8px]" style={{ color: '#CFCFCF' }}>—</span>
                                        : <span className="block text-[8px]" style={{ color: GRAY }}>{c.ll.toFixed(1)} L/L</span>}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>
                Taxonomía del ACM: óptimo (≤+5%) · no competitivo (+5% a +20%) · fuera de mercado (&gt;+20%). Sin referencia = sin ACM confiable (sin estimación o ACM atípico); su L/L no se muestra porque no es comparable.
            </p>
            <div className="mt-3 flex gap-2">
                {[[String(d.joyas), 'listas para destacar', SEA, `precio óptimo · ${d.joyasAlta} calidad Alta`],
                  [String(d.caras), 'fuera de mercado', RED, 'ajustar precio antes de invertir'],
                  [`${Math.round(d.pctCaro * 100)}%`, 'de tu venta fuera de mercado', SOFT, 'freno principal de conversión']].map(([n, l, col, sub], i) => (
                    <div key={i} className="flex-1 bg-[#F9F9F9] p-2.5">
                        <p className="text-[20px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{n}</p>
                        <p className="mt-1 text-[9px] leading-tight">{l}</p>
                        <p className="text-[8px] leading-tight" style={{ color: GRAY }}>{sub}</p>
                    </div>
                ))}
            </div>
            <p className="mb-1 mt-4 text-[11px] font-semibold" style={{ color: SOFT }}>Leads por precio de la propiedad.</p>
            {d.priceLead.map((r) => (
                <div key={r.cls} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <span className="w-28 font-bold">{r.cls}</span>
                    <span className="h-[12px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * r.ll / mx)}%`, background: SEA }} /></span>
                    <span className="w-24 text-right font-bold">{r.ll.toFixed(1)} <span style={{ color: GRAY }}>L/L · {r.props} props</span></span>
                </div>
            ))}
            {d.insightPrecio && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.insightPrecio}</p>}
        </div>
    );
}

export function FunnelView({ d, portalMode, portales }: { d: AnalisisData; portalMode: string; portales: string[] }) {
    const mx = Math.max(...d.funnel.flatMap((c) => c.steps.map((s) => s.value)), 1);
    const srcTotal = d.leadsBySource.reduce((a, s) => a + s.n, 0) || 1;
    const srcShown = portalMode === 'Fuentes principales'
        ? d.leadsBySource.filter((s) => portales.includes(s.source))
        : d.leadsBySource;
    const srcMx = Math.max(...srcShown.map((s) => s.n), 1);
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>Actividad de <b>{d.leadsLabel}</b> sobre tu inventario. La tasa es el % que pasa del paso anterior. <span style={{ color: GRAY }}>Únicos = sin duplicados (los incontactables van en la composición).</span></p>
            <div className="flex gap-6">
                {d.funnel.map((col) => (
                    <div key={col.title} className="flex-1">
                        <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#2f6b6b' }}>{col.title}</p>
                        {col.steps.map((s) => (
                            <div key={s.label} className="flex items-center gap-1.5 py-0.5 text-[10px]">
                                <span className="w-16 whitespace-nowrap" style={{ color: GRAY }}>{s.label}</span>
                                <span className="w-8 text-right text-[9px] font-bold" style={{ color: SEA }}>{s.rate == null ? '' : `${Math.round(s.rate * 100)}%`}</span>
                                <span className="h-[13px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * s.value / mx)}%`, background: '#2f6b6b' }} /></span>
                                <span className="w-10 text-right font-bold">{f0(s.value)}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            {portalMode !== 'Análisis general (sin desglose)' && srcShown.length > 0 && (
                <>
                    <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Qué mueve tus leads · por fuente</p>
                    {srcShown.map((s) => (
                        <div key={s.source} className="flex items-center gap-2 py-0.5 text-[10px]">
                            <span className="w-24" style={{ color: GRAY }}>{s.source}</span>
                            <span className="h-[11px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * s.n / srcMx)}%`, background: SEA }} /></span>
                            <span className="w-24 text-right font-bold">{f0(s.n)} <span style={{ color: GRAY }}>· {Math.round(100 * s.n / srcTotal)}%</span></span>
                        </div>
                    ))}
                </>
            )}
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Composición de tus leads únicos · {d.leadsLabel}</p>
            <div className="flex gap-2">
                {[['Cliente', d.leadsComp.cliente, SEA_D], ['Broker', d.leadsComp.broker, GRAY], ['Sin contacto', d.leadsComp.incontactables, RED],
                  ['Venta', d.leadsComp.totalOp.sale, SEA], ['Renta', d.leadsComp.totalOp.rent, '#9CC4C4']].map(([l, n, col]) => (
                    <div key={l as string} className="flex-1 bg-[#F3F3F3] p-2">
                        <p className="text-[16px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{f0(n as number)}</p>
                        <p className="mt-1 text-[8px] leading-tight text-neutral-500">{l as string}</p>
                    </div>
                ))}
            </div>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>Broker = el contacto está asociado a una empresa/inmobiliaria (no comprador final). Sin contacto = sin teléfono ni correo.</p>
            {(() => {
                const tot = d.leadsComp.total || 1;
                const gross = tot + d.leadsComp.duplicados || 1;
                const brPct = Math.round(100 * d.leadsComp.broker / tot);
                const dupPct = Math.round(100 * d.leadsComp.duplicados / gross);
                return (
                    <p className="mt-2 text-[11px] leading-relaxed" style={{ color: SOFT }}>
                        <b>{brPct}%</b> de tus leads únicos son de <b>brokers</b> (no compradores finales) · se quitaron <b>{f0(d.leadsComp.duplicados)}</b> duplicados ({dupPct}% del bruto: mismo contacto en la misma propiedad).
                    </p>
                );
            })()}
            {d.funnelReading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.funnelReading}</p>}
        </div>
    );
}

export function RecoView({ d, enfoque, tono, cantidad }: { d: AnalisisData; enfoque: string[]; tono: string; cantidad: string }) {
    let pool = enfoque.length ? d.recos.filter((r) => enfoque.includes(r.enfoque)) : d.recos;
    if (!pool.length) pool = d.recos;
    const n = cantidad === 'Top 3' ? 3 : cantidad === 'Top 6' ? 6 : 10;
    const list = [...pool].sort((a, b) => b.sev - a.sev).slice(0, n);
    // Tono: sugerente suaviza el imperativo del título.
    const soften = (t: string) => tono === 'Sugerente' ? `Considera ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t;
    return (
        <div className="mt-2 pl-6">
            {list.map((r, i) => (
                <div key={i} className="flex gap-3 border-b border-neutral-100 py-2.5">
                    <span className="text-[22px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: SEA, width: 26, flexShrink: 0 }}>{i + 1}</span>
                    <div>
                        <p className="text-[12px] font-bold">{soften(r.title)} <span className="ml-1 text-[8px] uppercase tracking-wide" style={{ color: GRAY }}>· {r.enfoque}</span></p>
                        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: SOFT }}>{r.body}</p>
                    </div>
                </div>
            ))}
            {!list.length && <p className="py-4 text-[11px]" style={{ color: GRAY }}>Sin recomendaciones para el enfoque elegido.</p>}
        </div>
    );
}

const TIER_COL: Record<string, string> = { 'Súper destacado': SEA_D, 'Destacado': SEA, 'Simple': '#CFCFCF', 'Offline': '#EDEDED' };

export function DestacadosView({ d }: { d: AnalisisData }) {
    const de = d.destacados;
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                {de.pctDest < 0.05 ? 'Hoy prácticamente nada de tu inventario está destacado' : `Hoy ${Math.round(de.pctDest * 100)}% de tu inventario está destacado`}. <span style={{ color: GRAY }}>El aviso destacado lo cubre Pulppo.</span>
            </p>
            <div className="flex gap-2">
                {[['Súper destacados', de.sdNow, SEA_D, de.splits.sd], ['Destacados', de.dNow, SEA, de.splits.d], ['Aviso simple', de.simpleNow, GRAY, de.splits.simple]].map(([l, n, col, sp]) => {
                    const s = sp as { sale: number; rent: number };
                    return (
                        <div key={l as string} className="flex-1 bg-[#F3F3F3] p-2.5">
                            <p className="text-[22px] leading-none" style={{ fontFamily: 'var(--font-serif)', color: col as string }}>{f0(n as number)}</p>
                            <p className="mt-1 text-[9px] leading-tight">{l as string} hoy</p>
                            <p className="text-[8px] leading-tight" style={{ color: GRAY }}>{s.sale} venta · {s.rent} renta</p>
                        </div>
                    );
                })}
            </div>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Cómo se ha destacado, mes a mes <span style={{ color: GRAY }}>(nivel del aviso al cierre de cada mes)</span></p>
            <div className="mb-1.5 flex flex-wrap gap-3 text-[9px]" style={{ color: GRAY }}>
                {['Súper destacado', 'Destacado', 'Simple'].map((t) => (
                    <span key={t}><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: TIER_COL[t] }} />{t}</span>
                ))}
            </div>
            {de.monthly.map((mo) => {
                const tot = mo.tiers.reduce((a, t) => a + t.n, 0) || 1;
                return (
                    <div key={mo.month} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-8" style={{ color: GRAY }}>{mo.month}</span>
                        <span className="flex h-[12px] flex-1 overflow-hidden bg-[#F3F3F3]">
                            {mo.tiers.filter((t) => t.n > 0).map((t) => (
                                <span key={t.tier} className="block h-full" style={{ width: `${100 * t.n / tot}%`, background: TIER_COL[t.tier] }} />
                            ))}
                        </span>
                        <span className="w-14 text-right font-bold">{mo.dest} dest.</span>
                    </div>
                );
            })}
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Qué tanto rinde destacar — venta vs. renta <span style={{ color: GRAY }}>(L/L = leads por aviso al mes)</span></p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['Nivel de aviso', 'L/L Venta', 'L/L Renta'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {de.llTier.map((r) => (
                        <tr key={r.tier} className="border-b border-neutral-100">
                            <td className="py-1"><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: TIER_COL[r.tier] }} />{r.tier}</td>
                            <td className="py-1 text-right">{r.saleLL == null ? '—' : r.saleLL.toFixed(1)} <span style={{ color: GRAY }}>· {r.saleLeads} leads</span></td>
                            <td className="py-1 text-right">{r.rentLL == null ? '—' : r.rentLL.toFixed(1)} <span style={{ color: GRAY }}>· {r.rentLeads} leads</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>Nivel reconstruido del historial de cada aviso; leads (únicos) atribuidos al nivel que tenía el aviso cuando llegó el contacto. L/L = leads ÷ aviso-meses en ese nivel (— si &lt;3 aviso-meses).</p>
            {de.reading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{de.reading}</p>}
        </div>
    );
}

export function YoyView({ d }: { d: AnalisisData }) {
    if (!d.hasComp) {
        return (
            <p className="mt-2 border-l-2 px-3 py-2 pl-6 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>
                Elegiste <b>sin comparación</b>: el reporte muestra <b>{d.leadsLabel}</b> solo. Para ver la variación,
                elige una base de comparación (<i>período anterior</i> o <i>mismo período del año pasado</i>).
            </p>
        );
    }
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}><b>{d.compLabels.b}</b> vs. <b>{d.compLabels.a}</b>. <span style={{ color: GRAY }}>Inventario = foto al cierre del período; leads/cierres/comisión = lo que pasó dentro del período. La calidad de ficha es la de hoy, aplicada a las propiedades que estaban activas en cada período.</span></p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['Métrica', d.compLabels.a, d.compLabels.b, 'Variación'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {d.yoy.map((r) => {
                        // base en cero: un porcentaje sería falso (0 → 1,023 no es "+0%")
                        const nuevo = !r.a && !!r.b;
                        const dv = r.a ? (r.b - r.a) / r.a : 0;
                        const col = nuevo ? (r.goodUp ? SEA : RED) : (dv >= 0) === r.goodUp ? SEA : RED;
                        return (
                            <tr key={r.label} className="border-b border-neutral-100">
                                <td className="py-1">{r.label}</td>
                                <td className="py-1 text-right">{fmtYoy(r.a, r.fmt)}</td>
                                <td className="py-1 text-right">{fmtYoy(r.b, r.fmt)}</td>
                                <td className="py-1 text-right font-semibold" style={{ color: nuevo || dv ? col : GRAY }}>
                                    {nuevo ? 'nuevo' : !r.a && !r.b ? '—' : <>{dv >= 0 ? '▲' : '▼'} {dv >= 0 ? '+' : ''}{Math.round(dv * 100)}%</>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="mb-1.5 mt-4 text-[11px]" style={{ color: SOFT }}>Mix de cierres <span style={{ color: GRAY }}>(<b style={{ color: SEA_D }}>venta</b> · <b style={{ color: SEA }}>renta</b>)</span></p>
            {d.yoyMix.map((m) => {
                const tot = m.sale + m.rent || 1;
                return (
                    <div key={m.period} className="flex items-center gap-2 py-0.5 text-[10px]">
                        <span className="w-20" style={{ color: GRAY }}>{m.period}</span>
                        <span className="flex h-[12px] flex-1 overflow-hidden bg-[#F3F3F3]">
                            <span className="block h-full" style={{ width: `${100 * m.sale / tot}%`, background: SEA_D }} />
                            <span className="block h-full" style={{ width: `${100 * m.rent / tot}%`, background: SEA }} />
                        </span>
                        <span className="w-28 text-right font-bold">{m.sale} venta · {m.rent} renta</span>
                    </div>
                );
            })}
            {d.yoyReading && <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>{d.yoyReading}</p>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// ASESORES — el funnel comercial persona por persona, dentro de la ventana de desempeño.
// Todo se puede leer en total o desglosado venta/renta; comisión % y ticket SIEMPRE van
// partidos, porque un ticket de renta y uno de venta no son la misma cosa.
// ---------------------------------------------------------------------------
type Vista = 'Total' | 'Venta' | 'Renta';
const pick = (v: Vista, o: { sale: number; rent: number }) => v === 'Venta' ? o.sale : v === 'Renta' ? o.rent : o.sale + o.rent;
const pickN = (v: Vista, o: { sale: number | null; rent: number | null }, w: { sale: number; rent: number }) => {
    if (v === 'Venta') return o.sale;
    if (v === 'Renta') return o.rent;
    // total = promedio ponderado por volumen de cada operación
    const n = (o.sale != null ? w.sale : 0) + (o.rent != null ? w.rent : 0);
    if (!n) return null;
    return ((o.sale ?? 0) * w.sale + (o.rent ?? 0) * w.rent) / n;
};
const dur = (min: number | null) => {
    if (min == null) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    if (min < 1440) return `${(min / 60).toFixed(1)} h`;
    return `${(min / 1440).toFixed(1)} d`;
};
const rate = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—');

export function AsesoresView({ d }: { d: AnalisisData }) {
    const [vista, setVista] = useState<Vista>('Total');
    if (!d.asesores.length) return <p className="mt-2 pl-6 text-[11px]" style={{ color: GRAY }}>Sin asesores con inventario publicado.</p>;

    const tot = d.asesores.reduce((a, r) => ({
        leads: { sale: a.leads.sale + r.leads.sale, rent: a.leads.rent + r.leads.rent },
        resp: { sale: a.resp.sale + r.resp.sale, rent: a.resp.rent + r.resp.rent },
        visitas: { sale: a.visitas.sale + r.visitas.sale, rent: a.visitas.rent + r.visitas.rent },
        ofertas: { sale: a.ofertas.sale + r.ofertas.sale, rent: a.ofertas.rent + r.ofertas.rent },
        cierres: { sale: a.cierres.sale + r.cierres.sale, rent: a.cierres.rent + r.cierres.rent },
        comision: { sale: a.comision.sale + r.comision.sale, rent: a.comision.rent + r.comision.rent },
        gmv: { sale: a.gmv.sale + r.gmv.sale, rent: a.gmv.rent + r.gmv.rent },
    }), { leads: { sale: 0, rent: 0 }, resp: { sale: 0, rent: 0 }, visitas: { sale: 0, rent: 0 }, ofertas: { sale: 0, rent: 0 },
        cierres: { sale: 0, rent: 0 }, comision: { sale: 0, rent: 0 }, gmv: { sale: 0, rent: 0 } });
    // tiempo de respuesta del total: ponderado por leads respondidos de cada operación
    const totAvg = pickN(vista, {
        sale: d.asesores.some((r) => r.respMinAvg.sale != null)
            ? d.asesores.reduce((a, r) => a + (r.respMinAvg.sale ?? 0) * r.resp.sale, 0) / (tot.resp.sale || 1) : null,
        rent: d.asesores.some((r) => r.respMinAvg.rent != null)
            ? d.asesores.reduce((a, r) => a + (r.respMinAvg.rent ?? 0) * r.resp.rent, 0) / (tot.resp.rent || 1) : null,
    }, tot.resp);

    const COLS = ['Asesor', 'Leads', 'Respondidos', 'Tasa resp.', '1ª respuesta (prom.)', '1ª respuesta (mediana)',
        'Visitas', 'Tasa visita', 'Ofertas', 'Tasa oferta', 'Cierres', 'Visita→cierre',
        'Comisión', '% com. venta', '% com. renta', 'Ticket venta', 'Ticket renta'];
    const pctCom = (com: number, gmv: number) => (gmv > 0 ? `${(100 * com / gmv).toFixed(1)}%` : '—');
    const ticket = (gmv: number, n: number) => (n > 0 ? money(gmv / n) : '—');

    const cells = (r: AsesorRow | typeof tot, name: string, bold = false) => {
        const L = pick(vista, r.leads), R = pick(vista, r.resp), V = pick(vista, r.visitas);
        const O = pick(vista, r.ofertas), C = pick(vista, r.cierres);
        const avg = 'respMinAvg' in r ? pickN(vista, r.respMinAvg, r.resp) : totAvg;
        const med = 'respMinMed' in r ? pickN(vista, r.respMinMed, r.resp) : null;
        const cls = `py-1 text-right${bold ? ' font-bold' : ''}`;
        return (
            <tr key={name} className={bold ? 'border-t' : 'border-b border-neutral-100'} style={bold ? { borderColor: SOFT } : undefined}>
                <td className={`py-1 text-left${bold ? ' font-bold' : ' font-semibold'}`}>{name}</td>
                <td className={cls}>{f0(L)}</td>
                <td className={cls}>{f0(R)}</td>
                <td className={cls} style={{ color: L && R / L < 0.8 ? RED : SOFT }}>{rate(R, L)}</td>
                <td className={cls} style={{ color: avg != null && avg > 1440 ? RED : SOFT }}>{dur(avg)}</td>
                <td className={cls} style={{ color: GRAY }}>{'respMinMed' in r ? dur(med) : '—'}</td>
                <td className={cls}>{f0(V)}</td>
                <td className={cls}>{rate(V, L)}</td>
                <td className={cls}>{f0(O)}</td>
                <td className={cls}>{rate(O, V)}</td>
                <td className={cls}>{f0(C)}</td>
                <td className={cls}>{rate(C, V)}</td>
                <td className={cls}>{money(pick(vista, r.comision))}</td>
                <td className={cls} style={{ color: GRAY }}>{pctCom(r.comision.sale, r.gmv.sale)}</td>
                <td className={cls} style={{ color: GRAY }}>{pctCom(r.comision.rent, r.gmv.rent)}</td>
                <td className={cls}>{ticket(r.gmv.sale, r.cierres.sale)}</td>
                <td className={cls}>{ticket(r.gmv.rent, r.cierres.rent)}</td>
            </tr>
        );
    };

    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                Desempeño por asesor en <b>{d.leadsLabel}</b>. El lead se le cuenta al asesor <b>responsable</b> de atenderlo;
                la visita, a quien la hizo; la oferta y el cierre, al asesor de tu inmobiliaria que participó en la operación.
            </p>
            <div className="mb-2 flex gap-2">
                {(['Total', 'Venta', 'Renta'] as Vista[]).map((v) => (
                    <button key={v} onClick={() => setVista(v)}
                        className={`rounded-[2px] border px-2.5 py-1 text-[10px] font-semibold transition-colors ${vista === v
                            ? 'border-transparent bg-[#212322] text-white' : 'border-neutral-300 bg-white text-[#212322] hover:bg-neutral-50'}`}>
                        {v}
                    </button>
                ))}
                <span className="self-center text-[9px]" style={{ color: GRAY }}>
                    El desglose cambia leads/visitas/ofertas/cierres/comisión. % de comisión y ticket van siempre partidos.
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-[10px]">
                    <thead>
                        <tr className="border-b" style={{ borderColor: SOFT }}>
                            {COLS.map((h, i) => (
                                <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {d.asesores.map((r) => cells(r, r.name))}
                        {cells(tot, 'Total inmobiliaria', true)}
                    </tbody>
                </table>
            </div>
            <p className="mt-1 text-[9px]" style={{ color: GRAY }}>
                Tasa resp. = respondidos ÷ leads · tasa visita = visitas ÷ leads · tasa oferta = ofertas ÷ visitas · visita→cierre = cierres ÷ visitas.
                La <b>1ª respuesta</b> se mide de <i>createdAt</i> a <i>answeredAt</i> del lead; se muestra promedio y mediana porque el promedio
                lo distorsionan unos pocos leads contestados días después. <b>% de comisión</b> = comisión ÷ valor de cierre; <b>ticket</b> = valor
                de cierre promedio (en renta es la renta mensual, por eso nunca se suma con venta).
            </p>
        </div>
    );
}

export function Top10View({ d }: { d: AnalisisData }) {
    if (!d.top10.length) return <p className="mt-2 pl-6 text-[11px]" style={{ color: GRAY }}>Sin propiedades críticas con palanca accionable en zonas con demanda.</p>;
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Alta demanda en su zona pero pocos o cero leads, con un freno claro y fácil de arreglar. Prioriza estas.</p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['#', 'Código', 'Zona', 'Precio', 'vs. mercado', 'Leads', 'Demanda', 'Qué cambiar'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i === 1 || i === 2 || i === 7 ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {d.top10.map((t, i) => (
                        <tr key={i} className="border-b border-neutral-100">
                            <td className="py-1 text-right">{i + 1}</td>
                            <td className="py-1 font-semibold">{t.code}</td>
                            <td className="py-1">{t.nb}</td>
                            <td className="py-1 text-right">{money(t.val)}</td>
                            <td className="py-1 text-right" style={{ color: t.sp && t.sp > 1.2 ? RED : SOFT }}>{t.sp ? `+${Math.round((t.sp - 1) * 100)}%` : '—'}</td>
                            <td className="py-1 text-right">{t.leads}</td>
                            <td className="py-1 text-right">{f0(t.dz)}</td>
                            <td className="py-1">{t.lev.map((l, j) => {
                                const col = l.startsWith('Bajar') ? RED : l.startsWith('Destacar') ? SEA : SOFT;
                                return <span key={l} style={{ color: col, fontWeight: 700 }}>{j ? ' · ' : ''}{l}</span>;
                            })}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-2 text-[9px]" style={{ color: GRAY }}>Demanda = búsquedas de la colonia en la ventana elegida. Vs. mercado = precio ÷ ACM.</p>
        </div>
    );
}
