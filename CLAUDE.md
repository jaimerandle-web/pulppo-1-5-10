# CLAUDE.md

Guía para Claude Code al trabajar en este repo.

## Qué es

App interna de Pulppo (México) que hospeda **dos proyectos** sobre la misma base de datos
(MongoDB read-only) y el mismo login:

1. **1·5·10** — el programa de exclusivas de venta: pipeline de ofertas/ventas, desempeño por
   propiedad, alertas, métricas del programa y recap mensual para bonos. Es un port a Next.js
   del dashboard original en Streamlit.
2. **Master Brokers** — la herramienta de la inmobiliaria: qué inventario necesita atención,
   funnel de leads, zonas y equipo. `/analisis` es la variante configurable para el KAM (mismo
   motor, `lib/analisis.ts`).

- **Prod**: https://pulppo-inmobiliarias.vercel.app (proyecto `pulppo-1-5-10` en el team de Vercel `pulppo-cx`)
- **Repo**: github.com/jaimerandle18/centro-1-5-10

## Mapa de rutas

| Ruta | Proyecto | Notas |
|---|---|---|
| `/` | — | **Menú** de proyectos (`src/app/page.tsx`). No es el dashboard. |
| `/1-5-10` | 1·5·10 | Cartera y programa (era la raíz hasta ago-2026) |
| `/1-5-10/evaluar`, `/1-5-10/campanas` | 1·5·10 | `/evaluar` y `/campanas` redirigen aquí (`next.config.ts`) |
| `/mb`, `/mb/[companyId]` | Master Brokers | **No mover**: el PDF del Overview imprime estas URLs |
| `/analisis` | Master Brokers | Entra desde el índice de `/mb`, no desde el menú |
| `/ficha/[id]` | **compartida** | La abren 1·5·10 (Cartera) y MB. Tiene links públicos con token → **no mover** |
| `/login` | — | Fuera del middleware |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 (config en `globals.css` con `@theme`) · Recharts · driver `mongodb`.

## Comandos

```bash
npm run dev     # dev server
npm run build   # build de producción (correr antes de pushear)
npx vercel deploy --prod --yes   # deploy manual a producción
```

## Reglas importantes

1. **Commits SIEMPRE con autor `jaime.randle@pulppo.com` (o email @pulppo.com del colaborador)**.
   Vercel bloquea deploys de commits cuyo autor no matchea un miembro del team. El repo ya tiene
   `git config user.email` seteado; no usar emails personales.
2. **NUNCA commitear `.env`** ni credenciales (Mongo URI, Firebase, etc.). `.gitignore` ya los excluye.
3. Todo el contenido visible al usuario va **en español**.
4. Colores de marca (definidos en `globals.css` y `src/components/ui.tsx`): negro `#212322`,
   amarillo `#F6BE00`, verde mar `#529999`, gris `#B7B7B7`, rojo `#A52003`. Tipografías: Nunito Sans
   (texto) y EB Garamond (títulos). No usar colores arbitrarios de Tailwind.
5. Estilo de código: 4 espacios, single quotes, componentes con `'use client'` solo si usan hooks/browser.

## Arquitectura

