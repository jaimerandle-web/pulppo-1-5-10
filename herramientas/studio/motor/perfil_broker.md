# Perfil del broker — cuestionario de alta (config 1 sola vez)

Principio: **mínimo esfuerzo.** El broker ya existe en Pulppo → pre-llenamos desde la plataforma/Mongo y solo pedimos confirmar. Solo preguntamos de cero lo que Pulppo NO tiene (voz, zonas de especialización, preferencias). Perfil progresivo: lo esencial ahora, el resto se aprende del uso y las correcciones.

Cada campo indica a qué alimenta:
`[AUTOFILL]` = token `{{...}}` directo en el diseño · `[IDEAS]` = personaliza qué sugerir · `[VOZ]` = memoria de tono.

---

## Bloque 1 · Identidad — YA LA SABEMOS (login con mail de Pulppo → colección `agents`)
No se pregunta: se pre-llena solo y el broker confirma/edita. **Mapeo verificado en Mongo (4 ago 2026).**

> ⚠️ **Corrección de la primera medición.** Las coberturas originales se calcularon sobre los 3,965 documentos de `agents`, que incluyen 2,939 inactivos y 712 de un tipo legacy `broker`. La base real de Studio son los **988 activos** (`type ∈ {associate, master}` + `status: "active"` + `deletedAt: null`). Sobre esa base el autofill es mucho mejor de lo que parecía:

| Dato | Campo en `agents` | Cobertura (988 activos) | Antes (base sucia) | Token |
|---|---|---|---|---|
| Nombre | `firstName` + `lastName` | **988/988 (100%)** | 99.9% | `{{broker.name}}` |
| Foto de perfil | `profilePicture` (URL `images.pulppo.com` → sirve directo en Polotno) | **933/988 (94%)** | 64% | `{{broker.photo}}` |
| WhatsApp / teléfono | `personal.phone` (97%) ∪ `phone` (73%) | **962/988 (97%)** | ~70% | `{{broker.phone}}` |
| Inmobiliaria | `company.name` (embebido) | **962/988 (97%)** | 78% | `{{company.name}}` |
| **Logo de la inmobiliaria** | `company.logo.default` | **960/988 (97%)** | — | `{{company.logo}}` |
| Email | `email` (= login) | **988/988 (100%)** | 84% | — |

**Ojo con el teléfono:** el mejor campo es `personal.phone` (97%), NO `phone` (73%). Leer `personal.phone` primero y caer a `phone`.

**`socialMedia` NO sirve para el handle de Instagram.** Contiene `{maslow: <score>}` y `{facebook: {accessToken}}` — nunca el @. El handle se pregunta en el Bloque 2, sin excepción.

Fallback: si a un broker le falta foto/teléfono, ese campo cae al alta como "confirmar/completar". Son pocos: ver `brokers_sin_foto.csv` (55 activos sin foto, 6%).
**Bonus [IDEAS]:** las **zonas** se pueden PRE-SUGERIR cruzando `properties.agent.email` → colonias de su inventario, y solo pedir que confirme/ajuste (aún menos fricción).

## Bloque 2 · Contacto público — PREGUNTAR (corto)
| Pregunta | Alimenta | Token |
|---|---|---|
| ¿Cuál es tu usuario de Instagram? (@) | [AUTOFILL] | `{{broker.handle}}` |
| ¿Cómo firmas? (Lic. / Arq. / Ing. / solo tu nombre) | [VOZ][AUTOFILL] | prefijo de `{{broker.name}}` |
| ¿Tienes logo/color propio o usas el de Pulppo? | [AUTOFILL] | `logo_url` / `color` |

## Bloque 3 · Tu negocio — PREGUNTAR (define QUÉ ideas se sugieren)
| Pregunta | Alimenta |
|---|---|
| ¿En qué **zonas/colonias** te especializas? (1–5) | [IDEAS] `{{zona}}` — clave para consejo/zonas/dato |
| ¿Vendes, rentas o ambas? | [IDEAS] — sesga captación vs. inversión |
| Tipo de propiedad: departamento / casa / terreno / comercial / desarrollos | [IDEAS] |
| Segmento: residencial / lujo / inversión / primera vivienda | [IDEAS] — ajusta el tono del copy |

## Bloque 4 · Tu voz — PREGUNTAR (memoria inicial, se afina con el uso)
| Pregunta | Alimenta |
|---|---|
| Tono: cercano / neutral / formal | [VOZ] |
| ¿Usas emojis? sí / pocos / no | [VOZ] |
| Tu CTA preferido (ej. "Escríbeme por DM", "Te dejo mi WhatsApp") | [VOZ][AUTOFILL] |
| ¿Hashtags propios que siempre usas? (opcional) | [VOZ] |
| ¿Dónde publicas? IG feed · IG stories · FB · TikTok | [IDEAS] — define formatos (post 4:5 vs story 9:16) |

---

## Lo verdaderamente ESENCIAL (si hubiera que reducir a lo mínimo)
1. Nombre · 2. Foto · 3. WhatsApp · 4. Instagram · 5. **Zonas de especialización** · 6. Tono + emojis sí/no.
Los primeros 4 salen pre-llenados de Pulppo → el broker en la práctica solo responde **5 y 6**.

## Lo que NO se pregunta (se aprende solo)
- Correcciones repetidas → memoria (`{broker_id, campo, antes, despues, patron}`): "siempre cambia X por Y", "borra el emoji", "acorta títulos".
- Qué categorías usa más → el motor prioriza esas ideas.
