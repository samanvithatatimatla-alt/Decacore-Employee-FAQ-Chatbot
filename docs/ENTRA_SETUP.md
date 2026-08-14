# Turning on Microsoft Entra sign-in

Everything on the code side is done and shipped, switched off behind a flag. What
remains cannot be done from this repo: it needs write access to the
`DecaCore-HR-Chatbot` app registration, and role assignment needs a tenant admin.

**Do not flip `AUTH_MODE` until steps 1–4 are finished and step 5 has passed.** The
backend rejects any token whose audience does not match `ENTRA_AUDIENCE`, so turning
it on early locks every user out of the deployed app.

## Where things stand

| | |
|---|---|
| App registration | `DecaCore-HR-Chatbot` — client `efccb481-74ba-45b8-940a-fed5dfbec74e` |
| Tenant | `0eadb77e-42dc-47f8-bbe3-ec2395e0712c` (Quadrant Technologies LLC) |
| Sole owner | Nihitha Datla (`i-nihitha.d@quadranttechnologies.com`) |
| Application ID URI | **not set** |
| App roles | **none defined** |
| Redirect URIs | **none set** |

Archit is not an owner and holds no directory role, so `az ad app update` returns
*Insufficient privileges*. Steps 1–3 must be run by Nihitha, or by anyone holding
Application Administrator, or Archit must first be added as an owner:

```bash
az ad app owner add --id efccb481-74ba-45b8-940a-fed5dfbec74e \
  --owner-object-id 374605c8-6563-4dfa-a1e6-c6d90890e78d   # Archit
```

## 1. Expose the API

```bash
APP=efccb481-74ba-45b8-940a-fed5dfbec74e
az ad app update --id $APP --identifier-uris "api://$APP"
```

This is what makes `ENTRA_AUDIENCE=api://efccb481-...` — already set in the App
Service configuration — a valid audience.

## 2. Define the app roles

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

## 3. Register the SPA redirect URI

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

## 4. Assign users to roles

Needs a tenant admin. In the portal: **Enterprise applications →
DecaCore-HR-Chatbot → Users and groups → Add user/group**, then pick the role.
Everyone who will use the demo needs an assignment — a user with no app role gets
an empty `roles` claim and the backend defaults them to `Employee`.

At minimum, assign one person to `HRAdmin` or nobody can reach the HR tools.

## 5. Verify before switching over

Confirm the registration looks right:

```bash
az ad app show --id efccb481-74ba-45b8-940a-fed5dfbec74e \
  --query "{uri:identifierUris, roles:appRoles[].value, spa:spa.redirectUris}"
```

You should see the `api://` URI, all four role values, and both redirect URIs.

## 6. Switch it on

Two changes, made together:

**Frontend** — in `.github/workflows/frontend.yml`, fill the three env vars:

```yaml
  ENTRA_CLIENT_ID: 'efccb481-74ba-45b8-940a-fed5dfbec74e'
  ENTRA_TENANT_ID: '0eadb77e-42dc-47f8-bbe3-ec2395e0712c'
  ENTRA_API_SCOPE: 'api://efccb481-74ba-45b8-940a-fed5dfbec74e/.default'
```

**Backend** — in `infra/terraform/settings.tf`, change `AUTH_MODE` from `"dev"` to
`"entra"`, then `terraform apply`. Deploy to the **dev slot** and verify there
before swapping to production.

## What changes when it is on

- "Sign in with Microsoft" opens a real Entra popup and acquires an access token;
  every API request carries `Authorization: Bearer`.
- The **"Dev only" role switch disappears**, along with the email/password form on
  the sign-in screen. Both are dev-mode affordances — under Entra the role comes
  from the token's `roles` claim, so a client-side switch would be misleading.
- `X-Dev-User-Email` stops being honoured by the backend. Today, with
  `AUTH_MODE=dev` on a public URL, that header lets any caller act as HR Admin;
  this is what closes that hole.
- A user signing in for the first time is created in the `users` table from their
  token claims, with the role from `roles`. Existing seeded users are matched by
  email and back-filled with their `entra_object_id`.

## Rolling back

Clear the three frontend env vars and set `AUTH_MODE=dev`. The app returns to the
dev-header identity with no code change.
