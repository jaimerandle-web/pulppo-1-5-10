'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import type { AnalisisData } from '@/lib/analisis';
import { CIERRES_WIN, DEMANDA_WIN, DESEMPENO_WIN, COMPARAR_OPTS, mesesOpts } from '@/lib/ventanas';
import { InventarioView, FunnelView, YoyView, AsesoresView, Top10View, RecoView, GlosarioView } from '@/app/analisis/views';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;

// Secciones MB. Los títulos responden una PREGUNTA y dicen la conclusión, no el método
// (decisión de Ale, ago-2026). Fuera "precio × calidad" y "cómo se ha destacado".
// `lee` = el "cómo se lee esto" de la sección, que ahora vive dentro de cada una en vez de
// estar todo junto al final.
const SECS = [
    { id: 'inventario', label: 'Dónde está tu inventario',
      lee: 'Tus zonas principales con tu inventario, la oferta que compite, la demanda de compradores y qué tan competitivo es tu precio contra lo que se pide y lo que realmente se vende.' },
    { id: 'funnel', label: 'Qué pasa con tus leads',
      lee: 'El recorrido completo: cuántos leads llegaron, cuántos se contestaron, cuántos llegaron a visita, a oferta y a cierre. La referencia son las inmobiliarias que más cierran en la red.' },
    { id: 'asesores', label: 'Cómo están tus asesores',
      lee: 'Cada asesor de tu inmobiliaria con sus leads, qué tan rápido responde, cuánto abandona, cuánto trabaja su cartera y qué cierra. Los brokers de otras inmobiliarias no aparecen aquí.' },
    { id: 'yoy', label: 'Comparación de períodos',
      lee: 'El período elegido contra su base. El inventario es la foto al cierre de cada período; leads, cierres y comisión son el flujo dentro del período.' },
    { id: 'top10', label: 'Propiedades con potencial',
      lee: 'Propiedades en zonas con demanda real pero con pocos o cero leads, y el freno más probable de cada una. Son las de arreglo más rápido.' },
    { id: 'reco', label: 'Dame recomendaciones',
      lee: 'Las acciones con más impacto sobre tu cartera, ordenadas por severidad.' },
    { id: 'glosario', label: 'Cómo leer este reporte',
      lee: '' }
] as const;

const MESES_OPTS = mesesOpts();

export default function MBAnalisis({ companyId, name, asesores = [] }: { companyId: string; name: string; asesores?: string[] }) {
    const [operacion, setOperacion] = useState('Ambas');
    const [asesor, setAsesor] = useState('');   // '' = toda la inmobiliaria
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
    useEffect(() => { setData(null); }, [operacion, asesor, desempeno, desempenoMes, comparar, ventCierres, ventDemanda]);

    const generar = async () => {
        setLoading(true); setErr(''); setData(null);
        try {
            const res = await fetch('/api/mb-analisis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId, operacion, asesor,
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
                    {asesores.length > 0 && (
                        <div>
                            <div style={lbl}>Asesor</div>
                            <select value={asesor} onChange={(e) => setAsesor(e.target.value)} style={sel} title="Acota TODO el reporte a la cartera de un asesor">
                                <option value="">Toda la inmobiliaria</option>
                                {asesores.map((a) => <option key={a}>{a}</option>)}
                            </select>
                        </div>
                    )}
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

            {/* El botón se perdía en negro entre tanto control: va en amarillo de marca. */}
            <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button onClick={generar} disabled={loading}
                    style={{ fontSize: 14, fontWeight: 800, padding: '12px 26px', borderRadius: R, border: `2px solid ${YEL}`,
                        background: loading ? LGT : YEL, color: BLK, cursor: loading ? 'default' : 'pointer',
                        letterSpacing: '.3px', boxShadow: loading ? 'none' : '0 1px 0 rgba(0,0,0,.18)' }}>
                    {loading ? 'Generando…' : 'Generar análisis →'}
                </button>
                {data && (
                    <button onClick={() => window.print()}
                        style={{ fontSize: 13, fontWeight: 700, padding: '11px 18px', borderRadius: R, border: `1px solid ${BLK}`, background: '#fff', color: BLK, cursor: 'pointer' }}>
                        Descargar PDF
                    </button>
                )}
            </div>

            {err && <div style={{ marginTop: 16, background: '#fdeeea', color: RED, borderRadius: R, padding: '10px 14px', fontSize: 12 }}>{err}</div>}

            {data && (
                <div id="mb-reporte" style={{ marginTop: 24 }}>
                    {/* Al imprimir: solo el reporte, en ancho de hoja y sin cortar secciones a la mitad. */}
                    <style>{`@media print {
                        body * { visibility: hidden !important; }
                        #mb-reporte, #mb-reporte * { visibility: visible !important; }
                        #mb-reporte { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; }
                        #mb-reporte .sec { break-inside: avoid; page-break-inside: avoid; margin-bottom: 18px !important; }
                        #mb-reporte table { font-size: 8px !important; }
                        @page { size: A4 landscape; margin: 12mm; }
                    }`}</style>
                    {/* El reporte declara arriba, sin que haya que adivinarlo, qué está comparando. */}
                    <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '11px 14px', fontSize: 11.5, color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
                        <b style={{ color: BLK }}>Desempeño:</b> {data.leadsLabel}
                        {data.hasComp ? <> · comparado contra <b style={{ color: BLK }}>{data.compLabels.a}</b> <span style={{ color: GRY }}>(el ▲▼ de cada sección es contra ese período)</span></> : <> · <b style={{ color: BLK }}>sin comparación</b></>}
                        {' '}· <b style={{ color: BLK }}>Comparables:</b> cierres {data.cierresLabel} · demanda {data.demandaLabel} · oferta hoy
                        {data.asesorFiltro && <> · <b style={{ color: BLK }}>Solo la cartera de {data.asesorFiltro}</b></>}
                    </div>
                    <div style={{ fontSize: 11, color: GRY, marginBottom: 14 }}>Datos en vivo · corte {new Date(data.corte).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · {data.company}</div>
                    {SECS.filter((s) => secs.includes(s.id)).map((s, i) => (
                        <div key={s.id} className="sec" style={{ marginBottom: 30 }}>
                            <div style={eyebrow}>{String(i + 1).padStart(2, '0')} · {s.label}</div><div style={accent} />
                            {s.lee && <div style={{ fontSize: 11, color: '#666', background: LGT, borderRadius: R, padding: '8px 11px', marginBottom: 10, maxWidth: 760, lineHeight: 1.45 }}><b style={{ color: BLK }}>Cómo se lee:</b> {s.lee}</div>}
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
