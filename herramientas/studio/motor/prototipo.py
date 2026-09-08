#!/usr/bin/env python
"""
Pulppo Studio — prototipo end-to-end del motor de ideas (paso 4 de PROCESO.md).
Recorre el flujo completo SIN UI: perfil → ideas → copy → autofill → JSON Polotno final.

Uso:
  # 1. ver el perfil que se pre-llena solo desde Mongo
  python prototipo.py perfil --email viola.prat@pulppo.com

  # 2. proponer ideas (motor híbrido: semillas curadas + personalización)
  python prototipo.py ideas --email viola.prat@pulppo.com --categoria consejo

  # 3. generar la pieza final (autofill del JSON de Polotno)
  python prototipo.py pieza --email viola.prat@pulppo.com --idea consejo:0 \
      --copy salidas/copy_ejemplo.json

La capa de IA (paso 4 del flujo) está desacoplada en generar_copy():
  - con ANTHROPIC_API_KEY en el entorno → llama a Claude con prompt_personalizacion.md
  - sin key → lee los valores de un JSON (--copy), que es como se prueba hoy

Read-only sobre Mongo. Nunca escribe en la base.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAIZ = BASE.parent
TEMPLATES_DIR = RAIZ / "contenido-valor"
SALIDAS = BASE / "salidas"
URI_FILE = Path.home() / "Downloads" / "mongo_uri.txt"

# Base real de Studio: brokers que de verdad usan la plataforma.
# type 'broker' es un tipo legacy casi 100% inactivo — NO usarlo.
FILTRO_ACTIVOS = {
    "type": {"$in": ["associate", "master"]},
    "status": "active",
    "deletedAt": None,
}


# ---------------------------------------------------------------- 0. conexión
def get_db():
    from pymongo import MongoClient
    # el archivo trae BOM → utf-8-sig o la URI queda corrupta
    uri = URI_FILE.read_text(encoding="utf-8-sig").strip()
    return MongoClient(uri).pulppo


# ------------------------------------------------- 1. PERFIL (autofill broker)
def cargar_perfil(email, db=None, n_zonas=5):
    """Pre-llena el perfil desde Mongo. Devuelve los tokens {{broker.*}}/{{company.*}}
    + zonas sugeridas desde el inventario real del broker."""
    db = db or get_db()
    ag = db.agents.find_one(
        {**FILTRO_ACTIVOS, "email": email},
        {"firstName": 1, "lastName": 1, "phone": 1, "personal": 1,
         "profilePicture": 1, "company": 1, "email": 1},
    )
    if not ag:
        sys.exit(f"✗ No hay broker ACTIVO con email {email}\n"
                 f"  (puede existir pero estar inactive/deleted → no es base de Studio)")

    company = ag.get("company") or {}
    # personal.phone tiene mejor cobertura (97%) que phone (73%) → va primero
    tel = (ag.get("personal") or {}).get("phone") or ag.get("phone") or ""

    perfil = {
        "broker_id": str(ag["_id"]),
        "email": ag.get("email", ""),
        "tokens": {
            "broker.name": f"{ag.get('firstName','')} {ag.get('lastName','')}".strip(),
            "broker.phone": tel,
            "broker.photo": ag.get("profilePicture") or "",
            "company.name": company.get("name") or "",
            "company.logo": ((company.get("logo") or {}).get("default")) or "",
        },
        # se pregunta en el alta — socialMedia NO trae el handle de Instagram
        "por_preguntar": {"broker.handle": "", "tono": "", "emojis": "", "cta": ""},
    }

    faltantes = [k for k, v in perfil["tokens"].items() if not v]
    perfil["faltantes"] = faltantes
    perfil["zonas_sugeridas"] = zonas_de_inventario(email, db, n_zonas)
    perfil["tipo_propiedad_sugerido"] = tipos_de_inventario(email, db)
    perfil["fotos_inventario"] = fotos_de_inventario(email, db)
    return perfil


def zonas_de_inventario(email, db, n=5):
    """[IDEAS] Pre-sugiere las zonas cruzando el inventario publicado del broker,
    para que en el alta solo confirme en vez de escribir."""
    cur = db.properties.find(
        {"agent.email": email, "status.last": "published"},
        {"address.neighborhood.name": 1, "address.city.name": 1},
    )
    c = Counter()
    for p in cur:
        a = (p.get("address") or {})
        col = ((a.get("neighborhood") or {}).get("name") or "").strip()
        ciudad = ((a.get("city") or {}).get("name") or "").strip()
        if col:
            c[(col, ciudad)] += 1
    return [{"zona": z, "ciudad": ciu, "avisos": n_} for (z, ciu), n_ in c.most_common(n)]


def fotos_de_inventario(email, db, por_zona=8):
    """4 de los 12 templates tienen un slot de imagen a sangre (foto.lugar / foto.fondo /
    foto.zona) que ni el perfil ni la IA pueden llenar. Solución: usar las fotos del
    inventario propio del broker, indexadas por colonia."""
    cur = db.properties.find(
        {"agent.email": email, "status.last": "published"},
        {"pictures": 1, "address.neighborhood.name": 1},
    )
    por_colonia = {}
    for p in cur:
        col = (((p.get("address") or {}).get("neighborhood") or {}).get("name") or "").strip()
        buenas = [pic["url"] for pic in (p.get("pictures") or [])
                  if pic.get("url") and pic.get("public") and not pic.get("is_blueprint")]
        if col and buenas:
            por_colonia.setdefault(col, [])
            por_colonia[col].extend(buenas[:por_zona])
    return por_colonia


def tipos_de_inventario(email, db):
    cur = db.properties.find({"agent.email": email, "status.last": "published"}, {"type": 1})
    c = Counter((p.get("type") or "").strip() for p in cur if p.get("type"))
    return [t for t, _ in c.most_common(3)]


# --------------------------------------------------------- 2. MOTOR DE IDEAS
def cargar_semillas():
    return json.loads((BASE / "semillas_ideas.json").read_text(encoding="utf-8"))


def cargar_templates():
    return {t["ref"]: t for t in json.loads((BASE / "templates.json").read_text(encoding="utf-8"))}


def proponer_ideas(perfil, categoria=None, n=3):
    """Híbrido: toma semillas curadas y las aterriza al perfil. Devuelve el Idea[]
    del contrato, con el payload exacto que consume la capa de IA."""
    semillas = cargar_semillas()
    templates = cargar_templates()
    cats = [categoria] if categoria else list(semillas.keys())

    zona_top = perfil["zonas_sugeridas"][0] if perfil["zonas_sugeridas"] else {}
    ideas = []
    for cat in cats:
        if cat not in semillas:
            sys.exit(f"✗ categoría '{cat}' no existe. Opciones: {', '.join(semillas)}")
        for i, s in enumerate(semillas[cat][:n]):
            tpl = templates.get(s["template"])
            if not tpl:
                sys.exit(f"✗ semilla '{s['semilla']}' apunta a un template inexistente: {s['template']}")
            titulo = s["patron"]
            if zona_top:
                titulo = titulo.replace("{zona}", zona_top.get("zona", "{zona}"))
                titulo = titulo.replace("{ciudad}", zona_top.get("ciudad", "{ciudad}"))
            ideas.append({
                "id": f"{cat}:{i}",
                "categoria": cat,
                "formato": tpl["formato"],
                "titulo_idea": titulo,
                "semilla": s["semilla"],
                "template_ref": tpl["ref"],
                "campos": tpl["blank_spaces"],
                "tokens_perfil": tpl.get("tokens_perfil", []),
            })
    return ideas


# ------------------------------------------------------- 3. CAPA DE IA (copy)
def payload_para_ia(perfil, idea, n_ideas=1):
    """Arma el input exacto que documenta prompt_personalizacion.md."""
    return {
        "perfil": {
            "name": perfil["tokens"]["broker.name"],
            "zonas": [z["zona"] for z in perfil["zonas_sugeridas"]],
            "tipo_propiedad": perfil["tipo_propiedad_sugerido"],
            "tono": perfil["por_preguntar"].get("tono") or "cercano-profesional",
        },
        "semilla": {"categoria": idea["categoria"], "patron": idea["semilla"],
                    "template": idea["template_ref"]},
        "n_ideas": n_ideas,
        "template_campos": [{"token": t, "label": t.replace("_", " ").capitalize()}
                            for t in idea["campos"]],
    }


def generar_copy(perfil, idea, copy_file=None):
    """Paso 4 del flujo. Desacoplado a propósito: hoy se prueba con --copy,
    mañana se cambia por la llamada real sin tocar el resto del pipeline."""
    if copy_file:
        d = json.loads(Path(copy_file).read_text(encoding="utf-8"))
        # la IA puede devolver el título ya aterrizado ("Los mejores rincones de Polanco")
        # en vez del patrón de la semilla ("Los mejores {lugar} de Polanco")
        if d.get("titulo_idea"):
            idea["titulo_idea"] = d["titulo_idea"]
        return d.get("valores_sugeridos", d), d.get("caption_sugerida", "")

    if os.environ.get("ANTHROPIC_API_KEY"):
        return _generar_copy_api(perfil, idea)

    p = SALIDAS / f"_payload_{idea['id'].replace(':', '-')}.json"
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(payload_para_ia(perfil, idea), ensure_ascii=False, indent=2),
                 encoding="utf-8")
    sys.exit(f"✗ Falta el copy. No hay ANTHROPIC_API_KEY y no pasaste --copy.\n"
             f"  Payload para la IA escrito en: {p}\n"
             f"  Pasá el resultado con: --copy <archivo.json>")


def _generar_copy_api(perfil, idea):
    import anthropic  # solo si hay key
    md = (BASE / "prompt_personalizacion.md").read_text(encoding="utf-8")
    system = md.split("```")[1].strip() if "```" in md else md
    payload = payload_para_ia(perfil, idea)
    r = anthropic.Anthropic().messages.create(
        model="claude-opus-4-5",
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    txt = r.content[0].text.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.M).strip()
    d = json.loads(txt)
    primera = d["ideas"][0] if "ideas" in d else d
    if primera.get("titulo_idea"):
        idea["titulo_idea"] = primera["titulo_idea"]
    return primera.get("valores_sugeridos", {}), primera.get("caption_sugerida", "")


# ---------------------------------------------------- 3b. GUARDRAILS de marca
EMOJI = re.compile("[" "\U0001F300-\U0001FAFF" "\U00002600-\U000027BF" "\U0001F1E6-\U0001F1FF" "]")


def validar_marca(valores, caption, permitir_emojis=False):
    """Reglas duras de prompt_personalizacion.md, chequeadas ANTES de mostrar al broker."""
    avisos = []
    for k, v in list(valores.items()) + [("caption", caption)]:
        if not isinstance(v, str) or not v.strip():
            avisos.append(f"{k}: vacío")
            continue
        if not permitir_emojis and EMOJI.search(v):
            avisos.append(f"{k}: trae emoji")
        # sentence case: no TODO EN MAYÚSCULAS (salvo siglas cortas)
        letras = [c for c in v if c.isalpha()]
        if len(letras) > 6 and all(c.isupper() for c in letras):
            avisos.append(f"{k}: está en MAYÚSCULAS (la marca usa sentence case)")
        if "{{" in v:
            avisos.append(f"{k}: quedó un token sin resolver ({v})")
    return avisos


# ------------------------------------------------------------- 4/5. AUTOFILL
def autofill(template_ref, valores, perfil, estricto=True):
    """Reemplaza los {{tokens}} del JSON de Polotno. Los tokens de perfil salen de
    Mongo; los blank spaces, del copy. Devuelve (json_final, tokens_sin_resolver)."""
    ruta = TEMPLATES_DIR / template_ref
    if not ruta.exists():
        sys.exit(f"✗ template no encontrado: {ruta}")
    doc = json.loads(ruta.read_text(encoding="utf-8"))

    mapa = dict(perfil["tokens"])
    mapa.update({k: v for k, v in perfil["por_preguntar"].items() if v})
    mapa.update(valores)

    presentes = set(re.findall(r"\{\{([^}]+)\}\}", json.dumps(doc, ensure_ascii=False)))

    def sustituir(nodo):
        if isinstance(nodo, dict):
            return {k: sustituir(v) for k, v in nodo.items()}
        if isinstance(nodo, list):
            return [sustituir(v) for v in nodo]
        if isinstance(nodo, str) and "{{" in nodo:
            def rep(m):
                t = m.group(1).strip()
                return str(mapa[t]) if mapa.get(t) else m.group(0)
            return re.sub(r"\{\{([^}]+)\}\}", rep, nodo)
        return nodo

    final = sustituir(doc)
    sin_resolver = sorted(t for t in presentes if not mapa.get(t.strip()))
    if sin_resolver and estricto:
        print(f"  ⚠ tokens sin resolver: {sin_resolver}", file=sys.stderr)

    slots = llenar_slots(final, perfil, valores)
    return final, sin_resolver, slots


# Los templates traen un SEGUNDO contrato además de los {{tokens}}: elementos con `name`
# que son slots de imagen. No están en blank_spaces y hay que resolverlos aparte.
SLOTS_FOTO_LIBRE = {"foto.lugar", "foto.fondo", "foto.zona"}


def llenar_slots(doc, perfil, valores):
    """Rellena los slots por nombre: la foto del broker, el logo y la imagen a sangre.
    Devuelve el detalle de qué se llenó y qué quedó como placeholder."""
    zona = (valores.get("zona") or "").strip()
    fotos = perfil.get("fotos_inventario") or {}
    # foto de la zona de la pieza; si no hay, cualquiera de su inventario
    candidatas = fotos.get(zona) or [u for us in fotos.values() for u in us]
    detalle = []

    for pg in doc.get("pages", []):
        for c in pg.get("children", []):
            nombre = c.get("name") or ""
            if not nombre:
                continue

            if nombre == "broker.photo":
                url = perfil["tokens"].get("broker.photo")
                if url:
                    # el template lo trae como `figure` (círculo gris placeholder);
                    # para que muestre la foto hay que convertirlo en `image`
                    c["type"] = "image"
                    c["src"] = url
                    c.pop("subType", None)
                    detalle.append(("broker.photo", "foto del broker"))
                else:
                    detalle.append(("broker.photo", "⚠ SIN FOTO → queda el círculo gris"))

            elif nombre == "pulppo.logo":
                propio = perfil["tokens"].get("company.logo")
                if propio and perfil["por_preguntar"].get("logo_propio"):
                    c["src"] = propio
                    detalle.append(("pulppo.logo", "logo de la inmobiliaria"))
                else:
                    detalle.append(("pulppo.logo", "logo de Pulppo (default)"))

            elif nombre in SLOTS_FOTO_LIBRE:
                if candidatas:
                    c["src"] = candidatas[0]
                    de = "de la zona" if fotos.get(zona) else "de su inventario (otra zona)"
                    detalle.append((nombre, f"foto {de}"))
                else:
                    detalle.append((nombre, "⚠ SIN FOTO → el broker debe subir una"))

    return detalle


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]


# ------------------------------------------------------------------ comandos
def cmd_perfil(a):
    p = cargar_perfil(a.email)
    print(f"\n=== PERFIL · {p['tokens']['broker.name']} ({p['email']}) ===")
    print("\n[AUTOFILL] pre-llenado desde Mongo, el broker solo confirma:")
    for k, v in p["tokens"].items():
        marca = "✓" if v else "✗ FALTA"
        print(f"  {marca:7} {{{{{k}}}}} = {str(v)[:72]}")
    print("\n[IDEAS] zonas sugeridas desde su inventario publicado:")
    if p["zonas_sugeridas"]:
        for z in p["zonas_sugeridas"]:
            print(f"     • {z['zona']} ({z['ciudad']}) — {z['avisos']} avisos")
    else:
        print("     — sin inventario publicado → hay que preguntarle las zonas")
    print(f"     tipo de propiedad: {', '.join(p['tipo_propiedad_sugerido']) or '—'}")
    print("\n[PREGUNTAR] lo único que Pulppo no sabe:")
    print("     handle de Instagram · tono · emojis sí/no · CTA preferido")
    if p["faltantes"]:
        print(f"\n  ⚠ cae al alta como 'completar': {', '.join(p['faltantes'])}")


def cmd_ideas(a):
    p = cargar_perfil(a.email)
    ideas = proponer_ideas(p, a.categoria, a.n)
    print(f"\n=== {len(ideas)} IDEAS para {p['tokens']['broker.name']} ===")
    for i in ideas:
        print(f"\n[{i['id']}] {i['titulo_idea']}")
        print(f"     categoría {i['categoria']} · {i['formato']} · → {i['template_ref']}")
        print(f"     completa: {', '.join(i['campos'])}")
    print(f"\nGenerá una con:  python prototipo.py pieza --email {a.email} --idea <id>")


def cmd_pieza(a):
    p = cargar_perfil(a.email)
    ideas = {i["id"]: i for i in proponer_ideas(p, None, 99)}
    idea = ideas.get(a.idea)
    if not idea:
        sys.exit(f"✗ idea '{a.idea}' no existe. Disponibles: {', '.join(list(ideas)[:12])}…")

    print(f"\n=== PIEZA · {idea['titulo_idea']} ===")
    print(f"  1. perfil      ✓ {p['tokens']['broker.name']}")
    print(f"  2/3. idea      ✓ {idea['id']} → {idea['template_ref']} ({idea['formato']})")

    valores, caption = generar_copy(p, idea, a.copy)
    print(f"  4. copy (IA)   ✓ {len(valores)} blank spaces")

    faltan = [c for c in idea["campos"] if c not in valores]
    if faltan:
        print(f"     ⚠ el copy no cubrió: {', '.join(faltan)}")

    avisos = validar_marca(valores, caption, a.permitir_emojis)
    print(f"  4b. guardrails {'✓ pasa' if not avisos else '⚠ ' + str(len(avisos)) + ' avisos'}")
    for x in avisos:
        print(f"       - {x}")

    final, sin_resolver, slots = autofill(idea["template_ref"], valores, p)
    print(f"  5. autofill    {'✓ sin tokens pendientes' if not sin_resolver else '⚠ pendientes: ' + ', '.join(sin_resolver)}")
    for nombre, qué in slots:
        print(f"     slot {nombre:14} {qué}")

    SALIDAS.mkdir(exist_ok=True)
    nombre = f"{slug(p['tokens']['broker.name'])}_{slug(idea['titulo_idea'])}"
    fjson = SALIDAS / f"{nombre}.json"
    fjson.write_text(json.dumps(final, ensure_ascii=False), encoding="utf-8")
    meta = {
        "broker_id": p["broker_id"], "email": p["email"], "idea_id": idea["id"],
        "titulo_idea": idea["titulo_idea"], "template_ref": idea["template_ref"],
        "formato": idea["formato"], "valores": valores, "caption": caption,
        "estado": "listo_para_editar" if not (sin_resolver or avisos) else "revisar",
        "tokens_sin_resolver": sin_resolver, "avisos_marca": avisos,
        "slots_imagen": [{"slot": n, "resultado": q} for n, q in slots],
    }
    fmeta = SALIDAS / f"{nombre}_pieza.json"
    fmeta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"  6. entrega     ✓ {fjson.name} ({fjson.stat().st_size/1024:.0f} KB, abrir en Polotno)")
    print(f"                   {fmeta.name} (registro de la pieza)")
    print(f"\n  Caption: {caption}")
    print(f"  Estado: {meta['estado']}")


def main():
    ap = argparse.ArgumentParser(description="Prototipo end-to-end de Pulppo Studio")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("perfil", help="ver el perfil pre-llenado desde Mongo")
    s.add_argument("--email", required=True)
    s.set_defaults(f=cmd_perfil)

    s = sub.add_parser("ideas", help="proponer ideas para el broker")
    s.add_argument("--email", required=True)
    s.add_argument("--categoria")
    s.add_argument("--n", type=int, default=3)
    s.set_defaults(f=cmd_ideas)

    s = sub.add_parser("pieza", help="generar la pieza final (JSON de Polotno)")
    s.add_argument("--email", required=True)
    s.add_argument("--idea", required=True)
    s.add_argument("--copy", help="JSON con valores_sugeridos (si no hay API key)")
    s.add_argument("--permitir-emojis", action="store_true")
    s.set_defaults(f=cmd_pieza)

    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
