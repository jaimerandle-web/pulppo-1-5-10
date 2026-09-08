# El mix — qué rescatamos de cada uno

Tres proyectos que resuelven partes distintas del mismo problema. **Pulppo Studio es la base**: su
lógica, su contrato de datos y su flujo mandan. Los otros dos entran como capas, no como reemplazo.

| | Qué aporta | Rol en el mix |
|---|---|---|
| **Pulppo Studio** (`~/Documents/Pulppo/pulppo-studio`) | El dato inmobiliario y el motor de ideas | **La base** — el cerebro |
| **Habipublicador** (`EstebanCastel/habipublicador`) | Arquitectura de agente diario en producción, para LinkedIn | El esqueleto — el loop |
| **Carousel Factory** (Luis, `~/Downloads/pulppo-carousel-factory`) | Sistema de diseño oficial y render | La piel |

---

## 1 · La base que NO se toca (Pulppo Studio)

Todo esto ya está construido y validado, y es lo que ninguno de los otros dos tiene:

- **El contrato de datos**: `Perfil · Idea · Template · Pieza · Corrección` (`PROCESO.md` §3).
- **El motor híbrido**: semillas curadas (garantizan marca) + IA que personaliza y expande.
- **El perfil que se pre-llena solo** desde `agents`: 100% nombre, 94% foto, 97% teléfono/inmobiliaria/logo
  sobre los 988 activos. El broker solo responde 4 preguntas.
- **La inteligencia inmobiliaria — lo único verdaderamente nuestro:**
  - zonas deducidas del inventario real (`address.neighborhood.name`),
  - fotos de sus propias propiedades (`pictures` con `public: true`),
  - eventos de operación: publicó · cerró · bajó precio · firmó exclusiva.
- **Los 12 templates de Polotno** con su doble contrato: `{{tokens}}` de texto **y** slots de imagen
  por `name` (`broker.photo`, `pulppo.logo`, `foto.*`).
- **Los guardrails de marca** corriendo antes de mostrar la pieza.
- **El flujo de pantallas** de `ESTRUCTURA_APP.md`: Hoy · Mis piezas · Perfil.

---

## 2 · De Habipublicador — el esqueleto del producto

Es el mismo producto para otro canal, ya en producción. Lo que se adopta:

### Se adopta tal cual
- **El push diario.** Un aviso por WhatsApp con plantilla aprobada y **un botón de URL** que lleva a
  la pantalla del día. Reemplaza mi mecanismo de "las ideas caducan a medianoche": esperar a que el
  broker abra la app por voluntad propia era el punto más débil de la estructura.
- **El reloj externo.** Generar para una persona toma 60-110 s; el plan Hobby de Vercel corta a los
  5 min y los últimos de la lista no reciben nada **sin dar error**. Solución de ellos: un cron
  externo que llama `?one=1` cada minuto → **una persona por llamada**.
- **URLs de imagen estables.** Las imágenes generadas caducan antes de que Meta las descargue: hay
  que copiarlas a Storage propio antes de mandarlas.
- **El modelo de estados**: `draft / published / discarded` + `user_edited` + `variant` (A control,
  B y C experimentos). Casi idéntico al que propuse, pero probado.

### Se adopta con adaptación
- **Aprender la voz del historial real**, no solo de correcciones. Detalles que valen oro:
  - se aprende de las publicaciones que **mejor rindieron**, no de todas;
  - el largo se calcula con **mediana, no promedio** (un viral largo deforma la medida);
  - con historial flaco (< 250 caracteres de media) se ignora la medida y se usa un default.
  - **Para nosotros el historial es Instagram, y ya lo tenemos en Metricool** — no hay que
    construir un scraper como el de ellos.
- **El loop de rendimiento**: publicado → métricas → qué sugerir después. Es lo que convierte esto
  de un generador en un agente.

### Se descarta
- El scraper de LinkedIn con Playwright y sesión guardada (no aplica: usamos Metricool).
- La estructura de contenido de texto plano: nuestras piezas son **diseños**, no párrafos.

---

## 3 · De Carousel Factory — la piel

### Se adopta ya
- **Los design tokens oficiales de Pulppo (abril 2026)** — `design_system/brand.py`:

  | Token | Oscuro | Claro |
  |---|---|---|
  | fondo | `#212322` | `#F3F3F3` |
  | texto | `#FFFFFF` | `#212322` |
  | acento | `#F6BE00` | `#F6BE00` |
  | secundario | `#529999` | `#529999` |
  | gris | `#B7B7B7` | `#B7B7B7` |
  | alerta | `#A52003` | `#A52003` |

  Confirma el amarillo que ya usaban los templates y agrega el teal y el rojo de alerta, que no
  teníamos. **Regla dura: cero sombras** (`box-shadow` y `text-shadow` prohibidos).
- **Los logos SVG oficiales de Pulppo** (isotipo y completo) y el **bloque de cobranding**
  Pulppo + inmobiliaria en posición fija. Hay **220 archivos de logos** locales cuyos nombres
  matchean con las `company.name` de Mongo.
