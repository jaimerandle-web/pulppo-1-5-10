#!/usr/bin/env python
"""
Pulppo Studio — genera el prototipo web clickeable (paso 5, para revisión antes de construir).

Produce UN archivo HTML autocontenido con el flujo completo: alta → hoy → editor → mis piezas.
No es un mockup dibujado: los templates, las fuentes, el perfil, las zonas, las fotos y el evento
de operación salen de los JSON reales y de Mongo.

  python gen_prototipo_web.py                       # broker demo por default
  python gen_prototipo_web.py --email otro@mail.com

Salida: prototipo_web/index.html  (~1.5 MB, la mayor parte son las 8 fuentes de marca)
"""
import argparse
import json
import re
from pathlib import Path

import zonas_pois

BASE = Path(__file__).resolve().parent
RAIZ = BASE.parent
TEMPLATES_DIR = RAIZ / "contenido-valor"
OUT_DIR = BASE / "prototipo_web"
URI_FILE = Path.home() / "Downloads" / "mongo_uri.txt"

CSS_APP = """
.tope,.riel,.pie{display:none}
.escena{padding:0;max-width:560px;margin:0 auto;gap:0}
/* min-height:0 es la clave: el layout de escritorio deja .tel con min-height:640px y eso GANA
   sobre height:100dvh. En cualquier teléfono con menos de 640px de alto util (iPhone SE, 12 mini,
   o cualquier iPhone con las barras de Safari abiertas) la barra de pestañas quedaba DEBAJO del
   borde de la pantalla, sin forma de llegar a ella. Medido en WebKit el 18-ago-2026. */
.tel{flex:1 1 auto;width:100%;max-width:none;border:0;border-radius:0;box-shadow:none;
  height:100vh;height:100dvh;min-height:0;position:static;overscroll-behavior:contain}
.vista{min-height:0}
/* el indicador de inicio del iPhone se come la franja de abajo */
.tabs{padding-bottom:env(safe-area-inset-bottom,0px)}
/* iOS infla el texto por su cuenta si no se le dice que no */
html{-webkit-text-size-adjust:100%}
/* blancos de toque de 44px: abajo de eso se falla el dedo */
.tel button{min-height:44px}
.tel .linkbtn{min-height:44px;display:inline-flex;align-items:center}
.tel .pager button{width:44px;height:44px}
.tel .tabs button{min-height:52px}
body{background:var(--superficie)}
@media (min-width:600px){
  body{background:var(--papel)}
  .escena{padding:24px 0}
  .tel{height:calc(100dvh - 48px);border:1px solid var(--gris-claro);border-radius:22px}
}
</style>"""

DEMO = "romina.toso@pulppo.com"

# Equipo Pulppo (misma lista que access.ts en pulppo-1-5-10). Solo ellos ven el selector
# "¿quién eres?" para probar; un asesor entra directo a su perfil y nadie más pasa.
INTERNOS = [
    "jaime.randle@pulppo.com", "alejandra@pulppo.com", "ezequiel@pulppo.com",
    "matias@pulppo.com", "agustin@pulppo.com", "karen@pulppo.com", "laura@pulppo.com",
    "sofia.cedillov@pulppo.com", "ulises.chavez@pulppo.com", "alonso@pulppo.com",
    "luis@pulppo.com", "multimediapulppo@pulppo.com", "claudio@pulppo.com",
]
FILTRO_ACTIVOS = {"type": {"$in": ["associate", "master"]}, "status": "active", "deletedAt": None}

# Rango de una baja de precio publicable. El piso descarta el ajuste cosmético y el techo
# descarta el error de dedo o el cambio de operación que se colara. Con 1% entran bajas de
# $40,000 sobre $2,990,000: ciertas pero flojas como noticia. Subirlo a 0.03 es una línea.
BAJA_MIN, BAJA_MAX = 0.01, 0.30


# Mongo guarda el celular de dos formas —`+52 1 55 7893 5745` en personal.phone y
# `525578935745` en la raíz— y las dos salían impresas con la lada pegada. En una lona o en
# un post el que lee marca desde México: el +52 1 sólo estorba. Se imprime `55 7893 5745`.
def telefono_mx(bruto):
    d = re.sub(r"\D", "", str(bruto or ""))
    if len(d) < 10:
        return ""
    d = d[-10:]                      # se cae la lada 52 y el 1 viejo de celular
    return f"{d[:2]} {d[2:6]} {d[6:]}"


# Mongo escribe la misma colonia de varias formas: en Diamond House conviven
# "Bosques de las Lomas" (19 avisos) y "Bosque de las Lomas" (14), que son la misma. Sobre
# 111 colonias eso sale varias veces y el asesor ve la zona duplicada. Se agrupan por clave
# normalizada —sin acentos, sin conectores, sin plural en las palabras largas— y de cada
# grupo se muestra la grafía que más avisos tiene.
_CONECTORES = {"de", "del", "la", "las", "los", "el", "y"}


