'use client';
// Cliente: decide qué vista pedir y cuándo. Dos modos:
//   · análisis     — todo, para nosotros
//   · presentación — un solo portal, para enseñárselo a ese portal (ver Presentacion.tsx)
//
// Cada vista se carga aparte y sólo al entrar: abrir la página no debe pagar todas las consultas.
// La presentación usa el mismo motor que las pestañas de análisis (un InmoView por mes del rango +
// la inversión del Sheet por mes); el rango de fechas exactas pide un InmoView más.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PulseView } from '@/lib/portales/pulse';
import type { HistoricoView } from '@/lib/portales/historico';
import type { InmoView } from '@/lib/portales/inmobiliaria';
import type { InversionRango } from '@/lib/portales/inversion';
import PortalesApp, { type Section } from './PortalesApp';
import Presentacion, { PORTALES_PAGADOS, SECCIONES, type MesP, type SeccionP } from './Presentacion';

type Vista = 'pulso' | 'historico';
type Datos = { pulsoQ?: string; historicoQ?: string; pulso?: PulseView; historico?: HistoricoView };

// Sólo el pulso y el histórico usan vistas propias; las cinco secciones de arriba consultan su
// propia API compartida (InmobiliariasTab), igual que el modo presentación.
const DE_SECCION: Record<Section, Vista | null> = {
    resumen: null, inversion: null, leads: null, embudo: null, inmobiliarias: null,
    pulso: 'pulso', historico: 'historico', comoleer: null,
};

