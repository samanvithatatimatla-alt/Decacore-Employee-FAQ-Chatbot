# Turning on Microsoft Entra sign-in

**Entra sign-in is on.** All six steps below are complete and the deployed app runs on
real tokens — `GET /health` reports `"auth_mode":"entra"`. This document is now a record
of what was done and how to rebuild or roll it back, not a to-do list.

| | |
|---|---|
| Registration (steps 1–4) | done 2026-08-15 |
| Backend token validation verified | 2026-08-15 |
| Frontend MSAL flow rebuilt on React | commit `9e4adc9` |
| `AUTH_MODE=entra` live in production | 2026-08-18 |

The frontend integration was written for the old vanilla-JS client in commit `c9e9ec3`
and lost when the frontend became Vite + React. It was rebuilt in `9e4adc9`:
`@azure/msal-browser` is a dependency, `src/auth/entra.ts` owns the flow, and
`authHeaders()` in `src/api/client.ts` sends `Authorization: Bearer` whenever
`config.js` supplies all three `entra` values. With them absent it falls back to
`X-Dev-User-Email`, which is what keeps local development on `AUTH_MODE=dev` working.

If you are rebuilding this from scratch, the ordering constraint still holds: **do not
flip `AUTH_MODE` until step 5 has passed.** The backend rejects any token whose audience
does not match `ENTRA_AUDIENCE`, and there is no staging slot to catch a mistake, so
turning it on early locks every user out of the deployed app.

## The registration

| | |
|---|---|
| App registration | `DecaCore-HR-Chatbot` — client `efccb481-74ba-45b8-940a-fed5dfbec74e` |
| Tenant | `0eadb77e-42dc-47f8-bbe3-ec2395e0712c` (Quadrant Technologies LLC) |
| Registration owners | Nihitha Datla, Archit Jaiswal |
| Application ID URI | ✅ `api://efccb481-74ba-45b8-940a-fed5dfbec74e` |
| App roles | ✅ `Employee`, `Manager`, `Executive`, `HRAdmin` |
| Redirect URIs (`spa`) | ✅ Static Web App origin + `http://localhost:5173` |
| Exposed scope | ✅ `access_as_user`, self-pre-authorized (no consent prompt) |
| Users assigned to roles | ✅ Archit + Nihitha `HRAdmin`, Samanvitha `Manager`, Sanaa `Executive` |
| Enterprise app owners | Nihitha, Archit |

Being an owner of the *app registration* is not enough to assign users to roles.
Assignments live on the **enterprise application** (the service principal), which has
its own separate owners list. `POST /servicePrincipals/{id}/appRoleAssignedTo`
returns `Authorization_RequestDenied` for anyone who is not an owner *of the service
principal* or a tenant admin.

Note `appRoleAssignmentRequired` is **false**, so anyone in the tenant can sign in
even without an assignment — they simply arrive with an empty `roles` claim and the
backend defaults them to `Employee`. That is a usable demo posture, but it means
**nobody reaches the HR tools until at least one person is assigned `HRAdmin`**.

To re-check at any time:

```bash
az rest --method get \
  --uri "https://graph.microsoft.com/v1.0/applications(appId='efccb481-74ba-45b8-940a-fed5dfbec74e')" \
  --query "{uri:identifierUris, roles:appRoles[].value, spa:spa.redirectUris, scopes:api.oauth2PermissionScopes[].value}"

# who is assigned to a role
az rest --method get \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/6f8a11fa-4eb7-4832-a330-64b9b905febd/appRoleAssignedTo" \
  --query "value[].{who:principalDisplayName, role:appRoleId}"
```

## 1. Expose the API — done 2026-08-15

```bash
APP=efccb481-74ba-45b8-940a-fed5dfbec74e
az ad app update --id $APP --identifier-uris "api://$APP"
```

This is what makes `ENTRA_AUDIENCE=api://efccb481-...` — already set in the App
Service configuration — a valid audience.

## 2. Define the app roles — done 2026-08-15

The values must match exactly; the backend reads the `roles` claim and maps it
through `ROLE_ORDER` in `backend/app/auth.py`.

