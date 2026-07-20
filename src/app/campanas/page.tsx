'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Generador de campañas 1·5·10: buscar propiedad → preview del email on-brand → enviar prueba
// (Fase 1) · planear calendario anti-empalme → crear borradores → aprobar y programar por SendGrid
// Single Sends (Fase 2, human-in-the-loop: nada sale hasta que alguien aprueba).
interface PlanProp { code: string; title: string; colonia: string | null; ciudad: string | null; type: string | null; level: string; count: number }
interface PlanTanda { tanda: number; sendAt: string; date: string; totalDedup: number; props: PlanProp[] }
interface Plan { start: string; hourUtc: number; tandas: PlanTanda[]; notFound: string[]; nota: string }
interface Draft { code: string; ok: boolean; error?: string; id?: string; status?: string; count?: number; skipped?: number; sendAt?: string; subject?: string; level?: string }
interface SendStats { delivered?: number; unique_opens?: number; unique_clicks?: number; unsubscribes?: number; bounces?: number }
interface SendRow { id: string; name?: string; status?: string; send_at?: string | null; stats?: SendStats | null }

export default function CampanasPage() {
    const router = useRouter();
    const [id, setId] = useState('');
    const [subject, setSubject] = useState('');
    const [hook, setHook] = useState('');
    const [meta, setMeta] = useState<{ code: string; title: string; zona: string | null } | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [to, setTo] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    // Base (audiencia)
    const [aud, setAud] = useState<{ code: string; level: string; count: number; colonia: string | null; ciudad: string | null; zona: string | null } | null>(null);
    const [audLoading, setAudLoading] = useState(false);
    // Solapamiento / calendario
    const [ovCodes, setOvCodes] = useState('');
    const [ovLoading, setOvLoading] = useState(false);
    const [ov, setOv] = useState<{ bases: { code: string; label: string; count: number }[]; pairs: { a: string; b: string; shared: number; pct: number; verdict: string }[]; days: string[][]; nota: string } | null>(null);
    // Fase 2: planear → borradores → aprobar/programar por SendGrid
    const [planCodes, setPlanCodes] = useState('');
    const [planStart, setPlanStart] = useState('');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [tandaDates, setTandaDates] = useState<Record<number, string>>({});
    const [planLoading, setPlanLoading] = useState(false);
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [schedLoading, setSchedLoading] = useState(false);
    const [approving, setApproving] = useState(false);
    const [sends, setSends] = useState<SendRow[] | null>(null);
    const [sendsLoading, setSendsLoading] = useState(false);
    const [f2msg, setF2msg] = useState('');
    const [f2err, setF2err] = useState('');

    const q = () => {
        const p = new URLSearchParams({ id: id.trim() });
        if (subject.trim()) p.set('subject', subject.trim());
        if (hook.trim()) p.set('hook', hook.trim());
        return p.toString();
    };

    async function load() {
        if (!id.trim()) return;
        setLoading(true); setError(''); setMsg(''); setMeta(null); setPreviewUrl(''); setAud(null);
        try {
            const res = await fetch(`/api/campanas/preview?format=json&${q()}`);
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo generar el preview');
            setMeta({ code: d.code, title: d.title, zona: d.zona });
            if (!subject.trim()) setSubject(d.subject);
            setPreviewUrl(`/api/campanas/preview?${q()}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally { setLoading(false); }
    }

    async function sendTest() {
        setSending(true); setError(''); setMsg('');
        try {
            const res = await fetch('/api/campanas/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id.trim(), to: to.trim() || undefined, subject: subject.trim() || undefined, hook: hook.trim() || undefined })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo enviar');
            setMsg(`✅ Prueba enviada a ${d.to} (${d.code}).`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally { setSending(false); }
    }

    async function genBase() {
        if (!id.trim()) return;
        setAudLoading(true); setError(''); setAud(null);
        try {
            const res = await fetch(`/api/campanas/audience?id=${encodeURIComponent(id.trim())}`);
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo generar la base');
            setAud(d);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally { setAudLoading(false); }
    }

    async function checkOverlap() {
        const codes = ovCodes.split(/[\s,;\n]+/).map((c) => c.trim()).filter(Boolean);
        if (codes.length < 2) { setError('Pega al menos 2 códigos para revisar solapamiento'); return; }
        setOvLoading(true); setError(''); setOv(null);
        try {
            const res = await fetch('/api/campanas/overlap', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo calcular');
            setOv(d);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error');
        } finally { setOvLoading(false); }
    }

    const hh = (h: number) => String(h).padStart(2, '0');
    const sendAtOf = (date: string, hourUtc: number) => `${date}T${hh(hourUtc)}:00:00Z`;
    const fmtDate = (iso: string | null | undefined) =>
        iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    async function planCampaigns() {
        const codes = planCodes.split(/[\s,;\n]+/).map((c) => c.trim()).filter(Boolean);
        if (!codes.length) { setF2err('Pega al menos un código de propiedad'); return; }
        setPlanLoading(true); setF2err(''); setF2msg(''); setPlan(null); setDrafts([]);
        try {
            const res = await fetch('/api/campanas/plan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codes, start: planStart || undefined })
            });
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo planear');
            setPlan(d);
            const dates: Record<number, string> = {};
            for (const t of d.tandas as PlanTanda[]) dates[t.tanda] = t.date;
            setTandaDates(dates);
        } catch (e) {
            setF2err(e instanceof Error ? e.message : 'Error');
        } finally { setPlanLoading(false); }
    }

    async function createDrafts() {
        if (!plan) return;
        const items: { code: string; sendAt: string }[] = [];
        for (const t of plan.tandas) {
            const date = tandaDates[t.tanda] || t.date;
            for (const p of t.props) items.push({ code: p.code, sendAt: sendAtOf(date, plan.hourUtc) });
        }
        if (!items.length) { setF2err('No hay campañas en el plan'); return; }
        setSchedLoading(true); setF2err(''); setF2msg('');
        try {
            const res = await fetch('/api/campanas/schedule', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
            });
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudieron crear los borradores');
            setDrafts(d.items as Draft[]);
            const okN = (d.items as Draft[]).filter((x) => x.ok).length;
            setF2msg(`📝 ${okN} borrador(es) creado(s) en SendGrid. Revísalos y aprueba para programar.`);
        } catch (e) {
            setF2err(e instanceof Error ? e.message : 'Error');
        } finally { setSchedLoading(false); }
    }

    async function approveDrafts() {
        const ready = drafts.filter((d) => d.ok && d.id && d.sendAt && d.status !== 'scheduled');
        if (!ready.length) { setF2err('No hay borradores listos para aprobar'); return; }
        if (!confirm(`Vas a PROGRAMAR ${ready.length} envío(s) reales a leads. ¿Confirmas?`)) return;
        setApproving(true); setF2err(''); setF2msg('');
        try {
            const res = await fetch('/api/campanas/approve', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sends: ready.map((d) => ({ id: d.id, sendAt: d.sendAt })) })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo aprobar');
            const okIds = new Set((d.items as { id: string; ok: boolean }[]).filter((x) => x.ok).map((x) => x.id));
            setDrafts((prev) => prev.map((x) => (x.id && okIds.has(x.id) ? { ...x, status: 'scheduled' } : x)));
            setF2msg(`🚀 ${okIds.size} envío(s) programado(s). SendGrid los mandará en su fecha; puedes cancelar antes.`);
        } catch (e) {
            setF2err(e instanceof Error ? e.message : 'Error');
        } finally { setApproving(false); }
    }

    async function cancelSend(id: string) {
        if (!confirm('¿Cancelar (desprogramar) este envío? Vuelve a borrador.')) return;
        setF2err(''); setF2msg('');
        try {
            const res = await fetch(`/api/campanas/approve?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo cancelar');
            setDrafts((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'draft' } : x)));
            setSends((prev) => prev && prev.map((x) => (x.id === id ? { ...x, status: 'draft' } : x)));
            setF2msg('↩️ Envío cancelado (vuelve a borrador).');
        } catch (e) {
            setF2err(e instanceof Error ? e.message : 'Error');
        }
    }

    async function loadSends() {
        setSendsLoading(true); setF2err('');
        try {
            const res = await fetch('/api/campanas/sends');
            if (res.status === 401) { router.push('/login'); return; }
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo leer el estado');
            setSends(d.items as SendRow[]);
        } catch (e) {
            setF2err(e instanceof Error ? e.message : 'Error');
        } finally { setSendsLoading(false); }
    }

    const LEVELLBL: Record<string, string> = { colonia: 'colonia', ciudad: 'ciudad (se amplió)', zona: 'zona (se amplió)' };
    const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm';
    const btnDark = 'rounded-lg bg-[#212322] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

    return (
        <div className="mx-auto max-w-[1400px] px-5 py-6">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <h1 className="text-3xl sm:text-4xl">Campañas · 1 · 5 · 10</h1>
                </div>
                <a href="/" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">← Dashboard</a>
            </header>

            <div className="mb-4 rounded-lg border border-[#F6BE00] bg-[#fffdf5] px-4 py-2 text-xs text-neutral-700">
                <b>Arriba — generar y probar.</b> Arma el email desde una propiedad, genera su base y envíate una prueba
                (solo a <b>@pulppo.com</b>). <b>Abajo — programar envíos reales</b> por SendGrid: planeas el calendario
                anti-empalme, se crean borradores y <b>nada sale hasta que apruebas</b>.
            </div>

            <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
                {/* Panel de controles */}
                <div className="flex flex-col gap-3">
                    <label className="text-xs font-semibold text-neutral-600">Propiedad (código CTA-422 o ID de Mongo)</label>
                    <div className="flex gap-2">
                        <input className={inputCls} value={id} onChange={(e) => setId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="CTA-422" />
                        <button className={btnDark} onClick={load} disabled={loading || !id.trim()}>
                            {loading ? '…' : 'Cargar'}
                        </button>
                    </div>

                    {meta && (
                        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                            <div><b>{meta.title}</b></div>
                            <div>{meta.code}{meta.zona ? ` · ${meta.zona}` : ''}</div>
                        </div>
                    )}

                    <label className="mt-1 text-xs font-semibold text-neutral-600">Asunto</label>
                    <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}
                        placeholder="Exclusiva de la semana: …" />

                    <label className="text-xs font-semibold text-neutral-600">Gancho (línea destacada del header)</label>
                    <input className={inputCls} value={hook} onChange={(e) => setHook(e.target.value)}
                        placeholder="Una propiedad que lo tiene todo en …" />

                    <button className="mt-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
                        onClick={load} disabled={!id.trim()}>Actualizar preview</button>

                    <hr className="my-2 border-neutral-200" />

                    <label className="text-xs font-semibold text-neutral-600">Base de envío (demanda en vivo)</label>
                    <button className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
                        onClick={genBase} disabled={audLoading || !id.trim()}>
                        {audLoading ? 'Calculando…' : '🎯 Generar base'}
                    </button>
                    {aud && (
                        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                            <div className="text-sm"><b>{aud.count.toLocaleString('es-MX')}</b> correos · nivel <b>{LEVELLBL[aud.level] ?? aud.level}</b></div>
                            <div className="text-neutral-500">{[aud.colonia, aud.ciudad, aud.zona].filter(Boolean).join(' · ')}</div>
                            {aud.level !== 'colonia' && (
                                <div className="mt-1 text-[#A5700a]">⚠️ Poca demanda en la colonia; se amplió a {aud.level} para juntar público.</div>
                            )}
                            <a className="mt-2 inline-block rounded-lg bg-[#212322] px-3 py-1.5 font-semibold text-white"
                                href={`/api/campanas/audience?format=csv&id=${encodeURIComponent(id.trim())}`}>⬇️ Descargar CSV</a>
                        </div>
                    )}

                    <hr className="my-2 border-neutral-200" />

                    <label className="text-xs font-semibold text-neutral-600">Enviar prueba a (default: tú)</label>
                    <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}
                        placeholder="tu.correo@pulppo.com" />
                    <button className={btnDark} onClick={sendTest} disabled={sending || !meta}>
                        {sending ? 'Enviando…' : '✉️ Enviar prueba'}
                    </button>

                    {msg && <div className="rounded-lg bg-[#eef7f4] px-3 py-2 text-xs text-[#2e6b5e]">{msg}</div>}
                    {error && <div className="rounded-lg bg-[#fdeeea] px-3 py-2 text-xs text-[#A52003]">{error}</div>}
                </div>

                {/* Preview */}
                <div className="min-h-[600px] rounded-lg border border-neutral-200 bg-neutral-100 p-3">
                    {previewUrl ? (
                        <iframe title="preview" src={previewUrl} className="h-[80vh] w-full rounded bg-white" />
                    ) : (
                        <div className="flex h-[80vh] items-center justify-center text-sm text-neutral-400">
                            El preview del email aparecerá aquí.
                        </div>
                    )}
                </div>
            </div>

            {/* Solapamiento / calendario */}
            <div className="mt-8 rounded-xl border border-neutral-200 p-5">
                <h2 className="text-xl">🗓️ Solapamiento entre bases (para calendarizar)</h2>
                <p className="mt-1 text-xs text-neutral-500">
                    Pega los códigos de las propiedades que quieres enviar (uno por línea o separados por coma).
                    Te digo cuánto se cruzan sus bases: si comparten mucha gente, conviene separarlas en semanas distintas;
                    si son zonas muy distintas, pueden salir el mismo día.
                </p>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row">
                    <textarea className="min-h-[90px] w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm lg:w-80"
                        value={ovCodes} onChange={(e) => setOvCodes(e.target.value)}
                        placeholder={'DSJ-888\nDNT-533\nOPB-709'} />
                    <div className="flex flex-col gap-2">
                        <button className={btnDark} onClick={checkOverlap} disabled={ovLoading}>
                            {ovLoading ? 'Revisando…' : 'Revisar solapamiento'}
                        </button>
                        <span className="text-[11px] text-neutral-400">Máx. 20 códigos</span>
                    </div>
                </div>

                {ov && (
                    <div className="mt-4 flex flex-col gap-4">
                        <div className="rounded-lg bg-[#fffdf5] px-3 py-2 text-sm text-neutral-700 border border-[#F6BE00]">{ov.nota}</div>
                        <div>
                            <div className="mb-1 text-xs font-semibold text-neutral-600">Tandas sugeridas (cada una = un día/semana de envío)</div>
                            <div className="flex flex-wrap gap-2">
                                {ov.days.map((grp, i) => (
                                    <div key={i} className="rounded-lg border border-neutral-300 px-3 py-2 text-xs">
                                        <b>Tanda {i + 1}</b>: {grp.join(', ')}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {ov.pairs.length > 0 && (
                            <div>
                                <div className="mb-1 text-xs font-semibold text-neutral-600">Cruce por pares</div>
                                <table className="text-xs">
                                    <tbody>
                                        {ov.pairs.map((p, i) => (
                                            <tr key={i} className="border-b border-neutral-100">
                                                <td className="py-1 pr-4 font-mono">{p.a} ↔ {p.b}</td>
                                                <td className="py-1 pr-4">{p.shared.toLocaleString('es-MX')} correos ({p.pct}%)</td>
                                                <td className="py-1">{p.verdict === 'separar' ? '🔴 separar semanas' : p.verdict === 'moderado' ? '🟡 moderado' : '🟢 mismo día'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* FASE 2 · Programar y enviar por SendGrid */}
            <div className="mt-8 rounded-xl border-2 border-[#212322] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl">🚀 Programar envíos reales (SendGrid)</h2>
                    <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                        onClick={loadSends} disabled={sendsLoading}>
                        {sendsLoading ? 'Cargando…' : '🔄 Ver estado de envíos'}
                    </button>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                    3 pasos: <b>1)</b> planeo el calendario repartiendo las bases que se cruzan en semanas distintas ·
                    <b> 2)</b> creo los borradores en SendGrid (con footer de baja) · <b>3)</b> tú apruebas y recién ahí se programan.
                    Nada se envía sin tu aprobación.
                </p>

                {/* Paso 1 · Planear */}
                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start">
                    <textarea className="min-h-[90px] w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm lg:w-80"
                        value={planCodes} onChange={(e) => setPlanCodes(e.target.value)}
                        placeholder={'DSJ-888\nDNT-533\nOPB-709'} />
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-neutral-600">Semana de inicio (lunes)</label>
                        <input type="date" className={inputCls} value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
                        <button className={btnDark} onClick={planCampaigns} disabled={planLoading}>
                            {planLoading ? 'Planeando…' : '1) Planear calendario'}
                        </button>
                        <span className="text-[11px] text-neutral-400">Máx. 20 códigos · envío 09:00 MX</span>
                    </div>
                </div>

                {plan && (
                    <div className="mt-4 flex flex-col gap-3">
                        <div className="rounded-lg bg-[#fffdf5] px-3 py-2 text-sm text-neutral-700 border border-[#F6BE00]">{plan.nota}</div>
                        {plan.notFound.length > 0 && (
                            <div className="rounded-lg bg-[#fdeeea] px-3 py-2 text-xs text-[#A52003]">No encontradas: {plan.notFound.join(', ')}</div>
                        )}
                        <div className="flex flex-col gap-3">
                            {plan.tandas.map((t) => (
                                <div key={t.tanda} className="rounded-lg border border-neutral-300 p-3">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <b className="text-sm">Semana {t.tanda}</b>
                                        <input type="date" className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                                            value={tandaDates[t.tanda] ?? t.date}
                                            onChange={(e) => setTandaDates((prev) => ({ ...prev, [t.tanda]: e.target.value }))} />
                                        <span className="text-xs text-neutral-500">{t.props.length} propiedad(es) · ~{t.totalDedup.toLocaleString('es-MX')} correos (sin repetir)</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {t.props.map((p) => (
                                            <span key={p.code} className="rounded-lg bg-neutral-50 border border-neutral-200 px-2 py-1 text-xs text-neutral-700">
                                                <b>{p.code}</b> · {p.colonia ?? p.ciudad ?? ''} · {p.count.toLocaleString('es-MX')} correos <span className="text-neutral-400">({p.level})</span>
                                                {' '}<a className="text-[#529999] underline" href={`/api/campanas/preview?id=${encodeURIComponent(p.code)}`} target="_blank" rel="noreferrer">👁 ver correo</a>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className={btnDark + ' self-start'} onClick={createDrafts} disabled={schedLoading}>
                            {schedLoading ? 'Creando borradores…' : '2) Crear borradores en SendGrid'}
                        </button>
                    </div>
                )}

                {/* Paso 2/3 · Borradores + aprobar */}
                {drafts.length > 0 && (
                    <div className="mt-5">
                        <div className="mb-2 text-xs font-semibold text-neutral-600">Borradores en SendGrid</div>
                        <table className="w-full text-xs">
                            <tbody>
                                {drafts.map((d, i) => (
                                    <tr key={i} className="border-b border-neutral-100">
                                        <td className="py-1.5 pr-3 font-mono">{d.code}</td>
                                        <td className="py-1.5 pr-3">
                                            {d.ok ? <>{(d.count ?? 0).toLocaleString('es-MX')} correos{d.skipped ? <span className="text-neutral-400"> ({d.skipped} inválidos descartados)</span> : null}</> : ''}
                                        </td>
                                        <td className="py-1.5 pr-3">{d.ok ? fmtDate(d.sendAt) : ''}</td>
                                        <td className="py-1.5 pr-3">
                                            {!d.ok ? <span className="text-[#A52003]">⚠️ {d.error}</span>
                                                : d.status === 'scheduled' ? <span className="text-[#2e6b5e]">✅ programado</span>
                                                    : <span className="text-neutral-500">📝 borrador</span>}
                                        </td>
                                        <td className="py-1.5 pr-3">
                                            <a className="text-[#529999] underline" href={`/api/campanas/preview?id=${encodeURIComponent(d.code)}`} target="_blank" rel="noreferrer">👁 ver</a>
                                        </td>
                                        <td className="py-1.5">
                                            {d.ok && d.id && (d.status === 'scheduled'
                                                ? <button className="text-[#A52003] underline" onClick={() => cancelSend(d.id as string)}>cancelar</button>
                                                : null)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button className={btnDark + ' mt-3'} onClick={approveDrafts} disabled={approving}>
                            {approving ? 'Programando…' : '3) Aprobar y programar todo'}
                        </button>
                    </div>
                )}

                {/* Estado / métricas */}
                {sends && (
                    <div className="mt-6">
                        <div className="mb-2 text-xs font-semibold text-neutral-600">Envíos 1·5·10 en SendGrid</div>
                        {sends.length === 0 ? (
                            <div className="text-xs text-neutral-400">Aún no hay campañas creadas desde el tool.</div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="text-neutral-400">
                                    <tr><th className="py-1 text-left">Campaña</th><th className="py-1 text-left">Estado</th><th className="py-1 text-left">Fecha</th><th className="py-1 text-left">Entregados</th><th className="py-1 text-left">Aperturas</th><th className="py-1 text-left">Clics</th><th className="py-1 text-left">Bajas</th><th></th></tr>
                                </thead>
                                <tbody>
                                    {sends.map((s) => (
                                        <tr key={s.id} className="border-b border-neutral-100">
                                            <td className="py-1.5 pr-3">{s.name}</td>
                                            <td className="py-1.5 pr-3">{s.status}</td>
                                            <td className="py-1.5 pr-3">{fmtDate(s.send_at)}</td>
                                            <td className="py-1.5 pr-3">{s.stats?.delivered?.toLocaleString('es-MX') ?? '—'}</td>
                                            <td className="py-1.5 pr-3">{s.stats?.unique_opens?.toLocaleString('es-MX') ?? '—'}</td>
                                            <td className="py-1.5 pr-3">{s.stats?.unique_clicks?.toLocaleString('es-MX') ?? '—'}</td>
                                            <td className="py-1.5 pr-3">{s.stats?.unsubscribes?.toLocaleString('es-MX') ?? '—'}</td>
                                            <td className="py-1.5">{s.status === 'scheduled' && <button className="text-[#A52003] underline" onClick={() => cancelSend(s.id)}>cancelar</button>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {f2msg && <div className="mt-4 rounded-lg bg-[#eef7f4] px-3 py-2 text-xs text-[#2e6b5e]">{f2msg}</div>}
                {f2err && <div className="mt-4 rounded-lg bg-[#fdeeea] px-3 py-2 text-xs text-[#A52003]">{f2err}</div>}
            </div>
        </div>
    );
}
