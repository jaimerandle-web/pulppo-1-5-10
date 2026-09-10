#!/usr/bin/env python3
"""Compara el perfil que calcula el Python contra el que devuelve `/api/studio/perfil`.

**Por qué existe.** El endpoint en TypeScript es un port de `datos_broker()`. Un port se
verifica comparando salidas, no leyendo las dos versiones y asintiendo: son ~200 líneas con
agrupación de colonias por clave normalizada, tres orígenes de eventos y una decena de
formatos. Este script recorre a los 22 asesores de Diamond House y marca cualquier campo que
difiera.

**Campos que se ignoran a propósito:**

- `cuando` ("ayer", "hace 7 días") — se recalcula contra el reloj de cada lado y puede caer
  en distinto día si la corrida cruza la medianoche. Lo que sí se compara es `fecha`.
- `eventos` fuera de la ventana de 30 días — el corte se toma en el instante de cada
  llamada, así que un evento de exactamente 30 días puede entrar en una y no en la otra.

**Cómo se corre.** Necesita el dev server arriba y la cookie de identidad firmada:

    cd wt-studio-api && npx next dev -p 3210
    ~/Documents/Pulppo/.venv-mongo/bin/python herramientas/studio/motor/comparar_perfil.py
"""
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

PUERTO = os.environ.get("PUERTO", "3210")
SECRETO = (os.environ.get("AUTH_SECRET") or os.environ.get("FICHA_SECRET")
           or "pulppo-1-5-10-auth")
INMOBILIARIA = os.environ.get("INMOBILIARIA", "DIAMOND HOUSE")

# se comparan sólo los campos que el endpoint promete; `_props`/`_agente` son internos del
# generador y nunca llegan al HTML
CAMPOS = ["email", "emails", "nombre", "pila", "foto", "telefono", "inmobiliaria", "logo",
          "rol", "zonas", "zonas_inmobiliaria", "tipos", "total_publicados", "evento",
          "eventos", "fotos_por_zona"]


def firma(email):
    """cm-sig = HMAC-SHA256('user:'+email, secreto) recortado a 32 — igual que token.ts."""
    return hmac.new(SECRETO.encode(), f"user:{email}".encode(),
                    hashlib.sha256).hexdigest()[:32]


def del_endpoint(email, tokens):
    # cm-asesor la exige el middleware para rutear al asesor; su valor no importa, la
    # barrera real es `currentAsesorId()` del lado del servidor
    cookie = f"cm-user={email}; cm-sig={firma(email)}; cm-asesor=x"
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"http://127.0.0.1:{PUERTO}/api/studio/perfil",
         "-H", f"Cookie: {cookie}", "-H", "Content-Type: application/json",
         "-d", json.dumps({"tokens": tokens})],
        capture_output=True, text=True, timeout=180)
    try:
        return json.loads(r.stdout).get("perfil")
    except json.JSONDecodeError:
        return {"_error": r.stdout[:300]}


def limpiar(v):
    """quita lo que legítimamente puede diferir entre dos relojes distintos"""
    if isinstance(v, dict):
        return {k: limpiar(x) for k, x in v.items() if k != "cuando"}
    if isinstance(v, list):
        return [limpiar(x) for x in v]
    return v


def difs(a, b, ruta=""):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += difs(a.get(k), b.get(k), f"{ruta}.{k}" if ruta else k)
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{ruta}: largo {len(a)} vs {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += difs(x, y, f"{ruta}[{i}]")
        return out
    if a != b:
        return [f"{ruta}: {a!r} vs {b!r}"]
    return []


def main():
    import gen_prototipo_web as G
    from pymongo import MongoClient

    db = MongoClient(G.URI_FILE.read_text(encoding="utf-8-sig").strip()).pulppo
    biblio = json.loads((BASE / "copy_biblioteca.json").read_text(encoding="utf-8"))
    _, tpl = G.cargar_templates()
    # los tokens que el cliente le manda al endpoint: por idea de operación, su clase y sus
    # tokens. Es exactamente lo que el bundle ya tiene en IDEAS[].tokens.
    tokens = {it["id"]: {"clase": it.get("clase"), "tokens": G.tokens_de_idea(it, tpl)}
              for it in biblio["ideas"] if it.get("seccion") == "operacion" and it.get("clase")}

    asesores = [a["email"] for a in db.agents.find(
        {**G.FILTRO_ACTIVOS, "company.name": re.compile(re.escape(INMOBILIARIA), re.I)},
        {"email": 1}) if a.get("email")]
    print(f"{len(asesores)} asesores de {INMOBILIARIA}\n")

    iguales, distintos, fallos = 0, [], []
    for email in sorted(asesores):
        try:
            py = G.datos_broker(email)
        except SystemExit:
            continue
        py.pop("_props", None)
        py.pop("_agente", None)
        ts = del_endpoint(email, tokens)
        if not ts or ts.get("_error"):
            fallos.append((email, (ts or {}).get("_error", "sin respuesta")))
            continue
        d = difs(limpiar({k: py.get(k) for k in CAMPOS}),
                 limpiar({k: ts.get(k) for k in CAMPOS}))
        if d:
            distintos.append((email, d))
            print(f"✗ {email}")
            for x in d[:8]:
                print(f"     {x[:150]}")
            if len(d) > 8:
                print(f"     … y {len(d)-8} más")
        else:
            iguales += 1
            print(f"✓ {email}")

    print(f"\n{iguales} idénticos · {len(distintos)} con diferencias · {len(fallos)} sin respuesta")
    for email, err in fallos:
        print(f"   ⚠ {email}: {err[:120]}")
    return 1 if distintos or fallos else 0


if __name__ == "__main__":
    sys.exit(main())
