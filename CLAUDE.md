# CLAUDE.md

Guía para Claude Code al trabajar en este repo.

## Qué es

**Pulppo · 1·5·10** — dashboard interno del programa de exclusivas de venta de Pulppo (México).
Lee en vivo de MongoDB (read-only) y muestra: pipeline de ofertas/ventas, desempeño por propiedad,
alertas, métricas del programa y recap mensual para bonos. Es un port a Next.js del dashboard
original en Streamlit.

- **Prod**: https://pulppo-1-5-10.vercel.app (proyecto `pulppo-1-5-10` en el team de Vercel `pulppo-cx`)
- **Repo**: github.com/jaimerandle18/centro-1-5-10

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
src/lib/kam.ts         Lookup estático inmobiliaria → KAM (generado del Sheet TARGETS).
src/lib/access.ts      Allowlist de emails (env ALLOWED_EMAILS coma-separado, o fallback hardcodeado).
src/lib/firebase.ts    Firebase Auth de Pulppo (config JSON en NEXT_PUBLIC_FIREBASE).
src/middleware.ts      Protege todo: sin cookie cm-user válida → redirect /login (páginas) o 401 (API).
                       Con env DISABLE_AUTH=1 se saltea (llave temporal, ver Pendientes).
src/app/login/         Login SOLO con Google: auth-code → NEXT_PUBLIC_API_URL/login (backend Pulppo)
                       → Firebase custom token → idToken verificado server-side → cookies cm-user/cm-name.
src/app/api/auth/      POST valida idToken contra accounts:lookup + allowlist; DELETE = logout.
src/app/api/data/      GET → { rows, program } con cache en memoria 10 min (?refresh=1 fuerza).
src/app/page.tsx       Dashboard client-side: filtros (KAM select, inmobiliaria autocomplete, tipo pills)
                       y 2 pestañas. El filtrado es 100% client-side sobre el payload completo.
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
| `ALLOWED_EMAILS` | Allowlist coma-separado (opcional, hay fallback en código) |
| `DISABLE_AUTH` | `1` = saltea el login (llave temporal) |

## Pendientes conocidos (julio 2026)

- El OAuth client de Google NO tiene autorizado el origen `https://pulppo-1-5-10.vercel.app` todavía
  → el botón de Google da `origin_mismatch`. Por eso production tiene `DISABLE_AUTH=1` (dashboard
  público temporalmente). Cuando se autorice el origen: borrar esa env en Vercel y redeployar.
- El auto-deploy por push de Git puede quedar bloqueado si el autor del commit no matchea un miembro
  del team de Vercel; el deploy manual por CLI (`npx vercel deploy --prod --yes`) siempre funciona.
