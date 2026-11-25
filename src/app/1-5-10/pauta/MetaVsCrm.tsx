'use client';

// «Meta vs CRM»: por campaña B2C, lo que Ads Manager reporta contra lo que llegó al CRM (lib/pauta/desempeno.ts).
// Para Habi: ver cuánta discrepancia hay y de dónde sale, sin cruzar a mano.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Desempeno, FilaDesempeno } from '@/lib/pauta/desempeno';

const money = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`;
const num = (n: number) => n.toLocaleString('es-MX');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ESTADO: Record<string, string> = { ACTIVE: 'Activa', PAUSED: 'Pausada', CAMPAIGN_PAUSED: 'Pausada', ARCHIVED: 'Archivada', DELETED: 'Borrada', WITH_ISSUES: 'Con problemas' };

type Fila = Omit<FilaDesempeno, 'mes' | 'sinEtiqueta'> & { sinEtiqueta: number | null; meses: number };

function sumar(filas: FilaDesempeno[]): Fila[] {
    const m = new Map<string, Fila>();
    for (const f of filas) {
        const a = m.get(f.campana);
        if (!a) { m.set(f.campana, { ...f, meses: 1 }); continue; }
        for (const k of ['gasto', 'impresiones', 'clics', 'clicWa', 'formulario', 'conversaciones', 'leadsMeta', 'leadsCrm', 'personas', 'visitaron', 'ofertaron'] as const) a[k] += f[k];
        a.sinEtiqueta = a.sinEtiqueta == null && f.sinEtiqueta == null ? null : (a.sinEtiqueta ?? 0) + (f.sinEtiqueta ?? 0);
        a.meses++;
    }
    return [...m.values()].sort((a, b) => b.gasto - a.gasto);
}

// De dónde sale la diferencia, en el orden en que pesa.
function porQue(f: Fila): string[] {
    const r: string[] = [];
    if (f.formulario > 0 && f.personas < f.formulario / 2)
        r.push(`${num(f.formulario)} formularios instantáneos en Meta y no están en el CRM: los formularios de Meta no se están pasando a la plataforma.`);
    if (f.conversaciones >= 3 && f.personas < f.conversaciones / 2)
        r.push(`${num(f.conversaciones)} conversaciones de WhatsApp directo: llegan al WhatsApp de la página, no a pulppo.com, así que no entran al CRM con la campaña.`);
    if (f.clicWa > 0 && f.personas < f.clicWa)
        r.push(`Meta cuenta el CLIC al botón de WhatsApp en pulppo.com, no el mensaje: parte no llega a escribir y parte pierde la etiqueta de la campaña en el camino.`);
    if (f.personas > f.leadsMeta)
        r.push('El CRM tiene más personas que Meta: el pixel pierde eventos (bloqueadores, iPhone) o el lead llegó por formulario de pulppo.com, que no dispara el pixel.');
    if (f.leadsMeta === 0 && f.personas === 0 && f.gasto >= 500) r.push('Gastó sin un solo resultado en Meta ni en el CRM.');
    return r;
}

function Llegada({ meta, crm }: { meta: number; crm: number }) {
    if (!meta && !crm) return <span className="text-neutral-400">—</span>;
    if (!meta) return <span className="font-semibold text-sea">+{crm} sin Meta</span>;
    const p = Math.round((crm / meta) * 100);
    return <span className={`font-semibold ${p < 50 ? 'text-brand-red' : p > 120 ? 'text-sea' : ''}`}>{p}%</span>;
}

export default function MetaVsCrm() {
    const router = useRouter();
    const [d, setD] = useState<Desempeno | null>(null);
    const [error, setError] = useState('');
    const [mes, setMes] = useState('');
    const [soloGasto, setSoloGasto] = useState(true);
    const [abierta, setAbierta] = useState('');

    useEffect(() => {
        fetch('/api/pauta/desempeno')
            .then(async (r) => {
                if (r.status === 401) { router.push('/login'); return; }
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || 'Error');
                setD(j);
            })
            .catch((e) => setError(e.message));
    }, [router]);

    const meses = useMemo(() => [...new Set((d?.filas || []).map((f) => f.mes))], [d]);
    const filas = useMemo(() => sumar((d?.filas || []).filter((f) => !mes || f.mes === mes)).filter((f) => !soloGasto || f.gasto > 0), [d, mes, soloGasto]);
    const t = useMemo(() => filas.reduce((s, f) => ({
        gasto: s.gasto + f.gasto, meta: s.meta + f.leadsMeta, crm: s.crm + f.personas, vis: s.vis + f.visitaron,
        ofe: s.ofe + f.ofertaron, sin: s.sin + (f.sinEtiqueta ?? 0), form: s.form + f.formulario, conv: s.conv + f.conversaciones
    }), { gasto: 0, meta: 0, crm: 0, vis: 0, ofe: 0, sin: 0, form: 0, conv: 0 }), [filas]);

    if (error) return <p className="text-brand-red">{error}</p>;
    if (!d) return <p className="text-neutral-500">Cruzando Meta con el CRM… (tarda unos segundos)</p>;

    const corte = new Date(d.corteMeta).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
    const th = 'px-2 py-2 text-right font-semibold';
    return (
        <div className="space-y-6">
            <div className="rounded-lg bg-light p-4 text-sm">
                <h2 className="font-serif text-2xl">Meta vs CRM</h2>
                <p className="mt-1 text-neutral-700">
                    Por campaña B2C: lo que Ads Manager reporta como resultado contra las personas que llegaron al CRM con esa campaña.
                    Datos de Meta {d.fuente === 'vivo' ? 'en vivo' : 'al'} {corte}; el CRM siempre en vivo.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                    ['Gasto', money(t.gasto), ''],
                    ['Resultados en Meta', num(t.meta), t.gasto && t.meta ? `${money(t.gasto / t.meta)} c/u` : ''],
                    ['Personas en el CRM', num(t.crm), t.gasto && t.crm ? `${money(t.gasto / t.crm)} c/u` : ''],
                    ['Llegan al CRM', t.meta ? `${Math.round((t.crm / t.meta) * 100)}%` : '—', 'de lo que reporta Meta'],
                    ['Visitaron', num(t.vis), t.crm ? `${Math.round((t.vis / t.crm) * 100)}% de las personas` : ''],
                    ['Sin etiqueta (posibles)', num(t.sin), 'no se suman']
                ].map(([l, v, s]) => (
                    <div key={l} className="rounded-lg bg-light p-3">
                        <div className="text-xs text-neutral-600">{l}</div>
                        <div className="font-serif text-2xl">{v}</div>
                        {s && <div className="text-xs text-neutral-500">{s}</div>}
                    </div>
                ))}
            </div>

            {(t.form > 0 || t.conv > 0) && (
                <div className="rounded-lg border-l-4 border-brand-red bg-light p-4 text-sm">
                    <b>Lo que más abre la brecha:</b>{' '}
                    {t.form > 0 && <>{num(t.form)} formularios instantáneos de Meta que no están en el CRM. </>}
                    {t.conv > 0 && <>{num(t.conv)} conversaciones de WhatsApp directo que llegan al número de la página y no a la plataforma. </>}
                    Esos resultados existen, pero nadie del CRM los ve ni los atiende como lead.
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-sm">
                <select value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-1.5">
                    <option value="">Todos los meses ({nombreMes(meses[meses.length - 1] || '2026-08')} a hoy)</option>
                    {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
                </select>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={soloGasto} onChange={(e) => setSoloGasto(e.target.checked)} /> Sólo con gasto
                </label>
                <span className="text-neutral-500">{filas.length} campañas</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                    <thead>
                        <tr className="text-xs uppercase tracking-wider text-neutral-500">
                            <th className="px-2 py-1 text-left" />
                            <th className="px-2 py-1" />
                            <th colSpan={4} className="border-b-2 border-brand-gray px-2 py-1 text-center">Meta</th>
                            <th colSpan={4} className="border-b-2 border-sea px-2 py-1 text-center">CRM</th>
                            <th className="px-2 py-1" />
                        </tr>
                        <tr className="border-b border-neutral-200 text-xs text-neutral-600">
                            <th className="px-2 py-2 text-left font-semibold">Campaña</th>
                            <th className={th}>Gasto</th>
                            <th className={th} title="Pixel Lead = clic al botón de WhatsApp en pulppo.com">Clic a WhatsApp</th>
                            <th className={th} title="Formulario instantáneo de Meta">Formulario</th>
                            <th className={th} title="Anuncio que abre WhatsApp directo">Conversación</th>
                            <th className={th}>Total</th>
                            <th className={th} title="Contactos únicos con la campaña en leads.campaign">Personas</th>
                            <th className={th}>Visitaron</th>
                            <th className={th}>Ofertaron</th>
                            <th className={th} title="Sólo campañas de una propiedad: llegaron a la propiedad por pulppo.com o WhatsApp sin etiqueta y sin portal. Posibles, no se suman.">Sin etiqueta</th>
                            <th className={th}>Llegan al CRM</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((f) => {
                            const razones = porQue(f);
                            return [
                                <tr key={f.campana} onClick={() => setAbierta(abierta === f.campana ? '' : f.campana)}
                                    className="cursor-pointer border-b border-neutral-100 hover:bg-light">
                                    <td className="max-w-[340px] px-2 py-2">
                                        <div className="truncate font-semibold" title={f.campana}>{f.campana}</div>
                                        <div className="text-xs text-neutral-500">
                                            {ESTADO[f.estado] || f.estado}{f.estado === 'ACTIVE' && f.gasto === 0 ? ' (sin gasto: los conjuntos ya terminaron)' : ''}
                                            {razones.length > 0 && <span className="ml-1 text-brand-red">· por qué {abierta === f.campana ? '▴' : '▾'}</span>}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 text-right">{money(f.gasto)}</td>
                                    <td className="px-2 py-2 text-right">{num(f.clicWa)}</td>
                                    <td className="px-2 py-2 text-right">{num(f.formulario)}</td>
                                    <td className="px-2 py-2 text-right">{num(f.conversaciones)}</td>
                                    <td className="px-2 py-2 text-right font-semibold">{num(f.leadsMeta)}</td>
                                    <td className="px-2 py-2 text-right font-semibold">{num(f.personas)}</td>
                                    <td className="px-2 py-2 text-right">{num(f.visitaron)}</td>
                                    <td className="px-2 py-2 text-right">{num(f.ofertaron)}</td>
                                    <td className="px-2 py-2 text-right text-neutral-500">{f.sinEtiqueta == null ? '—' : num(f.sinEtiqueta)}</td>
                                    <td className="px-2 py-2 text-right"><Llegada meta={f.leadsMeta} crm={f.personas} /></td>
                                </tr>,
                                abierta === f.campana && razones.length > 0 && (
                                    <tr key={`${f.campana}-x`} className="bg-light">
                                        <td colSpan={11} className="px-4 py-3">
                                            <ul className="list-disc space-y-1 pl-5">{razones.map((r) => <li key={r}>{r}</li>)}</ul>
                                        </td>
                                    </tr>
                                )
                            ];
                        })}
                    </tbody>
                </table>
            </div>

            <details className="rounded-lg border border-neutral-200 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Cómo se cuenta cada columna</summary>
                <ul className="mt-3 list-disc space-y-1.5 pl-5">
                    <li><b>Clic a WhatsApp</b>: el evento «Lead» del pixel se dispara cuando alguien toca el botón de WhatsApp en pulppo.com. Es un clic, no un mensaje enviado.</li>
                    <li><b>Formulario</b>: formularios instantáneos dentro de Facebook o Instagram.</li>
                    <li><b>Conversación</b>: anuncios que abren WhatsApp directo. Esa plática llega al número de la página, no pasa por pulppo.com.</li>
                    <li><b>Personas</b>: contactos únicos que llegaron al CRM con el nombre de la campaña (utm_campaign), por mes en hora de México.</li>
                    <li><b>Visitaron / ofertaron</b>: de esas personas, cuántas tienen una visita no cancelada o una oferta como compradoras después de su primer lead, de cualquier propiedad.</li>
                    <li><b>Sin etiqueta</b>: sólo en campañas de una propiedad. Personas que ese mes llegaron a la propiedad por pulppo.com o WhatsApp, sin campaña y sin haberla visto en un portal. La etiqueta se pierde cuando la persona cierra la pestaña o pasa del navegador de Instagram a Chrome, así que parte de estas son de Meta. Son posibles: no se suman.</li>
                    <li><b>Llegan al CRM</b>: personas ÷ total de Meta. Abajo de 50% en rojo; arriba de 120% en verde (el CRM tiene más que Meta).</li>
                    <li>Sólo campañas B2C. Las de Master Brokers (B2B) se miden en HubSpot.</li>
                </ul>
            </details>
        </div>
    );
}
