// Cliente de SendGrid Marketing Campaigns v3 (Single Sends) vía REST, sin dependencias (fetch nativo).
// Fase 2 del módulo de campañas: sincroniza una base como Lista, crea un Single Send on-brand (con footer
// de baja obligatorio) y lo deja como BORRADOR; la programación real ocurre SOLO tras aprobación explícita
// (human-in-the-loop). SendGrid maneja bajas, supresión (bounces/unsubs) y métricas de campaña.

import { extractEmail } from './validEmail';

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

// Alta/actualización de contactos en una lista (async del lado de SendGrid; devuelve job_id + cuántos
// se subieron). SendGrid rechaza TODO el lote si un solo correo es inválido, así que filtramos con
// validEmail y deduplicamos aquí también (malla de seguridad extra sobre el filtro del origen).
export async function addContacts(
    listId: string,
    rows: { email: string; nombre?: string }[]
): Promise<{ jobId: string; uploaded: number; skipped: number }> {
    const seen = new Set<string>();
    const contacts: Array<{ email: string; first_name?: string; last_name?: string }> = [];
    let skipped = 0;
    for (const r of rows) {
        const email = extractEmail(r.email || '');
        if (!email || seen.has(email)) { skipped++; continue; }
        seen.add(email);
        const parts = (r.nombre || '').trim().split(/\s+/).filter(Boolean);
        const first = parts.shift();
        const last = parts.join(' ');
        contacts.push({ email, ...(first ? { first_name: first } : {}), ...(last ? { last_name: last } : {}) });
        if (contacts.length >= 30000) break;
    }
    if (!contacts.length) throw new Error('La base no tiene correos válidos para SendGrid');
    const r = await sg<{ job_id?: string }>('/marketing/contacts', {
        method: 'PUT',
        body: JSON.stringify({ list_ids: [listId], contacts })
    });
    return { jobId: r.job_id || '', uploaded: contacts.length, skipped };
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
    let path: string = '/marketing/singlesends?page_size=100';
    const out: SgSingleSend[] = [];
    for (let guard = 0; guard < 20 && path; guard++) {
        const r = await sg<{ result?: SgSingleSend[]; _metadata?: { next?: string } }>(path);
        out.push(...(r.result || []));
        const next = r._metadata?.next;
        path = next ? next.replace(BASE, '') : '';
    }
    return out;
}

// --- Anti-duplicado de propiedades (Mongo es read-only, así que la fuente de verdad es SendGrid) ---
// Los códigos de propiedad de cada digest se guardan en el `name` del Single Send como sufijo " [DLI-1,DLI-2]".
// Así se pueden leer de vuelta con listSingleSends() para no reenviar una propiedad que ya salió/está en cola.
const CODES_RE = /\[([^\]]+)\]\s*$/;
export function encodeCodesInName(base: string, codes: string[]): string {
    const tag = codes.length ? ` [${codes.map((c) => c.toUpperCase()).join(',')}]` : '';
    return (base.slice(0, 99 - tag.length) + tag).slice(0, 100);
}
export function parseCodesFromName(name?: string): string[] {
    const m = CODES_RE.exec(name || '');
    return m ? m[1].split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : [];
}
export interface ClaimInfo { name: string; status: string; sendAt: string | null }
// Propiedades ya comprometidas en un Single Send activo (borrador/programado/enviado) dentro de la ventana.
// Los borradores (sin fecha) siempre cuentan; programados/enviados solo si caen dentro de windowDays.
export async function claimedPropertyCodes(windowDays = 90): Promise<Map<string, ClaimInfo>> {
    const sends = await listSingleSends();
    const cutoff = Date.now() - windowDays * 864e5;
    const map = new Map<string, ClaimInfo>();
    for (const s of sends) {
        const status = String(s.status || '');
        if (status === 'canceled') continue;
        const sendAt = s.send_at ? String(s.send_at) : null;
        if (sendAt && new Date(sendAt).getTime() < cutoff) continue;
        for (const code of parseCodesFromName(s.name)) if (!map.has(code)) map.set(code, { name: s.name || '', status, sendAt });
    }
    return map;
}

// --- Anti-duplicado del LISTADO de correos por semana ---
// Misma zona = misma lista = misma audiencia exacta; y las zonas se diseñan casi disjuntas y se dedup dentro
// del lote. Así que basta con no programar dos envíos de la MISMA zona en la MISMA semana ISO (eso mandaría
// el correo dos veces a toda la lista). La zona y la fecha se leen del `name` del Single Send.
const NAME_ZONE_DATE_RE = /Exclusivas\s+(.+?)\s+·\s+(\d{4}-\d{2}-\d{2})/;
const zonaNrm = (z: string) => z.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export function isoWeekKey(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // jueves de esa semana ISO
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
    const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 864e5));
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export const zoneWeekKey = (zona: string, isoWeek: string): string => `${zonaNrm(zona)}|${isoWeek}`;
export interface ZoneWeekInfo { zona: string; date: string; week: string; status: string }
// Zonas×semana ya ocupadas por un Single Send activo (borrador/programado/enviado). La semana sale de la
// FECHA del name (disponible también en borradores, a diferencia de send_at).
export async function scheduledZoneWeeks(): Promise<Map<string, ZoneWeekInfo>> {
    const sends = await listSingleSends();
    const map = new Map<string, ZoneWeekInfo>();
    for (const s of sends) {
        const status = String(s.status || '');
        if (status === 'canceled') continue;
        const m = NAME_ZONE_DATE_RE.exec(s.name || '');
        if (!m) continue;
        const zona = m[1].trim(), date = m[2];
        const week = isoWeekKey(new Date(`${date}T00:00:00Z`));
        map.set(zoneWeekKey(zona, week), { zona, date, week, status });
    }
    return map;
}

export interface SendStats { delivered?: number; opens?: number; unique_opens?: number; clicks?: number; unique_clicks?: number; unsubscribes?: number; bounces?: number }

export async function singleSendStats(id: string): Promise<SendStats> {
    const r = await sg<{ results?: { stats?: SendStats }[] }>(`/marketing/stats/singlesends/${id}?aggregated_by=total`);
    return (r.results || [])[0]?.stats || {};
}
