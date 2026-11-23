'use client';

/**
 * «Presentación para la KAM»: el mismo «Tu año» de /mb en láminas 16:9 para que la KAM lo vea con el master broker
 * (absorbe el «Resumen 2026» de Karen, 23-nov-2026). Sólo la ve el equipo Pulppo.
 *
 * Un solo cálculo: las láminas salen del MISMO objeto que pinta el dashboard (`TuAnio`) más los reconocimientos.
 * Lo único que se escribe a mano es el plan 2027 (acción para enero, meta Q1 y dónde se mide): sale prellenado con lo
 * que faltó + inventario + equipo, y la KAM lo ajusta antes de descargar. Se guarda en el navegador por inmobiliaria.
 * Se descarga como PDF desde el diálogo de impresión (mismo truco que las cartas).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Metrica, Reconocimientos, TuAnio } from '@/lib/tu2026';

const BLK = '#212322', YEL = '#F6BE00', LINE = '#D0D3D4', LGT = '#F3F3F3', SEA = '#529999', RED = '#A52003';
const MUTED = 'rgba(33,35,34,.6)', FAINT = 'rgba(33,35,34,.35)';

const fmt = (v: number | null | undefined, f: Metrica['fmt']) => {
    if (v == null) return '—';
    if (f === 'money') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} MDP` : `$${Math.round(v).toLocaleString('es-MX')}`;
    if (f === 'pct') { const p = v * 100; return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`; }
    if (f === 'min') return v >= 90 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
    return Math.round(v).toLocaleString('es-MX');
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ── plan 2027 ─────────────────────────────────────────────────────────────────
export interface Paso { clave: string; titulo: string; diagnostico: string; accion: string; meta: string; donde: string }

/** Candidatos al plan: lo que faltó (en su orden) y luego las red flags de inventario y equipo. */
function candidatos(d: TuAnio): Paso[] {
    const out: Paso[] = [];
    const M = (k: string) => d.metricas.find((m) => m.key === k);
    const meses = Math.max(1, d.mensual.meses.length - (d.mensual.parcial ? 0.5 : 0));
    const ritmo = (k: string) => { const v = M(k)?.valores[d.años[1]]; return v ? Math.ceil((v / meses) * 3) : null; };
    const SUG: Record<string, { accion: string; meta: () => string; donde: string }> = {
        cierresRenta: { accion: 'Revisar con cada propietario el precio de sus rentas y contestar cada lead de renta el mismo día.', meta: () => `${ritmo('cierresRenta') ?? '—'} rentas o más en el trimestre (el ritmo de ${d.años[1]}).`, donde: '/mb › Desempeño' },
        cierresVenta: { accion: 'Revisión semanal de las búsquedas con visita y sin oferta, venta por venta.', meta: () => `${ritmo('cierresVenta') ?? '—'} ventas o más en el trimestre (el ritmo de ${d.años[1]}).`, donde: '/mb › Desempeño' },
        firmadas: { accion: 'Pedir la exclusiva en cada captación nueva y subir el contrato firmado a Pulppo.', meta: () => `${ritmo('firmadas') ?? '—'} exclusivas firmadas en el trimestre.`, donde: '/mb › Propiedades' },
        tasaVisita: { accion: 'Proponer visita desde el primer mensaje y dar seguimiento en 48 h a quien no agenda.', meta: () => `Volver a ${fmt(M('tasaVisita')?.valores[d.años[1]], 'pct')} de leads que visitan.`, donde: '/mb › Desempeño' },
        leadCierre: { accion: 'Cada semana, revisar con el equipo a quién ya visitó y todavía no oferta.', meta: () => `Volver a ${fmt(M('leadCierre')?.valores[d.años[1]], 'pct')} de leads que cierran.`, donde: '/mb › Desempeño' },
        leads: { accion: 'Inventario en precio y con video: es lo que más jala demanda en los portales.', meta: () => `${ritmo('leads')?.toLocaleString('es-MX') ?? '—'} leads o más en el trimestre.`, donde: '/mb › Overview' },
        visitas: { accion: 'Meta semanal de visitas por asesor y agenda compartida del equipo.', meta: () => `${ritmo('visitas')?.toLocaleString('es-MX') ?? '—'} visitas o más en el trimestre.`, donde: '/mb › Desempeño' },
        captaciones: { accion: 'Meta mensual de captación por asesor, con la exclusiva como estándar.', meta: () => `${ritmo('captaciones') ?? '—'} propiedades captadas en el trimestre.`, donde: '/mb › Propiedades' },
        cobrada: { accion: 'Seguimiento semanal a las operaciones en cobranza para que no se atoren.', meta: () => `${fmt(ritmo('cobrada'), 'money')} cobrados en el trimestre.`, donde: '/mb › Overview' },
        asesoresCobro: { accion: 'Acompañar a quien no cobró en el año con una operación por mes.', meta: () => `${M('asesoresCobro')?.valores[d.años[1]] ?? '—'} asesores cobrando, como en ${d.años[1]}.`, donde: '/mb › Desempeño' },
        ascensos: { accion: 'Revisar con cada asesor qué le falta para el siguiente nivel.', meta: () => 'Al menos un ascenso en el trimestre.', donde: 'Niveles de asesor' },
        ticket: { accion: 'Captar en las zonas y rangos de precio donde ya cierras.', meta: () => `Ticket mediano de ${fmt(M('ticket')?.valores[d.años[1]], 'money')} o más.`, donde: '/mb › Desempeño' },
    };
    for (const h of d.falto) {
        const s = SUG[h.metrica];
        if (s) out.push({ clave: h.metrica, titulo: h.titulo, diagnostico: h.texto, accion: s.accion, meta: s.meta(), donde: s.donde });
    }
    const inv = d.inventario;
    if (inv?.enPrecio != null && inv.enPrecio < 0.6)
        out.push({ clave: 'precio', titulo: 'Precios en mercado', diagnostico: `Hoy ${fmt(inv.enPrecio, 'pct')} de tu inventario está en precio de mercado.`,
            accion: 'Revisar precios con cada propietario y mostrar siempre la opción de bajar 8%–10%.', meta: '60% o más del inventario en precio.', donde: '/mb › Propiedades (estado de precio)' });
    if (d.equipo.tareasVencidas > 20)
        out.push({ clave: 'tareas', titulo: 'Poner al día las tareas', diagnostico: `Hoy tu equipo tiene ${d.equipo.tareasVencidas.toLocaleString('es-MX')} tareas vencidas.`,
            accion: 'Limpieza de tareas en enero y una rutina diaria de 15 minutos por asesor.', meta: '5 tareas vencidas o menos por asesor.', donde: 'Pulppo › Tareas' });
    if (d.equipo.sinLeads.length)
        out.push({ clave: 'sinLeads', titulo: 'Activar a todo tu equipo', diagnostico: `${d.equipo.sinLeads.length} ${d.equipo.sinLeads.length === 1 ? 'asesor activo lleva' : 'asesores activos llevan'} 3 meses o más sin recibir leads.`,
            accion: 'Reasignarles leads o dar de baja a quien ya no participa.', meta: '0 asesores activos sin leads.', donde: '/mb › Desempeño' });
    if (inv?.calidadAlta != null && inv.calidadAlta < 0.6)
        out.push({ clave: 'calidad', titulo: 'Fichas en calidad alta', diagnostico: `Hoy ${fmt(inv.calidadAlta, 'pct')} de tus fichas está en calidad Alta.`,
            accion: 'Grabar video de las propiedades que no lo tienen: es lo que separa Media de Alta.', meta: '60% o más de las fichas en calidad Alta.', donde: '/mb › Propiedades' });
    return out;
}