```bash
APP=efccb481-74ba-45b8-940a-fed5dfbec74e
cat > /tmp/approles.json <<'JSON'
[
  {"allowedMemberTypes":["User"],"description":"Standard employee","displayName":"Employee","isEnabled":true,"value":"Employee","id":"11111111-1111-1111-1111-111111111111"},
  {"allowedMemberTypes":["User"],"description":"People manager","displayName":"Manager","isEnabled":true,"value":"Manager","id":"22222222-2222-2222-2222-222222222222"},
  {"allowedMemberTypes":["User"],"description":"Executive","displayName":"Executive","isEnabled":true,"value":"Executive","id":"33333333-3333-3333-3333-333333333333"},
  {"allowedMemberTypes":["User"],"description":"HR administrator","displayName":"HRAdmin","isEnabled":true,"value":"HRAdmin","id":"44444444-4444-4444-4444-444444444444"}
]
JSON
az ad app update --id $APP --app-roles @/tmp/approles.json
```

Replace the placeholder ids with fresh GUIDs (`uuidgen`) if you prefer; they only
need to be unique and stable.

## 3. Register the SPA redirect URI — done 2026-08-15

The frontend signs in with a popup from the Static Web App origin, so it must be
registered as a **single-page application** redirect URI, not a web one — the SPA
flow uses PKCE and Entra rejects it from a `web` platform.

```bash
APP=efccb481-74ba-45b8-940a-fed5dfbec74e
az rest --method PATCH \
  --url "https://graph.microsoft.com/v1.0/applications(appId='$APP')" \
  --headers 'Content-Type=application/json' \
  --body '{"spa":{"redirectUris":[
      "https://delightful-tree-02eef901e.7.azurestaticapps.net",
      "http://localhost:5173"
  ]}}'
```

Keep `http://localhost:5173` so local development keeps working.

## 4. Assign users to roles — done 2026-08-15

Portal: **Entra ID → Enterprise applications → DecaCore-HR-Chatbot → Users and
groups → + Add user/group**, pick the person, pick the role.

Note the menu is *Enterprise applications*, not *App registrations* — they are two
views of the same app and role assignment only exists on the enterprise side.

**At minimum, assign one person to `HRAdmin`** or nobody can reach the HR tools.

Whoever does it needs to be an owner of the enterprise application or a tenant
admin. The cheapest unblock is adding Archit as an owner there, which is a different
list from the registration owners he was already added to:

```bash
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/6f8a11fa-4eb7-4832-a330-64b9b905febd/owners/\$ref" \
  --headers 'Content-Type=application/json' \
  --body '{"@odata.id":"https://graph.microsoft.com/v1.0/directoryObjects/374605c8-6563-4dfa-a1e6-c6d90890e78d"}'
```

With that, assignments can be scripted. The role ids as created:

| Role | appRoleId |
|---|---|
| `HRAdmin` | `ada12aa4-ddda-4746-aba2-23dddf53430c` |
| `Executive` | `7474c9cb-d200-414b-9461-b659ef24d7d5` |
| `Manager` | `a631f924-e029-4d4f-b17f-e98f3d756ed8` |
| `Employee` | `511dce4e-d02e-47fd-99e9-285fa9a4aca7` |

```bash
SP=6f8a11fa-4eb7-4832-a330-64b9b905febd
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP/appRoleAssignedTo" \
  --headers 'Content-Type=application/json' \
  --body '{"principalId":"<user object id>","resourceId":"'"$SP"'","appRoleId":"ada12aa4-ddda-4746-aba2-23dddf53430c"}'
```

## 5. Verify before switching over — done 2026-08-15

Confirm the registration looks right:

```bash
az ad app show --id efccb481-74ba-45b8-940a-fed5dfbec74e \
  --query "{uri:identifierUris, roles:appRoles[].value, spa:spa.redirectUris}"
```

You should see the `api://` URI, all four role values, and both redirect URIs.

## 6. Switch it on — done 2026-08-18

Two changes, made together. Both are already applied; this records what they were.

**Frontend** — in `.github/workflows/frontend.yml`, fill the three env vars:

```yaml
  ENTRA_CLIENT_ID: 'efccb481-74ba-45b8-940a-fed5dfbec74e'
  ENTRA_TENANT_ID: '0eadb77e-42dc-47f8-bbe3-ec2395e0712c'
  ENTRA_API_SCOPE: 'api://efccb481-74ba-45b8-940a-fed5dfbec74e/access_as_user'
```

