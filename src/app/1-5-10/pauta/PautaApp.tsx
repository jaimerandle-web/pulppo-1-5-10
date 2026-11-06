'use client';

// Pauta de Meta para las exclusivas 1·5·10. Para quien monta las campañas: por cluster
// (zona × rango de precio), cada propiedad con su inmobiliaria, artes en 4 tamaños, cortes de
// video de Drive, copies, segmentación y la liga con UTM. Las inmobiliarias suspendidas y lo que
// no es vivienda salen aparte, con el motivo, para que nadie les invierta por error.
// Arriba, el Plan del mes (lib/pauta/mes.ts): instrucciones para montar, cada campaña con su paquete
// y lo que queda fuera con el motivo.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FORMATOS, precioLargo, urlArte } from '@/lib/pauta/armado';
import type { PautaProp } from '@/lib/pauta';
import type { CampanaPlan, FueraMes } from '@/lib/pauta/plan';
import type { Mes } from '@/lib/pauta/mes';
import type { Excluida } from '@/lib/pauta/excluidas';

interface Payload {
    props: PautaProp[];
    plan: CampanaPlan[];
    fuera: FueraMes[];
    faltan: string[];
    mes: Mes;
    excluidas: Excluida[];
    corteHistorial: string;
    corteVideos: string;
    carpetaVideos: string;
}

const thumb = (raw: string | null) =>
    raw && /^https?:\/\/images\.pulppo\.com\//i.test(raw)
        ? `https://pulppo.com/_next/image?url=${encodeURIComponent(raw)}&w=640&q=70`
        : raw || '';

function Copiar({ texto, label = 'Copiar' }: { texto: string; label?: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1200); }}
            className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
        >
            {ok ? 'Copiado' : label}
        </button>
    );
}

