'use client';

/* ------------------------------------------------------------------ *
 * Centro de Marketing — la app.
 *
 * El CALENDARIO es la pantalla principal a propósito: es la única vista
 * donde el anti-spam se ve. Una lista de campañas nunca te muestra que
 * tres mensajes distintos caen sobre la misma persona el mismo martes.
 * ------------------------------------------------------------------ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { money } from '@/components/ui';
import { BASES } from '@/lib/centro/basesMeta';
import { DESTINATARIOS, RESPUESTAS, TEMAS, VIAS, type BaseId, type BaseResultado, type Destinatario, type Envio, type Permiso, type ViaId } from '@/lib/centro/tipos';

type Tab = 'calendario' | 'bases' | 'garantia' | 'desempeno';

const TABS: { id: Tab; label: string; hint: string }[] = [
    { id: 'calendario', label: 'Calendario', hint: 'Qué sale y a quién, sin encimarse' },
    { id: 'bases', label: 'Bases', hint: 'Quiénes son, en vivo desde Mongo' },
    { id: 'garantia', label: 'Garantía de renta', hint: 'El primer flujo: asesor → propietario' },
    { id: 'desempeno', label: 'Desempeño', hint: 'Qué pasó después' }
];

const colorTema = (t: string) => TEMAS.find((x) => x.id === t)?.color || '#B7B7B7';
const labelTema = (t: string) => TEMAS.find((x) => x.id === t)?.label || t;
const hoy = () => new Date().toISOString().slice(0, 10);

/* ============================== shell ============================== */

