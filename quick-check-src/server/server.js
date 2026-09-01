"use strict";

/* Backend für den LASTA Quick Check.
 *
 * Zwei Aufgaben:
 *   1. Teammodus: Antworten mehrerer Personen sammeln und als Mittelwert je
 *      Frage wieder ausliefern, damit alle dasselbe Gruppenprofil sehen.
 *   2. Einzelmodus: Kontaktdaten aus dem öffentlichen Quick Check annehmen.
 *
 * Der Server kennt den Fragebogen bewusst NICHT. Er aggregiert nur je Frage
 * (q0, q1, ...) und weiß nichts von Dimensionen, Zonen oder Texten. Die
 * Zuordnung macht die App. So bleibt der Fragebogen an einer Stelle gepflegt.
 *
 * Endpunkte:
 *   POST /api/submit              öffentlich   Antworten, optional Kontaktdaten
 *   GET  /api/aggregate?room=     öffentlich   nur Anzahl und Mittelwerte
 *   GET  /api/qr?room=            öffentlich   QR-Code als SVG
 *   GET  /api/data                Token nötig  Rohdaten inklusive Kontaktdaten
 *   POST /api/reset               Token nötig  Raum oder alles leeren
 *
 * Umgebungsvariablen:
 *   PORT             Standard 3000
 *   ADMIN_TOKEN      Pflicht für /api/data und /api/reset. Ohne gesetztes
 *                    Token antworten beide mit 503, statt Daten offenzulegen.
 *   ALLOWED_ORIGINS  Kommaliste erlaubter Herkünfte für Anfragen aus dem Browser,
 *                    z. B. "https://it-team-flow.de". Ohne Angabe sind nur
 *                    Anfragen von derselben Herkunft möglich.
 *   PUBLIC_URL       Basis-URL für den QR-Code, z. B.
 *                    "https://quick-check.it-team-flow.de". Ohne Angabe wird sie
 *                    aus den Anfrage-Headern abgeleitet.
 *   DATA_FILE        Pfad der Datendatei, Standard ./data.json
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

const MAX_ANSWERS = 50;          // grosszügige Obergrenze, schützt vor Müll
const MAX_FIELD_LEN = 200;       // je Kontaktfeld
const MAX_ROOM_LEN = 40;
const RATE_MAX = 30;             // Einreichungen je IP
const RATE_WINDOW_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- Persistenz

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (raw && Array.isArray(raw.submissions)) return raw;
  } catch (e) {
    // Datei fehlt oder ist unlesbar: mit leerem Stand starten.
  }
  return { submissions: [] };
}

function saveData(data) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomar, damit ein Absturz die Datei nicht zerreisst
}

let store = loadData();

// ---------------------------------------------------------------- Hilfsmittel

function cleanRoom(value) {
  const s = typeof value === "string" && value.trim() ? value.trim() : "default";
  return s.slice(0, MAX_ROOM_LEN);
}

function validAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
  const keys = Object.keys(answers);
  if (!keys.length || keys.length > MAX_ANSWERS) return false;
  return keys.every((k) => {
    if (!/^q\d{1,3}$/.test(k)) return false;
    const v = answers[k];
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
  });
}

/* Kontaktdaten auf bekannte Felder und Längen beschränken. Alles andere fliegt
 * heraus, damit über dieses Feld nichts Beliebiges in der Datei landet. */
function cleanContact(contact) {
  if (contact === undefined || contact === null) return undefined;
  if (typeof contact !== "object" || Array.isArray(contact)) return null;
  const out = {};
  ["firstname", "lastname", "email", "company", "role", "teams"].forEach((k) => {
    if (typeof contact[k] === "string") out[k] = contact[k].trim().slice(0, MAX_FIELD_LEN);
  });
  out.consent = contact.consent === true;
  return out;
}

const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX) {
    rateBuckets.set(ip, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return false;
}

// Gelegentlich aufräumen, damit die Map nicht unbegrenzt wächst.
setInterval(() => {
  const now = Date.now();
  rateBuckets.forEach((times, ip) => {
    const keep = times.filter((t) => now - t < RATE_WINDOW_MS);
    if (keep.length) rateBuckets.set(ip, keep);
    else rateBuckets.delete(ip);
  });
}, RATE_WINDOW_MS).unref();

function requireToken(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "admin_token_not_configured" });
    return false;
  }
  if (req.get("x-admin-token") !== ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:" + PORT;
  return proto + "://" + host;
}

