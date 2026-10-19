// Exclusivas que alguien MÁS está publicando (/mb → Resumen, después de «¡Ojo con estas!»).
//
// Parte de cada propiedad publicada de la inmobiliaria con exclusiva VIGENTE (`contract.exclusive.start` +
// `durationMonths` sin vencer) y busca el mismo inmueble con `duplicadosDe` (la regla del expediente). Sólo
// cuenta lo que de verdad choca con la exclusiva:
//   · «Muy probable» (superficie y precio ±3%, misma calle o ≤300 m), no «posible».
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
            const dups = (await duplicadosDe(P).catch(() => [])).filter((d) => d.nivel === 'Muy probable'
                // otra propiedad de la MISMA inmobiliaria es la misma cargada dos veces, no «alguien más»
                && (d.origen === 'pulppo' ? d.quien.split(' · ')[0].trim().toLowerCase() !== mia
                    : d.actualizado != null && now - Date.parse(d.actualizado) <= 90 * DIA));
            const desarrollo = Boolean(s(P.development?.name)) || dups.length >= 4;
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
