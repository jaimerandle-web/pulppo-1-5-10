// «Meta vs CRM»: lo que Ads Manager dice que dio cada campaña B2C contra lo que llegó al CRM, mes a mes.
// Para que quien monta las campañas (Habi) vea la discrepancia sin cruzar a mano.
//
// META. Con META_ACCESS_TOKEN en Vercel se pide en vivo (caché 1 h). Sin él se lee la foto
// metaFoto.json, que se refresca con `node scripts/meta_snapshot.mjs` desde la Mac de Ale (el token
// vive en ~/pulppo-automation/creds). Lo que Meta llama «lead» son tres cosas distintas:
//   · clic a WhatsApp en pulppo.com (pixel `Lead` = generate_lead_wp: el CLIC, no el mensaje),
//   · formulario instantáneo (onsite_conversion.lead_grouped),
//   · conversación iniciada (anuncio que abre WhatsApp directo; va al número de la página, no al CRM).
//
// CRM. Cruce por NOMBRE EXACTO: pulppo.com guarda utm_campaign en `leads.campaign` (y may–jul 2026
// también el id numérico de la campaña). Personas = contactos únicos por campaña y mes (hora México).
// Visitaron / ofertaron = esas personas con una visita no cancelada / una operación como compradoras
// DESPUÉS de su primer lead, de cualquier propiedad.
// «Sin etiqueta» (sólo campañas de una propiedad, con el código en el nombre): personas que en ese mes
// llegaron a esa propiedad por pulppo.com o WhatsApp sin campaña y sin lead de portal sobre ella. El
// UTM se pierde (sessionStorage de 1 día, navegador de IG → Chrome), así que parte de estos son de
// Meta; son POSIBLES, no se suman.
import type { Document, ObjectId } from 'mongodb';
import { classifySource, getDb } from '../data';
import foto from './metaFoto.json';

const CUENTA = 'act_352522417013101';
const DESDE = '2026-08-01';
const MX = 6 * 3600000; // UTC−6, sin horario de verano desde 2022

interface FilaGraph {
    campaign_id: string;
    campaign_name: string;
    date_start: string;
    spend?: string;
    impressions?: string;
    inline_link_clicks?: string;
    actions?: { action_type: string; value: string }[];
}

export interface FilaDesempeno {
    mes: string;             // AAAA-MM
    campanaId: string;
    campana: string;
    estado: string;          // ACTIVE, PAUSED… (hoy)
    codigo: string | null;   // código de propiedad si la campaña es de una sola
    // Meta
    gasto: number;
    impresiones: number;
    clics: number;
    clicWa: number;
    formulario: number;
    conversaciones: number;
    leadsMeta: number;
    // CRM
    leadsCrm: number;        // registros con la campaña
    personas: number;
    visitaron: number;
    ofertaron: number;
    sinEtiqueta: number | null;
}

export interface Desempeno {
    fuente: 'vivo' | 'foto';
    corteMeta: string;
    filas: FilaDesempeno[];
}

const n = (x?: string) => (x ? Number(x) || 0 : 0);
const accion = (r: FilaGraph, t: string) => n(r.actions?.find((a) => a.action_type === t)?.value);
const mesMx = (d: Date) => new Date(+d - MX).toISOString().slice(0, 7);
const CODIGO = /(?:^|[^A-Z])([A-Z]{3}-\d{3})(?!\d)/;

async function todo(url: string): Promise<Document[]> {
    const out: Document[] = [];
    for (let u: string | undefined = url; u;) {
        const r: Response = await fetch(u, { next: { revalidate: 3600 } });
        const j: { data: Document[]; error?: { message: string }; paging?: { next?: string } } = await r.json();
        if (j.error) throw new Error(`Meta: ${j.error.message}`);
        out.push(...j.data);
        u = j.paging?.next;
    }
    return out;
}

