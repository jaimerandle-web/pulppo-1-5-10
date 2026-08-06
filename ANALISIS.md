# El análisis de inventario — estándar de fechas y secciones

Doc canónico del motor de análisis (`src/lib/analisis.ts`), que alimenta **dos** pantallas:

| Pantalla | Ruta | Audiencia | Form |
|---|---|---|---|
| Master Brokers | `/mb/[companyId]` → pestaña "Generador de análisis" | el dueño de la inmobiliaria | `src/app/mb/[companyId]/MBAnalisis.tsx` |
| Generador KAM | `/analisis` | interno (KAM) | `src/app/analisis/page.tsx` |

Las **vistas son las mismas** para las dos (`src/app/analisis/views.tsx`). El motor es el mismo.
Cambiar el motor cambia ambas: no hay forma de "arreglarlo solo en MB".

---

## 1. El estándar de fechas (ago-2026)

Antes había cuatro controles de fecha que se pisaban entre sí — *"ventana de análisis"*,
*"comparación de períodos"*, *"desempeño de leads"* y *"zombie"* — y nadie sabía cuál mandaba
sobre qué. El funnel, además, estaba **clavado a YTD** e ignoraba todos ellos.

Ahora hay **dos conceptos**, y cada número del reporte pertenece a uno de los dos:

### A · COMPARABLES — el mercado

Para responder *"¿mi precio es competitivo, cuánta competencia tengo, cuánta gente está buscando?"*.
Cada pieza tiene su propia naturaleza temporal, y por eso **no comparten un solo selector**:

| Pieza | Ventana | Por qué |
|---|---|---|
| **Oferta** (lo que se pide) | **hoy**, fija, no configurable | No guardamos la historia del asking. Solo existe lo publicado en este momento. |
| **Cierres** (lo que se vende) | selector, **mínimo 6 meses** | Los cierres son pocos; una ventana corta no junta comparables suficientes. |
| **Demanda** (búsquedas) | selector, **mínimo 1 mes** | Las búsquedas son muchas; un mes ya es señal. |

Opciones: `CIERRES_WIN` = 6/12/24/36 meses · `DEMANDA_WIN` = último mes / 3 / 6 / 12 meses.

**Siempre mediana, nunca promedio.** `vs. oferta` y `vs. cierres` se calculan por propiedad
(su $/m² contra la **mediana de sus comparables**: misma colonia, tipo, tamaño ±30%, recámaras)
y por zona se muestra la **mediana** de esas diferencias. Un solo anuncio con precio absurdo
movería el promedio; la mediana no se mueve.

### B · DESEMPEÑO — tu operación

Para responder *"¿cómo va mi operación?"*. **Una** ventana + **una** base de comparación.
Manda sobre: funnel comercial · desempeño por asesor · leads por propiedad (zonas, matriz,
Top 10) · propiedades sin actividad.

| Control | Opciones |
|---|---|
| Período (`DESEMPENO_WIN`) | Mes actual · Mes anterior · **Mes específico** (últimos 18 meses) · Últimos 3 meses · Últimos 6 meses · Año en curso (YTD) · Últimos 12 meses |
| Comparar contra (`COMPARAR_OPTS`) | Período anterior · Mismo período del año pasado · Sin comparación |

Las opciones viven en **`src/lib/ventanas.ts`**, no en `analisis.ts`. Es a propósito:
`analisis.ts` importa el driver de `mongodb`, así que un componente `'use client'` que importara
valores de ahí se llevaría Mongo al bundle del navegador y el build falla. `ventanas.ts` no tiene
dependencias.

#### Reglas de la comparación (verificadas, ver §4)

- **Mes en curso** (parcial) contra "período anterior" → compara los **mismos días** del mes
  anterior (`agosto 2026 (al día 4)` vs `julio 2026 (mismos 4 días)`). Comparar 4 días contra
  31 sería mentir.
- **Tramos de N meses** se corren por **meses de calendario**, no por milisegundos: "últimos 6
  meses" vs "6 meses previos" quedan alineados al mismo día del mes (si se corriera por
  duración, los 6 meses previos empezarían 3 días desfasados).
- **Año en curso (YTD)** no tiene "tramo previo" con sentido comercial → "período anterior" se
  lee contra **el año pasado a la misma fecha**, igual que la opción de año vs año.
- **Base en cero**: si el período anterior tiene 0 (una inmobiliaria que entró este año), no se
  muestra un porcentaje falso: dice **"nuevo"** (tabla) o *"sin base para comparar"* (lectura).

### Lo que se eliminó

- El selector **"zombie / sin leads en"**: ahora "sin actividad" se lee siempre en la ventana de
  desempeño. Un solo concepto de tiempo para toda la operación.
