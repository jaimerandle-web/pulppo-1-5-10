# Cómo lo ponemos en manos de brokers

Plan para pasar del prototipo a algo que un asesor de Diamond House use de verdad.
Escrito el 6 ago 2026. **Nada de esto está construido todavía.**

---

## "Live" son dos cosas y conviene no mezclarlas

| | **A · Piloto** | **B · Producto** |
|---|---|---|
| Qué es | Una URL por asesor, sin cuenta ni login | App con cuentas, push diario y publicación |
| Para qué | Saber si lo usan y si el contenido sirve | Escalar a los 988 |
| Backend | **Ninguno** | Next.js + Supabase + cron + WhatsApp |
| Cuándo | **2 semanas** | 6–10 semanas después, si el piloto lo justifica |

**Recomiendo A y solo A por ahora.** El piloto responde la única pregunta que importa hoy —
¿el asesor abre esto y baja una pieza?— y no requiere construir nada del producto. Si la respuesta
es no, todo lo de B se habría tirado.

---

## Lo que ya está de pie

- **17 templates** normalizados a marca, en dos familias (contenido de valor + propiedad/operación).
- **El motor**: perfil desde Mongo, zonas e imágenes del inventario propio, hitos de operación,
  guardrails, y el swipe paramétrico.
- **El prototipo completo**: alta → hoy → editor → mis piezas, con datos reales, en un HTML
  autocontenido que no necesita servidor.
- **Diamond House medido**: 21 asesores reales, 22/22 con teléfono, 20/22 con inventario,
  349 avisos, 9 cierres en 30 días.

---

## Lo que falta para el piloto (A)

### 1. Que "Descargar" descargue de verdad — ✅ HECHO (17 ago 2026)
La pieza se pinta en un `<canvas>` y se baja como PNG a resolución completa. **Sin backend, sin
Playwright, sin costo** — funciona porque `images.pulppo.com` responde
`access-control-allow-origin: *` (si no, el canvas quedaría contaminado y `toBlob()` fallaría).

Cubre lo difícil: envoltura de texto igual que Polotno, fuentes de marca embebidas, fotos remotas
con `cover`, logos con `contain` para que nunca se recorten, esquinas redondeadas, rotación,
separadores `svg` y páginas múltiples (el carrusel baja una imagen por página, con pausa entre
descargas porque el navegador bloquea las ráfagas).

**Cómo verificarlo sin abrir el archivo:** la ruta `#png/<idea>` pinta el PNG real a tamaño
completo en la página; `#png/<idea>,<n>` para una página concreta del carrusel. Verificado en los
tres casos difíciles: lista con foto de perfil, propiedad con 4 fotos remotas + cobranding, y
página interior del carrusel.

### 2. Una URL por asesor
`studio.pulppo.com/d/<token>` — sin login, como ya se hace con la ficha del 1·5·10.
Arquitectura: **un bundle compartido** (fuentes + templates, ~5 MB, se cachea una vez) más un
**JSON chico por asesor** (~20 KB con su perfil, zonas, fotos y hitos). Regenerar a alguien es
reescribir 20 KB, no 5 MB.

### 3. Que no se borre al recargar
`localStorage` para las piezas bajadas y la racha. Cinco líneas. Sin esto la racha no existe y
la segunda visita se siente rota.

### 4. Captions que no den pena — *el riesgo real*
Hoy son textos que escribí a mano; el selector de emojis no está conectado a nada. Si el asesor
ve captions mediocres, el piloto fracasa por la razón equivocada.

Necesita dos cosas: **el doc de voz** y **una llamada de IA real** con una API key.

### 5. Hosting
Es estático. Cualquiera sirve (Vercel, Cloudflare Pages). **Yo no puedo desplegarlo: esta máquina
no tiene Node.** Lo sube alguien del equipo o se arrastra la carpeta en la web de Vercel.

---

## Lo que NO entra en el piloto

Dicho explícitamente para que nadie lo espere: cuentas y login · push diario automático por
WhatsApp · publicación nativa a Instagram · memoria de correcciones · dashboard de rendimiento ·
stickers · el resto de los 988 asesores.

El aviso diario del piloto **lo manda a mano el titular de Diamond House**. Cuesta 5 minutos y de
paso prueba una de las preguntas abiertas: si la inmobiliaria quiere estar en medio.

---

## Calendario

| | Qué |
|---|---|
| **Semana 1** | Exportación a imagen · URL por asesor · persistencia · captions con IA · hosting |
| **Semana 2, días 1-3** | **Prueba de pasillo con 3** — Miriam Cojab (67 avisos), Mery Tawil (44), David Mustri (37). Sentarse al lado y mirar |
| **Semana 2, día 4** | Corregir lo que salga. Siempre sale |
| **Semanas 3-4** | Los 21, con aviso diario del titular |

Los tres del pasillo tienen el inventario más rico del equipo: si algo se ve mal, se ve ahí primero.

---

## Qué se mide

La pregunta no es "¿les gustó?" sino **¿lo usaron dos veces?**

1. **¿Volvieron?** Un asesor que entra una vez vio una novedad. Uno que entra tres veces tiene un hábito.
2. **¿Bajaron algo?** Abrir sin bajar significa que el contenido no les sirvió.
3. **¿Lo publicaron?** El botón "ya lo publiqué" — es autorreportado y por eso alimenta la racha,
   **no el aprendizaje del motor**.
4. **¿Qué eligieron?** Si nadie toca el carrusel, sobra. Si todos van al hito de operación,
   eso es el producto.

Con 21 personas alcanza con mirar y preguntar. No hace falta analítica.

---

## Lo que necesito de ti

| Bloquea | Qué |
|---|---|
| **Captions** | El doc de voz: corre `/mcp` → "claude.ai Notion", o pégamelo |
| **Captions** | Una API key para la IA. **No voy a usar las de `pulppo-carousel-factory`**: están en texto plano en Downloads y no me consta que sean para esto |
| **Hosting** | Dónde va y quién despliega (yo no puedo, no hay Node) |
| **Piloto** | Luz verde para pedirle la foto a 3 de Diamond House: Jose Cruz, Diana Guerra, Lizeth Ortega |
| **Menor** | ✔️ o punto en tinta como viñeta del swipe |

---

## Riesgos, sin maquillar

- **Que abran una vez y no vuelvan.** Es el resultado más probable y el más útil: significa que
  el contenido no es lo bastante bueno, no que falte producto. Se arregla con contenido, no con código.
- **Que el copy no suene a ellos.** Ahí muere la mitad de estas herramientas. Mitigable con el doc
  de voz y pidiendo una muestra de escritura cuando algo no les guste.
- **Que copiar y pegar en Instagram sea demasiada fricción.** Es la apuesta consciente de la fase 1.
  Si el piloto muestra que ahí se cae todo, la conexión de Instagram sube de prioridad — y con
  evidencia para justificarla.
- **Que 21 sea muestra chica.** Lo es. Sirve para descartar, no para confirmar.

---

## Después del piloto (B), si se justifica

La arquitectura ya está probada en Habipublicador y no hay que inventarla: Next.js en Vercel,
Supabase para cuentas y datos, un reloj externo que llama de a un usuario por vez, y WhatsApp por
Infobip con plantilla aprobada. Lo que cambia es el canal (Instagram, no LinkedIn) y que nuestras
piezas son diseños, no párrafos.

Ese orden importa: **primero saber que lo usan, después construir para que escale.**
