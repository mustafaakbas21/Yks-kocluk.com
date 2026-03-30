/**
 * Koç paneli — Appwrite Realtime: veritabanı belgeleri için merkezi dinleyici.
 * Wildcard kanal destekleniyorsa tek abonelik; aksi halde koleksiyon başına abonelik.
 */
import { client, APPWRITE_DATABASE_ID } from "./appwrite-config.js";

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

function attachChannelSubscribe(channel, handler) {
  /** @type {(() => void) | null} */
  let unsub = null;
  try {
    if (typeof client.subscribe !== "function") return null;
    let ret;
    try {
      ret = client.subscribe(channel, handler);
    } catch (_e0) {
      ret = client.subscribe([channel], handler);
    }
    if (ret != null && typeof ret.then === "function") {
      ret
        .then(function (u) {
          if (typeof u === "function") unsub = u;
        })
        .catch(function () {});
    } else if (typeof ret === "function") {
      unsub = ret;
    }
  } catch (e) {
    console.warn("[panel-realtime] Kanal açılamadı:", channel, e && e.message ? e.message : e);
  }
  return unsub;
}

/**
 * @param {(detail: { op: string, collectionId: string, payload: Record<string, unknown>, events: string[] }) => void} dispatch
 * @returns {() => void}
 */
export function startPanelGlobalRealtime(dispatch) {
  const unsubs = [];

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

  const wildcard = "databases." + APPWRITE_DATABASE_ID + ".collections.*.documents";
  let u0 = attachChannelSubscribe(wildcard, handleResponse);
  if (typeof u0 === "function") {
    unsubs.push(u0);
  } else {
    PANEL_COLLECTIONS.forEach(function (coll) {
      const ch = "databases." + APPWRITE_DATABASE_ID + ".collections." + coll + ".documents";
      const u = attachChannelSubscribe(ch, handleResponse);
      if (typeof u === "function") unsubs.push(u);
    });
  }

  return function stopPanelGlobalRealtime() {
    unsubs.forEach(function (fn) {
      try {
        if (typeof fn === "function") fn();
      } catch (_e) {}
    });
    unsubs.length = 0;
  };
}
