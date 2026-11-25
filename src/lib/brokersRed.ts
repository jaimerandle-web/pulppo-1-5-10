// Brokers externos de TODA la red Pulppo, con lo que mueven. Port de ~/DiamondHouse/datos/brokers_red.py.
//
// Externo = no es asesor de ninguna inmobiliaria Pulppo (`agents`, por id, teléfono o correo; y fuera @pulppo.com).
// Entra quien (a) es contacto marcado como broker (tags /broker/i: no están normalizados) y mandó al menos un lead a
// la red, o (b) estuvo del lado de un broker en una operación de la red.
//
// 🔴 `contacts` guarda teléfonos y correos en LISTAS (`phones[{phone, plain}]`, `emails[]`), no en phone/email.
// 🔴 Se junta por persona (el mismo broker es un contacto distinto en cada inmobiliaria) por teléfono o correo,
//    PERO sólo si los registros que comparten la llave tienen el mismo nombre de pila: los teléfonos de relleno
//    (5555555555, 5512345678) y los correos de oficina (contacto@inmobiliaria.com) encadenaban a cientos de personas.
//
// Para la inmobiliaria NO sale con qué otras inmobiliarias trabaja cada broker (es información de la competencia):
// sólo cuántas, y la relación con ELLA en `contigo`. Patrones = de TODO lo que pregunta en la red.
// Se calcula una vez al mes (lib/datosFoto.ts): ~200k grupos de leads + ~28k propiedades.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';
import { patrones, type Patrones, type PropPatron } from './datosPatrones';

type D = Document;
const OP: Record<string, string> = { sale: 'venta', rent: 'renta' };
const NIVEL_RED = ['cerró en la red', 'ofertó en la red', 'recurrente (3+ leads)', 'ocasional'] as const;

export type BrokerRed = {
    id: string; nombre: string | null; inmobiliaria_declarada: string | null; telefonos: string[]; emails: string[];
    nivel_red: string; leads_a_la_red: number; operaciones_red: number; cierres_red: number; inmobiliarias_pulppo: number;
    contigo: { nivel: string | null; leads: number; operaciones: number; cierres: number };
    patrones: Patrones; primer_contacto: string | null; ultimo_contacto: string | null;
};

