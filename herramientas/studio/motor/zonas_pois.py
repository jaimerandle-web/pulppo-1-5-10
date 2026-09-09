#!/usr/bin/env python3
"""Hechos verificables de cada colonia, sacados de `propertypois`.

**Por qué existe.** Las piezas de zona traían afirmaciones inventadas y idénticas para toda
colonia: "Todo a pie y con la ciudad a diez minutos", "Demanda de renta constante todo el
año". Ale lo cachó con Jesús del Monte, y tenía razón: ahí el perfil real es Colegio El Roble
a 200 m, Plaza Victoria a 200 m, Walmart y Sam's a 300 m — **y ningún metro**. Es un suburbio
de coche, así que "todo a pie" era literalmente falso.

`propertypois` tiene 24,878 documentos, uno por aviso, con hasta ~19 POIs por categoría, cada
uno con nombre, dirección, distancia en km y calificación de Google. Cobertura sobre el
inventario publicado de Diamond House: **93%** (317 de 340 avisos).

**El principio: nombrar el lugar, no contar la categoría.** "Parque Hacienda El Ciervo a
300 m" es verificable; "8 áreas verdes cerca" depende de confiar en la etiqueta de Google, y
la etiqueta no aguanta. Por eso todo lo que sale de acá es un nombre propio con su distancia.

**Dos categorías se descartan enteras** (medido, no supuesto):

- **transport.** La etiqueta `(Metro)` miente: en Polanco aparece "Estación Torre Altiva
  (Metro)" y en Lomas del Chamizal "Estación Kilometro 14 (Metro)", que no existen como
  Metro. Y las entradas `(Transporte público)` son paradas de camión que Google nombra con
  el negocio de la esquina, así que salía "Farmacia San Pablo (Transporte público) a 600 m".
  Sin una whitelist de estaciones reales no se puede afirmar nada de transporte.
- **health**, salvo hospitales. Está dominado por farmacias y veterinarias; "Animalitos
  Hospital Veterinaria" pasaba el filtro de "hospital" por el nombre.

**Umbral de pertenencia.** Un POI entra sólo si lo ven al menos la mitad de los avisos de la
colonia (mínimo 2). Sin eso se cuela lo que está cerca de UNA dirección y no caracteriza a
la colonia.

**Decisión de Ale (9-sep):** los 5 de "los mejores lugares" se eligen por **cercanía**, no por
calificación — el argumento de la pieza es que se llega a pie. La calificación se guarda igual
en la salida por si el criterio cambia.
"""
import collections
import re
import statistics

# Se nombra a sí mismo como colegio, y no es educación superior ni militar: un papá que ve
# "Escuela Militar de Odontología" o "Saint Luke, Escuela de Medicina" no lee "buena oferta
# escolar", lee un error.
_COLEGIO = re.compile(r"^(colegio|escuela|instituto|liceo|kinder|preescolar)\b|\bschool\b", re.I)
_NO_COLEGIO = re.compile(r"\b(militar|medicina|odontolog|universidad|posgrado|idiomas|"
                         r"conducir|manejo|capacitaci[oó]n)\b", re.I)

# "SITIO PARQUES" es una base de taxis y "Paseo de la Reforma" una avenida: los dos entraban
# como área verde porque el nombre trae la palabra.
_VERDE = re.compile(r"^(parque|jard[íi]n|bosque|alameda|arboleda)\b", re.I)
# OJO con el `\b` de cierre: exige un no-carácter DESPUÉS del prefijo, así que `veterinari\b`
# no matchea "Veterinaria" ni `farmacia\b` matchea "FARMACIAS". Con el cierre puesto se
# colaban "Animalitos Hospital Veterinaria" como hospital y "FARMACIAS DEL AHORRO" como
# plaza. Los stems van SIN cierre; sólo las palabras completas lo llevan.
_NO_VERDE = re.compile(r"\b(sitio|estacionamiento|glorieta|veterinari|funerari)", re.I)

_HOSPITAL = re.compile(r"\b(hospital|centro m[eé]dico)\b", re.I)
_NO_HOSPITAL = re.compile(r"\b(veterinari|animalit|mascot|pet\b)", re.I)

# lo que se colo de salud dentro de shopping
_NO_TIENDA = re.compile(r"\b(farmacia|veterinari|[oó]ptic|dentist|consultori)", re.I)

# Una tienda de conveniencia no es un argumento de zona en este segmento. Las cadenas de
# comida rápida SÍ se dejan: Ale eligió cercanía, y si Toks es lo más cerca, es lo más cerca.
_NO_COMER = re.compile(r"\b(oxxo|7[- ]?eleven|circle k|extra|bowlero)\b", re.I)

# Para la pieza de desayuno: sólo lo que se nombra café, panadería o repostería. El dato NO
# distingue horario, así que "Ola Ceviche Oysters Wine & Bar" no puede salir como desayuno.
_DESAYUNO = re.compile(r"caf[eé]|panader|reposter|brunch|desayun|bakery|coffee|"
                       r"starbucks|cafeter", re.I)

CATEGORIAS = {
    "colegio": "education",
    "parque": "green_spaces",
    "tienda": "shopping",
    "hospital": "health",
    "comer": "food_drink",
    "desayuno": "food_drink",
}


def _acepta(clave, nombre):
    if clave == "colegio":
        return bool(_COLEGIO.search(nombre)) and not _NO_COLEGIO.search(nombre)
    if clave == "parque":
        return bool(_VERDE.search(nombre)) and not _NO_VERDE.search(nombre)
    if clave == "hospital":
        return bool(_HOSPITAL.search(nombre)) and not _NO_HOSPITAL.search(nombre)
    if clave == "tienda":
        return not _NO_TIENDA.search(nombre)
    if clave == "comer":
        return not _NO_COMER.search(nombre)
    if clave == "desayuno":
        return bool(_DESAYUNO.search(nombre)) and not _NO_COMER.search(nombre)
    return False


