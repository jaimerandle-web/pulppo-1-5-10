// Exclusivas que alguien MÁS está publicando (/mb → Resumen, después de «¡Ojo con estas!»).
//
// Parte de cada propiedad publicada de la inmobiliaria con exclusiva VIGENTE (`contract.exclusive.start` +
// `durationMonths` sin vencer) y busca el mismo inmueble con `duplicadosDe` (la regla del expediente). Sólo
// cuenta lo que de verdad choca con la exclusiva:
//   · «Muy probable» (superficie y precio ±3%, misma calle o ≤300 m), no «posible».
//   · y además la MISMA CALLE (o el mismo edificio: misma calle y mismo número). La cercanía sola ya no
//     basta y un aviso sin calle no sale (nov-2026, queja de Diamond House: «ni siquiera está en la misma
//     calle»). Ver `mismaCalleEstricta`.
//   · del mercado, sólo avisos actualizados en los últimos 90 días: el 40% del MLS de CDMX lleva más sin
//     moverse y puede ser un aviso que ya no existe.
//   · ni la propia inmobiliaria con su cuenta en otro portal ni el mismo asesor (lo filtra duplicadosDe).
//   · fuera los desarrollos (`development.name`, o 4+ copias): ahí «el mismo inmueble» suele ser otra unidad
//     idéntica del mismo edificio, no la misma.
// Medido oct-2026 en toda la red: 70 exclusivas de 673, sólo 8 con contrato firmado. HS Real Estate marca el
// 41% de su inventario como exclusiva y no tiene ninguna firmada.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { duplicadosDe } from './duplicados';

export interface OtroQuePublica { quien: string; donde: string; precio: number | null; url: string | null; deLaRed: boolean }
export interface ExclusivaEnConflicto {
    code: string; id: string; calle: string; colonia: string; asesor: string; precio: number | null; operacion: 'Venta' | 'Renta';
    exclusivaDesde: string; exclusivaHasta: string | null;
    /** estado del documento del contrato: el punto es que casi ninguna está firmada */
    contrato: string; firmado: boolean;
    otros: OtroQuePublica[];
}

const DOC: Record<string, string> = {
    completed: 'firmado', pending: 'sin documento', revision: 'en revisión', approved: 'aprobado, sin enviar a firma',
    contract_sent: 'enviado a firma, sin firmar', rejected: 'rechazado',
};
const DIA = 86400000;
const s = (x: unknown) => String(x ?? '').trim();
const fecha = (x: unknown): Date | null => (x instanceof Date && !isNaN(x.getTime()) ? x : typeof x === 'string' && !isNaN(Date.parse(x)) ? new Date(x) : null);