const tel = (t: unknown) => { const d = String(t ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
const mail = (e: unknown) => { const x = String(e ?? '').trim().toLowerCase(); return x.includes('@') ? x : null; };
const nom = (o: D | undefined) => [o?.firstName, o?.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ') || null;
const relleno = (t: string) => new Set(t).size <= 3 || ['1234567', '2345678', '3456789', '9876543'].some((x) => t.includes(x));
const pila = (n: string | null) => (n ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z]{3,}/)?.[0] ?? null;
const masComun = (xs: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
async function enLotes<T>(ids: unknown[], fn: (l: unknown[]) => Promise<T[]>, n = 5000): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += n) out.push(...(await fn(ids.slice(i, i + n))));
    return out;
}

type Reg = {
    nombres: string[]; inm: string[]; tels: Set<string>; mails: Set<string>; leads: number; ops: number; cierres: number;
    inmos: Set<string>; props: Set<string>; fechas: Date[]; tuLeads: number; tuOps: number; tuCierres: number;
};
const nuevo = (): Reg => ({ nombres: [], inm: [], tels: new Set(), mails: new Set(), leads: 0, ops: 0, cierres: 0, inmos: new Set(), props: new Set(), fechas: [], tuLeads: 0, tuOps: 0, tuCierres: 0 });

export async function brokersRed(companyId: string): Promise<BrokerRed[]> {
    const db = await getDb();
    const yo = companyId;

    const pIds = new Set<string>(), pTel = new Set<string>(), pMail = new Set<string>();
    for (const a of await db.collection('agents').find({}, { projection: { phone: 1, email: 1 } }).toArray()) {
        pIds.add(String(a._id));
        const t = tel(a.phone), m = mail(a.email);
        if (t) pTel.add(t);
        if (m) pMail.add(m);
    }
    const demo = new Set((await db.collection('companies').find({ name: { $regex: 'demo|prueba|test', $options: 'i' } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));

    const R = new Map<string, Reg>();
    const reg = (k: string) => { let r = R.get(k); if (!r) { r = nuevo(); R.set(k, r); } return r; };

    const contactos = await db.collection('contacts').find({ tags: { $regex: 'broker', $options: 'i' } },
        { projection: { firstName: 1, lastName: 1, phone: 1, email: 1, phones: 1, emails: 1 } }).toArray();
    for (const c of contactos) {
        const r = reg('c' + c._id);
        const n = nom(c); if (n) r.nombres.push(n);
        for (const x of [c.phone, ...((c.phones as D[]) || []).map((p) => (p && typeof p === 'object' ? p.plain || p.phone : p))]) { const t = tel(x); if (t) r.tels.add(t); }
        for (const x of [c.email, ...((c.emails as D[]) || []).map((e) => (e && typeof e === 'object' ? e.email : e))]) { const m = mail(x); if (m) r.mails.add(m); }
    }

    // Leads agrupados EN MONGO por contacto × inmobiliaria × propiedad.
    const grupos = await enLotes(contactos.map((c) => c._id), (lote) => db.collection('leads').aggregate([
        { $match: { 'contact._id': { $in: lote } } },
        { $group: { _id: { c: '$contact._id', co: '$company._id', p: '$property._id' }, n: { $sum: 1 }, ini: { $min: '$createdAt' }, fin: { $max: '$createdAt' } } },
    ], { allowDiskUse: true }).toArray());
    for (const g of grupos) {
        const co = g._id.co ? String(g._id.co) : null;
        if (co && demo.has(co)) continue;
        const r = reg('c' + g._id.c);
        r.leads += g.n;
        if (co) r.inmos.add(co);
        if (co === yo) r.tuLeads += g.n;
        if (g._id.p) r.props.add(String(g._id.p));
        for (const f of [g.ini, g.fin]) if (f instanceof Date) r.fechas.push(f);
    }

    const B = (l: string) => Object.fromEntries(['_id', 'firstName', 'lastName', 'phone', 'email'].map((k) => [`${l}.broker.${k}`, 1]).concat([[`${l}.company._id`, 1], [`${l}.company.name`, 1]]));
    const ops = await db.collection('operations').find({}, { projection: { ...B('buyer'), ...B('seller'), 'status.last': 1, closedAt: 1, createdAt: 1, 'property._id': 1 } }).toArray();
    for (const o of ops) {
        const cerro = ['closed', 'paying'].includes(String(o.status?.last));
        for (const [lado, otro] of [['buyer', 'seller'], ['seller', 'buyer']] as const) {
            const br = o[lado]?.broker as D | undefined, co = o[lado]?.company as D | undefined;
            if (!br?._id || (co?._id && demo.has(String(co._id)))) continue;
            const r = reg('b' + br._id);
            const n = nom(br); if (n) r.nombres.push(n);
            if (String(co?.name ?? '').trim()) r.inm.push(String(co!.name).trim());
            const t = tel(br.phone), m = mail(br.email);
            if (t) r.tels.add(t);
            if (m) r.mails.add(m);
            r.ops++; if (cerro) r.cierres++;
            const contra = o[otro]?.company?._id ? String(o[otro].company._id) : null;
            if (contra) r.inmos.add(contra);
            if (contra === yo) { r.tuOps++; if (cerro) r.tuCierres++; }
            if (o.property?._id) r.props.add(String(o.property._id));
            const f = o.closedAt || o.createdAt; if (f instanceof Date) r.fechas.push(f);
        }
    }

    // Fuera lo que es Pulppo o no tuvo actividad.
    const regs = new Map([...R].filter(([k, r]) => (r.leads || r.ops)
        && !(k[0] === 'b' && pIds.has(k.slice(1)))
        && ![...r.tels].some((t) => pTel.has(t)) && ![...r.mails].some((m) => pMail.has(m) || m.endsWith('@pulppo.com'))));

    // Juntar por persona.
    const padre = new Map([...regs.keys()].map((k) => [k, k]));
    const raiz = (k: string): string => { let x = k; while (padre.get(x) !== x) x = padre.get(x)!; padre.set(k, x); return x; };
    const pilaDe = new Map([...regs].map(([k, r]) => [k, pila(masComun(r.nombres))]));
    const porLlave = new Map<string, string[]>();
    for (const [k, r] of regs) for (const ll of [...[...r.tels].filter((t) => !relleno(t)).map((t) => 't' + t), ...[...r.mails].map((m) => 'm' + m)]) {
        const l = porLlave.get(ll); if (l) l.push(k); else porLlave.set(ll, [k]);
    }
    for (const ks of porLlave.values()) {
        if (ks.length < 2 || new Set(ks.map((k) => pilaDe.get(k)).filter(Boolean)).size > 1) continue;
        for (const k of ks.slice(1)) padre.set(raiz(k), raiz(ks[0]));
    }
    const personas = new Map<string, Reg[]>();
    for (const [k, r] of regs) { const x = raiz(k); const l = personas.get(x); if (l) l.push(r); else personas.set(x, [r]); }

    // Propiedades para los patrones (sólo lo necesario).
    const todas = [...new Set([...regs.values()].flatMap((r) => [...r.props]))].map((x) => new ObjectId(x));
    const props = new Map<string, PropPatron>();
    for (const p of await enLotes(todas, (lote) => db.collection('properties').find({ _id: { $in: lote as ObjectId[] } }, {
        projection: { 'address.neighborhood.name': 1, 'address.city.name': 1, 'listing.operation': 1, 'listing.price.price': 1, 'listing.price.currency': 1, type: 1, 'attributes.suites': 1 },
    }).toArray())) {
        props.set(String(p._id), {
            operacion: OP[p.listing?.operation] ?? null, tipo: p.type ?? null, precio: p.listing?.price?.price ?? null,
            moneda: p.listing?.price?.currency ?? null, recamaras: p.attributes?.suites ?? null,
            ubicacion: { colonia: p.address?.neighborhood?.name ?? null, municipio: p.address?.city?.name ?? null },
        });
    }

    const out: BrokerRed[] = [];
    for (const [id, rs] of personas) {
        const suma = (k: 'leads' | 'ops' | 'cierres' | 'tuLeads' | 'tuOps' | 'tuCierres') => rs.reduce((a, r) => a + r[k], 0);
        const leads = suma('leads'), ops = suma('ops'), cierres = suma('cierres');
        const tu = { leads: suma('tuLeads'), operaciones: suma('tuOps'), cierres: suma('tuCierres') };
        const fechas = rs.flatMap((r) => r.fechas).map((f) => f.getTime());
        out.push({
            id: id.slice(1), nombre: masComun(rs.flatMap((r) => r.nombres)), inmobiliaria_declarada: masComun(rs.flatMap((r) => r.inm)),
            telefonos: [...new Set(rs.flatMap((r) => [...r.tels]))].sort(), emails: [...new Set(rs.flatMap((r) => [...r.mails]))].sort(),
            nivel_red: cierres ? NIVEL_RED[0] : ops ? NIVEL_RED[1] : leads >= 3 ? NIVEL_RED[2] : NIVEL_RED[3],
            leads_a_la_red: leads, operaciones_red: ops, cierres_red: cierres,
            inmobiliarias_pulppo: new Set(rs.flatMap((r) => [...r.inmos])).size,
            contigo: { nivel: tu.cierres ? 'cerró con nosotros' : tu.operaciones ? 'ofertó con nosotros' : tu.leads ? 'nos mandó leads' : null, ...tu },
            patrones: patrones([...new Set(rs.flatMap((r) => [...r.props]))].map((p) => props.get(p)).filter((p): p is PropPatron => !!p)),
            primer_contacto: fechas.length ? new Date(Math.min(...fechas)).toISOString() : null,
            ultimo_contacto: fechas.length ? new Date(Math.max(...fechas)).toISOString() : null,
        });
    }
    const rk = (n: string) => NIVEL_RED.indexOf(n as (typeof NIVEL_RED)[number]);
    return out.sort((a, b) => rk(a.nivel_red) - rk(b.nivel_red) || b.cierres_red - a.cierres_red || b.leads_a_la_red - a.leads_a_la_red);
}
