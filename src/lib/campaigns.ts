// Desempeño de campañas para el centro de mando 1·5·10. Dos preguntas:
//  1) Correo: ¿funcionaron los envíos y para qué propiedades? → leads source='email' (utm_source=email)
//     atribuidos por propiedad + campaña (campaign='exclusiva_<código>'), cruzados con el engagement real
//     del envío (aperturas/clics) que vive en SendGrid (se une en la API, no aquí).
//  2) Redes / pixel: ¿está bien conectado el pixel por propiedad? → leads de Meta (Facebook: facebook/fb/
//     fb-SiteLink-* · Instagram: ig/IGShopping) por propiedad, normalizando la fuente y midiendo la "salud de atribución" por el
//     campo `medium`: limpio (form/whatsapp/lead ads) vs fuga (referrers/URLs que se colaron al medium
//     porque el UTM no viajó → señal de pixel mal conectado).
import { ObjectId, type Db } from 'mongodb';
import { getDb } from './data';
import { getKam } from './kam';
import type { CampaignPerf, EmailPropRow, EmailCampaign, SocialPropRow } from '@/types';

// Universo Meta = Facebook + Instagram, tolerando todas las variantes de escritura que hay en Mongo.
// Instagram: 'ig', 'IGShopping', 'instagram'. Facebook: 'facebook', 'fb', 'fb-SiteLink-1/2/11'.
function normSocial(src?: string | null): 'Facebook' | 'Instagram' | null {
    const s = (src || '').trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith('ig') || s.includes('insta')) return 'Instagram';
    if (s.startsWith('fb') || s.includes('face')) return 'Facebook';
    return null;
}

// Un lead social está "bien atribuido" si el medium es un valor limpio conocido. Es "fuga" si viene vacío
// o si el medium trae un referrer/URL (https…, *.com, organic.<algo>): eso pasa cuando el UTM no viajó y
// la plataforma rellenó el medium con la página de origen → el pixel/etiquetado no está bien conectado.
const CLEAN_MEDIUM = new Set(['form', 'whatsapp', 'lead ads', 'lead_ads', 'leadads', 'call', 'organic', 'email', 'message', 'messenger']);
function isDirtyMedium(medium?: string | null): boolean {
    const s = (medium || '').trim().toLowerCase();
    if (!s) return true;
    if (CLEAN_MEDIUM.has(s)) return false;
    return /https?:|www\.|\.com|\.mx|\.c$|\/|organic[._]/.test(s);
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);