def clave_colonia(nombre):
    import unicodedata
    s = unicodedata.normalize("NFD", (nombre or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]+", " ", s)
    palabras = []
    for w in s.split():
        if w in _CONECTORES:
            continue
        # sólo se singulariza lo largo: evita convertir nombres cortos en otra cosa
        palabras.append(w[:-1] if len(w) > 4 and w.endswith("s") else w)
    return " ".join(palabras)


def agrupar_colonias(cuenta):
    """{(colonia, ciudad): n} → [{zona, ciudad, avisos}] con las variantes ya unidas."""
    import collections
    grupos = collections.defaultdict(list)
    for (col, ciu), n in cuenta.items():
        grupos[clave_colonia(col)].append((n, col, ciu))
    salida = []
    for variantes in grupos.values():
        total = sum(n for n, _, _ in variantes)
        _, col, ciu = max(variantes, key=lambda v: (v[0], -len(v[1])))
        salida.append({"zona": col, "ciudad": ciu, "avisos": total})
    return sorted(salida, key=lambda z: (-z["avisos"], z["zona"]))


# Las colonias de la inmobiliaria son las MISMAS para los 22 asesores del archivo, así que
# se calculan una vez por inmobiliaria y no 22 veces sobre los mismos 338 avisos.
_ZONAS_EMPRESA = {}


def zonas_de_inmobiliaria(db, comp):
    import collections
    cid = comp.get("_id")
    if not cid:
        return []
    if cid not in _ZONAS_EMPRESA:
        cuenta = collections.Counter()
        for p in db.properties.find({"company._id": cid, "status.last": "published"},
                                    {"address.neighborhood.name": 1, "address.city.name": 1}):
            ad = p.get("address") or {}
            col = ((ad.get("neighborhood") or {}).get("name") or "").strip()
            if col:
                cuenta[(col, ((ad.get("city") or {}).get("name") or "").strip())] += 1
        _ZONAS_EMPRESA[cid] = agrupar_colonias(cuenta)
    return _ZONAS_EMPRESA[cid]


# --------------------------------------------------------------------- datos
def datos_broker(email):
    from pymongo import MongoClient
    import collections
    import datetime as dt

    db = MongoClient(URI_FILE.read_text(encoding="utf-8-sig").strip()).pulppo
    a = db.agents.find_one({**FILTRO_ACTIVOS, "email": email})
    if not a:
        raise SystemExit(f"✗ no hay broker activo con email {email}")
    comp = a.get("company") or {}

    zonas, fotos, tipos = collections.Counter(), {}, collections.Counter()
    for p in db.properties.find({"agent.email": email, "status.last": "published"},
                                {"address": 1, "type": 1, "pictures": 1}):
        ad = p.get("address") or {}
        col = ((ad.get("neighborhood") or {}).get("name") or "").strip()
        ciu = ((ad.get("city") or {}).get("name") or "").strip()
        if p.get("type"):
            tipos[p["type"]] += 1
        if not col:
            continue
        zonas[(col, ciu)] += 1
        buenas = [x["url"] for x in (p.get("pictures") or [])
                  if x.get("url") and x.get("public") and not x.get("is_blueprint")]
        if buenas:
            fotos.setdefault(col, []).extend(buenas[:6])

    # Eventos que disparan el banner. La captación sale de `properties` —publicar un aviso es
    # un hecho del aviso— pero el cierre NO: sale de `operations`.
    #
    # Antes se usaba `properties.status.last == "completed"`, y ése es el estado de la
    # PROPIEDAD, que no sabe qué es una oferta. Por eso no se podía distinguir "hay una oferta"
    # de "está cerrado", y Ale lo pidió explícito: una oferta se puede caer, no es un cierre.
    # Los estados reales viven en `operations.status.last` (medidos 2-sep-2026 en toda la red):
    #   closed 4,673 · cancelled 3,730 · offer_blocked 156 · contract 120 · offer 109 · paying 91
    # Decisión de Ale: sólo disparan `contract` y `closed`. `offer`, `offer_blocked` y `paying`
    # no producen pieza.
    #
    # El asesor cuenta si está en CUALQUIERA de los dos lados: puede haber captado la propiedad
    # (seller) o traído al comprador (buyer). Las dos son un cierre suyo. `user.email` no sirve
    # de criterio: es quien creó el registro, no necesariamente quien operó.
    corte = dt.datetime.now() - dt.timedelta(days=30)
    eventos = []
    for p in db.properties.find({"agent.email": email, "status.last": "published"},
                                {"listing.title": 1, "address": 1,
                                 "status.history": 1, "type": 1}):
        ts = [h["timestamp"] for h in (p.get("status") or {}).get("history", [])
              if h.get("status") == "published" and isinstance(h.get("timestamp"), dt.datetime)]
        if ts and max(ts) >= corte:
            eventos.append({"ts": max(ts), "clase": "captacion", "prop_id": p["_id"],
                            "colonia": (((p.get("address") or {}).get("neighborhood") or {}).get("name") or ""),
                            "tipo": p.get("type") or "Propiedad",
                            "titulo": (p.get("listing") or {}).get("title", "")})

    # Baja de precio. Sale de `propertyhistories.changes[]`, que guarda `from` y `to` por campo.
    #
    # Dos filtros que NO son opcionales, medidos sobre 4,000 documentos de 30 días: de 620
    # bajas, 46 eran en realidad un cambio de VENTA A RENTA en el mismo movimiento —producen
    # caídas como 22,000,000 → 100,000— y 89 quedaban fuera de un rango sano. Sin esto la
    # pieza saldría a la calle diciendo "¡Baja de precio! antes $22,000,000, ahora $100,000".
    # Quedan 485 publicables.
    ids_propios = [x["_id"] for x in db.properties.find(
        {"agent.email": email, "status.last": "published"}, {"_id": 1})]
    if ids_propios:
        for h in db.propertyhistories.find(
                {"propertyId": {"$in": ids_propios}, "updatedAt": {"$gte": corte},
                 "changes.path": "listing.price.price"},
                {"changes": 1, "propertyId": 1, "updatedAt": 1}).sort("updatedAt", -1):
            cambios = h.get("changes") or []
            # si la operación cambió en el mismo movimiento, el precio no es comparable
            if any(c.get("path") == "listing.operation" for c in cambios):
                continue
            precio = [c for c in cambios if c.get("path") == "listing.price.price"]
            if not precio:
                continue
            try:
                antes, ahora = float(precio[-1]["from"]), float(precio[-1]["to"])
            except (TypeError, ValueError, KeyError):
                continue
            if not (antes > ahora > 0):
                continue
            pct = (antes - ahora) / antes
            if not (BAJA_MIN <= pct <= BAJA_MAX):
                continue
            prop = db.properties.find_one({"_id": h["propertyId"]},
                                          {"address": 1, "type": 1, "listing.title": 1})
            if not prop:
                continue
            eventos.append({"ts": h["updatedAt"], "clase": "baja_precio",
                            "prop_id": h["propertyId"],
                            "colonia": (((prop.get("address") or {}).get("neighborhood") or {}).get("name") or ""),
                            "tipo": prop.get("type") or "Propiedad",
                            "titulo": (prop.get("listing") or {}).get("title", ""),
                            "precio_antes": int(antes), "precio_ahora": int(ahora),
                            "baja_pct": round(pct * 100)})
            break        # una sola: la más reciente

    # `contrato` y `venta` sólo si ése es el estado ACTUAL de la operación: una que ya cerró
    # también tiene `contract` en su historial, y celebrar el contrato de algo ya vendido
    # sería mirar al pasado.
    lado = {"$or": [{"seller.broker.email": email}, {"buyer.broker.email": email}]}
    for clase, estado in (("contrato", "contract"), ("venta", "closed")):
        for o in db.operations.find({**lado, "status.last": estado},
                                    {"status.history": 1, "property._id": 1,
                                     "property.address": 1, "property.type": 1,
                                     "property.listing.title": 1}):
            hist = (o.get("status") or {}).get("history", [])
            ts = [h["timestamp"] for h in hist
                  if h.get("status") == estado and isinstance(h.get("timestamp"), dt.datetime)]
            prop = o.get("property") or {}
            if ts and max(ts) >= corte and prop.get("_id"):
                eventos.append({"ts": max(ts), "clase": clase, "prop_id": prop["_id"],
                                "colonia": (((prop.get("address") or {}).get("neighborhood") or {}).get("name") or ""),
                                "tipo": prop.get("type") or "Propiedad",
                                "titulo": (prop.get("listing") or {}).get("title", "")})
    eventos.sort(key=lambda e: e["ts"], reverse=True)
    for e in eventos:
        dias = (dt.datetime.now() - e["ts"]).days
        # `cuando` es solo respaldo: el archivo es estático y vive semanas, así que si se dejara
        # escrito a fuego seguiría diciendo "ayer" un mes después. La app recalcula desde `fecha`.
        e["cuando"] = "hoy" if dias == 0 else ("ayer" if dias == 1 else f"hace {dias} días")
        e["fecha"] = e.pop("ts").strftime("%Y-%m-%d")

    # el documento completo de la propiedad del evento más reciente de cada clase:
    # es lo que llena los templates de propiedad/operación
    props = {}
    for e in eventos:
        if e["clase"] in props:
            continue
        props[e["clase"]] = db.properties.find_one(
            {"_id": e["prop_id"]},
            {"type": 1, "listing.operation": 1, "listing.price": 1, "address": 1,
             "attributes": 1, "pictures": 1, "development": 1})
    # La pieza de captación sirve para CUALQUIER aviso publicado, no solo uno reciente:
    # el banner aparece si hay uno nuevo, pero el asesor puede compartir el que quiera.
    if "captacion" not in props:
        props["captacion"] = db.properties.find_one(
            {"agent.email": email, "status.last": "published"},
            {"type": 1, "listing.operation": 1, "listing.price": 1, "address": 1,
             "attributes": 1, "pictures": 1, "development": 1},
            sort=[("publishedAt", -1)])
    # el orden de fotos (desarrollo primero) se resuelve acá, que es donde hay conexión;
    # `construir()` no la tiene y lo consume ya listo
    for clase, prop in props.items():
        if prop:
            prop["_fotos"] = fotos_de_prop(db, prop)

    for e in eventos:
        e.pop("prop_id", None)
    evento = eventos[0] if eventos else None

    # Las suyas primero (van preseleccionadas); después las de la inmobiliaria que no sean ya
    # suyas, comparadas por clave normalizada para no ofrecerle "Bosque de las Lomas" cuando
    # ya tiene "Bosques de las Lomas".
    mias = agrupar_colonias(zonas)[:5]
    claves_mias = {clave_colonia(z["zona"]) for z in mias}
    otras = [z for z in zonas_de_inmobiliaria(db, comp)
             if clave_colonia(z["zona"]) not in claves_mias]

    # las fotos se guardaron con la grafía cruda; se reindexan a la grafía que ganó el grupo
    # para que fotoPara() encuentre la foto de la zona y no caiga a "cualquiera"
    fotos_norm = {}
    for col, urls in fotos.items():
        k = clave_colonia(col)
        nombre = next((z["zona"] for z in mias if clave_colonia(z["zona"]) == k), col)
        fotos_norm.setdefault(nombre, []).extend(urls)
    fotos = fotos_norm

    # El login acepta el email de TRABAJO o el PERSONAL (asesorIdForEmail busca con
    # $or:[{email},{personal.email}]), pero el archivo buscaba el perfil sólo por el de
    # trabajo: quien entraba con su Google personal pasaba la puerta y después el archivo le
    # decía "todavía no está para tu equipo". En Diamond House le pasa a 11 de 22 asesores
    # (7 con Gmail). Se guardan los dos y el navegador compara contra los dos.
    personal = ((a.get("personal") or {}).get("email") or "").strip().lower()
    return {
        "email": email,
        "emails": sorted({email.strip().lower()} | ({personal} if personal else set())),
        "nombre": f"{a.get('firstName','')} {a.get('lastName','')}".strip(),
        "pila": (a.get("firstName") or "").strip(),
        "foto": a.get("profilePicture") or "",
        "telefono": telefono_mx((a.get("personal") or {}).get("phone") or a.get("phone")),
        "inmobiliaria": comp.get("name") or "",
        "logo": ((comp.get("logo") or {}).get("default")) or "",
        # las 3 variantes: `default` es la inmobiliaria sola (negra), `pulppo` y
        # `pulppoInverted` son el lockup co-marca. El co-brand va en todas las piezas.
        "logos": {k: v for k, v in ((comp.get("logo") or {}) if isinstance(comp.get("logo"), dict) else {}).items()},
        "rol": "titular" if a.get("type") == "master" else "asesor",
        "zonas": mias,
        # el resto del inventario de la inmobiliaria: el asesor trabaja zonas donde todavía
        # no tiene aviso propio, y antes no había forma de elegirlas
        "zonas_inmobiliaria": otras,
        "tipos": [t for t, _ in tipos.most_common(3)],
        "fotos_por_zona": fotos,
        "evento": evento,
        "eventos": eventos[:4],
        "_props": props,        # interno: se consume al resolver tokens, no llega al HTML
        "_agente": {"company": comp},
        "total_publicados": sum(zonas.values()),
    }


# Los templates de propiedad/operación NO tienen blank spaces: sus tokens son rutas
# al documento de la propiedad en Mongo. Se resuelven acá y llegan al prototipo ya listos.
def resolver_ruta(doc, ruta):
    cur = doc
    for parte in ruta.split("."):
        if cur is None:
            return None
        if parte.isdigit():
            cur = cur[int(parte)] if isinstance(cur, list) and int(parte) < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(parte)
        else:
            return None
    return cur


# listing.operation viene en inglés en Mongo ('sale' 7157 · 'rent' 2041): sin traducir,
# la pieza sale con "[ DEPARTAMENTO EN RENT ]".
OPERACION = {"sale": "VENTA", "rent": "RENTA"}


def formatear(ruta, v):
    if v is None or v == "":
        return ""
    if ruta == "listing.price.price":
        return f"{int(v):,}"
    if ruta == "listing.operation":
        return OPERACION.get(str(v).lower(), str(v).upper())
    if ruta == "type":
        return str(v).upper()
    if ruta == "attributes.totalSurface":
        return str(int(v)) if float(v) == int(float(v)) else str(v)
    return str(v)


# Ale, 2-sep: "si es desarrollo que se vea el edificio, no la foto del comedor". No hay campo
# que diga cuál es la fachada —las fotos son un array sin etiquetas— pero los desarrollos SÍ
# tienen su propio array, que suele ser render y fachada. Así que se ponen primero las del
# desarrollo y el asesor elige entre las primeras, en vez de que un modelo adivine.
# Ale, 8-sep: "NUNCA proponer fotos del baño; deja sólo fachada, comedor, sala, recámaras,
# amenidades". Con los datos que hay esto se puede hacer A MEDIAS y hay que ser claro sobre
# el límite: sólo el 4% de las descripciones nombra el espacio —el resto son nombres de
# archivo tipo "imagen 0" o "8.jpg"—. Así que:
#   · lo que SÍ dice baño/wc/lavandería se descarta (son 157 en la muestra de 63,045)
#   · lo que dice fachada/sala/comedor/recámara/amenidad se pone ADELANTE
#   · el 96% sin etiqueta queda en medio, y ahí no hay forma de saber sin mirar la imagen
# Para cumplir el "nunca" hace falta clasificar con visión una vez por foto y guardar la
# etiqueta; con texto solo, no se puede prometer.
_FUERA = re.compile(r"ba[nñ]o|\bwc\b|lavander|closet|vestidor|cuarto de servicio|"
                    r"medio ba[nñ]o|sanitario", re.I)
_ADELANTE = re.compile(r"fachada|frente|exterior|sala|comedor|estancia|rec[aá]mara|"
                       r"recamara|amenidad|alberca|roof|terraza|jard[íi]n|lobby|"
                       r"vista|render", re.I)


def ordenar_fotos(pics):
    """Descarta lo que se declara baño y adelanta lo que se declara espacio principal."""
    buenas, neutras = [], []
    for f in pics:
        d = f.get("description") or ""
        if _FUERA.search(d):
            continue
        (buenas if _ADELANTE.search(d) else neutras).append(f["url"])
    return buenas + neutras


def fotos_de_prop(db, prop):
    propias = ordenar_fotos([p for p in (prop.get("pictures") or [])
                             if p.get("url") and p.get("public") and not p.get("is_blueprint")])
    dev = (prop.get("development") or {}) if isinstance(prop.get("development"), dict) else {}
    del_desarrollo = []
    if dev.get("_id"):
        d = db.developments.find_one({"_id": dev["_id"]}, {"pictures": 1}) or {}
        for x in (d.get("pictures") or []):
            u = x.get("url") if isinstance(x, dict) else x
            if u and u not in propias:
                del_desarrollo.append(u)
    return del_desarrollo + propias


# `development.name` llega sucio de Mongo: " RESIDENCIAL VIDALTA" con espacio al inicio y todo
# en mayúsculas, "Central Park Interlomas " con espacio al final. Se limpia y, si viene GRITADO,
# se pasa a capitular — pero sólo si no tiene ninguna minúscula, para no estropear nombres que
# ya vienen bien escritos ("La Enramada", "Central Park Interlomas").
# Palabras con las que arranca una DIRECCIÓN, no el nombre de un residencial. Hay
# `development.name` que traen la calle entera ("Calle 51A No. 528 Residencial Xcanatún"):
# eso impreso en una pieza se lee como un error, así que se descarta.
_CALLEJERO = re.compile(
    r"^(calle|av\.?|avenida|blvd\.?|boulevard|privada|priv\.?|circuito|carretera|camino|"
    r"prolongaci[oó]n|retorno|cerrada|and[aá]dor)\b|\bno\.?\s*\d|#\s*\d", re.I)


# `development.name` también trae relleno de formulario en vez de vacío: "N/A" en 22 avisos
# publicados, más "NA", "Casa", "Urban", "-". Impreso como titular de la pieza se lee como un
# error del sistema, así que se trata igual que un campo vacío. Ojo: los nombres CORTOS sí son
# reales en este mercado —AGOR, Bilú, LUMA, FLOW, G25— y no se pueden descartar por longitud.
_RELLENO = {"n/a", "na", "n.a.", "null", "none", "nulo", "s/n", "sn", "-", "--", "---", ".",
            "0", "no aplica", "ninguno", "ninguna", "sin nombre", "sin dato", "x", "xx",
            "pendiente", "por definir", "casa", "departamento", "depto", "terreno", "oficina",
            "local", "bodega", "edificio"}


def nombre_residencial(bruto):
    n = " ".join(str(bruto or "").split())
    if not n or _CALLEJERO.search(n):
        return ""
    if n.lower().strip(".,;:") in _RELLENO:
        return ""
    # más de 30 caracteres no cabe en la línea y casi siempre es basura pegada
    if len(n) > 30:
        return ""
    # se capitula cuando viene en un solo registro —GRITADO o en minúsculas— y se respeta
    # el que ya está bien escrito ("La Enramada", "Central Park Interlomas")
    if not any(c.islower() for c in n) or not any(c.isupper() for c in n):
        n = " ".join(_capitular(w) for w in n.split())
    return n


# `str.title()` a secas convierte "NB23" en "Nb23" y "SITE" en "Site": destroza siglas y
# nombres con número, que en desarrollos son comunes. Se respetan.
def _capitular(palabra):
    if any(c.isdigit() for c in palabra) or (len(palabra) <= 4 and palabra.isupper()):
        return palabra
    return palabra.capitalize()


# Ale, 2-sep: "sumar el nombre del residencial y la colonia de donde se vendió esa propiedad.
# Si no tiene residencial, entonces sólo el nombre de la colonia". Cobertura de
# `development.name`: 2,450 de 9,394 publicados (26%), así que la mayoría cae al segundo caso.
def ubicacion_de(prop):
    dev = prop.get("development") if isinstance(prop.get("development"), dict) else {}
    residencial = nombre_residencial((dev or {}).get("name"))
    colonia = ((prop.get("address") or {}).get("neighborhood") or {}).get("name") or ""
    colonia = " ".join(str(colonia).split())
    # si el residencial ya nombra la colonia ("Residencial Xcanatún" en Xcanatún) repetirla
    # suena a error; gana el residencial, que es lo más específico
    if residencial and colonia and colonia.lower() not in residencial.lower():
        return f"{residencial} · {colonia}"
    return residencial or colonia


# `precio_antes` y `precio_ahora` no viven en la propiedad —el precio viejo sólo existe en el
# historial— así que salen del evento y se inyectan aparte. Formateados como el resto de los
# precios de las piezas.
def tokens_del_evento(evento):
    if not evento:
        return {}
    out = {}
    if evento.get("precio_antes"):
        out["precio_antes"] = f'{evento["precio_antes"]:,}'
    if evento.get("precio_ahora"):
        out["precio_ahora"] = f'{evento["precio_ahora"]:,}'
    if evento.get("baja_pct"):
        out["baja_pct"] = str(evento["baja_pct"])
    return out


# El género del tipo de propiedad, para que la pieza no diga "una departamento". Va mapa
# explícito y no una regla de sufijo: "Nave industrial" es femenino y termina en -e, así que
# cualquier atajo se rompe justo ahí. Son los 14 tipos que existen en avisos publicados.
GENERO = {
    "departamento": "m", "casa": "f", "terreno residencial": "m", "oficina": "f",
    "casa en condominio": "f", "local": "m", "bodega comercial": "f",
    "terreno comercial": "m", "edificio": "m", "nave industrial": "f",
    "terreno industrial": "m", "local en centro comercial": "m",
    "casa uso de suelo": "f", "finca": "f",
}


def articulo_de(tipo):
    """'Un departamento' / 'Una casa'. Si el tipo es desconocido, femenino: el sustantivo
    implícito es 'propiedad', que es el que se usa cuando no se nombra el tipo."""
    return "Un" if GENERO.get(str(tipo or "").strip().lower()) == "m" else "Una"


# Ale, 8-sep: el título de la ficha quedaba larguísimo porque llevaba la calle completa Y
# el residencial Y la colonia. Debe ser UNA cosa: el residencial si es desarrollo, y si no
# la calle sin el prefijo de vialidad ("Calle Adolfo López Mateos 55" → "Adolfo López Mateos 55").
_VIALIDAD = re.compile(r"^(calle|av\.?|avenida|blvd\.?|boulevard|privada|priv\.?|circuito|"
                       r"cerrada|and[aá]dor|camino|carretera|retorno|prolongaci[oó]n)\s+", re.I)


def titulo_corto_de(prop):
    dev = prop.get("development") if isinstance(prop.get("development"), dict) else {}
    residencial = nombre_residencial((dev or {}).get("name"))
    if residencial:
        return residencial
    calle = " ".join(str(((prop.get("address") or {}).get("street") or "")).split())
    calle = _VIALIDAD.sub("", calle).strip()
    # La calle viene con cosas que no son la calle. Casos reales de Diamond House:
    #   "Fraccionamiento Residencial Xcanatún, Mérida Yucatán"  → sobra la ciudad y el estado
    #   "Horacio 1825 - 301 (LG)"                               → sobra el interior y el código
    calle = calle.split(",")[0]                       # lo de después de la coma es ciudad/estado
    calle = re.sub(r"\s*\([^)]*\)\s*$", "", calle)     # códigos internos entre paréntesis
    calle = re.sub(r"\s+-\s+\S+$", "", calle)          # " - 301", el número de interior
    calle = calle.strip(" -,·")
    # si aun así es kilométrico no cabe en un titular; antes que dejarlo VACÍO, la colonia
    if len(calle) <= 34 and calle:
        return calle
    return " ".join(str(((prop.get("address") or {}).get("neighborhood") or {})
                        .get("name") or "").split())


# Un terreno no tiene recámaras ni baños, así que una línea escrita token por token
# —"{{attributes.suites}} rec · {{attributes.bathrooms}} baños · {{attributes.totalSurface}} m²"—
# imprime "rec · baños · m²": las etiquetas se quedan huérfanas porque son texto literal y
# ningún relleno posterior las puede borrar. Se arma del lado de los datos y sólo con lo que
# existe, así la misma pieza sirve para un departamento y para un lote.
# La superficie vive en dos campos y cuál aplica depende del tipo: una casa trae
# `totalSurface` (construido + terreno) y un terreno NO —Terra Serena tiene surface: 1803.6 y
# totalSurface ausente—, así que pedir sólo `totalSurface` deja al terreno sin el único número
# que importa. Se toma el primero que exista, en ese orden.
_SPECS = [("suites", "rec"), ("bathrooms", "baños"), ("parkings", "est")]
_SUPERFICIE = ("totalSurface", "surface")


def _numero(v):
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
        return None
    return int(v) if float(v).is_integer() else round(v, 1)


def specs_de(prop):
    attrs = prop.get("attributes") or {}
    partes = []
    for campo, etiqueta in _SPECS:
        # el 0 se descarta a propósito: "0 est" es peor que no decir nada
        n = _numero(attrs.get(campo))
        if n is not None:
            partes.append(f"{n} {etiqueta}")
    for campo in _SUPERFICIE:
        n = _numero(attrs.get(campo))
        if n is not None:
            # los decimales de la superficie no aportan nada y alargan la línea: 1803.6 → 1,804
            partes.append(f"{round(n):,} m²")
            break
    return " · ".join(partes)


def tokens_de_propiedad(prop, agente, tokens, fotos=None):
    """Resuelve cada token contra la propiedad; los company.* salen del agente."""
    if fotos is None:
        fotos = [p["url"] for p in (prop.get("pictures") or [])
                 if p.get("url") and p.get("public") and not p.get("is_blueprint")]
    doc = dict(prop)
    doc["pictures"] = [{"url": u} for u in fotos]          # solo las publicables, reindexadas
    doc["company"] = (agente.get("company") or {})
    out = {}
    for t in tokens:
        # `ubicacion` no es una ruta del documento: se compone de dos campos con una regla
        if t == "ubicacion":
            out[t] = ubicacion_de(prop)
        elif t == "titulo_corto":
            out[t] = titulo_corto_de(prop)
        elif t == "colonia":
            # cuando el título ya lleva el residencial, la línea de abajo sería una repetición
            out[t] = " ".join(str(((prop.get("address") or {}).get("neighborhood") or {})
                                  .get("name") or "").split())
        elif t == "articulo_tipo":
            out[t] = articulo_de(prop.get("type"))
        elif t == "specs":
            out[t] = specs_de(prop)
        else:
            out[t] = formatear(t, resolver_ruta(doc, t))
    return out, fotos


def cargar_templates():
    """Devuelve (fuentes_unicas, {ref: {width,height,pages}}) — las 8 fuentes son idénticas
    en los 12 templates, así que se embeben una sola vez."""
    fuentes, tpl = {}, {}
    refs = sorted(p.name for p in TEMPLATES_DIR.glob("*.json"))
    refs += sorted("stories/" + p.name for p in (TEMPLATES_DIR / "stories").glob("*.json"))
    refs += sorted("propiedad/" + p.name for p in (TEMPLATES_DIR / "propiedad").glob("*.json"))
    for ref in refs:
        d = json.loads((TEMPLATES_DIR / ref).read_text(encoding="utf-8"))
        for f in d.get("fonts", []):
            if f.get("fontFamily") and str(f.get("url", "")).startswith("data:"):
                fuentes.setdefault(f["fontFamily"], f["url"])
        tpl[ref] = {"width": d.get("width"), "height": d.get("height"),
                    "pages": [{"background": pg.get("background") or "white",
                               "children": pg.get("children", [])} for pg in d.get("pages", [])]}
    return fuentes, tpl


def tokens_de(tplobj):
    s = json.dumps(tplobj, ensure_ascii=False)
    return sorted(set(re.findall(r"\{\{([^}]+)\}\}", s)))


# Una idea puede vivir en varios lienzos (post, story, 4:5) y NO son el mismo diseño: cada uno
# puede pedir tokens distintos. Si se extraen sólo del template por defecto, la variante con
# tokens propios sale vacía —le pasó al rediseño de "recién publicada", que estrenó precio y
# características y salió con "$" sin cifra—. Se toma la unión de todas sus variantes.
def tokens_de_idea(it, tpl):
    refs = [it["template_ref"]] + list((it.get("formatos") or {}).values())
    toks = set()
    for r in refs:
        if r in tpl:
            toks |= set(tokens_de(tpl[r]))
    return sorted(toks)


# --------------------------------------------------------------------- build
def construir(email, modo_app=False):
    broker = datos_broker(email)
    fuentes, tpl = cargar_templates()
    biblio = json.loads((BASE / "copy_biblioteca.json").read_text(encoding="utf-8"))

    props = broker.pop("_props", {}) or {}
    agente = broker.pop("_agente", {}) or {}

    # cada idea se queda solo con lo que el prototipo necesita + sus tokens reales
    ideas = []
    for it in biblio["ideas"]:
        ref = it["template_ref"]
        if ref not in tpl:
            raise SystemExit(f"✗ la idea {it['id']} apunta a un template inexistente: {ref}")
        toks = tokens_de_idea(it, tpl)
        idea = {**it, "tokens": toks, "paginas": len(tpl[ref]["pages"]),
                "formato": "story" if ("stories/" in ref or "_story" in ref) else "post"}

        # familia propiedad/operación: los valores NO los escribe la IA, se resuelven
        # de la propiedad real del evento
        if it.get("seccion") == "operacion":
            prop = props.get(it.get("clase"))
            if prop:
                vals, fotos = tokens_de_propiedad(prop, agente, toks, prop.get("_fotos"))
                ev = next((e for e in (broker.get("eventos") or [])
                           if e.get("clase") == it.get("clase")), None)
                vals.update(tokens_del_evento(ev))
                idea["valores_sugeridos"] = vals
                idea["fotos_disponibles"] = len(fotos)
                idea["fotos_urls"] = fotos[:6]
                idea["desde_datos"] = True
                faltan = [t for t in toks if not vals.get(t)]
                if faltan:
                    idea["tokens_vacios"] = faltan
            else:
                idea["sin_evento"] = True
        ideas.append(idea)

    face_css = "\n".join(
        f"@font-face{{font-family:'{fam}';src:url({url});font-display:block;}}"
        for fam, url in fuentes.items())

    creators = json.loads((BASE / "ideas_creators.json").read_text(encoding="utf-8"))
    # Los hechos de zona salen de propertypois y son verificables: reemplazan las
    # afirmaciones inventadas que se imprimían idénticas para toda colonia.
    _filtro_zonas = {"status.last": "published", "agent.email": email}
    _colonias = [c for c in db.properties.distinct(
        "address.neighborhood.name", _filtro_zonas) if c]
    hechos = zonas_pois.hechos_por_zona(db, _colonias, _filtro_zonas)
    datos = {"broker": broker, "templates": tpl, "ideas": ideas, "hechos_zona": hechos,
             "semana": creators["ideas"],
             "sin_diseno": biblio.get("ideas_sin_diseno", []),
             "cobertura": {"activos": 988, "con_foto_pct": 94, "con_inventario": 490,
                           "con_evento_30d": 169}}

    html = (PLANTILLA
            .replace("/*__FACES__*/", face_css)
            .replace("/*__DATOS__*/", json.dumps(datos, ensure_ascii=False)))
    if modo_app:
        html = html.replace("</style>", CSS_APP, 1)

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / "index.html"
    out.write_text(html, encoding="utf-8")
    return out, broker, len(ideas)


# ------------------------------------------------------------------ plantilla
PLANTILLA = r"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Pulppo Studio · prototipo del flujo</title>
<style>
/*__FACES__*/
:root{
  --tinta:#212322; --papel:#FBFAF7; --superficie:#FFFFFF; --acento:#F6BE00;
  --gris:#8C8C86; --gris-claro:#E4E2DA; --plomo:#221122;
  --ok:#1C6B34; --ok-bg:#E4F0E5; --alerta:#8A4B00; --alerta-bg:#FBEBD8;
  --display:'HeldaneTextRegular',Georgia,serif;
  --cuerpo:'NunitoSans_10pt-Regular',system-ui,sans-serif;
  --cuerpo-b:'NunitoSans_10pt-Bold',system-ui,sans-serif;
  --etiq:'Mark-Medium','Mark-Book',system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --tinta:#F1EFE7; --papel:#17181A; --superficie:#212220; --gris:#9A9A92;
  --gris-claro:#33342F; --ok:#8FD3A2; --ok-bg:#1E3324; --alerta:#F0BE85; --alerta-bg:#3A2A16;
}}
:root[data-theme="dark"]{
  --tinta:#F1EFE7; --papel:#17181A; --superficie:#212220; --gris:#9A9A92;
  --gris-claro:#33342F; --ok:#8FD3A2; --ok-bg:#1E3324; --alerta:#F0BE85; --alerta-bg:#3A2A16;
}
:root[data-theme="light"]{
  --tinta:#212322; --papel:#FBFAF7; --superficie:#FFFFFF; --gris:#8C8C86;
  --gris-claro:#E4E2DA; --ok:#1C6B34; --ok-bg:#E4F0E5; --alerta:#8A4B00; --alerta-bg:#FBEBD8;
}
*{box-sizing:border-box}
body{margin:0;background:var(--papel);color:var(--tinta);font-family:var(--cuerpo);
  line-height:1.5;-webkit-font-smoothing:antialiased}
