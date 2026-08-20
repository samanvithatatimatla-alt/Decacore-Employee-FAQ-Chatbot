# QBot — Employee FAQ Assistant

Internal AI HR assistant with two experiences behind one shell:

- **Employee portal** — chat with citations to source policy documents, chat history, a Resources library (policies, forms, favorites, "what changed" summaries), a My Questions page for HR replies, and a Connect to HR page.
- **HR admin portal** — a dashboard of assistant usage, an inbox of escalated questions, and a Document Management area (upload, version history, upload new version, document viewer).

It talks to the FastAPI backend in `../backend`. Nothing is mocked: chat is a real
streamed RAG answer, documents are real uploads to Blob Storage, and sign-in is real
Microsoft Entra ID.

## Tech stack

- **Vite + React 18 + TypeScript**
- **react-router-dom** for routing
- **@azure/msal-browser** for Entra sign-in
- **lucide-react** for icons
- Plain **CSS Modules** per component (no Tailwind/UI kit) — colors, spacing, and type are all driven by CSS variables in `src/index.css`

## Running it locally

```bash
npm install
npm run dev
```

Prints a local URL (e.g. `http://localhost:5173`) — open it in a browser. Start the
backend too (`cd ../backend && ./run-local.sh`); `public/config.js` points at
`http://localhost:8000` by default.

Other scripts:

```bash
npm run build     # type-check (tsc -b) + production build to dist/
npm run preview   # serve the production build locally
```

### Which identity you get

`public/config.js` decides. It holds only an `apiBase` by default, so `entraEnabled()`
is false and the app uses the dev-header path — the email/password form and the "Dev
only" role switch pick which seeded backend user you are, and every request carries
`X-Dev-User-Email`. That matches a backend running `AUTH_MODE=dev`.

Add an `entra` block with `clientId`, `tenantId` and `scope` and the app switches to
real MSAL sign-in, sending `Authorization: Bearer` instead. All three must be present;
a half-filled block is treated as off. Deploys always get the full block — the workflow
overwrites `config.js` — so **production is Entra**, and so is the backend.

To test the Entra path locally, edit `public/config.js` and run on port 5173, which is
the registered redirect URI. See `../docs/ENTRA_SETUP.md`.

## Project structure

```
src/
  pages/            One file per route (WelcomePage, SignInPage, ChatPage, ChatHistoryPage,
                     MyQuestionsPage, ResourcesPage, ContactPage, DashboardPage,
                     DocumentsPage, DocumentViewerPage, InboxPage)
  components/
    layout/          AppShell, TopNav, Sidebar, NewsTicker
    chat/             Composer, message bubbles/cards, typing indicator
    resources/        Document viewer/compare modal
    admin/            Upload / version history / new-version / escalation modals, file drop
    common/           Avatar, shared panel styles
  api/
    client.ts        Typed wrapper over the backend; owns auth headers, timeouts, and
                      the SSE reader for streamed chat
    map.ts           Translates API payloads into the shapes the components expect
  auth/entra.ts      MSAL sign-in, inert until config.js supplies the entra block
  context/
    AuthContext.tsx        Current user + role, from /api/me
    AppStateContext.tsx    Single reducer holding chat, history, resources, admin docs,
                            announcements, and UI state; its actions call the API
    typewriter.ts          Paces streamed text onto the screen at a steady rate
  routes/             Route guards (must be signed in / must be hr_admin)
  types/index.ts      The shared TypeScript data model
```

`AppStateContext` is still the single seam between UI and data — components dispatch
actions, and the action bodies call `api`/`streamChat` rather than mutating local seed
arrays. The old `data/seed.ts` is gone.

Note the UI was written against numeric ids while the API uses UUID strings, so
`map.ts` gives each record a numeric `id` for React keys and carries the real `apiId`
alongside. Anything that calls the API uses `apiId`.

## Routes

| Route | Screen | Access |
| --- | --- | --- |
| `/` | Welcome splash | public |
| `/signin` | Sign in | public |
| `/chat` | Chat (home + thread) | signed in |
| `/history` | Chat History | signed in |
| `/my-questions` | HR replies to escalated questions | signed in |
| `/resources` | Resources | signed in |
| `/contact` | Connect to HR | signed in |
| `/admin` | Dashboard | hr_admin only |
| `/admin/inbox` | Escalation inbox | hr_admin only |
| `/admin/documents` | Document Management | hr_admin only |
| `/admin/documents/:id` | Document viewer | hr_admin only |

Route guards live in `src/routes/ProtectedRoute.tsx`. After an Entra redirect the app
lands on the role's home page rather than the welcome splash — see `useLandAfterSignIn`
in `App.tsx`.

Note the backend has four roles (`Employee`, `Manager`, `Executive`, `HRAdmin`) but this
UI only distinguishes the HR admin experience from everyone else. Manager and Executive
are real backend roles with their own document visibility; they simply see the employee
screens.

## Deployment

GitHub Actions → Azure Static Web Apps, on any push to `main` touching `frontend/`.
The workflow generates `public/config.js` from its own env vars before building, so the
API base and Entra settings are deploy-time config rather than compiled in. See
`.github/workflows/frontend.yml` and `../infra/README.md`.

## Design reference

This was built from a design handoff (Figma-style prototype + screenshots), matched for
high fidelity — colors, spacing, type, and copy should closely match the original
design. If anything looks off compared to the design files, that's a bug, not an
intentional deviation.
