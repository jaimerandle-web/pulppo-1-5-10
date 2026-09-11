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
import type { CalidadView } from '@/lib/portales/calidad';
import PortalesApp, { type Section } from './PortalesApp';
import Presentacion, { SECCIONES, type SeccionP } from './Presentacion';

type Vista = 'costo' | 'pulso' | 'historico' | 'periodo' | 'calidad';
type Datos = { calidadQ?: string; costo?: PortalesView; pulso?: PulseView; historico?: HistoricoView; periodo?: PeriodoView; calidad?: CalidadView };

const DE_SECCION: Record<Section, Vista | null> = {
    costo: 'costo', funnel: 'costo', deal: 'costo',
    calidad: 'calidad', pulso: 'pulso', historico: 'historico', comoleer: null,
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
    //
    // Hay DOS estados a propósito: el BORRADOR (lo que estás tecleando) y lo APLICADO (lo que
    // se consultó). Antes la consulta salía en cuanto tocabas un input: cambiar "desde" y luego
    // "hasta" disparaba dos consultas de 20 s, la primera de un rango que nunca quisiste, y
    // mientras tanto la pantalla seguía mostrando los números viejos sin avisar. Ahora nada se
    // mueve hasta que le das Aplicar.
    const iniDesde = useMemo(() => { const d = new Date(hoy); d.setUTCMonth(d.getUTCMonth() - 5); return mesKey(d); }, [hoy]);
    const [desde, setDesde] = useState(iniDesde);
    const [hasta, setHasta] = useState(() => mesKey(hoy));
    const [oper, setOper] = useState<'todas' | 'sale' | 'rent'>('todas');
    const [bDesde, setBDesde] = useState(iniDesde);
    const [bHasta, setBHasta] = useState(() => mesKey(hoy));
    const [bOper, setBOper] = useState<'todas' | 'sale' | 'rent'>('todas');
    const sucio = bDesde !== desde || bHasta !== hasta || bOper !== oper;
    const aplicar = () => { setDesde(bDesde); setHasta(bHasta); setOper(bOper); };
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
            .then((j) => {
                setD((p) => ({ ...p, [v]: j, ...(v === 'calidad' ? { calidadQ: q } : {}) }));
                setAt((p) => ({ ...p, [v]: j.cacheAt ?? Date.now() }));
            })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(null));
    }, []);

    const qCosto = `&desde=${desde}&hasta=${hasta}&operacion=${oper}`;
    const qPeriodo = `&desde=${pDesde}&hasta=${pHasta}`;

    // La vista de costo se recarga cuando cambia el rango de meses.
    useEffect(() => { cargar('costo', qCosto); }, [cargar, qCosto]);
    // Las demás, perezosas: sólo al entrar a su sección.
    useEffect(() => {
        const v = DE_SECCION[section];
        if (!v || v === 'costo' || cargando === v) return;
        // Calidad usa el MISMO rango y filtro que costo, así que se repide cuando cambian.
        if (v === 'calidad') { if (d.calidadQ !== qCosto) cargar('calidad', qCosto); return; }
        if (!d[v]) cargar(v);
    }, [section, d, cargando, cargar, qCosto]);
    // El periodo sólo si está prendido en presentación.
    useEffect(() => {
        if (modo === 'presentacion' && secs.has('periodo') && cargando !== 'periodo') cargar('periodo', qPeriodo);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modo, secs.has('periodo'), qPeriodo]);

    const inp: React.CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: 2, fontSize: 12, fontFamily: 'inherit', color: BLK };

    const OPS: Array<['todas' | 'sale' | 'rent', string]> = [['todas', 'Todo'], ['sale', 'Venta'], ['rent', 'Renta']];
    const controles = (
        <>
            <label style={{ fontSize: 11, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Meses</label>
            <input type="month" value={bDesde} max={bHasta} onChange={(e) => setBDesde(e.target.value)} style={inp} />
            <span style={{ color: GRY, fontSize: 12 }}>a</span>
            <input type="month" value={bHasta} min={bDesde} max={mesKey(hoy)} onChange={(e) => setBHasta(e.target.value)} style={inp} />
            <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: 2, overflow: 'hidden', marginLeft: 4 }}>
                {OPS.map(([k, lbl]) => (
                    <button key={k} onClick={() => setBOper(k)} style={{
                        padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
                        fontWeight: bOper === k ? 700 : 400,
                        background: bOper === k ? BLK : '#fff', color: bOper === k ? '#fff' : '#555',
                    }}>{lbl}</button>
                ))}
            </span>
            <button onClick={aplicar} disabled={!sucio || !!cargando} style={{
                padding: '6px 13px', borderRadius: 2, border: `1px solid ${sucio ? BLK : LGT}`,
                background: sucio && !cargando ? BLK : '#fff', color: sucio && !cargando ? '#fff' : GRY,
                fontSize: 11.5, fontWeight: 700, cursor: sucio && !cargando ? 'pointer' : 'default', fontFamily: 'inherit',
            }}>{cargando === 'costo' ? 'Consultando…' : 'Aplicar'}</button>
            {sucio && !cargando && <span style={{ fontSize: 11, color: '#8A6D00' }}>sin aplicar</span>}
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
            d={d.costo} pulso={d.pulso ?? null} hist={d.historico ?? null} calidad={d.calidad ?? null}
            section={section} setSection={setSection}
            cacheAt={(vistaActual && at[vistaActual]) ?? null}
            cargando={cargando !== null}
            onRefresh={() => { if (vistaActual) cargar(vistaActual, vistaActual === 'costo' ? qCosto : '', true); }}
            controles={controles}
            onPresentar={() => setModo('presentacion')}
        />
    );
}
