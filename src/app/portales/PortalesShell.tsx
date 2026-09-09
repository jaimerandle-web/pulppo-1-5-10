'use client';
// Cliente: pide /api/portales y guarda cuándo se calculó, para poder decir "actualizado hace X"
// y ofrecer recarga. El cálculo tarda ~17 s contra Mongo, así que la caché del route es la que
// hace que sólo el primero del día espere.
import { useCallback, useEffect, useState } from 'react';
import type { PortalesView } from '@/lib/portales/view';
import PortalesApp from './PortalesApp';

export default function PortalesShell() {
    const [d, setD] = useState<PortalesView | null>(null);
    const [cacheAt, setCacheAt] = useState<number | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback((refresh = false) => {
        setCargando(true); setErr(null);
        fetch(`/api/portales?months=6${refresh ? '&refresh=1' : ''}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { setD(j); setCacheAt(j.cacheAt ?? null); })
            .catch((e) => setErr(String(e)))
            .finally(() => setCargando(false));
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    if (err) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#A52003' }}>No pude cargar los datos: {err}</div>;
    if (!d) return (
        <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#B7B7B7' }}>
            Consultando Mongo y el Sheet de inversión… la primera carga tarda unos segundos.
        </div>
    );
    return <PortalesApp d={d} cacheAt={cacheAt} onRefresh={() => cargar(true)} cargando={cargando} />;
}