.tope{max-width:1180px;margin:0 auto;padding:40px 28px 16px}
.tope h1{font-family:var(--display);font-weight:400;font-size:clamp(30px,4.4vw,46px);
  margin:0 0 10px;letter-spacing:-.015em;text-wrap:balance}
.tope h1 em{font-style:normal;border-bottom:3px solid var(--acento);padding-bottom:1px}
.tope p{margin:0;max-width:64ch;color:var(--gris);font-size:15px}
.escena{max-width:1180px;margin:0 auto;padding:24px 28px 72px;display:flex;gap:40px;
  align-items:flex-start;flex-wrap:wrap}

/* ---------- teléfono ---------- */
.tel{flex:0 0 392px;max-width:100%;background:var(--superficie);border:1px solid var(--gris-claro);
  border-radius:30px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.10);
  display:flex;flex-direction:column;height:748px;position:sticky;top:20px}
.barra{display:flex;align-items:center;gap:8px;padding:11px 18px;border-bottom:1px solid var(--gris-claro);
  font-family:var(--etiq);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris);flex:0 0 auto}
.barra .marca{width:9px;height:9px;border-radius:50%;background:var(--acento)}
.vista{flex:1;overflow-y:auto;overflow-x:hidden}
.pad{padding:20px}
.tabs{display:flex;border-top:1px solid var(--gris-claro);flex:0 0 auto}
.tabs[hidden]{display:none}
.quienes{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.quien{display:flex;align-items:center;gap:12px;padding:11px 8px;border:0;border-bottom:1px solid var(--gris-claro);
  background:none;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit}
.quien:last-child{border-bottom:0}
.quien:hover,.quien:focus-visible{background:var(--papel)}
.quien img,.quien .sinfoto{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:0 0 auto}
.quien .sinfoto{background:var(--gris-claro)}
.quien .n{display:flex;flex-direction:column;min-width:0}
.quien .n b{font-family:var(--cuerpo-b);font-size:14px}
.quien .n i{font-style:normal;font-size:11.5px;color:var(--gris)}
.tabs button{flex:1;background:none;border:0;padding:12px 4px 14px;font-family:var(--etiq);
  font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--gris);cursor:pointer}
.tabs button[aria-current="true"]{color:var(--tinta);box-shadow:inset 0 2px 0 var(--acento)}
.tabs button:focus-visible{outline:2px solid var(--acento);outline-offset:-2px}

h2.pant{font-family:var(--display);font-weight:400;font-size:26px;margin:0 0 6px;letter-spacing:-.01em}
.sub{color:var(--gris);font-size:13px;margin:0 0 20px}
.rot{font-family:var(--etiq);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--gris);display:flex;justify-content:space-between;align-items:center;margin:24px 0 10px}
.rot:first-child{margin-top:0}

/* ---------- alta ---------- */
.dato{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--gris-claro)}
.dato:last-of-type{border-bottom:0}
.dato .et{font-family:var(--etiq);font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--gris);flex:0 0 78px}
.dato .vl{font-size:14px;font-family:var(--cuerpo-b);flex:1;word-break:break-word}
.dato img.av{width:38px;height:38px;border-radius:50%;object-fit:cover}
.dato img.lg{height:26px;max-width:96px;object-fit:contain}
.tick{color:var(--ok);font-size:13px;flex:0 0 auto}
label.q{display:block;font-size:13px;font-family:var(--cuerpo-b);margin:18px 0 7px}
label.q span{display:block;font-family:var(--cuerpo);color:var(--gris);font-size:12px;margin-top:2px}
input[type=text],textarea,select{width:100%;padding:10px 12px;border:1px solid var(--gris-claro);
  border-radius:8px;background:var(--papel);color:var(--tinta);font:inherit;font-size:14px}
input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible{
  outline:2px solid var(--acento);outline-offset:1px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.chip{font-size:12px;padding:6px 11px;border-radius:99px;border:1px solid var(--gris-claro);
  background:var(--papel);color:var(--tinta);cursor:pointer;font-family:var(--cuerpo)}
.chip[aria-pressed="true"]{background:var(--acento);border-color:var(--acento);color:#212322;
  font-family:var(--cuerpo-b)}
.chip.mas{border-style:dashed;color:var(--gris)}
.chip .n{color:var(--gris);font-size:10px;margin-left:4px}
.chip[aria-pressed="true"] .n{color:rgba(33,35,34,.62)}
.seg{display:flex;gap:6px;margin-top:8px}
.seg button{flex:1;padding:9px 4px;border:1px solid var(--gris-claro);background:var(--papel);
  border-radius:8px;font:inherit;font-size:12px;color:var(--tinta);cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--tinta);color:var(--papel);border-color:var(--tinta)}
.cta{width:100%;margin-top:24px;padding:14px;border:0;border-radius:10px;background:var(--tinta);
  color:var(--papel);font-family:var(--cuerpo-b);font-size:14px;cursor:pointer}
.cta.acento{background:var(--acento);color:#212322}
.cta:disabled{opacity:.4;cursor:not-allowed}
.linkbtn{background:none;border:0;color:var(--gris);font:inherit;font-size:12px;
  text-decoration:underline;cursor:pointer;padding:8px 0}
.paso{font-family:var(--etiq);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--acento)}

/* ---------- banner de operación ---------- */
.banner{border:1px solid var(--acento);background:linear-gradient(180deg,rgba(246,190,0,.13),rgba(246,190,0,.05));
  border-radius:12px;padding:14px 15px;margin-bottom:22px}
.banner .k{font-family:var(--etiq);font-size:9px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--alerta);display:flex;align-items:center;gap:6px}
.banner .k b{width:6px;height:6px;border-radius:50%;background:var(--acento);display:inline-block}
.banner h3{font-family:var(--display);font-weight:400;font-size:19px;margin:7px 0 4px;letter-spacing:-.01em}
.banner p{margin:0 0 12px;font-size:12.5px;color:var(--gris)}
.banner button{width:100%;padding:10px;border:0;border-radius:8px;background:var(--acento);
  color:#212322;font-family:var(--cuerpo-b);font-size:13px;cursor:pointer}

/* ---------- grillas de ideas ---------- */
.fila{display:flex;gap:11px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
.fila::-webkit-scrollbar{height:5px}
.fila::-webkit-scrollbar-thumb{background:var(--gris-claro);border-radius:9px}
.tarj{flex:0 0 auto;width:108px;scroll-snap-align:start;background:none;border:0;padding:0;
  cursor:pointer;text-align:left;font:inherit;color:inherit}
.tarj .mini{width:108px;height:192px;border-radius:9px;overflow:hidden;border:1px solid var(--gris-claro);
  background:#fff;position:relative}
.tarj.post .mini{height:135px}
.tarj:hover .mini,.tarj:focus-visible .mini{border-color:var(--acento)}
.tarj h4{font-size:11.5px;font-family:var(--cuerpo-b);margin:8px 0 2px;line-height:1.3}
.tarj .meta{font-size:10px;color:var(--gris);font-family:var(--etiq);letter-spacing:.04em}
.filaposts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.filaposts .tarj,.filaposts .mini{width:100%}
.filacarr .tarj{width:100%}
.filacarr .tarj.post .mini{width:100%;height:440px}
/* el lienzo SIEMPRE escala desde la esquina: con el origen por default (centro)
   la pieza se sale del área visible y el editor se ve vacío */
.lienzo{transform-origin:top left;position:absolute;top:0;left:0}

/* ---------- ritmo ---------- */
.ritmo{margin-top:26px;padding:14px 15px;border:1px solid var(--gris-claro);border-radius:12px;
  display:flex;align-items:center;justify-content:space-between;gap:10px}
.ritmo .txt{font-size:12px;color:var(--gris)}
.ritmo .txt b{color:var(--tinta);font-family:var(--cuerpo-b);font-size:13px;display:block}
.puntos{display:flex;gap:5px}
.puntos i{width:9px;height:9px;border-radius:50%;background:var(--gris-claro)}
.puntos i.on{background:var(--acento)}

/* ---------- editor ---------- */
.lienzowrap{position:relative;margin:0 auto 16px;border:1px solid var(--gris-claro);border-radius:10px;
  overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)}
.campo{margin-bottom:13px}
.campo .et{font-family:var(--etiq);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--gris);display:block;margin-bottom:4px}
.campo textarea{resize:vertical;min-height:38px;font-size:13px;line-height:1.4}
.aviso{background:var(--alerta-bg);color:var(--alerta);border-radius:8px;padding:9px 11px;
  font-size:11.5px;margin:6px 0 14px;line-height:1.45}
.aviso b{font-family:var(--cuerpo-b)}
.pill{display:inline-flex;align-items:center;gap:5px;font-family:var(--etiq);font-size:9.5px;
  letter-spacing:.09em;text-transform:uppercase;padding:4px 9px;border-radius:99px}
.pill.ok{background:var(--ok-bg);color:var(--ok)}
.pill.rev{background:var(--alerta-bg);color:var(--alerta)}
.mini .npag{position:absolute;right:6px;bottom:6px;z-index:6;background:rgba(33,35,34,.78);
  color:#fff;font-family:var(--etiq);font-size:9px;letter-spacing:.06em;padding:3px 6px;border-radius:3px}
.sindis{border:1px solid var(--gris-claro);border-left:3px solid var(--acento);
  padding:12px 14px;margin-bottom:10px}
.sindis .fmt{font-family:var(--etiq);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--gris)}
.sindis h4{font-family:var(--display);font-weight:400;font-size:17px;margin:5px 0 6px}
.sindis p{margin:0 0 8px;font-size:12.5px;line-height:1.5;color:var(--tinta)}
.sindis p.instr{font-family:var(--cuerpo-b)}
.sindis .copiar{background:var(--papel);border:1px solid var(--gris-claro);padding:10px 12px;margin:4px 0 8px}
.sindis .copiar .et{font-family:var(--etiq);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--gris)}
.sindis .copiar p{margin:5px 0 4px;font-size:13px}
.sindis .ops{margin:2px 0 8px;padding-left:16px}
.sindis .ops li{font-size:12.5px;line-height:1.5;margin-bottom:5px}
.sindis .tipx{font-size:11.5px;color:var(--gris);font-style:italic}
.sindis .pie2{display:flex;justify-content:space-between;gap:10px;margin-top:9px;
  font-size:10.5px;color:var(--gris)}
.sindis .pie2 span:first-child{font-family:var(--cuerpo-b);color:var(--tinta)}
.pager{display:flex;align-items:center;justify-content:center;gap:14px;margin:-6px 0 14px}
.pager button{width:34px;height:34px;border-radius:50%;border:1px solid var(--gris-claro);
  background:var(--papel);color:var(--tinta);font-size:15px;cursor:pointer;line-height:1}
.pager button:disabled{opacity:.32;cursor:not-allowed}
.pager span{font-family:var(--etiq);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--gris)}
.dedonde .lin{display:flex;justify-content:space-between;gap:10px;padding:6px 0;
  border-bottom:1px solid var(--gris-claro);font-size:11.5px}
.dedonde .lin:last-child{border-bottom:0}
/* min-width:0 + ellipsis: sin esto una URL larga no se puede encoger (los hijos de un flex
   tienen min-width:auto) y empuja la fila fuera de la pantalla del teléfono. */
.dedonde code{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--gris);
  min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dedonde span{font-family:var(--cuerpo-b);text-align:right;
  min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.capt{border:1px solid var(--gris-claro);border-radius:10px;padding:12px;margin-top:6px}
.capt .et{font-family:var(--etiq);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris)}
.capt p{margin:6px 0 0;font-size:13px;line-height:1.5}
/* Las stories no llevan caption: Instagram no lo muestra. Lo que sí suma es el sticker,
   que es lo que convierte la story en conversación. */
.stk{border:1px solid var(--gris-claro);border-radius:10px;padding:12px;margin-top:6px}
.stk>.et{font-family:var(--etiq);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris)}
.stk .uno{display:flex;gap:9px;align-items:flex-start;margin-top:10px}
.stk .uno+.uno{margin-top:12px;padding-top:12px;border-top:1px solid var(--gris-claro)}
.stk .ico{flex:0 0 26px;height:26px;border-radius:7px;background:var(--gris-claro);
  display:grid;place-items:center;font-size:13px;line-height:1}
.stk .cuerpo{flex:1 1 auto;min-width:0}
.stk .tipo{font-family:var(--etiq);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris)}
.stk .txt{margin:3px 0 0;font-size:13px;line-height:1.45}
.stk .ops{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.stk .op{font-size:11.5px;padding:4px 9px;border-radius:99px;background:var(--gris-claro);color:var(--tinta)}
.stk .cp{margin-top:6px;font-family:var(--etiq);font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--gris);background:none;border:0;padding:0;cursor:pointer}
.menuprop{display:flex;flex-direction:column;border:1px solid var(--gris-claro);
  border-radius:10px;overflow:hidden;margin-top:8px}
.filaprop{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 13px;background:none;border:0;border-bottom:1px solid var(--gris-claro);
  text-align:left;cursor:pointer;color:var(--tinta);width:100%}
.filaprop:last-child{border-bottom:0}
.filaprop:disabled{cursor:default;opacity:.45}
.filaprop .txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.filaprop .txt b{font-family:var(--cuerpo-b);font-size:13.5px}
.filaprop .txt i{font-style:normal;font-size:11.5px;color:var(--gris);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filaprop .fl{color:var(--acento);font-size:15px;flex:0 0 auto}
.selform{margin:2px 0 12px}
.selform .et{font-family:var(--etiq);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris)}
.selform .seg{margin-top:6px}
.selform .seg button i{display:block;font-style:normal;font-size:9.5px;opacity:.6;margin-top:1px}
.selfoto{margin:2px 0 14px}
.selfoto .et{font-family:var(--etiq);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--gris)}
.selfoto .tiras{display:flex;gap:7px;overflow-x:auto;margin-top:7px;padding-bottom:3px}
.selfoto .tira{flex:0 0 64px;height:64px;padding:0;border:2px solid transparent;border-radius:6px;
  overflow:hidden;background:var(--gris-claro);cursor:pointer}
.selfoto .tira[aria-pressed="true"]{border-color:var(--acento)}
.selfoto .tira img{width:100%;height:100%;object-fit:cover;display:block}
.dosbtn{display:flex;gap:9px;margin-top:16px}
.dosbtn button{flex:1;padding:12px;border-radius:10px;font-family:var(--cuerpo-b);font-size:13px;cursor:pointer}
.dosbtn .prim{border:0;background:var(--acento);color:#212322}
.dosbtn .sec{border:1px solid var(--gris-claro);background:none;color:var(--tinta)}

/* ---------- mis piezas ---------- */
.pieza{display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--gris-claro)}
.pieza .mini{flex:0 0 46px;height:58px;border-radius:6px;overflow:hidden;border:1px solid var(--gris-claro);
  position:relative;background:#fff}
.pieza .info{flex:1;min-width:0}
.pieza h4{margin:0 0 3px;font-size:12.5px;font-family:var(--cuerpo-b);line-height:1.3}
.pieza .meta{font-size:10.5px;color:var(--gris)}
.vacio{color:var(--gris);font-size:13px;text-align:center;padding:36px 12px;line-height:1.6}

/* ---------- riel ---------- */
.riel{flex:1;min-width:300px}
.riel h3{font-family:var(--display);font-weight:400;font-size:21px;margin:0 0 4px;letter-spacing:-.01em}
.riel .peq{color:var(--gris);font-size:13px;margin:0 0 20px}
.nota{border-left:2px solid var(--gris-claro);padding:0 0 0 15px;margin-bottom:22px}
.nota.viva{border-left-color:var(--acento)}
.nota h4{font-family:var(--etiq);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  margin:0 0 6px;color:var(--gris)}
.nota p{margin:0 0 8px;font-size:13.5px;line-height:1.6;max-width:62ch}
.nota p:last-child{margin-bottom:0}
.nota code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--gris-claro);
  padding:1px 5px;border-radius:4px}
.nota b{font-family:var(--cuerpo-b)}
table.datos{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0 0}
table.datos td{padding:5px 0;border-bottom:1px solid var(--gris-claro);vertical-align:top}
table.datos td:first-child{color:var(--gris);padding-right:14px;white-space:nowrap}
table.datos td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--cuerpo-b)}
.pie{max-width:1180px;margin:0 auto;padding:0 28px 60px;color:var(--gris);font-size:12.5px;line-height:1.6}
.pie b{color:var(--tinta)}
@media (max-width:900px){
  .tel{position:static;height:auto;min-height:640px;flex:1 1 340px}
  .escena{gap:28px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* ---------- estados del perfil en vivo ----------
   Con el perfil pedido al servidor aparece una espera que el archivo estático no tenía: los
   datos venían dentro. Se resuelve con el esqueleto de la pantalla que va a llegar y no con
   un spinner, para que el contenido no salte cuando entra. Todo con los tokens de marca
   (--tinta, --papel, --acento, --display, --cuerpo), así hereda el modo oscuro solo. */
.cargando{padding:24px 20px}
.cargando .marca{display:flex;align-items:center;gap:10px;margin-bottom:28px}
.cargando .punto{width:9px;height:9px;border-radius:50%;background:var(--acento);
  animation:pulso 1.1s ease-in-out infinite}
.cargando .punto:nth-child(2){animation-delay:.15s}
.cargando .punto:nth-child(3){animation-delay:.3s}
.cargando .et{font-family:var(--etiq);font-size:12px;letter-spacing:.09em;
  text-transform:uppercase;color:var(--gris)}
@keyframes pulso{0%,100%{opacity:.25;transform:scale(.82)}50%{opacity:1;transform:scale(1)}}
.hueso{background:var(--gris-claro);border-radius:8px;position:relative;overflow:hidden}
.hueso::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);
  animation:barrido 1.5s infinite}
@keyframes barrido{100%{transform:translateX(100%)}}
.hueso.t{height:34px;width:62%;margin-bottom:12px}
.hueso.s{height:16px;width:84%;margin-bottom:26px}
.hueso.card{height:188px;margin-bottom:14px}
.hueso.fila{height:56px;margin-bottom:10px}
/* Quien no quiere movimiento no lo tiene: queda el bloque gris, que ya comunica la espera */
@media (prefers-reduced-motion:reduce){
  .cargando .punto{animation:none;opacity:.7}
  .hueso::after{animation:none;display:none}
}
/* el tropiezo: título en display, explicación en cuerpo, y una salida clara */
.tropiezo{padding:56px 24px;max-width:34rem;margin:0 auto;text-align:left}
.tropiezo h1{font-family:var(--display);font-size:30px;line-height:1.18;margin:0 0 10px;
  color:var(--tinta)}
.tropiezo p{font-family:var(--cuerpo);font-size:15px;line-height:1.55;color:var(--gris);
  margin:0 0 22px}
.tropiezo .filete{width:120px;height:3px;background:var(--acento);margin:0 0 22px}
.tropiezo button{font-family:var(--cuerpo-b);font-size:15px;background:var(--tinta);
  color:var(--papel);border:0;border-radius:10px;padding:13px 22px;min-height:44px;
  cursor:pointer}

