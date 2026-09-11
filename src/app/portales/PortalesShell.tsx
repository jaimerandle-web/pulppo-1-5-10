'use client';
// Cliente: decide qué vista pedir y cuándo. Dos modos:
//   · análisis     — todo, para nosotros
//   · presentación — un solo portal, para enseñárselo a ese portal (ver Presentacion.tsx)
//
// Cada vista se carga aparte y sólo al entrar: abrir la página no debe pagar las cuatro
// consultas. El rango de meses vuelve a pedir la vista de costo; el de fechas, la de periodo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortalesView } from '@/lib/portales/view';
import type { PulseView } from '@/lib/portales/pulse';
import type { HistoricoView } from '@/lib/portales/historico';
import type { PeriodoView } from '@/lib/portales/periodo';
import PortalesApp, { type Section } from './PortalesApp';
import Presentacion, { SECCIONES, type SeccionP } from './Presentacion';

type Vista = 'costo' | 'pulso' | 'historico' | 'periodo';
type Datos = { costo?: PortalesView; pulso?: PulseView; historico?: HistoricoView; periodo?: PeriodoView };

const DE_SECCION: Record<Section, Vista | null> = {
    costo: 'costo', funnel: 'costo', deal: 'costo',
    pulso: 'pulso', historico: 'historico', comoleer: null,
};

const BLK = '#212322', GRY = '#B7B7B7', LGT = '#F3F3F3';
const mesKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PortalesShell() {
    const hoy = useMemo(() => new Date(Date.now() - 6 * 3600 * 1000), []);
    const [section, setSection] = useState<Section>('costo');
    const [modo, setModo] = useState<'analisis' | 'presentacion'>('analisis');
    const [portal, setPortal] = useState('i24');
    const [secs, setSecs] = useState<Set<SeccionP>>(new Set(['volumen', 'mezcla', 'atencion', 'embudo']));

    // Rango de MESES para todo lo que lleva costo (ver view.ts: la inversión es mensual).
    const [desde, setDesde] = useState(() => {
        const d = new Date(hoy); d.setUTCMonth(d.getUTCMonth() - 5); return mesKey(d);
    });
    const [hasta, setHasta] = useState(() => mesKey(hoy));
    // Rango de FECHAS exactas, sólo para contar leads.
    const [pDesde, setPDesde] = useState(() => iso(new Date(hoy.getTime() - 29 * 86400000)));
    const [pHasta, setPHasta] = useState(() => iso(hoy));

    const [d, setD] = useState<Datos>({});
    const [at, setAt] = useState<Partial<Record<Vista, number>>>({});
    const [err, setErr] = useState<string | null>(null);
    const [cargando, setCargando] = useState<Vista | null>(null);

    const cargar = useCallback((v: Vista, q = '', refresh = false) => {
        setCargando(v); setErr(null);
        fetch(`/api/portales?view=${v}${q}${refresh ? '&refresh=1' : ''}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { setD((p) => ({ ...p, [v]: j })); setAt((p) => ({ ...p, [v]: j.cacheAt ?? Date.now() })); })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(null));
    }, []);

    const qCosto = `&desde=${desde}&hasta=${hasta}`;
    const qPeriodo = `&desde=${pDesde}&hasta=${pHasta}`;

    // La vista de costo se recarga cuando cambia el rango de meses.
    useEffect(() => { cargar('costo', qCosto); }, [cargar, qCosto]);
    // Las demás, perezosas: sólo al entrar a su sección.
    useEffect(() => {
        const v = DE_SECCION[section];
        if (v && v !== 'costo' && !d[v] && cargando !== v) cargar(v);
    }, [section, d, cargando, cargar]);
    // El periodo sólo si está prendido en presentación.
    useEffect(() => {
        if (modo === 'presentacion' && secs.has('periodo') && cargando !== 'periodo') cargar('periodo', qPeriodo);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modo, secs.has('periodo'), qPeriodo]);

    const inp: React.CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: 2, fontSize: 12, fontFamily: 'inherit', color: BLK };

    const controles = (
        <>
            <label style={{ fontSize: 11, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Meses</label>
            <input type="month" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} style={inp} />
            <span style={{ color: GRY, fontSize: 12 }}>a</span>
            <input type="month" value={hasta} min={desde} max={mesKey(hoy)} onChange={(e) => setHasta(e.target.value)} style={inp} />
        </>
    );

    if (err) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#A52003' }}>No pude cargar los datos: {err}</div>;
    if (!d.costo) return (
        <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: GRY }}>
            Consultando Mongo y el Sheet de inversión… la primera carga tarda unos segundos.
        </div>
    );

    if (modo === 'presentacion') {
        return (
            <Presentacion
                d={d.costo} periodo={d.periodo ?? null} portalKey={portal} secciones={secs}
                meses={d.costo.meses} onSalir={() => setModo('analisis')}
                encabezado={
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontFamily: 'Nunito Sans, sans-serif' }}>
                        <select value={portal} onChange={(e) => setPortal(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
                            {d.costo.portales.filter((p) => p.pagado).map((p) => <option key={p.key} value={p.key}>{p.canal}</option>)}
                        </select>
                        {controles}
                        {secs.has('periodo') && (
                            <>
                                <span style={{ color: GRY, fontSize: 12 }}>· fechas</span>
                                <input type="date" value={pDesde} max={pHasta} onChange={(e) => setPDesde(e.target.value)} style={inp} />
                                <input type="date" value={pHasta} min={pDesde} max={iso(hoy)} onChange={(e) => setPHasta(e.target.value)} style={inp} />
                            </>
                        )}
                        <span style={{ width: 1, height: 20, background: LGT }} />
                        {SECCIONES.map(([k, label]) => (
                            <label key={k} style={{ fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer', color: secs.has(k) ? BLK : GRY }}>
                                <input type="checkbox" checked={secs.has(k)} onChange={(e) => setSecs((p) => {
                                    const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n;
                                })} />
                                {label}
                            </label>
                        ))}
                        {cargando && <span style={{ fontSize: 11, color: GRY }}>calculando…</span>}
                    </div>
                }
            />
        );
    }

    const vistaActual = DE_SECCION[section];
    return (
        <PortalesApp
            d={d.costo} pulso={d.pulso ?? null} hist={d.historico ?? null}
            section={section} setSection={setSection}
            cacheAt={(vistaActual && at[vistaActual]) ?? null}
            cargando={cargando !== null}
            onRefresh={() => { if (vistaActual) cargar(vistaActual, vistaActual === 'costo' ? qCosto : '', true); }}
            controles={controles}
            onPresentar={() => setModo('presentacion')}
        />
    );
}
