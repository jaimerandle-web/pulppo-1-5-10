#!/usr/bin/env python3
"""Etiqueta con visión cada foto del inventario y guarda la etiqueta en caché.

**Por qué existe.** Ale pidió que el selector de imágenes nunca ofrezca fotos de baño y
sólo muestre fachada, comedor, sala, recámaras y amenidades. Con texto no se puede: el 95%
de las fotos de Diamond House traen `description`, pero sólo el 4% nombra el espacio, así
que el filtro por palabras atrapa 2 de 7,741. La única forma de cumplir el "nunca" es mirar
la imagen una vez, guardar la etiqueta, y que el generador lea la etiqueta.

**Se corre una vez y queda.** La caché (`fotos_etiquetas.json`) es la salida real: se
guarda por URL, así que volver a correrlo sólo clasifica lo nuevo. Si se interrumpe, se
retoma donde iba.

**Dos modos.**

    --vivo 20     mira 20 fotos ahora mismo y las imprime. Para revisar la calidad de las
                  etiquetas antes de gastar en el lote completo.
    (sin flag)    manda todo por la API de lotes: la mitad de precio, sin límite de tiempo.
                  Espera hasta que termina y escribe la caché.

**Requisitos.** `pip install anthropic` en el intérprete de Mongo, y la llave en el
entorno (`ANTHROPIC_API_KEY`) o un perfil de `ant auth login`. En esta mac no hay ninguna
de las dos, así que este archivo se escribió pero no se corrió.

    /Users/alebonilla/Documents/Pulppo/.venv-mongo/bin/python clasificar_fotos.py --vivo 20
    /Users/alebonilla/Documents/Pulppo/.venv-mongo/bin/python clasificar_fotos.py
"""
import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request
from pymongo import MongoClient

BASE = Path(__file__).resolve().parent
CACHE = BASE / "fotos_etiquetas.json"
URI = Path.home() / "Downloads" / "mongo_uri.txt"
MODELO = "claude-opus-5"

# La taxonomía es cerrada a propósito: el generador decide con ella qué ofrecer y qué
# esconder, así que una etiqueta libre ("estancia amplia") no serviría para filtrar.
ESPACIOS = [
    "fachada", "sala", "comedor", "cocina", "recamara", "bano", "amenidad",
    "alberca", "terraza", "jardin", "estacionamiento", "servicio", "plano",
    "render", "otro",
]

# Lo que el selector puede ofrecer. Todo lo demás queda fuera: `bano` y `servicio`
# (lavandería, closet, cuarto de servicio) porque Ale las nombró, `cocina` porque no está
# en su lista, y `plano` porque un plano de arquitectura no es una foto de la propiedad.
OFRECIBLES = ["fachada", "sala", "comedor", "recamara", "amenidad", "alberca",
              "terraza", "jardin", "render"]

ESQUEMA = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "espacio": {"type": "string", "enum": ESPACIOS},
            "seguro": {"type": "boolean"},
        },
        "required": ["espacio", "seguro"],
        "additionalProperties": False,
    },
}

INSTRUCCION = (
    "Clasifica el espacio principal que muestra esta foto de una propiedad inmobiliaria. "
    "Elige una sola etiqueta.\n"
    "- fachada: el exterior del edificio o la casa vista desde la calle.\n"
    "- amenidad: gimnasio, salón de usos múltiples, lobby, roof garden, área común.\n"
    "- servicio: lavandería, closet, vestidor, cuarto de servicio, bodega.\n"
    "- bano: cualquier baño o medio baño, incluso si sólo se ve el lavabo o el espejo.\n"
    "- plano: plano arquitectónico o layout, no una fotografía del espacio.\n"
    "- render: imagen generada por computadora de un espacio que todavía no existe.\n"
    "- otro: nada de lo anterior, o no se distingue el espacio.\n"
    "Pon seguro=false si dudas entre dos etiquetas o si la imagen está muy oscura, "
    "borrosa o cortada para saberlo. Ante la duda entre baño y otra cosa, elige bano."
)


def clave(url):
    """custom_id de la API de lotes: sólo [a-zA-Z0-9_-] y máximo 64 caracteres."""
    return "f" + hashlib.sha1(url.encode()).hexdigest()


def cliente():
    """Sin llave explícita: el SDK resuelve ANTHROPIC_API_KEY o el perfil de `ant auth`."""
    return anthropic.Anthropic()


def db():
    uri = URI.read_text(encoding="utf-8-sig").strip()
    return MongoClient(uri, serverSelectionTimeoutMS=20000).get_database("pulppo")


def fotos_del_inventario(base, inmobiliaria, por_aviso):
    """Las mismas fotos que el selector puede llegar a ofrecer, en el mismo orden.

    Incluye las del desarrollo porque `fotos_de_prop` las pone primero, así que son las
    que más se ven; clasificarlas sólo a ellas dejaría fuera justo las que más importan.
    """
    filtro = {"status.last": "published"}
    if inmobiliaria:
        filtro["company.name"] = re.compile(re.escape(inmobiliaria), re.I)
    urls, devs = [], set()
    for p in base.properties.find(filtro, {"pictures": 1, "development._id": 1}):
        d = p.get("development") or {}
        if isinstance(d, dict) and d.get("_id"):
            devs.add(d["_id"])
        n = 0
        for f in (p.get("pictures") or []):
            if not (f.get("url") and f.get("public") and not f.get("is_blueprint")):
                continue
            urls.append(f["url"])
            n += 1
            if n >= por_aviso:
                break
    for d in base.developments.find({"_id": {"$in": list(devs)}}, {"pictures": 1}):
        for x in (d.get("pictures") or [])[:por_aviso]:
            u = x.get("url") if isinstance(x, dict) else x
            if u:
                urls.append(u)
    vistas, unicas = set(), []
    for u in urls:
        if u not in vistas:
            vistas.add(u)
            unicas.append(u)
    return unicas


