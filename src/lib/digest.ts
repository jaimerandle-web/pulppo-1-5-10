// Digest "Exclusivas de la semana · <Zona>": un solo correo con VARIAS propiedades de una misma zona.
// Resuelve el problema de calendario (una persona recibe un solo correo aunque le toquen varias) sin
// perder relevancia (cada zona ve lo suyo). Cada tarjeta conserva su utm_campaign por propiedad, así la
// atribución de leads sigue siendo por propiedad. Reusa renderPropertyCard de email.ts.
import { findProperty, renderPropertyCard } from './email';

export interface Digest { subject: string; html: string; zonaName: string; count: number; codes: string[] }

export async function renderDigest(
    zonaName: string,
    codes: string[],
    opts: { subject?: string } = {}
): Promise<Digest | null> {
    const cards: string[] = [];
    const used: string[] = [];
    for (const c of codes) {
        const P = await findProperty(c);
        if (!P) continue;
        cards.push(renderPropertyCard(P));
        used.push((P.internalId as string) ?? String(P._id));
    }
    if (!cards.length) return null;

    const one = cards.length === 1;   // singular vs plural en título, asunto e intro
    const heading = one ? 'EXCLUSIVA DE LA SEMANA' : 'EXCLUSIVAS DE LA SEMANA';
    const intro = one
        ? 'Esta es la propiedad exclusiva que seleccionamos esta semana para ti. Una oportunidad que no estar&#225; disponible por mucho tiempo &#128142;'
        : 'Estas son las propiedades exclusivas que seleccionamos esta semana en tu zona. Oportunidades que no estar&#225;n disponibles por mucho tiempo &#128142;';

    const body = cards.map((card) => `<tr><td style="padding:0 20px 18px 20px;">${card}</td></tr>`).join('');
    const subject = opts.subject?.trim() || (one ? 'Exclusiva de la semana' : 'Exclusivas de la semana');
    const html = TEMPLATE.replace('__HEADING__', heading).replace('__INTRO__', intro).replace('__CARDS__', body);
    return { subject, html, zonaName, count: cards.length, codes: used };
}

