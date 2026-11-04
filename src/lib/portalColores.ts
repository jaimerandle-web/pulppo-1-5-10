// Color de cada canal en /mb (Joshua, nov-2026): el color principal del logo de cada portal, «quemado»
// (más oscuro y menos saturado) para que no grite junto a la paleta de Pulppo. Sin imports: lo usan
// componentes de cliente. Las llaves son los nombres de canal de portales/metrics.ts (KEY2NAME) más
// «Inmuebles24 · Premier» (portales/inmobiliaria.ts I24_PREMIER).
export const COLOR_CANAL: Record<string, string> = {
    'Inmuebles24': '#C8642A',            // naranja i24, quemado
    'Inmuebles24 · Premier': '#A8822B',  // dorado: la cuenta Premier
    'Inmuebles24 · NURA': '#8C5A3C',
    'MercadoLibre': '#2E3A78',           // azul del logo de MeLi (el amarillo choca con el de Pulppo)
    'Propiedades.com': '#B4473A',        // rojo de propiedades.com, quemado
    'Casas y Terrenos': '#3F7F5C',       // verde
    'EasyBroker': '#2F6A9E',             // azul EasyBroker
    'Meta (FB/IG)': '#4A5FA8',
    'WhatsApp': '#3E8E68',
    'Pulppo': '#212322',
    'Tokko': '#6B5A8E',
    'Teléfono Pulppo': '#5E6160',
    'Doorvel': '#7A6F5A',
    'Sitio propio': '#529999',
    'Otras fuentes': '#B7B7B7',
    'Sin fuente': '#D6D6D6',
};
export const colorCanal = (nombre: string, i = 0) => COLOR_CANAL[nombre] ?? ['#8A8C8B', '#C79A00', '#9FC7C7', '#5E6160', '#E8D48A'][i % 5];