- El selector **"desempeño de leads"**: era la misma cosa que la ventana de desempeño.
- La lista vieja de tipos de comparación (`Año vs año (YTD)`, `Mismo mes año vs año`,
  `Trimestre vs anterior`, …). `legacyDesempeno()` en `analisis.ts` mapea los bodies viejos por
  si un cliente cacheado los manda; se puede borrar cuando ya no haya sesiones viejas.

### El reporte declara sus períodos

Los dos forms imprimen arriba del reporte, siempre:

> **Desempeño:** julio 2026 · comparado contra **junio 2026** · **Comparables:** cierres últimos
> 12 meses · demanda últimos 3 meses · oferta hoy

Antes había que adivinarlo. Y al cambiar cualquier control el preview **se limpia**
(`useEffect(() => setData(null), [...])`), para que nunca queden números viejos con filtros
nuevos — eso era lo que hacía parecer que "los filtros no funcionan" en MB (`/analisis` ya lo
tenía; MB no).

---

## 2. Sección "Desempeño por asesor"

`AsesoresView` en `views.tsx`, datos en `AnalisisData.asesores` (`AsesorRow[]`).
Todo dentro de la ventana de desempeño, **siempre partido venta/renta**.

Columnas: Leads · Respondidos · Tasa resp. · 1ª respuesta (prom.) · 1ª respuesta (mediana) ·
Visitas · Tasa visita · Ofertas · Tasa oferta · Cierres · Visita→cierre · Comisión ·
% com. venta · % com. renta · Ticket venta · Ticket renta. Más una fila **Total inmobiliaria**.

Un botón **Total / Venta / Renta** cambia el desglose de los conteos. El **% de comisión** y el
**ticket** van siempre en columnas separadas de venta y renta: en renta el ticket es la renta
mensual, así que sumarlo con venta no significa nada (pedido explícito de Ale).

### Atribución (importa, y está documentado en el propio reporte)

| Métrica | A quién se le cuenta | Campo |
|---|---|---|
| Leads, respuesta, tiempo | asesor **responsable** de atenderlo | `lead.agent` → `lead.property.agent` → agente de la propiedad |
| Visitas | quien **hizo** la visita | `visit.agent` → agente de la propiedad |
| Ofertas y cierres | el asesor **de la inmobiliaria** que participó | primer `_id` interno entre `seller.broker`, `buyer.broker`, `property.agent`; si ninguno es interno, el agente de la propiedad |

- `lead.agent` tiene **98%** de cobertura (vs 85% de `property.agent`) y difiere de él en ~35%
  de los casos: el que atiende no siempre es el captador. Por eso se prefiere.
- `pickAgent()` toma el primer candidato **con `_id` y nombre**. No basta `a ?? b`: en Mongo hay
  `agent: {}` y `agent: null`, y un objeto vacío cortaría la cadena de fallback perdiendo el evento.
- Se **agrupa por nombre normalizado**, no por `_id`: la misma persona puede tener dos cuentas de
  agente (visto en producción) y al dueño le interesa la persona.
- Todo asesor con inventario **publicado** aparece aunque tenga 0 actividad: un asesor con 0 leads
  es información, no un hueco.
- **Verificado**: la suma de los asesores cuadra con el funnel (leads/visitas/ofertas/cierres) en
  las 3 inmobiliarias probadas, sin fugas.

### Ojo con el tiempo de respuesta

`answeredAt` está poblado en ~90% de los leads, así que la **tasa de respuesta sale casi
siempre 96–100%** y no discrimina. Lo que discrimina es el **tiempo**: en la misma inmobiliaria
hay asesores en 2 h y otros en 40 h. El promedio lo destruyen unos pocos leads contestados días
después, por eso se muestran **promedio y mediana** juntos.

---

## 3. Otros arreglos de esta pasada

**Motor**
- El funnel, la composición de leads y el "por fuente" salieron de YTD fijo a la ventana de desempeño.
- `activeAt()` (foto histórica de inventario) ahora usa la **primera publicación real**
  (`status.history`), no `publishedAt`, que se reinicia al republicar. Impacto medido: pequeño
  (+1 a +5 props sobre ~500), pero era incorrecto.
- `Calidad Alta` en la comparación de períodos se renombró a **"Calidad Alta (ficha de hoy)"**:
  no hay histórico de `qualityScore`, se aplica la calidad actual al set que estaba activo en
  cada período. Está dicho en la nota de la sección.

**Overview de MB**
- Los bloques de propiedades (los del hero y los "focos comerciales") van ordenados de **mayor a
  menor volumen**.