// ── Misma calle, en serio ─────────────────────────────────────────────────────────────────────────────
// `duplicadosDe` da «Muy probable» con la misma calle O a ≤300 m. Para el expediente sirve; aquí no: la
// sección le dice a la inmobiliaria «alguien más publica TU exclusiva», y a 300 m en la Roma hay otra
// calle y otro edificio (nov-2026, Diamond House: DAS-715 en Tehuantepec 209 salía contra un aviso en
// Aguascalientes, a 169 m). Aquí se exige la MISMA CALLE (o el mismo edificio, que es la misma calle con el
// mismo número) y, si los dos traen número exterior y no coincide, es otro edificio. Sin calle, no sale; la
// colonia o el fraccionamiento capturado como calle no cuenta, y la misma calle a más de 1 km tampoco.
// (El «mismo edificio a ≤40 m con el mismo nombre de desarrollo» no aplica: las exclusivas con
// `development.name` ya se excluyen abajo.)
const PREFIJOS = /^(calle|c|cll|av|ave|avda|avenida|blvd|blvr|bulevar|boulevard|paseo|pso|calzada|calz|privada|priv|pvda|cerrada|cda|prolongacion|prol|circuito|cto|andador|retorno|ret|callejon|cjon)$/;
// lo que va después del número: interior, depto, piso, colonia…
const COLA = /\b(int|interior|depto|dpto|departamento|piso|ph|torre|edificio|edif|local|casa|col|colonia|cp|c p|mz|lt|esq|esquina|entre)\b.*$/;
function partirCalle(x: unknown): { key: string; num: string | null } {
    let t = s(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[#º°]/g, ' ').replace(/\bno\.\s*/g, ' ').replace(/\b(num|numero)\b\.?/g, ' ')
        .replace(/[.,;:()\-/]+/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(COLA, '').trim();
    const palabras = t.split(' ').filter(Boolean);
    while (palabras.length > 1 && PREFIJOS.test(palabras[0])) palabras.shift();
    // número exterior = el primer número después del nombre («Tehuantepec 209», «Insurgentes Sur 1234 B»);
    // el de «Eje 5 Sur» es parte del nombre. Lo que sigue al número ya no es la calle.
    let num: string | null = null;
    const nombre: string[] = [];
    for (const [i, w] of palabras.entries()) {
        if (i > 0 && /^\d+[a-z]?$/.test(w) && palabras[i - 1] !== 'eje') { num = w.replace(/[a-z]$/, ''); break; }
        nombre.push(w);
    }
    const key = nombre.join(' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { key, num };
}
/** ¿Es la misma calle (y, si los dos traen número, el mismo número)? `mias` = calle real y calle pública;
 *  `colonia`: si la «calle» es el nombre de la colonia o fraccionamiento («Itzimná», «Lomas Country Club»), no
 *  es calle y no cuenta. */
function mismaCalleEstricta(mias: unknown[], suya: unknown, colonia: unknown): boolean {
    const b = partirCalle(suya);
    if (b.key.length < 4) return false;
    const col = partirCalle(colonia).key;
    if (col && (b.key === col || /^(fraccionamiento|fracc|residencial|condominio|conjunto)\b/.test(b.key))) return false;
    const nuestras = mias.map(partirCalle).filter((a) => a.key.length >= 4);
    const calleOk = (a: string, c: string) => a === c
        // «Campos Eliseos» vs «Campos Eliseos Polanco»: la corta tiene que ser un nombre completo (2+ palabras o 8+ letras)
        || ((a.startsWith(c + ' ') || c.startsWith(a + ' ')) && Math.min(a.length, c.length) >= 8);
    const misma = nuestras.filter((a) => calleOk(a.key, b.key));
    if (!misma.length) return false;
    const nums = misma.map((a) => a.num).filter((x): x is string => x != null);
    return b.num == null || !nums.length || nums.includes(b.num);
}

export async function exclusivasEnConflicto(companyId: string): Promise<ExclusivaEnConflicto[]> {
    const db = await getDb();
    const props = await db.collection('properties').find(
        { 'company._id': new ObjectId(companyId), 'status.last': 'published', 'contract.exclusive.start': { $exists: true, $ne: null } },
    ).toArray();
    const now = Date.now();
    const vigentes = props.filter((p) => {
        const ini = fecha(p.contract?.exclusive?.start);
        const dur = p.contract?.exclusive?.durationMonths;
        if (!ini) return false;
        if (typeof dur !== 'number' || dur <= 0) return true;
        return Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + dur, ini.getUTCDate()) >= now;
    });

    const out: ExclusivaEnConflicto[] = [];
    // de a 6 en paralelo: cada una son 4 consultas indexadas (geo + colonia, en mls y properties)
    for (let i = 0; i < vigentes.length; i += 6) {
        const lote = await Promise.all(vigentes.slice(i, i + 6).map(async (P: Document) => {
            const mia = s(P.company?.name).toLowerCase();
            const muyProbables = (await duplicadosDe(P).catch(() => [])).filter((d) => d.nivel === 'Muy probable'
                // otra propiedad de la MISMA inmobiliaria es la misma cargada dos veces, no «alguien más»
                && (d.origen === 'pulppo' ? d.quien.split(' · ')[0].trim().toLowerCase() !== mia
                    : d.actualizado != null && now - Date.parse(d.actualizado) <= 90 * DIA));
            // 4+ copias = desarrollo: se cuenta ANTES de exigir la calle, como siempre
            const desarrollo = Boolean(s(P.development?.name)) || muyProbables.length >= 4;
            // la misma calle (o el mismo edificio); sin calle del otro lado, no sale. Y aun con la misma calle,
            // a más de 1 km (si los dos traen coordenadas) es otro tramo: Temozón Norte salía a 10 km.
            const dups = muyProbables.filter((d) => mismaCalleEstricta([P.address?.street, P.address?.publicStreet], d.calle, P.address?.neighborhood?.name)
                && !(d.distancia != null && d.distancia > 1000));
            if (!dups.length || desarrollo) return null;
            const ini = fecha(P.contract.exclusive.start)!;
            const dur = P.contract.exclusive.durationMonths;
            const fin = typeof dur === 'number' && dur > 0 ? new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + dur, ini.getUTCDate())) : null;
            const st = s(P.contract?.status);
            return {
                code: s(P.internalId) || String(P._id).slice(-8), id: String(P._id),
                calle: s(P.address?.street), colonia: s(P.address?.neighborhood?.name),
                asesor: [P.agent?.firstName, P.agent?.lastName].map(s).filter(Boolean).join(' '),
                precio: typeof P.listing?.value === 'number' ? P.listing.value : null,
                operacion: P.listing?.operation === 'rent' ? 'Renta' : 'Venta',
                exclusivaDesde: ini.toISOString(), exclusivaHasta: fin ? fin.toISOString() : null,
                contrato: DOC[st] ?? (st || 'sin documento'), firmado: st === 'completed',
                // de la red: sólo el nombre de la inmobiliaria, nunca su contrato ni su comisión
                otros: dups.map((d) => ({
                    quien: d.origen === 'pulppo' ? d.quien.split(' · ')[0] : d.quien,
                    donde: d.origen === 'pulppo' ? 'Pulppo' : d.portal, precio: d.precio, url: d.url, deLaRed: d.origen === 'pulppo',
                })),
            } satisfies ExclusivaEnConflicto;
        }));
        for (const x of lote) if (x) out.push(x);
    }
    // primero las de la red (dos inmobiliarias de Pulppo peleando la misma), luego las que más copias tienen
    return out.sort((a, b) => Number(b.otros.some((o) => o.deLaRed)) - Number(a.otros.some((o) => o.deLaRed)) || b.otros.length - a.otros.length);
}
