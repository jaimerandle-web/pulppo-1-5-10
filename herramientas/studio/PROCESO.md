# Pulppo Studio — Motor de ideas · Esqueleto del proceso

Complemento de Pulppo Creators. No es un formulario: sugiere **qué publicar** y entrega el **template editable** para hacerlo, personalizado a la cuenta del broker.

---

## 1. Los dos momentos del broker

**A) Configura su perfil (1 sola vez)**
Nombre, foto, teléfono, handle, logo/color (si aplica), zonas donde opera, tipo de propiedad, tono. → Se guarda y alimenta el autofill `{{broker.*}}` en TODO su contenido.

**B) Pide una pieza (recurrente, mínimo esfuerzo)**
El sistema le propone ideas → elige una → responde solo los blank spaces → recibe el diseño listo y editable.

---

## 2. Flujo end-to-end

```
[Perfil del broker]  ──────────────┐  (autofill {{broker.*}})
                                    ▼
1. MOTOR DE IDEAS  →  propone N ideas al broker
   (por categoría, según su perfil/zona/temporada)
                                    │
2. Broker ELIGE una idea            ▼
                                    │
3. RUTEO  →  la idea define categoría → template + formato (post/story)
                                    │
4. GENERACIÓN DE COPY (IA)          ▼
   rellena los blank spaces on-brand (o los sugiere para que edite)
                                    │
5. AUTOFILL  →  copy + datos de perfil → tokens {{...}} del JSON Polotno
                                    │
6. ENTREGA  →  diseño editable (Polotno) + caption sugerida
                                    │
7. MEMORIA  →  guarda correcciones del broker → mejora futuras piezas
```

---

## 3. Objetos de datos (el "contrato")

**Perfil**
`{ broker_id, name, phone, handle, photo_url, zonas[], tipo_propiedad[], tono, logo_url? }`

**Categoría** (taxonomía Notion contenido de valor + marca personal)
`consejo · frase · zonas · dato · pregunta · requisitos · marca_personal`

**Idea** (lo que produce el motor)
```
{ id, categoria, formato: post|story, titulo_idea, gancho,
  template_ref,                 // a qué JSON mapea
  campos: [ {token, label, hint, ejemplo} ] }
```

**Template** (los 12 JSON ya hechos)
`{ ref, categoria, formato, dimensiones, tokens[], tokens_perfil[] }`

> ## Hay DOS FAMILIAS de templates, con mecanismos de llenado distintos
>
> Descubierto el 6 ago 2026 con los 4 templates que faltaban (`contenido-valor/propiedad/`).
> No es un detalle: cambia de dónde sale el contenido.
>
> | | **Contenido de valor** (12) | **Propiedad / operación** (4) |
> |---|---|---|
> | Ejemplo de token | `{{zona}}`, `{{ventaja_1}}` | `{{attributes.bathrooms}}`, `{{pictures.0.url}}` |
> | Dónde vive el token | en el **`text`** del elemento | en el **`name`** del elemento (el `text` trae un valor de ejemplo) |
> | Qué es el token | un **blank space** que llena la IA | una **ruta al documento de la propiedad** en Mongo |
> | Quién lo llena | IA + perfil del broker | **merge de datos. Cero IA.** |
> | Esfuerzo del asesor | completar 2-8 campos | **ninguno** |
>
> Los de propiedad son mucho más confiables: no hay nada que inventar ni que revisar. Cobertura
> de los campos que piden, sobre las 9,199 publicadas: `type` `operation` `price` `street` 100%,
> colonia 99%, `totalSurface` 93%, `parkings` 89%, `bathrooms` 78%, `suites` 75%.
> Fotos: 96% tiene ≥1, 94% tiene ≥5, **80% tiene las ≥11** que necesita la secuencia de 6 páginas.
>
> ⚠️ `listing.operation` viene **en inglés** (`sale` 7,157 · `rent` 2,041): sin traducir, la pieza
> sale con "[ DEPARTAMENTO EN RENT ]".
> ⚠️ `company.logo` tiene **tres variantes**: `default`, `pulppo` y `pulppoInverted`. Los templates
> nuevos usan `pulppoInverted`, que es la que funciona sobre foto oscura. Esto resuelve el problema
> de contraste de logo que encontramos revisando lo de Luis.
>
> **Además, los 12 de contenido de valor tienen slots de imagen**: elementos con `name` sin llaves
> (`broker.photo`, `pulppo.logo`, `foto.*`) que hay que resolver aparte porque no aparecen en
> `blank_spaces`. Descubierto el 4 ago al renderizar la primera pieza — el autofill por tokens
> dejaba la foto del broker como un círculo gris.
>
> | Slot | Qué es | En cuántos templates | De dónde sale |
> |---|---|---|---|
> | `broker.photo` | círculo 78px, viene como `figure` gris | 4 | `agents.profilePicture` (94% de los activos). Hay que **convertir el `figure` en `image`**, un `figure` no acepta `src`. |
> | `pulppo.logo` | logo 150x64 / 170x72 | 8 | El de Pulppo por default; el de la inmobiliaria si el broker eligió usar el propio (`company.logo.default`, 97%). |
> | `foto.lugar` · `foto.fondo` · `foto.zona` | imagen a sangre completa | 4 | **Era el hueco:** ni el perfil ni la IA pueden generarla. Resuelto usando las **fotos del inventario propio del broker** (`properties.pictures` con `public: true` y `is_blueprint: false`), indexadas por colonia → la foto es de la zona de la que habla la pieza. |

