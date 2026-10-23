// Avisos vivos en un periodo, para el L/L (leads sobre listing) de /portales (Ale, oct-2026).
//
// «L/L tiene que ser del total de avisos que hubo en el periodo, no la foto de hoy» (Joshua, DH). Así que,
// para Inmuebles24, se cuenta CADA DÍA a mediodía (hora de México) qué propiedades estaban publicadas en
// Pulppo (`status.history`) y en qué nivel estaba su aviso (`portals.inmuebles24.history`: tipo y cuenta).
// El promedio de avisos = aviso-días ÷ días del periodo. OFFLINE no cuenta (bug de i24).
//   · canal: `i24` · `i24nura` (inmobiliaria NURA, su propio paquete) · `i24premier` (cuenta ANUNCIO_PREMIERE,
//     la cuenta premier de Diamond House desde el 22-oct-2026).
//   · tipo: súper destacado / destacado (y sus «zona demand») / simple, y «Súper destacado · Premier».
// 🔴 Leer el historial completo de la red tarda ~70 s (41k propiedades): el recorte por periodo se hace EN
// MONGO ($convert + $filter + $reduce) y sólo viaja lo del periodo y el último registro anterior.
// MercadoLibre, propiedades.com y Casas y Terrenos no guardan historial: van con la foto de HOY (`hoy: true`).
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../data';

import { CUENTA_PREMIER, TIPO_MELI, tipoI24, type AvisosPeriodo } from './avisosTipos';
export type { AvisosPeriodo };
const DIA = 86400000;

export async function avisosDelPeriodo(A: Date, B: Date, opc: { ids: ObjectId[] | null; operacion: 'todas' | 'sale' | 'rent'; esNura: (n: unknown) => boolean }): Promise<AvisosPeriodo> {
    const db = await getDb();
    const fin = Math.min(B.getTime(), Date.now());
    const nDias = Math.max(1, Math.round((fin - A.getTime()) / DIA));
    const base: Document = {
        ...(opc.ids ? { 'company._id': { $in: opc.ids } } : {}),
        ...(opc.operacion === 'todas' ? {} : { 'listing.operation': opc.operacion }),
    };
    const fecha = (x: string) => ({ $convert: { input: x, to: 'date', onError: null, onNull: null } });
    const ultimoAntes = (arr: string) => ({ $reduce: { input: arr, initialValue: null, in: { $cond: [
        { $and: [{ $ne: ['$$this.t', null] }, { $lt: ['$$this.t', A] }, { $or: [{ $eq: ['$$value', null] }, { $gt: ['$$this.t', '$$value.t'] }] }] }, '$$this', '$$value'] } } });
    const enVentana = (arr: string) => ({ $filter: { input: arr, as: 'e', cond: { $and: [{ $gte: ['$$e.t', A] }, { $lt: ['$$e.t', B] }] } } });

    const tiposI24: Record<string, number> = {}, canalesI24: Record<string, number> = {};
    const cur = db.collection('properties').aggregate([
        { $match: { ...base, 'portals.inmuebles24.history.0': { $exists: true } } },
        { $project: {
            cn: '$company.name',
            h: { $map: { input: '$portals.inmuebles24.history', as: 'e', in: { t: fecha('$$e.timestamp'), ty: '$$e.type', c: '$$e.company' } } },
            s: { $map: { input: { $ifNull: ['$status.history', []] }, as: 'e', in: { t: fecha('$$e.timestamp'), st: '$$e.status' } } },
        } },
        { $project: { cn: 1, hw: enVentana('$h'), hp: ultimoAntes('$h'), sw: enVentana('$s'), sp: ultimoAntes('$s') } },
        // sólo lo que pudo estar publicado en el periodo
        { $match: { $or: [{ 'sw.0': { $exists: true } }, { 'sp.st': 'published' }] } },
    ], { allowDiskUse: true });
    for await (const p of cur) {
        const nura = opc.esNura(p.cn);
        const h = [...(p.hp ? [p.hp] : []), ...((p.hw as Document[]) ?? [])].filter((e) => e.t).sort((a, b) => a.t - b.t);
        const s = [...(p.sp ? [p.sp] : []), ...((p.sw as Document[]) ?? [])].filter((e) => e.t).sort((a, b) => a.t - b.t);
        if (!h.length || !s.length) continue;
        let iH = -1, iS = -1;
        for (let k = 0; k < nDias; k++) {
            const tk = A.getTime() + k * DIA + 18 * 3600 * 1000;   // mediodía MX (los cortes de /portales van en días UTC)
            if (tk > fin) break;
            while (iH + 1 < h.length && h[iH + 1].t.getTime() <= tk) iH++;
            while (iS + 1 < s.length && s[iS + 1].t.getTime() <= tk) iS++;
            if (iH < 0 || iS < 0 || s[iS].st !== 'published') continue;
            const tipo = tipoI24(h[iH].ty, h[iH].c);
            if (!tipo) continue;
            tiposI24[tipo] = (tiposI24[tipo] ?? 0) + 1;
            const canal = String(h[iH].c ?? '').toUpperCase() === CUENTA_PREMIER ? 'i24premier' : nura ? 'i24nura' : 'i24';
            canalesI24[canal] = (canalesI24[canal] ?? 0) + 1;
        }
    }

    // foto de hoy para los portales sin historial
    const meliHoy: Record<string, number> = {}, hoy: Record<string, number> = {};
    for (const r of await db.collection('properties').aggregate([
        { $match: { ...base, 'status.last': 'published', 'portals.mercadolibre.status': 'ONLINE' } },
        { $group: { _id: '$portals.mercadolibre.type', n: { $sum: 1 } } }]).toArray()) {
        const t = TIPO_MELI[String(r._id).toLowerCase()];
        if (t) { meliHoy[t] = (meliHoy[t] ?? 0) + r.n; hoy.meli = (hoy.meli ?? 0) + r.n; }
    }
    const [pcom, cyt] = await Promise.all([
        db.collection('properties').countDocuments({ ...base, 'status.last': 'published', 'portals.propiedadesDotCom.status': 'ONLINE' }),
        db.collection('properties').countDocuments({ ...base, 'status.last': 'published', 'portals.casas-y-terrenos.status': 'ONLINE' }),
    ]);
    hoy.propiedades = pcom; hoy.cyt = cyt;
    return { dias: nDias, tiposI24, canalesI24, meliHoy, hoy };
}
