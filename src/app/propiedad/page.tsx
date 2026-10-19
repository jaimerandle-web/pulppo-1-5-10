import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/companyAccess';
import { buscarPropiedad } from '@/lib/propiedad';
import Buscador, { BLK, GRY, LGT, SEA } from './Buscador';

// Buscador de propiedades (Master Brokers). SOLO interno: muestra la regalía, el costo de exposición y
// los datos del comprador. Los master brokers ni siquiera llegan aquí (el middleware los encierra en su
// panel); el chequeo de abajo es defensa en profundidad.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const money = (v: number | null) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);

export default async function BuscarPropiedadPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const u = await currentUser();
    if (!u?.internal) notFound();
    const q = ((await searchParams).q ?? '').trim();
    const r = q ? await buscarPropiedad(q) : null;
    // una sola coincidencia: directo al expediente
    if (r && r.coincidencias.length === 1) redirect(`/propiedad/${r.coincidencias[0].id}`);

    const th = { textAlign: 'left' as const, padding: 8, borderBottom: `1px solid ${BLK}`, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '.5px', color: '#666', whiteSpace: 'nowrap' as const };
    const td = { padding: 8, borderBottom: `1px solid ${LGT}`, fontSize: 12.5, verticalAlign: 'top' as const };
    return (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 60px', fontFamily: "'Nunito Sans', sans-serif", color: BLK }}>
            <Buscador q={q} titulo="Busca una propiedad" sub="Cualquier código o liga: te llevo al expediente con portales, estatus, funnel, operaciones, duplicados y línea de tiempo." />

            {!r && (
                <div style={{ marginTop: 18, fontSize: 12, color: '#666', lineHeight: 1.7 }}>
                    <b style={{ color: BLK }}>Acepta:</b> código de Pulppo (<code>DMA-014</code> o <code>dma014</code>) · ID largo de Pulppo · ID de Inmuebles24 (también avisos anteriores) ·
                    Mercado Libre (<code>MLM…</code>) · Propiedades.com · EasyBroker (<code>EB-…</code>) · Casas y Terrenos · la liga de cualquiera de esos portales o de pulppo.com.
                </div>
            )}

            {r && (
                <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, color: GRY, marginBottom: 10 }}>Busqué como {r.interpretado}.</div>
                    {r.coincidencias.length > 1 && (
                        <>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{r.coincidencias.length} propiedades coinciden. Elige una:</div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                                    <thead><tr><th style={th}>Código</th><th style={th}>Coincide por</th><th style={th}>Propiedad</th><th style={th}>Inmobiliaria</th><th style={th}>Estatus</th><th style={th}>Precio</th></tr></thead>
                                    <tbody>{r.coincidencias.map((c) => (
                                        <tr key={c.id}>
                                            <td style={td}><a href={`/propiedad/${c.id}`} style={{ color: SEA, fontWeight: 700 }}>{c.internalId ?? c.id.slice(-8)}</a></td>
                                            <td style={td}>{c.campo}</td>
                                            <td style={td}>{c.titulo || '—'}<div style={{ fontSize: 11, color: GRY }}>{c.operacion} · {c.colonia}</div></td>
                                            <td style={td}>{c.inmobiliaria}</td>
                                            <td style={td}>{c.estatus}</td>
                                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{money(c.precio)}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        </>
                    )}
                    {!r.coincidencias.length && (
                        <div style={{ background: LGT, padding: '16px 18px', borderRadius: 2 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>No es una propiedad de Pulppo.</div>
                            {r.mercado.length ? (
                                <>
                                    <div style={{ fontSize: 12, marginTop: 4 }}>Pero sí está en el MLS (el mercado que leemos de los portales). Es de:</div>
                                    {r.mercado.map((m, i) => (
                                        <div key={i} style={{ marginTop: 10, fontSize: 12.5 }}>
                                            <b>{m.quien}</b> · {m.portal} · {m.operacion} · {money(m.precio)}
                                            <div style={{ color: '#666' }}>{m.titulo}{m.colonia ? ` · ${m.colonia}` : ''}</div>
                                            {m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700, fontSize: 12 }}>Ver aviso ↗</a>}
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <div style={{ fontSize: 12, marginTop: 4, color: '#666' }}>Tampoco aparece en el MLS. Revisa que el código esté completo o pega la liga del aviso.</div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
