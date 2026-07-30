export const CATS = [
    'Inmuebles24', 'MercadoLibre', 'Pulppo', 'Red brokers', 'WhatsApp', 'Redes sociales',
    'Teléfono', 'Orgánico/Google', 'Otros portales', 'Lamudi', 'Otros', 'Sin fuente'
] as const;

// Una fila por exclusiva VIVA (published) con desempeño (port de fetch_rows).
export interface CarteraRow {
    id: string;
    internalId: string | null;
    inmobiliaria: string | null;
    broker: string;
    kam: string;
    tipo: string | null;
    titulo: string | null;
    precio: number | null;
    colonia: string | null;
    ciudad: string | null;
    estado: string | null;
    dias_activa: number | null;
    dur_meses: number;         // duración de la exclusiva (contract.exclusive.durationMonths, default 6)
    op_status: string | null;
    leads_total: number;
    visitas: number;
    fotos: number;
    video: boolean;
    tour: boolean;
    material_ok: boolean;
    i24_type: string | null;   // producto en Inmuebles24 (HOME_COMBO, SIMPLE_COMBO, OFFLINE, …)
    superdestacada: boolean;   // true si i24_type es HOME_COMBO o HOME_COMBO_ZONA_DEMAND
    zona_oferta: number | null; // # publicados en venta en la misma colonia (competencia de la zona)
    serie: { week: string; leads: number; visitas: number }[]; // desempeño semanal desde el alta
    url: string;
    leads: Record<string, number>; // por categoría de fuente (CATS)
}

// Una fila por propiedad del programa completo (port de fetch_program).
export interface ProgramRow {
    id: string;
    internalId: string | null;
    bono_est: number | null;
    inmobiliaria: string | null;
    kam: string;
    tipo: string | null;
    precio: number | null;
    precio_cierre: number | null;
    ciudad: string | null;
    colonia: string | null;
    status: string | null;
    op_status: string | null;
    alta: string | null;       // ISO
    alta_mes: string | null;   // YYYY-MM
    dur_meses: number;
    vendida: boolean;
    venta_mes: string | null;
    venta_fecha: string | null; // ISO
    cierre_fin: string | null;
    comision: number | null;
    regalia: number | null;
    com_comprador: number | null;
    factura: string | null;
    op_id: string | null;
    side: string | null;
    vendedor: string | null;
    inmo_vendedor: string | null;
    broker_comprador: string | null;
    inmo_comprador: string | null;
    dias_venta: number | null;
    dias_activa: number | null;
    en_proceso: boolean;
}

export interface DataPayload {
    rows: CarteraRow[];
    program: ProgramRow[];
    fetchedAt: string;
}

// ---- Desempeño de campañas (pestaña Campañas) ----

// Una exclusiva viva con leads atribuidos al correo (source='email').
export interface EmailPropRow {
    id: string;
    internalId: string | null;
    titulo: string | null;
    inmobiliaria: string | null;
    kam: string;
    colonia: string | null;
    tipo: string | null;
    precio: number | null;
    campaign: string | null;              // exclusiva_<código> (o el newsletter viejo)
    email_leads: number;
    por_medio: Record<string, number>;    // whatsapp / form / call …
    ultima: string | null;                // ISO del lead más reciente
}

// Campaña de correo detectada en toda la base (contexto histórico).
export interface EmailCampaign {
    campaign: string | null;
    leads: number;
    ultima: string | null;
    es_1_5_10: boolean;                    // esquema nuevo exclusiva_<código>
}

// Una exclusiva viva con leads de redes (Facebook/Instagram) + salud de atribución del pixel.
export interface SocialPropRow {
    id: string;
    internalId: string | null;
    titulo: string | null;
    inmobiliaria: string | null;
    kam: string;
    colonia: string | null;
    tipo: string | null;
    facebook: number;
    instagram: number;
    social_total: number;
    bien_atribuidos: number;               // medium limpio (form/whatsapp/lead ads)
    fuga: number;                          // medium vacío o referrer/URL → pixel/UTM sin conectar
    mediums: Record<string, number>;
}

// Un lead individual de Meta (nivel lead, con contacto) para el recap de seguimiento.
export interface RecentLeadRow {
    id: string;                            // id de la propiedad (para link)
    fecha: string | null;                  // ISO createdAt
    inmobiliaria: string | null;
    kam: string;
    internalId: string | null;
    broker: string | null;
    direccion: string | null;              // calle y número (address.street)
    red: 'Facebook' | 'Instagram';
    medio: string | null;                  // medium (form/whatsapp/lead ads…)
    nombre: string | null;
    whatsapp: string | null;
    email: string | null;
}

export interface CampaignPerf {
    liveCount: number;
    email: {
        porPropiedad: EmailPropRow[];
        campanas: EmailCampaign[];
        totalLive: number;
        totalPrograma: number;
    };
    social: {
        porPropiedad: SocialPropRow[];
        totalFacebook: number;
        totalInstagram: number;
        mediumBreakdown: { name: string; value: number }[];
        sourceSpellings: { name: string; value: number }[];
        bienAtribuidos: number;
        fuga: number;
        conSocial: number;
        sinSocial: number;
        recientes: RecentLeadRow[];
    };
    generatedAt: string;
}

// Estado + métricas de un Single Send de SendGrid (envío 1·5·10).
export interface SendItem {
    id: string;
    name: string | null;
    status: string | null;
    send_at: string | null;
    stats: {
        delivered?: number;
        opens?: number;
        unique_opens?: number;
        clicks?: number;
        unique_clicks?: number;
        unsubscribes?: number;
        bounces?: number;
    } | null;
}

export interface CampaignPayload {
    perf: CampaignPerf;
    sends: SendItem[];
    sendsError: string | null;             // si SendGrid no respondió (sin key/scope)
}