// ---------------------------------------------------------------- Middleware

app.disable("x-powered-by");
app.set("trust proxy", true);

// Nur ausdrücklich erlaubte Herkünfte dürfen aus dem Browser zugreifen.
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------- Endpunkte

app.post("/api/submit", (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: "too_many_requests" });

  const body = req.body || {};
  if (typeof body.id !== "string" || !body.id || body.id.length > 100) {
    return res.status(400).json({ error: "invalid_id" });
  }
  if (!validAnswers(body.answers)) {
    return res.status(400).json({ error: "invalid_answers" });
  }
  const contact = cleanContact(body.contact);
  if (contact === null) return res.status(400).json({ error: "invalid_contact" });

  if (store.submissions.some((s) => s.id === body.id)) {
    return res.json({ ok: true, alreadyExists: true });
  }

  const entry = {
    id: body.id,
    ts: Date.now(),
    room: cleanRoom(body.room),
    answers: body.answers
  };
  if (contact) entry.contact = contact;
  if (typeof body.source === "string") entry.source = body.source.slice(0, MAX_FIELD_LEN);

  store.submissions.push(entry);
  saveData(store);
  res.json({ ok: true });
});

/* Liefert bewusst nur Anzahl und Mittelwerte je Frage. Keine Rohdaten, keine
 * Kontaktdaten: dieser Endpunkt ist öffentlich, weil ihn jede Teilnehmerin im
 * Teammodus abfragt. */
app.get("/api/aggregate", (req, res) => {
  const room = cleanRoom(req.query.room);
  const rows = store.submissions.filter((s) => s.room === room);

  const sums = Object.create(null);
  const counts = Object.create(null);
  rows.forEach((s) => {
    Object.keys(s.answers).forEach((k) => {
      sums[k] = (sums[k] || 0) + s.answers[k];
      counts[k] = (counts[k] || 0) + 1;
    });
  });

  const questions = {};
  Object.keys(sums).forEach((k) => { questions[k] = sums[k] / counts[k]; });

  res.set("Cache-Control", "no-store");
  res.json({ room: room, count: rows.length, questions: questions });
});

app.get("/api/qr", (req, res) => {
  const room = cleanRoom(req.query.room);
  const target = baseUrl(req) + "/quick-check/?room=" + encodeURIComponent(room);
  QRCode.toString(target, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 512 })
    .then((svg) => {
      res.set("Content-Type", "image/svg+xml");
      res.set("Cache-Control", "public, max-age=300");
      res.send(svg);
    })
    .catch(() => res.status(500).json({ error: "qr_failed" }));
});

app.get("/api/data", (req, res) => {
  if (!requireToken(req, res)) return;
  const room = req.query.room ? cleanRoom(req.query.room) : null;
  const rows = room ? store.submissions.filter((s) => s.room === room) : store.submissions;
  res.set("Cache-Control", "no-store");
  res.json({ count: rows.length, submissions: rows });
});

app.post("/api/reset", (req, res) => {
  if (!requireToken(req, res)) return;
  const room = (req.body && req.body.room) || null;
  if (room === "*" || room === null) {
    store = { submissions: [] };
  } else {
    const target = cleanRoom(room);
    store.submissions = store.submissions.filter((s) => s.room !== target);
  }
  saveData(store);
  res.json({ ok: true, remaining: store.submissions.length });
});

// ---------------------------------------------------------------- Auslieferung

/* Die App liegt unter /quick-check/, damit die relativen Pfade auf ../fonts/
 * und ../images/ identisch zum statischen Deployment auf GitHub Pages sind.
 * Dadurch ist es wirklich dieselbe Datei. */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/", (req, res) => res.redirect("/quick-check/"));

app.listen(PORT, () => {
  console.log("Quick-Check-Backend hört auf Port " + PORT);
  if (!ADMIN_TOKEN) {
    console.warn("WARNUNG: ADMIN_TOKEN ist nicht gesetzt. /api/data und /api/reset sind deaktiviert.");
  }
  if (!ALLOWED_ORIGINS.length) {
    console.log("Hinweis: ALLOWED_ORIGINS ist leer, Zugriffe aus anderen Herkünften werden abgelehnt.");
  }
});
