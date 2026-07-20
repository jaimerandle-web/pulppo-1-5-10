// Cliente de SendGrid Marketing Campaigns v3 (Single Sends) vía REST, sin dependencias (fetch nativo).
// Fase 2 del módulo de campañas: sincroniza una base como Lista, crea un Single Send on-brand (con footer
// de baja obligatorio) y lo deja como BORRADOR; la programación real ocurre SOLO tras aprobación explícita
// (human-in-the-loop). SendGrid maneja bajas, supresión (bounces/unsubs) y métricas de campaña.

const BASE = 'https://api.sendgrid.com/v3';
const UNSUB_GROUP_NAME = 'Exclusivas 1·5·10';

function apiKey(): string {
    const k = process.env.SENDGRID_API_KEY;
    if (!k) throw new Error('Falta SENDGRID_API_KEY en el entorno');
    return k;
}

// Wrapper tipado sobre la API. Devuelve JSON parseado; en error arma un mensaje legible con los
// `errors[].message` que devuelve SendGrid.
async function sg<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey()}`,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined)
        }
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
        let detail = text;
        try {
            const j = JSON.parse(text) as { errors?: { message?: string }[] };
            if (j.errors?.length) detail = j.errors.map((e) => e.message).filter(Boolean).join('; ');
        } catch { /* respuesta no-JSON: se deja el texto crudo */ }
        throw new Error(`SendGrid ${res.status} en ${path}: ${detail || res.statusText}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
}

// --- Identidades de cuenta (remitente + grupo de baja). Cacheadas en memoria por instancia. ---

let _senderId: number | null = null;
let _unsubGroupId: number | null = null;

interface SgSender { id: number | string; from?: { email?: string } }

// Id del remitente verificado de marketing. Se toma de SENDGRID_SENDER_ID si está; si no, se busca el
// sender cuyo `from.email` coincide con SENDGRID_FROM_EMAIL (fallback: el primero disponible).
export async function getSenderId(): Promise<number> {
    if (_senderId != null) return _senderId;
    const envId = process.env.SENDGRID_SENDER_ID;
    if (envId) { _senderId = Number(envId); return _senderId; }
    const from = (process.env.SENDGRID_FROM_EMAIL || '').toLowerCase();
    let senders: SgSender[] = [];
    try {
        const r = await sg<{ results?: SgSender[] } | SgSender[]>('/marketing/senders');
        senders = Array.isArray(r) ? r : (r.results || []);
    } catch {
        const r = await sg<{ results?: SgSender[] } | SgSender[]>('/senders');
        senders = Array.isArray(r) ? r : (r.results || []);
    }
    const match = senders.find((s) => (s.from?.email || '').toLowerCase() === from) || senders[0];
    if (!match) throw new Error('No hay un remitente verificado en SendGrid (Marketing → Senders).');
    _senderId = Number(match.id);
    return _senderId;
}

interface SgGroup { id: number | string; name?: string }

// Id del grupo de supresión (unsubscribe group). SENDGRID_UNSUB_GROUP_ID lo pisa; si no existe uno con
// nuestro nombre, se crea. Requerido por Single Sends para el link de baja legal.
export async function getUnsubGroupId(): Promise<number> {
    if (_unsubGroupId != null) return _unsubGroupId;
    const envId = process.env.SENDGRID_UNSUB_GROUP_ID;
    if (envId) { _unsubGroupId = Number(envId); return _unsubGroupId; }
    const groups = await sg<SgGroup[]>('/asm/groups');
    const found = (Array.isArray(groups) ? groups : []).find((g) => g.name === UNSUB_GROUP_NAME);
    if (found) { _unsubGroupId = Number(found.id); return _unsubGroupId; }
    const created = await sg<SgGroup>('/asm/groups', {
        method: 'POST',
        body: JSON.stringify({ name: UNSUB_GROUP_NAME, description: 'Programa Exclusivas 1·5·10 de Pulppo.', is_default: false })
    });
    _unsubGroupId = Number(created.id);
    return _unsubGroupId;
}

