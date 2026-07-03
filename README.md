# Centro de mando · 1 · 5 · 10

Dashboard interno del programa **1·5·10** de Pulppo (exclusivas de venta). Lee **en vivo de MongoDB**
(read-only) para dar visibilidad al programa: desempeño por propiedad, pipeline de ofertas/ventas,
alertas, métricas del programa y recap mensual para bonos.

Port a **Next.js + Recharts** del dashboard original en Streamlit, para deployarlo en Vercel con el
mismo login de Google que customer-cx (code → backend Pulppo → Firebase custom token → cookie + allowlist).

## Quickstart

```bash
npm install
cp .env.example .env    # completar MONGO_URI + vars de login
npm run dev
```

Abre http://localhost:3000 (sin cookie de sesión redirige a /login).

## Estructura

```
src/lib/data.ts       Capa de datos Mongo (port de mvp_data.py): fetchRows() / fetchProgram()
src/lib/kam.ts        Lookup estático inmobiliaria → KAM (del Sheet TARGETS)
src/lib/access.ts     Allowlist de emails (env ALLOWED_EMAILS o fallback)
src/lib/firebase.ts   Firebase Auth de Pulppo (NEXT_PUBLIC_FIREBASE)
src/middleware.ts     Protege todas las rutas: sin cookie cm-user válida → /login o 401
src/app/login/        Login con Google (igual que customer-cx) o email
src/app/api/data/     GET /api/data → { rows, program } con cache 10 min (?refresh=1 fuerza)
src/app/page.tsx      Dashboard: filtros KAM/inmobiliaria/tipo + 2 pestañas
```

## Datos (DB `pulppo`, read-only)

- **Programa** = toda propiedad con `contract.exclusive.pulppo != null` (100% venta).
- **Vivas** = `status.last='published'` · **Vendidas** = `status.last='completed'`.
- Leads por fuente (`leads`), visitas (`visits`, no canceladas), operaciones (`operations`, se
  prefiere la más avanzada: closed > paying > contract > offer_blocked > offer).
- Bono = 5% de la comisión del lado comprador (base real si existe, si no se estima por `side`).

## Deploy (Vercel)

Importar el repo en Vercel y setear las env vars de `.env.example`
(`MONGO_URI` como secreto; las `NEXT_PUBLIC_*` con los mismos valores que customer-cx).
