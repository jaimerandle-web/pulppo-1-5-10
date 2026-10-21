// Lista de leads detrás de un número de la pestaña Marketing (Joshua, oct-2026: «siempre que salgan leads,
// que tengan liga a la lista con nombre, fuente, medio, teléfono y correo»).
//
//   GET /api/mb-marketing/leads?company=<id>&codigo=<internalId>[&dias=30][&portal=i24|meli]
//
// Misma barrera que /api/mb-marketing (hoy sólo equipo interno). Leads únicos (contacto + propiedad = 1, el
// primero), como en los conteos de la pestaña, para que el número y la lista cuadren.
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, type Document } from 'mongodb';
import { canAccessCompany, currentUser } from '@/lib/companyAccess';
import { getDb } from '@/lib/data';
import { claveLead } from '@/lib/mbComun';
import { classifySource, KEY2NAME } from '@/lib/portales/metrics';
import { canalContacto } from '@/lib/portales/inmobiliaria';
import { MARKETING_EMPRESAS, puedeVerMarketing } from '@/lib/marketingAcceso';

export const dynamic = 'force-dynamic';

const MEDIO = { whatsapp: 'WhatsApp', telefono: 'Teléfono', form: 'Formulario' } as const;
const s = (x: unknown) => String(x ?? '').trim();

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const company = s(sp.get('company')), codigo = s(sp.get('codigo')).toUpperCase();
    const dias = Math.min(400, Math.max(1, Number(sp.get('dias')) || 30));
    const portal = s(sp.get('portal'));
    if (!/^[a-f0-9]{24}$/i.test(company) || !MARKETING_EMPRESAS.has(company) || !codigo)
        return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
    const user = await currentUser();
    if (!puedeVerMarketing(user, company)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    if (!user!.internal && !(await canAccessCompany(company))) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const db = await getDb();
    const prop = await db.collection('properties').findOne({ internalId: codigo }, { projection: { 'company._id': 1 } });
    if (!prop) return NextResponse.json({ error: 'No existe la propiedad' }, { status: 404 });
    const desde = new Date(Date.now() - dias * 86400000);
    const vistos = new Set<string>();
    const leads: Array<Record<string, string | null>> = [];
    // Se recorre la misma ventana que el conteo (400 días) para que «lead único» = la PRIMERA vez que esa persona
    // escribió sobre la propiedad; si no, alguien que volvió a escribir contaba en la lista y no en el número.
    for (const l of await db.collection('leads').find({ 'property._id': prop._id as ObjectId, createdAt: { $gte: new Date(Date.now() - 400 * 86400000) } }, { projection: {
        createdAt: 1, answeredAt: 1, source: 1, medium: 1, message: 1, phone: 1, email: 1, 'contact._id': 1, 'contact.firstName': 1, 'contact.lastName': 1,
        'contact.email': 1, 'contact.phone': 1, 'agent.firstName': 1, 'agent.lastName': 1, 'property._id': 1,
    } }).sort({ createdAt: 1 }).toArray() as Document[]) {
        if (s(l.source).toLowerCase() === 'formulario de contacto') continue;   // spam de bots (regla de /portales)
        const k = claveLead(l);
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (!(l.createdAt instanceof Date) || l.createdAt < desde) continue;
        const canal = classifySource(s(l.source));
        if (portal && canal !== portal) continue;
        leads.push({
            fecha: l.createdAt instanceof Date ? l.createdAt.toISOString() : null,
            nombre: [l.contact?.firstName, l.contact?.lastName].map(s).filter(Boolean).join(' ') || null,
            fuente: KEY2NAME[canal] ?? (s(l.source) || 'Sin fuente'),
            medio: MEDIO[canalContacto({ medium: l.medium, message: l.message })],
            telefono: s(l.phone) || s(l.contact?.phone) || null,
            correo: s(l.contact?.email) || s(l.email) || null,
            asesor: [l.agent?.firstName, l.agent?.lastName].map(s).filter(Boolean).join(' ') || null,
            mensaje: s(l.message).slice(0, 160) || null,
        });
    }
    return NextResponse.json({ codigo, dias, leads: leads.reverse() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
