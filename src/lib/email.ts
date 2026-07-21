// Generador de campañas de email 1·5·10. Toma la propiedad viva de Mongo y llena el template
// on-brand "Exclusiva de la semana" (tablas Outlook-safe, Nunito Sans, negro/dorado). Port del
// script build_campanas_final.py: mismo template, mismos tokens, pero alimentado en vivo.
import { ObjectId, type Document } from 'mongodb';
import { getDb } from './data';

const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dig = (d: Document | null | undefined, ...ks: string[]): unknown => {
    let x: unknown = d;
    for (const k of ks) x = x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined;
    return x;
};
const num = (x: unknown): number | null => (typeof x === 'number' && !isNaN(x) ? x : null);
const intOrDash = (x: unknown) => { const n = num(x); return n == null ? '—' : String(Math.round(n)); };

// URL pública de la propiedad en pulppo.com (misma convención que src/lib/data.ts).
const propUrl = (id: string) => `https://pulppo.com/propiedades/${id}`;

// Las fotos de Mongo (images.pulppo.com) vienen en resolución original (~1.5 MB) y hacen lento el correo.
// El correo solo muestra la portada a 500px, así que la servimos redimensionada por el optimizador de
// imágenes de pulppo.com (Next/Image): ~70 KB (22× más ligera). Solo aplica a fotos propias; cualquier
// otra URL se deja igual. Next negocia el formato por Accept, así que a Outlook (sin webp) le da JPEG.
const IMG_W = 750;   // ancho pedido (display 500px → nítido en retina). Anchos válidos: 640/750/828/1080
const IMG_Q = 70;    // calidad
function optimizeImg(raw: string): string {
    if (!raw || !/^https?:\/\/images\.pulppo\.com\//i.test(raw)) return raw;
    return `https://pulppo.com/_next/image?url=${encodeURIComponent(raw)}&w=${IMG_W}&q=${IMG_Q}`;
}

export interface Campaign {
    id: string;        // ObjectId de la propiedad (para links/UTMs)
    code: string;      // internalId legible (CTA-422)
    title: string;
    subject: string;   // asunto sugerido (editable en la UI)
    zona: string | null;
    html: string;
}

// Resuelve por ObjectId o por internalId (código legible tipo CTA-422).
async function findProperty(idOrCode: string): Promise<Document | null> {
    const db = await getDb();
    let P: Document | null = null;
    try { P = await db.collection('properties').findOne({ _id: new ObjectId(idOrCode) }); } catch { /* no es ObjectId */ }
    if (!P) P = await db.collection('properties').findOne({ internalId: idOrCode.trim().toUpperCase() });
    return P;
}

export async function renderCampaign(
    idOrCode: string,
    opts: { hook?: string; subject?: string } = {}
): Promise<Campaign | null> {
    const P = await findProperty(idOrCode);
    if (!P) return null;

    const id = String(P._id);
    const code = (P.internalId as string) ?? id;
    const title = (dig(P, 'listing', 'title') as string) ?? `Exclusiva ${code}`;
    const price = num(dig(P, 'listing', 'value'));
    const m2 = num(dig(P, 'attributes', 'totalSurface')) ?? num(dig(P, 'attributes', 'surface'));
    const rec = dig(P, 'attributes', 'suites');
    const banos = dig(P, 'attributes', 'bathrooms');
    const park = dig(P, 'attributes', 'parkings');
    const zona = (dig(P, 'address', 'neighborhood', 'name') as string)
        ?? (dig(P, 'address', 'city', 'name') as string) ?? null;

    // Portada = primera foto pública.
    const pics = ((P.pictures as Document[]) || []).filter((x) => x.public !== false);
    const img = optimizeImg((pics[0]?.url as string) ?? (pics[0]?.src as string) ?? '');

    const campaign = `exclusiva_${code}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const hook = opts.hook?.trim() || (zona ? `Una propiedad que lo tiene todo en ${zona}` : 'Una oportunidad única, seleccionada para ti');
    const subject = opts.subject?.trim() || `Exclusiva de la semana: ${title}`;

    const map: Record<string, string> = {
        __TITLE__: esc(title),
        __HOOK__: esc(hook),
        __ID__: `propiedades/${id}`,
        __IMG__: esc(img),
        __M2__: m2 == null ? '—' : String(Math.round(m2)),
        __REC__: intOrDash(rec),
        __BANOS__: intOrDash(banos),
        __PARK__: intOrDash(park),
        __PRICE__: price == null ? '—' : Math.round(price).toLocaleString('en-US'),
        __CAMPAIGN__: campaign
    };
    const html = Object.entries(map).reduce((s, [k, v]) => s.replaceAll(k, v), TEMPLATE);
    return { id, code, title, subject, zona, html };
}

// Footer de baja + dirección física, requerido por SendGrid al enviar con grupo de supresión (Single
// Sends). Se inyecta SOLO en el envío por marketing (Fase 2); el preview y la prueba usan el template
// limpio. `<%asm_group_unsubscribe_raw_url%>` lo reemplaza SendGrid con el link real de cada destinatario.
export function withUnsubFooter(html: string): string {
    const addr = process.env.SENDGRID_FOOTER_ADDRESS || 'Pulppo · Ciudad de México, México';
    const footer = `
       <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
        <tr>
         <td align="center" style="padding: 18px 20px 24px 20px; font-family: 'Nunito Sans', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #B7B7B7;">
          ${esc(addr)}<br />
          Recibes este correo porque dejaste tus datos en una propiedad de Pulppo.<br />
          <a href="<%asm_group_unsubscribe_raw_url%>" style="color: #529999; text-decoration: underline; font-weight: 700;">Cancelar suscripci&#243;n</a>
         </td>
        </tr>
       </table>`;
    return html.replace('</body>', `${footer}\n</body>`);
}

// Template "Exclusiva de la semana" (idéntico a campañas-email/_template_exclusiva.html).
// Los links usan __ID__ = "propiedades/<id>" para apuntar a la ficha pública de pulppo.com.
const TEMPLATE = `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">

<head>
 <meta charset="UTF-8" />
 <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
 <meta http-equiv="X-UA-Compatible" content="IE=edge" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
 <meta name="x-apple-disable-message-reformatting" />
 <link href="https://fonts.googleapis.com/css?family=Nunito+Sans:ital,wght@0,300;0,400;0,400;0,500;0,700" rel="stylesheet" />
 <title>__TITLE__</title>
 <style>
 html, body { margin: 0 !important; padding: 0 !important; min-height: 100% !important; width: 100% !important; -webkit-font-smoothing: antialiased; }
 table, td, th { mso-table-lspace: 0 !important; mso-table-rspace: 0 !important; border-collapse: collapse; }
 img { border: 0; outline: 0; line-height: 100%; text-decoration: none; -ms-interpolation-mode: bicubic; }
 @media (max-width: 620px) {
 .pc-project-body { min-width: 0px !important; }
 .pc-project-container { width: 100% !important; }
 .pc-w620-font-size-28px { font-size: 28px !important; }
 .pc-w620-font-size-18px { font-size: 18px !important; }
 .pc-w620-font-size-16px { font-size: 16px !important; }
 }
 </style>
</head>

<body style="width: 100% !important; margin: 0 !important; padding: 0 !important; line-height: 1.5; color: #212322; background-color: #f4f4f4;" bgcolor="#f4f4f4">
 <table class="pc-project-body" style="table-layout: fixed; width: 100%; min-width: 600px; background-color: #f4f4f4;" bgcolor="#f4f4f4" border="0" cellspacing="0" cellpadding="0" role="presentation">
  <tr>
   <td align="center" valign="top">
    <table class="pc-project-container" align="center" style="width: 600px; max-width: 600px;" border="0" cellpadding="0" cellspacing="0" role="presentation">
     <tr>
      <td style="padding: 20px 0px;" align="left" valign="top">

       <!-- HEADER DARK -->
       <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
        <tr>
         <td valign="top" style="padding: 40px; background-color: #212322;" bgcolor="#212322">
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr>
            <td align="right" valign="top" style="padding: 0px 0px 20px 0px;">
             <a href="https://pulppo.com/?utm_source=email&amp;utm_medium=mkt&amp;utm_campaign=exclusiva" target="_blank" style="text-decoration: none;">
              <img src="https://api-postcards.designmodo.com/files/images/user-91775/image-1718405050778.png" width="160" height="68" alt="Pulppo" style="display: block; width: 160px; height: auto; max-width: 100%; border: 0;" />
             </a>
            </td>
           </tr>
          </table>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr>
            <td align="center" valign="top" style="padding: 0px 0px 20px 0px;">
             <div style="font-size: 30px; line-height: 100%; text-align: center; color: #ffffff; letter-spacing: 5px; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif; text-transform: uppercase;" class="pc-w620-font-size-28px">EXCLUSIVA DE LA SEMANA</div>
            </td>
           </tr>
          </table>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr><td valign="top" style="line-height: 1px; font-size: 1px; border-bottom: 1px solid #f6be00;">&nbsp;</td></tr>
          </table>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr>
            <td valign="top" style="padding: 20px 20px 20px 0px;">
             <div style="font-size: 18px; line-height: 130%; text-align: left; color: #ffffff; font-weight: 300; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-16px">Las oportunidades como esta no aparecen todos los días. Seleccionamos una propiedad que lo tiene TODO y que no estará disponible por mucho tiempo.</div>
             <div style="font-size: 18px; line-height: 130%;"><br></div>
             <div style="font-size: 18px; line-height: 130%; color: #ffffff; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-16px">__HOOK__ &#128142;</div>
            </td>
           </tr>
          </table>

          <!-- PROPERTY CARD -->
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #FFFFFF;">
           <tr>
            <td align="center" valign="top" style="padding: 20px 20px 17px 20px;">
             <a href="https://pulppo.com/__ID__?utm_source=sendgrid&amp;utm_medium=email&amp;utm_campaign=__CAMPAIGN__" target="_blank" style="text-decoration: none;">
              <img src="__IMG__" width="500" height="333" alt="__TITLE__" style="display: block; width: 500px; height: auto; max-width: 100%; border: 0;" />
             </a>
            </td>
           </tr>
           <tr>
            <td valign="top" style="padding: 0px 0px 20px 30px;">
             <a href="https://pulppo.com/__ID__?utm_source=sendgrid&amp;utm_medium=email&amp;utm_campaign=__CAMPAIGN__" target="_blank" style="text-decoration: none;">
              <span style="font-size: 20px; line-height: 23px; text-align: left; color: #212322; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif; display: inline-block;" class="pc-w620-font-size-18px">__TITLE__</span>
             </a>
            </td>
           </tr>
           <tr>
            <td style="padding: 0px 30px 10px 30px;">
             <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
               <td align="left" valign="top" style="padding: 0 10px;"><div style="font-size: 20px; color: #212322; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-16px">__M2__ m&#178;</div></td>
               <td align="left" valign="top" style="padding: 0 10px;"><div style="font-size: 20px; color: #212322; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;">__REC__</div></td>
               <td align="left" valign="top" style="padding: 0 10px;"><div style="font-size: 20px; color: #212322; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-16px">__BANOS__</div></td>
               <td align="left" valign="top" style="padding: 0 10px;"><div style="font-size: 20px; color: #212322; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;">__PARK__</div></td>
              </tr>
              <tr>
               <td bgcolor="#FFFFFF" align="left" valign="top" style="padding: 10px;"><div style="font-size: 15px; color: #212322; font-family: 'Nunito Sans', Arial, sans-serif;">Superficie total</div></td>
               <td align="left" valign="top" style="padding: 10px;"><div style="font-size: 15px; color: #212322; font-family: 'Nunito Sans', Arial, sans-serif;">Rec&#225;maras</div></td>
               <td align="left" valign="top" style="padding: 10px;"><div style="font-size: 15px; color: #212322; font-family: 'Nunito Sans', Arial, sans-serif;">Ba&#241;os</div></td>
               <td align="left" valign="top" style="padding: 10px;"><div style="font-size: 15px; color: #212322; font-family: 'Nunito Sans', Arial, sans-serif;">Estacionamientos</div></td>
              </tr>
             </table>
            </td>
           </tr>
           <tr>
            <td style="padding: 5px 30px 20px 30px;">
             <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width: 100%;">
              <tr><td bgcolor="#212322" align="left" valign="middle" style="padding: 10px 20px; background-color: #212322;">
               <div style="font-size: 20px; line-height: 100%; color: #ffffff; letter-spacing: 1px; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-18px">$__PRICE__ <span style="font-weight: 400;">MXN</span></div>
              </td></tr>
             </table>
            </td>
           </tr>
          </table>

          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr><td valign="top" style="padding: 20px 0px 0px 0px;"><table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td valign="top" style="line-height: 1px; font-size: 1px; border-bottom: 1px solid #f6be00;">&nbsp;</td></tr></table></td></tr>
          </table>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr>
            <th valign="top" align="center" style="padding: 20px 0px 0px 0px; text-align: center;">
             <a style="display: inline-block; box-sizing: border-box; background-color: #ffffff; padding: 14px 19px; width: 100%; font-family: 'Nunito Sans', Arial, sans-serif; text-align: center; text-decoration: none;" href="https://pulppo.com/__ID__?utm_source=sendgrid&amp;utm_medium=email&amp;utm_campaign=__CAMPAIGN__" target="_blank"><span style="font-size: 20px; line-height: 24px; color: #212322; letter-spacing: -0.2px; font-weight: 700; font-family: 'Nunito Sans', Arial, sans-serif;">DESCUBRE M&#193;S DETALLES</span></a>
            </th>
           </tr>
          </table>
         </td>
        </tr>
       </table>

       <!-- BANNER VER MÁS -->
       <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
        <tr>
         <td valign="top" style="padding: 0px 20px; background-color: #ffffff;" bgcolor="#ffffff">
          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
           <tr>
            <td valign="middle" style="padding: 10px;" width="120">
             <img src="https://s1.designmodo.com/postcards/image-1718840402308.png" width="88" height="auto" alt="" style="display: block; width: 100%; height: auto; border: 0;" />
            </td>
            <td valign="middle" style="padding: 10px 0px;">
             <div style="font-size: 16px; line-height: 21px; color: #333333; font-weight: 400; font-family: 'Nunito Sans', Arial, sans-serif;" class="pc-w620-font-size-16px">&#191;Te gustar&#237;a ver m&#225;s<br>propiedades de lujo?</div>
            </td>
            <td valign="middle" align="right" style="padding: 10px;">
             <a style="display: inline-block; background-color: #212322; padding: 7px 30px; font-family: 'Nunito Sans', Arial, sans-serif; text-decoration: none;" href="https://pulppo.com/departamento-o-casa-o-casa-en-condominio-venta-desde-25000000-pesos-exclusiva?utm_source=sendgrid&amp;utm_medium=email&amp;utm_campaign=__CAMPAIGN__" target="_blank"><span style="font-size: 16px; line-height: 24px; color: #ffffff; font-weight: 500; font-family: 'Nunito Sans', Arial, sans-serif;">Ver aqu&#237;</span></a>
            </td>
           </tr>
          </table>
         </td>
        </tr>
       </table>

       <!-- SOCIAL -->
       <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
        <tr>
         <td valign="top" style="padding: 10px 0px 20px 0px;" align="center">
          <a href="https://www.youtube.com/@pulppo" target="_blank" style="text-decoration: none; padding: 0 8px;"><img src="https://s1.designmodo.com/postcards/3fd2c78e3c5ad284eb73b71fdc4f7cb0.png" width="20" height="20" alt="YouTube" style="display: inline-block; border: 0;" /></a>
          <a href="https://www.facebook.com/pulppomx" target="_blank" style="text-decoration: none; padding: 0 8px;"><img src="https://s1.designmodo.com/postcards/ec49db344110c879f8e2f7f1b60a3501.png" width="20" height="20" alt="Facebook" style="display: inline-block; border: 0;" /></a>
          <a href="https://www.instagram.com/pulppomx" target="_blank" style="text-decoration: none; padding: 0 8px;"><img src="https://s1.designmodo.com/postcards/0ddcb8841f5b868d5e7e584d52b7c973.png" width="20" height="20" alt="Instagram" style="display: inline-block; border: 0;" /></a>
          <a href="https://www.tiktok.com/@pulppomx" target="_blank" style="text-decoration: none; padding: 0 8px;"><img src="https://s1.designmodo.com/postcards/7ea801314b703484917c139c7005c9c0.png" width="20" height="20" alt="TikTok" style="display: inline-block; border: 0;" /></a>
          <a href="https://www.linkedin.com/company/77576559" target="_blank" style="text-decoration: none; padding: 0 8px;"><img src="https://s1.designmodo.com/postcards/40595def03cfe9d93f7bceb9dab3f149.png" width="20" height="20" alt="LinkedIn" style="display: inline-block; border: 0;" /></a>
         </td>
        </tr>
       </table>

      </td>
     </tr>
    </table>
   </td>
  </tr>
 </table>
</body>

</html>`;
