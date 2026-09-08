# Pulppo Studio — estructura de la app

Propuesta de flujo completo: qué ve el broker al entrar, qué completa, y qué le mostramos.
Complementa `PROCESO.md` (que describe el motor por dentro); este doc es **la app por fuera**.

> Principio de diseño: **el broker no viene a crear, viene a publicar.** Nunca le mostramos un
> lienzo en blanco. Cada pantalla arranca con algo concreto ya propuesto y su trabajo es elegir,
> ajustar dos campos y bajar la pieza.

---

## Mapa de pantallas

```
   ALTA (una vez, ~40 seg)
   ┌──────────────────────┐
   │ 1. Confirma tus datos│  ← pre-llenado de Mongo, solo confirma
   │ 2. Cuatro preguntas  │  ← zonas · tono · handle · CTA
   └──────────┬───────────┘
              ▼
   ┌────────────────────────────────────────────────────────┐
   │  HOY  ·  la pantalla de todos los días                 │
   │        (orden definido por Ale el 6 ago 2026)          │
   │                                                        │
   │  A · Hitos          captación / cierre · solo si pasó  │
   │  B · La idea de hoy  una sola, con "otra ↻"            │
   │  C · Historias de hoy            (3, caducan hoy)      │
   │  D · Para tu feed     post O carrusel, mezclados       │
   │  E · Tu ritmo                    (racha + plan)        │
   └───────────┬────────────────────────────────────────────┘
               │ elige una idea
               ▼
   ┌──────────────────────┐        ┌─────────────────────┐
   │  EDITOR              │───────▶│  MIS PIEZAS         │
   │  preview + campos    │        │  historial y estados│
   │  + caption           │        └─────────────────────┘
   └──────────────────────┘
               │ correcciones del broker
               ▼
        MEMORIA (invisible, mejora lo próximo)
```

Navegación: **Hoy · Mis piezas · Perfil**. Tres tabs, nada más.

---

## 0 · Alta — qué tiene que completar

**Pantalla 1 · "Confirma que esto está bien"** — no se pregunta, se muestra ya lleno.
Cobertura real sobre los 988 brokers activos (ver `motor/perfil_broker.md`):
nombre 100% · foto 94% · teléfono 97% · inmobiliaria 97% · logo 97%.
El broker solo corrige lo que esté mal. Si le falta la foto, es el único campo que le pedimos subir.

**Pantalla 2 · las cuatro preguntas que Pulppo no puede saber.** Cada una cambia algo concreto
en lo que le vamos a sugerir — esto es el contrato alta → motor:

| Le preguntamos | Qué cambia en sus sugerencias |
|---|---|
| **Zonas donde trabajas** (1–5) | Es la que más pesa. Aterriza el `{{zona}}` de las categorías `zonas`, `consejo` y `dato`, y elige de qué colonia sale la **foto** de las piezas a sangre. Sin esto el motor sugiere en genérico. |
| **Vendes, rentas o ambas** | Sesga el ángulo: captación e inversión vs. primera vivienda y requisitos. |
| **Tono + emojis (sí / pocos / no)** | Voz del copy y guardrail duro: si dice "no", una pieza con emoji no se le muestra. |
| **Tu CTA de siempre** | Cierre de la caption y del pie de las piezas ("Escríbeme por DM" vs "Te dejo mi WhatsApp"). |

Además, **el handle de Instagram**: hay que preguntarlo sí o sí. `socialMedia` en Mongo no lo trae
(solo un score `maslow` y un token de Facebook), y 2 de los 12 templates lo imprimen.

> ⚠️ **Las zonas se pre-sugieren solo para la mitad.** 490 de los 988 activos (50%) tienen
> inventario publicado, así que a ellos les mostramos sus colonias ordenadas por cantidad de avisos
> y solo confirman. **A la otra mitad hay que preguntárselas** con un buscador de colonias — y no
> tienen fotos propias para los 4 templates a sangre, así que necesitan otra fuente de imagen
> (banco de fotos por zona, o que suban una). Es la decisión de producto más urgente del alta.

