import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchInmobiliaria, type MBProp } from '@/lib/mb';

// Herramienta Master Brokers — PRIMER BORRADOR. Overview (salud + funnel comercial) + listado de
// propiedades de la inmobiliaria; cada una linkea a su ficha de desempeño. Datos en vivo.
export const dynamic = 'force-dynamic';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', RED = '#A52003', SEA = '#529999';
const money = (n?: number | null) => (n == null || isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const f = (n: number) => n.toLocaleString('es-MX');
const estadoColor = (e: string) => (e === 'Óptimo' ? SEA : e === 'Fuera de mercado' ? RED : e === 'No competitivo' ? '#8a6d00' : GRY);

function Stat({ n, l, sub, color }: { n: string; l: string; sub?: string; color?: string }) {
    return (
        <div style={{ flex: 1, background: LGT, padding: '14px 16px', borderRadius: 10 }}>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 30, lineHeight: 1, color: color || BLK }}>{n}</div>
            <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600 }}>{l}</div>
            {sub && <div style={{ fontSize: 10, color: GRY, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function Funnel({ vistas, leads, visitas, ofertas }: { vistas: number; leads: number; visitas: number; ofertas: number }) {
    const max = Math.max(vistas, leads, visitas, ofertas, 1);
    const stages: [string, number, string][] = [
        ['Vistas', vistas, GRY], ['Leads', leads, SEA], ['Visitas', visitas, '#2f6b6b'], ['Ofertas', ofertas, BLK]
    ];
    const rate = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stages.map(([lbl, n, c], i) => (
                <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 64, fontSize: 12, fontWeight: 600 }}>{lbl}</span>
                    <span style={{ flex: 1, background: '#fff', height: 22, borderRadius: 4, overflow: 'hidden', border: `1px solid ${LGT}` }}>
                        <span style={{ display: 'block', height: '100%', width: `${Math.max((100 * n) / max, 1)}%`, background: c }} />
                    </span>
                    <span style={{ width: 70, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{f(n)}</span>
                    <span style={{ width: 74, textAlign: 'right', fontSize: 10, color: GRY }}>
                        {i === 1 ? `${rate(leads, vistas)} de vistas` : i === 2 ? `${rate(visitas, leads)} de leads` : i === 3 ? `${rate(ofertas, visitas)} de visitas` : ''}
                    </span>
                </div>
            ))}
        </div>
    );
}

function Row({ p }: { p: MBProp }) {
    const td: CSSProperties = { padding: '7px 8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    return (
        <tr>
            <td style={td}><Link href={`/ficha/${p.id}`} style={{ color: SEA, fontWeight: 700 }}>{p.code}</Link></td>
            <td style={td}>{p.asesor}</td>
            <td style={td}>{p.op}</td>
            <td style={{ ...td, color: GRY }}>{p.colonia}</td>
            <td style={{ ...td, textAlign: 'right' }}>{money(p.precio)}</td>
            <td style={{ ...td }}><span style={{ color: estadoColor(p.estado), fontWeight: 600 }}>{p.estado}</span>{p.sobreprecio != null && Math.abs(p.sobreprecio) >= 1 ? <span style={{ color: GRY, fontSize: 10 }}> {p.sobreprecio > 0 ? '+' : ''}{p.sobreprecio.toFixed(0)}%</span> : null}</td>
            <td style={{ ...td, textAlign: 'right', color: GRY }}>{p.dias ?? '—'}</td>
            <td style={{ ...td, textAlign: 'right' }}>{f(p.vistas)}</td>
            <td style={{ ...td, textAlign: 'right' }}>{f(p.leads)}<span style={{ color: GRY, fontSize: 10 }}> · {p.leadsI24} i24</span></td>
            <td style={{ ...td, textAlign: 'right' }}>{f(p.visitas)}</td>
            <td style={{ ...td, textAlign: 'right' }}>{p.ofertas || ''}</td>
        </tr>
    );
}

export default async function MBPage({ params }: { params: Promise<{ companyId: string }> }) {
    const { companyId } = await params;
    const d = await fetchInmobiliaria(companyId);
    if (!d) notFound();

    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#888', whiteSpace: 'nowrap' };
    const pctVenta = d.nProps ? Math.round((100 * d.nVenta) / d.nProps) : 0;

    return (
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 28px 60px', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Master Brokers · Borrador</div>
            <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 34, margin: 0 }}>{d.name}</h1>
            <div style={{ fontSize: 12, color: GRY, marginTop: 2 }}>Tu inventario publicado y su desempeño comercial. Haz clic en cualquier código para abrir su reporte.</div>

            {/* Salud */}
            <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
                <Stat n={f(d.nProps)} l="Propiedades publicadas" sub={`${d.nVenta} venta · ${d.nRenta} renta`} />
                <Stat n={`${pctVenta}%`} l="En venta" sub={`${100 - pctVenta}% en renta`} />
                <Stat n={f(d.captaciones90)} l="Captaciones recientes" sub="publicadas ≤ 90 días" />
                <Stat n={f(d.sinLeads)} l="Sin leads" sub="propiedades sin un solo lead" color={d.sinLeads > d.nProps * 0.3 ? RED : BLK} />
            </div>

            {/* Funnel */}
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 20, margin: '30px 0 3px' }}>Funnel comercial</h2>
            <div style={{ fontSize: 11, color: GRY, marginBottom: 12 }}>Del total de tu inventario. Las tasas se miden contra el paso anterior.</div>
            <Funnel vistas={d.vistas} leads={d.leads} visitas={d.visitas} ofertas={d.ofertas} />

            {/* Listado */}
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 20, margin: '32px 0 3px' }}>Propiedades</h2>
            <div style={{ fontSize: 11, color: GRY, marginBottom: 10 }}>{f(d.nProps)} propiedades, ordenadas por leads. Cada código abre su reporte de desempeño.</div>
            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                    <thead>
                        <tr>
                            {['Código', 'Asesor', 'Operación', 'Colonia', 'Precio', 'Precio vs. mercado', 'Días', 'Vistas', 'Leads', 'Visitas', 'Ofertas'].map((h) => <th key={h} style={th}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>{d.props.map((p) => <Row key={p.id} p={p} />)}</tbody>
                </table>
            </div>
            <div style={{ fontSize: 9, color: GRY, marginTop: 14, borderTop: `1px solid ${LGT}`, paddingTop: 6 }}>
                Pulppo · Datos en vivo. Visitas = visitantes únicos confirmados. Leads i24 = leads originados en Inmuebles24. Precio vs. mercado = precio de lista ÷ valuación ACM. Borrador — filtros por asesor/fecha/segmento y swaps de destacado vienen en la siguiente iteración.
            </div>
        </div>
    );
}
