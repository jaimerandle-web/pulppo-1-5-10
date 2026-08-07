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
const median = (xs: number[]): number | null => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
};

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
        ['Abandono · fuera de SLA', <>Abandono = leads que el asesor <b>nunca</b> contestó. Fuera de SLA 24h = los contestados después de 24 h más los que nunca contestó.</>],
        ['Props x cliente', <>Propiedades que el asesor le compartió a cada cliente en su búsqueda. Mide <b>trabajo</b>: quien comparte una sola opción no está trabajando la cartera.</>],
        ['Mejores inmobiliarias', <>Las <b>{d.bench.nInmos}</b> que más cierran en la red, en la misma ventana. Convierten a visita {d.bench.tasaVisita == null ? '—' : `${Math.round(100 * d.bench.tasaVisita)}%`} vs. ~10% del resto, así que es la referencia que importa (contra el promedio casi todos salen bien).</>],
    ];
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px] font-semibold" style={{ color: SOFT }}>Señales de precio <span style={{ color: GRAY }}>(taxonomía del ACM: precio ÷ valor estimado)</span></p>
            <div className="mb-4 flex gap-2">
                {[['Óptimo', '≤ +5%: en línea o por debajo del estimado. El que más interesados atrae.', SEA_D, SEA],
                  ['No competitivo', '+5% a +20% sobre el estimado. Con margen para ajustarse.', SOFT, YEL],
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
    const cols = ['Colonia', 'Tus props', 'Oferta zona', ...(showOferta ? ['vs. oferta'] : []), ...(showCierres ? ['vs. cierres'] : []), 'Demanda', 'Leads'];
    // barra simple reutilizable (# de props + leads) para los cortes por tipo/operación
    const maxTipo = Math.max(...d.segTipo.map((t) => t.n), 1);
    const maxOp = Math.max(...d.segOp.map((o) => o.n), 1);
    return (
        <div className="mt-2 pl-6">
            {has('Por zona') && <>
                <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Tus zonas principales: cuánto inventario tienes, la competencia de la zona y qué tan competitivo es tu <b>precio $/m²</b> contra lo que se pide y lo que se vende. <span style={{ color: GRAY }}>Demanda = búsquedas de {d.demandaLabel} · leads de {d.leadsLabel}.</span></p>
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
                                {/* demanda y leads son del período → llevan ▲▼; las columnas de
                                    arriba son foto de hoy y no se pueden comparar */}
                                <td className="py-1 text-right whitespace-nowrap">{f0(z.dem)} <Delta now={z.dem} prev={z.demPrev} /></td>
                                <td className="py-1 text-right whitespace-nowrap">{f0(z.leads)} <Delta now={z.leads} prev={z.leadsPrev} /></td>
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

// ▲▼ contra el período base. Se usa en el funnel y en los KPIs para que el "vs" se vea
// DENTRO de cada sección y no solo en la sección de comparación.
export function Delta({ now, prev, goodUp = true }: { now: number; prev: number | null; goodUp?: boolean }) {
    if (prev == null) return null;
    if (!prev) return <span className="text-[9px]" style={{ color: GRAY }}>{now ? 'nuevo' : '—'}</span>;
    const dv = (now - prev) / prev;
    const col = (dv >= 0) === goodUp ? SEA : RED;
    return (
        <span className="text-[9px] font-bold" style={{ color: dv === 0 ? GRAY : col }}>
            {dv === 0 ? '=' : `${dv > 0 ? '▲' : '▼'}${Math.abs(Math.round(dv * 100))}%`}
        </span>
    );
}

// Delta de una TASA: va en PUNTOS, no en %. Si la tasa de visita pasa de 15% a 18% eso es
// "+3 pts"; decir "+20%" exagera la mejora y es la clase de número que se cita mal en una junta.
function DeltaPts({ now, prev, goodUp = true }: { now: number | null; prev: number | null; goodUp?: boolean }) {
    if (now == null || prev == null) return null;
    const pts = Math.round((now - prev) * 100);
    const col = (pts >= 0) === goodUp ? SEA : RED;
    return (
        <span className="text-[9px] font-bold" style={{ color: pts === 0 ? GRAY : col }}>
            {pts === 0 ? '=' : `${pts > 0 ? '▲' : '▼'}${Math.abs(pts)} pts`}
        </span>
    );
}

// Delta de un TIEMPO de respuesta: bajar es mejorar, y se dice en la unidad del tiempo.
function DeltaTiempo({ now, prev }: { now: number | null; prev: number | null }) {
    if (now == null || prev == null || !prev) return null;
    const dv = (now - prev) / prev;
    if (Math.abs(dv) < 0.05) return <span className="text-[9px]" style={{ color: GRAY }}>=</span>;
    return (
        <span className="text-[9px] font-bold" style={{ color: dv < 0 ? SEA : RED }}>
            {dv < 0 ? '▼' : '▲'}{Math.abs(Math.round(dv * 100))}%
        </span>
    );
}

export function FunnelView({ d, portalMode, portales }: { d: AnalisisData; portalMode: string; portales: string[] }) {
    const mx = Math.max(...d.funnel.flatMap((c) => c.steps.map((s) => s.value)), 1);
    const srcTotal = d.leadsBySource.reduce((a, s) => a + s.n, 0) || 1;
    const srcShown = portalMode === 'Fuentes principales'
        ? d.leadsBySource.filter((s) => portales.includes(s.source))
        : d.leadsBySource;
    const srcMx = Math.max(...srcShown.map((s) => s.n), 1);
    // tasa de respuesta y tiempo: lo que más pesa en la conversión, arriba del embudo
    const tl = d.funnel.reduce((a, c) => a + (c.steps[0]?.value || 0), 0);
    const tr = d.funnel.reduce((a, c) => a + (c.steps[1]?.value || 0), 0);
    const tv = d.funnel.reduce((a, c) => a + (c.steps[2]?.value || 0), 0);
    const tc = d.funnel.reduce((a, c) => a + (c.steps[4]?.value || 0), 0);
    const tMed = median(d.asesores.flatMap((a) => [a.respMinMed.sale, a.respMinMed.rent]).filter((x): x is number => x != null));
    return (
        <div className="mt-2 pl-6">
            <p className="mb-2 text-[11px]" style={{ color: SOFT }}>
                Actividad de <b>{d.leadsLabel}</b> sobre tu inventario. La tasa es el % que pasa del paso anterior
                {d.hasComp && <> y el <b>▲▼</b> compara contra <b>{d.compLabels.a}</b></>}.
            </p>
            {/* los tres números que mandan, con la referencia de las mejores inmobiliarias */}
            <div className="mb-3 flex gap-2">
                {[
                    ['Tasa de respuesta', tl ? `${Math.round(100 * tr / tl)}%` : '—', d.bench.tasaResp != null ? `mejores ${Math.round(100 * d.bench.tasaResp)}%` : ''],
                    ['1ª respuesta (mediana)', tMed == null ? '—' : tMed < 60 ? `${Math.round(tMed)} min` : `${(tMed / 60).toFixed(1)} h`, 'meta ≤ 24 h'],
                    ['Tasa de visita', tl ? `${Math.round(100 * tv / tl)}%` : '—', d.bench.tasaVisita != null ? `mejores ${Math.round(100 * d.bench.tasaVisita)}%` : ''],
                    ['Lead → cierre', tl ? `${(100 * tc / tl).toFixed(2)}%` : '—', d.bench.leadToClose != null ? `mejores ${(100 * d.bench.leadToClose).toFixed(2)}%` : ''],
                ].map(([l, v, ref]) => (
                    <div key={l} className="flex-1 bg-[#F3F3F3] p-2">
                        <p className="text-[8px] uppercase tracking-wide" style={{ color: GRAY }}>{l}</p>
                        <p className="text-[17px] leading-tight" style={{ fontFamily: 'var(--font-serif)' }}>{v}</p>
                        {ref && <p className="text-[8px]" style={{ color: GRAY }}>{ref}</p>}
                    </div>
                ))}
            </div>
            <div className="flex gap-6">
                {d.funnel.map((col) => (
                    <div key={col.title} className="flex-1">
                        <p className="mb-1.5 text-[12px] font-bold" style={{ color: '#2f6b6b' }}>{col.title}</p>
                        {col.steps.map((s) => (
                            <div key={s.label} className="flex items-center gap-1.5 py-0.5 text-[10px]">
                                <span className="w-[68px] whitespace-nowrap" style={{ color: GRAY }}>{s.label}</span>
                                <span className="w-8 text-right text-[9px] font-bold" style={{ color: SEA }}>{s.rate == null ? '' : `${Math.round(s.rate * 100)}%`}</span>
                                <span className="h-[13px] flex-1 bg-[#F3F3F3]"><span className="block h-full" style={{ width: `${Math.round(100 * s.value / mx)}%`, background: '#2f6b6b' }} /></span>
                                <span className="w-10 text-right font-bold">{f0(s.value)}</span>
                                <span className="w-10 text-right"><Delta now={s.value} prev={s.prev} /></span>
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

    const pair = (f: (r: AsesorRow) => { sale: number; rent: number }) =>
        d.asesores.reduce((a, r) => ({ sale: a.sale + f(r).sale, rent: a.rent + f(r).rent }), { sale: 0, rent: 0 });
    const tot = {
        leads: pair((r) => r.leads), resp: pair((r) => r.resp), fueraSla: pair((r) => r.fueraSla),
        visitas: pair((r) => r.visitas), ofertas: pair((r) => r.ofertas), cierres: pair((r) => r.cierres),
        comision: pair((r) => r.comision), gmv: pair((r) => r.gmv),
        busquedas: d.asesores.reduce((a, r) => a + r.busquedas, 0),
        propsCompartidas: d.asesores.reduce((a, r) => a + r.propsCompartidas, 0),
        clientes: d.asesores.reduce((a, r) => a + r.clientes, 0),
    };
    // mediana del equipo = mediana de las medianas de cada asesor (no se puede promediar medianas)
    const totMed = median(d.asesores
        .map((r) => pickN(vista, r.respMinMed, r.resp))
        .filter((x): x is number => x != null));

    const COLS = ['Asesor', 'Leads', 'Sin responder', 'Abandono', 'Fuera de SLA 24h', '1ª respuesta (mediana)',
        'Búsquedas', 'Props x cliente', 'Visitas', 'Tasa visita', 'Ofertas', 'Cierres', 'Visita→cierre',
        'Comisión', '% com. venta', '% com. renta', 'Ticket venta', 'Ticket renta'];
    const pctCom = (com: number, gmv: number) => (gmv > 0 ? `${(100 * com / gmv).toFixed(1)}%` : '—');
    const ticket = (gmv: number, n: number) => (n > 0 ? money(gmv / n) : '—');
    const benchVis = d.bench.tasaVisita;

    // El período base NO viene partido venta/renta, así que el ▲▼ solo se muestra en la vista
    // Total: comparar "leads de venta de julio" contra "leads totales de junio" sería falso.
    const totPrev = d.asesores.some((a) => a.prev)
        ? d.asesores.reduce((acc, a) => ({
            leads: acc.leads + (a.prev?.leads ?? 0), resp: acc.resp + (a.prev?.resp ?? 0),
            visitas: acc.visitas + (a.prev?.visitas ?? 0), cierres: acc.cierres + (a.prev?.cierres ?? 0),
            respMinMed: acc.respMinMed,
        }), { leads: 0, resp: 0, visitas: 0, cierres: 0, respMinMed: median(d.asesores.map((a) => a.prev?.respMinMed ?? null).filter((x): x is number => x != null)) })
        : null;

    const cells = (r: AsesorRow | typeof tot, name: string, bold = false) => {
        const pv = vista === 'Total' ? ('prev' in r ? r.prev : totPrev) : null;
        const L = pick(vista, r.leads), R = pick(vista, r.resp), V = pick(vista, r.visitas);
        const O = pick(vista, r.ofertas), C = pick(vista, r.cierres);
        const sla = pick(vista, r.fueraSla), sin = L - R;
        const med = 'respMinMed' in r ? pickN(vista, r.respMinMed, r.resp) : totMed;
        const bus = 'busquedas' in r ? r.busquedas : tot.busquedas;
        const pxc = 'clientes' in r ? (r.clientes ? r.propsCompartidas / r.clientes : null)
            : (tot.clientes ? tot.propsCompartidas / tot.clientes : null);
        const cls = `py-1 text-right${bold ? ' font-bold' : ''}`;
        // umbrales: abandono ≥15% y fuera de SLA ≥25% son incumplimientos, no matices
        const colAband = L >= 10 && sin / L >= 0.15 ? RED : SOFT;
        const colSla = L >= 10 && sla / L >= 0.25 ? RED : SOFT;
        const colVis = benchVis != null && L >= 20 ? (V / L >= benchVis ? SEA : V / L < benchVis / 2 ? RED : SOFT) : SOFT;
        return (
            <tr key={name} className={bold ? 'border-t' : 'border-b border-neutral-100'} style={bold ? { borderColor: SOFT } : undefined}>
                <td className={`py-1 text-left${bold ? ' font-bold' : ' font-semibold'}`}>{name}</td>
                {/* el ▲▼ va debajo del número: la tabla ya tiene 18 columnas, una por delta la rompe */}
                <td className={cls}>{f0(L)}{pv && <div><Delta now={L} prev={pv.leads} /></div>}</td>
                <td className={cls} style={{ color: colAband }}>{f0(sin)}</td>
                <td className={cls} style={{ color: colAband }}>
                    {rate(sin, L)}
                    {pv && <div><DeltaPts now={L ? sin / L : null} prev={pv.leads ? (pv.leads - pv.resp) / pv.leads : null} goodUp={false} /></div>}
                </td>
                <td className={cls} style={{ color: colSla }}>{rate(sla, L)}</td>
                <td className={cls}>{dur(med)}{pv && <div><DeltaTiempo now={med} prev={pv.respMinMed} /></div>}</td>
                <td className={cls} style={{ color: GRAY }}>{f0(bus)}</td>
                <td className={cls} style={{ color: GRAY }}>{pxc == null ? '—' : pxc.toFixed(1)}</td>
                <td className={cls}>{f0(V)}{pv && <div><Delta now={V} prev={pv.visitas} /></div>}</td>
                <td className={cls} style={{ color: colVis, fontWeight: 700 }}>
                    {rate(V, L)}
                    {pv && <div><DeltaPts now={L ? V / L : null} prev={pv.leads ? pv.visitas / pv.leads : null} /></div>}
                </td>
                <td className={cls}>{f0(O)}</td>
                <td className={cls}>{f0(C)}{pv && <div><Delta now={C} prev={pv.cierres} /></div>}</td>
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
                Tus asesores en <b>{d.leadsLabel}</b>. El lead se le cuenta al asesor <b>responsable</b> de atenderlo;
                la visita, a quien la hizo; la oferta y el cierre, al asesor que participó en la operación.
                Solo aparecen asesores <b>de tu inmobiliaria</b>.
            </p>
            {/* Con filtro por asesor la tabla trae a TODOS los que atendieron leads de SU inventario,
                que no es lo mismo que "su desempeño". Hay que decirlo o el lector se confunde. */}
            {d.asesorFiltro && (
                <p className="mb-2 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>
                    El reporte está acotado a la cartera de <b>{d.asesorFiltro}</b>, así que aquí aparece <b>quién atendió
                    los leads de sus propiedades</b> — puede ser {d.asesorFiltro.split(' ')[0]} u otro compañero del equipo.
                </p>
            )}
            {(d.externo.leads > 0 || d.externo.visitas > 0) && (
                <p className="mb-2 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: SEA, background: '#F3F3F3', color: SOFT }}>
                    Además, brokers de <b>otras inmobiliarias</b> de la red trabajaron tu inventario:
                    {' '}<b>{f0(d.externo.visitas)}</b> visitas ({Math.round(100 * d.externo.pctVisitas)}% del total)
                    {' '}y <b>{f0(d.externo.leads)}</b> leads atendidos. No van en la tabla porque no son tu equipo,
                    pero sí son ventas potenciales de tus propiedades.
                </p>
            )}
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
                <table className="w-full min-w-[1080px] border-collapse text-[10px]">
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
                <b>Abandono</b> = leads que nunca contestó ÷ sus leads (rojo desde 15%). <b>Fuera de SLA 24h</b> = contestados después
                de 24 h <i>más</i> los que nunca contestó (rojo desde 25%) — un lead sin contestar es peor que uno contestado tarde,
                por eso cuenta aquí. <b>1ª respuesta</b> en mediana, no promedio: unos pocos leads contestados días después
                destruyen el promedio. <b>Búsquedas</b> = búsquedas de comprador que abrió en el período; <b>props x cliente</b> =
                propiedades que le compartió a cada cliente (mide trabajo, no suerte). <b>Tasa visita</b> en verde si iguala a las
                mejores inmobiliarias{benchVis != null && ` (${Math.round(100 * benchVis)}%)`}, en rojo si no llega a la mitad.
                <b> % de comisión</b> = comisión ÷ valor de cierre; <b>ticket</b> = valor de cierre promedio (en renta es la renta
                mensual, por eso nunca se suma con venta).
                {d.hasComp && <> El <b>▲▼</b> debajo de cada número compara contra <b>{d.compLabels.a}</b>: en conteos va en %,
                    en <b>tasas va en puntos</b> (de 15% a 18% son <i>+3 pts</i>, no +20%) y en <b>tiempo de respuesta bajar es
                    mejorar</b>. Solo aparece en la vista <b>Total</b>, porque el período base no viene partido venta/renta.</>}
            </p>
            {(() => {
                // recap de la sección: los hechos que se ven en la tabla, dichos en una línea
                const conVol = d.asesores.filter((r) => r.leads.sale + r.leads.rent >= 10);
                if (!conVol.length) return null;
                const malSla = conVol.filter((r) => {
                    const L = r.leads.sale + r.leads.rent;
                    return (r.fueraSla.sale + r.fueraSla.rent) / L >= 0.25;
                });
                const abandona = conVol.filter((r) => {
                    const L = r.leads.sale + r.leads.rent;
                    return (L - r.resp.sale - r.resp.rent) / L >= 0.15;
                });
                const pxc = tot.clientes ? tot.propsCompartidas / tot.clientes : null;
                const L = tot.leads.sale + tot.leads.rent, V = tot.visitas.sale + tot.visitas.rent;
                const vsBench = benchVis != null && L
                    ? (V / L >= benchVis ? 'a la altura de las mejores' : `debajo de las mejores (${Math.round(100 * benchVis)}%)`)
                    : null;
                return (
                    <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: malSla.length ? RED : YEL, background: '#F3F3F3', color: SOFT }}>
                        <b>{conVol.length}</b> {conVol.length === 1 ? 'asesor' : 'asesores'} con volumen suficiente para evaluar.
                        {malSla.length > 0
                            ? <> <b style={{ color: RED }}>{malSla.length}</b> deja más de una cuarta parte de sus leads fuera de las 24 h
                                {malSla.length <= 3 && <> ({malSla.map((r) => r.name).join(', ')})</>}.</>
                            : <> Todos responden dentro de las 24 h a la mayoría de sus leads.</>}
                        {abandona.length > 0 && <> <b style={{ color: RED }}>{abandona.length}</b> abandona 15% o más de sus leads.</>}
                        {pxc != null && <> El equipo comparte <b>{pxc.toFixed(1)}</b> propiedades por cliente.</>}
                        {vsBench && <> En tasa de visita el equipo está <b>{vsBench}</b>.</>}
                    </p>
                );
            })()}
        </div>
    );
}

// Tag de acción. Marca: rojo para precio, amarillo con texto negro para ficha, verde mar para
// visibilidad. Nunca texto suelto: en tabla los textos largos se empalman con la columna vecina.
export function Tag({ t }: { t: string }) {
    const s = t.startsWith('Bajar') ? { bg: '#F3D9D3', fg: RED }
        : t.startsWith('Destacar') ? { bg: '#DCEBEB', fg: SEA_D }
            : { bg: YEL, fg: SOFT };
    return (
        <span style={{ background: s.bg, color: s.fg, fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 2, whiteSpace: 'nowrap', display: 'inline-block', marginRight: 3, marginBottom: 2 }}>{t}</span>
    );
}

export function Top10View({ d }: { d: AnalisisData }) {
    if (!d.top10.length) return <p className="mt-2 pl-6 text-[11px]" style={{ color: GRAY }}>Sin propiedades críticas con palanca accionable en zonas con demanda.</p>;
    // recap de la sección: qué frena a estas propiedades, en una línea
    const conPrecio = d.top10.filter((t) => t.lev.some((l) => l.startsWith('Bajar'))).length;
    const conFicha = d.top10.filter((t) => t.lev.some((l) => l.startsWith('Mejorar'))).length;
    const sinLead = d.top10.filter((t) => !t.leads).length;
    const demTot = d.top10.reduce((a, t) => a + t.dz, 0);
    return (
        <div className="mt-2 pl-6">
            <p className="mb-1.5 text-[11px]" style={{ color: SOFT }}>Alta demanda en su zona pero pocos o cero leads, con un freno claro y fácil de arreglar. Prioriza estas.</p>
            <table className="w-full border-collapse text-[11px]">
                <thead>
                    <tr className="border-b" style={{ borderColor: SOFT }}>
                        {['#', 'Código', 'Zona', 'Precio', 'vs. mercado', 'Leads', 'Demanda', 'Qué cambiar'].map((h, i) => (
                            <th key={h} className={`py-1 text-[8px] font-bold uppercase tracking-wide ${i === 1 || i === 2 || i === 7 ? 'text-left' : 'text-right'}`}
                                style={i === 7 ? { paddingLeft: 14, width: '30%' } : undefined}>{h}</th>
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
                            <td className="py-1 pr-2 text-right">{f0(t.dz)}</td>
                            {/* los textos largos iban sueltos y se empalmaban con Demanda; ahora son tags */}
                            <td className="py-1 pl-3.5">{t.lev.map((l) => <Tag key={l} t={l} />)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-2 text-[9px]" style={{ color: GRAY }}>Demanda = búsquedas de la colonia en la ventana elegida. Vs. mercado = precio ÷ ACM.</p>
            <p className="mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: YEL, background: '#F3F3F3', color: SOFT }}>
                Estas <b>{d.top10.length}</b> propiedades tienen <b>{f0(demTot)}</b> búsquedas de compradores detrás
                {sinLead > 0 && <> y <b>{sinLead}</b> no ha recibido un solo lead</>}.
                {conPrecio > 0 && <> El freno de <b>{conPrecio}</b> es el <b>precio</b>{conFicha > 0 && <> y el de <b>{conFicha}</b> la <b>ficha</b></>}.</>}
                {conPrecio === 0 && conFicha > 0 && <> El freno de <b>{conFicha}</b> es la <b>ficha</b>.</>}
                {' '}Es demanda que ya está ahí: no hay que salir a buscarla, hay que dejar de desperdiciarla.
            </p>
        </div>
    );
}