</style>

<div class="tope">
  <h1>Cómo va a funcionar <em>Pulppo Studio</em></h1>
  <p>Prototipo clickeable del flujo completo. Recórrelo como si fueras el asesor: confirma el alta,
     mira lo que te propone y abre una pieza. Los templates, las fuentes, el perfil, las zonas, las
     fotos y el evento de operación son reales — salen de Mongo y de los JSON de Polotno, no son
     un mockup dibujado.</p>
</div>

<div class="escena">
  <div class="tel">
    <div class="barra"><span class="marca"></span><span id="barra-tit">Pulppo Studio</span></div>
    <div class="vista" id="vista"></div>
    <div class="tabs" id="tabs" hidden>
      <button data-ir="hoy">Hoy</button>
      <button data-ir="piezas">Mis piezas</button>
      <button data-ir="perfil">Perfil</button>
    </div>
  </div>
  <div class="riel" id="riel"></div>
</div>

<div class="pie" id="pie"></div>

<script>
/* Una pantalla en blanco no dice nada. Si algo revienta, que se vea. */
function mostrarFalla(msg){
  const v = document.getElementById("vista");
  if(!v) return;
  const d = document.createElement("div");
  d.className = "pad";
  d.innerHTML = '<h2 class="pant">Algo falló</h2>'
    + '<p class="sub">Avísanos y lo arreglamos. Detalle técnico abajo.</p>';
  const pre = document.createElement("p");
  pre.style.cssText = "font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--alerta)";
  pre.textContent = String(msg);
  d.appendChild(pre);
  v.innerHTML = ""; v.appendChild(d);
}
window.addEventListener("error", e => mostrarFalla(e.message + " · " + (e.filename||"") + ":" + (e.lineno||"")));
window.addEventListener("unhandledrejection", e => mostrarFalla("promesa: " + (e.reason && e.reason.message || e.reason)));

const D = /*__DATOS__*/;
const TPL = D.templates, IDEAS = D.ideas, SIN_DIS = D.sin_diseno || [], SEMANA = D.semana || [];
/* El selector de "¿Quién eres?" es SÓLO para el interno que revisa. En modo en vivo el
   bundle no trae a nadie, así que la lista se pide aparte y llega con nombre y correo y
   nada más: ni celular ni operaciones. */
let EQUIPO = D.brokers || [];
// B (el perfil del asesor) llega inline en la versión local, o por fetch con ?b=<token>
// en la versión de equipo. Así el bundle pesado —fuentes y templates— se cachea una sola
// vez y cada asesor solo baja ~20 KB con lo suyo.
let B = D.broker;

/* ---------- estado ---------- */
const S = {
  pantalla: "alta1",
  alta: {zonas: [], opera:"ambas", tono:"cercano",
         emojis:"no", handle:"", cta:"Escríbeme por DM", celular:"si"},
  ideaAbierta: null, valores: {}, piezas: [], rotacion: 0, rotIdea: 0, rotZona: 0, altaLista: false, pagina: 0,
  // el inventario de la inmobiliaria trae 111 colonias en Diamond House: se muestran 15 y el
  // resto queda detrás de "ver más"
  zonasTodas: false,
  archivosListos: null,  // PNG ya pintados, si iOS pidió un segundo toque para compartir
  fotoSel: {},           // {idea: url} — la foto que eligió el asesor para esa pieza
  formatoSel: {}         // {idea: "post"|"story"} — el mismo contenido cambia de lienzo
};
const ZONAS_VISIBLES = 15;

/* Las suyas primero —ya vienen marcadas— y después las de la inmobiliaria donde todavía no
   tiene aviso propio. Se marca de dónde viene cada una para poder decirlo en la UI. */
function zonasOfrecidas(){
  const mias = (B.zonas || []).map(z => ({...z, mia: true}));
  const otras = (B.zonas_inmobiliaria || []).map(z => ({...z, mia: false}));
  return mias.concat(otras);
}

/* ---------- render de un template de Polotno (mismo criterio que preview.py) ---------- */
function tokensMapa(vals){
  const lg = B.logos || {};
  return {
    "broker.name": B.nombre,
    // si dijo que no, el celular no se imprime en ninguna pieza
    "broker.phone": S.alta.celular === "no" ? "" : B.telefono,
    "company.name": B.inmobiliaria, "broker.handle": S.alta.handle ? "@"+S.alta.handle.replace(/^@/,"") : "",
    // el co-brand tiene que resolver en las dos familias de templates
    "company.logo.default": lg.default || "",
    "company.logo.pulppo": lg.pulppo || "",
    "company.logo.pulppoInverted": lg.pulppoInverted || "",
    // las miniaturas de Hoy se pintan con los valores de SU idea; el editor usa el estado
    ...(vals || S.valores)
  };
}
// Las ideas se escriben con {zona}, {ciudad} y {cta} para servir a cualquier asesor.
// Se resuelven aquí, contra SU perfil — sin esto todos verían la zona de la demo.
/* "tu zona" y "tu ciudad" NO pueden salir impresos en una pieza: son un placeholder de
   plantilla, no algo que alguien publique. Le pasa a quien no tiene inventario propio (las
   cuentas operativas de la oficina). Se cae en cascada a las zonas de SU inmobiliaria, que
   ya vienen en el perfil, y el valor llega al campo pre-llenado y editable: si no es la que
   trabaja, la cambia. El placeholder queda sólo como último recurso imposible. */
function zonaPorDefecto(){
  const propias = B.zonas || [];
  if(propias.length) return propias[S.rotZona % propias.length];
  const dela = B.zonas_inmobiliaria || [];
  if(dela.length) return dela[S.rotZona % dela.length];
  return {};
}
/* Un token vacío deja el separador que lo acompañaba: "{{type}} · {{specs}}" sin specs
   imprime "Terreno residencial · ". Se limpian los separadores que quedaron sin nada a un
   lado, así una plantilla puede encadenar campos opcionales sin que se le vea la costura. */
function sinSeparadoresHuerfanos(t){
  return String(t)
    .replace(/\s*[·|]\s*(?=\s*[·|]|$)/g, "")   // separador seguido de otro, o al final
    .replace(/^\s*[·|]\s*/, "")                 // separador al inicio
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Hechos verificables de la colonia (propertypois): {colegio}, {parque}, {tienda},
   {hospital}, {comer_1}…{comer_5}. Reemplazan las afirmaciones inventadas que se imprimían
   idénticas para toda colonia —"Todo a pie y con la ciudad a diez minutos" salía hasta en
   Jesús del Monte, que es un suburbio de coche sin metro—.
   Si la colonia no tiene el hecho, el token queda VACÍO a propósito: el editor lo reporta
   como campo faltante, que es mejor que rellenarlo con algo que no se puede sostener. */
function hechosDe(zona){
  return (D.hechos_zona || {})[zona] || null;
}

function tokensDeZona(zona){
  const h = hechosDe(zona), t = {};
  if(!h) return t;
  for(const clave of ["colegio", "parque", "tienda", "hospital", "comer", "desayuno"]){
    const v = h[clave] || [];
    if(v.length){
      t[clave] = v[0].nombre + " a " + v[0].dist;
      t[clave + "_nombre"] = v[0].nombre;
      t[clave + "_dist"] = v[0].dist;
    }
    v.slice(0, 5).forEach((x, i) => { t[clave + "_" + (i+1)] = x.nombre + " · " + x.dist; });
  }
  return t;
}

function rellenar(t){
  if(typeof t !== "string" || t.indexOf("{") < 0) return t;
  const z = zonaPorDefecto();
  let out = t.replace(/\{zona\}/g, z.zona || "tu zona")
             .replace(/\{ciudad\}/g, z.ciudad || "tu ciudad")
             .replace(/\{cta\}/g, S.alta.cta || "");
  if(out.indexOf("{") < 0) return out;
  const h = tokensDeZona(z.zona);
  // Se sustituye TODO token de hecho, incluso el que la colonia no tiene: dejarlo con las
  // llaves puestas imprimiría "{colegio}" en la pieza.
  return out.replace(/\{(colegio|parque|tienda|hospital|comer|desayuno)(_(?:nombre|dist|[1-5]))?\}/g,
                     (m, base, suf) => h[base + (suf || "")] || "");
}
/* Los valores del aviso son de CADA asesora: en el archivo del equipo viven en su perfil
   (B.valores[idea]); en el de una sola asesora vienen en la idea. Se prueban los dos. */
function datosDe(idea){
  return (B.valores || {})[idea.id] || idea.valores_sugeridos || null;
}
/* Sólo la familia propiedad/operación se llena del aviso. NO se puede deducir de que la idea
   traiga valores: las 31 ideas traen `valores_sugeridos` porque ahí vive el copy pre-escrito,
   así que preguntar por los valores marcaba TODAS como "de datos" y dejaba el editor sin un
   solo campo editable —hasta en una story de frase—. Se decide por sección. */
function esDeDatos(idea){ return idea.seccion === "operacion" || !!idea.desde_datos; }

/* La misma pieza vive en dos lienzos: historia 9:16 y post. No son la misma imagen recortada
   —el acomodo cambia— así que son dos templates y acá se elige cuál. Si la idea no declara
   variantes, se queda con el suyo de siempre. */
function formatosDe(idea){ return idea.formatos || null; }
function formatoActual(idea){
  const f = formatosDe(idea);
  if(!f) return idea.formato;
  return S.formatoSel[idea.id] || (f[idea.formato] ? idea.formato : Object.keys(f)[0]);
}
function refDe(idea){
  const f = formatosDe(idea);
  return (f && f[formatoActual(idea)]) || idea.template_ref;
}

/* En las piezas de propiedad NO todo es editable, y la línea la puso Ale: título, colonia y
   textos genéricos sí; precio, m², recámaras y operación no. La razón no es técnica — si el
   asesor cambia el precio, la pieza dice algo que contradice el aviso publicado, y en una de
   "baja de precio" eso es delicado. Los datos duros se corrigen en la propiedad, donde
   corresponde. */
const EDITABLE_EN_DATOS = /^(ubicacion|titulo\.|etiqueta\.|address\.street)/;
const DATO_DURO = /precio|price|attributes\.|listing\.operation|^type$|pictures\./;

function camposEditables(idea){
  if(!esDeDatos(idea)) return idea.tokens.filter(t => !t.includes("."));
  return idea.tokens.filter(t => EDITABLE_EN_DATOS.test(t) && !DATO_DURO.test(t));
}
function fotosDe(idea){ return (B.fotos_aviso || {})[idea.id] || idea.fotos_disponibles || 0; }
function valoresDe(idea){
  const v = {};
  for(const [k, val] of Object.entries(datosDe(idea) || {})) v[k] = rellenar(val);
  return v;
}
/* Las candidatas de una pieza. En las de propiedad son las del aviso del evento, con las del
   desarrollo al frente; en las de contenido, las del inventario de esa colonia. Antes se tomaba
   siempre la primera y por eso una colonia salía ilustrada con el interior de una casa. */
function fotosCandidatas(idea){
  const delAviso = (B.fotos_urls || {})[idea.id] || idea.fotos_urls;
  if(delAviso && delAviso.length) return delAviso.slice(0, 6);
  const z = S.valores.zona || (zonaPorDefecto().zona || "");
  const f = B.fotos_por_zona || {};
  const dela = f[z] || [];
  return (dela.length ? dela : Object.values(f).flat()).slice(0, 6);
}

function fotoElegida(idea){
  return S.fotoSel[idea.id] || (fotosCandidatas(idea)[0] || "");
}

/* ¿esta pieza tiene hueco de foto? sólo entonces se muestra el selector */
function usaFoto(idea){
  const t = TPL[idea.template_ref];
  if(!t) return false;
  return (t.pages || []).some(pg => (pg.children || []).some(c =>
    (c.type === "image" || c.type === "figure")
    && /^foto\.|pictures\.\d+\.url/.test((c.name || "").replace(/[{}]/g, ""))));
}

/* Recibe el id porque las miniaturas del feed pintan VARIAS ideas seguidas y ninguna está
   "abierta": si se leyera S.ideaAbierta, todas saldrían con la foto de la última que se abrió. */
/* Una idea puede exigir un hecho que no toda colonia tiene: "los 5 mejores lugares para
   desayunar" sólo se sostiene donde hay cinco cafés nombrables, y medido son 3 colonias de
   107. Sin esta compuerta la pieza saldría con dos renglones vacíos. */
function disponible(idea){
  if(!idea || !idea.requiere) return true;
  return !!tokensDeZona(zonaPorDefecto().zona)[idea.requiere];
}

function fotoDeLaPieza(idIdea){
  const i = IDEAS.find(x => x.id === (idIdea || S.ideaAbierta));
  return i ? fotoElegida(i) : "";
}

function fotoPara(zona){
  const f = B.fotos_por_zona || {};
  return (f[zona] && f[zona][0]) || Object.values(f).flat()[0] || "";
}
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* ---------- auto-ajuste de títulos ----------
   El div de texto va con `height:auto`, así que la altura del JSON no limita nada: un título
   de dos líneas se come lo que tiene debajo. Medido con #empalmes, eso hacía chocar el título
   de zonas_top5 con su lista y "Cierre Exitoso." con el "¡GRACIAS!".

   Sólo actúa donde el template lo pide (`autofit:true`) y nunca baja de `minFontSize`: hay
   cajas —la frase de frase_quote— que se desbordan A PROPÓSITO y encogerlas las volvería
   ilegibles. Mecanismo general, activación deliberada.

   Vive acá porque lo necesitan los DOS renderizadores (el HTML de la vista previa y el canvas
   de la descarga) y tienen que coincidir, o la pieza se vería distinta de como se baja. */
const _medidor = document.createElement("canvas").getContext("2d");

/* ---------- activar las fuentes antes de medir o pintar ----------
   `@font-face` sólo declara; el navegador descarga la fuente cuando algún nodo del DOM la
   usa. Al pintar en canvas no hay nodo, así que si la familia no se activó antes, el canvas
   cae **en silencio** a la serif por defecto: la vista previa salía bien y el PNG que baja el
   asesor salía con otra tipografía. Le pasaba a NunitoSans_10pt-Regular, que es el cuerpo de
   casi todas las piezas. `document.fonts.load` la activa de verdad y devuelve promesa. */
let _fuentesListas = null;
function fuentesListas(){
  if(_fuentesListas) return _fuentesListas;
  const familias = new Set();
  for(const ref in TPL)
    for(const pg of (TPL[ref].pages || []))
      for(const c of (pg.children || []))
        if(c.type === "text" && c.fontFamily) familias.add(c.fontFamily);
  _fuentesListas = Promise.all(
    [...familias].map(f => document.fonts.load(`16px "${f}"`).catch(() => null))
  ).then(() => document.fonts.ready);
  return _fuentesListas;
}

function altoDeTexto(txt, c, tam){
  _medidor.font = `${c.fontWeight && c.fontWeight !== "normal" ? c.fontWeight + " " : ""}`
                + `${tam}px "${c.fontFamily || "sans-serif"}"`;
  if("letterSpacing" in _medidor) _medidor.letterSpacing = (c.letterSpacing || 0) + "px";
  const n = envolver(_medidor, txt, c.width || 0).length;
  if("letterSpacing" in _medidor) _medidor.letterSpacing = "0px";
  return n * tam * (c.lineHeight || 1.2);
}

function tamanoAjustado(c, txt){
  const tam = c.fontSize || 16;
  if(!c.autofit || !c.height || !c.width || !txt.trim()) return tam;
  const piso = c.minFontSize || Math.round(tam * 0.75);
  let t = tam;
  while(t > piso && altoDeTexto(txt, c, t) > c.height) t -= 1;
  return t;
}

/* Un numeral sin su renglón no se dibuja.

   Las listas numeradas traen los "01".."05" como texto FIJO de la plantilla, no como tokens:
   cuando la colonia no da los cinco lugares, el número quedaba puesto con la línea en blanco
   al lado. Se emparejan por `y` —el numeral y su texto comparten renglón— y si el renglón
   resolvió vacío, el numeral se va con él. Es más seguro que confiar en el filtro de la
   lista: la ruta #png/<idea> pinta cualquier pieza por id y se salta ese filtro. */
function resuelto(c, mapa){
  const nom = c.name || "", expr = nom.includes("{{") ? nom : null;
  return (expr || c.text || "").replace(/\{\{([^}]+)\}\}/g, (m, tk) => mapa[tk.trim()] || "");
}

function renglonesVacios(children, mapa){
  const vacios = new Set();
  for(const c of children){
    if(c.type !== "text") continue;
    const nom = c.name || "";
    const tieneToken = nom.includes("{{") || String(c.text || "").includes("{{");
    if(tieneToken && !resuelto(c, mapa).trim()) vacios.add(Math.round(c.y || 0));
  }
  return vacios;
}

function esNumeral(c){
  return c.type === "text" && !String(c.name || "").includes("{{")
      && /^\s*\d{1,2}\s*$/.test(String(c.text || ""));
}