```
src/lib/data.ts        Capa de datos Mongo (port de mvp_data.py): fetchRows() = exclusivas vivas
                       con leads/visitas/material; fetchProgram() = programa completo con ventas y bonos.
src/lib/email.ts       Generador de campañas: renderCampaign(id|codigo) llena el template on-brand
                       "Exclusiva de la semana" desde Mongo (port de build_campanas_final.py).
src/lib/sendgrid.ts    Cliente REST v3 de SendGrid (fetch, sin deps). Fase 1: sendTestEmail (Mail Send).
src/lib/digest.ts      Digest "Exclusivas de la semana · <Zona>": renderDigest(zona, codes[]) = un correo
                       con VARIAS propiedades de una zona (reusa renderPropertyCard de email.ts). Cada
                       tarjeta conserva su utm_campaign por propiedad (atribución de leads por propiedad).
src/lib/marketing.ts   Cliente SendGrid Marketing/Single Sends (fetch, sin deps). Fase 2: getOrCreateList,
                       addContacts, createSingleSend (borrador), scheduleSingleSend/unschedule, listSingleSends
                       (paginado) + singleSendStats. Resuelve sender y grupo de baja solos (o por env). email.ts
                       exporta withUnsubFooter() que inyecta el footer de baja obligatorio solo en el envío real.
                       ANTI-DUPLICADO de propiedades (Mongo es read-only → la verdad vive en SendGrid): los
                       códigos de cada digest se guardan en el `name` del Single Send (encodeCodesInName) y se
                       leen de vuelta (claimedPropertyCodes/parseCodesFromName) para no reenviar una propiedad
                       que ya está en un envío (borrador/programado/enviado, ventana 90d). plan/ la excluye y
                       avisa (alreadySent); schedule/ re-renderiza el digest solo con las propiedades frescas.
                       ANTI-DUPLICADO del LISTADO por semana: misma zona = misma lista = mismo público, así que
                       no se programan dos envíos de la misma zona en la misma semana ISO (scheduledZoneWeeks /
                       isoWeekKey / zoneWeekKey, leídos del name del Single Send). plan/ recorre el envío a la
                       siguiente semana libre de esa zona; schedule/ rechaza el duplicado como malla de seguridad.
src/lib/elegibilidad.ts Evaluador 1·5·10: computeEval(id) = datos + renderScorecard() = HTML. % de
                       aceptación (precio 40% = mix ACM·oferta·cierres + calidad 25% + comisión 20% +
                       demanda 15%) sobre gates (venta·residencial·no desarrollo) y material (foto·video·tour).
                       Muestra referencia de precio (mix), velocidad de venta de zona, antigüedad y rebaja.
src/lib/audience.ts    Generador de base en vivo: buildAudience(id) cruza colonia→ciudad→zona + tipo
                       contra la DEMANDA (leads.contact.email; contacts.email está vacío). Cascadeo
                       hasta MIN=300 correos, dedup por email, excluye internos. zona_map.json = mapa
                       ciudad→zona (extraído del trabajo de junio) para el nivel más amplio.
src/lib/analisis.ts    Motor del análisis de inventario, COMPARTIDO por /analisis (KAM) y /mb (Master
                       Brokers): inventario por zona/ticket/tipo, precio×calidad, funnel comercial,
                       desempeño por asesor, comparación de períodos, Top 10, recomendaciones.
                       Las fechas están estandarizadas en DOS ventanas — comparables (mercado) y
                       desempeño (tu operación). Ver ANALISIS.md: es el doc canónico, léelo antes
                       de tocar fechas, atribución de asesores o secciones.
src/lib/mb.ts          Motor de Master Brokers (/mb). Ojo con la tabla "Tus zonas":
                       · `oferta` = MERCADO de la colonia, DEDUPLICADO por firma
                         (colonia+tipo+m²+precio). El MLS repite el mismo inmueble entre
                         portales y agencias: medido ago-2026, ~39% del pool era duplicado
                         (inflación 1.2x–2.3x según colonia). Deduplicar NO excluye a Pulppo:
                         `properties` se recorre PRIMERO para que la copia que sobreviva sea
                         la nuestra, y un anuncio de Pulppo en el MLS sin gemela en el pool se
                         conserva. Limitación aceptada: en zonas de desarrollo varias unidades
                         idénticas comparten firma y se colapsan (para quien vende, un
                         desarrollo es UN competidor). El dedup casi no mueve el $/m² mediano
                         — corrige el CONTEO, no el precio.
                       · `ofertaBruta` = el mismo conteo sin deduplicar (se muestra al lado).
                       · `pulppo` = inventario de TODA la red en esa colonia; con `n` forma
                         "tus props / Pulppo". Es peso dentro de la RED, no del mercado — hay
                         inmobiliarias al 90-100% (NURA, Vive Chic) y al 5% (Andina, HS).
                       · Las colonias se agrupan por NOMBRE pero se consultan por id, y un
                         nombre puede tener varios ids ("Centro"): se suman todos (`nbidsOf`).
src/lib/ventanas.ts    Opciones de las ventanas de fecha. Vive aparte de analisis.ts porque los
                       formularios son 'use client' y no pueden importar valores de un módulo que
                       importa mongodb (se lo llevarían al bundle del navegador).
src/lib/kam.ts         Lookup estático inmobiliaria → KAM (generado del Sheet TARGETS).
src/lib/access.ts      Allowlist cerrado de emails (hardcodeado; env ALLOWED_EMAILS lo pisa si está seteada).
src/lib/firebase.ts    Firebase Auth de Pulppo (config JSON en NEXT_PUBLIC_FIREBASE).
src/middleware.ts      Protege todo: sin cookie cm-user válida → redirect /login (páginas) o 401 (API).
src/app/login/         Login SOLO con Google: auth-code → NEXT_PUBLIC_API_URL/login (backend Pulppo)
                       → Firebase custom token → idToken verificado server-side → cookies cm-user/cm-name.
src/app/api/auth/      POST valida idToken contra accounts:lookup + allowlist; DELETE = logout.
src/app/api/data/      GET → { rows, program } con cache en memoria 10 min (?refresh=1 fuerza).
src/app/page.tsx       MENÚ de proyectos (1·5·10 · Master Brokers). Ojo: la raíz ya NO es el dashboard.
src/app/1-5-10/        Dashboard client-side: filtros (KAM select, inmobiliaria autocomplete, tipo pills)
                       y 2 pestañas. El filtrado es 100% client-side sobre el payload completo.
src/app/mb/            Master Brokers: índice de inmobiliarias (MBIndex) + herramienta por inmobiliaria
                       (MBApp/MBAnalisis). Desde el índice se entra a /analisis.
src/app/1-5-10/evaluar/ Evaluador de elegibilidad 1·5·10: /evaluar (uno o varios códigos → tabla, modo lote
                       vía api/evaluar) y /evaluar/[id] (scorecard imprimible on-brand con % de aceptación,
                       gates, sub-scores, mix de precio y qué mejorar).
src/app/1-5-10/campanas/ Módulo de campañas de email. Fase 1: buscar propiedad → preview en iframe →
                       generar base (audiencia en vivo, CSV) → enviar prueba → solapamiento entre bases.
                       Fase 2 (human-in-the-loop): planear DIGEST POR ZONA → crear borradores en SendGrid
                       → aprobar y programar (nada sale sin aprobación) + estado/métricas. Digest = un
                       correo "Exclusivas de la semana" por zona con varias propiedades → cada persona
                       recibe un solo correo; las zonas casi no se cruzan (dedup entre zonas) y todas
                       pueden salir la misma semana. API: preview (GET; ?id= individual o ?zona=&codes=
                       digest), audience (GET ?format=csv), test (POST, guardrail @pulppo.com), plan (POST
                       codes[]+start → zonas), schedule (POST zones[] → un Single Send digest por zona),
                       approve (POST sends[] programa · DELETE ?id desprograma), sends (GET → estado+métricas).
src/components/        CarteraTab (pipeline, métricas, gráficas, alertas, tabla) · ProgramaTab (métricas
                       del programa, gráficas, recap mensual con CSV) · ui.tsx (Metric, HBar, VBar, Donut,
                       DataTable, money) · inputs.tsx (Select estilizado, Combobox con búsqueda).
```