Lo que **no** se pregunta nunca: se aprende de las correcciones (paso 6 de `PROCESO.md`).

---

## 1 · Hoy — la pantalla de todos los días

```
┌────────────────────────────────────────────────────────────────┐
│  Hola, Viola.                          Polanco · Roma Norte ▾  │
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ ▲ Cerraste la venta de Campos Elíseos 379.                 │ │  ← banner
│ │   Cuéntalo hoy: es la pieza que más confianza genera.       │ │    oportunista
│ │                                    [ Armar la pieza → ]    │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│  IDEAS DE HOY PARA STORIES                        3 de 3       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                     │
│  │  9:16     │ │  9:16     │ │  9:16     │   [ otras ideas ↻ ] │
│  │ ¿En qué   │ │ Lo más    │ │ Polanco:  │                     │
│  │ zona      │ │ buscado   │ │ por qué   │                     │
│  │ sueñas... │ │ en CDMX   │ │ vivir aquí│                     │
│  │           │ │           │ │           │                     │
│  │ 2 campos  │ │ 2 campos  │ │ 3 campos  │                     │
│  └───────────┘ └───────────┘ └───────────┘                     │
│                                                                │
│  POSTS SUGERIDOS ESTA SEMANA                                   │
│  ┌─────────────────┐ ┌─────────────────┐                       │
│  │      4:5        │ │      4:5        │   [ ver todos → ]     │
│  │ 5 ventajas de   │ │ Requisitos para │                       │
│  │ invertir en     │ │ un crédito      │                       │
│  │ Polanco         │ │ hipotecario     │                       │
│  │ consejo·6 campos│ │ requisitos·6 c. │                       │
│  └─────────────────┘ └─────────────────┘                       │
│                                                                │
│  TU RITMO ESTA SEMANA        ●●●○○   3 de 5 · sigues en racha   │
└────────────────────────────────────────────────────────────────┘
```

### A · Ideas de hoy para stories
**Tres, no más, y caducan hoy.** El story es el formato de bajo esfuerzo y ritmo diario: 2–3 campos
para completar y ya. Tenemos 4 templates story (`frase`, `pregunta`, `dato`, `zona`), así que las
tres de cada día salen de rotar semilla × zona × template sin repetir.

Por qué caducan: es lo que hace que la app tenga sentido **volver a abrir mañana**. Si las ideas se
acumulan, se vuelve un backlog y el backlog culpa.

### D · Para tu feed — post y carrusel unificados
**No se separan.** Para el asesor es el mismo momento (publicar algo trabajado) y la diferencia
post/carrusel es un detalle de formato, no una decisión: elige por apetito, no por categoría.
Se muestran 3 mezclados, con el formato visible en la tarjeta (`post · 6 campos` vs
`carrusel · 13 campos`) para que el esfuerzo se vea antes de entrar.

Mayor esfuerzo que la historia, mayor permanencia. Cadencia semanal, no diaria.

### C · Banner de operación — la tercera cosa, y no es una sección
Esto es lo que Studio puede hacer y Canva no: **contenido gatillado por hechos reales de su
operación.** Los cuatro disparadores están verificados en Mongo:

| Hecho | Se detecta con | Pieza que propone |
|---|---|---|
| Publicó un aviso | `status.history` con `published` reciente | "Nuevo en {zona}" |
| Cerró una venta/renta | `status.last: "completed"` | "Vendida en {zona}" — la que más confianza genera |
| Bajó el precio | `listing.priceHistory` (2+ entradas) | "Oportunidad en {zona}" |
| Firmó exclusiva | `contract.exclusive.start` (1,347 publicadas la tienen) | "Me confiaron la venta de…" |

