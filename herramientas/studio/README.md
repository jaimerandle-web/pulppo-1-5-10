# Motor de Pulppo Studio

Esto no es código de la app. Es el **generador**: lee Mongo, resuelve el copy y los datos de
cada asesor contra los templates de Polotno, y escribe un HTML autocontenido. Ese HTML es lo
único que la app sirve, versionado en `public/studio/index.html`.

Vive acá porque el Studio es una herramienta de este repo y no tenía sentido mantener dos
sitios donde buscar. `.vercelignore` deja `herramientas/` fuera del deploy: son 61 MB de
templates que nadie necesita para construir la app.

## Redeployar el Studio

```sh
cd herramientas/studio/motor
<python-con-pymongo> gen_prototipo_web.py --equipo "DIAMOND HOUSE" --salida studio_piloto --incluir-todos
cp studio_piloto/index.html ../../../public/studio/index.html
```

`--incluir-todos` no es opcional: sin él se caen los asesores sin inventario publicado —hoy
uno de los 22 de Diamond House— y el archivo deja de reconocer su correo, así que rebotan
al entrar.

En esta mac el intérprete con `pymongo` es
`/Users/alebonilla/Documents/Pulppo/.venv-mongo/bin/python`, y la URI de Mongo está en
`~/Downloads/mongo_uri.txt` (con BOM: hay que leerla como `utf-8-sig`).

## Verificar antes de subir

El generador escribe el bundle sin quejarse aunque una pieza salga vacía, así que hay dos
rutas por hash para revisarlo. Las dos necesitan la cookie `cm-user`, que Chrome no acepta
para `file://` — hay que servir el directorio por http.

- `#empalmes` — audita todas las ideas × páginas y reporta texto encimado. Mide la **tinta**
  con los rects del rango, no la caja declarada: el div va con `height:auto` y un "1" de
  30px vive en una caja de 90, así que medir cajas daba 32 falsos positivos.
- `#png/<idea>[,<página>[,<formato>]]` — pinta el PNG real, que es lo único que verifica lo
  que se va a descargar. La vista previa es DOM y la descarga es canvas: son dos
  renderizadores distintos y cualquier cambio hay que hacerlo en los dos.

## Piezas

Los templates viven en `contenido-valor/`. Hay dos familias y no se resuelven igual:

- **contenido de valor** — el token va en `text`, la IA rellena los huecos, tienen espacios
  de imagen `foto.*`.
- **propiedad / operación** — el token va en `name` y es una ruta al documento de la
  propiedad; se resuelven sin IA. Ojo: en estas, `name` **manda sobre** `text`, y el `text`
  es sólo un valor de ejemplo. Un subtítulo que se lee "UNA MENOS EN EL MERCADO" en el JSON
  puede imprimir otra cosa, porque su `name` es `{{articulo_tipo}} {{type}} menos en el
  mercado`.

Los `_45.json` son la versión 4:5 (1080×1350), que es el post de Instagram. Los `_story` son
9:16. Cada variante puede pedir tokens propios, así que los tokens de una idea se toman de
la **unión** de sus variantes: extraerlos sólo del template por defecto ya hizo salir una
pieza rediseñada completamente vacía.

Las 8 fuentes van embebidas en base64 en cada JSON. Es redundante —son las mismas en los 31
archivos, 37 de los 44 MB— pero se deja así a propósito: extraerlas rompe abrir un template
directo en Polotno con la tipografía correcta, que es como se editan.

## Scripts

Cada cambio de diseño es un script idempotente, no una edición a mano del JSON. Se corren
desde `motor/` y reescriben los templates:

| script | qué hace |
| --- | --- |
| `aplicar_cobrand.py` | mete el co-marca inmobiliaria/Pulppo en los 12 templates |
| `aplicar_tipografia.py` | etiquetas en Nunito, filete amarillo más delgado, cuerpo en Nunito |
| `aplicar_retro_ale.py` | la retro de Ale por número de arte |
| `crear_templates_contrato.py` | deriva "Nuevo contrato" de "Cierre exitoso" |
| `crear_templates_alertas.py` | baja de precio y nueva propiedad |
| `convertir_45.py` | 3:4 y 1:1 → 4:5 |
| `rediseñar_nueva.py` | "recién publicada": precio → qué es → dónde |
| `rediseñar_ficha45.py` | la ficha en 4:5 |
| `clasificar_fotos.py` | etiqueta cada foto con visión y guarda la caché |
