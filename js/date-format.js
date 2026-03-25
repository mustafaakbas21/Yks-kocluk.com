/**
 * Appwrite / ISO string / eski Firestore {seconds} / toDate() uyumlu tarih parse.
 * instanceof Timestamp kullanılmaz (Timestamp uyumluluk objesi constructor değildir).
 */

export function parseFlexibleDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        const d = value.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch (_e) {
        return null;
      }
    }
    if (typeof value.toMillis === "function") {
      try {
        const d = new Date(value.toMillis());
        return isNaN(d.getTime()) ? null : d;
      } catch (_e) {
        return null;
      }
    }
    if (typeof value.seconds === "number") {
      const ms = value.seconds * 1000 + (typeof value.nanoseconds === "number" ? value.nanoseconds / 1e6 : 0);
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
    const parts = trimmed.split(/[./]/);
    if (parts.length === 3) {
      const dd = parseInt(parts[0], 10);
      const mm = parseInt(parts[1], 10) - 1;
      const yy = parseInt(parts[2], 10);
      if (!isNaN(dd) && !isNaN(mm) && !isNaN(yy)) {
        const alt = new Date(yy, mm, dd);
        if (!isNaN(alt.getTime())) return alt;
      }
    }
  }
  return null;
}

/**
 * Türkçe gösterim. Boş → opts.emptyLabel veya "—"
 */
export function formatDateTimeTr(value, opts) {
  opts = opts || {};
  const empty = opts.emptyLabel != null ? opts.emptyLabel : "—";
  const d = parseFlexibleDate(value);
  if (!d) return empty;
  if (opts.withTime === false) {
    return d.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const o = {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (opts.withSeconds) o.second = "2-digit";
  return d.toLocaleString("tr-TR", o);
}
