// Las consultas detrás de «Sin responder · últimos 30 días» del Overview de /mb (Ale, oct-2026: «poder ir a ver esas
// 11 consultas, con los datos del lead, el asesor que no está respondiendo y la propiedad que las generó»).
//
//   GET /api/mb-sin-responder?company=<id>
//
// MISMA regla que el número del Overview (fetchInmobiliaria en lib/mb.ts): propiedades publicadas de la compañía,
// leads únicos (contacto + propiedad, el primero) de los últimos 30 días, que entraron de 8 am a 8 pm y no tienen
// `answeredAt`. Trae teléfono y correo del cliente: es la cartera de la propia inmobiliaria (barrera canAccessCompany).
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, type Document } from 'mongodb';
import { canAccessCompany } from '@/lib/companyAccess';
import { getDb } from '@/lib/data';
import { claveLead, enHorario } from '@/lib/mbComun';
import { classifySource, KEY2NAME } from '@/lib/portales/metrics';
import { canalContacto } from '@/lib/portales/inmobiliaria';

export const dynamic = 'force-dynamic';

const MEDIO = { whatsapp: 'WhatsApp', telefono: 'Teléfono', form: 'Formulario' } as const;
const s = (x: unknown) => String(x ?? '').trim();
const nom = (a: Document | undefined) => [a?.firstName, a?.lastName].map(s).filter(Boolean).join(' ') || null;

export async function GET(req: NextRequest) {
    const company = s(req.nextUrl.searchParams.get('company'));
    if (!/^[a-f0-9]{24}$/i.test(company)) return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
    if (!(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const db = await getDb();
    const props = await db.collection('properties').find({ 'company._id': new ObjectId(company), 'status.last': 'published' },
        { projection: { internalId: 1, 'listing.operation': 1, 'address.street': 1, 'address.neighborhood.name': 1, 'agent._id': 1, 'agent.firstName': 1, 'agent.lastName': 1 } }).toArray();
    const porId = new Map(props.map((p) => [String(p._id), p]));
    const desde = new Date(Date.now() - 30 * 86400000);
    const vistos = new Set<string>();
    const leads: Array<Record<string, string | null>> = [];
    for (const l of await db.collection('leads').find({ 'property._id': { $in: props.map((p) => p._id) }, createdAt: { $gte: desde } }, { projection: {
        createdAt: 1, answeredAt: 1, source: 1, medium: 1, message: 1, phone: 1, email: 1, 'contact._id': 1, 'contact.firstName': 1, 'contact.lastName': 1,
        'contact.email': 1, 'contact.phone': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'property._id': 1,
    } }).sort({ createdAt: 1 }).toArray() as Document[]) {
        if (!(l.createdAt instanceof Date)) continue;
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (!enHorario(l.createdAt) || l.answeredAt instanceof Date) continue;
        const p = porId.get(String(l.property?._id));
        const canal = classifySource(s(l.source));
        leads.push({
            fecha: l.createdAt.toISOString(),
            nombre: nom(l.contact),
            telefono: s(l.phone) || s(l.contact?.phone) || null,
            correo: s(l.contact?.email) || s(l.email) || null,
            fuente: KEY2NAME[canal] ?? (s(l.source) || 'Sin fuente'),
            medio: MEDIO[canalContacto({ medium: l.medium, message: l.message })],
            asesor: nom(l.agent) ?? nom(p?.agent) ?? 'Sin asesor',
            codigo: s(p?.internalId) || null,
            operacion: p?.listing?.operation === 'rent' ? 'Renta' : 'Venta',
            direccion: [s(p?.address?.street), s(p?.address?.neighborhood?.name)].filter(Boolean).join(', ') || null,
            mensaje: s(l.message).slice(0, 160) || null,
        });
    }
    return NextResponse.json({ leads: leads.reverse() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