// --- Listas y contactos ---

interface SgList { id: number | string; name?: string }
interface SgListsResp { result?: SgList[]; _metadata?: { next?: string } }

// Busca una lista por nombre exacto (paginado) o la crea. Idempotente: reusar la misma base no la duplica.
export async function getOrCreateList(name: string): Promise<string> {
    let path: string = '/marketing/lists?page_size=100';
    for (let guard = 0; guard < 30 && path; guard++) {
        const r = await sg<SgListsResp>(path);
        const hit = (r.result || []).find((l) => l.name === name);
        if (hit) return String(hit.id);
        const next = r._metadata?.next;
        path = next ? next.replace(BASE, '') : '';
    }
    const created = await sg<SgList>('/marketing/lists', { method: 'POST', body: JSON.stringify({ name }) });
    return String(created.id);
}

// Alta/actualización de contactos en una lista (async del lado de SendGrid; devuelve job_id). El nombre
// se parte en first/last. Máx 30k por request (nuestras bases son < 2k).
export async function addContacts(listId: string, rows: { email: string; nombre?: string }[]): Promise<string> {
    const contacts = rows.slice(0, 30000).map((r) => {
        const parts = (r.nombre || '').trim().split(/\s+/).filter(Boolean);
        const first = parts.shift();
        const last = parts.join(' ');
        return { email: r.email, ...(first ? { first_name: first } : {}), ...(last ? { last_name: last } : {}) };
    });
    const r = await sg<{ job_id?: string }>('/marketing/contacts', {
        method: 'PUT',
        body: JSON.stringify({ list_ids: [listId], contacts })
    });
    return r.job_id || '';
}

// --- Single Sends ---

export interface CreateSendArgs { name: string; subject: string; html: string; listId: string }

// Crea el Single Send como BORRADOR (no se programa aquí). Usa el sender verificado y el grupo de baja.
export async function createSingleSend({ name, subject, html, listId }: CreateSendArgs): Promise<{ id: string; status: string }> {
    const sender_id = await getSenderId();
    const suppression_group_id = await getUnsubGroupId();
    const r = await sg<{ id: string | number; status?: string }>('/marketing/singlesends', {
        method: 'POST',
        body: JSON.stringify({
            name,
            send_to: { list_ids: [listId] },
            email_config: { subject, html_content: html, sender_id, suppression_group_id, editor: 'code' }
        })
    });
    return { id: String(r.id), status: String(r.status || 'draft') };
}

// Programa un Single Send existente. sendAt = ISO 8601 UTC o 'now'. Este es el ÚNICO paso que hace que
// el correo salga: se llama solo tras la aprobación humana.
export async function scheduleSingleSend(id: string, sendAt: string): Promise<{ id: string; status: string; send_at: string }> {
    const r = await sg<{ status?: string; send_at?: string }>(`/marketing/singlesends/${id}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ send_at: sendAt })
    });
    return { id, status: String(r.status || 'scheduled'), send_at: String(r.send_at || sendAt) };
}

// Desprograma (vuelve a borrador) un Single Send ya agendado. Solo funciona antes de la hora de envío.
export async function unscheduleSingleSend(id: string): Promise<void> {
    await sg(`/marketing/singlesends/${id}/schedule`, { method: 'DELETE' });
}

interface SgSingleSend { id: string | number; name?: string; status?: string; send_at?: string }

export async function listSingleSends(): Promise<SgSingleSend[]> {
    const r = await sg<{ result?: SgSingleSend[] }>('/marketing/singlesends?page_size=100');
    return r.result || [];
}

export interface SendStats { delivered?: number; opens?: number; unique_opens?: number; clicks?: number; unique_clicks?: number; unsubscribes?: number; bounces?: number }

export async function singleSendStats(id: string): Promise<SendStats> {
    const r = await sg<{ results?: { stats?: SendStats }[] }>(`/marketing/stats/singlesends/${id}?aggregated_by=total`);
    return (r.results || [])[0]?.stats || {};
}