const BLK = '#212322', GRY = '#B7B7B7', LGT = '#F3F3F3';
const mesKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PortalesShell() {
    const hoy = useMemo(() => new Date(Date.now() - 6 * 3600 * 1000), []);
    const [section, setSection] = useState<Section>('resumen');
    const [modo, setModo] = useState<'analisis' | 'presentacion'>('analisis');
    const [portal, setPortal] = useState('i24');
    const [secs, setSecs] = useState<Set<SeccionP>>(new Set(['volumen', 'mezcla', 'atencion', 'contacto', 'embudo']));

    // Rango de MESES de la presentación (la inversión es mensual).
    //
    // Hay dos estados: el BORRADOR (lo que estás moviendo) y lo APLICADO (lo que se consultó). Ya no
    // hay botón «Aplicar» (Ale, 2-oct-2026: «debería verse inmediato»): el borrador se aplica solo
    // cuando se queda quieto 600 ms, así cambiar "desde" y luego "hasta" sigue siendo UNA consulta.
    const iniDesde = useMemo(() => { const d = new Date(hoy); d.setUTCMonth(d.getUTCMonth() - 5); return mesKey(d); }, [hoy]);
    const [desde, setDesde] = useState(iniDesde);
    const [hasta, setHasta] = useState(() => mesKey(hoy));
    const [oper, setOper] = useState<'todas' | 'sale' | 'rent'>('todas');
    const [bDesde, setBDesde] = useState(iniDesde);
    const [bHasta, setBHasta] = useState(() => mesKey(hoy));
    const [bOper, setBOper] = useState<'todas' | 'sale' | 'rent'>('todas');
    const sucio = bDesde !== desde || bHasta !== hasta || bOper !== oper;
    useEffect(() => {
        if (!sucio) return;
        const t = setTimeout(() => { setDesde(bDesde); setHasta(bHasta); setOper(bOper); }, 600);
        return () => clearTimeout(t);
    }, [bDesde, bHasta, bOper, sucio]);
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
                setD((p) => ({ ...p, [v]: j, ...(v === 'pulso' ? { pulsoQ: q } : {}), ...(v === 'historico' ? { historicoQ: q } : {}) }));
                setAt((p) => ({ ...p, [v]: j.cacheAt ?? Date.now() }));
            })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(null));
    }, []);

    const qOper = `&operacion=${oper}`;

    // ── modo presentación: un InmoView (vista general, sin comparar) + la inversión por mes ──
    const mesesP = useMemo<MesP[]>(() => {
        const out: MesP[] = [];
        const ML = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        let [y, m] = desde.split('-').map(Number);
        const [y1, m1] = hasta.split('-').map(Number);
        while ((y < y1 || (y === y1 && m <= m1)) && out.length < 24) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            out.push({ key, label: `${ML[m - 1]} ${y}`, parcial: key === mesKey(hoy) });
            [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
        }
        return out;
    }, [desde, hasta, hoy]);
    const [pres, setPres] = useState<{ q: string; porMes: Array<InmoView | null>; inv: Array<InversionRango | null> } | null>(null);
    const [presPeriodo, setPresPeriodo] = useState<{ q: string; v: InmoView | null } | null>(null);
    const datosMes = useCallback((a: string, b: string, op: string) =>
        fetch(`/api/portales/inmobiliarias?view=datos&desde=${a}&hasta=${b}&operacion=${op}&comparar=nada`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText)))), []);
    useEffect(() => {
        if (modo !== 'presentacion') return;
        const q = `${mesesP.map((m) => m.key).join(',')}|${oper}`;
        if (pres?.q === q) return;
        setPres({ q, porMes: mesesP.map(() => null), inv: mesesP.map(() => null) });
        mesesP.forEach((m, i) => {
            const [y, mm] = m.key.split('-').map(Number);
            const fin = m.parcial ? iso(hoy) : iso(new Date(Date.UTC(y, mm, 0)));
            datosMes(`${m.key}-01`, fin, oper)
                .then((v: InmoView) => setPres((p) => (p && p.q === q ? { ...p, porMes: p.porMes.map((x, k) => (k === i ? v : x)) } : p)))
                .catch((e) => setErr(String(e)));
            fetch(`/api/portales?view=inversion&desde=${m.key}&hasta=${m.key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
                .then((r: InversionRango | null) => setPres((p) => (p && p.q === q ? { ...p, inv: p.inv.map((x, k) => (k === i ? r : x)) } : p)));
        });
    }, [modo, mesesP, oper, pres?.q, datosMes, hoy]);
    // El periodo exacto sólo si está prendido en presentación.
    useEffect(() => {
        if (modo !== 'presentacion' || !secs.has('periodo') || !pDesde || !pHasta || pDesde > pHasta) return;
        const q = `${pDesde}|${pHasta}|${oper}`;
        if (presPeriodo?.q === q) return;
        setPresPeriodo({ q, v: null });
        datosMes(pDesde, pHasta, oper).then((v: InmoView) => setPresPeriodo((p) => (p?.q === q ? { q, v } : p))).catch((e) => setErr(String(e)));
    }, [modo, secs, pDesde, pHasta, oper, presPeriodo?.q, datosMes]);

    // Las demás, perezosas: sólo al entrar a su sección.
    useEffect(() => {
        const v = DE_SECCION[section];
        if (!v || cargando === v) return;
        // El pulso es semanal: no usa el rango de meses, sólo venta/renta.
        if (v === 'pulso') { if (d.pulsoQ !== qOper) cargar('pulso', qOper); return; }
        // El histórico tampoco usa meses (siempre 12 + YTD), pero sí venta/renta.
        if (v === 'historico') { if (d.historicoQ !== qOper) cargar('historico', qOper); return; }
    }, [section, d, cargando, cargar, qOper]);

    const inp: React.CSSProperties = { padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: 2, fontSize: 12, fontFamily: 'inherit', color: BLK };

    const OPS: Array<['todas' | 'sale' | 'rent', string]> = [['todas', 'Todo'], ['sale', 'Venta'], ['rent', 'Renta']];
    // Cada sección muestra SÓLO los filtros que de verdad la mueven: el pulso es semanal (no usa
    // meses) y el histórico tampoco; los dos sólo usan venta/renta. Antes se veían los dos en todas y parecía que no cargaban.
    const usaMeses = modo === 'presentacion';
    const usaOper = usaMeses || section === 'pulso' || section === 'historico';
    const controles = !usaOper ? (
        <span style={{ fontSize: 11.5, color: GRY }}>Esta vista no usa filtros: siempre muestra el histórico completo.</span>
    ) : (
        <>
            {usaMeses && <>
            <label style={{ fontSize: 11, color: GRY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>Meses</label>
            <input type="month" value={bDesde} max={bHasta} onChange={(e) => setBDesde(e.target.value)} style={inp} />
            <span style={{ color: GRY, fontSize: 12 }}>a</span>
            <input type="month" value={bHasta} min={bDesde} max={mesKey(hoy)} onChange={(e) => setBHasta(e.target.value)} style={inp} />
            </>}
            <span style={{ display: 'inline-flex', border: `1px solid ${LGT}`, borderRadius: 2, overflow: 'hidden', marginLeft: 4 }}>
                {OPS.map(([k, lbl]) => (
                    <button key={k} onClick={() => setBOper(k)} style={{
                        padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
                        fontWeight: bOper === k ? 700 : 400,
                        background: bOper === k ? BLK : '#fff', color: bOper === k ? '#fff' : '#555',
                    }}>{lbl}</button>
                ))}
            </span>
            {(sucio || cargando) && <span style={{ fontSize: 11.5, color: '#8A6D00', fontWeight: 700 }}>Actualizando…</span>}
        </>
    );

    if (err) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#A52003' }}>No pude cargar los datos: {err}</div>;
    if (modo === 'presentacion') {
        return (
            <Presentacion
                meses={mesesP} porMes={pres?.porMes ?? mesesP.map(() => null)} inv={pres?.inv ?? mesesP.map(() => null)}
                periodo={presPeriodo?.v ?? null} portalKey={portal} operacion={oper} secciones={secs}
                onSalir={() => setModo('analisis')}
                encabezado={
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontFamily: 'Nunito Sans, sans-serif' }}>
                        <select value={portal} onChange={(e) => setPortal(e.target.value)} style={{ ...inp, fontWeight: 700 }}>
                            {PORTALES_PAGADOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
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
                        {(pres?.porMes.some((x) => !x) || (secs.has('periodo') && presPeriodo && !presPeriodo.v)) && <span style={{ fontSize: 11, color: GRY }}>calculando…</span>}
                    </div>
                }
            />
        );
    }

    const vistaActual = DE_SECCION[section];
    return (
        <PortalesApp
            pulso={d.pulso ?? null} hist={d.historico ?? null}
            section={section} setSection={setSection}
            op={bOper} setOp={setBOper}
            cacheAt={(vistaActual && at[vistaActual]) ?? null}
            cargando={cargando !== null}
            onRefresh={() => { if (vistaActual) cargar(vistaActual, qOper, true); }}
            controles={controles}
            onPresentar={() => setModo('presentacion')}
        />
    );
}
