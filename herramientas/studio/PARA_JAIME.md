# Studio dentro de 1·5·10 — qué haría falta

Para Jaime. Escrito leyendo el código de `pulppo-1-5-10`, así que la propuesta sigue los patrones
que ya están ahí en vez de inventar otros. Nada de esto está hecho todavía: es para que digas si va.

---

## Contexto en tres líneas

**Pulppo Studio** le sugiere a cada asesor qué publicar y le entrega la pieza lista para bajar
(diseños de Polotno rellenados con su perfil, sus zonas, sus fotos y sus hechos de operación).

Está corriendo un **piloto con Diamond House — 19 asesores — como sitio estático aparte**, fuera de
1·5·10, justamente para no tocar nada tuyo mientras validamos si lo usan. Si el piloto sale bien,
el lugar natural de Studio es adentro de 1·5·10, y ahí sí necesitamos una mano.

---

## El problema: los asesores no pueden entrar

Hoy `POST /api/auth/login` deja pasar a dos grupos:

- **Interno** (equipo Pulppo) por `isAllowed(mail)`
- **Externo**: master broker, vía `masterCompanyForEmail` → `type: 'master'` + `status: 'active'` + `company._id`

Cualquier otro recibe `403 · "Tu email no tiene acceso. Pedí que te agreguen al equipo."`

En Diamond House eso es **1 master y 21 associates**. Studio es una herramienta para el asesor, así
que con el login actual entraría el titular y nadie más.

---

## La propuesta: un tercer tipo de usuario, calcado del que ya existe

No hace falta abrir nada: el patrón del master broker ya resuelve exactamente este problema —
identidad verificada, cookie de ruteo, y la barrera real recalculada server-side. Solo hay que
repetirlo para un rol más, encerrado en una sola ruta.

| | Master broker (hoy) | Asesor (propuesta) |
|---|---|---|
| Quién | `type: 'master'` activo con company | `type: 'associate'` activo con company |
| Cookie de ruteo | `cm-company` | `cm-asesor` |
| Dónde puede estar | `/mb/{company}` y sus APIs | **solo `/studio`** y sus APIs |
| Barrera real | `canAccessCompany` server-side | `asesorActual()` server-side |

### Los cambios, archivo por archivo

**`src/lib/companyAccess.ts`** — agregar `asesorForEmail(email)`, gemelo de `masterCompanyForEmail`
pero con `type: 'associate'`. Devuelve el `_id` del agente (no el de la company: el asesor se ve a
sí mismo, no a su inmobiliaria). Misma `collation` para que el match de email no dependa de mayúsculas.

**`src/app/api/auth/login/route.ts`** — después de descartar interno y master, probar asesor:

```ts
const internal  = isAllowed(mail);
const companyId = internal ? null : await masterCompanyForEmail(mail);
const asesorId  = (internal || companyId) ? null : await asesorForEmail(mail);
if (!internal && !companyId && !asesorId) return 403…
…
if (asesorId) store.set('cm-asesor', asesorId, opts); else store.delete('cm-asesor');
return Response.json({ ok: true, email: mail, companyId, asesorId });
```

Y en `login/page.tsx`, el redirect: `d.asesorId ? '/studio' : (d.companyId ? \`/mb/${d.companyId}\` : '/')`.

**`src/middleware.ts`** — un bloque más, con la misma forma que el de `cm-company`:

```ts
const asesor = req.cookies.get('cm-asesor')?.value || '';
if (validId && asesor) {
    const p = req.nextUrl.pathname;
    if (p === '/studio' || p.startsWith('/studio/') || p.startsWith('/api/studio')) return NextResponse.next();
    if (p.startsWith('/api')) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const url = req.nextUrl.clone(); url.pathname = '/studio'; url.search = '';
    return NextResponse.redirect(url);
}
```

Va **después** del bloque de master y **antes** del redirect a `/login`. Sigue siendo Edge-safe:
solo lee cookies y valida la firma, sin tocar Mongo.

**`src/app/page.tsx`** — una entrada más en `PROYECTOS`, para que el equipo interno también lo vea:

```ts
{ href: '/studio', label: 'Studio', hint: 'Qué publicar hoy y la pieza lista para bajar' }
```

**`src/app/studio/page.tsx`** — la página. Recalcula el asesor server-side desde `cm-asesor` +
`cm-sig` y arma su perfil desde `agents` y `properties`; **nunca confía en la cookie sola**, igual que
`canAccessCompany`. Esa parte la traemos nosotros, ya está escrita y probada contra Mongo.

---

## Lo que NO cambia

- El acceso interno por allowlist queda igual.
- El master broker sigue encerrado en `/mb/{company}`; no gana ni pierde nada.
- El `matcher` del middleware no se toca: `/studio` queda protegido como todo lo demás. **No
  necesitamos que abras ninguna ruta al público** — precisamente porque el asesor va a tener login.
- El token de ficha sigue funcionando igual.

---

## Por qué vale la pena aunque suene a más trabajo

Con login de asesor **desaparecen tres parches** que hoy necesitamos para el piloto: el selector de
"¿quién eres?", los links con token por persona, y el hecho de que la data del equipo viva en una
URL pública. La identidad sale gratis y el resto se simplifica solo.

---

## Tamaño y riesgo

Los cambios de auth y ruteo son **cuatro archivos y unas 40 líneas**, todas siguiendo un patrón que
ya existe y ya está probado en producción con los master brokers. La página de Studio la ponemos
nosotros.

El riesgo que sí quiero señalar: es autenticación en producción. Si prefieres, se puede hacer en dos
pasos — primero `asesorForEmail` + la cookie sin ningún permiso nuevo (nadie nota nada), y el bloque
del middleware en un segundo PR, ya con la página lista para probar contra un asesor real.

Cualquier cosa que no cuadre con cómo pensaste la app, dilo: la leí de afuera y seguro hay razones
que no se ven desde el código.
