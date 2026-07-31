# Plan — hacer que el formulario de /analisis "jale"

Estado (30-jul-2026): el motor (`src/lib/analisis.ts`) solo consume `inmo`,
`ventDemanda`, `ventLeads`, `mlsGeneral`. El resto de controles del form están
pero no afectan el output. Este plan los conecta, por fases (valor / esfuerzo).

## Fase 1 — Quick wins (datos ya disponibles)

### 1.1 Operación (venta / renta / ambas)
- **Qué**: enfoca todo el reporte a la operación elegida.
- **Cómo**: pasar `operacion` (ya se manda) al motor. Filtrar zones, opSplit del
  header, columnas del funnel, composición y mix de YoY. Precio×calidad y Top 10
  son intrínsecos a venta (ACM) → en 'Renta' se ocultan o llevan nota "aplica a
  venta". 'Ambas' = como hoy.
- **Esfuerzo**: bajo-medio. Sin queries nuevas.

### 1.2 Leads por fuente (Portales)
- **Qué**: desglose "qué mueve tus leads" por fuente (i24 / MeLi / EasyBroker /
  WhatsApp / pulppo.com / …) en el funnel, honrando el modo (todas / principales
  / sin desglose).
- **Cómo**: en el loop de leads ya llega `source`; agrupar con `classifySource`
  (existe en `data.ts`). El modo controla si se desglosa o se agrupa.
- **Esfuerzo**: bajo.

### 1.3 Zombie
- **Qué**: "N props (X%) sin un solo lead en [ventana zombie]" en Inventario.
- **Cómo**: contar props publicadas con 0 leads en la ventana zombie
  (30d/90d/6m/totales). Query corta o reusar leadsByPid.
- **Esfuerzo**: bajo.

## Fase 2 — Referencias de precio

### 2.1 Referencias + Comparables de cierres
- **Qué**: los chips ACM / Oferta de zona / Cierres reales / Qué te alcanza
  muestran/ocultan cada referencia; la ventana "comparables de cierres" alimenta
  la de cierres.
- **Cómo**: ACM (ya) · Oferta $/m² de zona (ya, `zonePpm2`) · **Cierres $/m² de
  zona (NUEVO)**: operaciones cerradas en la ventana → join a properties para
  superficie → mediana $/m² por colonia · **"Qué te alcanza"** (concepto 1·5·10):
  comparables de la zona al mismo precio (±%).
- **Esfuerzo**: medio-alto (query de cierres nueva).

### 2.2 Cortes de segmentación
- **Qué**: los chips zona / tipo / ticket / operación controlan qué breakdowns
  aparecen en Inventario (hoy zona + ticket son fijos).
- **Cómo**: agregar breakdowns por tipo y por operación (datos en `items`); los
  chips togglean cuáles se renderizan.
- **Esfuerzo**: bajo-medio.

## Fase 3 — Comparación flexible + Benchmark

### 3.1 YoY → "Comparación de períodos" (configurable)  ⭐ pedido de Ale
- **Qué**: en vez de H1-25 vs H1-26 fijo, elegir el par a comparar:
  últimos 30d vs 30d previos · mes actual vs mes anterior · mes vs mismo mes del
  año pasado · trimestre vs trimestre · año vs año.
- **Cómo**: generalizar a dos rangos `[aA,aB]` y `[bA,bB]` según el tipo. Las
  métricas (inventario activo prom, leads/período, cierres, comisión, tasa de
  cierre) se recalculan por rango. La reconstrucción de inventario activo ya
  sirve para cualquier fecha. Selector nuevo "tipo de comparación".
- **Esfuerzo**: medio.

### 3.2 Benchmark
- **vs promedio de mercado**: comparar métricas clave de la inmobiliaria ($/m² vs
  zona, % fuera de mercado, L/L) contra el agregado (mls + medianas de zona que ya
  calculamos). **Factible.**
- **vs mejores inmobiliarias** (Tier 2 = Top 20 por ROI, ver handover CS):
  **bloqueado** — el ranking ROI vive fuera de Mongo. Alternativa: proxy "top por
  volumen de cierres" desde Mongo, o esperar la automatización del ROI.
- **Esfuerzo**: medio (mercado) / bloqueado (mejores).

## Controles que quedan vivos sin tocar
inmobiliaria (+KAM), ventana de demanda, ventana de leads, MLS on/off, checklist
de secciones (+destacados), enfoque/tono/cantidad de recos, audiencia (rótulo).

## Secuencia sugerida
Fase 1 completa (rápida, sube mucho la utilidad) → 3.1 comparación de períodos
(lo que pediste) → Fase 2 referencias → 3.2 benchmark de mercado.