async function leerMeta(): Promise<{ fuente: 'vivo' | 'foto'; corte: string; insights: FilaGraph[]; estados: Record<string, string> }> {
    const token = process.env.META_ACCESS_TOKEN;
    if (token) {
        const hoy = new Date(Date.now() - MX).toISOString().slice(0, 10);
        const q = (p: string) => `https://graph.facebook.com/v21.0/${CUENTA}/${p}&access_token=${encodeURIComponent(token)}`;
        const [insights, campanas] = await Promise.all([
            todo(q(`insights?level=campaign&time_increment=monthly&limit=500&time_range=${encodeURIComponent(JSON.stringify({ since: DESDE, until: hoy }))}`
                + '&fields=campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions')),
            todo(q('campaigns?limit=500&fields=id,effective_status'))
        ]);
        return {
            fuente: 'vivo', corte: new Date().toISOString(), insights: insights as FilaGraph[],
            estados: Object.fromEntries(campanas.map((c) => [String(c.id), String(c.effective_status)]))
        };
    }
    const f = foto as { generado: string; insights: FilaGraph[]; estados: Record<string, string> };
    return { fuente: 'foto', corte: f.generado, insights: f.insights, estados: f.estados };
}

export async function desempenoMeta(): Promise<Desempeno> {
    const meta = await leerMeta();
    const filas = new Map<string, FilaDesempeno>(); // mes|nombre
    const idANombre = new Map<string, string>();
    for (const r of meta.insights) {
        if (!r.campaign_name.startsWith('B2C')) continue; // B2B (Master Brokers) vive en HubSpot, no en leads
        idANombre.set(r.campaign_id, r.campaign_name);
        const clicWa = accion(r, 'offsite_conversion.fb_pixel_lead');
        const formulario = accion(r, 'onsite_conversion.lead_grouped');
        const conversaciones = accion(r, 'onsite_conversion.messaging_conversation_started_7d');
        filas.set(`${r.date_start.slice(0, 7)}|${r.campaign_name}`, {
            mes: r.date_start.slice(0, 7), campanaId: r.campaign_id, campana: r.campaign_name,
            estado: meta.estados[r.campaign_id] || '', codigo: r.campaign_name.match(CODIGO)?.[1] ?? null,
            gasto: n(r.spend), impresiones: n(r.impressions), clics: n(r.inline_link_clicks),
            clicWa, formulario, conversaciones, leadsMeta: clicWa + formulario + conversaciones,
            leadsCrm: 0, personas: 0, visitaron: 0, ofertaron: 0, sinEtiqueta: null
        });
    }

    const db = await getDb();
    const desde = new Date(Date.parse(`${DESDE}T00:00:00Z`) + MX);
    const nombres = [...new Set([...filas.values()].map((f) => f.campana))];
    const leads = await db.collection('leads').find(
        { createdAt: { $gte: desde }, campaign: { $in: [...nombres, ...idANombre.keys()] } },
        { projection: { campaign: 1, source: 1, 'contact._id': 1, createdAt: 1 } }
    ).toArray();

    // Personas por campaña y mes, con su primer lead (para la cohorte de visita/oferta).
    const personas = new Map<string, Map<string, Date>>(); // mes|nombre → contacto → primer lead
    for (const l of leads) {
        if (String(l.source || '').toLowerCase() === 'formulario de contacto') continue;
        const nombre = idANombre.get(String(l.campaign)) ?? String(l.campaign);
        const k = `${mesMx(l.createdAt)}|${nombre}`;
        if (!filas.has(k)) {
            // Lead de un mes en que Meta no reporta gasto (llegó tarde): se muestra igual, en ceros de Meta.
            const base = [...filas.values()].find((f) => f.campana === nombre)!;
            filas.set(k, { ...base, mes: mesMx(l.createdAt), gasto: 0, impresiones: 0, clics: 0, clicWa: 0, formulario: 0,
                conversaciones: 0, leadsMeta: 0, leadsCrm: 0, personas: 0, visitaron: 0, ofertaron: 0, sinEtiqueta: null });
        }
        filas.get(k)!.leadsCrm++;
        const cid = String(l.contact?._id ?? l._id);
        if (!personas.has(k)) personas.set(k, new Map());
        const m = personas.get(k)!;
        if (!m.has(cid) || l.createdAt < m.get(cid)!) m.set(cid, l.createdAt);
    }

    const contactos = [...new Set([...personas.values()].flatMap((m) => [...m.keys()]))]
        .filter((c) => /^[a-f0-9]{24}$/.test(c));
    const { ObjectId: OID } = await import('mongodb');
    const oids = contactos.map((c) => new OID(c));
    const [visitas, ofertas] = await Promise.all([
        db.collection('visits').find(
            { 'contact._id': { $in: oids }, createdAt: { $gte: desde }, 'status.last': { $ne: 'cancelled' } },
            { projection: { 'contact._id': 1, createdAt: 1 } }
        ).toArray(),
        db.collection('operations').find(
            { 'buyer.contact._id': { $in: oids }, createdAt: { $gte: desde } },
            { projection: { 'buyer.contact._id': 1, createdAt: 1 } }
        ).toArray()
    ]);
    const fechas = (docs: Document[], campo: (d: Document) => unknown) => {
        const m = new Map<string, Date[]>();
        for (const d of docs) {
            const c = String(campo(d));
            m.set(c, [...(m.get(c) || []), d.createdAt as Date]);
        }
        return m;
    };
    const vis = fechas(visitas, (d) => d.contact?._id);
    const ofe = fechas(ofertas, (d) => d.buyer?.contact?._id);
    for (const [k, m] of personas) {
        const f = filas.get(k)!;
        f.personas = m.size;
        for (const [c, primero] of m) {
            if (vis.get(c)?.some((x) => x >= primero)) f.visitaron++;
            if (ofe.get(c)?.some((x) => x >= primero)) f.ofertaron++;
        }
    }

    // Sin etiqueta: campañas de una propiedad, en los meses con gasto.
    const conCodigo = [...filas.values()].filter((f) => f.codigo && f.gasto > 0);
    if (conCodigo.length) {
        const props = await db.collection('properties').find(
            { internalId: { $in: [...new Set(conCodigo.map((f) => f.codigo!))] } },
            { projection: { internalId: 1 } }
        ).toArray();
        const idDe = new Map(props.map((p) => [String(p.internalId), p._id as ObjectId]));
        const ls = await db.collection('leads').find(
            { 'property._id': { $in: [...idDe.values()] }, createdAt: { $gte: new Date(+desde - 400 * 86400000) } },
            { projection: { 'property._id': 1, 'contact._id': 1, source: 1, campaign: 1, createdAt: 1 } }
        ).toArray();
        const portal = new Set<string>(); // prop|contacto con lead de portal
        for (const l of ls) {
            const c = classifySource(l.source as string);
            if (['Inmuebles24', 'MercadoLibre', 'Lamudi', 'Otros portales'].includes(c)) portal.add(`${l.property?._id}|${l.contact?._id}`);
        }
        const etiquetados = new Set([...personas.values()].flatMap((m) => [...m.keys()]));
        for (const f of conCodigo) {
            const pid = String(idDe.get(f.codigo!));
            const s = new Set<string>();
            for (const l of ls) {
                if (String(l.property?._id) !== pid || +l.createdAt < +desde || mesMx(l.createdAt) !== f.mes || l.campaign) continue;
                const c = classifySource(l.source as string);
                const cid = String(l.contact?._id);
                if (['Pulppo', 'WhatsApp', 'Sin fuente', 'Orgánico/Google'].includes(c) && !portal.has(`${pid}|${cid}`) && !etiquetados.has(cid)) s.add(cid);
            }
            f.sinEtiqueta = s.size;
        }
    }

    return {
        fuente: meta.fuente,
        corteMeta: meta.corte,
        filas: [...filas.values()].sort((a, b) => b.mes.localeCompare(a.mes) || b.gasto - a.gasto)
    };
}
