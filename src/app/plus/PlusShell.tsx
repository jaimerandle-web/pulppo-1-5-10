'use client';
// Cliente: mantiene mes + métrica y refetchea contra /api/plus. Server-side sería un
// reload completo por cada cambio de toggle; el cálculo es pesado (recorre operations).
import { useEffect, useState } from 'react';
import type { PlusData, Metric } from '@/lib/plus';
import PlusApp from './PlusApp';

const HOY = new Date();

export default function PlusShell() {
    const [month, setMonth] = useState(HOY.getMonth() + 1);
    const [metric, setMetric] = useState<Metric>('cobrada');
    const [d, setD] = useState<PlusData | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        setD(null); setErr(null);
        fetch(`/api/plus?month=${month}&metric=${metric}`)
            .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
            .then((j) => { if (vivo) setD(j); })
            .catch((e) => { if (vivo) setErr(String(e)); });
        return () => { vivo = false; };
    }, [month, metric]);

    const onChange = (m: number, mt: Metric) => { setMonth(m); setMetric(mt); };

    if (err) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#A52003' }}>No pude cargar los datos: {err}</div>;
    if (!d) return <div style={{ padding: 30, fontFamily: 'Nunito Sans, sans-serif', color: '#B7B7B7' }}>Calculando desde Mongo…</div>;
    return <PlusApp d={d} onChange={onChange} />;
}
