'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Generador de campañas 1·5·10 (Fase 1): buscar propiedad → preview del email on-brand →
// enviar prueba a un correo @pulppo.com. El envío masivo real llega en Fase 2 (SendGrid Single Sends).
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
                <b>Fase 1 — generar y probar.</b> Aquí armas el email desde una propiedad y te lo envías de prueba.
                Los envíos solo llegan a correos <b>@pulppo.com</b>. El envío a audiencias reales por SendGrid llega en la Fase 2.
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
        </div>
    );
}