- **La base de conocimiento** (7 notas: zonas, consejos, créditos hipotecarios, reforma de
  servicios inmobiliarios CDMX, tendencias). **Destraba el guardrail de "no inventamos cifras"**:
  hoy dejamos el campo vacío porque no hay de dónde sacar el dato; con esto sí lo hay.
- **Pexels** para fotos de stock. **Resuelve el problema del 50%** de brokers sin inventario propio
  para los 4 templates a sangre.

### Se adopta en fase 2
- **El render a PNG con Playwright en batch.** Polotno entrega un diseño editable pero no una
  imagen: para bajar el PNG hace falta este paso.
- **Los carruseles.** Es un formato que no tenemos en ningún template y que, según el análisis de
  julio, rinde mejor que la imagen suelta.

### Veredicto del estilo gráfico (paso 0, revisado el 5 ago 2026)

Los 3 arquetipos se renderizaron con contenido real de Diamond House (Miriam Cojab, Hacienda de las
Palmas, fotos de su inventario). Ver `revision/comparacion_estilo.html`.

| Qué | Decisión |
|---|---|
| Arquetipo **Data-Driven** | **Tomar** — el más limpio, aguanta contenido largo |
| Estructura de 3 actos | **Tomar** — portada → contenido → CTA |
| Convenciones de carrusel («desliza», «guarda este post», numeración) | **Tomar** — es oficio |
| Cobranding inmobiliaria + Pulppo | **Tomar**, con el par de logos correcto por tema |
| Palabras clave en amarillo | **Tomar** |
| EB Garamond | **Cambiar** por Heldane Text |
| Foto de fondo al 15% de opacidad | **Cambiar** — o se ve, o se va |
| Patrón isométrico de cubos | **Sacar** — ensucia y envejece |
| Arquetipo **Hero Minimalista** | **Dejar** — depende de fotos curadas que no tenemos |
| Tailwind y fuentes por CDN | **Cambiar** por embebido — hoy falla en silencio |

**Dos bugs, no preferencias:** en modo claro el «GUARDA ESTE POST» amarillo no se lee y el logo de
la inmobiliaria casi desaparece (los archivos son la versión clara). Con 220 logos, elegir mal el
par se nota en todas las piezas de esa inmobiliaria.

---

## 4 · Las tres decisiones que el mix obliga

### a) Dos motores de render — DECIDIDO, y al revés de lo previsto (6 ago 2026)

La duda era si el carrusel entraba como HTML→PNG con el motor de Luis. **Ya no hace falta: el
carrusel se hace en Polotno.** El `pages` de un JSON de Polotno *es* un carrusel, y estaba a la
vista todo el tiempo — el template de propiedad que faltaba tiene **6 páginas** y el de cierre 2.

Se construyó `consejo_swipe_post.json`: **plantilla paramétrica de 5 páginas** (portada → 3 puntos
→ cierre) con la estructura leída de los swipes reales de Canva. Generador: `motor/gen_swipe.py`,
parametrizable de 2 a 5 puntos.

- **Todo lo que ve el asesor → Polotno.** Editable, un solo motor, una sola convención de tokens.
- **El motor HTML→PNG de Luis** queda para el **factory** (contenido de marca en batch hecho por
  el equipo Pulppo), no para el self-serve.

**Por qué una paramétrica y no rearmar los 106 diseños de Canva:** en Canva hay 106 porque cada
pieza se armó a mano. Contando estructuras distintas son cinco, y cuatro ya están cubiertas. Con
la del swipe, las 106 quedan cubiertas por 17 templates.

Formatos que publican de verdad las inmobiliarias (395 piezas del CSV de calendarización):
frase corta 136 (40%) ✅ · **swipes 96 (28%)** ✅ ahora · **reels 65 (19%)** → no es un hueco de
template, es de idea: se resuelve con las **ideas sin diseño** · imagen fija 35 ✅ · propiedad 6 ✅

### a-bis) Tipografía — DECIDIDO (5 ago 2026)

**Heldane Text es la tipografía de display, sin excepciones.** El motor de Luis usa EB Garamond,
que es el sustituto gratuito de Google Fonts. Heldane real **ya está embebida como data URI dentro
de los 12 templates de Polotno**, así que no hay que licenciar ni descargar nada: se extrae de ahí
y se embebe también en el render de carrusel.

De paso se corrige un problema mayor: hoy el engine de Luis carga Tailwind y las fuentes **desde CDN
en tiempo de render**. Sin internet, el PNG sale con otra tipografía y no avisa. Todo embebido.

### b) Emojis — regla corregida
El motor de Habipublicador detecta si la persona usa emojis y **los mantiene**, con un comentario
explícito en el código: quitárselos por una regla genérica de "profesionalismo" le rompe la voz.
Nuestro `prompt_personalizacion.md` dice "Sin emojis" como regla absoluta. Se corrige así:

