/**
 * Koç paneli — Appwrite Realtime: veritabanı belgeleri için merkezi dinleyici.
 * Wildcard kanal: `subscribeAppwriteDatabaseDocuments` (`appwrite-config.js`).
 */
import { subscribeAppwriteDatabaseDocuments } from "./appwrite-config.js";

const PANEL_COLLECTIONS = ["appointments", "exams", "students", "payments", "tests", "coach_tasks"];

function parseEventOp(evName) {
  if (!evName || typeof evName !== "string") return null;
  if (evName.endsWith(".create")) return "create";
  if (evName.endsWith(".update")) return "update";
  if (evName.endsWith(".delete")) return "delete";
  return null;
}

function collectionFromEventName(evName) {
  if (!evName || typeof evName !== "string") return null;
  const m = evName.match(/\.collections\.([^.]+)\.documents/);
  return m && m[1] ? m[1] : null;
}

/**
 * @param {(detail: { op: string, collectionId: string, payload: Record<string, unknown>, events: string[] }) => void} dispatch
 * @returns {() => void}
 */
export function startPanelGlobalRealtime(dispatch) {
  function handleResponse(res) {
    try {
      const events = res && res.events != null ? res.events : [];
      const ev0 = events[0];
      const op = parseEventOp(ev0);
      if (!op) return;
      let payload = res && res.payload != null ? res.payload : null;
      if (!payload || typeof payload !== "object") return;
      let collectionId = /** @type {{ $collectionId?: string }} */ (payload).$collectionId;
      if (!collectionId) collectionId = collectionFromEventName(ev0) || "";
      collectionId = String(collectionId || "").trim();
      if (!collectionId) return;
      if (PANEL_COLLECTIONS.indexOf(collectionId) === -1) return;
      dispatch({ op, collectionId, payload, events: Array.isArray(events) ? events.slice() : [] });
    } catch (_e) {}
  }

  return subscribeAppwriteDatabaseDocuments(handleResponse, PANEL_COLLECTIONS);
}
