'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CampaignPayload, SendItem } from '@/types';
import { Metric, Section, Caption, HBar, DataTable, YELLOW, SEA } from './ui';

const pct = (num?: number | null, den?: number | null) =>
    !den || den <= 0 || num == null ? '—' : `${((num / den) * 100).toFixed(1)}%`;

const fecha = (iso?: string | null) => (iso ? iso.slice(0, 10) : '—');

const medios = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';

function estadoEnvio(s?: string | null) {
    const map: Record<string, string> = { draft: 'borrador', scheduled: 'programado', triggered: 'enviado', sent: 'enviado' };
    return s ? map[s] || s : '—';
}

export default function CampanasTab({ kam, inmo }: { kam: string; inmo: string }) {
    const [data, setData] = useState<CampaignPayload | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true); setError('');
            try {
                const res = await fetch('/api/campanas/desempeno');
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Error cargando campañas');
                if (alive) setData(d);
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : 'Error cargando campañas');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    // Los envíos de SendGrid son globales (por zona, no por propiedad): no se filtran por KAM/inmobiliaria.
    const matchFilters = <T extends { kam: string; inmobiliaria: string | null }>(rows: T[]) =>
        rows.filter((r) => (kam === '(todos)' || r.kam === kam) && (inmo === '(todas)' || r.inmobiliaria === inmo));

    const email = useMemo(() => matchFilters(data?.perf.email.porPropiedad || []), [data, kam, inmo]);
    const social = useMemo(() => matchFilters(data?.perf.social.porPropiedad || []), [data, kam, inmo]);
    const recientes = useMemo(() => matchFilters(data?.perf.social.recientes || []), [data, kam, inmo]);

    if (loading) return <p className="mt-10 text-center text-sm text-neutral-500">Consultando campañas…</p>;
    if (error) return <p className="mt-10 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
    if (!data) return null;

    const { perf, sends, sendsError } = data;

    // Agregados de envíos (SendGrid) para el funnel de correo.
    const enviados = sends.filter((s) => s.stats);
    const sum = (f: (s: SendItem) => number | undefined) => enviados.reduce((a, s) => a + (f(s) || 0), 0);
    const delivered = sum((s) => s.stats?.delivered);
    const uOpens = sum((s) => s.stats?.unique_opens ?? s.stats?.opens);
    const uClicks = sum((s) => s.stats?.unique_clicks ?? s.stats?.clicks);
    const emailLeadsLive = email.reduce((a, r) => a + r.email_leads, 0);

    const socFacebook = social.reduce((a, r) => a + r.facebook, 0);
    const socInstagram = social.reduce((a, r) => a + r.instagram, 0);
    const socBien = social.reduce((a, r) => a + r.bien_atribuidos, 0);
    const socTotal = social.reduce((a, r) => a + r.social_total, 0);

    return (
        <div className="mt-6">
            {/* ============================ CORREO ============================ */}
            <Section title="✉️ Correo · ¿funcionaron los envíos y para qué propiedades?">
                <div className="grid grid-cols-2 gap-4 rounded-xl bg-light p-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Metric label="Envíos (SendGrid)" value={sends.length} />
                    <Metric label="Entregados" value={delivered.toLocaleString('en-US')} />
                    <Metric label="Apertura única" value={pct(uOpens, delivered)} />
                    <Metric label="Clic único" value={pct(uClicks, delivered)} />
                    <Metric label="Leads de correo (cartera)" value={emailLeadsLive} />
                    <Metric label="Leads de correo (histórico)" value={perf.email.totalPrograma} />
                </div>

                {sendsError && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                        ⚠️ SendGrid no respondió ({sendsError}). Se muestra solo el lado de leads (Mongo).
                    </p>
                )}

                <div className="mt-5 grid gap-6 lg:grid-cols-2">
                    <div>
                        <Caption>Envíos en SendGrid · entrega → apertura → clic (por envío)</Caption>
                        <DataTable
                            columns={[
                                { key: 'name', label: 'Envío' },
                                { key: 'status', label: 'Estado', render: (v) => estadoEnvio(v as string) },
                                { key: 'send_at', label: 'Fecha', render: (v) => fecha(v as string) },
                                { key: 'delivered', label: 'Entregados', render: (_v, r) => ((r.stats as SendItem['stats'])?.delivered ?? '—') },
                                { key: 'ap', label: 'Apertura', render: (_v, r) => { const s = r.stats as SendItem['stats']; return pct(s?.unique_opens ?? s?.opens, s?.delivered); } },
                                { key: 'cl', label: 'Clic', render: (_v, r) => { const s = r.stats as SendItem['stats']; return pct(s?.unique_clicks ?? s?.clicks, s?.delivered); } }
                            ]}
                            rows={sends as unknown as Record<string, unknown>[]}
                        />
                        <p className="mt-2 text-xs text-neutral-400">
                            El envío es por zona (digest &quot;Exclusivas de la semana&quot;), por eso la apertura/clic es del correo,
                            no de una sola propiedad. La atribución a propiedad está en la tabla de la derecha.
                        </p>
                    </div>

                    <div>
                        <Caption>Leads atribuidos al correo, por propiedad (source=email)</Caption>
                        <DataTable
                            columns={[
                                { key: 'titulo', label: 'Propiedad', render: (v, r) => (
                                    <a href={`https://pulppo.com/propiedades/${r.id}`} target="_blank" rel="noreferrer" className="text-[#529999] hover:underline">
                                        {(v as string) || '(sin título)'}
                                    </a>
                                ) },
                                { key: 'inmobiliaria', label: 'Inmobiliaria' },
                                { key: 'campaign', label: 'Campaña' },
                                { key: 'email_leads', label: 'Leads' },
                                { key: 'por_medio', label: 'Por medio', render: (v) => medios(v as Record<string, number>) },
                                { key: 'ultima', label: 'Último', render: (v) => fecha(v as string) }
                            ]}
                            rows={email as unknown as Record<string, unknown>[]}
                        />
                        {!email.length && (
                            <p className="mt-2 text-xs text-neutral-400">
                                Aún sin leads de correo en la cartera viva. El esquema de atribución 1·5·10
                                (utm_source=email) recién arrancó, así que esto se irá llenando con cada envío.
                            </p>
                        )}
                    </div>
                </div>
            </Section>

            {/* ======================= REDES / PIXEL ======================= */}
            <Section title="📱 Redes sociales · leads por propiedad y salud del pixel">
                <div className="grid grid-cols-2 gap-4 rounded-xl bg-light p-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Metric label="Leads Facebook" value={socFacebook} />
                    <Metric label="Leads Instagram" value={socInstagram} />
                    <Metric label="Bien atribuidos" value={pct(socBien, socTotal)} />
                    <Metric label="Propiedades con redes" value={social.length} />
                    <Metric label="Sin ningún lead de redes" value={Math.max(0, perf.liveCount - social.length)} />
                    <Metric label="Exclusivas vivas" value={perf.liveCount} />
                </div>

                {socInstagram === 0 && socFacebook > 0 && (
                    <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
                        🔴 <b>0 leads de Instagram</b> sobre las exclusivas vivas, frente a {socFacebook} de Facebook.
                        Señal fuerte de que el pixel/atribución de Instagram no está conectado (o no se está pauteando IG) para estas propiedades.
                    </p>
                )}
                {socTotal > 0 && socBien / socTotal < 0.85 && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                        ⚠️ Solo {pct(socBien, socTotal)} de los leads de redes traen un <code>medium</code> limpio.
                        El resto llega con un referrer/URL en el medium: el UTM no viajó → hay que revisar el etiquetado del pixel.
                    </p>
                )}

                <div className="mt-5 grid gap-6 lg:grid-cols-2">
                    <div>
                        <Caption>Medium de los leads de redes (limpio vs. fuga de atribución)</Caption>
                        <HBar data={perf.social.mediumBreakdown} color={SEA} height={260} />
                    </div>
                    <div>
                        <Caption>Cómo llega escrita la fuente en Mongo (variantes a normalizar)</Caption>
                        <HBar data={perf.social.sourceSpellings} color={YELLOW} height={260} />
                    </div>
                </div>

                <div className="mt-5">
                    <Caption>Últimos leads de redes (para dar seguimiento) · clic en un encabezado para ordenar</Caption>
                    <DataTable
                        sortable searchable csvName="leads_redes_1-5-10"
                        columns={[
                            { key: 'inmobiliaria', label: 'Inmobiliaria' },
                            { key: 'internalId', label: 'Propiedad', render: (v, r) => (
                                <a href={`https://pulppo.com/propiedades/${r.id}`} target="_blank" rel="noreferrer" className="text-[#529999] hover:underline">
                                    {(v as string) || '—'}
                                </a>
                            ) },
                            { key: 'broker', label: 'Broker' },
                            { key: 'direccion', label: 'Dirección' },
                            { key: 'fecha', label: 'Fecha', render: (v) => fecha(v as string), value: (r) => fecha(r.fecha as string) },
                            { key: 'medio', label: 'Por medio',
                                render: (v, r) => `${(r.red as string) === 'Instagram' ? 'IG' : 'FB'} · ${(v as string) || '—'}`,
                                value: (r) => `${(r.red as string) === 'Instagram' ? 'IG' : 'FB'} · ${(r.medio as string) || ''}` },
                            { key: 'nombre', label: 'Nombre' },
                            { key: 'whatsapp', label: 'WhatsApp', render: (v) => {
                                const tel = v ? String(v) : '';
                                const digits = tel.replace(/\D/g, '');
                                return digits ? <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="text-[#529999] hover:underline">{tel}</a> : '—';
                            } },
                            { key: 'email', label: 'Email', render: (v) => {
                                const e = v ? String(v) : '';
                                return e ? <a href={`mailto:${e}`} className="text-[#529999] hover:underline">{e}</a> : '—';
                            } }
                        ]}
                        rows={recientes as unknown as Record<string, unknown>[]}
                    />
                    <p className="mt-2 text-xs text-neutral-400">
                        Contacto de leads que llegaron por Facebook/Instagram a las exclusivas vivas. El CSV respeta el filtro y el orden actual.
                    </p>
                </div>
            </Section>

            <p className="mt-8 text-xs text-neutral-400">
                Datos live desde Mongo (cache 10 min) + engagement de SendGrid. Los filtros de KAM/inmobiliaria aplican a las
                tablas por propiedad; los envíos de SendGrid son por zona, así que no se filtran.
            </p>
        </div>
    );
}