1. **La pieza (el diseño) no lleva emojis.** Es marca, y ahí manda el sistema de diseño.
2. **La caption sigue la voz del broker.** Si él usa emojis, se usan.
3. **Regla de marca Pulppo:** los emojis de persona y de mano van **siempre con modificador de tono
   de piel** (👋🏽 y no 👋). Límite técnico: solo los emojis humanos aceptan modificador — las
   caritas amarillas (😀) lo son por diseño de Unicode y no se pueden cambiar, así que se evitan.

### c) Publicación — ver §5

---

## 5 · El bloqueo de Instagram

Publicar por el broker exige que **cada uno** convierta su cuenta a Business/Creator, la vincule a
una página de Facebook y nos dé permiso. Sobre 988 brokers, eso es un muro en el paso 1 del alta.

**Metricool queda descartado como capa de publicación** (verificado el 5 ago 2026): **no hay
ninguna cuenta de broker conectada**, no alcanzan los espacios contratados ni para el piloto, y el
precio es **por cuenta** — con 988 brokers no escala. Metricool sigue en su lugar actual: análisis
a nivel inmobiliaria, que es para lo que ya se usa.

Eso invierte la conclusión intuitiva: **la opción "difícil" es la escalable.** La API de Instagram
no cobra por cuenta, y una sola conexión del broker habilita **publicar y leer métricas** — las dos
cosas que necesitamos. Lo caro no es la API, es la fricción del alta.

| Fase | Cómo publica | Qué exige | Qué perdemos |
|---|---|---|---|
| **1 · Descargar** | Baja el PNG, copia la caption, la pega en Instagram | **Nada.** Sale ya | No sabemos qué publicó |
| **2 · Conectar Instagram** | Publicación y métricas nativas desde Studio | Business + página de FB + revisión de app | — |

**Fase 1 para arrancar y para el piloto.** Es como funciona Canva, no depende de la aprobación de
nadie y no tiene costo por cuenta.

**El costo real de la fase 1 no es la fricción, es que rompe el loop de aprendizaje.** Si no sabemos
qué se publicó ni cómo rindió, el agente nunca aprende — y esa es justamente la mejor parte de
Habipublicador. Mitigación barata: un botón **"ya lo publiqué"** al bajar la pieza, que alimenta la
racha y nos dice qué eligió (aunque no cómo rindió).

**La fase 2 se decide después del piloto, no antes.** Pedirle a un broker que convierta su cuenta a
Business y la vincule a Facebook solo se justifica si ya demostró que usa la herramienta. Primero
el uso, después el permiso.

---

## 6 · El piloto: Diamond House

Medido en Mongo el 5 ago 2026. **22 brokers activos** (21 reales — `Operaciones Temp` es una cuenta
de prueba sin actividad desde enero 2025):

| | |
|---|---|
| Con teléfono | **22 de 22** → el push por WhatsApp llega al 100% del equipo |
| Con foto de perfil | 18 de 22 — faltan Diana Guerra, Jose Cruz, Lizeth Ortega y la cuenta de prueba |
| Con inventario publicado | **20 de 22** → las zonas y las fotos propias funcionan para casi todos |
| Avisos publicados del equipo | 349 |
| Operaciones cerradas (30 d) | 9 → el banner se dispara ~9 veces al mes en el equipo |
| Actividad | casi todos entraron a la plataforma hoy |

Es mejor piloto de lo que parecía: no son "pocos", son 21 brokers activos de verdad y el equipo
entero es alcanzable por WhatsApp.

**Tres cosas a favor:**
- **La lista de fotos y el piloto convergen.** Dos de los que no tienen foto (Jose Cruz, Diana
  Guerra) ya estaban en la lista de prioridad de `brokers_sin_foto.csv`. El piloto arranca
  pidiéndoles la foto: son 3 personas, no 55.
- **Prueba la lógica de zonas fuera de CDMX.** El inventario del equipo incluye Zibatá (Querétaro)
  y Puerto Morelos (Quintana Roo), no solo Lomas y Tecamachalco. Si el motor solo funcionara en
  CDMX, acá se ve.
- **Hay titular** (Joshua Slodownik, 25 avisos), así que también se puede probar la pregunta de si
  la inmobiliaria quiere revisar lo que publican sus asesores.

**Cómo se mide un piloto sin publicación nativa:** con 21 personas alcanza con el botón "ya lo
publiqué" y preguntarles. Con 988 no alcanzaría — pero para entonces ya sabremos si vale la pena
pedir la conexión de Instagram.

---

## 7 · Orden sugerido

1. Aplicar los **tokens oficiales** y la regla de cero sombras a lo que ya existe (prototipo incluido).
2. Enchufar la **base de conocimiento** al guardrail de datos y **Pexels** al slot de foto.
3. Cerrar la **fase 1 de publicación** (descargar + copiar + "ya lo publiqué").
4. Recién ahí, reescribir `ESTRUCTURA_APP.md` con el push diario y el loop de rendimiento.
5. Fase 2 (Metricool) y carruseles, según lo que diga la verificación de cuentas conectadas.
