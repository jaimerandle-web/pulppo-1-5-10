'use client';

/**
 * Marketing de la inmobiliaria (oct-2026) — HOY SÓLO PARA EL EQUIPO INTERNO (lib/marketingAcceso.ts).
 * Asignación de anuncios, cambios de la semana, desempeño por nivel y por aviso, propiedades estrella,
 * exposición vs calidad, la rotación explicada simple y las propiedades trabadas.
 * 🔴 Sin costos ni CPL (Ale): esa lectura es interna de Pulppo.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AvisoMk, CambioMk, MarketingMk } from '@/lib/marketingDh';

const BLK = '#212322', YEL = '#F6BE00', GRY = '#B7B7B7', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const R = 2;
const f0 = (n: number) => n.toLocaleString('es-MX');
const pc = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MES[Number(s.slice(5, 7)) - 1]}` : '—');

const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#777', borderBottom: `1px solid ${BLK}`, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.4px', cursor: 'default' };
const thN: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: `1px solid ${LGT}`, verticalAlign: 'top' };
const tdN: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sub: CSSProperties = { fontSize: 10.5, color: '#777' };

function Seccion({ n, titulo, nota, children }: { n: number; titulo: string; nota?: ReactNode; children: ReactNode }) {
    return (
        <section style={{ marginTop: 28 }}>
            <h2 style={{ fontFamily: 'EB Garamond, serif', fontSize: 21, fontWeight: 400, margin: 0 }}><span style={{ color: GRY, marginRight: 8 }}>{n}</span>{titulo}</h2>
            <div style={{ width: 44, height: 1, background: YEL, margin: '7px 0 9px' }} />
            {nota && <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10, lineHeight: 1.5, maxWidth: 860 }}>{nota}</div>}
            {children}
        </section>
    );
}
function Kpi({ label, value, nota }: { label: string; value: string; nota?: string }) {
    return (
        <div style={{ flex: '1 1 140px', border: `1px solid ${LGT}`, borderRadius: R, padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .8, color: GRY, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 24, lineHeight: 1.1, margin: '4px 0 2px' }}>{value}</div>
            {nota && <div style={sub}>{nota}</div>}
        </div>
    );
}
function Tabla({ children, min = 560 }: { children: ReactNode; min?: number }) {
    return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: min, borderCollapse: 'collapse' }}>{children}</table></div>;
}
const Cod = ({ c, id }: { c: string; id?: string }) => <a href={`/ficha/${encodeURIComponent(id ?? c)}`} target="_blank" rel="noreferrer" style={{ color: SEA, fontWeight: 700, textDecoration: 'none' }}>{c}</a>;
const Pill = ({ t, bg, fg }: { t: string; bg: string; fg: string }) => <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: R, background: bg, color: fg, whiteSpace: 'nowrap' }}>{t}</span>;
const Delta = ({ a, b }: { a: number; b: number }) => {
    if (!b && !a) return null;
    const d = a - b;
    return <span style={{ ...sub, color: d > 0 ? SEA : d < 0 ? RED : '#777', marginLeft: 4 }}>{d > 0 ? '+' : ''}{f0(d)}</span>;
};
const copiar = (filas: Array<Array<string | number | null>>) => {
    try { void navigator.clipboard.writeText(filas.map((r) => r.map((x) => String(x ?? '')).join('\t')).join('\n')); } catch { /* sin portapapeles */ }
};
const BotonCopiar = ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} style={{ fontSize: 11, padding: '3px 9px', border: `1px solid ${LGT}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#555', float: 'right' }}>Copiar tabla</button>
);

export default function MBMarketing({ companyId }: { companyId: string }) {
    const [d, setD] = useState<MarketingMk | null>(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let vivo = true;
        fetch(`/api/mb-marketing?company=${companyId}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => { if (!vivo) return; if (ok) setD(j); else setErr(j.error || 'No se pudo calcular'); })
            .catch(() => vivo && setErr('No se pudo calcular'));
        return () => { vivo = false; };
    }, [companyId]);
    if (err) return <p style={{ fontSize: 13, color: RED }}>{err}</p>;
    if (!d) return <p style={{ fontSize: 13, color: GRY }}>Calculando en vivo… (la primera vez del día tarda ~30 s: corre el scoring de avisos)</p>;
    return <Vista d={d} />;
}

