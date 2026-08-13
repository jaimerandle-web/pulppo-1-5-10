# Onboarding · Pulppo 1·5·10

Hola 👋 — esta guía es para empezar a trabajar en el **Centro de mando 1·5·10**, el dashboard
interno del programa de exclusivas de Pulppo. Está pensada para abrirse desde Claude Code.

## Qué es el proyecto

App Next.js que lee en vivo de MongoDB (read-only) y hospeda **dos proyectos** bajo el mismo login:

- **1·5·10** (`/1-5-10`) — estado del programa de exclusivas: pipeline de ofertas/ventas, desempeño
  por propiedad (leads por fuente, visitas, material), alertas, métricas históricas y el recap
  mensual de vendidas para calcular bonos. Cuelgan de ahí `/1-5-10/evaluar` y `/1-5-10/campanas`.
- **Master Brokers** (`/mb`) — la herramienta de la inmobiliaria, más `/analisis` (misma máquina,
  configurable para el KAM).

La raíz `/` es el **menú** que lleva a los dos. `/ficha/[id]` es compartida por ambos.
El mapa de rutas completo está en el `CLAUDE.md`.

- **Producción**: https://pulppo-inmobiliarias.vercel.app
- **Repo**: https://github.com/jaimerandle18/centro-1-5-10 (privado — pedile acceso a Jaime si no lo tenés)
- **Vercel**: proyecto `pulppo-1-5-10` en el team `pulppo` (pulppo-cx)

## Primeros pasos

1. **Cloná el repo** (o conectalo en claude.ai/code): `jaimerandle18/centro-1-5-10`, rama `main`.
2. **Leé el `CLAUDE.md` del repo** — tiene la arquitectura completa, las reglas y los pendientes.
   Claude Code lo lee solo al abrir el proyecto.
3. **Pedile a Jaime el `.env`** por canal seguro (Slack DM, 1Password…). Son 4 variables:
   `MONGO_URI` + las 3 del login (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`,
   `NEXT_PUBLIC_FIREBASE`). Son las mismas que usa customer-cx. **Nunca las commitees.**
4. Correr local:
   ```bash
   npm install
   npm run dev   # http://localhost:3000
   ```

## Reglas de oro

- **Configurá tu email de Pulppo en git antes del primer commit**:
  ```bash
  git config user.email "alejandra@pulppo.com"
  ```
  Vercel bloquea los deploys si el autor del commit no es miembro del team.
- `npm run build` tiene que pasar antes de pushear.
- Todo lo visible al usuario en español; colores y tipografías de marca Pulppo (ver CLAUDE.md).
- Deploy manual si hace falta: `npx vercel deploy --prod --yes` (pedile a Jaime que te agregue
  al team de Vercel si no estás).

## Estado actual (julio 2026)

- ✅ Dashboard completo (2 pestañas), login solo con Google, autocomplete de inmobiliarias.
- ⚠️ El login está **temporalmente desactivado** (`DISABLE_AUTH=1` en Vercel) porque falta
  autorizar el dominio en el OAuth client de Google. Cuando eso pase, se borra la env y se redeploya.
- El allowlist de acceso está en `src/lib/access.ts` (o env `ALLOWED_EMAILS`).

## Ideas de dónde tocar

- **Agregar un KAM o inmobiliaria nueva**: `src/lib/kam.ts`.
- **Cambiar métricas/gráficas**: `src/components/CarteraTab.tsx` y `ProgramaTab.tsx`.
- **Cambiar la lógica de datos** (qué se considera vendida, bonos, fuentes de leads): `src/lib/data.ts`.
- **Dar acceso a alguien**: agregar su email a `ALLOWED_EMAILS` en Vercel o al fallback de `access.ts`.