function renderTemplate(ref, escala, marcarTokens, iPag, vals, idIdea){
  const t = TPL[ref]; if(!t) return {html:"", w:1080, h:1350};
  const pg = t.pages[Math.min(iPag||0, t.pages.length-1)] || {children:[]};
  const W = typeof pg.width === "number" ? pg.width : (t.width || 1080);
  const H = typeof pg.height === "number" ? pg.height : (t.height || 1350);
  const mapa = tokensMapa(vals);
  const _vacios = renglonesVacios(pg.children, mapa);
  let out = `<div class="lienzo" style="width:${W}px;height:${H}px;background:${pg.background||"white"};transform:scale(${escala})">`;

  for(const c of pg.children){
    if(esNumeral(c) && _vacios.has(Math.round(c.y || 0))) continue;
    const x=c.x||0, y=c.y||0, w=c.width||0, h=c.height||0, rot=c.rotation||0, op=(c.opacity==null?1:c.opacity);
    const pos = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:${op};transform:rotate(${rot}deg);`;
    const nom = c.name || "";
    // Los templates de propiedad guardan el token en `name` y dejan en `text` un valor de
    // ejemplo ("5 habitaciones"). Los de contenido de valor traen el token en `text`.
    const expr = nom.includes("{{") ? nom : null;

    if(c.type === "text"){
      let txt = esc(expr || c.text || "").replace(/\{\{([^}]+)\}\}/g, (m, tk) => {
        const v = mapa[tk.trim()];
        if(v) return esc(v);
        return marcarTokens ? `<span style="background:#F6BE00;color:#212322;border-radius:3px;padding:0 3px">${esc(m)}</span>` : "";
      });
      if(!marcarTokens) txt = sinSeparadoresHuerfanos(txt);
      // el mismo texto sin marcas ni escapes, que es lo que hay que medir para el auto-ajuste
      const plano = sinSeparadoresHuerfanos((expr || c.text || "").replace(/\{\{([^}]+)\}\}/g,
        (m, tk) => mapa[tk.trim()] || ""));
      const tamHtml = tamanoAjustado(c, c.textTransform === "uppercase" ? plano.toUpperCase() : plano);
      out += `<div style="${pos}height:auto;font-family:'${c.fontFamily||"sans-serif"}',sans-serif;`
           + `font-size:${tamHtml}px;line-height:${c.lineHeight||1.2};color:${c.fill||"#000"};`
           + `text-align:${c.align||"left"};font-weight:${c.fontWeight||"normal"};`
           + `text-transform:${c.textTransform||"none"};`
           + `text-decoration:${c.textDecoration||"none"};`
           + `letter-spacing:${c.letterSpacing||0}px;white-space:pre-wrap;word-break:break-word">${txt}</div>`;
    }
    else if(c.type === "svg"){
      // separadores y viñetas: vienen como data URI, se pintan tal cual
      out += c.src
        ? `<div style="${pos}"><img src="${esc(c.src)}" alt="" style="width:100%;height:100%;object-fit:contain"></div>`
        : "";
    }
    else if(c.type === "image" || (c.type === "figure" && nom === "broker.photo")){
      let src = c.src || "";
      if(expr){
        // token en el name: {{pictures.0.url}}, {{company.logo.pulppoInverted}}…
        const v = mapa[expr.replace(/[{}]/g, "").trim()];
        src = v || "";
      }
      else if(nom === "broker.photo") src = B.foto;
      else if(nom === "pulppo.logo") src = c.src || "";
      else if(nom.startsWith("foto.")) src = fotoDeLaPieza() || src;
      // La foto principal sale de la pieza, no del token: respeta lo que eligió el asesor y,
      // cuando la pieza no tiene evento fresco —un asesor sin contrato del mes—, cae en las
      // candidatas de su inventario. Antes se quedaba en el token vacío y "Nuevo contrato"
      // salía con el rectángulo gris de fondo hasta que alguien tocaba una miniatura.
      if(expr && /^pictures\.0\.url$/.test(expr.replace(/[{}]/g, "").trim())){
        src = fotoDeLaPieza(idIdea) || src;
      }
      const r = c.cornerRadius || 0;
      // Un logo NUNCA se recorta: `cover` le comía el isotipo por arriba.
      const esLogo = /logo/i.test(nom);
      const fit = esLogo ? "contain" : "cover";
      out += src
        ? `<div style="${pos}overflow:hidden"><img src="${esc(src)}" alt="" style="width:100%;height:100%;object-fit:${fit};border-radius:${r}px"></div>`
        : `<div style="${pos}background:#E4E2DA;border-radius:${r}px"></div>`;
    }
    else if(c.type === "figure"){
      out += `<div style="${pos}background:${c.fill||"#ccc"};border-radius:${c.cornerRadius||0}px"></div>`;
    }
    else if(c.type === "line"){
      out += `<div style="${pos}background:#212322;height:1px"></div>`;
    }
  }
  return {html: out + "</div>", w: W, h: H};
}

function miniatura(ref, anchoCaja, vals, idIdea){
  const t = TPL[ref], pg = (t && t.pages[0]) || {};
  const W = typeof pg.width === "number" ? pg.width : (t.width || 1080);
  const e = anchoCaja / W;
  return renderTemplate(ref, e, false, 0, vals, idIdea).html;
}

/* ================= EXPORTAR A PNG =================
   La pieza se pinta en un <canvas> y se baja. Todo en el navegador: sin servidor,
   sin Playwright, sin costo. Funciona porque images.pulppo.com responde
   `access-control-allow-origin: *` — si no, el canvas quedaría "tainted" y
   toBlob() fallaría. Las fuentes ya vienen embebidas en el HTML. */

function cargarImagen(src){
  return new Promise(res => {
    if(!src) return res(null);
    const im = new Image();
    im.crossOrigin = "anonymous";          // sin esto el canvas se contamina y no exporta
    im.onload = () => res(im);
    im.onerror = () => res(null);          // una foto que falla no debe tumbar la pieza
    im.src = src;
  });
}