export default function CentroApp() {
    const [tab, setTab] = useState<Tab>('calendario');
    const [envios, setEnvios] = useState<Envio[]>([]);
    const [permisos, setPermisos] = useState<Permiso[]>([]);
    // En Vercel sin Blob configurado no hay dónde guardar. Se avisa en vez de
    // dejar que el usuario crea que el permiso quedó registrado.
    const [efimero, setEfimero] = useState(false);

    const recargar = useCallback(async () => {
        const [e, p] = await Promise.all([
            fetch('/api/marketing/envios').then((r) => r.json()),
            fetch('/api/marketing/permisos').then((r) => r.json())
        ]);
        setEnvios(e.envios || []);
        setPermisos(p.permisos || []);
        setEfimero(!!e.efimero);
    }, []);

    useEffect(() => { recargar(); }, [recargar]);

    // ?tab=… permite entrar directo desde el menú de Herramientas. Se lee en
    // un efecto (y no en el estado inicial) para no romper la hidratación.
    useEffect(() => {
        const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
        if (t && TABS.some((x) => x.id === t)) setTab(t);
    }, []);

    return (
        <div className="mx-auto max-w-[1180px] px-7 py-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[1.5px] text-brand-gray">Pulppo · Interno</p>
                    <div className="my-[9px] h-0.5 w-[52px] bg-brand-yellow" />
                    <h1 className="text-[32px] leading-none">Centro de Marketing</h1>
                    <p className="mt-1.5 text-xs text-brand-gray">
                        A quién le hablamos, cuándo, con permiso de quién y por cuál vía. Bases en vivo desde Mongo.
                    </p>
                </div>
                <a href="/" className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">← Herramientas</a>
            </header>

            {efimero && (
                <div className="mt-6 rounded-[2px] border border-brand-yellow bg-[#FFFBEF] px-4 py-3 text-[12px] leading-relaxed">
                    <b>Modo lectura.</b> Todo lo que ves sale de Mongo en vivo y el plan se arma de verdad,
                    pero los permisos y los envíos <b>todavía no se guardan</b>: falta crear el Blob store en
                    el proyecto de Vercel (Storage → Create → Blob). En cuanto exista, el guardado se prende
                    solo, sin tocar código.
                </div>
            )}

            <nav className="mt-8 flex flex-wrap gap-2 border-b border-neutral-200">
                {TABS.map((t) => (
                    <button key={t.id} onClick={() => setTab(t.id)} title={t.hint}
                        className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] transition-colors ${tab === t.id
                            ? 'border-brand-yellow font-bold text-soft'
                            : 'border-transparent text-brand-gray hover:text-soft'}`}>
                        {t.label}
                    </button>
                ))}
            </nav>

            <div className="mt-7">
                {tab === 'calendario' && <Calendario envios={envios} onCambio={recargar} />}
                {tab === 'bases' && <Bases permisos={permisos} onCambio={recargar} />}
                {tab === 'garantia' && <Garantia envios={envios} onCambio={recargar} />}
                {tab === 'desempeno' && <Desempeno envios={envios} />}
            </div>
        </div>
    );
}

/* ============================ calendario ============================ */

function Calendario({ envios, onCambio }: { envios: Envio[]; onCambio: () => void }) {
    const [ancla, setAncla] = useState(() => { const d = new Date(); d.setDate(1); return d; });

    const dias = useMemo(() => {
        const y = ancla.getFullYear(), m = ancla.getMonth();
        const primero = new Date(y, m, 1);
        // La grilla arranca el lunes de la semana del día 1.
        const offset = (primero.getDay() + 6) % 7;
        return Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - offset + i));
    }, [ancla]);

    const porDia = useMemo(() => {
        const map = new Map<string, Envio[]>();
        for (const e of envios) {
            const k = e.fecha.slice(0, 10);
            (map.get(k) ?? map.set(k, []).get(k)!).push(e);
        }
        return map;
    }, [envios]);

    // Alerta de saturación: quién recibe más de un mensaje en el mes visible.
    const saturados = useMemo(() => {
        const cuenta = new Map<string, { n: number; nombre: string }>();
        for (const e of envios) {
            if (e.estado === 'cancelado' || e.estado === 'bloqueado') continue;
            if (e.fecha.slice(0, 7) !== ancla.toISOString().slice(0, 7)) continue;
            const c = cuenta.get(e.personaId) || { n: 0, nombre: e.persona };
            c.n++; cuenta.set(e.personaId, c);
        }
        return [...cuenta.values()].filter((c) => c.n > 1);
    }, [envios, ancla]);

    const mes = ancla.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    const mover = (n: number) => setAncla(new Date(ancla.getFullYear(), ancla.getMonth() + n, 1));

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button onClick={() => mover(-1)} className="rounded-[2px] border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">←</button>
                    <span className="min-w-[170px] text-center text-[15px] font-bold capitalize">{mes}</span>
                    <button onClick={() => mover(1)} className="rounded-[2px] border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50">→</button>
                </div>
                <div className="flex flex-wrap gap-3">
                    {TEMAS.map((t) => (
                        <span key={t.id} className="flex items-center gap-1.5 text-[11px] text-brand-gray">
                            <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: t.color }} />{t.label}
                        </span>
                    ))}
                </div>
            </div>

            {saturados.length > 0 && (
                <div className="mt-4 rounded-[2px] border border-brand-yellow bg-[#FFFBEF] px-4 py-3 text-[12px]">
                    <b>{saturados.length} {saturados.length === 1 ? 'persona recibe' : 'personas reciben'} más de un mensaje este mes.</b>{' '}
                    <span className="text-neutral-600">{saturados.slice(0, 6).map((s) => s.nombre).join(' · ')}{saturados.length > 6 ? ' …' : ''}</span>
                </div>
            )}

            <div className="mt-5 grid grid-cols-7 gap-px overflow-hidden rounded-[2px] border border-neutral-200 bg-neutral-200">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                    <div key={d} className="bg-light px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-brand-gray">{d}</div>
                ))}
                {dias.map((d) => {
                    const k = d.toISOString().slice(0, 10);
                    const delMes = d.getMonth() === ancla.getMonth();
                    const items = porDia.get(k) || [];
                    return (
                        <div key={k} className={`min-h-[92px] bg-white p-1.5 ${delMes ? '' : 'opacity-40'} ${k === hoy() ? 'ring-1 ring-inset ring-brand-yellow' : ''}`}>
                            <div className="mb-1 text-[10px] text-brand-gray">{d.getDate()}</div>
                            {items.slice(0, 3).map((e) => (
                                <button key={e.id}
                                    onClick={async () => {
                                        if (!confirm(`¿Cancelar el mensaje a ${e.persona}?`)) return;
                                        await fetch('/api/marketing/envios', {
                                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: e.id, estado: 'cancelado' })
                                        });
                                        onCambio();
                                    }}
                                    title={`${labelTema(e.tema)} · ${e.persona} · ${e.estado}`}
                                    className={`mb-0.5 block w-full truncate rounded-[1px] px-1 py-0.5 text-left text-[10px] text-white ${e.estado === 'cancelado' ? 'line-through opacity-50' : ''}`}
                                    style={{ background: colorTema(e.tema) }}>
                                    {e.persona}
                                </button>
                            ))}
                            {items.length > 3 && <div className="text-[10px] text-brand-gray">+{items.length - 3} más</div>}
                        </div>
                    );
                })}
            </div>

            {envios.length === 0 && (
                <p className="mt-5 text-[12px] text-brand-gray">
                    Todavía no hay nada programado. Andá a <b>Garantía de renta</b> para armar el primer plan.
                </p>
            )}
        </div>
    );
}

/* ============================== bases =============================== */

function Bases({ permisos, onCambio }: { permisos: Permiso[]; onCambio: () => void }) {
    const [conteos, setConteos] = useState<Record<string, number>>({});
    const [sel, setSel] = useState<BaseId>('propietarios-renta');
    const [datos, setDatos] = useState<BaseResultado | null>(null);
    const [cargando, setCargando] = useState(false);
    const [q, setQ] = useState('');

    useEffect(() => {
        fetch('/api/marketing/bases').then((r) => r.json()).then((d) => setConteos(d.conteos || {}));
    }, []);

    useEffect(() => {
        setCargando(true); setDatos(null); setQ('');
        fetch(`/api/marketing/bases?id=${sel}`).then((r) => r.json())
            .then((d) => setDatos(d.error ? null : d)).finally(() => setCargando(false));
    }, [sel]);

    const filas = useMemo(() => {
        if (!datos) return [];
        const t = q.trim().toLowerCase();
        if (!t) return datos.personas;
        return datos.personas.filter((p) =>
            [p.nombre, p.asesor, p.inmobiliaria, ...Object.values(p.extra)].join(' ').toLowerCase().includes(t));
    }, [datos, q]);

    return (
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <aside className="flex flex-col gap-1">
                {BASES.map((b) => (
                    <button key={b.id} onClick={() => setSel(b.id)} title={b.blurb}
                        className={`flex items-baseline justify-between gap-2 rounded-[2px] border px-3 py-2 text-left transition-colors ${sel === b.id
                            ? 'border-transparent bg-[#212322] text-white'
                            : 'border-neutral-200 bg-white hover:bg-light'}`}>
                        <span className="text-[12px] font-bold">{b.label}</span>
                        <span className={`text-[11px] ${sel === b.id ? 'text-brand-yellow' : 'text-brand-gray'}`}>
                            {conteos[b.id]?.toLocaleString('es-MX') ?? '…'}
                        </span>
                    </button>
                ))}
            </aside>

            <div>
                {cargando && <p className="text-[13px] text-brand-gray">Cargando desde Mongo…</p>}
                {datos && (
                    <>
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                            <div>
                                <h2 className="text-[22px] leading-none">{datos.label}</h2>
                                <p className="mt-1 text-[12px] text-brand-gray">
                                    {datos.total.toLocaleString('es-MX')} en total
                                    {datos.personas.length < datos.total && ` · se muestran las primeras ${datos.personas.length}`}
                                </p>
                            </div>
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
                                className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-[12px] outline-none focus:border-sea" />
                        </div>

                        {datos.notas.length > 0 && (
                            <ul className="mt-3 space-y-1 rounded-[2px] bg-light px-4 py-3 text-[11px] text-neutral-600">
                                {datos.notas.map((n, i) => <li key={i}>· {n}</li>)}
                            </ul>
                        )}

                        {sel === 'brokers' && <TablaPermisos filas={filas} permisos={permisos} onCambio={onCambio} />}
                        {sel !== 'brokers' && (
                            <div className="mt-4 overflow-x-auto rounded-[2px] border border-neutral-200">
                                <table className="w-full min-w-[720px] text-[12px]">
                                    <thead className="bg-light text-left text-[10px] uppercase tracking-wide text-brand-gray">
                                        <tr>
                                            <th className="px-3 py-2">Nombre</th>
                                            <th className="px-3 py-2">Contacto</th>
                                            {datos.columnas.map((c) => <th key={c.key} className="px-3 py-2">{c.label}</th>)}
                                            <th className="px-3 py-2">Asesor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filas.map((p, i) => (
                                            <tr key={`${p.id}-${i}`} className="border-t border-neutral-100">
                                                <td className="px-3 py-2 font-bold">{p.nombre}</td>
                                                <td className="px-3 py-2 text-neutral-500">{p.telefono || p.email || '—'}</td>
                                                {datos.columnas.map((c) => (
                                                    <td key={c.key} className="max-w-[240px] truncate px-3 py-2 text-neutral-600">
                                                        {c.key === 'renta' && typeof p.extra[c.key] === 'number'
                                                            ? money(p.extra[c.key] as number)
                                                            : (p.extra[c.key] ?? '—')}
                                                    </td>
                                                ))}
                                                <td className="px-3 py-2 text-neutral-500">
                                                    {p.asesor || '—'}
                                                    {p.inmobiliaria && <span className="block text-[10px] text-brand-gray">{p.inmobiliaria}</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/* ---------------------- brokers = registro de permisos ---------------------- *
 * No es una lista: es el tablero desde el que se pide el permiso. Cada asesor
 * decide DOS cosas por separado — sus propietarios y sus clientes — porque son
 * dos relaciones distintas: el dueño ya le confió una captación, el que busca
 * rentar todavía no le confió nada.
 * -------------------------------------------------------------------------- */

const COLOR_VIA: Record<ViaId, string> = {
    'sin-preguntar': 'bg-neutral-100 text-neutral-500',
    pedido: 'bg-[#FFFBEF] text-[#8a6d00]',
    pulppo: 'bg-[#EAF3F3] text-sea',
    'en-mi-nombre': 'bg-[#EAF3F3] text-sea',
    no: 'bg-[#FBEEEB] text-brand-red'
};

function TablaPermisos({ filas, permisos, onCambio }: {
    filas: BaseResultado['personas']; permisos: Permiso[]; onCambio: () => void;
}) {
    const [tema, setTema] = useState(TEMAS[0].id);
    const [soloRentas, setSoloRentas] = useState(true);
    const [marcados, setMarcados] = useState<Set<string>>(new Set());
    const [msg, setMsg] = useState('');

    const via = useCallback((id: string, d: Destinatario): ViaId =>
        permisos.find((p) => p.asesorId === id && p.tema === tema && p.destinatario === d)?.via ?? 'sin-preguntar',
        [permisos, tema]);

    // El pedido de Ulises va sólo a quien tiene algo que conversar.
    const visibles = useMemo(
        () => soloRentas ? filas.filter((p) => Number(p.extra.rentas) > 0) : filas,
        [filas, soloRentas]);

    const tot = useMemo(() => visibles.reduce((a, p) => ({
        rentas: a.rentas + Number(p.extra.rentas || 0),
        propietarios: a.propietarios + Number(p.extra.propietarios || 0),
        busquedas: a.busquedas + Number(p.extra.busquedas || 0),
        pendientes: a.pendientes + (via(p.id, 'propietario') === 'sin-preguntar' ? 1 : 0)
    }), { rentas: 0, propietarios: 0, busquedas: 0, pendientes: 0 }), [visibles, via]);

    async function guardar(body: Record<string, unknown>) {
        const r = await fetch('/api/marketing/permisos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tema, ...body })
        }).then((x) => x.json());
        // Si no se guardó hay que decirlo: dejar el select cambiado sería mentir.
        if (r.error) alert(r.error); else setMsg(r.fijados ? `${r.fijados} permisos actualizados.` : '');
        onCambio();
    }

    const sinPreguntar = visibles.filter((p) => via(p.id, 'propietario') === 'sin-preguntar');

    return (
        <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-brand-gray">Permiso para</span>
                {TEMAS.map((t) => (
                    <button key={t.id} onClick={() => setTema(t.id)}
                        className={`rounded-[2px] border px-2.5 py-1 text-[11px] ${tema === t.id ? 'border-transparent bg-[#212322] text-white' : 'border-neutral-200 hover:bg-light'}`}>
                        {t.label}
                    </button>
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-600">
                    <input type="checkbox" checked={soloRentas} onChange={(e) => setSoloRentas(e.target.checked)} />
                    Sólo con rentas captadas
                </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Tarjeta label="Asesores a contactar" valor={visibles.length} destacado />
                <Tarjeta label="Rentas captadas" valor={tot.rentas} />
                <Tarjeta label="Propietarios detrás" valor={tot.propietarios} />
                <Tarjeta label="Buscan rentar" valor={tot.busquedas} />
            </div>

            {/* El pedido masivo: marcar a quién ya le escribió Ulises. */}
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[2px] bg-light px-4 py-3 text-[12px]">
                <b>{tot.pendientes}</b> sin preguntar todavía.
                <button
                    disabled={!sinPreguntar.length}
                    onClick={() => {
                        if (!confirm(`Marcar como "le preguntamos" a ${sinPreguntar.length} asesores, en los dos permisos?`)) return;
                        guardar({
                            asesorIds: sinPreguntar.map((p) => p.id),
                            destinatarios: ['propietario', 'cliente'], via: 'pedido'
                        });
                    }}
                    className="rounded-[2px] border border-[#212322] px-3 py-1.5 text-[11px] font-bold hover:bg-white disabled:opacity-40">
                    Marcar como preguntados
                </button>
                {marcados.size > 0 && (
                    <button onClick={() => { guardar({ asesorIds: [...marcados], destinatarios: ['propietario', 'cliente'], via: 'pedido' }); setMarcados(new Set()); }}
                        className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-[11px] hover:bg-white">
                        Marcar los {marcados.size} seleccionados
                    </button>
                )}
                <a href={`/api/marketing/bases?id=brokers&format=csv&soloRentas=${soloRentas ? 1 : 0}`}
                    className="ml-auto text-[11px] text-sea underline">Bajar lista para Ulises (CSV)</a>
                {msg && <span className="text-brand-gray">{msg}</span>}
            </div>

            <div className="mt-3 overflow-x-auto rounded-[2px] border border-neutral-200">
                <table className="w-full min-w-[980px] text-[12px]">
                    <thead className="bg-light text-left text-[10px] uppercase tracking-wide text-brand-gray">
                        <tr>
                            <th className="w-8 px-3 py-2"></th>
                            <th className="px-3 py-2">Asesor</th>
                            <th className="px-3 py-2">Inmobiliaria</th>
                            <th className="px-3 py-2 text-right">Rentas</th>
                            <th className="px-3 py-2 text-right">Propiet.</th>
                            <th className="px-3 py-2 text-right">Buscan</th>
                            {DESTINATARIOS.map((d) => (
                                <th key={d.id} className="px-3 py-2" title={d.hint}>{d.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibles.map((p) => (
                            <tr key={p.id} className="border-t border-neutral-100">
                                <td className="px-3 py-2">
                                    <input type="checkbox" checked={marcados.has(p.id)}
                                        onChange={(e) => setMarcados((s) => {
                                            const n = new Set(s);
                                            if (e.target.checked) n.add(p.id); else n.delete(p.id);
                                            return n;
                                        })} />
                                </td>
                                <td className="px-3 py-2 font-bold">
                                    {p.nombre}
                                    {p.extra.whatsapp === 'No' && (
                                        <span className="block text-[10px] text-brand-gray">sin WhatsApp vinculado</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-neutral-500">{p.inmobiliaria || '—'}</td>
                                <td className="px-3 py-2 text-right text-neutral-600">{p.extra.rentas ?? 0}</td>
                                <td className="px-3 py-2 text-right text-neutral-600">{p.extra.propietarios ?? 0}</td>
                                <td className="px-3 py-2 text-right text-neutral-600">{p.extra.busquedas ?? 0}</td>
                                {DESTINATARIOS.map((d) => {
                                    const v = via(p.id, d.id);
                                    // No se le ofrece "en mi nombre" a quien no tiene WhatsApp
                                    // vinculado: no hay número desde el cual salir.
                                    const sinWa = p.extra.whatsapp === 'No';
                                    return (
                                        <td key={d.id} className="px-3 py-2">
                                            <select value={v}
                                                onChange={(e) => guardar({ asesorId: p.id, destinatario: d.id, via: e.target.value })}
                                                className={`w-full rounded-[2px] border-0 px-2 py-1 text-[11px] outline-none ${COLOR_VIA[v]}`}>
                                                <option value="sin-preguntar">Sin preguntar</option>
                                                <option value="pedido">Le preguntamos</option>
                                                {RESPUESTAS.map((r) => (
                                                    <option key={r.id} value={r.id} disabled={r.id === 'en-mi-nombre' && sinWa}>
                                                        {r.label}{r.id === 'en-mi-nombre' && sinWa ? ' (sin WhatsApp)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-2 text-[11px] text-brand-gray">
                {VIAS.filter((v) => v.final).map((v) => `${v.label}: ${v.hint}`).join(' · ')}
            </p>
        </>
    );
}

/* =========================== garantía (MVP) =========================== */

type Plan = {
    audiencia: number; asesores: number; dias: number; fecha: string;
    alAsesor: Envio[]; alPropietario: Envio[]; bloqueados: Envio[];
    detalle: Record<string, BaseResultado['personas'][number]>;
};

function Garantia({ envios, onCambio }: { envios: Envio[]; onCambio: () => void }) {
    const [dias, setDias] = useState(7);
    const [fecha, setFecha] = useState(hoy());
    const [plan, setPlan] = useState<Plan | null>(null);
    const [cargando, setCargando] = useState(false);
    const [msg, setMsg] = useState('');

    const pedirPlan = useCallback(async () => {
        setCargando(true); setMsg('');
        const r = await fetch(`/api/marketing/plan?dias=${dias}&fecha=${fecha}`).then((x) => x.json());
        setPlan(r.error ? null : r);
        if (r.error) setMsg(r.error);
        setCargando(false);
    }, [dias, fecha]);

    async function programar(lista: Envio[]) {
        if (!lista.length) return;
        const r = await fetch('/api/marketing/envios', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ envios: lista })
        }).then((x) => x.json());
        setMsg(r.error
            ? r.error
            : `Programados ${r.programados}${r.descartados ? ` · ${r.descartados} descartados (ya existían)` : ''}. Míralos en el Calendario.`);
        onCambio(); pedirPlan();
    }

    return (
        <div>
            <div className="rounded-[2px] border border-neutral-200 bg-white p-5">
                <h2 className="text-[20px] leading-none">Propietario de renta → garantía</h2>
                <p className="mt-2 max-w-[760px] text-[12.5px] leading-relaxed text-neutral-600">
                    El flujo no es un mensaje, son dos encadenados por el permiso. Primero le escribimos al{' '}
                    <b>asesor</b> que acaba de captar la renta para pedirle permiso; sólo cuando dice que sí entra
                    el mensaje al <b>propietario</b>. Lo que no pasa el permiso o el techo de frecuencia aparece
                    igual acá abajo, con su motivo.
                </p>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                    <label className="text-[11px] uppercase tracking-wide text-brand-gray">
                        Rentas publicadas en los últimos
                        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
                            className="ml-2 rounded-[2px] border border-neutral-300 px-2 py-1 text-[12px] normal-case tracking-normal text-soft">
                            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
                        </select>
                    </label>
                    <label className="text-[11px] uppercase tracking-wide text-brand-gray">
                        Sale el
                        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                            className="ml-2 rounded-[2px] border border-neutral-300 px-2 py-1 text-[12px] text-soft" />
                    </label>
                    <button onClick={pedirPlan} disabled={cargando}
                        className="rounded-[2px] bg-[#212322] px-4 py-2 text-[12px] font-bold text-white hover:bg-black disabled:opacity-50">
                        {cargando ? 'Armando…' : 'Armar plan'}
                    </button>
                </div>
            </div>

            {msg && <p className="mt-4 rounded-[2px] bg-light px-4 py-2.5 text-[12px]">{msg}</p>}

            {plan && (
                <>
                    <div className="mt-5 grid gap-3 sm:grid-cols-4">
                        <Tarjeta label="Propietarios en la ventana" valor={plan.audiencia} />
                        <Tarjeta label="Asesores detrás" valor={plan.asesores} />
                        <Tarjeta label="Mensajes al asesor" valor={plan.alAsesor.length} destacado />
                        <Tarjeta label="Mensajes al propietario" valor={plan.alPropietario.length} destacado />
                    </div>

                    <Grupo titulo="Paso 1 · pedirle permiso al asesor"
                        nota="Uno por asesor, aunque haya captado varias rentas."
                        lista={plan.alAsesor} detalle={plan.detalle} onProgramar={programar} />

                    <Grupo titulo="Paso 2 · el mensaje al propietario"
                        nota="Sólo los que ya tienen permiso concedido, por la vía que eligió el asesor."
                        lista={plan.alPropietario} detalle={plan.detalle} onProgramar={programar} />

                    {plan.bloqueados.length > 0 && (
                        <div className="mt-7">
                            <h3 className="text-[15px] font-bold">No se manda ({plan.bloqueados.length})</h3>
                            <div className="mt-2 overflow-x-auto rounded-[2px] border border-neutral-200">
                                <table className="w-full min-w-[600px] text-[12px]">
                                    <tbody>
                                        {plan.bloqueados.map((e, i) => (
                                            <tr key={`${e.id}-${i}`} className="border-t border-neutral-100 first:border-0">
                                                <td className="px-3 py-2 font-bold">{e.persona}</td>
                                                <td className="px-3 py-2 text-brand-red">{e.motivo}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {envios.length > 0 && (
                <p className="mt-6 text-[11px] text-brand-gray">
                    Programar deja la agenda armada y auditable — todavía no dispara WhatsApp. Eso es la siguiente fase.
                </p>
            )}
        </div>
    );
}

function Tarjeta({ label, valor, destacado }: { label: string; valor: number; destacado?: boolean }) {
    return (
        <div className={`rounded-[2px] border p-4 ${destacado ? 'border-transparent bg-[#212322] text-white' : 'border-neutral-200 bg-white'}`}>
            <p className={`text-[10px] uppercase tracking-wide ${destacado ? 'text-neutral-400' : 'text-brand-gray'}`}>{label}</p>
            <p className="mt-1 text-[26px] leading-none">{valor.toLocaleString('es-MX')}</p>
        </div>
    );
}

function Grupo({ titulo, nota, lista, detalle, onProgramar }: {
    titulo: string; nota: string; lista: Envio[];
    detalle: Plan['detalle']; onProgramar: (l: Envio[]) => void;
}) {
    return (
        <div className="mt-7">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h3 className="text-[15px] font-bold">{titulo} ({lista.length})</h3>
                    <p className="text-[11px] text-brand-gray">{nota}</p>
                </div>
                {lista.length > 0 && (
                    <button onClick={() => onProgramar(lista)}
                        className="rounded-[2px] border border-[#212322] px-3 py-1.5 text-[12px] font-bold hover:bg-light">
                        Programar los {lista.length}
                    </button>
                )}
            </div>
            {lista.length === 0
                ? <p className="mt-2 text-[12px] text-brand-gray">Nada por ahora.</p>
                : (
                    <div className="mt-2 max-h-[340px] overflow-auto rounded-[2px] border border-neutral-200">
                        <table className="w-full min-w-[680px] text-[12px]">
                            <tbody>
                                {lista.map((e, i) => {
                                    const d = detalle[e.personaId];
                                    return (
                                        <tr key={`${e.id}-${i}`} className="border-t border-neutral-100 first:border-0">
                                            <td className="px-3 py-2 font-bold">{e.persona}</td>
                                            <td className="px-3 py-2 text-neutral-500">{d?.extra?.propiedad ?? d?.inmobiliaria ?? '—'}</td>
                                            <td className="px-3 py-2 text-neutral-500">{d?.asesor ?? '—'}</td>
                                            <td className="px-3 py-2 text-brand-gray">{VIAS.find((v) => v.id === e.via)?.label}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
        </div>
    );
}

/* ============================= desempeño ============================= */

function Desempeno({ envios }: { envios: Envio[] }) {
    const vivos = envios.filter((e) => e.estado !== 'cancelado' && e.estado !== 'bloqueado');
    const porTema = TEMAS.map((t) => ({ ...t, n: vivos.filter((e) => e.tema === t.id).length })).filter((t) => t.n);
    const porVia = VIAS.map((v) => ({ ...v, n: vivos.filter((e) => e.via === v.id).length })).filter((v) => v.n);

    if (!vivos.length) {
        return <p className="text-[13px] text-brand-gray">
            Todavía no hay envíos. Cuando los haya, acá va el engagement y — lo que de verdad importa —
            cuántas garantías y créditos salieron de cada tema.
        </p>;
    }

    return (
        <div className="grid gap-6 md:grid-cols-2">
            <div>
                <h3 className="text-[15px] font-bold">Por tema</h3>
                {porTema.map((t) => (
                    <div key={t.id} className="mt-2 flex items-center gap-2 text-[12px]">
                        <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: t.color }} />
                        <span className="w-[150px]">{t.label}</span>
                        <span className="font-bold">{t.n}</span>
                    </div>
                ))}
            </div>
            <div>
                <h3 className="text-[15px] font-bold">Por vía</h3>
                {porVia.map((v) => (
                    <div key={v.id} className="mt-2 text-[12px]">
                        <span className="font-bold">{v.n}</span> · {v.label}
                        <span className="block text-[10px] text-brand-gray">{v.hint}</span>
                    </div>
                ))}
            </div>
            <p className="md:col-span-2 text-[11px] text-brand-gray">
                Falta lo importante: el desenlace. Cuando los envíos se disparen de verdad, esta pantalla
                cruza contra garantías contratadas y créditos iniciados, no contra aperturas.
            </p>
        </div>
    );
}
