# QBot — Employee FAQ Assistant

Internal AI HR assistant with two experiences behind one shell:

- **Employee portal** — chat with citations to source policy documents, chat history, a Resources library (policies, forms, favorites, "what changed" summaries), and a Connect to HR page.
- **HR admin portal** — a dashboard of assistant usage and a Document Management area (upload, version history, upload new version, document viewer).

This is a **frontend-only build**. There is no backend yet — auth, chat responses, and document storage are all mocked with in-memory demo data (see [What's mocked](#whats-mocked--what-the-backend-needs-to-provide) below). That's the main thing backend/deployment folks need to know going in.

## Tech stack

- **Vite + React 18 + TypeScript**
- **react-router-dom** for routing
- **lucide-react** for icons
- Plain **CSS Modules** per component (no Tailwind/UI kit) — colors, spacing, and type are all driven by CSS variables in `src/index.css`

## Running it locally

```bash
npm install
npm run dev
```

Prints a local URL (e.g. `http://localhost:5173`) — open it in a browser.

Other scripts:

```bash
npm run build     # type-check (tsc -b) + production build to dist/
npm run preview   # serve the production build locally
```

**Demo sign-in** (no real auth yet): the "Sign in with Microsoft" button and the email/password form both work, but they're fake. On the email/password path, any email containing the word "admin" signs you in as the HR admin persona; anything else signs you in as the employee persona. Nothing is validated server-side — see the auth section below for what needs to replace this.

## Project structure

```
src/
  pages/            One file per route (WelcomePage, SignInPage, ChatPage, ChatHistoryPage,
                     ResourcesPage, ContactPage, DashboardPage, DocumentsPage, DocumentViewerPage)
  components/
    layout/          AppShell, TopNav, Sidebar, NewsTicker
    chat/             Composer, message bubbles/cards, typing indicator
    resources/        Document viewer/compare modal
    admin/             Upload / version history / new-version modals, file drop field
    common/            Avatar, shared panel styles
  context/
    AuthContext.tsx        Current user + role (in-memory only, see below)
    AppStateContext.tsx    Single reducer holding chat, history, resources, admin docs,
                            announcements, and UI state — this is the seam where real
                            API calls should replace the mocked actions
  data/seed.ts        All demo/seed data + the keyword-matching fake chat responses
  types/index.ts      The shared TypeScript data model
  routes/             Route guards (must be signed in / must be hr_admin)
```

Everything funnels through `AppStateContext`'s reducer — if/when there's a real backend, the natural approach is to keep the action names (`SEND_MESSAGE`, `UPLOAD_NEW_VERSION`, etc.) but swap the bodies of the actions/dispatches for real `fetch`/API calls, rather than restructuring the components.

## Routes

| Route | Screen | Access |
| --- | --- | --- |
| `/` | Welcome splash | public |
| `/signin` | Sign in | public |
| `/chat` | Chat (home + thread) | signed in |
| `/history` | Chat History | signed in |
| `/resources` | Resources | signed in |
| `/contact` | Connect to HR | signed in |
| `/admin` | Dashboard | hr_admin only |
| `/admin/documents` | Document Management | hr_admin only |
| `/admin/documents/:id` | Document viewer | hr_admin only |

Route guards live in `src/routes/ProtectedRoute.tsx`.

## What's mocked / what the backend needs to provide

This is the important section for backend and deployment — everything below is currently faked client-side and needs a real implementation behind it.

### Auth
- `src/context/AuthContext.tsx` holds the signed-in user in a React state variable only — nothing is persisted, nothing survives a page refresh, no tokens, no server calls.
- Needs: real Microsoft Entra ID / MSAL integration for "Sign in with Microsoft"; a real session (cookie or token) that survives reloads; the employee vs. hr_admin role should come from the authenticated user's actual role, not from sniffing the word "admin" in an email string.

### Chat
- `src/data/seed.ts` → `genBotResponse()` — replies are picked by dumb keyword matching against a handful of hardcoded strings (e.g. contains "home" or "remote" → canned remote-work answer). There is no LLM, no retrieval, no real citations.
- The ~1.1s "typing" delay is a `setTimeout`, not a real streaming response.
- Needs: a real assistant API (ideally streaming) that returns `{ kind: 'answer' | 'warn' | 'refuse', body, tags (citations), steps?, followUps? }` — see the `ChatMessage` type in `src/types/index.ts` for the exact shape the UI already renders.

### Documents
- Admin document upload/version history (`src/context/AppStateContext.tsx`, `ADD_ADMIN_DOC` / `UPLOAD_NEW_VERSION` actions) only reads the picked file's name and size client-side — **no file is actually uploaded anywhere.** The "content" shown in the document viewer is a hardcoded placeholder string per document.
- Needs: real file upload (to blob storage / a document service), real PDF text extraction for the viewer, and a real diff/summary step for "what changed" between versions (currently that summary is just whatever text the HR admin manually typed into the upload modal).

### Everything else in `data/seed.ts`
Chat history, resources/policies/forms, announcements (news ticker), the admin dashboard's usage numbers ("Common Employee Questions", "Most Referenced Documents") — all hardcoded seed arrays held in memory for the session. None of it is persisted or shared between users/devices. In production these should come from real endpoints (chat history per user, documents from a document service, dashboard numbers server-aggregated).

### Not implemented at all
- The "Request Context" escalation/inbox flow (HR reviewing an employee's flagged question) — the data model exists in the original design spec but there's no screen for it in this build. Flag if you want it built.
- Real download links for forms ("Download ↓" buttons are inert).
- Persisting sidebar/favorites/state across sessions.

## Design reference

This was built from a design handoff (Figma-style prototype + screenshots), matched for high fidelity — colors, spacing, type, and copy should closely match the original design. If anything looks off compared to the design files, that's a bug, not an intentional deviation (aside from the explicit differences noted in this README, like the fake auth).