function rectRedondo(ctx, x, y, w, h, r){
  r = Math.min(r || 0, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

/* Reparte el texto en líneas respetando el ancho del elemento, igual que Polotno.
   Respeta los saltos de línea explícitos y no parte palabras. */
function envolver(ctx, texto, ancho){
  const lineas = [];
  for(const parrafo of String(texto).split("\n")){
    const palabras = parrafo.split(/\s+/).filter(Boolean);
    if(!palabras.length){ lineas.push(""); continue; }
    let linea = palabras[0];
    for(let i = 1; i < palabras.length; i++){
      const prueba = linea + " " + palabras[i];
      if(ctx.measureText(prueba).width <= ancho) linea = prueba;
      else { lineas.push(linea); linea = palabras[i]; }
    }
    lineas.push(linea);
  }
  return lineas;
}

function dibujarImagen(ctx, im, x, y, w, h, r, modo){
  const escala = modo === "contain"
    ? Math.min(w / im.width, h / im.height)     // logos: completos, nunca recortados
    : Math.max(w / im.width, h / im.height);    // fotos: llenan la caja
  const dw = im.width * escala, dh = im.height * escala;
  ctx.save();
  rectRedondo(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(im, x + (w - dw)/2, y + (h - dh)/2, dw, dh);
  ctx.restore();
}

async function pintarPagina(ref, iPag, vals, idIdea){
  await fuentesListas();   // sin esto el canvas cae a la serif por defecto
  const t = TPL[ref];
  const pg = t.pages[Math.min(iPag || 0, t.pages.length - 1)] || {children:[]};
  const W = typeof pg.width === "number" ? pg.width : (t.width || 1080);
  const H = typeof pg.height === "number" ? pg.height : (t.height || 1350);
  const mapa = tokensMapa(vals);
  const _vacios = renglonesVacios(pg.children, mapa);

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = pg.background || "white";
  ctx.fillRect(0, 0, W, H);

  for(const c of pg.children){
    if(esNumeral(c) && _vacios.has(Math.round(c.y || 0))) continue;
    const x = c.x||0, y = c.y||0, w = c.width||0, h = c.height||0;
    const nom = c.name || "";
    const expr = nom.includes("{{") ? nom : null;
    ctx.save();
    ctx.globalAlpha = (c.opacity == null ? 1 : c.opacity);
    if(c.rotation){                                   // rotar sobre el centro, como Polotno
      ctx.translate(x + w/2, y + h/2);
      ctx.rotate(c.rotation * Math.PI / 180);
      ctx.translate(-(x + w/2), -(y + h/2));
    }

    if(c.type === "text"){
      let txt = sinSeparadoresHuerfanos((expr || c.text || "").replace(/\{\{([^}]+)\}\}/g,
        (m, tk) => mapa[tk.trim()] || ""));
      // las etiquetas van en mayúsculas aunque el token traiga el nombre en capitalizado
      // ("Polanco" → "POLANCO"); el canvas no tiene text-transform, hay que hacerlo a mano
      if(c.textTransform === "uppercase") txt = txt.toUpperCase();
      if(txt.trim()){
        const tam = tamanoAjustado(c, txt);   // mismo criterio que la vista previa
        ctx.font = `${c.fontWeight && c.fontWeight !== "normal" ? c.fontWeight + " " : ""}${tam}px "${c.fontFamily||"sans-serif"}"`;
        ctx.fillStyle = c.fill || "#000";
        ctx.textBaseline = "top";
        if("letterSpacing" in ctx) ctx.letterSpacing = (c.letterSpacing||0) + "px";
        const alto = tam * (c.lineHeight || 1.2);
        const align = c.align || "left";
        ctx.textAlign = align === "center" ? "center" : (align === "right" ? "right" : "left");
        const px = align === "center" ? x + w/2 : (align === "right" ? x + w : x);
        envolver(ctx, txt, w).forEach((linea, i) => {
          // el offset centra la caja de texto sobre la línea base, como el render del DOM
          const yl = y + i * alto + (alto - tam) * 0.32;
          ctx.fillText(linea, px, yl);
          // el precio anterior va tachado y el canvas no tiene text-decoration: se dibuja.
          // Se mide el texto para que la línea cubra las cifras y no la caja entera.
          if(c.textDecoration === "line-through"){
            const anchoReal = ctx.measureText(linea).width;
            const x0 = align === "center" ? px - anchoReal/2
                     : (align === "right" ? px - anchoReal : px);
            ctx.save();
            ctx.strokeStyle = c.fill || "#000";
            ctx.lineWidth = Math.max(2, Math.round(tam * 0.055));
            ctx.beginPath();
            ctx.moveTo(x0, yl + tam * 0.55);
            ctx.lineTo(x0 + anchoReal, yl + tam * 0.55);
            ctx.stroke();
            ctx.restore();
          }
        });
        if("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
    }
    else if(c.type === "svg"){
      const im = await cargarImagen(c.src);
      if(im) dibujarImagen(ctx, im, x, y, w, h, 0, "contain");
    }
    else if(c.type === "image" || (c.type === "figure" && nom === "broker.photo")){
      let src = c.src || "";
      if(expr){
        src = mapa[expr.replace(/[{}]/g, "").trim()] || "";
        // mismo criterio que en el DOM: si divergen, la vista previa y el PNG no coinciden
        if(/^pictures\.0\.url$/.test(expr.replace(/[{}]/g, "").trim())) src = fotoDeLaPieza(idIdea) || src;
      }
      else if(nom === "broker.photo") src = B.foto;
      else if(nom.startsWith("foto.")) src = fotoPara(S.valores.zona || (B.zonas[0]||{}).zona) || src;
      const im = await cargarImagen(src);
      if(im) dibujarImagen(ctx, im, x, y, w, h, c.cornerRadius || 0,
                           /logo/i.test(nom) ? "contain" : "cover");
      else { ctx.fillStyle = "#E4E2DA"; rectRedondo(ctx, x, y, w, h, c.cornerRadius||0); ctx.fill(); }
    }
    else if(c.type === "figure"){
      ctx.fillStyle = c.fill || "#ccc";
      rectRedondo(ctx, x, y, w, h, c.cornerRadius || 0);
      ctx.fill();
    }
    else if(c.type === "line"){
      ctx.fillStyle = "#212322";
      ctx.fillRect(x, y, w, Math.max(h, 1));
    }
    ctx.restore();
  }
  return cv;
}

/* Pinta todas las páginas y las devuelve como File, listas para compartir o bajar. */
async function archivosDePieza(idea){
  await fuentesListas();          // activa TODAS las familias de los templates, no sólo las que el DOM ya pidió
  const ref = refDe(idea);
  const nPag = (TPL[ref].pages || []).length;
  const base = slug(idea.titulo_idea || idea.id);
  const out = [];
  for(let p = 0; p < nPag; p++){
    const cv = await pintarPagina(ref, p, S.valores, S.ideaAbierta);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const nombre = nPag > 1 ? `${base}-${p+1}.png` : `${base}.png`;
    out.push(new File([blob], nombre, {type: "image/png"}));
  }
  return out;
}

function puedeCompartir(files){
  try { return !!(navigator.canShare && navigator.canShare({files})); } catch(e){ return false; }
}
/* Se prueba una vez con un archivo de mentira para saber qué decir en el botón: en el
   teléfono va a decir "Compartir" y en la compu "Descargar", que es lo que de verdad hace. */
const SOPORTA_COMPARTIR = puedeCompartir(
  [new File([new Uint8Array([137,80,78,71])], "x.png", {type: "image/png"})]);

/* En el teléfono, "descargar" mandaba el PNG a la carpeta de descargas de Safari y desde ahí
   había que buscarlo para subirlo. Con la hoja nativa de compartir el asesor tiene "Guardar
   en Fotos" e Instagram en el mismo lugar. Ojo: NO existe forma en web de abrir Instagram
   Stories con la pieza ya puesta —eso necesita app nativa—; el techo real es esta hoja. */
async function compartirPieza(idea, files){
  const fs = files || await archivosDePieza(idea);
  if(!puedeCompartir(fs)) { bajarArchivos(fs); return {modo: "descarga", n: fs.length}; }
  try {
    await navigator.share({files: fs, title: idea.titulo_idea || "Pieza de Pulppo Studio"});
    return {modo: "compartido", n: fs.length};
  } catch(err){
    // el usuario canceló la hoja: no es un error y no hay que bajar nada a sus espaldas
    if(err && err.name === "AbortError") return {modo: "cancelado", n: 0};
    // iOS exige que share() salga de un gesto reciente; si el render tardó, se pide otro toque
    if(err && err.name === "NotAllowedError") return {modo: "reintentar", n: fs.length, files: fs};
    bajarArchivos(fs);
    return {modo: "descarga", n: fs.length};
  }
}

function bajarArchivos(files){
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }, i * 350));   // el navegador bloquea descargas en ráfaga
}

function slug(s){
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pieza";
}

/* ---------- stickers de story ----------
   Una story no lleva caption (Instagram no lo muestra), pero el sticker es lo que la
   convierte en conversación: encuesta, pregunta abierta o reacción con emoji. Se sugieren
   por categoría de la idea, y el texto pasa por rellenar() para que traiga SU zona. */
const STICKERS = {
  pregunta: [
    {tipo:"encuesta", icono:"📊", texto:"¿Comprar o rentar en {zona}?", opciones:["Comprar","Rentar"]},
    {tipo:"pregunta abierta", icono:"💬", texto:"¿Qué te detiene para decidir?"}],
  dato: [
    {tipo:"encuesta", icono:"📊", texto:"¿Sabías este dato de {zona}?", opciones:["Sí lo sabía","No tenía idea"]},
    {tipo:"reacción con emoji", icono:"😮", texto:"Reacciona si te sorprendió"}],
  zonas: [
    {tipo:"encuesta", icono:"📊", texto:"¿Vivirías en {zona}?", opciones:["Mañana mismo","Lo dudo"]},
    {tipo:"pregunta abierta", icono:"💬", texto:"¿Qué zona quieres que cuente después?"}],
  frase: [
    {tipo:"reacción con emoji", icono:"❤️", texto:"Reacciona si te resuena"},
    {tipo:"pregunta abierta", icono:"💬", texto:"¿Qué te frena hoy?"}],
};
const STICKERS_FALLBACK = [
  {tipo:"encuesta", icono:"📊", texto:"¿Te sirvió esto?", opciones:["Mucho","Más o menos"]},
  {tipo:"pregunta abierta", icono:"💬", texto:"¿Qué quieres que cuente después?"}];

function stickersDe(idea){
  const propios = idea.stickers_sugeridos;
  const base = propios && propios.length ? propios : (STICKERS[idea.categoria] || STICKERS_FALLBACK);
  return base.map(s => ({...s, texto: rellenar(s.texto),
                         opciones: (s.opciones || []).map(o => rellenar(o))}));
}

function bloqueStickers(idea){
  const ss = stickersDe(idea);
  if(!ss.length) return "";
  return `<div class="stk"><span class="et">Stickers sugeridos</span>
    ${ss.map(s => `<div class="uno">
      <span class="ico" aria-hidden="true">${s.icono || "✨"}</span>
      <div class="cuerpo">
        <span class="tipo">${esc(s.tipo)}</span>
        <p class="txt">${esc(s.texto)}</p>
        ${s.opciones && s.opciones.length
          ? `<div class="ops">${s.opciones.map(o => `<span class="op">${esc(o)}</span>`).join("")}</div>`
          : ""}
      </div></div>`).join("")}
  </div>`;
}

/* ---------- ideas del día ---------- */
function storiesDeHoy(){
  const st = IDEAS.filter(i => i.seccion === "story" && disponible(i));
  const n = st.length, k = S.rotacion % n, orden = [];
  for(let j=0;j<3;j++) orden.push(st[(k+j)%n]);
  return orden;
}
const postsSugeridos = () => IDEAS.filter(i => i.seccion === "post" && disponible(i)).slice(0,2);
// cada clase de evento tiene su propia idea; si no hay, cae a la primera de operación
const ideaEvento = (clase) => IDEAS.find(i => i.seccion === "operacion" && i.clase === clase)
                           || IDEAS.find(i => i.seccion === "operacion");

/* Cada clase de evento se cuenta distinto. Estaba escrito como un ternario captación/cierre
   y con cuatro clases eso ya mentía: una baja de precio no es un cierre. */
const COPY_EVENTO = {
  captacion: {kicker:"Captación", cta:"Compartirla",
    titular: e => `Nueva propiedad en ${e.colonia || "tu zona"}.`},
  venta: {kicker:"Cierre", cta:"Armar la pieza",
    titular: e => `Cerraste ${(e.tipo||"una propiedad").toLowerCase()} en ${e.colonia || "tu zona"}.`},
  contrato: {kicker:"Contrato", cta:"Armar la pieza",
    titular: e => `Firmaste contrato en ${e.colonia || "tu zona"}.`},
  baja_precio: {kicker:"Baja de precio", cta:"Anunciarla",
    titular: e => `Bajó ${e.baja_pct ? e.baja_pct + "% " : ""}el precio en ${e.colonia || "tu zona"}.`},
};

/* ---------- pantallas ---------- */
/* Esta pantalla no decía NADA: quien la veía sólo podía reportar "no me deja entrar", y del
   otro lado no había forma de saber si el problema era el correo con el que entró, el equipo
   del archivo o la sesión. Ahora muestra el correo detectado, que es el dato que decide. */
function pFuera(){
  const mail = emailDeSesion();
  return `<div class="pad">
    <h2 class="pant">Todavía no está para tu equipo</h2>
    <p class="sub">Pulppo Studio está en prueba con ${esc(D.equipo || "una inmobiliaria")}.
    En cuanto se abra a más equipos te avisamos.</p>
    <div class="rot" style="margin-top:20px"><span>Si crees que sí te toca</span></div>
    <div class="dedonde">
      <div class="lin"><code>entraste como</code><span>${esc(mail || "sin sesión")}</span></div>
      <div class="lin"><code>equipo del archivo</code><span>${esc(D.equipo || "—")}</span></div>
      <div class="lin"><code>perfiles cargados</code><span>${(D.brokers || []).length}</span></div>
    </div>
    <p class="sub" style="margin-top:12px;font-size:11.5px">Si ése no es tu correo de Pulppo,
    entraste con otra cuenta de Google: sal y elige la de <b>@pulppo.com</b>. Si sí es el tuyo,
    mándanos esta pantalla y lo resolvemos.</p>
  </div>`;
}

function pQuienEres(){
  const lista = EQUIPO.map((b, k) => `<button class="quien" data-quien="${k}">
      ${b.foto ? `<img src="${esc(b.foto)}" alt="">` : '<span class="sinfoto"></span>'}
      <span class="n"><b>${esc(b.nombre)}</b>
      <i>${esc(((b.zonas || []).slice(0,2).map(z => z.zona).join(" · ")) || b.email || "")}</i></span>
    </button>`).join("");
  return `<div class="pad">
    <h2 class="pant">¿Quién eres?</h2>
    <p class="sub">Toca tu nombre. Solo la primera vez: después el teléfono te recuerda.</p>
    <div class="quienes">${lista}</div>
  </div>`;
}

function pAlta1(){
  const f = (et,vl,extra="") => `<div class="dato"><span class="et">${et}</span>
    <span class="vl">${vl}</span>${extra}<span class="tick">✓</span></div>`;
  return `<div class="pad">
    <span class="paso">Paso 1 de 2</span>
    <h2 class="pant">¿Está bien esto?</h2>
    <p class="sub">Lo sacamos de tu cuenta de Pulppo. Corrige lo que haga falta.</p>
    ${f("Nombre", esc(B.nombre), B.foto?`<img class="av" src="${esc(B.foto)}" alt="">`:"")}
    ${f("WhatsApp", esc(B.telefono))}
    ${f("Inmobiliaria", esc(B.inmobiliaria), B.logo?`<img class="lg" src="${esc(B.logo)}" alt="">`:"")}
    <button class="cta" data-ir="alta2">Está bien, seguir</button>
    <p class="sub" style="margin:14px 0 0;font-size:11.5px">No te pedimos nada de esto: ya estaba en
    Pulppo. Sobre los 988 brokers activos, el nombre está en el 100% y la foto en el 94%.</p>
  </div>`;
}

function pAlta2(){
  const todas = zonasOfrecidas();
  // una zona que ya eligió no se esconde nunca detrás de "ver más": se vería como si se
  // hubiera perdido su selección
  const visibles = S.zonasTodas ? todas
    : todas.filter((z, k) => k < ZONAS_VISIBLES || S.alta.zonas.includes(z.zona));
  const chips = visibles.map(z => `<button class="chip" data-zona="${esc(z.zona)}"
      aria-pressed="${S.alta.zonas.includes(z.zona)}">${esc(z.zona)}<span class="n">${z.avisos}</span></button>`).join("")
    + (todas.length > visibles.length
        ? `<button class="chip mas" data-zonas-mas="1">ver más<span class="n">+${todas.length - visibles.length}</span></button>`
        : (S.zonasTodas && todas.length > ZONAS_VISIBLES
            ? `<button class="chip mas" data-zonas-mas="0">ver menos</button>` : ""));
  const seg = (campo, ops) => `<div class="seg">` + ops.map(o =>
      `<button data-campo="${campo}" data-valor="${o[0]}" aria-pressed="${S.alta[campo]===o[0]}">${o[1]}</button>`).join("") + `</div>`;
  return `<div class="pad">
    <span class="paso">Paso 2 de 2</span>
    <h2 class="pant">Cuatro cosas que no sabemos</h2>
    <p class="sub">Cada respuesta cambia lo que te vamos a sugerir.</p>

    <label class="q">¿En qué zonas trabajas?
      <span>Las de tu inventario vienen marcadas. Abajo están las del resto de
      ${esc(B.inmobiliaria || "tu inmobiliaria")}, por si trabajas alguna donde todavía no
      tienes aviso propio.</span></label>
    <div class="chips">${chips}</div>

    <label class="q">¿Vendes, rentas o ambas?
      <span>Define si te sugerimos captación o primera vivienda.</span></label>
    ${seg("opera", [["venta","Vendo"],["renta","Rento"],["ambas","Ambas"]])}

    <label class="q">¿Ponemos tu celular en las piezas?
      <span>Lo tenemos de Pulppo: ${esc(B.telefono || "no lo encontramos")}. Si dices que no,
      no aparece en ninguna.</span></label>
    ${seg("celular", [["si","Sí"],["no","No"]])}

    <label class="q">¿Usas emojis?
      <span>Si dices que no, no te mostramos ninguna pieza con emoji.</span></label>
    ${seg("emojis", [["si","Sí"],["pocos","Pocos"],["no","No"]])}

    <label class="q">Tu Instagram
      <span>Esto no está en Pulppo y dos templates lo imprimen.</span></label>
    <input type="text" id="in-handle" placeholder="@tuusuario" value="${esc(S.alta.handle)}">

    <label class="q">Tu cierre de siempre</label>
    <input type="text" id="in-cta" value="${esc(S.alta.cta)}">

    <button class="cta acento" data-ir="hoy" data-listo="1">Ver lo de hoy</button>
    <button class="linkbtn" data-ir="alta1">← volver</button>
  </div>`;
}

/* El banner de hito lo calcula el TELÉFONO, no el generador: si no, un archivo de hace tres
   semanas seguiría diciendo "ayer". Y lo que ya pasó de 30 días deja de ser noticia. */
function diasDesde(fecha){
  if(!fecha) return null;
  const d = new Date(fecha + "T12:00:00");
  if(isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function cuandoDe(e){
  const n = diasDesde(e.fecha);
  if(n === null) return e.cuando || "";
  return n <= 0 ? "hoy" : (n === 1 ? "ayer" : "hace " + n + " días");
}
function esFresco(e){
  const n = diasDesde(e.fecha);
  return n === null ? true : n <= 30;
}

function pHoy(){
  // BLOQUE DE HITOS: lo que de verdad pasó en su operación. Puede haber más de uno
  // (una captación y un cierre), así que se muestra el más reciente de cada clase.
  const vistos = new Set();
  const hitos = (B.eventos || []).filter(esFresco).filter(e => {
    if(vistos.has(e.clase)) return false;
    vistos.add(e.clase); return true;
  }).map(e => {
    const ie = ideaEvento(e.clase);
    if(!ie) return "";
    const c = COPY_EVENTO[e.clase] || COPY_EVENTO.venta;
    return `<div class="banner">
      <div class="k"><b></b>${esc(c.kicker)} · ${esc(cuandoDe(e))}</div>
      <h3>${esc(c.titular(e))}</h3>
      <p>${esc(rellenar(ie.gancho))}</p>
      <button data-idea="${ie.id}">${esc(c.cta)}</button>
    </div>`;
  }).join("");

  // MENÚ DE PROPIEDADES: ya son cinco piezas de propiedad y sueltas no se encuentran.
  // Se listan todas, con la novedad de cada una si la hay; las que no tienen evento se
  // muestran apagadas en vez de esconderse, para que el asesor sepa que existen.
  const menuProp = IDEAS.filter(i => i.seccion === "operacion").map(i => {
    const ev = (B.eventos || []).find(e => e.clase === i.clase);
    // Las piezas de captación no necesitan un evento fresco: sirven para CUALQUIER aviso
    // publicado, y el asesor comparte el que quiera. Las de cierre, contrato y baja de
    // precio sí, porque anuncian un hecho con fecha.
    const anyAviso = i.clase === "captacion";
    const hay = !!datosDe(i) && (anyAviso || !!ev);
    // El menú lista dos piezas de la MISMA propiedad (la ficha con datos y el anuncio), y
    // con sólo el título no se distinguen. La descripción dice qué recibes: formato y qué trae.
    const qué = i.menu_desc ? esc(i.menu_desc) : "";
    const cuándo = !hay ? "sin novedades por ahora"
      : ev ? `${esc(cuandoDe(ev))}${ev.colonia ? " · " + esc(ev.colonia) : ""}`
           : "de cualquiera de tus avisos";
    const detalle = qué ? `${qué} · ${cuándo}` : cuándo;
    return `<button class="filaprop" data-idea="${i.id}" ${hay ? "" : "disabled"}>
      <span class="txt"><b>${esc(i.titulo_idea)}</b><i>${detalle}</i></span>
      <span class="fl">${hay ? "→" : ""}</span>
    </button>`;
  }).join("");

  const st = storiesDeHoy().map(i => `<button class="tarj" data-idea="${i.id}">
      <div class="mini">${miniatura(i.template_ref, 108, valoresDe(i), i.id)}</div>
      <h4>${esc(rellenar(i.titulo_idea))}</h4>
      <div class="meta">${i.tokens.filter(t=>!t.includes(".")).length} campos</div>
    </button>`).join("");

  // FEED: post y carrusel son el mismo momento para el asesor (publicar algo trabajado),
  // así que van juntos y él elige por apetito. El formato se ve en la tarjeta.
  const feed = IDEAS.filter(x => (x.seccion === "post" || x.seccion === "carrusel") && disponible(x))
    .slice(0, 3).map(i => {
      const np = (TPL[i.template_ref].pages || []).length;
      const campos = i.tokens.filter(t => !t.includes(".")).length;
      return `<button class="tarj post" data-idea="${i.id}">
        <div class="mini">${miniatura(i.template_ref, 168, valoresDe(i), i.id)}${
          np > 1 ? `<span class="npag">${np} pág</span>` : ""}</div>
        <h4>${esc(rellenar(i.titulo_idea))}</h4>
        <div class="meta">${np > 1 ? "carrusel" : "post"} · ${campos} campos</div>
      </button>`; }).join("");

  // UNA idea por semana, en el formato que ya funciona en el grupo: qué logras hoy,
  // la instrucción con verbo, y el texto listo para copiar. El equipo pidió dos por
  // semana, no una diaria — por eso es "de la semana".
  // Arranca en una idea distinta cada semana (no siempre la misma), pero estable
  // dentro de la semana: si cambiara en cada recarga se sentiría roto. "otra ↻" avanza.
  const semanaDelAno = Math.floor(Date.now() / 6048e5);
  const x = SEMANA.length ? SEMANA[(semanaDelAno + S.rotIdea) % SEMANA.length] : null;
  const sd = x ? `<div class="sindis">
      <div class="fmt">${esc(x.formato)}${x.esfuerzo ? " · " + esc(x.esfuerzo) : ""}</div>
      <h4>${esc(rellenar(x.titulo))}</h4>
      <p>${esc(rellenar(x.objetivo))}</p>
      <p class="instr">${esc(rellenar(x.instruccion))}</p>
      ${x.plantilla ? `<div class="copiar"><span class="et">Para copiar</span>
        <p>${esc(rellenar(x.plantilla))}</p>
        <button class="linkbtn" data-copiar-txt="${esc(rellenar(x.plantilla))}">copiar texto</button></div>` : ""}
      ${x.opciones ? `<ul class="ops">${x.opciones.map(o => `<li>${esc(rellenar(o))}</li>`).join("")}</ul>` : ""}
      ${x.tip ? `<p class="tipx">${esc(rellenar(x.tip))}</p>` : ""}
      ${x.diseno && TPL[x.diseno] ? `<button class="cta" style="margin-top:14px" data-abrir-tpl="${esc(x.diseno)}">Abrir la plantilla</button>` : ""}
    </div>` : "";

  const hechas = S.piezas.length, meta = 5;
  const puntos = Array.from({length:meta}, (_,k) => `<i class="${k<hechas?"on":""}"></i>`).join("");
  return `<div class="pad">
    <h2 class="pant">Hola, ${esc(B.pila)}.</h2>
    <p class="sub">${esc(S.alta.zonas.join(" · ") || "sin zonas")}</p>
    ${hitos}
    ${sd ? `<div class="rot"><span>💡 La idea de la semana</span>
      <button class="linkbtn" id="otraidea" style="font-size:11px">otra ↻</button></div>
    ${sd}` : ""}
    <div class="rot"><span>Historias de hoy</span>
      <button class="linkbtn" id="rotar" style="font-size:11px">otras ↻</button></div>
    <div class="fila">${st}</div>
    <div class="rot"><span>Para tu feed</span>
      <span style="text-transform:none;letter-spacing:0">post o carrusel</span></div>
    <div class="filaposts">${feed}</div>

    <div class="rot"><span>Tus propiedades</span></div>
    <div class="menuprop">${menuProp}</div>

    <div class="ritmo">
      <div class="txt"><b>${hechas} de ${meta} esta semana</b>${hechas?"Seguís en racha.":"Empieza con una story: son dos campos."}</div>
      <div class="puntos">${puntos}</div>
    </div>
  </div>`;
}

/* Ancho del lienzo. Era 352 fijo: en un teléfono angosto (Android de 360, iPhone SE de 375)
   la pieza se salía de .vista, que es overflow-x:hidden — o sea que quedaba CORTADA y sin
   forma de scrollear hasta el resto. Ahora se mide el espacio disponible (menos el .pad). */
function anchoLienzo(){
  const v = document.getElementById("vista");
  const disp = (v && v.clientWidth ? v.clientWidth : document.documentElement.clientWidth) - 40;
  return Math.max(220, Math.min(352, Math.floor(disp)));
}

/* Miniaturas para elegir la foto. Se decidió selector y no detección automática: no hay campo
   que marque la fachada, y una IA de visión mete costo por foto y falla en silencio. El asesor
   sabe cuál es la buena. Si la propiedad es de un desarrollo, las suyas vienen primero. */
/* Post o historia. El diseño cambia de verdad —9:16 contra el lienzo del post— así que no es
   un recorte: son dos templates y el asesor elige cuál baja. */
function selectorFormato(idea){
  const f = formatosDe(idea);
  if(!f || Object.keys(f).length < 2) return "";
  const act = formatoActual(idea);
  const nombre = {post: "Post", story: "Historia"};
  // sin medidas: "1080×1350" no le dice nada a quien va a publicar. Post es 4:5 y
  // historia es 9:16 por definición, no por elección del asesor.
  return `<div class="selform">
    <span class="et">Formato</span>
    <div class="seg">${["post", "story"].filter(k => f[k]).map(k =>
      `<button data-formato="${k}" aria-pressed="${k === act}">${nombre[k]}</button>`
    ).join("")}</div>
  </div>`;
}

function selectorFotos(idea){
  if(!usaFoto(idea)) return "";
  const fotos = fotosCandidatas(idea);
  if(fotos.length < 2) return "";
  const actual = fotoElegida(idea);
  const deDesarrollo = ((B.fotos_urls || {})[idea.id] || idea.fotos_urls || []).length > 0;
  return `<div class="selfoto">
    <span class="et">Elige la foto${deDesarrollo ? "" : " de la zona"}</span>
    <div class="tiras">
      ${fotos.map(u => `<button class="tira" data-foto="${esc(u)}"
          aria-pressed="${u === actual}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join("")}
    </div>
  </div>`;
}

function pEditor(){
  const i = IDEAS.find(x => x.id === S.ideaAbierta);
  if(!i) return pHoy();
  const ref = refDe(i);
  const nPag = (TPL[ref].pages || []).length;
  if(S.pagina >= nPag) S.pagina = 0;
  const ancho = anchoLienzo(), r = renderTemplate(ref, ancho / (TPL[ref].width||1080), true, S.pagina);
  const alto = (TPL[ref].height || 1350) * (ancho / (TPL[ref].width||1080));

  // carrusel / variantes: el asesor tiene que poder ver todas las páginas
  const pager = nPag > 1 ? `<div class="pager">
      <button data-pag="-1" ${S.pagina===0?"disabled":""} aria-label="Anterior">←</button>
      <span>${i.variantes ? "variante" : "página"} ${S.pagina+1} de ${nPag}</span>
      <button data-pag="1" ${S.pagina===nPag-1?"disabled":""} aria-label="Siguiente">→</button>
    </div>` : "";

  // una story no lleva caption: Instagram no lo muestra. Va con stickers sugeridos.
  const esStory = i.formato === "story";

  // familia propiedad/operación: no hay campos que escribir, se llena del aviso
  const libres = camposEditables(i);
  const campos = libres.map(t => `<div class="campo">
      <label class="et" for="c-${t}">${esc(t.replace(/_/g," "))}</label>
      <textarea id="c-${t}" data-token="${t}" rows="1">${esc(S.valores[t]||"")}</textarea>
    </div>`).join("");

  // Un token con punto (pictures.0.url, company.logo.*) se resuelve del aviso o de la marca,
  // no se escribe. Si queda sin valor la pieza sale con un rectángulo gris — y antes el botón
  // igual decía "listo para bajar", así que se podía bajar incompleta. Ahora cuenta como falta.
  const mapa = tokensMapa(S.valores);
  const huecos = i.tokens.filter(t => t.includes(".") && !mapa[t]);
  // un token vacío A PROPÓSITO (el celular que decidió no poner) no cuenta como faltante,
  // o la pieza quedaría bloqueada por una decisión suya. Se declara ANTES de usarse: como
  // `const` vive en zona muerta hasta su línea, referenciarlo arriba tiraba ReferenceError
  // en cuanto la pieza tenía algún campo pendiente — y sólo entonces, porque con la lista
  // vacía el callback del filter no llega a ejecutarse. Un bug que se esconde solo.
  const optOut = new Set(S.alta.celular === "no" ? ["broker.phone"] : []);
  const faltan = (esDeDatos(i)
    ? i.tokens.filter(t => !S.valores[t] && !EDITABLE_EN_DATOS.test(t))
    : libres.filter(t => !S.valores[t]))
    .concat(huecos.filter(t => !S.valores[t]))
    .filter(t => !optOut.has(t));
  const usaHandle = i.tokens.includes("broker.handle");
  const sinHandle = usaHandle && !S.alta.handle;
  const listo = !faltan.length && !sinHandle;

  // corta en el PRIMER punto seguido de espacio: los nombres de archivo traen puntos
  // y un split(".") suelto dejaba el aviso como "Template prestado. json (número gigante)"
  const cuerpo = (t) => { const k = t.indexOf(". "); return k < 0 ? t : t.slice(k + 2).trim(); };
  const avisos = [];
  if(i.nota_guardrail) avisos.push(`<div class="aviso"><b>No inventamos cifras.</b> ${esc(cuerpo(i.nota_guardrail))}</div>`);
  if(sinHandle) avisos.push(`<div class="aviso"><b>Falta tu Instagram.</b> Esta pieza lo imprime y no lo cargaste en el alta.</div>`);
  if(i.nota_template) avisos.push(`<div class="aviso"><b>Template prestado.</b> ${esc(cuerpo(i.nota_template))}</div>`);

  return `<div class="pad">
    <button class="linkbtn" data-ir="hoy">← Hoy</button>
    <h2 class="pant" style="font-size:21px">${esc(rellenar(i.titulo_idea))}</h2>
    <p class="sub">${esc(rellenar(i.gancho))}</p>
    <div class="lienzowrap" style="width:${ancho}px;height:${Math.round(alto)}px">${r.html}</div>
    ${pager}
    ${selectorFormato(i)}
    ${selectorFotos(i)}
    <div style="margin-bottom:14px">
      <span class="pill ${listo?"ok":"rev"}">${listo?"listo para bajar":(faltan.length?"faltan "+faltan.length:"revisar")}</span>
    </div>
    ${avisos.join("")}
    ${esDeDatos(i) ? `
      <p class="sub" style="margin:10px 0 0;font-size:11.5px">El precio, los metros y las
      recámaras salen del aviso y no se editan acá: si algo está mal, se corrige en la
      propiedad y la pieza se actualiza sola.</p>
      ${libres.length ? `<div class="rot" style="margin-top:14px"><span>Lo que puedes cambiar</span></div>
      ${campos}` : ""}`
    : `<div class="rot" style="margin-top:6px"><span>Lo que puedes cambiar</span></div>
    ${campos}`}
    ${esStory
      ? bloqueStickers(i)
      : `<div class="capt"><span class="et">Caption</span><p>${esc(rellenar(i.caption_sugerida||""))}</p></div>`}
    <div class="dosbtn">
      <button class="prim" data-guardar="${i.id}" ${listo?"":"disabled"}>${
        SOPORTA_COMPARTIR ? "Compartir" : "Descargar"}</button>
      ${esStory ? "" : `<button class="sec" data-copiar="1">Copiar caption</button>`}
    </div>
    ${SOPORTA_COMPARTIR ? `<p class="sub" style="margin-top:10px;font-size:11.5px">Se abre
      el menú de tu teléfono: ahí tienes <b>Guardar en Fotos</b> e Instagram.</p>` : ""}
    <p class="sub" style="margin-top:12px;font-size:11.5px">Cada campo que cambias se guarda como
    corrección y afina lo próximo que te sugerimos.</p>
  </div>`;
}

function pPiezas(){
  if(!S.piezas.length) return `<div class="pad"><h2 class="pant">Mis piezas</h2>
    <div class="vacio">Todavía no bajaste ninguna.<br>Abre una idea de <b>Hoy</b> y descargala.</div></div>`;
  const lista = S.piezas.map(p => `<div class="pieza">
      <div class="mini">${miniatura(p.ref, 46)}</div>
      <div class="info"><h4>${esc(p.titulo)}</h4>
        <div class="meta">${esc(p.formato)} · ${esc(p.cuando)}</div></div>
      <span class="pill ok">descargada</span>
    </div>`).join("");
  return `<div class="pad"><h2 class="pant">Mis piezas</h2>
    <p class="sub">${S.piezas.length} descargada${S.piezas.length>1?"s":""}. Las sugeridas que no abres se descartan a los 7 días.</p>
    ${lista}</div>`;
}

function pPerfil(){
  const filas = [["Nombre",B.nombre],["WhatsApp",B.telefono],["Inmobiliaria",B.inmobiliaria],
    ["Rol",B.rol],["Zonas",S.alta.zonas.join(", ")||"—"],["Opera",S.alta.opera],
    ["Emojis",S.alta.emojis],["Instagram",S.alta.handle?"@"+S.alta.handle.replace(/^@/,""):"— falta"],
    ["Tu cierre",S.alta.cta]].map(([k,v]) =>
    `<div class="dato"><span class="et">${esc(k)}</span><span class="vl">${esc(v)}</span></div>`).join("");
  return `<div class="pad"><h2 class="pant">Tu perfil</h2>
    <p class="sub">Lo de arriba vino de Pulppo. Lo de abajo lo respondiste tú.</p>
    ${filas}
    <div class="rot">Cómo escribís</div>
    <p class="sub" style="font-size:12.5px">Acá va a vivir lo que el sistema aprenda de tus
    correcciones: “siempre acorta los títulos”, “nunca usa emoji”, “firma como Lic.”. Visible y
    editable, para que puedas corregir lo que creemos de ti.</p>
    <button class="linkbtn" data-ir="alta1">Volver a ver el alta</button></div>`;
}

/* ---------- riel de anotaciones ---------- */
const RIEL = {
  quien: {t:"Un solo link para el equipo", s:"Piloto de Diamond House",
    notas:[["Por qué así","Un link se pega una vez en el grupo de WhatsApp. Repartir 21 links distintos era la parte más frágil del arranque."],
      ["Quiénes aparecen","Los 21 asesores activos de Diamond House. Se dejó fuera la cuenta de prueba, que no entra desde enero de 2025."],
      ["Se elige una sola vez","El teléfono recuerda quién eres. La segunda visita abre directo en Hoy."]]},
  alta1: {t:"El alta que casi no se contesta", s:"Pantalla 1 de 2 · confirmar, no completar",
    notas:[["Qué es real aquí","Todo. Nombre, teléfono, inmobiliaria, foto y logo salen de la colección <code>agents</code> de este broker. No hay un solo campo inventado."],
      ["Por qué importa","Medido sobre los <b>988 brokers activos</b>: nombre 100%, foto 94%, teléfono 97%, inmobiliaria 97%, logo 97%. El alta empieza llena."],
      ["La trampa que ya evitamos","Esas coberturas parecían mucho peores (foto 64%) porque se habían medido sobre los 3,965 documentos de <code>agents</code>, que incluyen 2,939 inactivos y un tipo legacy."]]},
  alta2: {t:"Las cuatro preguntas", s:"Pantalla 2 de 2 · lo único que Pulppo no sabe",
    notas:[["Las zonas vienen pre-cargadas","Los chips son las colonias reales de su inventario publicado, ordenadas por cantidad de avisos. Solo confirma."],
      ["Probá esto","Escribe tu Instagram y luego abre la story de la frase: el handle aparece impreso en la pieza. Si lo dejas vacío, la pieza se marca “revisar”."],
      ["El problema del 50%","Solo 490 de los 988 activos tienen inventario publicado. A la otra mitad hay que preguntarle las zonas <b>y</b> no tiene fotos propias para los 4 templates a sangre. Es la decisión más urgente del alta."]]},
  hoy: {t:"La pantalla de todos los días", s:"Nunca un lienzo en blanco",
    notas:[["El banner es un evento real","Este broker cerró una operación de verdad, y la fecha, la colonia y el tipo salen de <code>status.history</code>. Por eso el banner dice lo que dice."],
      ["Y por eso es banner, no sección","En 30 días solo <b>169 de 988 brokers (17%)</b> tuvieron algún evento. Como sección fija estaría vacía para 8 de cada 10, todos los días. Como banner, desaparece cuando no hay nada."],
      ["Stories vs posts","Tres stories que caducan hoy (2-3 campos, ritmo diario) y dos posts para la semana (5-8 campos). Toca “otras ↻” para ver la rotación."]]},
  editor: {t:"De idea a pieza", s:"Los campos llegan llenos, no vacíos",
    notas:[["Esto es el template real","El lienzo es el JSON de Polotno renderizado en vivo, con las fuentes de marca. Escribe en cualquier campo y mira cómo cambia la pieza."],
      ["El amarillo son huecos","Lo resaltado es un token sin resolver. Vacía un campo y aparece: es exactamente lo que el guardrail bloquea antes de que la pieza salga."],
      ["Dos casos a propósito","La story del dato deja la cifra vacía (no inventamos números) y la pieza de la venta usa un template prestado, porque las piezas de operación todavía no tienen el suyo."]]},
  piezas: {t:"Mis piezas", s:"Reusar lo que funcionó, no acumular pendientes",
    notas:[["Estados","<code>sugerida → en edición → lista → descargada</code>. Lo sugerido que no se abre en 7 días se descarta solo: un backlog de contenido es culpa, no ayuda."],
      ["Lo que falta decidir","Si Studio conecta con Metricool, aquí aparecería <b>publicada</b> y su rendimiento — y el motor podría sugerir en base a lo que de verdad funcionó."]]},
  perfil: {t:"Tu perfil", s:"Lo que el sistema cree de ti, visible",
    notas:[["La memoria es editable","Las correcciones se aprenden solas, pero el broker tiene que poder verlas y corregirlas. Un sistema que aprende en secreto se siente ajeno."]]}
};

function pintarRiel(){
  const r = RIEL[S.pantalla] || RIEL.hoy;
  const notas = r.notas.map((n,k) => `<div class="nota${k===0?" viva":""}">
      <h4>${n[0]}</h4><p>${n[1]}</p></div>`).join("");
  const tabla = `<div class="nota"><h4>Los números que condicionan el diseño</h4>
    <table class="datos">
      <tr><td>Brokers activos</td><td>988</td></tr>
      <tr><td>Con foto de perfil</td><td>94%</td></tr>
      <tr><td>Con inventario publicado</td><td>490 · 50%</td></tr>
      <tr><td>Con evento de operación (30 d)</td><td>169 · 17%</td></tr>
      <tr><td>Templates disponibles</td><td>12</td></tr>
      ${B ? `<tr><td>Avisos publicados de ${esc(B.pila)}</td><td>${B.total_publicados}</td></tr>` : ""}
    </table></div>`;
  document.getElementById("riel").innerHTML =
    `<h3>${r.t}</h3><p class="peq">${r.s}</p>${notas}${tabla}`;
}

/* Rotar el teléfono cambia el ancho disponible → hay que repintar el lienzo. */
let tRedim;
window.addEventListener("resize", () => {
  clearTimeout(tRedim);
  tRedim = setTimeout(() => { if(S.pantalla === "editor") pintar(); }, 150);
});

/* ---------- pintar ---------- */
function pintar(){
  const mapa = {quien:pQuienEres, fuera:pFuera, alta1:pAlta1, alta2:pAlta2, hoy:pHoy, editor:pEditor, piezas:pPiezas, perfil:pPerfil};
  document.getElementById("vista").innerHTML = (mapa[S.pantalla] || pHoy)();
  document.getElementById("vista").scrollTop = 0;
  const tabs = document.getElementById("tabs");
  tabs.hidden = !S.altaLista || S.pantalla === "quien" || S.pantalla === "fuera";
  [...tabs.querySelectorAll("button")].forEach(b =>
    b.setAttribute("aria-current", String(b.dataset.ir === S.pantalla)));
  document.getElementById("barra-tit").textContent =
    S.pantalla.startsWith("alta") ? "Crear tu perfil" : "Pulppo Studio";
  pintarRiel();
}

function abrirIdea(id){
  const i = IDEAS.find(x => x.id === id);
  S.ideaAbierta = id;
  S.valores = valoresDe(i);
  S.pantalla = "editor";
  S.pagina = 0;
  pintar();
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-ir],[data-idea],[data-foto],[data-formato],[data-zona],[data-zonas-mas],[data-campo],[data-guardar],[data-copiar],[data-pag],[data-quien],[data-recargar],[data-copiar-txt],[data-abrir-tpl],#rotar,#otraidea");
  if(!t) return;

  if(t.dataset.copiarTxt){
    if(navigator.clipboard) navigator.clipboard.writeText(t.dataset.copiarTxt);
    t.textContent = "copiado"; setTimeout(() => { t.textContent = "copiar texto"; }, 1400);
    return;
  }
  if(t.dataset.abrirTpl){
    const i = IDEAS.find(x => x.template_ref === t.dataset.abrirTpl);
    if(i) return abrirIdea(i.id);
    return;
  }
  if(t.dataset.recargar !== undefined){ return location.reload(); }
  if(t.dataset.quien){
    const elegido = EQUIPO[Number(t.dataset.quien)];
    if(!elegido) return;
    try { localStorage.setItem("studio.quien", elegido.email); } catch(e) {}
    if(D.en_vivo){
      // en vivo el selector sólo trae nombre y correo: el perfil hay que ir a pedirlo
      perfilEnVivo(elegido.email).then(r => {
        if(!r.perfil){ S.pantalla = "fuera"; return pintar(); }
        B = r.perfil;
        S.alta.zonas = B.zonas.map(z => z.zona);
        pintarPie(); S.pantalla = "alta1"; pintar();
      }).catch(() => { S.pantalla = "fuera"; pintar(); });
      return;
    }
    B = elegido;
    S.alta.zonas = B.zonas.map(z => z.zona);   // su inventario entero viene marcado
    pintarPie(); S.pantalla = "alta1"; return pintar();
  }
  if(t.dataset.pag){ S.pagina += Number(t.dataset.pag); return pintar(); }
  if(t.id === "rotar"){ S.rotacion++; return pintar(); }
  if(t.id === "otraidea"){ S.rotIdea++; return pintar(); }
  if(t.dataset.formato){
    S.formatoSel[S.ideaAbierta] = t.dataset.formato;
    S.pagina = 0;                       // el post y la historia no tienen las mismas páginas
    return pintar();
  }
  if(t.dataset.foto){
    S.fotoSel[S.ideaAbierta] = t.dataset.foto;
    return pintar();
  }
  if(t.dataset.zonasMas){
    S.zonasTodas = t.dataset.zonasMas === "1";
    return pintar();
  }
  if(t.dataset.zona){
    const z = t.dataset.zona, i = S.alta.zonas.indexOf(z);
    i >= 0 ? S.alta.zonas.splice(i,1) : S.alta.zonas.push(z);
    return pintar();
  }
  if(t.dataset.campo){ S.alta[t.dataset.campo] = t.dataset.valor; return pintar(); }
  if(t.dataset.idea) return abrirIdea(t.dataset.idea);
  if(t.dataset.guardar){
    const i = IDEAS.find(x => x.id === t.dataset.guardar);
    const btn = t; const antes = btn.textContent;
    btn.disabled = true; btn.textContent = SOPORTA_COMPARTIR ? "Preparando…" : "Bajando…";
    // los archivos ya pintados se guardan por si iOS pide un segundo toque para compartir
    compartirPieza(i, S.archivosListos).then(r => {
      S.archivosListos = null;
      if(r.modo === "cancelado"){ btn.disabled = false; btn.textContent = antes; return; }
      if(r.modo === "reintentar"){
        S.archivosListos = r.files;
        btn.disabled = false; btn.textContent = "Compartir ahora";
        return;
      }
      if(!S.piezas.some(p => p.id === i.id))
        S.piezas.push({id:i.id, titulo:i.titulo_idea, ref:refDe(i),
                       formato:formatoActual(i), cuando:"recién", imagenes:r.n});
      S.pantalla = "piezas"; pintar();
    }).catch(err => {
      S.archivosListos = null;
      btn.disabled = false; btn.textContent = antes;
      alert("No se pudo generar la imagen: " + err.message);
    });
    return;
  }
  if(t.dataset.copiar){
    const i = IDEAS.find(x => x.id === S.ideaAbierta);
    if(i && navigator.clipboard) navigator.clipboard.writeText(i.caption_sugerida || "");
    t.textContent = "Copiada"; setTimeout(() => { t.textContent = "Copiar caption"; }, 1400);
    return;
  }
  if(t.dataset.ir){
    if(t.dataset.listo){
      const h = document.getElementById("in-handle"), c = document.getElementById("in-cta");
      if(h) S.alta.handle = h.value.trim();
      if(c) S.alta.cta = c.value.trim();
      S.altaLista = true;
    }
    S.pantalla = t.dataset.ir; return pintar();
  }
});

/* editar un campo re-renderiza la pieza sin perder el foco ni el cursor */
document.addEventListener("input", e => {
  const el = e.target;
  if(el.dataset && el.dataset.token){
    S.valores[el.dataset.token] = el.value;
    const i = IDEAS.find(x => x.id === S.ideaAbierta);
    const ancho = anchoLienzo(), rf = refDe(i), esc0 = ancho / (TPL[rf].width || 1080);
    const wrap = document.querySelector(".lienzowrap");
    if(wrap) wrap.innerHTML = renderTemplate(rf, esc0, true, S.pagina).html;
    const libres = i.tokens.filter(t => !t.includes("."));
    const faltan = libres.filter(t => !S.valores[t]).length;
    const sinH = i.tokens.includes("broker.handle") && !S.alta.handle;
    const pill = document.querySelector(".pill"), btn = document.querySelector("[data-guardar]");
    if(pill){
      const ok = !faltan && !sinH;
      pill.className = "pill " + (ok ? "ok" : "rev");
      pill.textContent = ok ? "listo para bajar" : (faltan ? "faltan " + faltan : "revisar");
      if(btn) btn.disabled = !ok;
    }
  }
  if(el.id === "in-handle") S.alta.handle = el.value.trim();
  if(el.id === "in-cta") S.alta.cta = el.value.trim();
});

/* ruteo por hash: #hoy, #editor/evento-vendida … sirve para compartir y para depurar */
/* #empalmes — audita TODAS las ideas × páginas y reporta texto que se sale de su caja o que
   pisa a otro texto. Hace falta medir de verdad: en el render el div de texto lleva
   `height:auto`, así que la altura declarada en el JSON no limita nada y un copy de dos
   líneas invade lo que tiene debajo sin que se note hasta que la pieza está hecha. */
function auditarEmpalmes(){
  const caja = document.createElement("div");
  caja.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
  document.body.appendChild(caja);
  const hallazgos = [];

  for(const idea of IDEAS){
    const t = TPL[idea.template_ref];
    if(!t) continue;
    const vals = valoresDe(idea);
    for(let pg = 0; pg < (t.pages || []).length; pg++){
      caja.innerHTML = renderTemplate(idea.template_ref, 1, false, pg, vals, idea.id).html;
      const lienzo = caja.querySelector(".lienzo");
      if(!lienzo) continue;
      const hijos = (t.pages[pg].children || []);
      const divs = Array.from(lienzo.children);
      const base = lienzo.getBoundingClientRect();
      const textos = [];
      divs.forEach((el, i) => {
        const c = hijos[i];
        if(!c || c.type !== "text") return;
        const txt = (el.textContent || "").trim();
        if(!txt) return;                       // token vacío: no ocupa lugar
        // La caja declarada miente en los dos ejes: el div va con height:auto, y en ancho un
        // "1" de 30px vive en una caja de 90. Se mide la TINTA con los rects del rango, que
        // es lo único que de verdad se ve y por línea.
        const rg = document.createRange(); rg.selectNodeContents(el);
        const rects = Array.from(rg.getClientRects()).filter(r => r.width > 0 && r.height > 0);
        if(!rects.length) return;
        const x0 = Math.min(...rects.map(r => r.left))   - base.left;
        const x1 = Math.max(...rects.map(r => r.right))  - base.left;
        const y0 = Math.min(...rects.map(r => r.top))    - base.top;
        const y1 = Math.max(...rects.map(r => r.bottom)) - base.top;
        const r = {i, c, txt, x: x0, y: y0, w: x1 - x0, hReal: y1 - y0,
                   hDecl: c.height||0};
        textos.push(r);
        if(r.hReal > r.hDecl + 4){
          hallazgos.push({tpl: idea.template_ref, pg, tipo: "desborde", idea: idea.id,
            txt: txt.slice(0,34), caja: Math.round(r.hDecl), real: r.hReal,
            sobra: r.hReal - Math.round(r.hDecl)});
        }
      });
      for(let a = 0; a < textos.length; a++){
        for(let b = a+1; b < textos.length; b++){
          const A = textos[a], B = textos[b];
          const xo = Math.min(A.x+A.w, B.x+B.w) - Math.max(A.x, B.x);
          const yo = Math.min(A.y+A.hReal, B.y+B.hReal) - Math.max(A.y, B.y);
          // 4px de tolerancia: los acentos y las colas de las letras rozan sin estorbar
          if(xo > 4 && yo > 4){
            hallazgos.push({tpl: idea.template_ref, pg, tipo: "empalme", idea: idea.id,
              txt: A.txt.slice(0,26) + "  ✕  " + B.txt.slice(0,26),
              solape: Math.round(yo)});
          }
        }
      }
    }
  }
  caja.remove();
  return hallazgos;
}

function desdeHash(){
  const h = (location.hash || "").replace(/^#/, "");
  if(!h) return false;
  const [p, id] = h.split("/");
  if(p === "empalmes"){
    fuentesListas().then(() => {
      const r = auditarEmpalmes();
      document.body.innerHTML = "<pre id='auditoria' style='font:12px monospace;padding:16px;"
        + "white-space:pre-wrap'>" + esc(JSON.stringify(r, null, 1)) + "</pre>";
    });
    return true;
  }
  if(p === "editor" && id && IDEAS.some(x => x.id === id)){
    S.altaLista = true; abrirIdea(id); return true;
  }
  // #png/<idea>[/<pagina>] pinta el PNG real a tamaño completo en la página.
  // Es la única forma de verificar lo que se va a descargar sin abrir el archivo.
  if(p === "png" && id){
    // #png/<idea>[,<pagina>[,<formato>]] — el formato hace falta para comparar el mismo
    // contenido en dos lienzos sin tener que tocar la interfaz
    const [ideaId, nPag, fmt] = id.split(",");
    const i = IDEAS.find(x => x.id === ideaId);
    if(i){
      if(fmt) S.formatoSel[i.id] = fmt;
      S.valores = valoresDe(i);
      fuentesListas()
        .then(() => pintarPagina(refDe(i), Number(nPag || 0), S.valores, i.id))
        .then(cv => {
          document.body.innerHTML = "";
          document.body.style.cssText = "margin:0;background:#555";
          cv.style.cssText = "display:block;width:" + cv.width + "px;max-width:100%;height:auto";
          document.body.appendChild(cv);
        });
      return true;
    }
  }
  if(["alta1","alta2","hoy","piezas","perfil"].includes(p)){
    S.altaLista = p !== "alta1" && p !== "alta2";
    S.pantalla = p; pintar(); return true;
  }
  return false;
}
window.addEventListener("hashchange", desdeHash);

function pintarPie(){
  document.getElementById("pie").innerHTML =
  `<b>Qué es real:</b> los 12 templates de Polotno, las 8 fuentes de marca, el perfil de
   ${esc(B.nombre)} (${esc(B.inmobiliaria)}), sus ${B.total_publicados} avisos publicados, las
   colonias y fotos de su inventario, y el evento de operación del banner.
   <b>Qué está simulado:</b> el copy lo escribí yo siguiendo las reglas de voz del motor en vez de
   llamar a la API, la racha semanal no persiste, y “Descargar” solo mueve la pieza a Mis piezas.
   <b>Qué falta decidir:</b> el 50% sin inventario, descargar vs. publicar con Metricool, el ritmo
   objetivo, si el titular aprueba, y si <code>marca_personal</code> entra al primer release.`;
}

function emailDeSesion(){
  const m = document.cookie.match(/(?:^|;\s*)cm-user=([^;]+)/);
  try { return m ? decodeURIComponent(m[1]).trim().toLowerCase() : ""; } catch(e){ return ""; }
}

/* El perfil EN VIVO. El bundle ya no trae los datos de nadie: los pide al abrir.

   Arregla dos cosas que el archivo estático no podía. (1) Caducaba: entre el 21 y el 31 de
   agosto hubo 6 cierres en Diamond House que nunca aparecieron, porque el archivo seguía
   diciendo que no había pasado nada hasta que alguien lo regeneraba a mano. (2) Filtraba:
   llevaba los 22 perfiles con celular y operaciones al dispositivo de quien abriera el link,
   y "ver código fuente" alcanzaba para leerlos.

   Los tokens se le mandan al endpoint porque son metadata de las PLANTILLAS —qué campo pide
   cada pieza—, no datos del asesor: viven en el bundle sin filtrar nada. El servidor los
   resuelve contra el aviso del evento y filtra las rutas contra su propia allowlist. */
/* Los estados van DENTRO de #vista, no reemplazando el body: `pintar()` escribe en #vista y
   lee #tabs y #barra-tit, así que borrar el shell dejaba la app sin dónde pintar y la pantalla
   se quedaba clavada en el esqueleto. Además así conserva la barra de marca. */
function enVista(html){
  const v = document.getElementById("vista");
  if(!v){ document.body.innerHTML = html; return; }
  v.innerHTML = html;
  const tabs = document.getElementById("tabs");
  if(tabs) tabs.hidden = true;
}

/* El esqueleto de "Hoy": mismos bloques que va a haber, así el contenido no salta. */
function pCargando(){
  return `<div class="cargando">
    <div class="marca"><span class="punto"></span><span class="punto"></span><span class="punto"></span>
      <span class="et">Preparando tus piezas</span></div>
    <div class="hueso t"></div><div class="hueso s"></div>
    <div class="hueso card"></div>
    <div class="hueso fila"></div><div class="hueso fila"></div><div class="hueso fila"></div>
  </div>`;
}

function pTropiezo(titulo, texto){
  return `<div class="tropiezo"><div class="filete"></div>
    <h1>${esc(titulo)}</h1><p>${esc(texto)}</p>
    <button data-recargar>Volver a intentar</button></div>`;
}

async function perfilEnVivo(comoEmail){
  const tokens = {};
  for(const i of IDEAS){
    if(i.seccion === "operacion" && i.clase) tokens[i.id] = {clase: i.clase, tokens: i.tokens || []};
  }
  const q = comoEmail ? "?email=" + encodeURIComponent(comoEmail) : "";
  const r = await fetch("/api/studio/perfil" + q, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({tokens})
  });
  if(!r.ok) throw new Error("perfil " + r.status);
  return await r.json();          // {perfil, interno}
}

/* El equipo, sólo para el interno que revisa. Es el selector de "¿Quién eres?": el asesor
   nunca lo ve —entra directo a lo suyo— y el endpoint lo rechaza si no es de la allowlist. */
async function equipoEnVivo(){
  try {
    const r = await fetch("/api/studio/equipo");
    if(!r.ok) return [];
    return (await r.json()).equipo || [];
  } catch(e) { return []; }
}

async function arrancar(){
  if(!B && D.en_vivo){
    enVista(pCargando());
    // Quién es interno lo decide el SERVIDOR, no el archivo: así la allowlist del equipo
    // Pulppo no viaja al dispositivo de cada asesor. El `como` se manda siempre y el
    // endpoint lo ignora si quien pregunta no es interno.
    let guardado = null;
    try { guardado = localStorage.getItem("studio.quien"); } catch(e) {}
    const como = (new URLSearchParams(location.search).get("como") || "") || guardado || "";
    let interno = false;
    try {
      const r = await perfilEnVivo(como);
      B = r.perfil; interno = !!r.interno;
    } catch(e) {
      enVista(pTropiezo("No pudimos cargar tus piezas",
        "Fue al pedir tus datos, no es tu conexión. Intenta de nuevo; si sigue igual, avísanos."));
      return;
    }
    if(!B){
      // pasó la puerta pero no es asesor activo con inmobiliaria; el interno sin elegir a
      // nadie todavía ve el selector
      if(interno){ EQUIPO = await equipoEnVivo(); S.pantalla = "quien"; pintar(); return; }
      S.pantalla = "fuera"; pintar(); return;
    }
    S.alta.zonas = B.zonas.map(z => z.zona);   // su inventario entero viene marcado
    pintarPie();
    if(!desdeHash()) pintar();
    return;
  }
  if(!B && D.brokers){
    // Tres caminos: el asesor entra directo a lo suyo; el equipo interno ve el selector
    // para probar; cualquier otro se queda afuera — el bundle tiene data de UN equipo y no
    // se le muestra a asesores de otras inmobiliarias.
    const mail = emailDeSesion();
    const interno = mail && (D.internos || []).includes(mail);
    // se compara contra sus DOS emails (trabajo y personal): el login acepta cualquiera de
    // los dos, así que el archivo tiene que reconocer los dos o rebota a quien ya entró
    const yo = mail && D.brokers.find(b => (b.emails || [b.email || ""])
      .some(e => String(e).toLowerCase() === mail));
    if(mail && !yo && !interno){
      S.pantalla = "fuera"; pintar(); return;
    }
    if(yo){
      B = yo;
      S.alta.zonas = B.zonas.map(z => z.zona);   // su inventario entero viene marcado
      pintarPie();
      if(!desdeHash()) pintar();
      return;
    }
    let guardado = null;
    try { guardado = localStorage.getItem("studio.quien"); } catch(e) {}
    const encontrado = guardado && D.brokers.find(b => b.email === guardado);
    if(encontrado){
      B = encontrado;
      S.alta.zonas = B.zonas.map(z => z.zona);   // su inventario entero viene marcado
      pintarPie();
      if(!desdeHash()) pintar();
    } else {
      S.pantalla = "quien"; pintar();
    }
    return;
  }
  if(!B){
    const t = (new URLSearchParams(location.search).get("b") || "").replace(/[^a-z0-9]/gi, "");
    if(!t){
      document.body.innerHTML = '<div class="tope"><h1>Falta tu enlace</h1>' +
        '<p>Abre el link personal que te compartimos. Si lo perdiste, pídelo de nuevo.</p></div>';
      return;
    }
    try {
      const r = await fetch("d/" + t + ".json");
      if(!r.ok) throw new Error(r.status);
      B = await r.json();
    } catch (e) {
      document.body.innerHTML = '<div class="tope"><h1>Este enlace ya no sirve</h1>' +
        '<p>Puede haber cambiado. Pídelo de nuevo y lo reemplazamos.</p></div>';
      return;
    }
  }
  S.alta.zonas = B.zonas.slice(0,2).map(z => z.zona);
  pintarPie();
  if(!desdeHash()) pintar();
}
arrancar();
</script>
"""


def construir_equipo(inmobiliaria, salida, incluir_todos=False, en_vivo=False):
    """Piloto: UN solo archivo con los perfiles del equipo adentro. El asesor abre el
    link general y elige su nombre. Sin tokens, sin fetch (funciona hasta abriendo el
    archivo local) y sin repartir 21 links. El control de acceso es el allowlist de la
    ruta: solo se publica el equipo del piloto, no los 988."""
    import datetime as dt
    from pymongo import MongoClient

    db = MongoClient(URI_FILE.read_text(encoding="utf-8-sig").strip()).pulppo
    equipo = list(db.agents.find(
        {**FILTRO_ACTIVOS, "company.name": {"$regex": inmobiliaria, "$options": "i"}},
        {"email": 1, "firstName": 1, "lastName": 1, "lastLogin": 1}))
    if not equipo:
        raise SystemExit(f"✗ no hay asesores activos en '{inmobiliaria}'")

    # TODA cuenta que pueda iniciar sesión lleva perfil. El filtro de 90 días venía de cuando
    # había un selector "¿quién eres?" y convenía una lista corta; ahora la identidad sale de la
    # sesión, así que excluir a alguien que SÍ puede entrar solo le deja una pantalla muerta
    # ("Todavía no está para tu equipo") aunque sea de la inmobiliaria del piloto. Los dormidos
    # se reportan para saber a quién no esperar, pero se incluyen igual.
    corte = (dt.datetime.now() - dt.timedelta(days=90)).strftime("%Y-%m-%d")
    vivos, omitidos = list(equipo), []
    for a in equipo:
        ll = str(a.get("lastLogin") or "")[:10]
        nombre = f"{a.get('firstName','')} {a.get('lastName','')}".strip()
        if not ll:
            omitidos.append((nombre, "nunca entró"))
        elif ll < corte:
            omitidos.append((nombre, f"último acceso {ll}"))

    # Sin inventario publicado casi nunca es un asesor: en Diamond House son las cuentas
    # operativas (informacion.dh@, asistente.dh@). Se reportan aparte para que Ale decida,
    # porque un asesor recién llegado también caería aquí.
    # Los templates van ANTES de recorrer los perfiles: hacen falta para saber qué tokens
    # pide cada idea y así resolver los datos del aviso de CADA asesora.
    fuentes, tpl = cargar_templates()
    biblio = json.loads((BASE / "copy_biblioteca.json").read_text(encoding="utf-8"))
    ideas = []
    for it in biblio["ideas"]:
        ref = it["template_ref"]
        ideas.append({**it, "tokens": tokens_de_idea(it, tpl), "paginas": len(tpl[ref]["pages"]),
                      "formato": "story" if ("stories/" in ref or "_story" in ref) else "post"})

    perfiles, dudosos = [], []
    for a in sorted(vivos, key=lambda x: (x.get("firstName") or "").strip()):
        pf = datos_broker(a["email"])
        props = pf.pop("_props", None) or {}
        agente = pf.pop("_agente", None) or {}
        # Los valores del aviso son POR ASESORA (su foto, su precio, su colonia), así que no
        # pueden vivir en `ideas`, que es compartida. Sin esto la pieza de cierre salía con un
        # rectángulo gris en lugar de la foto de la propiedad —y el botón decía "listo para
        # bajar"—. Se veía solo en el archivo del equipo, no en el de una sola asesora.
        pf["valores"], pf["fotos_aviso"], pf["fotos_urls"] = {}, {}, {}
        for it in ideas:
            if it.get("seccion") != "operacion":
                continue
            prop = props.get(it.get("clase"))
            if not prop:
                continue
            fotos = fotos_de_prop(db, prop)
            vals, fotos = tokens_de_propiedad(prop, agente, it["tokens"], fotos)
            ev = next((e for e in (pf.get("eventos") or [])
                       if e.get("clase") == it.get("clase")), None)
            vals.update(tokens_del_evento(ev))
            pf["valores"][it["id"]] = vals
            pf["fotos_aviso"][it["id"]] = len(fotos)
            pf["fotos_urls"][it["id"]] = fotos[:6]
        (perfiles if pf["total_publicados"] else dudosos).append(pf)
    if incluir_todos:
        perfiles = sorted(perfiles + dudosos, key=lambda x: x["nombre"]); dudosos = []
    face_css = "\n".join(f"@font-face{{font-family:'{f}';src:url({u});font-display:block;}}"
                         for f, u in fuentes.items())
    creators = json.loads((BASE / "ideas_creators.json").read_text(encoding="utf-8"))
    # Los hechos de zona salen de propertypois y son verificables: reemplazan las
    # afirmaciones inventadas que se imprimían idénticas para toda colonia.
    _filtro_zonas = {"status.last": "published",
                     "company.name": re.compile(re.escape(inmobiliaria), re.I)}
    _colonias = [c for c in db.properties.distinct(
        "address.neighborhood.name", _filtro_zonas) if c]
    hechos = zonas_pois.hechos_por_zona(db, _colonias, _filtro_zonas)
    # En modo en vivo el archivo sale SIN los perfiles: es lo que cierra la fuga. Se conserva
    # el conteo para el reporte de la consola, pero al HTML no llega ninguno.
    publicados = perfiles
    if en_vivo:
        perfiles = []
    datos = {"broker": None, "brokers": perfiles, "en_vivo": en_vivo,
             "equipo": inmobiliaria,
             # en modo en vivo el servidor decide quién es interno; la lista no viaja
             "internos": [] if en_vivo else INTERNOS, "semana": creators["ideas"],
             "templates": tpl, "ideas": ideas, "hechos_zona": hechos,
             "sin_diseno": biblio.get("ideas_sin_diseno", []),
             "cobertura": {"activos": 988, "con_foto_pct": 94,
                           "con_inventario": 490, "con_evento_30d": 169}}
    html = (PLANTILLA.replace("/*__FACES__*/", face_css)
                     .replace("/*__DATOS__*/", json.dumps(datos, ensure_ascii=False)))
    # Modo app: se va la explicación, el riel de anotaciones y el marco de teléfono.
    # Lo que abre el asesor tiene que ser el producto, no la presentación del producto.
    html = html.replace("</style>", CSS_APP, 1)
    salida_dummy = None
    _ = """
.tope,.riel,.pie{display:none}
.escena{padding:0;max-width:560px;margin:0 auto;gap:0}
/* min-height:0 es la clave: el layout de escritorio deja .tel con min-height:640px y eso GANA
   sobre height:100dvh. En cualquier teléfono con menos de 640px de alto util (iPhone SE, 12 mini,
   o cualquier iPhone con las barras de Safari abiertas) la barra de pestañas quedaba DEBAJO del
   borde de la pantalla, sin forma de llegar a ella. Medido en WebKit el 18-ago-2026. */
.tel{flex:1 1 auto;width:100%;max-width:none;border:0;border-radius:0;box-shadow:none;
  height:100vh;height:100dvh;min-height:0;position:static;overscroll-behavior:contain}
.vista{min-height:0}
/* el indicador de inicio del iPhone se come la franja de abajo */
.tabs{padding-bottom:env(safe-area-inset-bottom,0px)}
/* iOS infla el texto por su cuenta si no se le dice que no */
html{-webkit-text-size-adjust:100%}
/* blancos de toque de 44px: abajo de eso se falla el dedo */
.tel button{min-height:44px}
.tel .linkbtn{min-height:44px;display:inline-flex;align-items:center}
.tel .pager button{width:44px;height:44px}
.tel .tabs button{min-height:52px}
body{background:var(--superficie)}
@media (min-width:600px){
  body{background:var(--papel)}
  .escena{padding:24px 0}
  .tel{height:calc(100dvh - 48px);border:1px solid var(--gris-claro);border-radius:22px}
}
"""
    salida = Path(salida); salida.mkdir(parents=True, exist_ok=True)
    out = salida / "index.html"
    out.write_text(html, encoding="utf-8")
    return out, publicados, omitidos, dudosos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=DEMO)
    ap.add_argument("--app", action="store_true", help="modo app (sin explicación ni riel)")
    ap.add_argument("--equipo", help="genera un link por asesor de esa inmobiliaria")
    ap.add_argument("--salida", default="studio_piloto")
    ap.add_argument("--en-vivo", action="store_true",
                    help="el bundle NO lleva los perfiles: los pide a /api/studio/perfil")
    ap.add_argument("--incluir-todos", action="store_true",
                    help="no filtrar a quienes no tienen inventario publicado")
    a = ap.parse_args()

    if a.equipo:
        out, perfiles, omit, dud = construir_equipo(a.equipo, BASE / a.salida,
                                                    a.incluir_todos, a.en_vivo)
        sf = [p for p in perfiles if not p["foto"]]
        print(f"✓ {out.relative_to(BASE.parent)}  ({out.stat().st_size/1024/1024:.1f} MB)")
        print(f"  {len(perfiles)} asesores de {a.equipo}, un solo link para todos")
        if omit:
            print(f"\n  dormidas — llevan perfil igual, pero no las esperes ({len(omit)}):")
            for n, r in omit:
                print(f"    {n[:28]:30} {r}")
        if dud:
            print(f"\n  ⚠ fuera por no tener inventario publicado ({len(dud)}) — confirma con Ale:")
            for x in dud:
                print(f"    {x['nombre'][:26]:28} {x['email']}")
            print("    (si alguno sí publica contenido, corre con --incluir-todos)")
        if sf:
            print(f"\n  ⚠ sin foto ({len(sf)}): " + ", ".join(p["nombre"] for p in sf))
        return

    out, broker, n = construir(a.email, a.app)
    kb = out.stat().st_size / 1024
    print(f"✓ {out}  ({kb:.0f} KB)")
    print(f"  broker : {broker['nombre']} · {broker['inmobiliaria']} · {broker['rol']}")
    print(f"  zonas  : {', '.join(z['zona'] for z in broker['zonas'])}")
    print(f"  evento : {broker['evento']['tipo']} en {broker['evento']['colonia']} ({broker['evento']['cuando']})"
          if broker.get("evento") else "  evento : sin evento reciente → el banner no se muestra")
    print(f"  ideas  : {n}")


if __name__ == "__main__":
    main()
