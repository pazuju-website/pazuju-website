// Firebase integration: anonymous auth, cross-device progress sync, and
// leaderboard writes. Uses the Firebase compat SDK (plain <script> tags,
// global `firebase` namespace) to match the rest of this site's no-bundler,
// plain-script setup - see PROJECT_NOTES.md's "Firebase backend" entry for
// the console-side setup this talks to (project pazuju-67d8a, Auth +
// Firestore + security rules).
const firebaseConfig = {
  apiKey: "AIzaSyCrr0dXJJ5rsHcMtXCz4bVmspbvj7M3W80",
  authDomain: "pazuju-67d8a.firebaseapp.com",
  projectId: "pazuju-67d8a",
  storageBucket: "pazuju-67d8a.firebasestorage.app",
  messagingSenderId: "5615692196",
  appId: "1:5615692196:web:42313115b7b4524c373931",
};

firebase.initializeApp(firebaseConfig);
const firestoreDb = firebase.firestore();

const PazujuFirebase = (() => {
  let currentUser = null;
  let resolveReady;
  // Resolves once anonymous sign-in completes, so callers just
  // `await PazujuFirebase.ready` instead of threading auth-state checks
  // through every call site.
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  firebase.auth().onAuthStateChanged((user) => {
    if (user && !currentUser) {
      currentUser = user;
      resolveReady(user);
    }
  });
  firebase.auth().signInAnonymously().catch((err) => {
    console.error("Pazuju: anonymous sign-in failed", err);
  });

  // Firestore rejects arrays-of-arrays (piece.cells is [[r,c], ...] in the
  // engine's own state shape) - convert to/from {r,c} objects only at this
  // boundary so pazuju-engine.js never has to know about Firestore's storage
  // limitations.
  function serializePieces(pieces) {
    return (pieces || []).map((p) => {
      const out = { id: p.id, color: p.color, givens: p.givens, cells: p.cells.map(([r, c]) => ({ r, c })) };
      if (p.origin) out.origin = p.origin;
      if (p.solved) {
        out.solved = {
          origin: p.solved.origin,
          givens: p.solved.givens,
          cells: p.solved.cells.map(([r, c]) => ({ r, c })),
        };
      }
      return out;
    });
  }

  function deserializePieces(pieces) {
    return (pieces || []).map((p) => {
      const out = { id: p.id, color: p.color, givens: p.givens, cells: p.cells.map((c) => [c.r, c.c]) };
      if (p.origin) out.origin = p.origin;
      if (p.solved) {
        out.solved = {
          origin: p.solved.origin,
          givens: p.solved.givens,
          cells: p.solved.cells.map((c) => [c.r, c.c]),
        };
      }
      return out;
    });
  }

  function progressRef(uid, date, sizeKey) {
    return firestoreDb.collection("users").doc(uid).collection("progress").doc(`${date}_${sizeKey}`);
  }

  // Debounced per-puzzle (keyed by date_sizeKey) so a burst of moves (e.g.
  // filling in several numbers quickly) collapses into one write instead of
  // one per move.
  const pendingSaves = new Map(); // "date_sizeKey" -> timeout handle

  function saveProgress(date, sizeKey, state) {
    const key = `${date}_${sizeKey}`;
    clearTimeout(pendingSaves.get(key));
    pendingSaves.set(key, setTimeout(() => flushProgress(date, sizeKey, state), 800));
  }

  // Bypasses the debounce - used right before the page might go away (tab
  // hidden) or right after a solve, where the write needs to actually fire
  // rather than wait out the debounce window.
  function flushProgress(date, sizeKey, state) {
    const key = `${date}_${sizeKey}`;
    clearTimeout(pendingSaves.get(key));
    pendingSaves.delete(key);
    return ready.then((user) => progressRef(user.uid, date, sizeKey).set({
      date,
      sizeKey,
      placed: serializePieces(state.placed),
      unplaced: serializePieces(state.unplaced),
      userValues: state.userValues || {},
      lockedCells: state.lockedCells || [],
      solved: !!state.solved,
      elapsedMs: state.elapsedMs ?? 0,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    })).catch((err) => console.error("Pazuju: progress save failed", err));
  }

  async function loadProgress(date, sizeKey) {
    const user = await ready;
    const snap = await progressRef(user.uid, date, sizeKey).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return {
      placed: deserializePieces(data.placed),
      unplaced: deserializePieces(data.unplaced),
      userValues: data.userValues || {},
      lockedCells: data.lockedCells || [],
      solved: !!data.solved,
      elapsedMs: data.elapsedMs || 0,
    };
  }

  // Fastest times for one specific puzzle instance (a single day's single
  // board size) - not a global/all-time ranking. Requires a composite index
  // on leaderboardEntries (date asc, sizeKey asc, elapsedMs asc) - see
  // PROJECT_NOTES.md's "Firebase backend" entry.
  async function getLeaderboard(date, sizeKey, limitCount = 20) {
    const snap = await firestoreDb.collection("leaderboardEntries")
      .where("date", "==", date)
      .where("sizeKey", "==", sizeKey)
      .orderBy("elapsedMs")
      .limit(limitCount)
      .get();
    return snap.docs.map((doc) => doc.data());
  }

  function addDaysISO(iso, delta) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }

  async function getStats() {
    const user = await ready;
    const snap = await firestoreDb.collection("users").doc(user.uid).get();
    if (!snap.exists) return { currentStreak: 0, longestStreak: 0, totalSolved: 0, lastSolvedDate: null };
    const data = snap.data();
    return {
      currentStreak: data.currentStreak || 0,
      longestStreak: data.longestStreak || 0,
      totalSolved: data.totalSolved || 0,
      lastSolvedDate: data.lastSolvedDate || null,
    };
  }

  async function getDisplayName() {
    const user = await ready;
    const snap = await firestoreDb.collection("users").doc(user.uid).get();
    return snap.exists ? (snap.data().displayName || null) : null;
  }

  async function setDisplayName(name) {
    const user = await ready;
    await firestoreDb.collection("users").doc(user.uid).set({
      displayName: name || null,
      lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // --- Free account signup (first name + email) -----------------------------
  // "Registered" is a flag on the same anonymous users/{uid} doc everything
  // else already writes to - there's no separate password-based login, so
  // this only persists on the browser that signed up (same limitation
  // progress-sync already has). A localStorage flag gives an instant local
  // answer (no Firestore round-trip needed once set, since the status never
  // reverts), with Firestore as the backing/authoritative copy.
  const REGISTERED_KEY = "pazuju-registered";

  function isRegisteredLocal() {
    try {
      return localStorage.getItem(REGISTERED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setRegisteredLocal() {
    try {
      localStorage.setItem(REGISTERED_KEY, "1");
    } catch {
      /* storage unavailable - falls back to the Firestore read each check */
    }
  }

  async function isRegistered() {
    if (isRegisteredLocal()) return true;
    try {
      const user = await ready;
      const snap = await firestoreDb.collection("users").doc(user.uid).get();
      const reg = snap.exists && !!snap.data().registered;
      if (reg) setRegisteredLocal();
      return reg;
    } catch (err) {
      console.error("Pazuju: registration check failed", err);
      return false;
    }
  }

  // Fill these in from brokermail.ca's Campaign Monitor list -> Forms ->
  // the "paste code onto your site" embed generator: `action` is the
  // generated form's action= URL (a createsend.com link), emailField/
  // nameField are the input name= attributes from that same generated HTML
  // (commonly "cm-xxxxx-xxxxx" for email, similar for name - copy exactly
  // what's generated, don't guess). Submission is a plain form POST straight
  // to Campaign Monitor's own servers - no API key, no backend involved.
  // Until these are filled in, signup still works (name/email are still
  // saved to Firestore below) - it just isn't pushed to the mailing list yet.
  const CAMPAIGN_MONITOR_FORM = {
    action: "",
    emailField: "",
    nameField: "",
  };

  // Submits into a disposable hidden iframe rather than the main window, so
  // the player's page never navigates away to Campaign Monitor's own
  // thank-you page - the standard pattern for embedded ESP signup forms.
  function submitToCampaignMonitor(firstName, email) {
    if (!CAMPAIGN_MONITOR_FORM.action) {
      console.warn("Pazuju: Campaign Monitor form not configured yet - signup saved locally only.");
      return;
    }
    let iframe = document.getElementById("cmSignupFrame");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "cmSignupFrame";
      iframe.name = "cmSignupFrame";
      iframe.style.display = "none";
      document.body.appendChild(iframe);
    }

    const form = document.createElement("form");
    form.action = CAMPAIGN_MONITOR_FORM.action;
    form.method = "POST";
    form.target = "cmSignupFrame";
    form.style.display = "none";

    const emailInput = document.createElement("input");
    emailInput.name = CAMPAIGN_MONITOR_FORM.emailField;
    emailInput.value = email;
    form.appendChild(emailInput);

    if (CAMPAIGN_MONITOR_FORM.nameField) {
      const nameInput = document.createElement("input");
      nameInput.name = CAMPAIGN_MONITOR_FORM.nameField;
      nameInput.value = firstName;
      form.appendChild(nameInput);
    }

    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  async function registerPlayer(firstName, email) {
    const user = await ready;
    await firestoreDb.collection("users").doc(user.uid).set({
      firstName: firstName || null,
      email: email || null,
      registered: true,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    setRegisteredLocal();
    submitToCampaignMonitor(firstName, email);
  }

  // Called once per puzzle solve (see handleSolved() in play.html). Writes
  // the leaderboard entry and updates the player's streak in one go - both
  // run inside one transaction (reading the current displayName/streak off
  // the same user doc they're written to) so it can't be corrupted by a
  // near-simultaneous solve in another tab.
  async function recordSolve({ date, sizeKey, elapsedMs }) {
    const user = await ready;
    const userRef = firestoreDb.collection("users").doc(user.uid);
    const entryRef = firestoreDb.collection("leaderboardEntries").doc(`${date}_${sizeKey}_${user.uid}`);

    await firestoreDb.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const data = doc.exists ? doc.data() : {};

      tx.set(entryRef, {
        date,
        sizeKey,
        uid: user.uid,
        displayName: data.displayName || "Anonymous",
        elapsedMs,
        solvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const lastSolvedDate = data.lastSolvedDate || null;
      if (lastSolvedDate === date) return; // this date's solve was already counted (e.g. re-triggered on reload)
      const wasYesterday = lastSolvedDate === addDaysISO(date, -1);
      const currentStreak = wasYesterday ? (data.currentStreak || 0) + 1 : 1;
      tx.set(userRef, {
        lastSolvedDate: date,
        currentStreak,
        longestStreak: Math.max(data.longestStreak || 0, currentStreak),
        totalSolved: (data.totalSolved || 0) + 1,
        lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }

  return { ready, saveProgress, flushProgress, loadProgress, recordSolve, getDisplayName, setDisplayName, getLeaderboard, getStats, isRegistered, registerPlayer };
})();