def distancia(km):
    """Metros redondeados a 50, o kilómetros con un decimal.

    A propósito NO se convierte a minutos caminando: la distancia de `propertypois` es en
    línea recta, así que "7 min" subestimaría la caminata real y sería una afirmación que no
    puedo sostener. El metraje es el dato; el tiempo sería una inferencia.
    """
    if km < 1:
        return f"{round(km * 1000 / 50) * 50:.0f} m"
    return f"{km:.1f} km".replace(".0 km", " km")


def _resumir(agg, docs):
    """De los POIs acumulados de una colonia al puñado que la caracteriza."""
    if not docs:
        return {}
    # Con dos avisos o más se exige consenso —el POI lo tiene que ver la mitad— para no
    # colar lo que está cerca de UNA dirección. Con un solo aviso no hay consenso posible y
    # exigirlo dejaba 69 de 112 colonias sin un solo hecho, o sea 14 de los 21 asesores con
    # alguna zona todavía en copy inventado. Un POI a 300 m del único aviso de esa colonia
    # sigue siendo un hecho verdadero de esa colonia, así que se acepta.
    corte = 1 if docs == 1 else max(2, docs * 0.5)
    out = collections.defaultdict(list)
    for (clave, _), a in agg.items():
        if a["n"] < corte or not a["d"]:
            continue
        out[clave].append((a["nombre"], statistics.median(a["d"]),
                           round(statistics.median(a["r"]), 1) if a["r"] else None))
    return {k: sorted(v, key=lambda x: x[1])[:6] for k, v in out.items()}


def _acumular(agg, pois):
    for clave, cat in CATEGORIAS.items():
        for p in (pois.get(cat) or []):
            nombre = " ".join(str(p.get("name") or "").split())
            if not nombre or not _acepta(clave, nombre):
                continue
            a = agg[(clave, p.get("id") or nombre)]
            a["nombre"], a["n"] = nombre, a["n"] + 1
            if isinstance(p.get("distance"), (int, float)):
                a["d"].append(p["distance"])
            r = p.get("rating")
            if isinstance(r, (int, float)) and r > 0:
                a["r"].append(r)


def hechos_de_colonia(db, ids_avisos):
    """{clave: [(nombre, km, rating), …]} — se conserva para probar una colonia sola."""
    agg = collections.defaultdict(lambda: {"d": [], "r": [], "n": 0, "nombre": ""})
    docs = 0
    for doc in db.propertypois.find({"property": {"$in": ids_avisos}}, {"pois": 1}):
        docs += 1
        _acumular(agg, doc.get("pois") or {})
    return _resumir(agg, docs)


def hechos_por_zona(db, colonias, filtro_avisos):
    """Un mapa colonia → hechos. Se comparte entre asesores: las colonias se repiten mucho
    entre los 22 perfiles y duplicarlo por asesor infla el archivo sin ganar nada.

    **Dos consultas, no dos por colonia.** La versión por colonia hacía 2×112 = 224 viajes a
    Mongo y el build pasaba de 40 s a más de diez minutos. Acá se traen los avisos una vez
    para armar el mapa aviso→colonia, y los POIs una vez para repartirlos.
    """
    colonias = {c for c in colonias if c}
    de_aviso = {}
    for p in db.properties.find(filtro_avisos, {"address.neighborhood.name": 1}):
        col = ((p.get("address") or {}).get("neighborhood") or {}).get("name")
        if col in colonias:
            de_aviso[p["_id"]] = col
    if not de_aviso:
        return {}

    aggs = collections.defaultdict(
        lambda: collections.defaultdict(lambda: {"d": [], "r": [], "n": 0, "nombre": ""}))
    cuenta = collections.Counter()
    for doc in db.propertypois.find({"property": {"$in": list(de_aviso)}}, {"property": 1,
                                                                            "pois": 1}):
        col = de_aviso.get(doc.get("property"))
        if not col:
            continue
        cuenta[col] += 1
        _acumular(aggs[col], doc.get("pois") or {})

    salida = {}
    for col, agg in aggs.items():
        h = _resumir(agg, cuenta[col])
        if h:
            salida[col] = {k: [{"nombre": n, "dist": distancia(d), "km": round(d, 3),
                                "rating": r} for n, d, r in v]
                           for k, v in h.items()}
    return salida


# ---------------------------------------------------------------------------
# Los tokens que las piezas pueden pedir. `{colegio}` es el más cercano de esa colonia;
# `{comer_1}`…`{comer_5}` son la lista. Si la colonia no tiene el hecho, el token queda
# vacío y el editor lo reporta como campo faltante en vez de imprimir una mentira.
# ---------------------------------------------------------------------------
def tokens_de_zona(h):
    if not h:
        return {}
    t = {}
    for clave in ("colegio", "parque", "tienda", "hospital", "comer", "desayuno"):
        v = h.get(clave) or []
        if v:
            t[clave] = f"{v[0]['nombre']} a {v[0]['dist']}"
            t[f"{clave}_nombre"] = v[0]["nombre"]
            t[f"{clave}_dist"] = v[0]["dist"]
        for i, x in enumerate(v[:5], 1):
            t[f"{clave}_{i}"] = f"{x['nombre']} · {x['dist']}"
    return t


# La pieza de desayuno sólo existe donde de verdad hay cinco: es la decisión de Ale del 9-sep,
# y es la única forma de que "los 5 mejores lugares para desayunar" no invente dos.
def tiene_desayuno(h):
    return len((h or {}).get("desayuno") or []) >= 5