**Backend** — in `infra/terraform/settings.tf`, change `AUTH_MODE` from `"dev"` to
`"entra"`, then `terraform apply`.

> **There is no staging environment any more.** The dev slot was deleted when the
> App Service plan moved from S1 to B1 (B1 has no deployment slots), so this change
> lands directly on the URL the demo runs against. If the registration is wrong, the
> first thing anyone sees is a locked door.
>
> Verify locally first — this is now the substitute for the dev slot, and step 3
> already registers `http://localhost:5173` as a redirect URI precisely so it works:
>
> ```bash
> # backend, against the real tenant
> cd backend && AUTH_MODE=entra uvicorn app.main:app --reload
>
> # frontend, in another shell — Vite's default port is 5173, which is the
> # registered redirect URI, so do not let it fall back to a free one
> cd frontend && npm run dev -- --strictPort
> ```
>
> Edit `frontend/public/config.js` to add the three `entra` values and point
> `apiBase` at `http://localhost:8000`. The committed copy holds only the localhost
> default; CI overwrites the whole file at deploy time, so local edits never reach
> production — but do not commit them either. Sign in, confirm you land with the
> right role, and confirm an HR-only page loads for an `HRAdmin` and 403s for an
> `Employee`.
> Only then change `AUTH_MODE` on the deployed app.

## What the switch changed

- "Sign in with Microsoft" opens a real Entra popup and acquires an access token;
  every API request carries `Authorization: Bearer`.
- The **"Dev only" role switch disappears**, along with the email/password form on
  the sign-in screen. Both are dev-mode affordances — under Entra the role comes
  from the token's `roles` claim, so a client-side switch would be misleading.
- `X-Dev-User-Email` stops being honoured by the backend. Before this landed,
  `AUTH_MODE=dev` on a public URL let any caller act as HR Admin by sending that
  header; the switch is what closed the hole.
- A user signing in for the first time is created in the `users` table from their
  token claims, with the role from `roles`. Existing seeded users are matched by
  email and back-filled with their `entra_object_id`.

## Rolling back

Clear the three frontend env vars and set `AUTH_MODE=dev`. The app returns to the
dev-header identity with no code change.

## Appendix — steps 1–3 as one block

**Already applied on 2026-08-15**; kept as a record of what was done, and to rebuild
the registration from scratch if it is ever lost. Requires ownership of the app
registration or Application Administrator.

```bash
APP=efccb481-74ba-45b8-940a-fed5dfbec74e

# 1. Expose the API — makes api://$APP a valid token audience
az ad app update --id $APP --identifier-uris "api://$APP"

# 2. Define the four app roles the backend maps through ROLE_ORDER
cat > /tmp/approles.json <<JSON
[
  {"allowedMemberTypes":["User"],"description":"Standard employee","displayName":"Employee","isEnabled":true,"value":"Employee","id":"$(uuidgen)"},
  {"allowedMemberTypes":["User"],"description":"People manager","displayName":"Manager","isEnabled":true,"value":"Manager","id":"$(uuidgen)"},
  {"allowedMemberTypes":["User"],"description":"Executive","displayName":"Executive","isEnabled":true,"value":"Executive","id":"$(uuidgen)"},
  {"allowedMemberTypes":["User"],"description":"HR administrator","displayName":"HRAdmin","isEnabled":true,"value":"HRAdmin","id":"$(uuidgen)"}
]
JSON
az ad app update --id $APP --app-roles @/tmp/approles.json

# 3. Register the SPA redirect URIs (PKCE — must be `spa`, not `web`)
az rest --method PATCH \
  --url "https://graph.microsoft.com/v1.0/applications(appId='$APP')" \
  --headers 'Content-Type=application/json' \
  --body '{"spa":{"redirectUris":[
      "https://delightful-tree-02eef901e.7.azurestaticapps.net",
      "http://localhost:5173"
  ]}}'

# Verify
az ad app show --id $APP --query "{uri:identifierUris, roles:appRoles[].value, spa:spa.redirectUris}"
```

Alternatively, adding Archit as an owner unblocks steps 1–3 without Nihitha running
them herself:

```bash
az ad app owner add --id efccb481-74ba-45b8-940a-fed5dfbec74e \
  --owner-object-id 374605c8-6563-4dfa-a1e6-c6d90890e78d   # Archit
```
