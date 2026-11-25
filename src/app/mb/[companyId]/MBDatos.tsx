'use client';

/**
 * Datos: la base completa de la inmobiliaria para descargar (JSON y Excel) y la URL con clave
 * para que la lea un agente de IA. Todo sale de `/api/mb-datos` (ver lib/datosExport.ts).
 * Piloto: sólo Diamond House (lib/datosPiloto.ts).
 */
import { useEffect, useState, type CSSProperties } from 'react';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', MUTED = '#6f6f6d', RED = '#A52003';
const R = 2;
const f0 = (n: number) => n.toLocaleString('es-MX');

type Resumen = {
    generado: string;
    conteos: { propiedades: number; publicadas: number; leads: number; asesores: number };
    urls_agente: Record<'propiedades' | 'leads' | 'asesores', string>;
};

const JUEGOS: { tipo: 'propiedades' | 'leads' | 'asesores'; titulo: string; que: string; filtros: string }[] = [
    {
        tipo: 'propiedades', titulo: 'Propiedades',
        que: 'Todo el inventario, en cualquier estado, con fotos, planos, videos, recorrido virtual, ligas a portales, productor y vendedor. Sin ningún dato del propietario.',
        filtros: '&estado=published para sólo las publicadas',
    },
    {
        tipo: 'leads', titulo: 'Leads',
        que: 'Cada lead con la propiedad por la que llegó, el asesor que lo atiende, el productor de la propiedad, en qué va y el motivo de descarte. Incluye nombre, teléfono y correo del cliente.',
        filtros: '&desde=2026-11-01 y/o &estatus=en búsqueda',
    },
    {
        tipo: 'asesores', titulo: 'Asesores externos',
        que: 'Brokers de fuera de la inmobiliaria: los que nos mandaron clientes y los que estuvieron del otro lado de una operación. Con su nivel: cerró, ofertó, recurrente u ocasional.',
        filtros: '',
    },
];

export default function MBDatos({ companyId }: { companyId: string }) {
    const [r, setR] = useState<Resumen | null>(null);
    const [err, setErr] = useState('');
    const [copiado, setCopiado] = useState('');

    useEffect(() => {
        fetch(`/api/mb-datos?company=${companyId}`)
            .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
            .then(setR)
            .catch(() => setErr('No se pudo leer la base. Intenta de nuevo en un momento.'));
    }, [companyId]);

    const btn = (primario: boolean): CSSProperties => ({
        display: 'inline-block', padding: '8px 14px', borderRadius: R, fontSize: 13, fontWeight: 700, textDecoration: 'none',
        background: primario ? BLK : '#fff', color: primario ? '#fff' : BLK, border: `1px solid ${BLK}`, marginRight: 8, marginTop: 8,
    });
    const copiar = (k: string, txt: string) => {
        navigator.clipboard?.writeText(txt).then(() => { setCopiado(k); setTimeout(() => setCopiado(''), 1800); });
    };

    if (err) return <div style={{ color: RED, fontSize: 13 }}>{err}</div>;
    if (!r) return <div style={{ color: MUTED, fontSize: 13 }}>Leyendo la base en vivo… (la primera vez tarda unos 20 segundos)</div>;

    const n = { propiedades: r.conteos.propiedades, leads: r.conteos.leads, asesores: r.conteos.asesores };
    const hora = new Date(r.generado).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
    const base = `/api/mb-datos?company=${companyId}`;

    return (
        <div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                Leída de la base el {hora}. Se actualiza sola cada 10 minutos.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                {JUEGOS.map((j) => (
                    <div key={j.tipo} style={{ border: `1px solid ${LGT}`, borderTop: `3px solid ${YEL}`, borderRadius: R, padding: 16, background: '#fff' }}>
                        <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 22 }}>{j.titulo}</div>
                        <div style={{ fontSize: 30, fontWeight: 800, margin: '4px 0' }}>{f0(n[j.tipo])}</div>
                        {j.tipo === 'propiedades' && <div style={{ fontSize: 12, color: MUTED }}>{f0(r.conteos.publicadas)} publicadas hoy</div>}
                        <div style={{ fontSize: 13, color: '#444', margin: '10px 0 4px', lineHeight: 1.45 }}>{j.que}</div>
                        <a href={`${base}&tipo=${j.tipo}&formato=xlsx`} style={btn(true)}>Descargar Excel</a>
                        <a href={`${base}&tipo=${j.tipo}&descargar=1`} style={btn(false)}>Descargar JSON</a>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 26, padding: 16, background: LGT, borderRadius: R }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>URL para un agente de IA</div>
                <div style={{ fontSize: 13, color: '#444', margin: '6px 0 12px', maxWidth: 720, lineHeight: 1.45 }}>
                    Cada liga responde el JSON en vivo, sin iniciar sesión. Trae una clave: <b>trátala como una contraseña</b>, porque
                    leads y asesores incluyen teléfonos y correos. Si se comparte de más, pide que la cambiemos.
                </div>
                {JUEGOS.map((j) => (
                    <div key={j.tipo} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <div style={{ width: 130, fontSize: 13, fontWeight: 700 }}>{j.titulo}</div>
                        <code style={{ flex: '1 1 320px', minWidth: 0, fontSize: 11.5, background: '#fff', border: `1px solid ${GRY}`, borderRadius: R, padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.urls_agente[j.tipo]}
                        </code>
                        <button onClick={() => copiar(j.tipo, r.urls_agente[j.tipo])} style={{ ...btn(false), marginTop: 0, cursor: 'pointer' }}>
                            {copiado === j.tipo ? 'Copiada' : 'Copiar'}
                        </button>
                        {j.filtros && <div style={{ width: '100%', paddingLeft: 138, fontSize: 11.5, color: MUTED }}>Filtros: {j.filtros}</div>}
                    </div>
                ))}
            </div>
        </div>
    );
}