**Listado de MB**
- Columna **Tipo** de propiedad (+ filtro de tipo en la barra superior).
- La fila de filtros por columna ahora va sobre **fondo gris claro**, con su propio rótulo
  ("Filtrar por columna: en texto escribe parte de la palabra · en números el mínimo"),
  placeholders `contiene…` / `mín.`, tooltip por columna, borde verde en los filtros activos y un
  **"limpiar N filtros"**. Antes se leía como una fila más de datos.
- El encabezado dice que `vs. oferta` / `vs. cierres` comparan contra la **mediana**.

**Ortografía**
- `src/lib/ficha.ts`: `opción${n === 1 ? '' : 'es'}` producía **"opciónes"**. En español el plural
  pierde el acento (opción → opciones), así que no se puede pluralizar con sufijo.
- Barrido de acentos y signos de apertura sobre todo el texto visible de MB, `/analisis`, `views.tsx`,
  `ficha.ts` y `elegibilidad.ts`: sin otros hallazgos.

---

## 4. Cómo se verificó (no hay Node en la mac)

Esta mac **no tiene Node**, así que no se puede `npm run build` ni `npm run dev` aquí: el build
real lo hace Vercel al pushear. Para no volar a ciegas:

- **Aritmética de fechas**: `osascript -l JavaScript` (JXA trae un motor de JS) corriendo una copia
  literal de `perfRange`/`compareRange` sobre las 7 ventanas × 3 modos + bordes (enero cruzando
  de año, mes específico = mes en curso). Ahí salieron los dos bugs de span que se corrigieron.
- **Lógica de datos**: réplicas en Python con `pymongo` contra Mongo read-only
  (`/Users/alebonilla/Documents/Pulppo/.venv-mongo/bin/python`, URI en `~/Downloads/mongo_uri.txt`
  con BOM `utf-8-sig`): esquema de `leads.agent` / `visits.agent` / `operations.*.broker`,
  cobertura de atribución, cuadre asesores↔funnel, y que las ventanas de desempeño **muevan** los
  números (agosto parcial 75 leads · julio 338 · junio 404 · YTD 1,023 en NURA).
- **TypeScript**: revisión estática (balance de delimitadores, campos de `AnalisisData` declarados
  vs leídos por las vistas vs armados en el `return`). Sin type-checker: **revisar el build de
  Vercel** después del push.

---

## 5. Pendiente en `/analisis` (el trabajo "más a detalle")

El estándar de fechas y la sección de asesores ya están en las dos pantallas — era obligatorio,
porque comparten motor y si no `/analisis` se rompía. Lo que queda es lo que `/analisis` tiene de
más y todavía no se aprovecha:

1. **Chips de "referencias de precio"**: `ACM (valor estimado)` y `Qué te alcanza por el mismo
   precio` no togglean nada todavía (solo `Oferta de zona` y `Cierres reales` funcionan).
2. **Benchmark "vs mejores inmobiliarias"**: bloqueado, el ranking de ROI vive fuera de Mongo.
   Hoy muestra un aviso. Alternativa: proxy "top por volumen de cierres".
3. **Audiencia KAM/cliente**: solo cambia el rótulo del encabezado; no cambia tono ni qué se
   muestra (el flag `audiencia: 'mb'` sí lo hace, pero el selector del form no lo manda).
4. **Sección de destacados**: sigue leyéndose en YTD por mes (aviso-meses), no en la ventana de
   desempeño. Es coherente para lo que mide (historia del nivel de aviso), pero conviene decirlo
   en la sección.
5. **Deltas por sección**: el ▲▼ contra el período base ya está en el funnel; falta en zonas y
   en la tabla de asesores.
6. **"% con valuación"**: la única columna del deck de Karen que no reproduce — ella pone venta
   95.3% / renta 35.0% y con `acm.price.value` sale al revés (87.2% / 96.2%). Existe un campo
   `valuation` aparte del ACM; hay que fijar la definición con ella antes de automatizarlo.

---

## 6. Segunda ronda (ago-2026): benchmark, flags y overview

### Benchmark = las mejores, no el promedio

La referencia es el **TOP 20 por # de cierres** de la ventana (decisión de Ale), calculado en
vivo y cacheado 15 min (`bestAgencies()` en `analisis.ts`). Medido may–jul 2026 sobre 103
inmobiliarias con ≥50 leads:

| Grupo | Tasa de visita | Lead→cierre |
|---|---|---|
| Promedio Pulppo | 11.75% | 0.93% |
| Mediana entre inmobiliarias | 9.76% | — |
| **TOP 20 por cierres** | **14.36%** | 1.20% |
| El resto (83) | 10.44% | 0.78% |