type Orden = 'leads30' | 'leadsSem' | 'visitas30' | 'conv' | 'nivel';
function Vista({ d }: { d: MarketingMk }) {
    const [orden, setOrden] = useState<Orden>('leads30');
    const [verCambios, setVerCambios] = useState<'semana' | 'semanaAnt'>('semana');
    const premium = d.asignacion.porNivel.filter((x) => /Súper|Destacado/.test(x.nivel)).reduce((s, x) => s + x.n, 0);
    const total = d.avisos.length;
    const avisos = useMemo(() => {
        const conv = (a: AvisoMk) => (a.leads30 ? a.visitas30 / a.leads30 : -1);
        const xs = [...d.avisos];
        xs.sort((a, b) => orden === 'nivel' ? a.nivel.localeCompare(b.nivel) : orden === 'conv' ? conv(b) - conv(a) : (b[orden] as number) - (a[orden] as number));
        return xs;
    }, [d.avisos, orden]);
    const cambios: CambioMk[] = d.cambios[verCambios];
    const suben = cambios.filter((c) => c.sube).length;
    const thO = (k: Orden, l: string, num = true) => <th style={{ ...(num ? thN : th), cursor: 'pointer', color: orden === k ? BLK : '#777' }} onClick={() => setOrden(k)}>{l}{orden === k ? ' ↓' : ''}</th>;
    const idDe = (codigo: string) => d.avisos.find((a) => a.codigo === codigo)?.id;

    return (<div>
        <div style={{ background: LGT, borderLeft: `2px solid ${YEL}`, padding: '9px 13px', fontSize: 11.5, color: '#555', marginBottom: 6 }}>
            Sólo lo ve el equipo de Pulppo. Semana en curso: <b>{fecha(d.semana.desde)} – {fecha(d.semana.hasta)}</b> (en curso) · semana anterior: {fecha(d.semanaAnt.desde)} – {fecha(d.semanaAnt.hasta)}.
            Leads únicos (misma persona + misma propiedad = 1) y visitas por fecha de la visita.
        </div>

        <Seccion n={1} titulo="Asignación de hoy" nota="En qué nivel está cada anuncio en Inmuebles24 y MercadoLibre, y en qué cuenta de Inmuebles24.">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <Kpi label="Anuncios publicados" value={f0(total)} />
                <Kpi label="Con exposición premium" value={f0(premium)} nota={`${pc(premium, total)} · súper destacado o destacado`} />
                <Kpi label="Fijados a mano" value={f0(d.asignacion.fijados.length)} />
                <Kpi label="Con zona forzada" value={f0(d.asignacion.zonaForzada)} />
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px' }}>
                    <Tabla min={300}>
                        <thead><tr><th style={th}>Nivel en Inmuebles24</th><th style={thN}>Anuncios</th><th style={thN}>Venta</th><th style={thN}>Renta</th></tr></thead>
                        <tbody>{d.asignacion.porNivel.map((x) => <tr key={x.nivel}><td style={td}>{x.nivel}</td><td style={{ ...tdN, fontWeight: 700 }}>{f0(x.n)}</td><td style={tdN}>{f0(x.venta)}</td><td style={tdN}>{f0(x.renta)}</td></tr>)}</tbody>
                    </Tabla>
                </div>
                <div style={{ flex: '1 1 320px' }}>
                    <Tabla min={300}>
                        <thead><tr><th style={th}>Cuenta de Inmuebles24</th><th style={thN}>Anuncios</th><th style={th}>Niveles</th></tr></thead>
                        <tbody>{d.asignacion.porCuenta.map((c) => <tr key={c.cuenta}><td style={td}>{c.cuenta}</td><td style={{ ...tdN, fontWeight: 700 }}>{f0(c.n)}</td><td style={{ ...td, fontSize: 11 }}>{Object.entries(c.niveles).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ${k}`).join(' · ')}</td></tr>)}</tbody>
                    </Tabla>
                    <div style={{ height: 10 }} />
                    <Tabla min={300}>
                        <thead><tr><th style={th}>MercadoLibre</th><th style={thN}>Anuncios</th></tr></thead>
                        <tbody>{d.asignacion.meli.map((m) => <tr key={m.tipo}><td style={td}>{m.tipo}</td><td style={tdN}>{f0(m.n)}</td></tr>)}</tbody>
                    </Tabla>
                </div>
            </div>
            {d.asignacion.fijados.length > 0 && <div style={{ ...sub, marginTop: 8 }}>Fijados a mano: {d.asignacion.fijados.map((x) => `${x.codigo} (${x.nivel}${x.por ? `, por ${x.por}` : ''}${x.el ? `, ${fecha(x.el)}` : ''})`).join(' · ')}</div>}
            {d.asignacion.noPromovidos.length > 0 && <div style={{ ...sub, marginTop: 4 }}>Motivos por los que i24 no promueve: {d.asignacion.noPromovidos.map((x) => `${x.motivo} (${x.n})`).join(' · ')}</div>}
        </Seccion>

        <Seccion n={2} titulo="Cambios de la semana" nota="Qué subió o bajó de nivel: el nivel al inicio de la semana contra el de hoy (o el del cierre de la semana anterior). El motivo sale del historial del anuncio.">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['semana', 'semanaAnt'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setVerCambios(k)} style={{ padding: '5px 11px', fontSize: 12, border: `1px solid ${LGT}`, borderRadius: R, cursor: 'pointer', fontFamily: 'inherit', background: verCambios === k ? BLK : '#fff', color: verCambios === k ? '#fff' : '#555' }}>
                        {k === 'semana' ? `Esta semana (en curso) · ${d.cambios.semana.length}` : `Semana anterior · ${d.cambios.semanaAnt.length}`}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{f0(suben)}</b> subieron · <b>{f0(cambios.length - suben)}</b> bajaron o rotaron.</div>
            {cambios.length > 0 && <Tabla min={620}>
                <thead><tr><th style={th}>Fecha</th><th style={th}>Propiedad</th><th style={th}>Antes</th><th style={th}>Ahora</th><th style={th}>Motivo</th></tr></thead>
                <tbody>{cambios.slice(0, 80).map((c) => <tr key={c.codigo + c.fecha}><td style={td}>{fecha(c.fecha)}</td><td style={td}><Cod c={c.codigo} id={idDe(c.codigo)} /></td><td style={td}>{c.antes}</td>
                    <td style={td}><span style={{ color: c.sube ? SEA : RED, fontWeight: 700 }}>{c.sube ? '↑' : '↓'}</span> {c.despues}</td><td style={{ ...td, color: '#666' }}>{c.motivo ?? '—'}</td></tr>)}</tbody>
            </Tabla>}
        </Seccion>

        <Seccion n={3} titulo="Desempeño por nivel y por anuncio" nota="Leads únicos y visitas de cada nivel: esta semana (en curso) contra la anterior, y los últimos 30 días.">
            <Tabla min={720}>
                <thead><tr><th style={th}>Nivel</th><th style={thN}>Anuncios</th><th style={thN}>Leads semana</th><th style={thN}>Semana ant.</th><th style={thN}>Leads 30 d</th><th style={thN}>Leads por anuncio (30 d)</th><th style={thN}>Visitas 30 d</th><th style={thN}>Lead → visita</th></tr></thead>
                <tbody>{d.porNivel.map((x) => <tr key={x.nivel}><td style={td}>{x.nivel}</td><td style={tdN}>{f0(x.avisos)}</td><td style={tdN}>{f0(x.leadsSem)}<Delta a={x.leadsSem} b={x.leadsSemAnt} /></td><td style={{ ...tdN, color: '#777' }}>{f0(x.leadsSemAnt)}</td>
                    <td style={{ ...tdN, fontWeight: 700 }}>{f0(x.leads30)}</td><td style={tdN}>{x.avisos ? (x.leads30 / x.avisos).toFixed(1) : '—'}</td><td style={tdN}>{f0(x.visitas30)}</td><td style={tdN}>{pc(x.visitas30, x.leads30)}</td></tr>)}</tbody>
            </Tabla>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', margin: '18px 0 6px' }}>Por anuncio <span style={{ fontWeight: 400, textTransform: 'none', color: GRY }}>· clic en el encabezado para ordenar</span>
                <BotonCopiar onClick={() => copiar([['Código', 'Nivel', 'Cuenta', 'Leads semana', 'Leads 30 d', 'Visitas 30 d', 'Lead→visita 30 d', 'Vistas i24', 'Vistas mercado'], ...avisos.map((a) => [a.codigo, a.nivel, a.cuenta, a.leadsSem, a.leads30, a.visitas30, a.leads30 ? Math.round((100 * a.visitas30) / a.leads30) + '%' : '', a.vistas, a.vistasMercado])])} />
            </div>
            <Tabla min={880}>
                <thead><tr><th style={th}>Propiedad</th>{thO('nivel', 'Nivel', false)}<th style={th}>Cuenta</th>{thO('leadsSem', 'Leads semana')}{thO('leads30', 'Leads 30 d')}{thO('visitas30', 'Visitas 30 d')}{thO('conv', 'Lead → visita')}<th style={thN}>Vistas i24 / mercado</th></tr></thead>
                <tbody>{avisos.slice(0, 120).map((a) => <tr key={a.id}><td style={td}><Cod c={a.codigo} id={a.id} /><div style={sub}>{[a.tipo, a.colonia, a.operacion].filter(Boolean).join(' · ')}</div></td>
                    <td style={td}>{a.nivel}</td><td style={{ ...td, fontSize: 11, color: '#666' }}>{a.cuenta}</td><td style={tdN}>{f0(a.leadsSem)}<Delta a={a.leadsSem} b={a.leadsSemAnt} /></td><td style={{ ...tdN, fontWeight: 700 }}>{f0(a.leads30)}</td>
                    <td style={tdN}>{f0(a.visitas30)}</td><td style={tdN}>{pc(a.visitas30, a.leads30)}</td><td style={{ ...tdN, color: '#666' }}>{a.vistas ?? '—'} / {a.vistasMercado ?? '—'}</td></tr>)}</tbody>
            </Tabla>
            {avisos.length > 120 && <div style={sub}>Se muestran 120 de {f0(avisos.length)}; «Copiar tabla» trae todos.</div>}
        </Seccion>

        <Seccion n={4} titulo="Propiedades estrella" nota="Las que más leads reciben (30 días) y si los convierten en visitas. Estrella = 5+ leads y 15%+ visitan. Mucho ruido = 5+ leads y menos de 10% visitan.">
            <Tabla min={600}>
                <thead><tr><th style={th}>Propiedad</th><th style={th}>Nivel</th><th style={thN}>Leads 30 d</th><th style={thN}>Visitas 30 d</th><th style={thN}>Lead → visita</th><th style={th}>Lectura</th></tr></thead>
                <tbody>{d.estrellas.map((e) => <tr key={e.codigo}><td style={td}><Cod c={e.codigo} id={idDe(e.codigo)} /></td><td style={td}>{e.nivel}</td><td style={{ ...tdN, fontWeight: 700 }}>{f0(e.leads30)}</td><td style={tdN}>{f0(e.visitas30)}</td><td style={tdN}>{e.conv == null ? '—' : `${Math.round(e.conv * 100)}%`}</td>
                    <td style={td}>{e.etiqueta === 'Estrella' ? <Pill t="★ Estrella" bg={SEA} fg="#fff" /> : e.etiqueta === 'Mucho ruido, poca visita' ? <Pill t="Mucho ruido, poca visita" bg="#F3D9D3" fg={RED} /> : <Pill t="En camino" bg={LGT} fg={BLK} />}</td></tr>)}</tbody>
            </Tabla>
        </Seccion>

        <Seccion n={5} titulo="Exposición vs. calidad del inventario" nota="Dónde se está usando un lugar premium sin que la propiedad esté lista, y qué simples merecen subir según el scoring de anuncios (demanda de la zona, competencia, precio contra su zona, comisión y calidad).">
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 420px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Premium que no está rindiendo · {f0(d.desperdicio.length)}</div>
                    <Tabla min={380}>
                        <thead><tr><th style={th}>Propiedad</th><th style={th}>Nivel</th><th style={thN}>Leads 30 d</th><th style={th}>Por qué</th></tr></thead>
                        <tbody>{d.desperdicio.slice(0, 25).map((x) => <tr key={x.codigo}><td style={td}><Cod c={x.codigo} id={idDe(x.codigo)} /></td><td style={{ ...td, fontSize: 11 }}>{x.nivel}</td><td style={tdN}>{f0(x.leads30)}</td><td style={{ ...td, fontSize: 11, color: RED }}>{x.motivo}</td></tr>)}</tbody>
                    </Tabla>
                </div>
                <div style={{ flex: '1 1 340px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Simples que merecen subir · {f0(d.subir.length)}</div>
                    <Tabla min={300}>
                        <thead><tr><th style={th}>Propiedad</th><th style={thN}>Puntaje</th><th style={thN}>Leads 30 d</th><th style={thN}>Demanda zona</th></tr></thead>
                        <tbody>{d.subir.map((x) => <tr key={x.codigo}><td style={td}><Cod c={x.codigo} id={idDe(x.codigo)} /></td><td style={{ ...tdN, fontWeight: 700, color: SEA }}>{x.puntos}</td><td style={tdN}>{f0(x.leads30)}</td><td style={tdN}>{x.demanda ?? '—'}</td></tr>)}</tbody>
                    </Tabla>
                </div>
            </div>
        </Seccion>

        <Seccion n={6} titulo="Rotación: cómo decidimos qué promover">
            <div style={{ background: '#fff', border: `1px solid ${LGT}`, borderLeft: `3px solid ${YEL}`, borderRadius: R, padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6, maxWidth: 860 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Así funciona, en simple</div>
                <div>· <b>Qué mira:</b> cuánta gente busca ese tipo de propiedad en la zona, cuánta competencia tiene, si el precio está en línea con su zona, la comisión y qué tan completo está el anuncio.</div>
                <div>· <b>Por qué se promueve:</b> un lugar destacado rinde donde hay demanda y la propiedad está lista (precio en zona, fotos, video). Destacar algo caro o incompleto no trae más visitas.</div>
                <div>· <b>Cuándo se rota:</b> cuando una propiedad ya juntó <b>{d.reglas.leadsRotar}–45 leads</b> en su lugar destacado, pasa a Simple y libera el lugar para la siguiente con mejor puntaje. Así la exposición se reparte entre más inventario.</div>
                <div>· <b>Qué no compite:</b> rentas, terrenos, comerciales y zonas sin demanda o sin datos del mercado no ocupan un lugar destacado.</div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
                <div style={{ flex: '1 1 340px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: SEA }}>Promover esta semana · {f0(Math.min(10, d.subir.length))}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>{d.subir.slice(0, 10).map((x) => <div key={x.codigo}><Cod c={x.codigo} id={idDe(x.codigo)} /> <span style={sub}>puntaje {x.puntos}</span></div>)}{!d.subir.length && <span style={sub}>Ninguna simple pasa el filtro esta semana.</span>}</div>
                </div>
                <div style={{ flex: '1 1 420px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: RED }}>Rotar a Simple · {f0(d.rotar.length)}</div>
                    <Tabla min={380}>
                        <thead><tr><th style={th}>Propiedad</th><th style={th}>Nivel</th><th style={thN}>Leads en su lugar</th><th style={th}>Por qué</th></tr></thead>
                        <tbody>{d.rotar.slice(0, 25).map((x) => <tr key={x.codigo}><td style={td}><Cod c={x.codigo} id={idDe(x.codigo)} /></td><td style={{ ...td, fontSize: 11 }}>{x.nivel}<div style={sub}>desde {fecha(x.desde)}</div></td><td style={tdN}>{f0(x.leadsEnNivel)}</td><td style={{ ...td, fontSize: 11 }}>{x.motivo}</td></tr>)}</tbody>
                    </Tabla>
                </div>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6, maxWidth: 860 }}>
                <b>Acciones manuales sugeridas mientras probamos el scoring</b>
                <div>· Bajar a Simple las {f0(d.rotar.filter((x) => x.leadsEnNivel >= d.reglas.leadsRotar).length)} que ya juntaron {d.reglas.leadsRotar}+ leads en su lugar y subir en su lugar las de «Promover esta semana».</div>
                <div>· Las premium con precio fuera de su zona: conversación de precio con el propietario antes de seguir pagando exposición.</div>
                <div>· Las premium con ficha incompleta: completar fotos y video esta semana; si no, bajarlas a Simple.</div>
                <div>· Revisar cada lunes esta pestaña contra la semana anterior y ajustar a mano lo que el scoring todavía no resuelve.</div>
            </div>
        </Seccion>

        <Seccion n={7} titulo="Propiedades trabadas que necesitan auxilio" nota="Publicadas hace 60+ días, sin ninguna oferta, y con 2 o menos leads en 90 días, o con 5+ leads pero ninguna visita. El freno probable y una acción concreta.">
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{f0(d.trabadas.length)}</b> propiedades · {Object.entries(d.trabadas.reduce<Record<string, number>>((m, x) => ({ ...m, [x.freno]: (m[x.freno] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}
                <BotonCopiar onClick={() => copiar([['Código', 'Nivel', 'Días publicada', 'Leads 90 d', 'Visitas 90 d', 'Freno', 'Acción'], ...d.trabadas.map((x) => [x.codigo, x.nivel, x.dias, x.leads90, x.visitas90, x.freno, x.accion])])} />
            </div>
            <Tabla min={860}>
                <thead><tr><th style={th}>Propiedad</th><th style={th}>Nivel</th><th style={thN}>Días publicada</th><th style={thN}>Leads 90 d</th><th style={thN}>Visitas 90 d</th><th style={th}>Freno</th><th style={th}>Acción</th></tr></thead>
                <tbody>{d.trabadas.slice(0, 60).map((x) => <tr key={x.codigo}><td style={td}><Cod c={x.codigo} id={idDe(x.codigo)} /></td><td style={{ ...td, fontSize: 11 }}>{x.nivel}</td><td style={tdN}>{f0(x.dias)}</td><td style={tdN}>{f0(x.leads90)}</td><td style={tdN}>{f0(x.visitas90)}</td>
                    <td style={td}><Pill t={x.freno} bg={x.freno === 'Precio' ? '#F3D9D3' : x.freno === 'Ficha' ? YEL : LGT} fg={x.freno === 'Precio' ? RED : BLK} /></td><td style={{ ...td, fontSize: 11.5 }}>{x.accion}</td></tr>)}</tbody>
            </Tabla>
        </Seccion>
        <p style={{ fontSize: 10, color: GRY, marginTop: 16 }}>En vivo desde Mongo · {new Date(d.generado).toLocaleString('es-MX')}</p>
    </div>);
}
