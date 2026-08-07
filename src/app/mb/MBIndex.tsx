'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { MBIndexRow } from '@/lib/mb';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999';
const R = 2;
const f = (n: number) => n.toLocaleString('es-MX');

// Abre la herramienta de la inmobiliaria en otra pestaña, sin perder el índice.
function IrLink({ companyId }: { companyId: string }) {
    return (
        <a href={`/mb/${companyId}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 11.5, fontWeight: 700, color: BLK, background: YEL, border: `1px solid ${YEL}`, borderRadius: R, padding: '5px 13px', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Ir ↗
        </a>
    );
}

// Columnas ordenables: para responder "¿qué inmobiliaria tiene más leads / más props / peor calidad?"
type SortKey = 'name' | 'kam' | 'nProps' | 'nVenta' | 'calAltaPct' | 'leads30' | 'leadsProp';
const NUM_KEYS: SortKey[] = ['nProps', 'nVenta', 'calAltaPct', 'leads30', 'leadsProp'];
const valOf = (r: MBIndexRow, k: SortKey): number | string =>
    k === 'leadsProp' ? (r.nProps ? r.leads30 / r.nProps : 0) : (r[k as keyof MBIndexRow] as number | string);

export default function MBIndex({ rows }: { rows: MBIndexRow[] }) {
    const [kam, setKam] = useState('');
    const [q, setQ] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('nProps');
    const [dir, setDir] = useState<1 | -1>(-1);
    const [minProps, setMinProps] = useState('');
    const kams = useMemo(() => [...new Set(rows.map((r) => r.kam))].sort(), [rows]);
    const filtered = useMemo(() => {
        const ql = q.trim().toLowerCase();
        const mp = parseInt(minProps) || 0;
        const out = rows.filter((r) => (!kam || r.kam === kam) && (!ql || r.name.toLowerCase().includes(ql)) && r.nProps >= mp);
        return out.sort((a, b) => {
            const va = valOf(a, sortKey), vb = valOf(b, sortKey);
            if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
            return dir * String(va).localeCompare(String(vb), 'es');
        });
    }, [rows, kam, q, minProps, sortKey, dir]);
    const totProps = filtered.reduce((a, r) => a + r.nProps, 0);
    const totLeads = filtered.reduce((a, r) => a + r.leads30, 0);
    const onSort = (k: SortKey) => {
        if (k === sortKey) setDir((x) => (x === 1 ? -1 : 1));
        else { setSortKey(k); setDir(NUM_KEYS.includes(k) ? -1 : 1); }
    };
    const arrow = (k: SortKey) => (sortKey === k ? (dir === 1 ? ' ▲' : ' ▼') : '');

    const th: CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
    const td: CSSProperties = { padding: '8px', borderBottom: `1px solid ${LGT}`, whiteSpace: 'nowrap' };
    const sel: CSSProperties = { fontSize: 12, padding: '6px 8px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff' };
    const chip = (active: boolean): CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: R, cursor: 'pointer', border: `1px solid ${active ? BLK : LGT}`, background: active ? BLK : '#fff', color: active ? '#fff' : '#555' });

    return (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 60px', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Master Brokers · Índice</div>
            <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
            <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 32, margin: 0 }}>Tus inmobiliarias</h1>
            <div style={{ fontSize: 12, color: GRY, marginTop: 2 }}>Filtra por KAM y abre la herramienta de cada inmobiliaria. Abre la de cada una en otra pestaña.</div>

            <div style={{ display: 'flex', gap: 12, margin: '20px 0 16px' }}>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(filtered.length)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>inmobiliarias</div></div>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(totProps)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>propiedades publicadas</div></div>
                <div style={{ flex: 1, background: LGT, padding: '13px 16px', borderRadius: R }}><div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26, lineHeight: 1 }}>{f(totLeads)}</div><div style={{ fontSize: 11, marginTop: 5, fontWeight: 600 }}>leads · 30 días</div></div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <span onClick={() => setKam('')} style={chip(kam === '')}>Todos</span>
                {kams.map((k) => <span key={k} onClick={() => setKam(k)} style={chip(kam === k)}>{k}</span>)}
                <input placeholder="Buscar inmobiliaria…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...sel, marginLeft: 'auto', width: 200 }} />
                <input placeholder="Mín. props" value={minProps} onChange={(e) => setMinProps(e.target.value.replace(/\D/g, ''))} style={{ ...sel, width: 90, textAlign: 'right' }} title="Oculta las inmobiliarias con menos propiedades que esto" />
            </div>
            <div style={{ fontSize: 11, color: GRY, marginBottom: 6 }}>Haz clic en cualquier encabezado para ordenar (quién tiene más leads, más inventario o peor calidad de ficha).</div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LGT}`, borderRadius: R }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, background: '#fff' }}>
                    <thead><tr>
                        <th style={th} onClick={() => onSort('name')}>Inmobiliaria{arrow('name')}</th>
                        <th style={th} onClick={() => onSort('kam')}>KAM{arrow('kam')}</th>
                        <th style={{ ...th, textAlign: 'right' }} onClick={() => onSort('nProps')}>Props{arrow('nProps')}</th>
                        <th style={{ ...th, textAlign: 'right' }} onClick={() => onSort('nVenta')}>Venta / Renta{arrow('nVenta')}</th>
                        <th style={{ ...th, textAlign: 'right' }} onClick={() => onSort('calAltaPct')}>% Alta calidad{arrow('calAltaPct')}</th>
                        <th style={{ ...th, textAlign: 'right' }} onClick={() => onSort('leads30')}>Leads 30d{arrow('leads30')}</th>
                        <th style={{ ...th, textAlign: 'right' }} onClick={() => onSort('leadsProp')}>Leads / prop{arrow('leadsProp')}</th>
                        <th style={{ ...th, textAlign: 'right', cursor: 'default' }}>Abrir</th>
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
                                <td style={{ ...td, textAlign: 'right', color: GRY }}>{r.nProps ? (r.leads30 / r.nProps).toFixed(1) : '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}><IrLink companyId={r.companyId} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontSize: 9, color: GRY, marginTop: 12 }}>Pulppo · datos en vivo. Borrador. Acceso hoy: allowlist interno; el acceso por master broker de cada inmobiliaria llega en la siguiente fase.</div>
        </div>
    );
}
