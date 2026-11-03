// Reglas comunes de /mb (Overview, Propiedades, Generador), alineadas con Desempeño y /portales
// (Ale, oct-2026). Un número de /mb tiene que decir lo mismo en todas las pestañas:
//   · LEADS ÚNICOS: mismo contacto + misma propiedad = 1 lead (como Desempeño / el reporte de Lau).
//     De la inmobiliaria = el lead trae su compañía O es de una propiedad suya (cualquier estatus): ~2% de
//     los leads llegan sin `company` (WhatsApp) y se perdían. Sin «formulario de contacto» (bots, regla
//     de /portales). Un solo cargador para Marketing y Consultas (leadsUnicos), nov-2026: daban 137 vs 133.
//   · PERIODOS en días de calendario hora México: «últimos 7 días» = de las 00:00 de hace 6 días a ahora,
//     y el periodo anterior = el mismo tramo N días antes, cortado a la misma hora (periodoAnterior).
//   · ATENCIÓN (sin responder, 1ª respuesta): sólo leads que entraron de 8 am a 8 pm hora México y
//     del periodo elegido — de madrugada nadie contesta y el histórico esconde cómo va hoy.
//   · VISITAS: por fecha de la visita (startTime), confirmadas + pendientes.
//   · CIERRES: los de Desempeño (cierresMb): los dos lados, sin duplicar, por fecha de cierre, con la
//     comisión COBRADA del lado de la inmobiliaria.
import { ObjectId, type Db, type Document } from 'mongodb';
import { cierresMb, grupoDe, type CierreMb } from './desempenoMb';

const MX_MS = 6 * 3600 * 1000;
/** el lead entró en horario de atención (8 am – 8 pm hora México, UTC−6 fijo) */
export const enHorario = (d: Date) => { const h = new Date(d.getTime() - MX_MS).getUTCHours(); return h >= 8 && h <= 19; };
/** llave de lead único: contacto + propiedad (si falta alguno, el lead cuenta solo) */
export const claveLead = (l: Document) => {
    const c = (l.contact as Document | undefined)?._id, p = (l.property as Document | undefined)?._id;
    return c && p ? `${String(c)}|${String(p)}` : String(l._id);
};
const DIA_MS = 86400000;
/** 00:00 hora México del día de `d`, `n` días antes */
export const inicioDiaMx = (d: Date, n = 0) => {
    const x = new Date(d.getTime() - MX_MS);
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - n) + MX_MS);
};
/** el mismo tramo `dias` días antes (el actual puede ir a medias: hoy hasta esta hora) */
export const periodoAnterior = (desde: Date, hasta: Date, dias: number) =>
    ({ desde: new Date(desde.getTime() - dias * DIA_MS), hasta: new Date(hasta.getTime() - dias * DIA_MS) });
/** spam de bots (regla de /portales): no cuenta en ningún lado */
export const esSpamLead = (l: Document) => String(l.source ?? '').trim().toLowerCase() === 'formulario de contacto';

/** LEADS ÚNICOS de la inmobiliaria creados en [desde, hasta): la primera vez que esa persona escribió sobre esa
 *  propiedad, mirando `historiaDias` hacia atrás. Trae siempre createdAt, source, contact._id y property._id. */
export async function leadsUnicos(db: Db, comps: ObjectId[], desde: Date, hasta: Date, projection: Document = {}, historiaDias = 400): Promise<Document[]> {
    const props = (await db.collection('properties').find({ 'company._id': { $in: comps } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
    const vistos = new Set<string>();
    const out: Document[] = [];
    for await (const l of db.collection('leads').find(
        { $or: [{ 'company._id': { $in: comps } }, { 'property._id': { $in: props } }], createdAt: { $gte: new Date(desde.getTime() - historiaDias * DIA_MS), $lt: hasta } },
        { projection: { ...projection, createdAt: 1, source: 1, 'contact._id': 1, 'property._id': 1 } }).sort({ createdAt: 1 })) {
        if (!(l.createdAt instanceof Date) || esSpamLead(l)) continue;
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (l.createdAt >= desde) out.push(l);
    }
    return out;
}
/** estados de visita que cuentan */
export const VISITA_OK = ['confirmed', 'pending'];

/** Cierres de la inmobiliaria en [A, B): los MISMOS que Desempeño (incluye las compañías con el mismo nombre). */
export async function cierresInmobiliaria(companyId: string, A: Date, B: Date): Promise<CierreMb[]> {
    const g = await grupoDe(companyId);
    return cierresMb(g.ids.map((s) => new ObjectId(s)), new Set(g.ids), A, B, null);
}
/** del lado vendedor (la propiedad es de la inmobiliaria): se le asigna a su fila en el listado */
export const ladoVendedor = (c: CierreMb) => c.lado === 'Vendedor' || c.lado === 'Ambos';
