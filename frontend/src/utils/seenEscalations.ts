/**
 * Tracks which HR replies the employee has already read, so the sidebar can badge
 * the ones they have not.
 *
 * Deliberately client-side. The obvious alternative — a `seen_at` column on the
 * requests table — cannot be added safely: the app has no migration step and creates
 * tables with Base.metadata.create_all at startup, which never ALTERs an existing
 * table. A new column would work on a fresh database and be silently missing on the
 * deployed one. localStorage keeps this to a UI concern with no schema risk.
 *
 * The trade-off: "read" is per browser, so the badge reappears on another device.
 * That is the right way round — showing an answer twice beats never showing it.
 */

import type { ApiInboxRequest } from '../api/client';

const KEY = 'qbot.seenEscalations';

type SeenMap = Record<string, string>;

/**
 * Identifies a *version* of a reply, not just the request. HR can answer, leave it
 * In Progress, then answer again with more detail — keying on the id alone would
 * mark that second reply as already read.
 */
function signature(item: ApiInboxRequest): string {
  return `${item.status}|${(item.hr_response ?? '').length}`;
}

/** Answered items only. A question still waiting on HR is not news. */
export function answered(items: ApiInboxRequest[]): ApiInboxRequest[] {
  return items.filter((i) => (i.hr_response ?? '').trim().length > 0);
}

function read(email: string): SeenMap {
  try {
    const raw = localStorage.getItem(`${KEY}.${email}`);
    return raw ? (JSON.parse(raw) as SeenMap) : {};
  } catch {
    // Private-browsing quota errors and hand-edited values both land here. An
    // unreadable store means "nothing seen yet", which over-notifies rather than
    // hiding a reply.
    return {};
  }
}

export function unreadCount(items: ApiInboxRequest[], email: string): number {
  const seen = read(email);
  return answered(items).filter((i) => seen[i.id] !== signature(i)).length;
}

export function markAllSeen(items: ApiInboxRequest[], email: string): void {
  const seen = read(email);
  for (const item of answered(items)) seen[item.id] = signature(item);
  try {
    localStorage.setItem(`${KEY}.${email}`, JSON.stringify(seen));
  } catch {
    // Nothing to do: the badge will simply show again next time.
  }
}