## Datos (Mongo, DB `pulppo`, usuario read-only)

- **Programa** = toda propiedad con `contract.exclusive.pulppo != null` (100% venta).
- **Viva** = `status.last='published'` · **Vendida** = `status.last='completed'` (diccionario oficial).
- Colecciones: `properties`, `leads` (agrupados por fuente con `classifySource`), `visits` (no
  canceladas), `operations` (se prefiere la más avanzada: closed > paying > contract > offer_blocked > offer).
- **Bono** = 5% de la comisión del lado comprador (base real `buyer.commission.client.value` si existe;
  si no, se estima por `side`: buyer=100%, both/seller=50% de la comisión total).

## Env vars (ver .env.example; valores reales por canal seguro, nunca en el repo)

| Var | Qué es |
|---|---|
| `MONGO_URI` | Mongo read-only, DB pulppo |
| `NEXT_PUBLIC_API_URL` | Backend Pulppo que canjea el code de Google por firebase_token |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | OAuth client de Pulppo |
| `NEXT_PUBLIC_FIREBASE` | Config de Firebase (JSON en una línea) |
| `ALLOWED_EMAILS` | Allowlist coma-separado (opcional; si está seteada pisa la lista hardcodeada) |
| `SENDGRID_API_KEY` | API key de SendGrid (módulo /campanas) |
| `SENDGRID_FROM_EMAIL` | Remitente verificado en el dominio autenticado |
| `SENDGRID_FROM_NAME` | Nombre visible del remitente (default: Pulppo) |
| `SENDGRID_SANDBOX` | `1` = valida sin enviar; vacío = envía de verdad |
| `SENDGRID_SENDER_ID` | (Fase 2, opc.) id del Sender de marketing; si vacío se busca por `SENDGRID_FROM_EMAIL` |
| `SENDGRID_UNSUB_GROUP_ID` | (Fase 2, opc.) id del grupo de baja; si vacío se crea "Exclusivas 1·5·10" |
| `SENDGRID_FOOTER_ADDRESS` | (Fase 2, opc.) dirección física del footer legal (default: Pulppo · CDMX) |

**Fase 2 requiere** que el `SENDGRID_API_KEY` tenga scope de **Marketing Campaigns** y un **Sender verificado**.

## Pendientes conocidos (agosto 2026)

- El auto-deploy por push de Git puede quedar bloqueado si el autor del commit no matchea un miembro
  del team de Vercel; el deploy manual por CLI (`npx vercel deploy --prod --yes`) siempre funciona.
- **La mac de Ale no tiene Node**: aquí no corre `npm run build`, `npm run dev` ni `npx vercel`.
  El build real lo hace Vercel al pushear → **revisar ahí el resultado**. Para verificar sin Node:
  lógica de datos con réplicas en Python (`~/Documents/Pulppo/.venv-mongo/bin/python` + `pymongo`,
  Mongo read-only) y JS puro con `osascript -l JavaScript`. Ver ANALISIS.md §4.
- `/analisis` tiene controles que aún no afectan el output (referencias ACM y "qué te alcanza",
  audiencia, benchmark vs mejores inmobiliarias). Lista en ANALISIS.md §5.
