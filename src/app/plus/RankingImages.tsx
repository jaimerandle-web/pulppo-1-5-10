'use client';
// Imágenes del ranking: llena las plantillas de Polotno de "Ranking Pulppo" (post 1:1 e
// historia 9:16) con el top 3 de asesores por nivel y el top 5 de inmobiliarias del mes y
// las deja listas para descargar en PNG. Todo se edita antes de bajar: nombre, apellido,
// inmobiliaria, foto y logo (Mongo no siempre trae la foto buena ni el logo en blanco).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlusData, Level } from '@/lib/plus';
import {
    ensureFonts, fillTemplate, renderPage, shortName,
    type PolotnoDoc, type RankingFill, type Slide, type SlotBroker, type SlotCompany,
} from './rankingRender';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003';
const R = 2;
const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
type Fmt = 'post' | 'historia';
const FMT_LBL: Record<Fmt, string> = { post: 'Post 1:1', historia: 'Historia 9:16' };
const SLIDE_LBL: Record<Slide, string> = {
    portada: 'Portada', elite: 'Top 3 · Élite', professional: 'Top 3 · Profesional', standard: 'Top 3 · Estándar',
    consultoria: 'Top 5 · Inmobiliarias', onboarding: 'Top 5 · Onboarding',
};
const SLUG: Record<Slide, string> = {
    portada: 'portada', elite: 'elite', professional: 'profesional', standard: 'estandar',
    consultoria: 'top5-inmobiliarias', onboarding: 'top5-onboarding',
};
const LEVELS: Level[] = ['elite', 'professional', 'standard'];

function initialFill(d: PlusData): RankingFill {
    const br = (lv: Level): (SlotBroker | null)[] => [0, 1, 2].map((i) => {
        const b = d.brokers[lv][i];
        if (!b) return null;
        const [first, last] = shortName(b.first || b.name, b.last);
        return { first, last, inmo: b.company ?? '', photo: b.photo };
    });
    const co = (rows: PlusData['general']): (SlotCompany | null)[] =>
        [0, 1, 2, 3, 4].map((i) => (rows[i] ? { name: rows[i].name ?? '—', logo: rows[i].logo } : null));
    return {
        mes: MES[d.month - 1], year: d.year,
        brokers: { elite: br('elite'), professional: br('professional'), standard: br('standard') },
        consultoria: co(d.general), onboarding: co(d.onboarding),
    };
}

const readFile = (f: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
});

