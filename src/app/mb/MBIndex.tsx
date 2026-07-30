'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBIndexRow } from '@/lib/mb';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999';
const R = 2;
const f = (n: number) => n.toLocaleString('es-MX');

function CopyLink({ companyId }: { companyId: string }) {
    const [ok, setOk] = useState(false);
    const copy = () => {
        const url = `${window.location.origin}/mb/${companyId}`;
        navigator.clipboard?.writeText(url).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
    };
    return <button onClick={copy} style={{ fontSize: 11, fontWeight: 600, color: ok ? SEA : '#555', background: '#fff', border: `1px solid ${LGT}`, borderRadius: R, padding: '4px 9px', cursor: 'pointer' }}>{ok ? '¡Copiada!' : 'Copiar liga'}</button>;
}

export default function MBIndex({ rows }: { rows: MBIndexRow[] }) {
    const [kam, setKam] = useState('');
    const [q, setQ] = useState('');
    const kams = useMemo(() => [...new Set(rows.map((r) => r.kam))].sort(), [rows]);
    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        return rows.filter((r) => (!kam || r.kam === kam) && (!ql || r.name.toLowerCase().includes(ql)));
    }, [rows, kam, q]);
    const totProps = filtered.reduce((a, r) => a + r.nProps, 0);
    const totLeads = filtered.reduce((a, r) => a + r.leads30, 0);

    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' };
    const td: CSSProperties = { padding: '8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const sel: CSSProperties = { fontSize: 12, padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff' };
    const chip = (active: boolean): CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: R, cursor: 'pointer', border: `1px solid ${active ? BLK : LGT}`, background: active ? BLK : '#fff', color: active ? '#fff' : '#555' });

    return (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 60px', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Master Brokers · Índice</div>
            <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 32, margin: 0 }}>Tus inmobiliarias</h1>
            <div style={{ fontSize: 12, color: GRY, marginTop: 2 }}>Filtra por KAM y abre la herramienta de cada inmobiliaria. La liga es compartible con su master broker.</div>

            <div style={{ display: 'flex', gap: 12, margin: '20px 0 16px' }}>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(filtered.length)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>inmobiliarias</div></div>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(totProps)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>propiedades publicadas</div></div>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(totLeads)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>leads · 30 días</div></div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <span onClick={() => setKam('')} style={chip(kam === '')}>Todos</span>
                {kams.map((k) => <span key={k} onClick={() => setKam(k)} style={chip(kam === k)}>{k}</span>)}
                <input placeholder="Buscar inmobiliaria…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, marginLeft: 'auto', width: 220 }} />
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                    <thead><tr>
                        <th style={th}>Inmobiliaria</th><th style={th}>KAM</th>
                        <th style={{ ...th, textAlign: 'right' }}>Props</th><th style={{ ...th, textAlign: 'right' }}>Venta / Renta</th>
                        <th style={{ ...th, textAlign: 'right' }}>% Alta calidad</th><th style={{ ...th, textAlign: 'right' }}>Leads 30d</th><th style={{ ...th, textAlign: 'right' }}>Liga</th>
                    </tr></thead>
                    <tbody>
                        {filtered.map((r) => (
                            <tr key={r.companyId}>
                                <td style={td}><Link href={`/mb/${r.companyId}`} style={{ color: SEA, fontWeight: 700 }}>{r.name}</Link></td>
                                <td style={td}>{r.kam}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(r.nProps)}</td>
                                <td style={{ ...td, textAlign: 'right', color: GRY }}>{f(r.nVenta)} / {f(r.nRenta)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{r.calAltaPct}%</td>
                                <td style={{ ...td, textAlign: 'right' }}>{f(r.leads30)}</td>
                                <td style={{ ...td, textAlign: 'right' }}><CopyLink companyId={r.companyId} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 9, color: GRY, marginTop: 12 }}>Pulppo · datos en vivo. Borrador. Acceso hoy: allowlist interno; el acceso por master broker de cada inmobiliaria llega en la siguiente fase.</div>
        </div>
    );
}
