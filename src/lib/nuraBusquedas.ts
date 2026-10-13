// Búsquedas de NURA (/mb → Búsquedas, sólo en NURA). Oct-2026.
//
// Port EXACTO de `extraccion/nura_busquedas.py` del hand-over de Sofía («nura-busquedas-dashboard»),
// que replica la pregunta de Metabase «NURA - BUSQUEDAS» (su liga pública se corta en 2,000 filas;
// aquí salen todas). Una fila por búsqueda; todas las métricas se calculan en el navegador.
//
// Trampas ya resueltas (README del hand-over):
//   · En `searches`, `agent.company._id` es ObjectId, no texto: con el string regresa 0 filas.
//   · Hay TRES compañías llamadas «Nura»; la buena es 69ea8f6d35a3ebb3a075d405 («NURA», la única con
//     inventario publicado). No filtrar por nombre.
//   · `lastSuggested` = 2022-01-01 es un valor por defecto (nunca se sugirió nada): antes de 2024 → vacío.
//   · `source` viene con mayúsculas y variantes: se pasa a minúsculas y se unifican nombres.
//   · La operación no está en la búsqueda: es la más frecuente en properties[].listing.operation; sin
//     propiedades → «sin dato».
//   · Fechas en hora de México (UTC−6 fijo, igual que el resto del repo y que Metabase).
import { ObjectId } from 'mongodb';
import { getDb } from './data';
import { NURA_ID } from './nura';

export { NURA_ID };

export interface BusquedaNura {
    id: string;
    creada: string | null; cancelada: string | null; actualizada: string | null;
    ultimaSugerencia: string | null; ultimoSeguimiento: string | null;
    creadaPor: string | null;
    estatus: string | null; motivo: string; descripcion: string;
    fuente: string; asesor: string;
    cliente: string; clienteTelefono: string | null; clienteEmail: string | null;
    operacion: string;
    valor: number; propiedades: number; visitas: number;
    /** etapas alcanzadas ALGUNA vez (historial), para el embudo */
    llegoVisita: 0 | 1; llegoOferta: 0 | 1; completada: 0 | 1;
}

const MX = 6 * 3600 * 1000;
type D = Record<string, unknown>;
const isDate = (v: unknown): v is Date => v instanceof Date && !isNaN(v.getTime());
const fmt = (d: unknown) => (isDate(d) ? new Date(d.getTime() - MX).toISOString().slice(0, 10) : null);
// lastSuggested trae 2022-01-01 como valor por defecto cuando nunca se sugirió nada
const fmtSug = (d: unknown) => (isDate(d) && d.getUTCFullYear() >= 2024 ? fmt(d) : null);
const normSource = (s: unknown) => {
    const t = (String(s ?? '').trim() || 'sin fuente').toLowerCase();
    return ({ inmuebles24: 'inmuebles 24', contactodirecto: 'contacto directo' } as Record<string, string>)[t] ?? t;
};
// round() de Python redondea los ,5 al par («banker's rounding»); Math.round siempre hacia arriba. Se
// iguala para que el valor buscado cuadre al peso con el script de Sofía.
const redondeaPar = (x: number) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
const nombre = (p: unknown) => `${String((p as D | undefined)?.firstName ?? '')} ${String((p as D | undefined)?.lastName ?? '')}`.trim();

export async function busquedasNura(): Promise<BusquedaNura[]> {
    const db = await getDb();
    const docs = db.collection('searches').find({ 'agent.company._id': new ObjectId(NURA_ID) }, { projection: {
        createdAt: 1, updatedAt: 1, cancelledAt: 1, lastFollowUp: 1, lastSuggested: 1, createdBy: 1, status: 1, source: 1,
        'agent.firstName': 1, 'agent.lastName': 1, 'contact.firstName': 1, 'contact.lastName': 1, 'contact.phone': 1, 'contact.email': 1,
        metrics: 1, 'properties.listing.operation': 1,
    } });
    const rows: BusquedaNura[] = [];
    for await (const d of docs) {
        const st = (d.status as D | undefined) ?? {};
        const hist = new Set([...(((st.history as D[] | undefined) ?? []).map((h) => h?.status)), st.last]);
        // operación más frecuente entre sus propiedades (empate → la primera que llegó al conteo, como Counter)
        const ops = new Map<string, number>();
        for (const p of (d.properties as D[] | undefined) ?? []) {
            const op = (p?.listing as D | undefined)?.operation;
            if (op != null) ops.set(String(op), (ops.get(String(op)) ?? 0) + 1);
        }
        let operacion = 'sin dato', max = 0;
        for (const [k, n] of ops) if (n > max) { operacion = k; max = n; }
        const m = (d.metrics as D | undefined) ?? {};
        const contact = (d.contact as D | undefined) ?? {};
        rows.push({
            id: String(d._id),
            creada: fmt(d.createdAt), cancelada: fmt(d.cancelledAt), actualizada: fmt(d.updatedAt),
            ultimaSugerencia: fmtSug(d.lastSuggested), ultimoSeguimiento: fmt(d.lastFollowUp),
            creadaPor: (d.createdBy as string) ?? null,
            estatus: (st.last as string) ?? null,
            motivo: (st.reasonToFinish as string) || '',
            descripcion: String(st.description ?? '').split(/\s+/).filter(Boolean).join(' '),
            fuente: normSource(d.source),
            asesor: nombre(d.agent) || 'Sin asesor',
            cliente: nombre(contact),
            clienteTelefono: (contact.phone as string) ?? null, clienteEmail: (contact.email as string) ?? null,
            operacion,
            valor: redondeaPar(Number(m.value) || 0),
            propiedades: Number((m.properties as D | undefined)?.total ?? 0) || 0,
            visitas: Number((m.visits as D | undefined)?.total ?? 0) || 0,
            llegoVisita: ['visiting', 'offer_done', 'completed'].some((x) => hist.has(x)) ? 1 : 0,
            llegoOferta: ['offer_done', 'completed'].some((x) => hist.has(x)) ? 1 : 0,
            completada: st.last === 'completed' ? 1 : 0,
        });
    }
    return rows;
}
