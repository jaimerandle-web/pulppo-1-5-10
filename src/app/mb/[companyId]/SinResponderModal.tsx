'use client';

// Las consultas detrás de «Sin responder · últimos 30 días» del Overview: quién escribió, por qué propiedad, por qué
// canal y qué asesor la tiene (Ale, oct-2026). Datos de /api/mb-sin-responder (misma regla que el número).
import { useEffect, useState } from 'react';
import TablaFiltrable from './TablaFiltrable';

const BLK = '#212322', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999', YEL = '#F6BE00';
const R = 2;
type L = Record<string, string | null>;

export default function SinResponderModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
    const [filas, setFilas] = useState<L[] | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        fetch(`/api/mb-sin-responder?company=${companyId}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) setFilas(j.leads); else setErr(j.error || 'No se pudo cargar'); })
            .catch(() => vivo && setErr('No se pudo cargar'));
        return () => { vivo = false; };
    }, [companyId]);
    useEffect(() => {
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [onClose]);
    // por asesor: quién concentra las consultas sin responder
    const porAsesor = filas ? Object.entries(filas.reduce<Record<string, number>>((m, l) => { const k = l.asesor ?? 'Sin asesor'; m[k] = (m[k] ?? 0) + 1; return m; }, {}))
        .sort((a, b) => b[1] - a[1]) : [];
    const fecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(33,35,34,.45)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R, width: 'min(1200px, 100%)', maxHeight: '86vh', overflow: 'auto', padding: '20px 22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 23 }}>Consultas sin responder · últimos 30 días</div>
                        <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>Leads que entraron de 8 am a 8 pm y que el asesor no ha contestado desde Pulppo. Llámalos o escríbeles hoy.</div>
                    </div>
                    <button type="button" onClick={onClose} style={{ border: `1px solid ${LGT}`, background: '#fff', borderRadius: R, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Cerrar ✕</button>
                </div>
                {err ? <p style={{ color: RED, fontSize: 13 }}>{err}</p> : !filas ? <p style={{ fontSize: 12, color: '#777' }}>Cargando…</p> : (<>
                    {porAsesor.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0 4px' }}>
                        {porAsesor.map(([a, n]) => (
                            <div key={a} style={{ border: `1px solid ${LGT}`, borderLeft: `3px solid ${n >= 3 ? RED : YEL}`, borderRadius: R, padding: '6px 11px', fontSize: 12.5 }}>
                                <b>{a}</b> <span style={{ color: n >= 3 ? RED : BLK, fontWeight: 700, marginLeft: 4 }}>{n}</span>
                            </div>
                        ))}
                    </div>}
                    <div style={{ marginTop: 10 }}>
                        <TablaFiltrable<L> filas={filas} min={1050} limite={50} orden={{ i: 0, dir: -1 }}
                            texto={(l) => [l.nombre, l.telefono, l.correo, l.asesor, l.codigo, l.direccion, l.fuente].filter(Boolean).join(' ')}
                            selects={[{ label: 'Asesor', v: (l) => l.asesor ?? '' }, { label: 'Fuente', v: (l) => l.fuente ?? '' }, { label: 'Operación', v: (l) => l.operacion ?? '' }]}
                            vacio="No hay consultas sin responder. 🎉"
                            cols={[
                                { h: 'Entró', v: (l) => l.fecha, render: (l) => fecha(l.fecha) },
                                { h: 'Cliente', v: (l) => l.nombre, render: (l) => <b>{l.nombre ?? '—'}</b> },
                                { h: 'Teléfono', v: (l) => l.telefono },
                                { h: 'Correo', v: (l) => l.correo, render: (l) => <span style={{ fontSize: 11.5 }}>{l.correo ?? '—'}</span> },
                                { h: 'Fuente', v: (l) => l.fuente, render: (l) => <>{l.fuente}<div style={{ fontSize: 10.5, color: '#777' }}>{l.medio}</div></> },
                                { h: 'Asesor', v: (l) => l.asesor, render: (l) => <span style={{ color: RED, fontWeight: 700 }}>{l.asesor}</span> },
                                { h: 'Propiedad', v: (l) => l.codigo, render: (l) => <><b style={{ color: SEA }}>{l.codigo ?? '—'}</b> <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: R, background: l.operacion === 'Renta' ? YEL : SEA, color: l.operacion === 'Renta' ? BLK : '#fff' }}>{l.operacion?.toUpperCase()}</span><div style={{ fontSize: 11, color: '#777' }}>{l.direccion}</div></> },
                                { h: 'Mensaje', v: (l) => l.mensaje, render: (l) => <span style={{ fontSize: 11, color: '#666' }}>{l.mensaje ?? '—'}</span> },
                            ]} />
                    </div>
                </>)}
            </div>
        </div>
    );
}
