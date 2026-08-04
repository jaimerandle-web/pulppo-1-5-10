'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import type { AnalisisData } from '@/lib/analisis';
import { CIERRES_WIN, DEMANDA_WIN, DESEMPENO_WIN, COMPARAR_OPTS, mesesOpts } from '@/lib/ventanas';
import { InventarioView, PrecioView, FunnelView, YoyView, AsesoresView, Top10View, RecoView, GlosarioView } from '@/app/analisis/views';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;

// Secciones MB (sin destacados: el nivel de aviso es información interna).
const SECS = [
    { id: 'inventario', label: 'Inventario: dónde y cómo' },
    { id: 'precio', label: 'Precio × calidad + leads' },
    { id: 'funnel', label: 'Funnel comercial' },
    { id: 'asesores', label: 'Desempeño por asesor' },
    { id: 'yoy', label: 'Comparación de períodos' },
    { id: 'top10', label: 'Top 10 críticas' },
    { id: 'reco', label: 'Recomendaciones' },
    { id: 'glosario', label: '¿Cómo leer esto?' }
] as const;

const MESES_OPTS = mesesOpts();

export default function MBAnalisis({ companyId, name }: { companyId: string; name: string }) {
    const [operacion, setOperacion] = useState('Ambas');
    // --- DESEMPEÑO (tu operación): una ventana + una base de comparación ---
    const [desempeno, setDesempeno] = useState('Últimos 3 meses');
    const [desempenoMes, setDesempenoMes] = useState(MESES_OPTS[1].v);
    const [comparar, setComparar] = useState('Período anterior');
    // --- COMPARABLES (mercado): cierres y demanda; la oferta es foto de hoy ---
    const [ventCierres, setVentCierres] = useState('Últimos 12 meses');
    const [ventDemanda, setVentDemanda] = useState('Últimos 3 meses');
    const [secs, setSecs] = useState<string[]>(SECS.map((s) => s.id));
    const [data, setData] = useState<AnalisisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    // La configuración cambió → lo que está en pantalla ya no corresponde: se limpia para no
    // dejar números viejos con filtros nuevos (era el motivo de "los filtros no funcionan").
    useEffect(() => { setData(null); }, [operacion, desempeno, desempenoMes, comparar, ventCierres, ventDemanda]);

    const generar = async () => {
        setLoading(true); setErr(''); setData(null);
        try {
            const res = await fetch('/api/mb-analisis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId, operacion,
                    desempeno, desempenoMes, comparar,
                    ventCierres, ventDemanda,
                    referencias: ['Oferta de zona', 'Cierres reales'], mlsGeneral: true
                })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'No se pudo generar el análisis');
            setData(d);
        } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); } finally { setLoading(false); }
    };

    const renderSec = (id: string) => {
        if (!data) return null;
        switch (id) {
            case 'inventario': return <InventarioView d={data} referencias={['Oferta de zona', 'Cierres reales']} cortes={['Por zona', 'Por ticket', 'Por tipo']} mb />;
            case 'precio': return <PrecioView d={data} />;
            case 'funnel': return <FunnelView d={data} portalMode="Todas las fuentes" portales={[]} />;
            case 'asesores': return <AsesoresView d={data} />;
            case 'yoy': return <YoyView d={data} />;
            case 'top10': return <Top10View d={data} />;
            case 'reco': return <RecoView d={data} enfoque={[]} tono="Sugerente" cantidad="Top 6" />;
            case 'glosario': return <GlosarioView d={data} mb />;
            default: return null;
        }
    };

    const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY };
    const accent: CSSProperties = { width: 52, height: 2, background: YEL, margin: '9px 0 12px' };
    const sub: CSSProperties = { fontSize: 12, color: GRY, marginBottom: 14 };
    const sel: CSSProperties = { fontSize: 12, padding: '7px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', minWidth: 160 };
    const lbl: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: BLK, marginBottom: 5 };
    const blockTitle: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: SEA, marginBottom: 3 };
    const blockHint: CSSProperties = { fontSize: 11, color: GRY, marginBottom: 11, maxWidth: 620, lineHeight: 1.4 };
    const chip = (on: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '6px 11px', borderRadius: R, cursor: 'pointer', border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555' });
    const box: CSSProperties = { border: `1px solid ${LGT}`, borderRadius: R, padding: '14px 16px', marginBottom: 10 };

    return (
        <div>
            <div style={eyebrow}>Generador de análisis</div><div style={accent} />
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: 0 }}>Análisis de {name}</h1>
            <div style={sub}>Reporte de tu inmobiliaria en vivo. Las fechas van en dos bloques: <b>desempeño</b> (tu operación) y <b>comparables</b> (el mercado).</div>

            <div style={box}>
                <div style={blockTitle}>Desempeño · tu operación</div>
                <div style={blockHint}>
                    Manda el <b>funnel comercial</b>, el <b>desempeño por asesor</b>, los leads por propiedad y las propiedades sin actividad.
                    Es la única ventana que se compara contra otro período.
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div><div style={lbl}>Operación</div><select value={operacion} onChange={(e) => setOperacion(e.target.value)} style={sel}>{['Ambas', 'Venta', 'Renta'].map((o) => <option key={o}>{o}</option>)}</select></div>
                    <div><div style={lbl}>Período</div><select value={desempeno} onChange={(e) => setDesempeno(e.target.value)} style={sel}>{DESEMPENO_WIN.map((o) => <option key={o}>{o}</option>)}</select></div>
                    {desempeno === 'Mes específico' && (
                        <div><div style={lbl}>Mes</div><select value={desempenoMes} onChange={(e) => setDesempenoMes(e.target.value)} style={sel}>{MESES_OPTS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select></div>
                    )}
                    <div><div style={lbl}>Comparar contra</div><select value={comparar} onChange={(e) => setComparar(e.target.value)} style={sel}>{COMPARAR_OPTS.map((o) => <option key={o}>{o}</option>)}</select></div>
                </div>
            </div>

            <div style={box}>
                <div style={blockTitle}>Comparables · el mercado</div>
                <div style={blockHint}>
                    Para saber si tu precio es competitivo, cuánta competencia tienes y cuánta gente está buscando en tus zonas.
                    La <b>oferta</b> (lo que se pide) es siempre una foto de <b>hoy</b>: no se guarda su historia.
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div><div style={lbl}>Cierres comparables</div><select value={ventCierres} onChange={(e) => setVentCierres(e.target.value)} style={sel}>{CIERRES_WIN.map((o) => <option key={o}>{o}</option>)}</select><div style={{ fontSize: 9.5, color: GRY, marginTop: 4 }}>Mínimo 6 meses: los cierres son pocos.</div></div>
                    <div><div style={lbl}>Demanda (búsquedas)</div><select value={ventDemanda} onChange={(e) => setVentDemanda(e.target.value)} style={sel}>{DEMANDA_WIN.map((o) => <option key={o}>{o}</option>)}</select><div style={{ fontSize: 9.5, color: GRY, marginTop: 4 }}>Mínimo 1 mes.</div></div>
                    <div style={{ alignSelf: 'flex-end', fontSize: 11, color: GRY, padding: '7px 11px', background: LGT, borderRadius: R }}>Oferta: <b style={{ color: BLK }}>hoy</b> (fija)</div>
                </div>
            </div>

            <div style={{ marginTop: 12 }}>
                <div style={{ ...lbl, marginBottom: 8 }}>Secciones a incluir</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SECS.map((s) => <span key={s.id} onClick={() => setSecs((p) => p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id])} style={chip(secs.includes(s.id))}>{s.label}</span>)}
                </div>
            </div>

            <button onClick={generar} disabled={loading} style={{ marginTop: 14, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: R, border: 'none', background: BLK, color: '#fff', cursor: 'pointer' }}>{loading ? 'Generando…' : 'Generar análisis'}</button>

            {err && <div style={{ marginTop: 16, background: '#fdeeea', color: RED, borderRadius: R, padding: '10px 14px', fontSize: 12 }}>{err}</div>}

            {data && (
                <div style={{ marginTop: 24 }}>
                    {/* El reporte declara arriba, sin que haya que adivinarlo, qué períodos está comparando. */}
                    <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '11px 14px', fontSize: 11.5, color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
                        <b style={{ color: BLK }}>Desempeño:</b> {data.leadsLabel}
                        {data.hasComp ? <> · comparado contra <b style={{ color: BLK }}>{data.compLabels.a}</b></> : <> · <b style={{ color: BLK }}>sin comparación</b></>}
                        {' '}· <b style={{ color: BLK }}>Comparables:</b> cierres {data.cierresLabel} · demanda {data.demandaLabel} · oferta hoy
                    </div>
                    <div style={{ fontSize: 11, color: GRY, marginBottom: 14 }}>Datos en vivo · corte {new Date(data.corte).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · {data.company}</div>
                    {SECS.filter((s) => secs.includes(s.id)).map((s) => (
                        <div key={s.id} style={{ marginBottom: 30 }}>
                            <div style={eyebrow}>{s.label}</div><div style={accent} />
                            {renderSec(s.id)}
                        </div>
                    ))}
                    {!secs.length && <div style={{ color: GRY, fontSize: 13, padding: '20px 0' }}>Elige al menos una sección.</div>}
                </div>
            )}
            {!data && !loading && <div style={{ marginTop: 24, background: LGT, borderRadius: R, padding: '24px', textAlign: 'center', color: '#555', fontSize: 13 }}>Configura arriba y dale <b>Generar análisis</b>.</div>}
        </div>
    );
}
