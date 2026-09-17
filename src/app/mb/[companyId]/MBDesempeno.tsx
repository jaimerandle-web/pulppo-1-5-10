'use client';

/**
 * Desempeño comercial por asesor. Port del dashboard `andina-leads-dashboard`, que vivía
 * como Artifact público con un snapshot refrescado a mano.
 *
 * Tres lecturas, en el orden en que se usan:
 *   1. los KPI del año (empresa completa)
 *   2. leads por asesor y mes — dónde está el volumen
 *   3. conversión por asesor — qué pasa con ese volumen
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Desempeno, Tipo } from '@/lib/desempeno';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999';
const R = 2;
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const f0 = (n: number) => n.toLocaleString('es-MX');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, color: GRY, borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
const thN: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}` };
const tdN: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function MBDesempeno({ companyId }: { companyId: string }) {
    const [d, setD] = useState<Desempeno | null>(null);
    const [err, setErr] = useState('');
    const [tipo, setTipo] = useState<Tipo | 'todos'>('todos');
    const anio = new Date().getFullYear();

    useEffect(() => {
        let vivo = true;
        setD(null); setErr('');
        fetch(`/api/mb-desempeno?company=${companyId}&anio=${anio}`)
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; ok ? setD(j) : setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [companyId, anio]);

    // El filtro de tipo se aplica ACÁ y no en el servidor: son 178 celdas, cambiar de
    // venta/renta no vale un viaje de segundos.
    const celdas = useMemo(
        () => (d?.celdas ?? []).filter((c) => tipo === 'todos' || c.tipo === tipo),
        [d, tipo]);

    // hasta el mes con datos: pintar diciembre en septiembre son tres columnas de ceros
    const ultimoMes = useMemo(
        () => celdas.reduce((m, c) => (c.leads + c.visitas + c.cierres > 0 ? Math.max(m, c.mes) : m), 1),
        [celdas]);
    const meses = useMemo(() => Array.from({ length: ultimoMes }, (_, i) => i + 1), [ultimoMes]);

    const porAsesor = useMemo(() => {
        const m = new Map<string, { asesor: string; mes: number[]; leads: number;
                                    resp: number; vis: number; cierres: number }>();
        for (const c of celdas) {
            let a = m.get(c.asesor);
            if (!a) { a = { asesor: c.asesor, mes: Array(12).fill(0), leads: 0, resp: 0, vis: 0, cierres: 0 };
                      m.set(c.asesor, a); }
            a.mes[c.mes - 1] += c.leads;
            a.leads += c.leads; a.resp += c.respondidos; a.vis += c.visitas; a.cierres += c.cierres;
        }
        return [...m.values()].sort((x, y) => y.leads - x.leads);
    }, [celdas]);

    const ofertasPorAsesor = useMemo(() => {
        const m = new Map<string, number>();
        for (const o of d?.ofertasActivas ?? []) {
            if (tipo !== 'todos' && o.tipo !== tipo) continue;
            m.set(o.asesor, (m.get(o.asesor) ?? 0) + o.n);
        }
        return m;
    }, [d, tipo]);

    const suma = (k: 'leads' | 'resp' | 'vis' | 'cierres') =>
        porAsesor.reduce((s, a) => s + a[k], 0);

    // Los KPI de empresa cuentan CUALQUIER operación, aunque su asesor ya no esté activo; las
    // tablas por asesor sólo atribuyen a la cartera de hoy. Por eso pueden no cuadrar y la
    // diferencia se dice en pantalla en vez de dejar que parezca un error.
    const totOfertas = useMemo(() => {
        const t = d?.totales.ofertasActivas ?? {};
        return tipo === 'todos' ? Object.values(t).reduce((s, n) => s + n, 0) : (t[tipo] ?? 0);
    }, [d, tipo]);
    const totCierres = useMemo(() => {
        const t = d?.totales.cierres ?? {};
        return tipo === 'todos' ? Object.values(t).reduce((s, n) => s + n, 0) : (t[tipo] ?? 0);
    }, [d, tipo]);

    if (err) return <p style={{ fontSize: 13, color: '#A52003' }}>{err}</p>;
    if (!d) return <p style={{ fontSize: 13, color: GRY }}>Calculando el año en vivo…</p>;

    const maxMes = Math.max(1, ...porAsesor.flatMap((a) => a.mes.slice(0, ultimoMes)));

    return (
        <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {(['todos', 'venta', 'renta'] as const).map((t) => (
                    <button key={t} onClick={() => setTipo(t)}
                        style={{ border: `1px solid ${tipo === t ? BLK : '#E5E5E5'}`, borderRadius: R,
                                 background: tipo === t ? BLK : '#fff', color: tipo === t ? '#fff' : BLK,
                                 padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                                 textTransform: 'capitalize' }}>{t}</button>
                ))}
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
                          marginBottom: 20 }}>
                {[['Leads', f0(suma('leads'))],
                  ['Respuesta', pct(suma('resp'), suma('leads'))],
                  ['Visita', pct(suma('vis'), suma('leads'))],
                  ['Ofertas activas', f0(totOfertas)],
                  ['Cierres ' + d.anio, f0(totCierres)]].map(([k, v]) => (
                    <div key={k} style={{ border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY }}>{k}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    </div>
                ))}
            </div>

            <p style={{ fontSize: 11, color: GRY, marginBottom: 14, lineHeight: 1.5 }}>
                <b>Ofertas activas</b> es una foto de hoy: lo que está en oferta o contrato ahora mismo.
                <b> Cierres</b> son operaciones creadas en {d.anio} que ya cerraron, contadas en el mes en
                que se crearon. Los dos son el total de la casa; las tablas de abajo sólo atribuyen a los{' '}
                {d.asesores.length} asesores activos, así que pueden sumar un poco menos.
            </p>

            <p style={{ fontSize: 11, fontWeight: 700, color: BLK, margin: '0 0 6px' }}>Leads por asesor y mes</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse' }}>
                    <thead>
                        <tr><th style={th}>Asesor</th>
                            {meses.map((m) => <th key={m} style={thN}>{MESES[m - 1]}</th>)}
                            <th style={thN}>Total</th></tr>
                    </thead>
                    <tbody>
                        {porAsesor.map((a) => (
                            <tr key={a.asesor}>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.asesor}</td>
                                {meses.map((m) => {
                                    const v = a.mes[m - 1];
                                    // el fondo hace visible dónde está el volumen sin meter una gráfica
                                    return <td key={m} style={{ ...tdN, background: v
                                        ? `rgba(246,190,0,${(v / maxMes) * .55})` : undefined }}>{v || ''}</td>;
                                })}
                                <td style={{ ...tdN, fontWeight: 700 }}>{f0(a.leads)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: 11, fontWeight: 700, color: BLK, margin: '20px 0 6px' }}>Conversión por asesor</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
                    <thead>
                        <tr><th style={th}>Asesor</th><th style={thN}>Leads</th>
                            <th style={thN}>Respuesta</th><th style={thN}>Visita</th>
                            <th style={thN}>Ofertas activas</th><th style={thN}>Cierres</th></tr>
                    </thead>
                    <tbody>
                        {porAsesor.map((a) => (
                            <tr key={a.asesor}>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.asesor}</td>
                                <td style={tdN}>{f0(a.leads)}</td>
                                <td style={tdN}>{pct(a.resp, a.leads)}</td>
                                <td style={tdN}>{pct(a.vis, a.leads)}</td>
                                <td style={tdN}>{ofertasPorAsesor.get(a.asesor) || ''}</td>
                                <td style={{ ...tdN, color: a.cierres ? SEA : undefined,
                                             fontWeight: a.cierres ? 700 : undefined }}>{a.cierres || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: 10, color: GRY, marginTop: 12 }}>
                En vivo desde Mongo · {new Date(d.calculadoEn).toLocaleString('es-MX')}
            </p>
        </div>
    );
}
