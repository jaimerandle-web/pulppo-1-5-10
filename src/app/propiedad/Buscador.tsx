import type { CSSProperties } from 'react';

// Barra de búsqueda del expediente. Es un <form> GET normal (sin JS): acepta código, _id, id de
// cualquier portal o la liga del aviso, y /propiedad decide a dónde ir.
export const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';

const navLink: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#555', border: `1px solid ${LGT}`, borderRadius: 2, padding: '6px 11px', textDecoration: 'none', whiteSpace: 'nowrap' };

export default function Buscador({ q = '', titulo, sub }: { q?: string; titulo: string; sub?: string }) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GRY }}>Master Brokers · Buscador de propiedades</div>
                    <div style={{ width: 52, height: 2, background: YEL, margin: '9px 0 12px' }} />
                    <h1 style={{ fontFamily: 'EB Garamond, serif', fontWeight: 400, fontSize: 32, margin: 0, lineHeight: 1.1 }}>{titulo}</h1>
                    {sub && <div style={{ fontSize: 12, color: GRY, marginTop: 4 }}>{sub}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href="/" style={navLink}>← Herramientas</a>
                    <a href="/mb" style={navLink}>Índice de inmobiliarias</a>
                </div>
            </div>
            <form action="/propiedad" method="get" style={{ display: 'flex', gap: 8, margin: '20px 0 8px', flexWrap: 'wrap' }}>
                <input name="q" defaultValue={q} autoFocus={!q} required
                    placeholder="Código (DMA-014), ID de i24 / MeLi / propiedades.com / EasyBroker, o pega la liga del aviso"
                    style={{ flex: '1 1 360px', fontSize: 14, padding: '11px 14px', border: `1px solid ${BLK}`, borderRadius: 2, fontFamily: 'inherit', minWidth: 0 }} />
                <button type="submit" style={{ fontSize: 13, fontWeight: 700, padding: '11px 22px', background: BLK, color: '#fff', border: 0, borderRadius: 2, cursor: 'pointer' }}>Buscar</button>
            </form>
        </div>
    );
}