// Plantilla del digest (Outlook-safe, on-brand: negro #212322 / dorado #F6BE00 / Nunito Sans).
const TEMPLATE = `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
 <meta charset="UTF-8" />
 <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <meta name="x-apple-disable-message-reformatting" />
 <link href="https://fonts.googleapis.com/css?family=Nunito+Sans:ital,wght@0,300;0,400;0,500;0,700" rel="stylesheet" />
 <title>Exclusivas de la semana</title>
 <style>
 html, body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-font-smoothing:antialiased; }
 table, td, th { mso-table-lspace:0 !important; mso-table-rspace:0 !important; border-collapse:collapse; }
 img { border:0; outline:0; line-height:100%; text-decoration:none; -ms-interpolation-mode:bicubic; }
 @media (max-width:620px){ .pc-project-container{ width:100% !important; } }
 </style>
</head>
<body style="width:100% !important;margin:0 !important;padding:0 !important;line-height:1.5;color:#212322;background-color:#f4f4f4;" bgcolor="#f4f4f4">
 <table class="pc-project-body" style="table-layout:fixed;width:100%;min-width:600px;background-color:#f4f4f4;" bgcolor="#f4f4f4" border="0" cellspacing="0" cellpadding="0" role="presentation">
  <tr><td align="center" valign="top">
   <table class="pc-project-container" align="center" style="width:600px;max-width:600px;" border="0" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td style="padding:20px 0;" align="left" valign="top">

     <!-- HEADER -->
     <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
      <tr><td valign="top" style="padding:36px 40px 30px 40px;background-color:#212322;" bgcolor="#212322">
       <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td align="right" valign="top" style="padding:0 0 18px 0;">
         <a href="https://pulppo.com/?utm_source=email&amp;utm_medium=email&amp;utm_campaign=exclusivas_semana" target="_blank" style="text-decoration:none;">
          <img src="https://api-postcards.designmodo.com/files/images/user-91775/image-1718405050778.png" width="150" height="64" alt="Pulppo" style="display:block;width:150px;height:auto;border:0;" /></a>
        </td>
       </tr></table>
       <div style="font-size:28px;line-height:110%;color:#ffffff;letter-spacing:4px;font-weight:700;font-family:'Nunito Sans',Arial,sans-serif;text-transform:uppercase;">__HEADING__</div>
       <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td valign="top" style="padding-top:16px;line-height:1px;font-size:1px;border-bottom:1px solid #f6be00;">&nbsp;</td></tr></table>
       <div style="margin-top:16px;font-size:16px;line-height:135%;color:#ffffff;font-weight:300;font-family:'Nunito Sans',Arial,sans-serif;">__INTRO__</div>
      </td></tr>
     </table>

     <!-- CARDS -->
     <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="background-color:#f4f4f4;">
      <tr><td style="height:18px;line-height:18px;font-size:18px;">&nbsp;</td></tr>
      __CARDS__
     </table>

     <!-- BANNER VER MÁS -->
     <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
      <tr><td valign="top" style="padding:0 20px;background-color:#ffffff;" bgcolor="#ffffff">
       <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td valign="middle" style="padding:14px 10px;"><div style="font-size:16px;line-height:21px;color:#333333;font-family:'Nunito Sans',Arial,sans-serif;">&#191;Quieres ver m&#225;s propiedades en exclusiva?</div></td>
        <td valign="middle" align="right" style="padding:10px;"><a style="display:inline-block;background-color:#212322;padding:8px 28px;font-family:'Nunito Sans',Arial,sans-serif;text-decoration:none;" href="https://pulppo.com/m/propiedades-en-exclusiva?utm_source=email&amp;utm_medium=email&amp;utm_campaign=exclusivas_semana" target="_blank"><span style="font-size:15px;color:#ffffff;font-weight:500;font-family:'Nunito Sans',Arial,sans-serif;">Ver aqu&#237;</span></a></td>
       </tr></table>
      </td></tr>
     </table>

     <!-- SOCIAL -->
     <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
      <tr><td valign="top" style="padding:14px 0 20px 0;" align="center">
       <a href="https://www.youtube.com/@pulppo" target="_blank" style="text-decoration:none;padding:0 8px;"><img src="https://s1.designmodo.com/postcards/3fd2c78e3c5ad284eb73b71fdc4f7cb0.png" width="20" height="20" alt="YouTube" style="display:inline-block;border:0;" /></a>
       <a href="https://www.facebook.com/pulppomx" target="_blank" style="text-decoration:none;padding:0 8px;"><img src="https://s1.designmodo.com/postcards/ec49db344110c879f8e2f7f1b60a3501.png" width="20" height="20" alt="Facebook" style="display:inline-block;border:0;" /></a>
       <a href="https://www.instagram.com/pulppomx" target="_blank" style="text-decoration:none;padding:0 8px;"><img src="https://s1.designmodo.com/postcards/0ddcb8841f5b868d5e7e584d52b7c973.png" width="20" height="20" alt="Instagram" style="display:inline-block;border:0;" /></a>
       <a href="https://www.tiktok.com/@pulppomx" target="_blank" style="text-decoration:none;padding:0 8px;"><img src="https://s1.designmodo.com/postcards/7ea801314b703484917c139c7005c9c0.png" width="20" height="20" alt="TikTok" style="display:inline-block;border:0;" /></a>
       <a href="https://www.linkedin.com/company/77576559" target="_blank" style="text-decoration:none;padding:0 8px;"><img src="https://s1.designmodo.com/postcards/40595def03cfe9d93f7bceb9dab3f149.png" width="20" height="20" alt="LinkedIn" style="display:inline-block;border:0;" /></a>
      </td></tr>
     </table>

    </td></tr>
   </table>
  </td></tr>
 </table>
</body>
</html>`;