export function PresentacionKam({ d, companyId }: { d: TuAnio; companyId: string }) {
    const [abierto, setAbierto] = useState(false);
    const cands = candidatos(d);
    const clave = `tu2026-plan-${companyId}`;
    const [plan, setPlan] = useState<Paso[]>(() => cands.slice(0, 3));
    const [prox, setProx] = useState('');
    const [kam, setKam] = useState('');
    const [cargando, setCargando] = useState(false);
    useEffect(() => {
        try { const s = localStorage.getItem(clave); if (s) { const j = JSON.parse(s); if (j.plan?.length) setPlan(j.plan); setProx(j.prox ?? ''); setKam(j.kam ?? ''); } } catch { /* sin storage */ }
    }, [clave]);
    const guardar = (p: Paso[], x = prox, k = kam) => { try { localStorage.setItem(clave, JSON.stringify({ plan: p, prox: x, kam: k })); } catch { /* sin storage */ } };
    const setPaso = (i: number, campo: keyof Paso, v: string) => setPlan((ps) => { const n = ps.map((p, j) => (j === i ? { ...p, [campo]: v } : p)); guardar(n); return n; });
    const elegir = (i: number, c: string) => setPlan((ps) => { const x = cands.find((y) => y.clave === c); if (!x) return ps; const n = ps.map((p, j) => (j === i ? x : p)); guardar(n); return n; });

    const descargar = async () => {
        setCargando(true);
        let rec: Reconocimientos | null = null;
        try { const r = await fetch(`/api/mb-tu2026?company=${companyId}&vista=reconocimientos`); if (r.ok) rec = await r.json(); } catch { /* sin reconocimientos */ }
        setCargando(false);
        abrir(d, rec, plan, prox, kam);
    };

    const inp: CSSProperties = { width: '100%', padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 0, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' };
    const lbl: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', margin: '8px 0 3px' };
    return (
        <>
            <button onClick={() => setAbierto(true)} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: BLK, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                Presentación para la KAM
            </button>
            {abierto && (
                <div onClick={() => setAbierto(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(33,35,34,.5)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 980, padding: '24px 26px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                            <div>
                                <div style={{ fontFamily: 'EB Garamond, serif', fontSize: 26 }}>Presentación para la KAM</div>
                                <div style={{ fontSize: 13, color: MUTED, marginTop: 4, maxWidth: 640 }}>
                                    9 láminas con los mismos números del dashboard. Sólo el plan 2027 se escribe a mano: viene prellenado con lo que
                                    faltó, el inventario y el equipo; ajústalo antes de descargar. Se guarda en este navegador.
                                </div>
                            </div>
                            <button onClick={() => setAbierto(false)} style={{ background: 'none', border: `1px solid ${LINE}`, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>Cerrar</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 18 }}>
                            {plan.map((p, i) => (
                                <div key={i} style={{ border: `0.5px solid ${LINE}`, borderTop: `2px solid ${SEA}`, padding: '12px 14px' }}>
                                    <span style={lbl}>Punto {i + 1}</span>
                                    <select style={inp} value={p.clave} onChange={(e) => elegir(i, e.target.value)}>
                                        {!cands.some((c) => c.clave === p.clave) && <option value={p.clave}>{p.titulo}</option>}
                                        {cands.map((c) => <option key={c.clave} value={c.clave}>{c.titulo}</option>)}
                                    </select>
                                    <span style={lbl}>Diagnóstico</span><textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={p.diagnostico} onChange={(e) => setPaso(i, 'diagnostico', e.target.value)} />
                                    <span style={lbl}>Acción para enero</span><textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={p.accion} onChange={(e) => setPaso(i, 'accion', e.target.value)} />
                                    <span style={lbl}>Meta Q1 2027</span><input style={inp} value={p.meta} onChange={(e) => setPaso(i, 'meta', e.target.value)} />
                                    <span style={lbl}>Dónde lo medimos</span><input style={inp} value={p.donde} onChange={(e) => setPaso(i, 'donde', e.target.value)} />
                                </div>
                            ))}
                        </div>
                        {plan.length < 3 && cands.length > plan.length && (
                            <button onClick={() => { const n = [...plan, cands.find((c) => !plan.some((p) => p.clave === c.clave))!]; setPlan(n); guardar(n); }}
                                style={{ marginTop: 10, background: 'none', border: 'none', textDecoration: 'underline', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>+ Agregar un punto</button>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 14 }}>
                            <label><span style={lbl}>Próxima sesión de seguimiento</span><input style={inp} value={prox} placeholder="ej. martes 20 de enero" onChange={(e) => { setProx(e.target.value); guardar(plan, e.target.value); }} /></label>
                            <label><span style={lbl}>KAM</span><input style={inp} value={kam} placeholder="Nombre de la KAM" onChange={(e) => { setKam(e.target.value); guardar(plan, prox, e.target.value); }} /></label>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                            <button onClick={descargar} disabled={cargando} style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, background: BLK, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: cargando ? 0.6 : 1 }}>
                                {cargando ? 'Preparando…' : 'Descargar presentación (PDF)'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ── las láminas ───────────────────────────────────────────────────────────────
function abrir(d: TuAnio, rec: Reconocimientos | null, plan: Paso[], prox: string, kam: string) {
    const w = window.open('', '_blank');
    if (!w) return;
    const o = window.location.origin;
    const [a0, a1, a2] = d.años;
    const M = (k: string) => d.metricas.find((m) => m.key === k)!;
    const total = 9;
    const lam = (n: number, titulo: string, sub: string, cuerpo: string) => `<section class="lam">
<div class="cab"><span class="eb">Pulppo · Tu ${a2}</span><img src="${o}/tu2026/pulppo-icon.png" alt=""></div>
<h2>${esc(titulo)}</h2><div class="ac"></div>${sub ? `<div class="sub">${sub}</div>` : ''}
<div class="cuerpo">${cuerpo}</div>
<div class="pie"><span>${esc(d.inmobiliaria)}</span><span>${n} / ${total}</span></div></section>`;

    // cambio contra el año pasado, verde/rojo desde ±5% (como en el dashboard)
    const cambio = (m: Metrica) => {
        const v = m.valores[a2], ant = m.valores[a1];
        if (v == null || ant == null || ant <= 0) return '';
        const ch = (v - ant) / ant, pct = Math.round(Math.abs(ch) * 100), o2 = ch * (m.dir || 1);
        const c = pct < 5 ? MUTED : o2 > 0 ? SEA : RED;
        return `<span class="ch" style="color:${c}">${pct ? (ch > 0 ? '▲' : '▼') : ''} ${pct}% vs ${a1}</span>`;
    };
    const tres = (m: Metrica) => {
        const vs = [a0, a1, a2].map((y) => m.valores[y] ?? 0), max = Math.max(...vs, 1);
        return `<div class="tres">${vs.map((v, i) => `<div><div class="tv">${fmt(m.valores[[a0, a1, a2][i]], m.fmt)}</div><div class="tb" style="height:${Math.max(2, Math.round((v / max) * 46))}px;background:${i === 2 ? YEL : FAINT}"></div><div class="ty">${[a0, a1, a2][i]}</div></div>`).join('')}</div>`;
    };
    const kpi = (m: Metrica, label: string) => `<div class="kpi"><div class="tag">${esc(label)}</div><div class="big">${fmt(m.valores[a2], m.fmt)}</div>${cambio(m)}${tres(m)}</div>`;
    const cierres: Metrica = { ...M('cierresVenta'), key: 'cierres', label: 'Cierres', valores: Object.fromEntries(d.años.map((y) => [y, (M('cierresVenta').valores[y] ?? 0) + (M('cierresRenta').valores[y] ?? 0)])) };

    const L: string[] = [];
    // 1 · portada
    L.push(`<section class="lam portada">
<div class="cab"><span class="eb" style="color:rgba(255,255,255,.6)">Pulppo · Tu ${a2}</span><img src="${o}/tu2026/pulppo-blanco.png" alt="" style="height:26px"></div>
<div class="pc"><div class="inm">${esc(d.inmobiliaria)}</div><h1>Tu ${a2} en Pulppo</h1><div class="ac"></div>
<div class="meta"><div><div class="tag">Periodo</div>${esc(d.corte)} de ${a2}</div><div><div class="tag">Comparado contra</div>El mismo periodo de ${a1} y ${a0}</div>${kam ? `<div><div class="tag">Preparado por</div>${esc(kam)}</div>` : ''}</div></div>
${rec?.logo ? `<div class="plogo"><img src="${esc(rec.logo)}" alt=""></div>` : ''}
<div class="pie" style="color:rgba(255,255,255,.5)"><span>${esc(d.inmobiliaria)}</span><span>1 / ${total}</span></div></section>`);
    // 2 · números
    L.push(lam(2, 'Tu año en números', `${esc(d.corte)} · contra el mismo periodo de los dos años anteriores`,
        `<div class="g4">${kpi(M('cobrada'), 'Comisión cobrada')}${kpi(cierres, 'Cierres (venta + renta)')}${kpi(M('leads'), 'Leads únicos')}${kpi(M('visitas'), 'Visitas')}</div>
<div class="nota">Leads únicos: misma persona + misma propiedad = 1 lead por mes. Comisión: pagos registrados en Pulppo de las operaciones de la inmobiliaria.</div>`));
    // 3 · mes a mes
    const mm = d.mensual, ix = mm.mejorMes?.i ?? -1;
    const serie = (k: string) => {
        const se = mm.series.find((x) => x.key === k)!, max = Math.max(...se.vals, 1);
        return `<div class="ser"><div class="tag">${esc(se.label)}</div><div class="barras">${se.vals.map((v, i) => `<div class="col">${i === ix || v === max ? `<div class="bv">${fmt(v, se.fmt)}</div>` : ''}<div class="b" style="height:${Math.max(2, Math.round((v / max) * 54))}px;background:${i === ix ? YEL : FAINT}"></div></div>`).join('')}</div></div>`;
    };
    L.push(lam(3, 'Mes a mes', mm.mejorMes ? `Tu mejor mes fue ${mm.mejorMes.mes.toLowerCase()}, en amarillo.${mm.parcial ? ` ${mm.meses[mm.meses.length - 1]}* va hasta el corte.` : ''}` : '',
        `<div class="mm"><div>${serie('leads')}${serie('visitas')}${serie('cierres')}<div class="meses">${mm.meses.map((x, i) => `<div>${x}${mm.parcial && i === mm.meses.length - 1 ? '*' : ''}</div>`).join('')}</div></div>
<div class="lado">${mm.mejorMes ? `<div class="dato"><div class="tag">Mejor mes</div><div class="dv">${mm.mejorMes.mes}</div><div class="ds">${mm.mejorMes.cierres} cierres</div></div>` : ''}
${mm.mayor ? `<div class="dato"><div class="tag">Venta más grande</div><div class="dv">${fmt(mm.mayor.valor, 'money')}</div><div class="ds">${esc([mm.mayor.tipo, mm.mayor.codigo, mm.mayor.fecha].filter(Boolean).join(' · '))}</div></div>` : ''}</div></div>`));
    // 4 · embudo
    const e = d.embudo, top = Math.max(e.pasos[0]?.n ?? 0, 1);
    L.push(lam(4, 'Cómo convierte tu equipo', 'Personas que te escribieron en el periodo y hasta dónde llegaron.',
        `<div class="emb"><div>${e.pasos.map((p, i) => `<div class="paso"><div class="pl"><b>${esc(p.label)}</b><span><span class="pn">${p.n.toLocaleString('es-MX')}</span>${i && e.pasos[i - 1].n ? ` <span class="ps">${fmt(p.n / e.pasos[i - 1].n, 'pct')} del paso anterior</span>` : ''}</span></div><div class="pt"><div style="width:${Math.max(0.6, (100 * p.n) / top)}%;background:${i === e.pasos.length - 1 ? BLK : FAINT}"></div></div></div>`).join('')}</div>
<div class="vs"><div class="vr"><span class="tag">Contra Pulppo</span><span class="tag r">Tú</span><span class="tag r" style="color:${MUTED}">Pulppo</span></div>
${e.tasas.map((t) => { const up = t.yo != null && t.red != null && t.yo > t.red; return `<div class="vr"><span>${esc(t.label)}</span><b class="r" style="color:${up ? SEA : BLK}">${t.yo == null ? '—' : `${up ? '▲ ' : ''}${fmt(t.yo, 'pct')}`}</b><span class="r" style="color:${MUTED}">${fmt(t.red, 'pct')}</span></div>`; }).join('')}
<div class="nota" style="margin-top:10px">Promedio de las inmobiliarias de Pulppo con al menos 30 personas (o 10 que visitaron). Sólo tasas: en volumen no se compara.</div></div></div>`));
    // 5 · inventario
    const inv = d.inventario;
    if (inv) {
        const hoy = inv.hoy.venta + inv.hoy.renta, ene = inv.ene.venta + inv.ene.renta, mx = Math.max(inv.hoy.venta, inv.hoy.renta, inv.ene.venta, inv.ene.renta, 1);
        const br = (v: number, c: string) => `<div class="ib"><div style="width:${(80 * v) / mx}%;background:${c}"></div><b>${v}</b></div>`;
        L.push(lam(5, 'Tu inventario', `Hoy tienes ${hoy.toLocaleString('es-MX')} propiedades publicadas en Pulppo.`,
            `<div class="g3"><div class="kpi gris"><div class="tag">Publicadas hoy</div><div class="big">${hoy}</div><div class="ds">Venta ${inv.hoy.venta} · renta ${inv.hoy.renta}<br>Al 1 de enero: ${ene} (${hoy - ene >= 0 ? '+' : '−'}${Math.abs(hoy - ene)})</div></div>
<div class="kpi gris"><div class="tag">Calidad alta</div><div class="big">${fmt(inv.calidadAlta, 'pct')}</div><div class="ds">De tus fichas publicadas.</div></div>
<div class="kpi gris"><div class="tag">En precio de mercado</div><div class="big">${fmt(inv.enPrecio, 'pct')}</div><div class="ds">Precio «Óptimo» contra las comparables de su zona.</div></div></div>
<div class="inv"><span></span><span class="tag" style="color:${MUTED}">Al 1 de enero</span><span class="tag">Hoy</span><b>Venta</b>${br(inv.ene.venta, FAINT)}${br(inv.hoy.venta, BLK)}<b>Renta</b>${br(inv.ene.renta, FAINT)}${br(inv.hoy.renta, BLK)}</div>
<div class="nota">Calidad y precio son la foto de hoy (Pulppo no guarda su historial). Las publicadas al 1 de enero salen del historial de cada propiedad.</div>`));
    } else L.push(lam(5, 'Tu inventario', '', '<div class="nota">No se pudo calcular el inventario.</div>'));
    // 6 · equipo
    const q = d.equipo, NV: Record<string, string> = { elite: 'Élite', professional: 'Profesional', standard: 'Estándar' };
    L.push(lam(6, 'Tu equipo', `${q.activos} asesores activos hoy.`,
        `<div class="eq"><div class="g2"><div class="kpi gris"><div class="tag">Sin leads 3 meses o más</div><div class="big">${q.sinLeads.length}</div><div class="ds">${esc(q.sinLeads.map((x) => x.nombre).join(', ') || 'Todo el equipo recibe leads.')}</div></div>
<div class="kpi gris"><div class="tag">Tareas vencidas hoy</div><div class="big">${q.tareasVencidas.toLocaleString('es-MX')}</div><div class="ds">${q.tareasPendientes.toLocaleString('es-MX')} pendientes en total.</div></div></div>
<table><thead><tr><th>Asesor</th><th>Leads</th><th>Visitas</th><th>Cierres</th><th>Nivel</th></tr></thead><tbody>
${q.filas.slice(0, 8).map((f) => `<tr><td>${esc(f.nombre)}</td><td>${f.leads.toLocaleString('es-MX')}</td><td>${f.visitas.toLocaleString('es-MX')}</td><td>${f.cierres}</td><td class="mu">${NV[f.nivel]}</td></tr>`).join('')}
</tbody></table>${q.filas.length > 8 ? `<div class="nota" style="grid-column:2">y ${q.filas.length - 8} asesores más.</div>` : ''}</div>`));
    // 7 · logros y faltó
    const lista = (hs: TuAnio['logros'], c: string) => hs.map((h, i) => `<div class="hz" style="border-left-color:${c}"><span class="hn">${i + 1}</span><div><b>${esc(h.titulo)}</b><div>${esc(h.texto)}</div></div></div>`).join('') || '<div class="nota">—</div>';
    L.push(lam(7, 'Lo que funcionó y lo que faltó', `Contra tu propio ${a1} y contra tu arranque de año.`,
        `<div class="g2h"><div><div class="tag" style="color:${SEA};margin-bottom:10px">Logros del año</div>${lista(d.logros, SEA)}</div><div><div class="tag" style="color:${RED};margin-bottom:10px">Lo que faltó para romperla</div>${lista(d.falto, RED)}</div></div>`));
    // 8 · reconocimientos
    const pr = (rec?.premios ?? []).filter((p) => p.podio.length);
    L.push(lam(8, 'Los reconocimientos de tu equipo', 'Quién ganó en cada categoría dentro de tu inmobiliaria. Las cartas y las piezas se descargan desde /mb.',
        pr.length ? `<div class="rec">${pr.map((p) => `<div class="pre"><div class="pt2">${esc(p.titulo)}</div><div class="pw">${esc(p.varios ? p.podio.map((g) => g.nombre).join(', ') : p.podio[0].nombre)}</div><div class="ds">${esc(p.varios ? `${p.podio.length} ${p.podio.length === 1 ? 'ascenso' : 'ascensos'}` : `${p.podio[0].valor}${p.podio[0].detalle ? ` · ${p.podio[0].detalle}` : ''}`)}</div></div>`).join('')}</div>` : '<div class="nota">Sin reconocimientos.</div>'));
    // 9 · plan
    L.push(lam(9, `Plan para arrancar ${a2 + 1}`, 'Los cambios con más impacto para tu equipo.',
        `<div class="plan">${plan.map((p, i) => `<div class="pc2"><div class="pt3"><span>${i + 1}</span> ${esc(p.titulo)}</div>
<div class="tag">Diagnóstico</div><div class="pv">${esc(p.diagnostico)}</div><div class="tag">Acción para enero</div><div class="pv">${esc(p.accion)}</div>
<div class="tag">Meta Q1 ${a2 + 1}</div><div class="pv"><b>${esc(p.meta)}</b></div><div class="tag">Dónde lo medimos</div><div class="pv mu">${esc(p.donde)}</div></div>`).join('')}</div>
<div class="prox"><b>Próximos pasos:</b> sesión de seguimiento ${prox ? `el <b>${esc(prox)}</b>` : '(por definir)'}.</div>`));

    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tu ${a2} · ${esc(d.inmobiliaria)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
@font-face { font-family: 'Heldane'; src: url('${o}/plus/ranking/HeldaneTextRegular.otf'); }
@page { size: 10in 5.625in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; color: ${BLK}; font-family: 'Nunito Sans', Arial, sans-serif; }
.lam { width: 10in; height: 5.625in; position: relative; overflow: hidden; padding: 0.42in 0.62in 0.5in; background: #fff; page-break-after: always; break-after: page; display: flex; flex-direction: column; }
.lam:last-child { page-break-after: auto; break-after: auto; }
.cab { display: flex; justify-content: space-between; align-items: center; height: 26px; }
.cab img { height: 22px; }
.eb, .tag { font-size: 8.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.eb { color: ${MUTED}; }
h2 { font-family: 'Heldane', 'EB Garamond', serif; font-weight: 400; font-size: 26pt; line-height: 1.1; margin: 16px 0 0; }
.ac { width: 46px; height: 3px; background: ${YEL}; margin: 8px 0 6px; }
.sub { font-size: 10.5pt; color: ${MUTED}; }
.cuerpo { flex: 1; margin-top: 14px; min-height: 0; }
.pie { position: absolute; left: 0.62in; right: 0.62in; bottom: 0.22in; display: flex; justify-content: space-between; font-size: 8.5pt; color: ${MUTED}; }
.nota { font-size: 8.5pt; color: ${MUTED}; margin-top: 12px; line-height: 1.4; }
.ds { font-size: 9pt; color: ${MUTED}; line-height: 1.35; margin-top: 4px; }
.mu { color: ${MUTED}; }
.portada { background: ${BLK}; color: #fff; }
.portada .pc { margin-top: 0.85in; }
.portada .inm { color: ${YEL}; font-size: 11pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.portada h1 { font-family: 'Heldane', 'EB Garamond', serif; font-weight: 400; font-size: 46pt; margin: 14px 0 0; line-height: 1.05; }
.portada .ac { width: 80px; margin: 14px 0 26px; }
.portada .meta { display: flex; gap: 0.5in; font-size: 11pt; }
.portada .meta .tag { color: rgba(255,255,255,.55); margin-bottom: 4px; }
.plogo { position: absolute; right: 0.62in; bottom: 0.6in; background: #fff; padding: 10px 14px; }
.plogo img { max-height: 46px; max-width: 170px; display: block; }
.g4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-content: start; }
.kpi { border: 0.5pt solid ${LINE}; padding: 12px 14px; }
.kpi.gris { background: ${LGT}; border: none; }
.big { font-family: 'Heldane', 'EB Garamond', serif; font-size: 26pt; line-height: 1.1; margin-top: 8px; }
.ch { font-size: 9pt; font-weight: 700; }
.tres { display: flex; gap: 6px; align-items: flex-end; margin-top: 14px; }
.tres > div { flex: 1; text-align: center; }
.tv { font-size: 7.5pt; color: ${MUTED}; margin-bottom: 2px; white-space: nowrap; }
.tb { width: 100%; }
.ty { font-size: 7.5pt; color: ${MUTED}; border-top: 0.5pt solid ${LINE}; margin-top: 2px; padding-top: 2px; }
.mm { display: grid; grid-template-columns: 1fr 2.1in; gap: 0.35in; }
.ser { margin-bottom: 8px; }
.barras { display: flex; gap: 5px; align-items: flex-end; height: 70px; margin-top: 3px; }
.col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
.bv { font-size: 7.5pt; font-weight: 700; text-align: center; }
.meses { display: flex; gap: 5px; border-top: 0.5pt solid ${LINE}; padding-top: 3px; }
.meses div { flex: 1; text-align: center; font-size: 7.5pt; color: ${MUTED}; }
.lado .dato { border-left: 3px solid ${YEL}; padding: 2px 0 2px 12px; margin-bottom: 16px; }
.dv { font-family: 'Heldane', 'EB Garamond', serif; font-size: 18pt; margin-top: 4px; }
.emb { display: grid; grid-template-columns: 1fr 3.4in; gap: 0.4in; }
.paso { margin-bottom: 12px; }
.pl { display: flex; justify-content: space-between; align-items: baseline; font-size: 10pt; }
.pn { font-family: 'Heldane', 'EB Garamond', serif; font-size: 15pt; }
.ps { font-size: 8.5pt; color: ${MUTED}; }
.pt { background: ${LGT}; height: 12px; margin-top: 3px; }
.pt div { height: 100%; }
.vs { border: 0.5pt solid ${LINE}; padding: 12px 16px; align-self: start; }
.vr { display: grid; grid-template-columns: 1fr 70px 70px; padding: 7px 0; border-bottom: 0.5pt solid ${LINE}; font-size: 10pt; }
.r { text-align: right; }
.inv { display: grid; grid-template-columns: 0.7in 1fr 1fr; gap: 6px 16px; align-items: center; margin-top: 16px; font-size: 10pt; max-width: 6.6in; }
.ib { display: flex; align-items: center; gap: 8px; }
.ib div { height: 11px; }
.eq { display: grid; grid-template-columns: 3.1in 1fr; gap: 0.35in; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { font-size: 8pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: right; border-bottom: 1pt solid ${BLK}; padding: 4px 0 4px 10px; }
td { text-align: right; padding: 5px 0 5px 10px; border-bottom: 0.5pt solid ${LINE}; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
td:first-child { font-weight: 700; }
.g2h { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35in; }
.hz { display: flex; gap: 10px; background: ${LGT}; border-left: 3px solid; padding: 9px 12px; margin-bottom: 8px; font-size: 9.5pt; line-height: 1.35; }
.hn { font-family: 'Heldane', 'EB Garamond', serif; font-size: 17pt; color: ${MUTED}; line-height: 1; }
.rec { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.pre { border-top: 2px solid ${YEL}; background: ${LGT}; padding: 10px 12px; }
.pt2 { font-family: 'Heldane', 'EB Garamond', serif; font-size: 13pt; }
.pw { font-size: 10pt; font-weight: 700; margin-top: 6px; }
.plan { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.pc2 { border: 0.5pt solid ${LINE}; border-top: 3px solid ${SEA}; padding: 10px 12px; }
.pt3 { font-size: 11pt; font-weight: 700; margin-bottom: 6px; }
.pt3 span { font-family: 'Heldane', 'EB Garamond', serif; font-size: 16pt; color: ${SEA}; font-weight: 400; }
.pc2 .tag { font-size: 7pt; color: ${MUTED}; margin-top: 6px; }
.pv { font-size: 9pt; line-height: 1.35; margin-top: 2px; }
.prox { margin-top: 12px; border-top: 0.5pt solid ${LINE}; padding-top: 8px; font-size: 10pt; }
@media screen { body { background: ${LGT}; } .lam { margin: 20px auto; box-shadow: 0 0 0 0.5px ${LINE}; } }
</style></head><body>${L.join('\n')}
<script>Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => setTimeout(() => window.print(), 300));</script>
</body></html>`);
    w.document.close();
}
