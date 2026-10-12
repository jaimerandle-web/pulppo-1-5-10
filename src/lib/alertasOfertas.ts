// Alertas de ofertas 1·5·10 para el grupo de Google Chat (el del bot del formulario).
//
// **Quién manda el mensaje NO es este código.** Vercel Hobby sólo permite un cron al día, y el
// aviso de una oferta sirve el mismo día. Por eso el disparador vive en el Apps Script del Sheet
// de Control (trigger cada 15 min, gratis): llama a /api/alertas/ofertas, compara contra la
// pestaña "Log ofertas" y manda al webhook sólo lo nuevo. Aquí sólo se lee Mongo y se arma el texto.
// Mongo es read-only, así que la memoria de "qué ya se avisó" tiene que vivir en el Sheet.
//
// **Qué se avisa (decisión de Ale, 12-oct-2026):**
//   aceptada   `operations.status.history` entra a `offer_blocked` = "Oferta aceptada". La oferta
//              suelta (`offer`) NO se avisa a propósito.
//   cerrada    entra a `closed`. NO se usa `paying` ni `properties.status.last='completed'`.
//   caida      entra a `cancelled` una operación que YA había sido aceptada. Una oferta que se
//              cancela sin haber llegado a aceptada es ruido (nunca se avisó), no se cae nada.
//
// Universo 1·5·10 = `properties.contract.exclusive.pulppo != null` (la marca de Mongo, no el check
// del tool). Una operación puede nacer directo en `offer_blocked` o en `closed`: el historial a
// veces trae una sola entrada, por eso se lee cada entrada y no la transición.
import type { Document } from 'mongodb';
import { getDb } from './data';
import { getKam } from './kam';

export type TipoAlerta = 'aceptada' | 'cerrada' | 'caida';

export interface AlertaOferta {
    /** llave única para el log: `<operation._id>:<tipo>`. Una operación avisa cada tipo una sola vez. */
    clave: string;
    tipo: TipoAlerta;
    /** ISO UTC del cambio de estatus */
    fecha: string;
    operacion: string | null;
    codigo: string;
    inmobiliaria: string;
    kam: string;
    monto: number | null;
    precio_publicado: number | null;
    broker_vende: string;
    broker_comprador: string;
    url: string;
    /** el mensaje listo para el webhook de Google Chat */
    texto: string;
}

const STATUS: Record<string, TipoAlerta> = { offer_blocked: 'aceptada', closed: 'cerrada', cancelled: 'caida' };

const money = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-MX'));
const persona = (p?: Document | null) =>
    [p?.firstName, p?.lastName].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ') || '—';
const fechaMx = (d: Date) =>
    d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' });

function ts(h: Document): Date | null {
    const t = h?.timestamp;
    if (t instanceof Date) return t;
    if (typeof t === 'string') { const d = new Date(t); return isNaN(+d) ? null : d; }
    return null;
}

export async function fetchAlertasOfertas(horas = 72): Promise<AlertaOferta[]> {
    const db = await getDb();
    const since = new Date(Date.now() - horas * 3600 * 1000);

    const props = await db.collection('properties').find(
        { 'contract.exclusive.pulppo': { $ne: null } },
        { projection: { internalId: 1, 'company.name': 1, 'listing.value': 1, 'address.neighborhood.name': 1, 'address.city.name': 1 } }
    ).toArray();
    const byId = new Map(props.map((p) => [String(p._id), p]));

    const ops = await db.collection('operations').find(
        {
            'property._id': { $in: props.map((p) => p._id) },
            'status.history': { $elemMatch: { status: { $in: Object.keys(STATUS) }, timestamp: { $gte: since } } }
        },
        {
            projection: {
                id: 1, side: 1, 'status.history': 1, 'property._id': 1,
                'closeValue.value': 1, 'promotionValue.price': 1, 'reserveValue.value': 1, expectedClosedAt: 1,
                'seller.broker.firstName': 1, 'seller.broker.lastName': 1, 'seller.company.name': 1,
                'buyer.broker.firstName': 1, 'buyer.broker.lastName': 1, 'buyer.company.name': 1
            }
        }
    ).toArray();

    const out: AlertaOferta[] = [];
    for (const o of ops) {
        const P = byId.get(String(o.property?._id));
        if (!P) continue;
        const hist: Document[] = o.status?.history || [];
        const aceptadaAlgunaVez = hist.some((h) => h.status === 'offer_blocked');
        // la entrada más reciente de cada estatus dentro de la ventana
        const ultima: Partial<Record<TipoAlerta, Date>> = {};
        for (const h of hist) {
            const tipo = STATUS[h.status];
            const d = ts(h);
            if (!tipo || !d || d < since) continue;
            if (tipo === 'caida' && !aceptadaAlgunaVez) continue;
            if (!ultima[tipo] || d > ultima[tipo]!) ultima[tipo] = d;
        }
        for (const [tipo, d] of Object.entries(ultima) as [TipoAlerta, Date][]) {
            out.push(armar(tipo, d, o, P));
        }
    }
    out.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return out;
}

function armar(tipo: TipoAlerta, fecha: Date, o: Document, P: Document): AlertaOferta {
    const codigo = (P.internalId as string) || String(P._id);
    const inmobiliaria = P.company?.name || o.seller?.company?.name || '—';
    const kam = getKam(inmobiliaria);
    const monto = o.closeValue?.value ?? null;
    const precio = o.promotionValue?.price ?? P.listing?.value ?? null;
    const vende = persona(o.seller?.broker);
    const compra = persona(o.buyer?.broker);
    const compraInmo = o.buyer?.company?.name;
    const url = `https://pulppo.com/propiedades/${String(P._id)}`;
    const zona = [P.address?.neighborhood?.name, P.address?.city?.name].filter(Boolean).join(', ');

    const titulo = {
        aceptada: '🟢 *Oferta aceptada · 1·5·10*',
        cerrada: '🎉 *¡Cierre! · 1·5·10*',
        caida: '🔴 *Se cayó una oferta aceptada · 1·5·10*'
    }[tipo];

    const vsPrecio = monto && precio ? ` (${monto >= precio ? '+' : ''}${(((monto - precio) / precio) * 100).toFixed(1)}%)` : '';
    const lineas = [
        titulo,
        `*${codigo}* · ${inmobiliaria} · KAM: ${kam}`,
        zona ? `📍 ${zona}` : '',
        `💰 ${tipo === 'cerrada' ? 'Cierre' : 'Oferta'} ${money(monto)} · publicada en ${money(precio)}${vsPrecio}`,
        tipo === 'aceptada' && (o.reserveValue?.value || o.expectedClosedAt)
            ? `🔒 Apartado ${money(o.reserveValue?.value ?? null)}` +
              (o.expectedClosedAt instanceof Date ? ` · cierre esperado ${fechaMx(o.expectedClosedAt)}` : '')
            : '',
        `👤 Vende: ${vende}`,
        `🤝 Trae comprador: ${compra}${compraInmo && compraInmo !== inmobiliaria ? ` (${compraInmo})` : ''}`,
        `🔗 <${url}|Ver propiedad>`
    ];

    return {
        clave: `${String(o._id)}:${tipo}`,
        tipo,
        fecha: fecha.toISOString(),
        operacion: o.id ?? null,
        codigo,
        inmobiliaria,
        kam,
        monto,
        precio_publicado: precio,
        broker_vende: vende,
        broker_comprador: compra,
        url,
        texto: lineas.filter(Boolean).join('\n')
    };
}