**Pieza generada**
`{ id, broker_id, idea_id, valores:{token→texto}, caption, json_final, estado }`

**Corrección / memoria**
`{ broker_id, campo, antes, despues, patron }`  → ej. "siempre firma con 'Lic.'", "no usa emojis"

---

## 4. Decisión que gatea todo: ¿de dónde salen las ideas?

- **(a) Banco curado** — biblioteca fija de ideas por categoría. Control editorial total, on-brand garantizado, pero estático y se repite.
- **(b) IA pura** — Claude genera ideas frescas por broker/zona/temporada. Infinitas y personalizadas, pero requiere guardrails de marca.
- **(c) Híbrido (RECOMENDADO)** — semillas curadas por categoría (asegura marca y variedad) + IA que las **personaliza** al perfil del broker y su zona, y expande cuando se agotan. Lo mejor de ambos y es lo que conecta de verdad con Creators.

> Propongo (c). El banco de semillas lo armamos una vez (reusa los 5 pilares del proyecto de inmobiliarias) y la IA lo mantiene vivo.

---

## 5. Mapeo idea → template (con los 12 ya hechos)

| Categoría | Idea ejemplo | Template |
|---|---|---|
| consejo | "5 ventajas de invertir en {zona}" | `consejo_5-ventajas` |
| consejo | "Cómo {tema} en 3 pasos" | `consejo_3-pasos` |
| requisitos | "Requisitos para {trámite}" | `consejo_requisitos` |
| frase | motivación / inversión | `frase_quote` / `historia_frase` |
| zonas | "Los mejores {lugar} de {zona}" | `zonas_los-mejores` |
| zonas | "Top 5 {cosa} de {zona}" | `zonas_top5` |
| dato | dato de mercado que sorprende | `dato_declaracion` / `historia_dato` |
| pregunta | enganche que responden por DM | `pregunta_portada` / `historia_pregunta` |

---

## 6. Orden de construcción sugerido

1. ✅ **[este doc] Esqueleto + contrato de datos**
2. ✅ **Banco de semillas de ideas** — `motor/semillas_ideas.json` (19 semillas, 6 categorías) + `motor/prompt_personalizacion.md`
3. ✅ **Catálogo de templates** — `motor/templates.json` (12: 8 post + 4 story)
4. ✅ **Prototipo del flujo end-to-end** — `motor/prototipo.py`, corrido de punta a punta el 4 ago 2026 ← **estamos aquí**
5. ⬜ **UI** (web app) sobre el prototipo ya funcionando
6. ⬜ **Memoria de correcciones**

### Estado del prototipo (paso 4)

`motor/prototipo.py` recorre el flujo completo sin UI, read-only sobre Mongo:

```
python prototipo.py perfil --email <mail>                    # 1 · autofill desde Mongo
python prototipo.py ideas  --email <mail> --categoria zonas   # 2/3 · motor + ruteo
python prototipo.py pieza  --email <mail> --idea consejo:0 \  # 4·5·6 · copy → autofill → entrega
    --copy salidas/copy_ejemplo.json
python preview.py                                             # visor local → localhost:8765
```

**Para VER las piezas** (mientras no exista la UI del paso 5): `python preview.py` renderiza los
JSON de `salidas/` a HTML y los sirve en `localhost:8765`. Usa las fuentes embebidas del template,
marca los slots de imagen y pinta en rojo los tokens sin resolver. Es una aproximación: el
navegador no usa el motor de texto de Polotno (konva), así que los saltos de línea pueden variar.

Corrida de referencia (Viola Prat, Andina Real Estate): perfil 5/5 tokens desde Mongo, zonas
pre-sugeridas de su inventario (Polanco 11 avisos, Roma Norte 3…), pieza `consejo:0` generada
con 0 tokens pendientes y guardrails en verde → `salidas/*.json` listo para abrir en Polotno.

**La capa de IA está desacoplada** en `generar_copy()`: con `ANTHROPIC_API_KEY` llama a Claude
con el system prompt de `prompt_personalizacion.md`; sin key, se le pasa el copy con `--copy`
(así se probó hoy, fixture en `salidas/copy_ejemplo.json`). Cambiar una por otra no toca el pipeline.

**Guardrails ya activos** (`validar_marca()`): sin emojis, sin MAYÚSCULAS, sin campos vacíos,
sin tokens sin resolver. Si algo falla la pieza sale con `estado: "revisar"` en vez de romperse.

### Pendientes conocidos

- La categoría **`marca_personal`** está en la taxonomía (§3) pero no tiene semillas ni template.
- Enriquecer las semillas `dato`/`zonas` con datos reales de Mongo en vez de que la IA los invente.
- `{{broker.handle}}` no existe en Mongo (`socialMedia` NO lo trae) → hoy queda sin resolver en
  `frase_quote` e `historia_frase` hasta que el alta lo pregunte.
- **Nombres de archivo intercambiados:** `consejo_5-ventajas_post.json` contiene en realidad la
  portada "Los mejores {{lugar}} de {{zona}}" y `zonas_los-mejores_post.json` contiene la lista de
  5 ventajas. `templates.json` y `semillas_ideas.json` ya apuntan al archivo correcto; los nombres
  siguen mintiendo. Si se renombran, actualizar ambos JSON.