function Paquete({ p }: { p: PautaProp }) {
    const s = p.seg;
    const segTexto = [
        `Ubicación: ${s.ubicacion}`, `Edad: ${s.edad}`, `Intereses: ${s.intereses.join(', ')}`,
        `Público: ${s.publico}`, `Objetivo: ${s.objetivo}`, `Presupuesto: ${s.presupuesto}`, `Ubicaciones: ${s.ubicaciones}`
    ].join('\n');
    return (
        <div className="mt-4 grid gap-6 border-t border-neutral-200 pt-4 lg:grid-cols-2">
            <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Artes</h4>
                <div className="grid grid-cols-4 items-end gap-2">
                    {FORMATOS.map((f) => (
                        <a key={f.id} href={urlArte(p.code, f.id, true)} className="group block" title={`${f.nombre} · ${f.uso}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={urlArte(p.code, f.id)} alt={f.nombre} loading="lazy" className="w-full border border-neutral-200 bg-light" />
                            <span className="mt-1 block text-[11px] text-neutral-600 group-hover:underline">{f.nombre} ↓</span>
                        </a>
                    ))}
                </div>

                <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-500">Video</h4>
                {p.videos.length ? (
                    <ul className="space-y-1 text-sm">
                        {p.videos.map((v) => (
                            <li key={v.formato}><a href={v.url} target="_blank" rel="noreferrer" className="underline">Corte {v.formato.replace('x', ':')} en Drive</a></li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-neutral-600">
                        Sin corte en Drive. {p.youtube ? <>Hay recorrido en <a href={p.youtube} target="_blank" rel="noreferrer" className="underline">YouTube</a>, pero Meta no lo acepta: hay que pedir el .mp4 a multimedia.</> : 'Sale sólo con artes.'}
                    </p>
                )}

                <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-500">Campaña y liga</h4>
                <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2"><code className="break-all text-xs">{p.campana}</code><Copiar texto={p.campana} /></div>
                    <div className="flex items-start gap-2"><code className="break-all text-xs text-neutral-600">{p.urlUtm}</code><Copiar texto={p.urlUtm} /></div>
                    <p className="text-xs text-neutral-500">El nombre de la campaña va igual en el utm_campaign: así el lead llega al CRM ligado a esta campaña.</p>
                </div>
            </div>

            <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Textos principales (creativo dinámico)</h4>
                <ul className="space-y-2">
                    {p.copies.textos.map((t) => (
                        <li key={t.angulo} className="flex items-start gap-2 rounded bg-light p-2 text-sm">
                            <div className="flex-1"><span className="mr-1 text-[11px] font-bold uppercase text-neutral-500">{t.angulo}</span>{t.texto}</div>
                            <Copiar texto={t.texto} />
                        </li>
                    ))}
                </ul>
                <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-neutral-500">Títulos · descripción · botón</h4>
                <ul className="space-y-1 text-sm">
                    {p.copies.titulos.map((t) => <li key={t} className="flex items-center gap-2"><span className="flex-1">{t}</span><Copiar texto={t} /></li>)}
                    <li className="flex items-center gap-2 text-neutral-600"><span className="flex-1">{p.copies.descripcion}</span><Copiar texto={p.copies.descripcion} /></li>
                    <li className="text-neutral-600">Botón: {p.copies.cta}</li>
                </ul>

                <div className="mb-2 mt-4 flex items-center gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Segmentación</h4>
                    <Copiar texto={segTexto} label="Copiar todo" />
                </div>
                <dl className="space-y-1 text-sm">
                    <div><dt className="inline font-semibold">Ubicación: </dt><dd className="inline">{s.ubicacion}</dd></div>
                    <div><dt className="inline font-semibold">Edad: </dt><dd className="inline">{s.edad}</dd></div>
                    <div><dt className="inline font-semibold">Intereses: </dt><dd className="inline">{s.intereses.join(', ')}</dd></div>
                    <div><dt className="inline font-semibold">Público: </dt><dd className="inline">{s.publico}</dd></div>
                    <div><dt className="inline font-semibold">Objetivo: </dt><dd className="inline">{s.objetivo}</dd></div>
                    <div><dt className="inline font-semibold">Presupuesto: </dt><dd className="inline">{s.presupuesto}</dd></div>
                </dl>
            </div>
        </div>
    );
}

function Tarjeta({ p }: { p: PautaProp }) {
    const [abierta, setAbierta] = useState(false);
    const datos = [
        p.rec ? `${p.rec} rec` : null, p.banos ? `${p.banos} baños` : null,
        p.m2 ? `${Math.round(p.m2)} m²` : null, p.park ? `${p.park} est.` : null
    ].filter(Boolean).join(' · ');
    const h = p.historial;
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(p.foto)} alt="" loading="lazy" className="h-24 w-32 shrink-0 bg-light object-cover" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                        <a href={p.url} target="_blank" rel="noreferrer" className="font-bold hover:underline">{p.code}</a>
                        {p.estrella && <span className="rounded-full bg-brand-yellow px-2 py-0.5 text-[11px] font-bold">Estrella</span>}
                        <span className="text-sm font-semibold">{p.inmobiliaria}</span>
                        <span className="text-sm text-neutral-500">{p.tipo} · {p.colonia}{p.ciudad ? `, ${p.ciudad}` : ''}</span>
                    </div>
                    <div className="mt-1 font-serif text-xl">{precioLargo(p.precio)}</div>
                    <div className="text-sm text-neutral-600">{datos}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-neutral-500">
                        <span>{p.videos.length ? `Video en Drive (${p.videos.length} cortes)` : 'Sin video en Drive'}</span>
                        {p.demanda && <span>60 días fuera de Meta: {p.demanda.leads} personas · {p.demanda.visitas} visitas{p.demanda.leadsMeta ? ` · Meta ${p.demanda.leadsMeta}` : ''}</span>}
                        {h ? <span>Ya pautada: ${h.gasto.toLocaleString('es-MX')} · {h.leads} leads · {h.visitas} visitas{h.leads ? ` · $${Math.round(h.gasto / h.leads)}/lead` : ''}</span> : <span>Nunca pautada en Meta</span>}
                    </div>
                    {p.avisos.length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-l-2 border-brand-yellow pl-2 text-xs text-neutral-700">
                            {p.avisos.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                    )}
                </div>
                <button type="button" onClick={() => setAbierta(!abierta)}
                    className="h-fit shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
                    {abierta ? 'Cerrar' : 'Ver paquete'}
                </button>
            </div>
            {abierta && <Paquete p={p} />}
        </div>
    );
}

const ETIQUETA: Record<CampanaPlan['tipo'], string> = { reactivacion: 'Reactivación', sola: 'Estrella sola', carrusel: 'Carrusel', remarketing: 'Remarketing' };
const money = (n: number) => `$${n.toLocaleString('es-MX')}`;

function Carrusel({ c }: { c: CampanaPlan }) {
    const seg = [`Ubicación: ${c.ubicacion}`, `Edad: ${c.edad}`,
        c.tipo === 'remarketing'
            ? 'Público personalizado (incluir): visitantes de pulppo.com cuya URL contiene "/propiedades/" en los últimos 30 días + quien interactuó con la página o el Instagram de Pulppo en 60 días + quien vio 50%+ de un video de 1·5·10. Excluir: evento Lead del pixel en 30 días (ya escribieron). Advantage+ audience APAGADO.'
            : `Intereses: ${c.intereses?.join(', ')}`,
        'Objetivo: Clientes potenciales · conversión en el sitio (clic al botón de WhatsApp de la ficha)',
        'Formato: carrusel, una tarjeta por propiedad en este orden. Desactivar "mostrar primero la tarjeta con mejor rendimiento" para que la 1ª sea la de más demanda.'].join('\n');
    return (
        <div className="mt-4 space-y-5 border-t border-neutral-200 pt-4">
            <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Tarjetas (1080×1080, en orden)</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {c.tarjetas!.map((t, i) => (
                        <div key={t.code} className="text-xs">
                            <a href={urlArte(t.code, 'card', true)} title="Descargar">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={urlArte(t.code, 'card')} alt={t.titulo} loading="lazy" className="w-full border border-neutral-200 bg-light" />
                            </a>
                            <div className="mt-1 font-semibold">{i + 1}. {t.code}{t.video ? ' · video' : ''}</div>
                            <div className="text-neutral-600">{t.inmobiliaria}</div>
                            <div className="mt-1 flex items-start gap-1"><span className="flex-1">{t.titulo}</span><Copiar texto={t.titulo} /></div>
                            <div className="mt-1 flex items-start gap-1 text-neutral-600"><span className="flex-1">{t.descripcion}</span><Copiar texto={t.descripcion} /></div>
                            <div className="mt-1"><Copiar texto={t.url} label="Copiar liga" /></div>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-xs text-neutral-500">Cada liga lleva utm_campaign = nombre del carrusel y utm_content = código: el lead llega al CRM con su tarjeta. Si la tarjeta tiene video en Drive, puede ir en lugar de la imagen.</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">Texto principal (arriba del carrusel)</h4>
                    <ul className="space-y-2">
                        {c.textos!.map((t) => (
                            <li key={t} className="flex items-start gap-2 rounded bg-light p-2 text-sm"><span className="flex-1">{t}</span><Copiar texto={t} /></li>
                        ))}
                    </ul>
                </div>
                <div>
                    <div className="mb-2 flex items-center gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Segmentación</h4>
                        <Copiar texto={seg} label="Copiar todo" />
                    </div>
                    <p className="whitespace-pre-line text-sm">{seg}</p>
                </div>
            </div>
        </div>
    );
}

function Brief({ c }: { c: CampanaPlan }) {
    const r = c.brief!;
    const h4 = 'mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500';
    return (
        <div className="mt-4 space-y-5 border-t border-neutral-200 pt-4 text-sm">
            <div className="rounded bg-light p-3">
                <b>Campaña anterior:</b> <code className="text-xs">{r.anterior.nombre}</code> (id {r.anterior.id}) · {r.anterior.periodo}
                <div className="mt-1">{r.anterior.resultado}</div>
            </div>
            <div>
                <h4 className={h4}>Antes de prender (sin esto no sale)</h4>
                <ul className="space-y-1">{r.condiciones.map((x) => <li key={x}>☐ {x}</li>)}</ul>
            </div>
            <div>
                <h4 className={h4}>Qué cambia</h4>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left">
                        <thead><tr className="border-b border-neutral-300 text-xs text-neutral-500"><th className="py-1 pr-3">Tema</th><th className="py-1 pr-3">Antes</th><th className="py-1">Ahora</th></tr></thead>
                        <tbody>{r.cambios.map((x) => (
                            <tr key={x.tema} className="border-b border-neutral-100 align-top">
                                <td className="py-1.5 pr-3 font-semibold">{x.tema}</td>
                                <td className="py-1.5 pr-3 text-neutral-500">{x.antes}</td>
                                <td className="py-1.5">{x.despues}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <h4 className={h4}>Texto principal</h4>
                    <ul className="space-y-2">{r.textos.map((t) => (
                        <li key={t} className="flex items-start gap-2 rounded bg-light p-2"><span className="flex-1">{t}</span><Copiar texto={t} /></li>
                    ))}</ul>
                    <div className="mt-2 flex items-start gap-2"><span className="flex-1"><b>Título:</b> {r.titulo}</span><Copiar texto={r.titulo} /></div>
                    <p className="mt-2 text-neutral-600"><b>Anuncios:</b> {r.anuncios}</p>
                </div>
                <div>
                    <div className="mb-2 flex items-center gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Formulario de mayor intención</h4>
                        <Copiar texto={r.formulario.join('\n')} label="Copiar preguntas" />
                    </div>
                    <ol className="list-decimal space-y-1 pl-5">{r.formulario.map((x) => <li key={x}>{x}</li>)}</ol>
                    <div className="mt-3 flex items-start gap-2"><span className="flex-1 break-all text-xs"><b>Liga (pantalla final y remarketing):</b> {c.url}</span><Copiar texto={c.url!} label="Copiar liga" /></div>
                </div>
            </div>
            <div>
                <h4 className={h4}>Medición</h4>
                <ul className="list-disc space-y-1 pl-5">{r.medicion.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <p className="rounded bg-brand-yellow/40 p-3"><b>Regla para apagar:</b> {r.reglaApagado}</p>
        </div>
    );
}

function FilaPlan({ c, props }: { c: CampanaPlan; props: PautaProp[] }) {
    const [abierta, setAbierta] = useState(c.tipo === 'reactivacion');
    const ps = c.codes.map((k) => props.find((p) => p.code === k)).filter(Boolean) as PautaProp[];
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.tipo === 'reactivacion' ? 'bg-soft text-white' : c.mitad === 'estrellas' ? 'bg-brand-yellow' : 'bg-light'}`}>{ETIQUETA[c.tipo]}</span>
                        <span className="font-semibold">{c.cluster}</span>
                        <code className="text-xs text-neutral-500">{c.nombre}</code>
                        <Copiar texto={c.nombre} />
                    </div>
                    <div className="mt-1 text-sm text-neutral-700">{c.razon}</div>
                    <div className="mt-1 text-xs text-neutral-500">{ps.map((p) => `${p.code} (${p.inmobiliaria})`).join(' · ')}</div>
                </div>
                <div className="text-right">
                    <div className="font-serif text-2xl">{money(c.presupuesto)}</div>
                    <div className="text-xs text-neutral-500">al mes · ${Math.round(c.presupuesto / 30)} al día</div>
                </div>
                <button type="button" onClick={() => setAbierta(!abierta)}
                    className="h-fit shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
                    {abierta ? 'Cerrar' : 'Ver paquete'}
                </button>
            </div>
            {abierta && c.brief && <Brief c={c} />}
            {abierta && (c.tarjetas ? <Carrusel c={c} /> : <div className="mt-4">{ps.map((p) => <Tarjeta key={p.code} p={p} />)}</div>)}
        </div>
    );
}

// Instrucciones para quien monta (Habi). Lo que no cambia de un mes a otro.
const PASOS: [string, string][] = [
    ['Una campaña por fila', 'Cada fila de abajo es UNA campaña. El nombre va exacto (botón Copiar): es el mismo utm_campaign de las ligas y así el lead llega al CRM con su campaña.'],
    ['Presupuesto', 'Presupuesto diario de campaña = el monto al día de cada fila ($1,500 al mes = $50 al día). Ninguna campaña pasa de $1,500 al mes. Total del mes: $13,000.'],
    ['Objetivo', 'Clientes potenciales · conversión en el sitio web · evento Lead del pixel de Pulppo (es el clic al botón de WhatsApp de la ficha). Excepción: la reactivación de DLI-815 va con formulario instantáneo (ver su brief).'],
    ['Ubicaciones', 'Advantage+ (automáticas). En las estrellas solas, subir los 4 tamaños del arte para que Meta use el correcto en cada lugar.'],
    ['Carruseles', 'Una tarjeta por propiedad, en el orden de la página, con el arte de tarjeta (1080×1080) y la liga de esa tarjeta (lleva utm_content = código). Desactivar "Mostrar primero las tarjetas con mejor rendimiento". Si la tarjeta tiene video en Drive, puede ir el corte 1:1 en lugar de la imagen.'],
    ['Copy', 'Cargar los 3 textos principales como variantes (creativo dinámico). Sin emojis. Botón: Enviar mensaje por WhatsApp o Más información.'],
    ['Lo que NO se pauta', 'Sólo las campañas de esta página. Lo de "Fuera este mes" y las inmobiliarias excluidas no llevan un peso.'],
    ['Si una propiedad recibe oferta', 'Pausar su tarjeta o su campaña y avisar a Ale.']
];

function Plan({ d }: { d: Payload }) {
    const m = d.mes;
    const total = d.plan.reduce((s, c) => s + c.presupuesto, 0);
    const suma = (mitad: CampanaPlan['mitad']) => d.plan.filter((c) => c.mitad === mitad).reduce((s, c) => s + c.presupuesto, 0);
    const grupos: [string, CampanaPlan[]][] = [
        ['Mitad estrellas', d.plan.filter((c) => c.mitad === 'estrellas')],
        ['Mitad prueba', d.plan.filter((c) => c.mitad === 'prueba')],
        ['Remarketing (compartido)', d.plan.filter((c) => c.mitad === 'compartido')]
    ];
    const h3 = 'mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500';
    return (
        <div className="space-y-6">
            <div className="rounded-lg bg-light p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="font-serif text-2xl">Plan de {m.periodo}</h2>
                    <a href="/api/pauta?format=csv&tipo=plan" className="rounded-lg bg-soft px-3 py-1.5 text-white hover:opacity-90">Descargar plan (CSV)</a>
                </div>
                <p className="mt-2">
                    <b>{money(total)}</b> al mes en {d.plan.length} campañas (tope {money(m.tope)} por campaña):
                    estrellas <b>{money(suma('estrellas'))}</b> · prueba <b>{money(suma('prueba'))}</b> · remarketing <b>{money(suma('compartido'))}</b>.
                    Arranca el {m.desde}; revisión de tarjetas el <b>{m.revision}</b>.
                </p>
                {total !== m.total && <p className="mt-2 text-brand-red">Ojo: el plan suma {money(total)} y el presupuesto del mes es {money(m.total)}.</p>}
                {d.faltan.length > 0 && <p className="mt-2 text-brand-red">Ya no están vivas o salieron de pauta: {d.faltan.join(', ')}. Avisar a Ale para reemplazarlas.</p>}
                <p className="mt-2 text-neutral-700">
                    Mitad estrellas: la misma estrella sola contra la estrella en carrusel, para saber qué rinde más. Las solas rotan cada mes.
                    Mitad prueba: carruseles por cluster y la reactivación de DLI-815.
                </p>
            </div>

            <details className="rounded-lg border border-neutral-200 p-4 text-sm" open>
                <summary className="cursor-pointer font-semibold">Cómo montar este mes</summary>
                <ol className="mt-3 list-decimal space-y-2 pl-5">
                    {PASOS.map(([t, x]) => <li key={t}><b>{t}.</b> {x}</li>)}
                    <li>
                        <b>Revisión del {m.revision}.</b> En cada carrusel, la tarjeta con 0 clics se cambia por otra del mismo cluster (pedir el reemplazo a Ale).
                        La que trae visitas sube a carrusel de estrellas el mes siguiente. Si una campaña gastó $750 sin un solo lead en el CRM, se pausa.
                    </li>
                </ol>
            </details>

            {grupos.map(([titulo, cs]) => cs.length > 0 && (
                <section key={titulo}>
                    <h3 className={h3}>{titulo} · {money(cs.reduce((s, c) => s + c.presupuesto, 0))}</h3>
                    <div className="space-y-3">{cs.map((c) => <FilaPlan key={c.nombre} c={c} props={d.props} />)}</div>
                </section>
            ))}

            <details className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Fuera este mes ({d.fuera.length}) — no se pautan</summary>
                <ul className="mt-3 space-y-1.5">
                    {d.fuera.map((x) => (
                        <li key={x.code}><b>{x.code}</b> <span className="text-neutral-600">({x.inmobiliaria}, {x.donde})</span>: {x.motivo}</li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

// Ligas personales de los externos de pauta (Habi). Sólo responde a internos: a un externo el
// endpoint le da 403 y aquí no se pinta nada.
function AccesoExternos() {
    const [ligas, setLigas] = useState<{ email: string; url: string }[]>([]);
    useEffect(() => {
        fetch('/api/pauta/acceso').then((r) => (r.ok ? r.json() : { ligas: [] })).then((j) => setLigas(j.ligas || [])).catch(() => {});
    }, []);
    if (!ligas.length) return null;
    return (
        <details className="mb-6 rounded-lg border border-neutral-200 p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Acceso de Habi ({ligas.length}) — sólo lo ve el equipo Pulppo</summary>
            <p className="mt-2 text-neutral-600">
                No tienen usuario en la plataforma Pulppo, así que el botón de Google les dice &quot;No agent found&quot;. Entran con su liga personal
                (dura 90 días por navegador, sólo abre esta página). Es personal: no reenviar. Para quitar el acceso, sacar el email de <code>src/lib/accesoPauta.ts</code>.
            </p>
            <ul className="mt-2 space-y-1">
                {ligas.map((l) => <li key={l.email} className="flex items-center gap-2"><span className="flex-1">{l.email}</span><Copiar texto={l.url} label="Copiar liga" /></li>)}
            </ul>
        </details>
    );
}

export default function PautaApp() {
    const router = useRouter();
    const [d, setD] = useState<Payload | null>(null);
    const [error, setError] = useState('');
    const [cluster, setCluster] = useState('');
    const [inmo, setInmo] = useState('');
    const [soloVideo, setSoloVideo] = useState(false);
    const [vista, setVista] = useState<'plan' | 'props'>('plan');

    useEffect(() => {
        fetch('/api/pauta')
            .then(async (r) => {
                if (r.status === 401) { router.push('/login'); return; }
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || 'Error');
                setD(j);
            })
            .catch((e) => setError(e.message));
    }, [router]);

    const pautables = useMemo(() => (d?.props || []).filter((p) => !p.excluida), [d]);
    const fuera = useMemo(() => (d?.props || []).filter((p) => p.excluida), [d]);
    const filtradas = pautables.filter((p) =>
        (!cluster || p.cluster === cluster) && (!inmo || p.inmobiliaria === inmo) && (!soloVideo || p.videos.length));
    const grupos = useMemo(() => {
        const m = new Map<string, PautaProp[]>();
        for (const p of filtradas) m.set(p.cluster, [...(m.get(p.cluster) || []), p]);
        return [...m.entries()];
    }, [filtradas]);
    const clusters = [...new Set(pautables.map((p) => p.cluster))];
    const inmos = [...new Set(pautables.map((p) => p.inmobiliaria))].sort((a, b) => a.localeCompare(b, 'es'));
    const fueraPorMotivo = useMemo(() => {
        const m = new Map<string, PautaProp[]>();
        for (const p of fuera) {
            const k = p.excluida!.motivo.includes('vivienda') ? 'No es vivienda: la pauta B2C es sólo casa y departamento' : `${p.inmobiliaria} · ${p.excluida!.motivo}`;
            m.set(k, [...(m.get(k) || []), p]);
        }
        return [...m.entries()];
    }, [fuera]);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-serif text-3xl">Pauta de Meta · Exclusivas 1·5·10</h1>
                    <p className="text-sm text-neutral-600">Paquete por propiedad para montar las campañas: artes, video, copies, segmentación y liga con UTM.</p>
                </div>
                <div className="flex gap-2 text-sm">
                    <a href="/1-5-10" className="rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">← 1·5·10</a>
                    <a href="/api/pauta?format=csv" className="rounded-lg bg-soft px-3 py-1.5 text-white hover:opacity-90">Descargar todo (CSV)</a>
                </div>
            </div>

            {error && <p className="text-brand-red">{error}</p>}
            {!d && !error && <p className="text-neutral-500">Cargando las exclusivas…</p>}

            {d && (
                <>
                    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
                        {[
                            ['Activas en el programa', d.props.length],
                            ['Se pueden pautar', pautables.length],
                            ['Fuera de pauta', fuera.length],
                            ['Con video en Drive', pautables.filter((p) => p.videos.length).length],
                            ['Estrellas', pautables.filter((p) => p.estrella).length]
                        ].map(([l, v]) => (
                            <div key={l} className="rounded-lg bg-light p-3">
                                <div className="text-xs text-neutral-600">{l}</div>
                                <div className="font-serif text-2xl">{v}</div>
                            </div>
                        ))}
                    </div>

                    <AccesoExternos />

                    {fuera.length > 0 && (
                        <details className="mb-6 rounded-lg border border-neutral-200 p-4">
                            <summary className="cursor-pointer text-sm font-semibold">Fuera de pauta ({fuera.length}) — no invertir</summary>
                            <div className="mt-3 space-y-3 text-sm">
                                {fueraPorMotivo.map(([motivo, ps]) => (
                                    <div key={motivo}>
                                        <div className="font-semibold">{motivo} ({ps.length})</div>
                                        <div className="text-neutral-600">{ps.map((p) => `${p.code} (${p.inmobiliaria}, ${p.colonia || p.ciudad})`).join(' · ')}</div>
                                    </div>
                                ))}
                                <p className="text-xs text-neutral-500">La lista de inmobiliarias suspendidas está en <code>src/lib/pauta/excluidas.ts</code>.</p>
                            </div>
                        </details>
                    )}

                    <div className="mb-5 flex gap-1 border-b border-neutral-200">
                        {([['plan', 'Plan y presupuesto'], ['props', 'Por propiedad']] as const).map(([id, label]) => (
                            <button key={id} type="button" onClick={() => setVista(id)}
                                className={`px-4 py-2.5 text-sm font-semibold ${vista === id ? 'border-b-2 border-brand-yellow' : 'text-neutral-400 hover:text-neutral-600'}`}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {vista === 'plan' && <Plan d={d} />}

                    {vista === 'props' && <>
                    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                        <select value={cluster} onChange={(e) => setCluster(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5">
                            <option value="">Todos los clusters</option>
                            {clusters.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <select value={inmo} onChange={(e) => setInmo(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5">
                            <option value="">Todas las inmobiliarias</option>
                            {inmos.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={soloVideo} onChange={(e) => setSoloVideo(e.target.checked)} /> Sólo con video
                        </label>
                        <span className="text-neutral-500">{filtradas.length} propiedades</span>
                    </div>

                    <div className="space-y-8">
                        {grupos.map(([c, ps]) => (
                            <section key={c}>
                                <h2 className="mb-2 font-serif text-2xl">{c} <span className="text-base text-neutral-500">· {ps.length}</span></h2>
                                <div className="space-y-3">{ps.map((p) => <Tarjeta key={p.code} p={p} />)}</div>
                            </section>
                        ))}
                    </div>
                    </>}

                    <p className="mt-8 text-xs text-neutral-500">
                        Historial de Meta al {d.corteHistorial} (gasto en Meta y leads/visitas en el CRM). Cortes de video al {d.corteVideos}, de la{' '}
                        <a href={d.carpetaVideos} target="_blank" rel="noreferrer" className="underline">carpeta de multimedia</a>. Foto del arte = la portada de la propiedad.
                    </p>
                </>
            )}
        </main>
    );
}
