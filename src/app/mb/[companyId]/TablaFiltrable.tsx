'use client';

// Tabla con buscador, filtros rápidos, orden por cualquier columna y «Copiar tabla» con sólo lo filtrado.
// La comparten las pestañas Marketing y Consultas de /mb.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

const BLK = '#212322', GRY = '#B7B7B7', LGT = '#F3F3F3';
const R = 2;
const f0 = (n: number) => n.toLocaleString('es-MX');
const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px', cursor: 'pointer', userSelect: 'none' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const sub: CSSProperties = { fontSize: 10.5, color: '#777' };
export const inp: CSSProperties = { padding: '5px 8px', border: `1px solid ${LGT}`, borderRadius: R, fontSize: 12, fontFamily: 'inherit', color: BLK, background: '#fff' };
export const textoCopiar = (filas: Array<Array<string | number | null | undefined>>) => {
    try { void navigator.clipboard.writeText(filas.map((r) => r.map((x) => String(x ?? '')).join('\t')).join('\n')); } catch { /* sin portapapeles */ }
};

// ─────────────────────────── tabla reutilizable ───────────────────────────
export interface Col<T> {
    h: string;
    /** valor para ordenar y copiar */
    v: (r: T) => string | number | null;
    num?: boolean;
    render?: (r: T) => ReactNode;
}
export default function TablaFiltrable<T>({ filas, cols, texto, selects = [], min = 600, limite = 25, orden: ordenIni, vacio = 'Nada que mostrar.', inicial }: {
    filas: T[]; cols: Col<T>[];
    /** texto donde busca el buscador (código, colonia, calle, asesor, nivel…) */
    texto: (r: T) => string;
    selects?: Array<{ label: string; v: (r: T) => string }>;
    min?: number; limite?: number; orden?: { i: number; dir: 1 | -1 }; vacio?: string;
    /** filtros ya puestos al abrir (p. ej. el nivel al que se le dio clic arriba) */
    inicial?: Record<string, string>;
}) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState<Record<string, string>>(inicial ?? {});
    const [ord, setOrd] = useState<{ i: number; dir: 1 | -1 } | null>(ordenIni ?? null);
    const [ver, setVer] = useState(limite);
    const opciones = useMemo(() => selects.map((s) => [...new Set(filas.map(s.v).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))), [filas, selects]);
    const filtradas = useMemo(() => {
        const ql = q.trim().toLowerCase();
        let xs = filas.filter((r) => (!ql || texto(r).toLowerCase().includes(ql)) && selects.every((s) => !sel[s.label] || s.v(r) === sel[s.label]));
        if (ord) {
            const c = cols[ord.i];
            xs = [...xs].sort((a, b) => {
                const x = c.v(a), y = c.v(b);
                if (x == null && y == null) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * ord.dir;
            });
        }
        return xs;
    }, [filas, q, sel, ord, cols, texto, selects]);
    const clic = (i: number) => setOrd((o) => (o && o.i === i ? { i, dir: (o.dir === 1 ? -1 : 1) as 1 | -1 } : { i, dir: cols[i].num ? -1 : 1 }));
    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <input value={q} onChange={(e) => { setQ(e.target.value); setVer(limite); }} placeholder="Buscar código, colonia, calle, asesor…" style={{ ...inp, minWidth: 230 }} />
                {selects.map((s, k) => (
                    <select key={s.label} value={sel[s.label] ?? ''} onChange={(e) => { setSel((p) => ({ ...p, [s.label]: e.target.value })); setVer(limite); }} style={inp}>
                        <option value="">{s.label}: todos</option>
                        {opciones[k].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                ))}
                <span style={sub}>{f0(filtradas.length)} de {f0(filas.length)}</span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => textoCopiar([cols.map((c) => c.h), ...filtradas.map((r) => cols.map((c) => c.v(r)))])}
                    style={{ fontSize: 11, padding: '3px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>Copiar tabla</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: min, borderCollapse: 'collapse' }}>
                    <thead><tr>{cols.map((c, i) => (
                        <th key={c.h} onClick={() => clic(i)} style={{ ...th, textAlign: c.num ? 'right' : 'left', color: ord?.i === i ? BLK : '#777' }}>
                            {c.h}{ord?.i === i ? (ord.dir === 1 ? ' ↑' : ' ↓') : ''}
                        </th>
                    ))}</tr></thead>
                    <tbody>
                        {filtradas.slice(0, ver).map((r, k) => (
                            <tr key={k}>{cols.map((c) => <td key={c.h} style={{ ...td, ...(c.num ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}) }}>{c.render ? c.render(r) : (c.v(r) ?? '—')}</td>)}</tr>
                        ))}
                        {!filtradas.length && <tr><td colSpan={cols.length} style={{ ...td, color: GRY }}>{vacio}</td></tr>}
                    </tbody>
                </table>
            </div>
            {filtradas.length > ver && (
                <button type="button" onClick={() => setVer((v) => v + limite)} style={{ marginTop: 6, fontSize: 12, padding: '5px 12px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Ver más ({f0(filtradas.length - ver)})
                </button>
            )}
        </div>
    );
}