def peticion(url, modelo):
    """El mismo cuerpo para el modo vivo y para el lote, así no divergen.

    Se apaga el pensamiento y se baja el esfuerzo: clasificar un espacio no lo necesita y
    a este volumen la diferencia de costo es la que decide si el lote se corre o no. En
    Claude Opus 5 apagar el pensamiento sólo se permite hasta esfuerzo `high`, así que
    `low` es válido.
    """
    return dict(
        model=modelo,
        max_tokens=200,
        thinking={"type": "disabled"},
        output_config={"format": ESQUEMA, "effort": "low"},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "url", "url": url}},
            {"type": "text", "text": INSTRUCCION},
        ]}],
    )


def leer_cache():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def guardar_cache(cache):
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                     encoding="utf-8")


def etiqueta_de(msg):
    txt = next((b.text for b in msg.content if b.type == "text"), "")
    d = json.loads(txt)
    return {"espacio": d["espacio"], "seguro": bool(d["seguro"])}


def vivo(cli, urls, modelo, cache):
    for i, u in enumerate(urls, 1):
        try:
            r = cli.messages.create(**peticion(u, modelo))
        except anthropic.APIStatusError as e:
            print(f"  {i:>3}. error {e.status_code}: {u[-48:]}")
            continue
        if r.stop_reason == "refusal":
            print(f"  {i:>3}. rechazada: {u[-48:]}")
            continue
        e = etiqueta_de(r)
        cache[u] = {**e, "modelo": modelo}
        marca = " " if e["seguro"] else "?"
        print(f"  {i:>3}.{marca}{e['espacio']:<15} {u[-48:]}")
        guardar_cache(cache)


def por_lotes(cli, urls, modelo, cache):
    """Un lote por cada 100,000 peticiones; en la práctica cabe en uno."""
    for inicio in range(0, len(urls), 100000):
        tramo = urls[inicio:inicio + 100000]
        mapa = {clave(u): u for u in tramo}
        lote = cli.messages.batches.create(requests=[
            Request(custom_id=clave(u),
                    params=MessageCreateParamsNonStreaming(**peticion(u, modelo)))
            for u in tramo])
        print(f"  lote {lote.id} · {len(tramo)} fotos · esperando…")
        while True:
            b = cli.messages.batches.retrieve(lote.id)
            if b.processing_status == "ended":
                break
            c = b.request_counts
            print(f"    {c.succeeded} listas · {c.processing} en curso · {c.errored} con error")
            time.sleep(60)

        ok = malas = 0
        for res in cli.messages.batches.results(lote.id):
            u = mapa.get(res.custom_id)
            if not u:
                continue
            if res.result.type != "succeeded":
                malas += 1
                continue
            m = res.result.message
            if m.stop_reason == "refusal":
                malas += 1
                continue
            try:
                cache[u] = {**etiqueta_de(m), "modelo": modelo}
                ok += 1
            except (json.JSONDecodeError, KeyError, StopIteration):
                malas += 1
        guardar_cache(cache)
        print(f"  {ok} etiquetadas · {malas} sin etiqueta (se reintentan al volver a correr)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inmobiliaria", default="DIAMOND HOUSE",
                    help='nombre en company.name; vacío = todo el inventario publicado')
    ap.add_argument("--por-aviso", type=int, default=8,
                    help="cuántas fotos por aviso (el selector nunca ofrece más)")
    ap.add_argument("--vivo", type=int, metavar="N",
                    help="clasifica N fotos ahora y las imprime, en vez de mandar el lote")
    ap.add_argument("--modelo", default=MODELO)
    a = ap.parse_args()

    cache = leer_cache()
    urls = fotos_del_inventario(db(), a.inmobiliaria, a.por_aviso)
    faltan = [u for u in urls if u not in cache]
    print(f"{len(urls)} fotos en el inventario · {len(cache)} ya en caché · "
          f"{len(faltan)} por clasificar")
    if not faltan:
        resumen(cache, urls)
        return

    cli = cliente()
    if a.vivo:
        vivo(cli, faltan[:a.vivo], a.modelo, cache)
    else:
        por_lotes(cli, faltan, a.modelo, cache)
    resumen(cache, urls)


def resumen(cache, urls):
    cuenta = {}
    for u in urls:
        e = cache.get(u)
        if e:
            cuenta[e["espacio"]] = cuenta.get(e["espacio"], 0) + 1
        else:
            cuenta["(sin etiqueta)"] = cuenta.get("(sin etiqueta)", 0) + 1
    print(f"\n{CACHE.name}: {len(cache)} fotos")
    for k, v in sorted(cuenta.items(), key=lambda x: -x[1]):
        fuera = "" if k in OFRECIBLES else "   ← no se ofrece"
        print(f"  {k:<16} {v:>5}{fuera}")


if __name__ == "__main__":
    try:
        main()
    except anthropic.AuthenticationError:
        sys.exit("Falta la llave: exporta ANTHROPIC_API_KEY o corre `ant auth login`.")
