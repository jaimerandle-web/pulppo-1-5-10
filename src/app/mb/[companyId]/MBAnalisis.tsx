'use client';
import { useState, type CSSProperties } from 'react';
import type { AnalisisData } from '@/lib/analisis';
import { InventarioView, PrecioView, FunnelView, YoyView, Top10View, RecoView, GlosarioView } from '@/app/analisis/views';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;

const COMP_TYPES = ['Año vs año (YTD)', 'Mismo mes, año vs año', 'Mes vs mes anterior', 'Trimestre vs anterior', 'Últimos 30 días vs 30 previos', 'Últimos 90 días vs 90 previos'];
const VENTANAS = ['Últimos 90 días', '6 meses', 'Año'];
const mapVentana = (v: string) => v === 'Año' ? { ventDemanda: 'Últimos 12 meses', ventLeads: 'Últimos 12 meses' }
    : v === '6 meses' ? { ventDemanda: 'Últimos 6 meses', ventLeads: 'Últimos 6 meses' }
        : { ventDemanda: 'Últimos 6 meses', ventLeads: 'Últimos 90 días' };
// Secciones MB (sin destacados).
const SECS = [
    { id: 'inventario', label: 'Inventario: dónde y cómo' },
    { id: 'precio', label: 'Precio × calidad + leads' },
    { id: 'funnel', label: 'Funnel comercial' },
    { id: 'yoy', label: 'Comparación de períodos' },
    { id: 'top10', label: 'Top 10 críticas' },
    { id: 'reco', label: 'Recomendaciones' },
    { id: 'glosario', label: '¿Cómo leer esto?' }
] as const;

export default function MBAnalisis({ companyId, name }: { companyId: string; name: string }) {
    const [operacion, setOperacion] = useState('Ambas');
    const [comparacion, setComparacion] = useState('Año vs año (YTD)');
    const [ventana, setVentana] = useState('6 meses');
    const [secs, setSecs] = useState<string[]>(SECS.map((s) => s.id));
    const [data, setData] = useState<AnalisisData | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    const generar = async () => {
        setLoading(true); setErr(''); setData(null);
        const { ventDemanda, ventLeads } = mapVentana(ventana);
        try {
            const res = await fetch('/api/mb-analisis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, operacion, comparacion, ventDemanda, ventLeads, referencias: ['Oferta de zona', 'Cierres reales'], mlsGeneral: true, zombie: 'Últimos 90 días' })
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
    const chip = (on: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '6px 11px', borderRadius: R, cursor: 'pointer', border: `1px solid ${on ? BLK : LGT}`, background: on ? BLK : '#fff', color: on ? '#fff' : '#555' });

    return (
        <div>
            <div style={eyebrow}>Generador de análisis</div><div style={accent} />
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 30, margin: 0 }}>Análisis de {name}</h1>
            <div style={sub}>Reporte de tu inmobiliaria en vivo. Elige operación, período a comparar y ventana; el resto está preconfigurado.</div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', border: `1px solid ${LGT}`, borderRadius: R, padding: '16px 18px' }}>
                <div><div style={lbl}>Operación</div><select value={operacion} onChange={(e) => setOperacion(e.target.value)} style={sel}>{['Ambas', 'Venta', 'Renta'].map((o) => <option key={o}>{o}</option>)}</select></div>
                <div><div style={lbl}>Comparación de períodos</div><select value={comparacion} onChange={(e) => setComparacion(e.target.value)} style={sel}>{COMP_TYPES.map((o) => <option key={o}>{o}</option>)}</select></div>
                <div><div style={lbl}>Ventana de análisis</div><select value={ventana} onChange={(e) => setVentana(e.target.value)} style={sel}>{VENTANAS.map((o) => <option key={o}>{o}</option>)}</select></div>
                <button onClick={generar} disabled={loading} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: R, border: 'none', background: BLK, color: '#fff', cursor: 'pointer' }}>{loading ? 'Generando…' : 'Generar análisis'}</button>
            </div>

            <div style={{ marginTop: 12 }}>
                <div style={{ ...lbl, marginBottom: 8 }}>Secciones a incluir</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SECS.map((s) => <span key={s.id} onClick={() => setSecs((p) => p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id])} style={chip(secs.includes(s.id))}>{s.label}</span>)}
                </div>
            </div>

            {err && <div style={{ marginTop: 16, background: '#fdeeea', color: RED, borderRadius: R, padding: '10px 14px', fontSize: 12 }}>{err}</div>}

            {data && (
                <div style={{ marginTop: 24 }}>
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
