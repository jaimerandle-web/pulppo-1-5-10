// inmobiliaria (normalizada) -> KAM/owner.
// Fuente: pestaña "KAM Y REGALÍAS" del Forecast de Revenue Ops
// (customer-cx-pulppo.vercel.app/forecast), 133 cuentas · leído 08-sep-2026.
// Reconciliado contra Mongo: las 104 inmobiliarias con inventario publicado casan 1:1 con esa
// tabla por nombre, así que las llaves son el `company.name` de la plataforma tal cual.
// Sólo quedan TRES KAMs (Laura · Sofia · Karen); Ulises y Pilar ya no llevan cartera. Las cuentas
// dadas de baja o suspendidas no traen KAM en la tabla y aquí caen a 'Sin KAM' por omisión.

function norm(s: string): string {
    let t = String(s)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    for (const ch of ['-', '.', ',', '&']) t = t.split(ch).join(' ');
    return t.split(/\s+/).filter(Boolean).join(' ');
}

const KAM_BY_NORM: Record<string, string> = {
    '1crea bienes raices': 'Sofia',
    '5a avenida real estate': 'Laura',
    '9 square real estate': 'Karen',
    'adama bienes raices': 'Sofia',
    'althia real estate': 'Sofia',
    'andina real estate': 'Laura',
    'arpa arquitectura y patrimonio': 'Karen',
    'arrendo properties': 'Sofia',
    'b b luxe': 'Karen',
    'biens invest': 'Sofia',
    'black brick real estate and investment': 'Karen',
    'bloco bienes raices': 'Sofia',
    'bos inmobiliaria': 'Sofia',
    'broah espacios': 'Laura',
    'caralda promotora': 'Karen',
    'casa 7 real estate': 'Karen',
    'casane properties': 'Sofia',
    'cc vision patrimonial': 'Sofia',
    'cece': 'Laura',
    'centro inmobiliario': 'Laura',
    'cofuco bienes raices': 'Karen',
    'covein bienes raices': 'Sofia',
    'degohouse': 'Sofia',
    'diamond house': 'Sofia',
    'disrupcion urbana': 'Karen',
    'dream house inmobiliaria': 'Karen',
    'enlace fehu': 'Laura',
    'faro inmobiliaria': 'Karen',
    'finver inmobiliaria': 'Laura',
    'fortanza inmobiliaria': 'Sofia',
    'glenview grupo inmobiliario': 'Karen',
    'glomad': 'Laura',
    'godelta': 'Laura',
    'green properties': 'Karen',
    'grupo ada inmobiliaria': 'Karen',
    'grupo jahv': 'Karen',
    'habitanza': 'Sofia',
    'habitare luxury living': 'Laura',
    'harza real estate': 'Laura',
    'haz inmobiliaria': 'Laura',
    'henko bienes raices': 'Sofia',
    'hipoo mx': 'Sofia',
    'hs real estate': 'Sofia',
    'hsvision': 'Laura',
    'humus grupo inmobiliario': 'Karen',
    'ielement inmobiliaria': 'Laura',
    'inin capital': 'Karen',
    'inmo24': 'Karen',
    'inmobiliairia zam': 'Laura',
    'inmobiliaria 24siete': 'Sofia',
    'inmonova inmobiliaria': 'Sofia',
    'inmoshop': 'Sofia',
    'inmovi': 'Laura',
    'kaax real estate': 'Laura',
    'keeper propiedades': 'Laura',
    'kmi': 'Karen',
    'la inmobiliaria': 'Sofia',
    'lumina real state': 'Sofia',
    'luxurium realty': 'Sofia',
    'malgram international': 'Sofia',
    'match inmobiliario': 'Laura',
    'mel inmobiliaria': 'Karen',
    'mercatecnia': 'Karen',
    'mm vitanova': 'Sofia',
    'monolitica real estate': 'Karen',
    'monroy properties real estate': 'Sofia',
    'moobi': 'Karen',
    'mood inmobiliario': 'Laura',
    'morare': 'Karen',
    'nura': 'Sofia',
    'octavia': 'Sofia',
    'opcion inmobiliaria': 'Karen',
    'oras bienes raices': 'Laura',
    'orsa inmobiliaria': 'Sofia',
    'ov bienes raices': 'Laura',
    'ponton asesores': 'Laura',
    'professo bienes raices': 'Karen',
    'pronoia real estate': 'Karen',
    'property match': 'Sofia',
    'proyecto': 'Karen',
    'q inmobiliaria': 'Laura',
    'quatre bienes raices': 'Sofia',
    'reset living': 'Laura',
    'ricoy bienes raices': 'Laura',
    'rocha inmobiliaria': 'Laura',
    'rubi inmobiliaria': 'Sofia',
    'scala hauss': 'Laura',
    'seeker studio real estate': 'Karen',
    'servicios integrales inmobiliarios': 'Karen',
    'sinergia asesores': 'Karen',
    'soso inmobiliaria': 'Laura',
    'ss propiedades': 'Karen',
    't ubika real estate': 'Sofia',
    'talavera real estate': 'Sofia',
    'terraprop': 'Sofia',
    'the property hub': 'Karen',
    'todo en bienes raices': 'Karen',
    'valentinos home sa de cv': 'Karen',
    'vamos a vender': 'Sofia',
    'vive capital br': 'Laura',
    'vive chic real estate': 'Karen',
    'we book realty': 'Laura',
    'wu realestate': 'Karen',
    'zam inmobiliaria': 'Laura',
    'zgm consultores inmobiliarios': 'Laura'
};

export function getKam(nombre?: string | null): string {
    if (!nombre) return 'Sin KAM';
    return KAM_BY_NORM[norm(nombre)] || 'Sin KAM';
}

// Cuentas dadas de baja. Se mantiene a mano: la baja es comercial y NO se refleja en Mongo
// (siguen con status 'active', inventario publicado y leads entrando), así que ninguna señal
// de datos las distingue. Esta lista son las 22 filas con estatus "Baja" de la misma tabla de
// Revenue Ops. Ojo: sólo la baja DEFINITIVA entra aquí — las suspendidas y las que están "en
// proceso de baja" siguen operando y se dejan a la vista (BR23, Círculo, HENKO, Zam).
const BAJAS = new Set<string>([
    'achavez asesores bienes raices',
    'ancona plus',
    'bienes raices torillo',
    'biens invest',
    'bivo inmobiliaria',
    'cool living',
    'galdan realtors',
    'grupo morada',
    'habix grupo inmobiliario',
    'imagine inmobiliaria',
    'inmobiliaria broker premium',
    'key finder inmobiliaria',
    'lumina real state',
    'macvende s a de c v',
    'map bienes raices',
    'marube bienes raices',
    'mv21 grupo inmobiliario',
    'paquebeas2home',
    'portalto inmobiliairia',
    'terraprop',
    'top ten property',
    'vive bien inmobiliaria'
]);

export function esBaja(nombre?: string | null): boolean {
    return !!nombre && BAJAS.has(norm(nombre));
}
