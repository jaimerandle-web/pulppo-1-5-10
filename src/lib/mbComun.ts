// Reglas comunes de /mb (Overview, Propiedades, Generador), alineadas con Desempeño y /portales
// (Ale, oct-2026). Un número de /mb tiene que decir lo mismo en todas las pestañas:
//   · LEADS ÚNICOS: mismo contacto + misma propiedad = 1 lead (como Desempeño / el reporte de Lau).
//   · ATENCIÓN (sin responder, 1ª respuesta): sólo leads que entraron de 9:00 a 20:59 hora México y
//     del periodo elegido — de madrugada nadie contesta y el histórico esconde cómo va hoy.
//   · VISITAS: por fecha de la visita (startTime), confirmadas + pendientes.
//   · CIERRES: los de Desempeño (cierresMb): los dos lados, sin duplicar, por fecha de cierre, con la
//     comisión COBRADA del lado de la inmobiliaria.
import { ObjectId, type Document } from 'mongodb';
import { cierresMb, grupoDe, type CierreMb } from './desempenoMb';

const MX_MS = 6 * 3600 * 1000;
/** el lead entró en horario de atención (9:00–20:59 hora México, UTC−6 fijo) */
export const enHorario = (d: Date) => { const h = new Date(d.getTime() - MX_MS).getUTCHours(); return h >= 9 && h <= 20; };
/** llave de lead único: contacto + propiedad (si falta alguno, el lead cuenta solo) */
export const claveLead = (l: Document) => {
    const c = (l.contact as Document | undefined)?._id, p = (l.property as Document | undefined)?._id;
    return c && p ? `${String(c)}|${String(p)}` : String(l._id);
};
/** estados de visita que cuentan */
export const VISITA_OK = ['confirmed', 'pending'];

/** Cierres de la inmobiliaria en [A, B): los MISMOS que Desempeño (incluye las compañías con el mismo nombre). */
export async function cierresInmobiliaria(companyId: string, A: Date, B: Date): Promise<CierreMb[]> {
    const g = await grupoDe(companyId);
    return cierresMb(g.ids.map((s) => new ObjectId(s)), new Set(g.ids), A, B, null);
}
/** del lado vendedor (la propiedad es de la inmobiliaria): se le asigna a su fila en el listado */
export const ladoVendedor = (c: CierreMb) => c.lado === 'Vendedor' || c.lado === 'Ambos';
