'use client';
// Cliente: carga cada vista por separado y sólo cuando se pide. Abrir la página no debe pagar
// las tres consultas (32 s en caliente); paga la de costo y las otras llegan al entrar a ellas.
// Guarda cuándo se calculó cada una para poder decir "actualizado hace X" y ofrecer recarga.
import { useCallback, useEffect, useState } from 'react';
import type { PortalesView } from '@/lib/portales/view';
import type { PulseView } from '@/lib/portales/pulse';
import type { HistoricoView } from '@/lib/portales/historico';
import PortalesApp, { type Section } from './PortalesApp';

type Vista = 'costo' | 'pulso' | 'historico';
type Datos = { costo?: PortalesView; pulso?: PulseView; historico?: HistoricoView };

/** Qué vista alimenta cada sección del menú. «Cómo leer» no consulta nada. */
const DE_SECCION: Record<Section, Vista | null> = {
    costo: 'costo', funnel: 'costo', deal: 'costo',
    pulso: 'pulso', historico: 'historico', comoleer: null,
};

export default function PortalesShell() {
    const [section, setSection] = useState<Section>('costo');
    const [d, setD] = useState<Datos>({});
    const [at, setAt] = useState<Partial<Record<Vista, number>>>({});
    const [err, setErr] = useState<string | null>(null);
    const [cargando, setCargando] = useState<Vista | null>(null);

    const cargar = useCallback((v: Vista, refresh = false) => {
        setCargando(v); setErr(null);
        fetch(`/api/portales?view=${v}&months=6${refresh ? '&refresh=1' : ''}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => {
                setD((p) => ({ ...p, [v]: j }));
                setAt((p) => ({ ...p, [v]: j.cacheAt ?? Date.now() }));
            })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(null));
    }, []);

    // Carga perezosa: al entrar a una sección, si su vista no está, se pide.
    useEffect(() => {
        const v = DE_SECCION[section];
        if (v && !d[v] && cargando !== v) cargar(v);
    }, [section, d, cargando, cargar]);

    if (err) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#A52003' }}>No pude cargar los datos: {err}</div>;
    if (!d.costo) return (
        <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#B7B7B7' }}>
            Consultando Mongo y el Sheet de inversión… la primera carga tarda unos segundos.
        </div>
    );

    const vistaActual = DE_SECCION[section];
    return (
        <PortalesApp
            d={d.costo} pulso={d.pulso ?? null} hist={d.historico ?? null}
            section={section} setSection={setSection}
            cacheAt={(vistaActual && at[vistaActual]) ?? null}
            cargando={cargando !== null}
            onRefresh={() => { if (vistaActual) cargar(vistaActual, true); }}
        />
    );
}