Comparar contra el promedio no discrimina (casi todas salen bien). **No hacen falta datos
falsos** para "mejores inmobiliarias": el ranking por ROI vive fuera de Mongo, pero "quién
cierra más" sale de aquí y es defendible.

### Brokers de otras inmobiliarias (bug corregido)

La red Pulppo es un MLS compartido: un broker externo puede atender un lead o hacer una visita
sobre tu inventario. Medido: **0.2–3% de los leads y hasta 17% de las visitas** (Arpa). La
tabla de asesores los mezclaba como si fueran del equipo. Ahora la lista sale de la colección
`agents` de la inmobiliaria y lo externo se reporta aparte como actividad de la red.

### Flags por asesor

Mínimo **10 leads** en la ventana para evaluar a alguien (si no, 3 leads generan ruido).

🔴 fuera de SLA 24h ≥25% · abandono ≥15% · tasa de visita <7% con ≥20 leads · ≤1.2 props por cliente
🟢 mediana ≤15 min sin abandono · tasa de visita ≥14% (las mejores) · ≥3 props por cliente · ≥1 cierre

Reglas de presentación, aprendidas en producción:
- **El verde exige cero banderas rojas.** Sin eso, alguien con 1 cierre y 67% de leads fuera de
  SLA aparecía en "lo que va bien" *y* en "lo que hay que atender", y el dueño no sabía qué hacer.
- Quien **produce y además tiene banderas rojas** va en una nota aparte ("ojo con estos"): es el
  que más tiene en juego, no es para felicitar ni para regañar.
- Es **señal, no ranking**: el que más cierra puede ser el que más quema leads.

### El universo importa

Los asesores se miden sobre **todas** las propiedades de la inmobiliaria, no solo las publicadas
hoy. Con el universo recortado, un asesor pasaba de 50% a 67% de leads fuera de SLA y otra con
113 leads y 27% no aparecía. El **listado** sí sigue siendo solo lo publicado, que es lo correcto ahí.

### `answeredAt` se rellena tarde

Un asesor tenía 17 leads sin responder un día y **0 al día siguiente**, con uno contestado a las
**629 horas** (26 días). "Sin responder" encoge solo con el tiempo y no sirve para un reporte
mensual. La métrica estable es **% fuera de SLA 24h**, que incluye a los nunca contestados
precisamente para que no se puedan esconder respondiendo un mes después.

### Qué le falta a una ficha para ser Alta

Medido en toda la red (9,204 publicadas con calificación):

| | ≥8 fotos | video | tour | planos | desc ≥400 |
|---|---|---|---|---|---|
| ALTA (1,682) | 92% | **100%** | 7% | 10% | 100% |
| MEDIA (5,784) | 94% | **32%** | 6% | 9% | 100% |
| BAJA (1,738) | 83% | 20% | 4% | 2% | 95% |

**El video es el único factor que separa Media de Alta** (+68 pts). Todo lo demás es plano.
Consecuencia práctica: recomendar "sube un tour virtual" para mejorar la calidad **es mal
consejo** y el overview lo dice explícitamente.

### Propiedades compartidas por cliente

`searches.properties[]` = lo que el asesor le agregó al cliente en su búsqueda. Mide **trabajo**,
no suerte, y separa muchísimo: en Arpa va de 6.6 (Liz) a 1.1 (Carmen) propiedades por cliente.
Ojo: el **97% de las búsquedas históricas están canceladas**, así que solo tiene sentido contar
las **abiertas en el período**, nunca un acumulado.

### Nombres de sección

Responden una pregunta y dicen la conclusión, no el método: *Dónde está tu inventario · Qué pasa
con tus leads · Cómo están tus asesores · Comparación de períodos · Propiedades con potencial ·
Dame recomendaciones · Cómo leer este reporte*. Se eliminaron "Precio × calidad" e "Historial de
avisos". Cada sección trae su propio "cómo se lee" y su recap al pie.

### Otros

- El "vs" ya se ve **dentro** del funnel (▲▼ contra el período base), no solo en su sección.
- "Media" en velocidad de respuesta se leía como *promedio*: los rangos ahora son
  **Flash ≤5 min · Rápida ≤1 h · Aceptable ≤24 h · Fuera de SLA >24 h**, siempre con el tiempo visible.
- Demanda estandarizada a **últimos 3 meses** también en `/mb` (antes YTD, que en enero medía 3 semanas).
- Filtro por asesor en el reporte: acota todo a **su cartera**.
- PDF en MB (A4 horizontal, sin cortar secciones) y botón Generar en amarillo de marca.