> ⚠️ **Por eso es un banner y no una sección fija:** en 30 días hubo 155 publicaciones y 161 cierres
> en toda la base → solo **169 de 988 brokers (17%)** tuvieron algún evento. Una sección fija
> estaría vacía para 8 de cada 10 brokers todos los días. Como banner, aparece cuando hay algo y
> **no ocupa lugar cuando no lo hay**.

### D · Tu ritmo
Una línea, sin dramatismo: cuántas piezas publicó esta semana contra el objetivo (propongo
**5 stories + 2 posts**) y si mantiene la racha. Es lo único que empuja consistencia sin regañar.

---

## 2 · Editor — de idea a pieza

```
┌──────────────────────────────────────────────────────────┐
│  ← Hoy            5 ventajas de invertir en Polanco      │
│ ┌──────────────────┐  ┌────────────────────────────────┐ │
│ │                  │  │ Zona        [ Polanco       ]  │ │
│ │   PREVIEW EN     │  │ Ventaja 1   [ Demanda de... ]  │ │
│ │   VIVO (4:5)     │  │ Ventaja 2   [ Inventario... ]  │ │
│ │                  │  │ …                              │ │
│ │  se actualiza al │  │ ────────────────────────────── │ │
│ │  tipear          │  │ Caption   [ Invertir en...  ]  │ │
│ │                  │  │ ↻ sugerir otra                 │ │
│ └──────────────────┘  └────────────────────────────────┘ │
│               [ Descargar ]  [ Copiar caption ]          │
└──────────────────────────────────────────────────────────┘
```

Los campos vienen **ya llenos** por la IA, no vacíos: el broker edita lo que no le gusta. Cada
edición que hace es una corrección que va a la memoria (paso 6). Reglas: preview en vivo, un solo
botón principal, y los guardrails de marca corriendo en silencio (si algo no pasa, se marca el
campo, no se bloquea la pieza).

## 3 · Mis piezas
Historial en grilla. Sirve para reusar lo que funcionó y para no repetir. Estados:

`sugerida` → `en_edición` → `lista` → `descargada` → *(futuro)* `publicada`

`sugerida` sin abrir por 7 días se descarta sola (no acumular backlog).

## 4 · Perfil
Lo del alta, editable. Más "cómo escribo" — lo que la memoria aprendió de sus correcciones, visible
y editable. Que el broker pueda ver y corregir lo que el sistema cree de él.

---

## Reglas del motor que esta estructura implica

1. **Frescura:** no repetir el mismo template ni la misma categoría en 7 días.
2. **Rotación de zona:** si tiene 3 zonas, rotarlas en lugar de machacar la principal.
3. **Caducidad:** las ideas de story mueren a medianoche; los posts sugeridos duran la semana.
4. **Prioridad:** un hecho de operación le gana a cualquier idea del banco. Es más fuerte contar
   una venta real que un consejo genérico.
5. **Nunca vacío:** si se agotan las combinaciones frescas, la IA expande sobre las semillas
   (§4c de `PROCESO.md`) antes que mostrar una pantalla sin nada.

---

## Lo que falta decidir (para la revisión)

1. **El 50% sin inventario** — ¿banco de fotos por zona, que suban la propia, o templates sin foto
   para ellos? Bloquea 4 de los 12 templates y es lo más urgente.
2. **¿Descargar o publicar?** Hoy la pieza se baja y el broker la sube a mano. Ya usamos Metricool
   para analítica: si se conecta, Studio podría programar el post y cerrar el círculo
   (idea → pieza → publicada → rendimiento → qué sugerir después). Cambia el alcance del proyecto.
3. **Ritmo objetivo** — propongo 5 stories + 2 posts por semana. ¿Es realista para un asesor?
4. **¿El titular revisa?** Hay 400 `master` (titulares de inmobiliaria) y 588 `associate`.
   ¿La inmobiliaria quiere aprobar lo que publican sus asesores, o cada uno publica libre?
5. **`marca_personal`** está en la taxonomía pero no tiene semillas ni template. ¿Entra en el
   primer release o queda para después?
