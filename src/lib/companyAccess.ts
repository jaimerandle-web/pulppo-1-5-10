// Acceso de Master Brokers (usuarios externos) al panel de SU inmobiliaria.
// Regla: un email externo entra SOLO si es un agente `type:'master'` activo con company._id; y solo
// puede ver los datos de esa company. Los internos (allowlist) mantienen acceso total.
// Este módulo toca Mongo → se usa en server components y API routes (Node), NUNCA en el middleware (Edge).
import { cookies } from 'next/headers';
import { getDb } from './data';
import { isAllowed } from './access';
import { userToken } from './token';

// company._id (como string) del master broker con ese email, o null si el email no es master de ninguna
// inmobiliaria. Determinístico: en los datos ningún email cae en más de una company.
export async function masterCompanyForEmail(email?: string | null): Promise<string | null> {
    const mail = (email || '').trim().toLowerCase();
    if (!mail) return null;
    const db = await getDb();
    const doc = await db.collection('agents').findOne(
        {
            status: 'active',
            type: 'master',
            'company._id': { $exists: true },
            $or: [{ email: mail }, { 'personal.email': mail }]
        },
        { projection: { 'company._id': 1 }, collation: { locale: 'en', strength: 2 } }
    );
    const id = (doc as { company?: { _id?: unknown } } | null)?.company?._id;
    return id ? String(id) : null;
}

// Acceso de asesores (type:'associate') a Studio. Gemelo de masterCompanyForEmail: mismo criterio
// —agente activo, con company— pero devuelve el _id del AGENTE, no el de la company: el asesor se ve
// a sí mismo, no a su inmobiliaria. Un master NO cae acá (se resuelve antes como master broker).
export async function asesorIdForEmail(email?: string | null): Promise<string | null> {
    const mail = (email || '').trim().toLowerCase();
    if (!mail) return null;
    const db = await getDb();
    const doc = await db.collection('agents').findOne(
        {
            status: 'active',
            type: 'associate',
            deletedAt: null,
            'company._id': { $exists: true },
            $or: [{ email: mail }, { 'personal.email': mail }]
        },
        { projection: { _id: 1 }, collation: { locale: 'en', strength: 2 } }
    );
    const id = (doc as { _id?: unknown } | null)?._id;
    return id ? String(id) : null;
}

export interface CurrentUser {
    email: string;
    internal: boolean; // true = miembro del equipo Pulppo (allowlist) → acceso total
}

// Identidad verificada del request: lee cm-user y valida la firma cm-sig (anti-falsificación).
// Devuelve null si no hay cookie válida.
export async function currentUser(): Promise<CurrentUser | null> {
    const store = await cookies();
    const email = (store.get('cm-user')?.value || '').trim().toLowerCase();
    const sig = store.get('cm-sig')?.value || '';
    if (!email || !sig) return null;
    if (sig !== (await userToken(email))) return null;
    return { email, internal: isAllowed(email) };
}

// ¿Puede el usuario del request ver los datos de esta company? Interno: siempre. Externo: solo la suya.
// Esta es la barrera de seguridad real (recalcula contra Mongo, no confía en la cookie cm-company).
export async function canAccessCompany(companyId?: string | null): Promise<boolean> {
    const u = await currentUser();
    if (!u) return false;
    if (u.internal) return true;
    if (!companyId) return false;
    const own = await masterCompanyForEmail(u.email);
    return !!own && own === companyId;
}

// Barrera real de Studio: recalcula el asesor contra Mongo en vez de confiar en la cookie cm-asesor
// (que solo sirve para rutear en el middleware). Devuelve el _id del agente, o null si no le toca.
export async function currentAsesorId(): Promise<string | null> {
    const u = await currentUser();
    if (!u) return null;
    return asesorIdForEmail(u.email);
}
