/**
 * Appwrite `users` + `coaches` üzerinden oturum profili (login.js ile aynı mantık).
 */
import { Query as AQuery } from "./appwrite-browser.js";
import {
  databasesListDocumentsOrSoft,
  isAppwriteWriteSoftFailure,
  logAppwriteError,
} from "./appwrite-compat.js";
import {
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_USERS,
  APPWRITE_COLLECTION_COACHES,
} from "./appwrite-config.js";

export function sanitizeUsernameForDb(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

export function inferUsernameFromEmail(email) {
  var local = String(email || "").split("@")[0] || "";
  return sanitizeUsernameForDb(local);
}

/**
 * @param {{ uid?: string, email?: string }} authUser — Appwrite uyumlu `uid` = `$id`
 * @param {string} [fallbackUsername]
 * @returns {Promise<object|null>}
 */
export async function fetchAppwriteUserProfile(authUser, fallbackUsername) {
  var uid = authUser && authUser.uid ? String(authUser.uid) : "";
  var email = authUser && authUser.email ? String(authUser.email).toLowerCase() : "";
  var uname = sanitizeUsernameForDb(fallbackUsername || inferUsernameFromEmail(email));

  try {
    var usersById = await databasesListDocumentsOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_USERS, [
      AQuery.equal("$id", uid),
      AQuery.limit(1),
    ]);
    if (!isAppwriteWriteSoftFailure(usersById) && usersById.documents && usersById.documents.length) {
      return usersById.documents[0];
    }
    if (isAppwriteWriteSoftFailure(usersById)) {
      logAppwriteError("derece-profile-resolve/usersById", { message: usersById.message || "soft" });
    }
  } catch (e) {
    logAppwriteError("derece-profile-resolve/usersById", e);
  }

  if (uname) {
    try {
      var usersByUsername = await databasesListDocumentsOrSoft(
        APPWRITE_DATABASE_ID,
        APPWRITE_COLLECTION_USERS,
        [AQuery.equal("username", uname), AQuery.limit(1)]
      );
      if (
        !isAppwriteWriteSoftFailure(usersByUsername) &&
        usersByUsername.documents &&
        usersByUsername.documents.length
      ) {
        return usersByUsername.documents[0];
      }
      if (isAppwriteWriteSoftFailure(usersByUsername)) {
        logAppwriteError("derece-profile-resolve/usersByUsername", {
          message: usersByUsername.message || "soft",
        });
      }
    } catch (e2) {
      logAppwriteError("derece-profile-resolve/usersByUsername", e2);
    }
  }

  if (uname) {
    try {
      var coachesByUsername = await databasesListDocumentsOrSoft(
        APPWRITE_DATABASE_ID,
        APPWRITE_COLLECTION_COACHES,
        [AQuery.equal("username", uname), AQuery.limit(1)]
      );
      if (
        !isAppwriteWriteSoftFailure(coachesByUsername) &&
        coachesByUsername.documents &&
        coachesByUsername.documents.length
      ) {
        var coachDoc = coachesByUsername.documents[0];
        return {
          username: uname,
          role: "coach",
          fullName: coachDoc.fullName || coachDoc.name || null,
          coach_id: uname,
        };
      }
      if (isAppwriteWriteSoftFailure(coachesByUsername)) {
        logAppwriteError("derece-profile-resolve/coachesByUsername", {
          message: coachesByUsername.message || "soft",
        });
      }
    } catch (e3) {
      logAppwriteError("derece-profile-resolve/coachesByUsername", e3);
    }
  }

  return null;
}