async function download(doc: PolotnoDoc, i: number, name: string) {
    const c = await renderPage(doc, doc.pages[i], 1);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('No se pudo generar el PNG');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function RankingImages({ d }: { d: PlusData }) {
    const [fmt, setFmt] = useState<Fmt>('post');
    const [tpl, setTpl] = useState<Record<Fmt, PolotnoDoc> | null>(null);
    const [fill, setFill] = useState<RankingFill>(() => initialFill(d));
    const [previews, setPreviews] = useState<string[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const gen = useRef(0);

    useEffect(() => {
        Promise.all([ensureFonts(), fetch('/plus/ranking/post.json').then((r) => r.json()), fetch('/plus/ranking/historia.json').then((r) => r.json())])
            .then(([, post, historia]) => setTpl({ post, historia }))
            .catch((e) => setErr(`No pude cargar las plantillas: ${e}`));
    }, []);

    const doc = useMemo(() => (tpl ? fillTemplate(tpl[fmt], fill) : null), [tpl, fmt, fill]);

    // Previsualización a escala chica; se descarta si llegó una edición más nueva.
    useEffect(() => {
        if (!doc) return;
        const my = ++gen.current;
        const t = setTimeout(async () => {
            const out: string[] = [];
            for (const p of doc.pages) out.push((await renderPage(doc, p, 0.36)).toDataURL('image/png'));
            if (my === gen.current) setPreviews(out);
        }, 200);
        return () => clearTimeout(t);
    }, [doc]);

    const fileName = (slide: Slide) => `ranking-${fmt}-${SLUG[slide]}-${fill.mes.toLowerCase()}-${fill.year}.png`;

    const bajar = async (i: number) => {
        if (!doc) return;
        const slide = doc.pages[i].custom?.slide as Slide;
        setBusy(fileName(slide)); setErr(null);
        try { await download(doc, i, fileName(slide)); }
        catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
        setBusy(null);
    };
    const bajarTodas = async () => {
        if (!doc) return;
        setErr(null);
        for (let i = 0; i < doc.pages.length; i++) {
            const slide = doc.pages[i].custom?.slide as Slide;
            setBusy(fileName(slide));
            try { await download(doc, i, fileName(slide)); }
            catch (e) { setErr(String(e instanceof Error ? e.message : e)); break; }
            // El navegador bloquea ráfagas de descargas; un respiro entre cada una.
            await new Promise((r) => setTimeout(r, 400));
        }
        setBusy(null);
    };

    const setBroker = (lv: Level, i: number, patch: Partial<SlotBroker>) => setFill((f) => {
        const arr = [...f.brokers[lv]];
        arr[i] = { ...(arr[i] ?? { first: '', last: '', inmo: '', photo: null }), ...patch };
        return { ...f, brokers: { ...f.brokers, [lv]: arr } };
    });
    const setCompany = (k: 'consultoria' | 'onboarding', i: number, patch: Partial<SlotCompany>) => setFill((f) => {
        const arr = [...f[k]];
        arr[i] = { ...(arr[i] ?? { name: '', logo: null }), ...patch };
        return { ...f, [k]: arr };
    });

    const inp: CSSProperties = { border: `1px solid ${LGT}`, borderRadius: R, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', minWidth: 0, width: '100%', boxSizing: 'border-box' };
    const btn = (primary = false): CSSProperties => ({
        padding: '6px 10px', borderRadius: R, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${primary ? BLK : '#ddd'}`, background: primary ? BLK : '#fff', color: primary ? '#fff' : BLK, fontFamily: 'inherit',
    });
    const Upload = ({ label, onFile }: { label: string; onFile: (s: string) => void }) => (
        <label style={btn()}>
            {label}
            <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) onFile(await readFile(fl)); e.target.value = ''; }} />
        </label>
    );

    const editor = (slide: Slide) => {
        if (slide === 'portada') return <div style={{ fontSize: 11.5, color: '#777' }}>Lleva el mes ({fill.mes} {fill.year}). Nada que editar.</div>;
        if (LEVELS.includes(slide as Level)) {
            const lv = slide as Level;
            return (
                <div style={{ display: 'grid', gap: 8 }}>
                    {[0, 1, 2].map((i) => {
                        const b = fill.brokers[lv][i];
                        return (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr 1fr', gap: 5, alignItems: 'center' }}>
                                <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 16, color: GRY }}>{i + 1}</span>
                                <input style={inp} placeholder="Nombre" value={b?.first ?? ''} onChange={(e) => setBroker(lv, i, { first: e.target.value })} />
                                <input style={inp} placeholder="Apellido" value={b?.last ?? ''} onChange={(e) => setBroker(lv, i, { last: e.target.value })} />
                                <span />
                                <input style={inp} placeholder="Inmobiliaria" value={b?.inmo ?? ''} onChange={(e) => setBroker(lv, i, { inmo: e.target.value })} />
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <Upload label={b?.photo ? 'Cambiar foto' : 'Subir foto'} onFile={(s) => setBroker(lv, i, { photo: s })} />
                                    {b?.photo && <span style={btn()} onClick={() => setBroker(lv, i, { photo: null })}>Iniciales</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }
        const k = slide as 'consultoria' | 'onboarding';
        return (
            <div style={{ display: 'grid', gap: 6 }}>
                {[0, 1, 2, 3, 4].map((i) => {
                    const c = fill[k][i];
                    return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontFamily: 'EB Garamond, serif', fontSize: 16, color: GRY }}>{i + 1}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c?.name ?? '—'}{c && !c.logo && <span style={{ color: RED, fontWeight: 400 }}> · sin logo</span>}
                            </span>
                            {c && <Upload label={c.logo ? 'Cambiar logo' : 'Subir logo'} onFile={(s) => setCompany(k, i, { logo: s })} />}
                        </div>
                    );
                })}
                <div style={{ fontSize: 10.5, color: '#888', lineHeight: 1.4 }}>
                    Los logos con fondo transparente se ponen en blanco solos. Si uno sale en placa blanca,
                    trae fondo: sube su versión PNG sin fondo.
                </div>
            </div>
        );
    };

    if (err && !tpl) return <div style={{ color: RED, fontSize: 13 }}>{err}</div>;
    if (!doc) return <div style={{ color: GRY, fontSize: 13 }}>Cargando plantillas…</div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                    <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 21 }}>Imágenes del ranking · {fill.mes} {fill.year}</div>
                    <div style={{ fontSize: 11.5, color: '#777', marginTop: 3 }}>
                        Con la métrica <b>{d.metric === 'cobrada' ? 'cobrada' : 'total'}</b> seleccionada arriba. Revisa nombres, fotos y logos antes de descargar.
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(['post', 'historia'] as Fmt[]).map((x) => (
                        <span key={x} onClick={() => setFmt(x)} style={{ ...btn(), background: fmt === x ? YEL : '#fff', borderColor: fmt === x ? YEL : '#ddd' }}>{FMT_LBL[x]}</span>
                    ))}
                    <span style={btn(true)} onClick={busy ? undefined : bajarTodas}>{busy ? 'Generando…' : `Descargar las ${doc.pages.length}`}</span>
                    <span style={btn()} onClick={() => setFill(initialFill(d))}>Restablecer</span>
                </div>
            </div>
            {err && <div style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{err}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 14 }}>
                {doc.pages.map((p, i) => {
                    const slide = p.custom?.slide as Slide;
                    return (
                        <div key={`${fmt}-${i}`} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: 12, display: 'flex', gap: 14, alignItems: 'flex-start', background: '#fff' }}>
                            <div style={{ width: fmt === 'post' ? 230 : 150, flexShrink: 0 }}>
                                {previews[i]
                                    ? <img src={previews[i]} alt={SLIDE_LBL[slide]} style={{ width: '100%', display: 'block', border: `1px solid ${LGT}` }} />
                                    : <div style={{ aspectRatio: `${doc.width} / ${doc.height}`, background: LGT }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, color: '#666' }}>{SLIDE_LBL[slide]}</div>
                                    <span style={btn(true)} onClick={busy ? undefined : () => bajar(i)}>PNG</span>
                                </div>
                                {editor(slide)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
