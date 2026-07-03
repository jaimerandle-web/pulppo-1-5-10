export const CATS = [
    'Inmuebles24', 'MercadoLibre', 'Pulppo', 'Red brokers', 'WhatsApp', 'Redes sociales',
    'Teléfono', 'Orgánico/Google', 'Otros portales', 'Lamudi', 'Otros', 'Sin fuente'
] as const;

// Una fila por exclusiva VIVA (published) con desempeño (port de fetch_rows).
export interface CarteraRow {
    id: string;
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
    op_status: string | null;
    leads_total: number;
    visitas: number;
    fotos: number;
    video: boolean;
    tour: boolean;
    material_ok: boolean;
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