export async function fetchCampaignPerf(): Promise<CampaignPerf> {
    const db: Db = await getDb();
    const FLAG = { 'contract.exclusive.pulppo': { $ne: null }, 'status.last': 'published' };
    const proj = {
        internalId: 1, 'company.name': 1, type: 1, 'listing.title': 1, 'listing.value': 1,
        'address.neighborhood.name': 1, 'address.city.name': 1
    };
    const props = await db.collection('properties').find(FLAG, { projection: proj }).toArray();
    const ids = props.map((p) => p._id as ObjectId);
    const meta = new Map(props.map((p) => [String(p._id), p]));

    // Una sola pasada: leads de las exclusivas vivas agrupados por propiedad · fuente · medio · campaña.
    // De aquí salen tanto el correo (source='email') como redes (normSocial != null).
    const agg = db.collection('leads').aggregate([
        { $match: { 'property._id': { $in: ids } } },
        {
            $group: {
                _id: { pid: '$property._id', src: '$source', med: '$medium', camp: '$campaign' },
                n: { $sum: 1 }, last: { $max: '$createdAt' }
            }
        }
    ]);

    const emailByProp = new Map<string, EmailPropRow>();
    const socialByProp = new Map<string, SocialPropRow>();
    const mediumGlobal: Record<string, number> = {};
    const spellGlobal: Record<string, number> = {};
    let totalFacebook = 0, totalInstagram = 0, socBien = 0, socFuga = 0;

    for await (const r of agg) {
        const pid = String(r._id.pid);
        const p = meta.get(pid);
        if (!p) continue;
        const src = (r._id.src || '') as string;
        const med = (r._id.med || '') as string;
        const camp = (r._id.camp || null) as string | null;
        const n = r.n as number;
        const last = iso(r.last);
        const base = () => ({
            id: pid, internalId: p.internalId ?? null, titulo: p.listing?.title ?? null,
            inmobiliaria: p.company?.name ?? null, kam: getKam(p.company?.name),
            colonia: p.address?.neighborhood?.name ?? null, tipo: p.type ?? null
        });

        // --- Correo ---
        if (src.trim().toLowerCase() === 'email') {
            let e = emailByProp.get(pid);
            if (!e) { e = { ...base(), precio: p.listing?.value ?? null, campaign: camp, email_leads: 0, por_medio: {}, ultima: null }; emailByProp.set(pid, e); }
            e.email_leads += n;
            const mk = med.trim().toLowerCase() || '(sin medio)';
            e.por_medio[mk] = (e.por_medio[mk] || 0) + n;
            if (camp && (!e.campaign || camp.startsWith('exclusiva'))) e.campaign = camp;
            if (last && (!e.ultima || last > e.ultima)) e.ultima = last;
            continue;
        }

        // --- Redes ---
        const net = normSocial(src);
        if (!net) continue;
        spellGlobal[src || '(vacío)'] = (spellGlobal[src || '(vacío)'] || 0) + n;
        const mk = med.trim().toLowerCase() || '(sin medio)';
        mediumGlobal[mk] = (mediumGlobal[mk] || 0) + n;
        const dirty = isDirtyMedium(med);
        if (dirty) socFuga += n; else socBien += n;
        if (net === 'Facebook') totalFacebook += n; else totalInstagram += n;

        let s = socialByProp.get(pid);
        if (!s) { s = { ...base(), facebook: 0, instagram: 0, social_total: 0, bien_atribuidos: 0, fuga: 0, mediums: {} }; socialByProp.set(pid, s); }
        if (net === 'Facebook') s.facebook += n; else s.instagram += n;
        s.social_total += n;
        if (dirty) s.fuga += n; else s.bien_atribuidos += n;
        s.mediums[mk] = (s.mediums[mk] || 0) + n;
    }

    // Campañas de correo detectadas en TODA la base (contexto: el esquema 1·5·10 recién arrancó).
    const campanas: EmailCampaign[] = [];
    let totalPrograma = 0;
    const cAgg = db.collection('leads').aggregate([
        { $match: { source: 'email' } },
        { $group: { _id: '$campaign', leads: { $sum: 1 }, last: { $max: '$createdAt' } } },
        { $sort: { last: -1 } }
    ]);
    for await (const r of cAgg) {
        const camp = (r._id || null) as string | null;
        campanas.push({ campaign: camp, leads: r.leads as number, ultima: iso(r.last), es_1_5_10: !!camp && camp.startsWith('exclusiva') });
        totalPrograma += r.leads as number;
    }

    const emailRows = [...emailByProp.values()].sort((a, b) => b.email_leads - a.email_leads);
    const socialRows = [...socialByProp.values()].sort((a, b) => b.social_total - a.social_total);
    const toSeries = (o: Record<string, number>) => Object.entries(o).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    return {
        liveCount: props.length,
        email: {
            porPropiedad: emailRows,
            campanas,
            totalLive: emailRows.reduce((a, r) => a + r.email_leads, 0),
            totalPrograma
        },
        social: {
            porPropiedad: socialRows,
            totalFacebook,
            totalInstagram,
            mediumBreakdown: toSeries(mediumGlobal),
            sourceSpellings: toSeries(spellGlobal),
            bienAtribuidos: socBien,
            fuga: socFuga,
            conSocial: socialRows.length,
            sinSocial: props.length - socialRows.length
        },
        generatedAt: new Date().toISOString()
    };
}
