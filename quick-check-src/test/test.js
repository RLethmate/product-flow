/* Prüfung des LASTA Quick Check: Einzelmodus, Teammodus, Backend.
 *
 * Einmalig einrichten (jsdom bewusst ausserhalb des Dropbox-Ordners, sonst
 * synchronisiert Dropbox tausende Dateien):
 *   mkdir -p ~/.qc-test && cd ~/.qc-test && npm install jsdom
 *
 * Aufruf aus quick-check-src/:
 *   python3 sync.py && NODE_PATH=~/.qc-test/node_modules node test/test.js
 *
 * Geprüft werden die ERZEUGTEN Dateien, nicht die Quellen: nur so ist auch
 * sync.py mit abgedeckt.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { JSDOM } = require("jsdom");

const SRC = path.resolve(__dirname, "..");
const REPO = path.resolve(SRC, "..");
const SOLO_FILE = path.join(REPO, "static", "quick-check", "index.html");
const TEAM_FILE = path.join(SRC, "server", "public", "quick-check", "index.html");
const SERVER_DIR = path.join(SRC, "server");

const soloHtml = fs.readFileSync(SOLO_FILE, "utf8");
const teamHtml = fs.readFileSync(TEAM_FILE, "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function section(t) { console.log("\n" + t); }

const DIMS = ["Leadership", "Alignment", "Steuerung", "Teams", "Architektur"];
const $ = (doc, id) => doc.getElementById(id);
const visible = (doc, id) => !$(doc, id).hidden;
const flat = v => ({ Leadership: v, Alignment: v, Steuerung: v, Teams: v, Architektur: v });
const MIXED = { Leadership: 5, Alignment: 4, Steuerung: 3, Teams: 2, Architektur: 1 };

// ---------------------------------------------------------------- jsdom-Umgebung

function boot(html, opts) {
  opts = opts || {};
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: opts.url || "https://it-team-flow.de/quick-check/",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.scrollTo = function () {};
      window.print = function () { window.__printed = true; };
      window.prompt = function () { return opts.promptValue !== undefined ? opts.promptValue : "tok"; };
      if (opts.seedDraft) window.localStorage.setItem("lasta-quick-check-draft", JSON.stringify(opts.seedDraft));
      window.fetch = function (url, init) {
        calls.push({ url: String(url), init: init || {} });
        if (opts.fetchImpl) return opts.fetchImpl(String(url), init || {});
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, calls };
}

function next(doc, win) {
  $(doc, "form-questions").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
}
function submitContact(doc, win) {
  $(doc, "form-contact").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
}
function answerCurrentStep(doc, win, value) {
  const groups = [...new Set([...doc.querySelectorAll("#questions input[type=radio]")].map(i => i.name))];
  groups.forEach(name => {
    const input = doc.querySelector('input[name="' + name + '"][value="' + value + '"]');
    input.checked = true;
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
  return groups;
}
function answerAllSteps(doc, win, perDim) {
  $(doc, "btn-start").click();
  for (let i = 0; i < DIMS.length; i++) {
    answerCurrentStep(doc, win, perDim[DIMS[i]]);
    next(doc, win);
  }
}
function fillContact(doc, win, over) {
  over = Object.assign({}, over || {});
  const consent = over.consent !== false;
  delete over.consent;
  const vals = Object.assign({
    "c-firstname": "Ralf", "c-lastname": "Lethmate", "c-email": "ralf@example.org",
    "c-phone": "040 4135848 0", "c-company": "it-agile GmbH",
    "c-topic": "Bitte um Beratung", "c-message": "Wir stocken zwischen vier Teams."
  }, over);
  Object.keys(vals).forEach(id => { $(doc, id).value = vals[id]; });
  $(doc, "c-consent").checked = consent;
}
function runSolo(perDim, opts) {
  const ctx = boot(soloHtml, opts);
  answerAllSteps(ctx.doc, ctx.win, perDim);
  $(ctx.doc, "btn-skip").click();
  return ctx;
}

// ================================================================
section("[1] sync.py: beide Ziele stammen aus einer Quelle");
{
  check("Einzelmodus-Datei erzeugt", fs.existsSync(SOLO_FILE));
  check("Teammodus-Datei erzeugt", fs.existsSync(TEAM_FILE));
  check("Erzeugungshinweis im Kopf beider Dateien",
    soloHtml.startsWith("<!-- ERZEUGT von quick-check-src/sync.py") &&
    teamHtml.startsWith("<!-- ERZEUGT von quick-check-src/sync.py"));
  check("Modus im Hinweis benannt",
    soloHtml.includes("(Modus: solo)") && teamHtml.includes("(Modus: team)"));

  const stripHead = s => s.split("\n").slice(1).join("\n");
  const soloBody = stripHead(soloHtml).replace(/<!-- Konfiguration: solo -->[\s\S]*?<\/script>/, "X");
  const teamBody = stripHead(teamHtml).replace(/<!-- Konfiguration: team -->[\s\S]*?<\/script>/, "X");
  check("beide Dateien unterscheiden sich AUSSCHLIESSLICH in der Konfiguration",
    soloBody === teamBody);

  const appJs = fs.readFileSync(path.join(SRC, "app", "app.js"), "utf8");
  const marker = "function overallBandFor(overallMean)";
  check("Logik ist in beiden Zielen dieselbe Quelle",
    appJs.includes(marker) && soloHtml.includes(marker) && teamHtml.includes(marker));
  check("keine nachzuladenden Skripte, Dateien sind selbstenthalten",
    !/<script[^>]+src=/.test(soloHtml) && !/<script[^>]+src=/.test(teamHtml));
  check("Platzhalter vollständig ersetzt",
    !soloHtml.includes("<!--QC_APP-->") && !teamHtml.includes("<!--QC_CONFIG-->"));

  const fontDir = path.join(SERVER_DIR, "public", "fonts");
  ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf"]
    .forEach(f => check("Schrift für Teammodus kopiert: " + f, fs.existsSync(path.join(fontDir, f))));
  check("Favicon für Teammodus kopiert",
    fs.existsSync(path.join(SERVER_DIR, "public", "images", "favicon.png")));
}

// ================================================================
section("[2] Einzelmodus: fünf Schritte");
{
  const { doc, win } = boot(soloHtml);
  check("Intro sichtbar", visible(doc, "screen-intro"));
  check("Intro kündigt Kontaktschritt an", $(doc, "intro-note").textContent.includes("Am Ende fragen wir nach"));
  check("Intro nennt fünf Schritte", $(doc, "intro-note").textContent.includes("fünf Schritten"));
  check("Zähler im Einzelmodus verborgen", $(doc, "counter").hidden);

  $(doc, "btn-start").click();
  check("nur 3 Aussagen gleichzeitig", doc.querySelectorAll("fieldset.q").length === 3);
  check("Fortschritt Dimension 1 von 5", $(doc, "progress").textContent === "Dimension 1 von 5");
  check("Schrittanzeige mit 5 Segmenten", doc.querySelectorAll("#steps li").length === 5);
  check("Erklärsatz nicht im Fragenteil",
    !$(doc, "screen-questions").textContent.includes("Wie Entscheidungen getroffen und Teams"));

  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push($(doc, "dim-title").textContent);
    answerCurrentStep(doc, win, 3);
    if (i === 4) check("letzter Button führt zu Kontaktdaten",
      $(doc, "btn-next").textContent.includes("Kontaktdaten"));
    next(doc, win);
  }
  check("LASTA-Reihenfolge", JSON.stringify(seen) === JSON.stringify(DIMS), seen);
  check("Kontakt-Screen erreicht", visible(doc, "screen-contact"));
}
{
  const { doc, win } = boot(soloHtml);
  $(doc, "btn-start").click();
  next(doc, win);
  check("Weiter ohne Antworten blockiert", $(doc, "dim-title").textContent === "Leadership");
  check("Fehlerhinweis nennt 3 offene", $(doc, "questions-error").textContent.includes("3"));
  answerCurrentStep(doc, win, 5);
  next(doc, win);
  answerCurrentStep(doc, win, 2);
  $(doc, "btn-back").click();
  check("Zurück erhält Antworten",
    [...doc.querySelectorAll("#questions input:checked")].every(i => i.value === "5") &&
    doc.querySelectorAll("#questions input:checked").length === 3);
  next(doc, win);
  check("Vorwärts erhält Antworten",
    [...doc.querySelectorAll("#questions input:checked")].every(i => i.value === "2"));
}

// ================================================================
section("[3] Einzelmodus: Ergebnis, Mittelwert als Leitgröße");
{
  const { doc } = runSolo(MIXED);
  check("Titel Einzelprofil", $(doc, "result-title").textContent === "Dein LASTA-Profil");
  const lead = $(doc, "result-lead").textContent;
  check("Gesamtmittel 3,0 von 5", lead.includes("3,0 von 5"), lead);
  check("Gesamt-Pille teilweise wirksam",
    $(doc, "result-lead").querySelector(".pill").textContent.trim() === "teilweise wirksam",
    $(doc, "result-lead").querySelector(".pill").textContent.trim());
  check("stärkste Dimension", lead.includes("Am stärksten ist Leadership"));
  check("schwächste Dimension", lead.includes("Hebel siehst du bei Architektur"));

  const nums = [...doc.querySelectorAll("#scores-body td.num")].map(t => t.textContent.replace(/\s+/g, " ").trim());
  check("Mittelwerte 5,0 bis 1,0",
    JSON.stringify(nums) === JSON.stringify(["5,0 von 5", "4,0 von 5", "3,0 von 5", "2,0 von 5", "1,0 von 5"]), nums);
  check("Tabellenkopf Dimension/Mittelwert/Einordnung",
    [...doc.querySelectorAll("#scores-head th")].map(t => t.textContent).join("|") ===
    "Dimension|Mittelwert|Einordnung");
  const whole = $(doc, "screen-result").textContent;
  check("keine Punktzahlen im Ergebnis", !/von 15|von 75|Punkte/.test(whole),
    (whole.match(/.{0,40}(von 15|von 75|Punkte).{0,40}/) || [])[0]);
  check("Hinweis auf Momentaufnahme", whole.includes("Momentaufnahme aus deiner Sicht"));
  check("CTA im Einzelmodus sichtbar", !$(doc, "cta-box").hidden);
}

// ================================================================
section("[4] Zonen, Zielscheibe, Balken");
{
  [[1, "Entwicklungsfeld"], [2, "teilweise wirksam"], [3, "teilweise wirksam"],
   [4, "wirksam"], [5, "wirksam"]]
    .forEach(([v, erwartet]) => {
      const { doc } = runSolo(flat(v));
      const p = doc.querySelector("#scores-body .pill").textContent.trim();
      check("Mittelwert " + v + ",0 -> " + erwartet, p === erwartet, p);
    });

  const { doc } = runSolo(MIXED);
  const svg = doc.querySelector("#radar svg");
  check("Querformat 520x440", svg.getAttribute("viewBox") === "0 0 520 440");
  check("keine NaN-Koordinaten", !$(doc, "radar").innerHTML.includes("NaN"));
  const polys = [...doc.querySelectorAll("#radar polygon")];
  check("3 Zonenflächen", polys.filter(p => (p.getAttribute("fill") || "").startsWith("#") &&
    p.getAttribute("fill") !== "none").length === 3);
  check("5 Wertringe", polys.filter(p => p.getAttribute("fill") === "none" &&
    p.getAttribute("stroke") === "#ffffff" && !p.getAttribute("stroke-dasharray")).length === 5);
  check("eine Messreihe im Einzelmodus",
    polys.filter(p => (p.getAttribute("fill") || "").startsWith("rgba")).length === 1);
  check("5 Achsen", doc.querySelectorAll("#radar line").length === 5);
  check("5 Messpunkte", doc.querySelectorAll("#radar circle").length === 5);
  check("10 Texte", doc.querySelectorAll("#radar text").length === 10);
  check("Werte an den Achsen", doc.querySelectorAll("#radar text tspan").length === 5);
  const pts = doc.querySelector('#radar polygon[fill^="rgba"]').getAttribute("points")
    .split(" ").map(p => p.split(",").map(Number));
  check("Leadership 5,0 oben am Aussenring",
    Math.abs(pts[0][0] - 260) < 0.5 && Math.abs(pts[0][1] - 95) < 0.5, pts[0]);
  check("Architektur 1,0 bei einem Fünftel",
    Math.abs(Math.hypot(pts[4][0] - 260, pts[4][1] - 220) - 25) < 0.6);
  check("aria-label mit Werten und Einordnung",
    svg.getAttribute("aria-label").includes("Leadership 5,0 von 5, wirksam") &&
    svg.getAttribute("aria-label").includes("Architektur 1,0 von 5, Entwicklungsfeld"),
    svg.getAttribute("aria-label"));

  const legend = [...doc.querySelectorAll("#zone-legend li")].map(li => li.textContent.replace(/\s+/g, " ").trim());
  check("Legende mit den Grenzen",
    legend.join(" ").includes("unter 2,0") && legend.join(" ").includes("2,0 bis unter 4,0") &&
    legend.join(" ").includes("4,0 und höher"), legend);
  check("Legende mit den Etiketten und aufsteigend sortiert",
    legend[0].startsWith("Entwicklungsfeld") && legend[1].startsWith("teilweise wirksam") &&
    legend[2].startsWith("wirksam"), legend);
  check("Etiketten im Sicherheitsnetz der Tabelle",
    !!doc.querySelector(".table-wrap table.scores"));

  const bars = [...doc.querySelectorAll("#scores-body .bar")];
  check("Balken je Dimension", bars.length === 5);
  check("Zonenbreiten 40/40/20",
    [...bars[0].querySelectorAll(".bar-zone")].map(z => z.style.width).join("|") === "40%|40%|20%");
  check("Marke bei 5,0 rechts", bars[0].querySelector(".bar-mark").style.left === "100%");
  check("Marke bei 3,0 bei 60%", bars[2].querySelector(".bar-mark").style.left === "60%");
}

// ================================================================
section("[5] Gleichstände und Gesamtbewertung");
{
  const a = runSolo({ Leadership: 5, Alignment: 5, Steuerung: 3, Teams: 1, Architektur: 1 });
  const lead = $(a.doc, "result-lead").textContent;
  check("beide schwächsten genannt", lead.includes("Teams und Architektur"));
  check("beide stärksten genannt", lead.includes("Leadership und Alignment"));
  check("Plural", lead.includes("Am stärksten sind"));
  const b = runSolo({ Leadership: 5, Alignment: 4, Steuerung: 2, Teams: 2, Architektur: 2 });
  check("drei mit Komma und und", $(b.doc, "result-lead").textContent.includes("Steuerung, Teams und Architektur"));
  const c = runSolo(flat(3));
  check("kein Hebel bei Gleichstand", $(c.doc, "result-lead").textContent.includes("Alle Dimensionen liegen gleich hoch"));

  check("Mittel 1,0 unterste Stufe",
    $(runSolo(flat(1)).doc, "result-band").textContent.includes("noch viele Möglichkeiten"));
  check("Kent-Beck-Zitat", $(runSolo(flat(1)).doc, "result-band").textContent.includes("Perfect is a Verb"));
  check("Mittel 2,0 mittlere Stufe",
    $(runSolo(flat(2)).doc, "result-band").textContent.includes("schon einiges richtig"));
  check("Mittel 3,0 mittlere Stufe (Grenze)",
    $(runSolo(flat(3)).doc, "result-band").textContent.includes("schon einiges richtig"));
  check("Mittel 4,0 oberste Stufe",
    $(runSolo(flat(4)).doc, "result-band").textContent.includes("viele Dinge richtig"));
  check("Bleibt dran", $(runSolo(flat(5)).doc, "result-band").textContent.includes("Bleibt dran"));
}

// ================================================================
section("[6] Ansatzpunkte nur dort, wo etwas zu holen ist");
{
  // MIXED: Leadership 5,0 und Alignment 4,0 sind wirksam, Steuerung 3,0 und
  // Teams 2,0 teilweise wirksam, Architektur 1,0 ist Entwicklungsfeld.
  const { doc } = runSolo(MIXED);
  const blocks = [...doc.querySelectorAll("#measures .measure")];
  check("nur 3 Blöcke: wirksame Dimensionen ohne Tipps", blocks.length === 3, blocks.length);
  const namen = blocks.map(b => b.querySelector("h3").textContent.trim().split(/\s+/)[0]);
  check("schwächste zuerst", JSON.stringify(namen) === JSON.stringify(["Architektur", "Teams", "Steuerung"]), namen);

  const txt = $(doc, "measures").textContent;
  check("keine Tipps für Leadership (wirksam)", !txt.includes("Delegationpoker"));
  check("keine Tipps für Alignment (wirksam)", !txt.includes("Workflow-Replenishments"));
  check("Tipps für das Entwicklungsfeld", txt.includes("Continuous Integration aufbauen"));
  check("Tipps für teilweise wirksame Dimensionen",
    txt.includes("Flow Review einführen") && txt.includes("Retrospektiven etablieren"));
  check("Einleitung erklärt die Auswahl", txt.includes("noch nicht wirksam"));
  check("je Block drei Ansatzpunkte", blocks.every(b => b.querySelectorAll("li").length === 3));
  check("Erklärsatz der Dimension im Block",
    blocks[0].querySelector(".meta").textContent.includes("Wie unabhängig Teams businessrelevante"));
  check("Einordnungs-Pille je Block", blocks.every(b => !!b.querySelector(".pill")));

  // Durchgehend niedrig: alle fünf Dimensionen bekommen Tipps
  const low = runSolo(flat(1));
  check("bei durchgehend niedrigen Werten 5 Blöcke",
    low.doc.querySelectorAll("#measures .measure").length === 5);
  const alle = $(low.doc, "measures").textContent;
  ["Delegationpoker einführen", "Gemba Walks etablieren", "Entscheidungen in kleinen Gremien treffen",
    "Übergreifende Boards erstellen, die den gesamten Wertstrom abbilden", "Workflow-Replenishments",
    "Gemeinsames Erstellen und Pflegen einer Strategie auf Flight Level 3",
    "Fluss der Arbeit transparent machen", "Flussmetriken etablieren", "Flow Review einführen",
    "Regelmäßige Reflexion über die Zusammenarbeit mit Schnittstellen", "Produktreviews durchführen",
    "Retrospektiven etablieren", "Continuous Integration aufbauen",
    "Testgetriebene Entwicklung anwenden", "Systeme modularisieren"]
    .forEach(t => check("Ansatzpunkt: " + t.slice(0, 38), alle.includes(t)));

  // Grenzfall: genau 4,0 ist wirksam, also kein Tipp
  const grenz = runSolo(flat(4));
  check("Mittelwert genau 4,0 gilt als wirksam, keine Tipps",
    grenz.doc.querySelectorAll("#measures .measure").length === 0);

  // Durchgehend wirksam: keine Blöcke, aber eine Erklärung statt einer Leerstelle
  const high = runSolo(flat(5));
  check("bei durchgehend wirksamen Werten keine Blöcke",
    high.doc.querySelectorAll("#measures .measure").length === 0);
  check("stattdessen ein Hinweis",
    $(high.doc, "measures").textContent.includes("Alle fünf Dimensionen sind wirksam"),
    $(high.doc, "measures").textContent.trim());
  check("Überschrift bleibt stehen", $(high.doc, "measures").textContent.includes("Ansatzpunkte"));

  // Mischung an der Grenze: 3,9 gibt es nicht bei drei Aussagen, aber 3,67
  const knapp = runSolo({ Leadership: 4, Alignment: 4, Steuerung: 4, Teams: 4, Architektur: 3 });
  const knappBlocks = [...knapp.doc.querySelectorAll("#measures .measure")];
  check("nur die einzige nicht wirksame Dimension erhält Tipps",
    knappBlocks.length === 1 &&
    knappBlocks[0].querySelector("h3").textContent.trim().startsWith("Architektur"),
    knappBlocks.map(b => b.querySelector("h3").textContent.trim()));
}

// ================================================================
async function main() {
  section("[7] Einzelmodus: Kontaktdaten und Übertragung");
  {
    const { doc, win } = boot(soloHtml);
    answerAllSteps(doc, win, MIXED);
    const txt = $(doc, "screen-contact").textContent.replace(/\s+/g, " ");
    check("kein unwahres Versprechen", !txt.includes("dann ordnen wir dein Ergebnis ein"));
    check("Ergebnis unabhängig von den Daten", txt.includes("Auf dein Ergebnis hat das keinen Einfluss"));
    submitContact(doc, win);
    check("leeres Formular blockiert", !visible(doc, "screen-result"));
    ["err-firstname", "err-lastname", "err-email", "err-consent"]
      .forEach(id => check("Fehler " + id, !$(doc, id).hidden));
    check("Unternehmen ist optional, kein Fehlerfeld", !doc.getElementById("err-company"));
    fillContact(doc, win, { "c-email": "keine-mail" });
    submitContact(doc, win);
    check("ungültige E-Mail blockiert", !$(doc, "err-email").hidden);
    $(doc, "btn-back-questions").click();
    check("Zurück zur letzten Dimension", $(doc, "dim-title").textContent === "Architektur");
  }
  {
    const { doc, win, calls } = boot(soloHtml);
    answerAllSteps(doc, win, MIXED);
    fillContact(doc, win);
    submitContact(doc, win);
    await new Promise(r => setTimeout(r, 30));
    check("ohne apiBase kein Netzwerkaufruf", calls.length === 0);
    check("Testbetriebs-Hinweis", $(doc, "result-notes").textContent.includes("Testbetrieb"));
  }
  {
    const withApi = soloHtml.replace('apiBase: "",\n  askForContact: true',
      'apiBase: "https://qc.example.org",\n  askForContact: true');
    check("Konfiguration für den Test ersetzbar", withApi !== soloHtml);
    const { doc, win, calls } = boot(withApi);
    answerAllSteps(doc, win, MIXED);
    fillContact(doc, win);
    submitContact(doc, win);
    await new Promise(r => setTimeout(r, 40));
    check("genau ein POST", calls.length === 1, calls.map(c => c.url));
    if (calls.length === 1) {
      check("Ziel /api/submit", calls[0].url === "https://qc.example.org/api/submit");
      const body = JSON.parse(calls[0].init.body);
      check("15 Antworten", Object.keys(body.answers).length === 15);
      check("Kontaktdaten mit Einwilligung",
        body.contact.email === "ralf@example.org" && body.contact.consent === true);
      check("Telefon, Thema und Nachricht übertragen",
        body.contact.phone === "040 4135848 0" &&
        body.contact.topic === "Bitte um Beratung" &&
        body.contact.message === "Wir stocken zwischen vier Teams.", body.contact);
      check("keine Altfelder rolle/teams mehr im Payload",
        body.contact.role === undefined && body.contact.teams === undefined);
      check("Raum mitgesendet", body.room === "default");
      check("Quelle gesetzt", body.source === "it-team-flow.de/quick-check");
    }
    check("Erfolgs-Hinweis", $(doc, "result-notes").textContent.includes("Danke"));
  }
  {
    const withApi = soloHtml.replace('apiBase: ""', 'apiBase: "https://qc.example.org"');
    const { doc, win } = boot(withApi, {
      fetchImpl: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    });
    answerAllSteps(doc, win, MIXED);
    fillContact(doc, win);
    submitContact(doc, win);
    await new Promise(r => setTimeout(r, 40));
    check("Ergebnis trotz Backend-Fehler", visible(doc, "screen-result"));
    check("Fehlerhinweis", $(doc, "result-notes").textContent.includes("konnte nicht übertragen"));
  }
  {
    const { doc, win } = boot(soloHtml);
    answerAllSteps(doc, win, MIXED);
    fillContact(doc, win);
    $(doc, "c-website").value = "http://spam.example";
    submitContact(doc, win);
    await new Promise(r => setTimeout(r, 20));
    check("Honeypot: Ergebnis ohne Übertragung",
      visible(doc, "screen-result") && $(doc, "result-notes").textContent.includes("ohne Kontaktdaten"));
  }

  section("[8] Entwurf fortsetzen");
  {
    const { doc, win } = boot(soloHtml);
    $(doc, "btn-start").click();
    answerCurrentStep(doc, win, 4);
    next(doc, win);
    answerCurrentStep(doc, win, 3);
    next(doc, win);
    const one = doc.querySelector("#questions input[value='2']");
    one.checked = true;
    one.dispatchEvent(new win.Event("change", { bubbles: true }));
    const stored = JSON.parse(win.localStorage.getItem("lasta-quick-check-draft"));
    check("7 Antworten gespeichert", Object.keys(stored.answers).length === 7);
    const { doc: d2 } = boot(soloHtml, { seedDraft: stored });
    check("Fortsetzen sichtbar", !$(d2, "btn-resume").hidden);
    check("nennt Anzahl", $(d2, "btn-resume").textContent.includes("7 von 15"));
    $(d2, "btn-resume").click();
    check("springt zu Steuerung", $(d2, "dim-title").textContent === "Steuerung");
    check("erledigte Schritte markiert",
      [...d2.querySelectorAll("#steps li")].map(l => l.className).slice(0, 2).join("|") === "done|done");
  }

  section("[9] Teammodus: Gruppenmittelwert und eigene Antworten");
  const aggregate = (count, perDim) => {
    const questions = {};
    for (let i = 0; i < 15; i++) questions["q" + i] = perDim[DIMS[Math.floor(i / 3)]];
    return { room: "default", count, questions };
  };
  {
    const teamFetch = (url) => {
      if (url.indexOf("/api/aggregate") !== -1) {
        return Promise.resolve({ ok: true, status: 200,
          json: () => Promise.resolve(aggregate(4, { Leadership: 4, Alignment: 3, Steuerung: 2, Teams: 5, Architektur: 1 })) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    };
    const { doc, win, calls } = boot(teamHtml, {
      url: "https://quick-check.it-team-flow.de/quick-check/?room=wien", fetchImpl: teamFetch
    });
    check("Intro nennt gemeinsames Profil",
      $(doc, "intro-note").textContent.includes("gemeinsamen Profil"));
    check("Intro verspricht keine Kontaktdaten",
      !$(doc, "intro-note").textContent.includes("Kontaktdaten"));

    answerAllSteps(doc, win, MIXED);
    await new Promise(r => setTimeout(r, 60));
    check("kein Kontakt-Screen im Teammodus", !visible(doc, "screen-contact"));
    check("Ergebnis sichtbar", visible(doc, "screen-result"));

    const submit = calls.filter(c => c.url.indexOf("/api/submit") !== -1);
    check("Antworten gesendet", submit.length === 1, calls.map(c => c.url));
    if (submit.length) {
      const body = JSON.parse(submit[0].init.body);
      check("Raum aus der URL übernommen", body.room === "wien", body.room);
      check("keine Kontaktdaten im Teammodus", body.contact === undefined);
      check("relative API-URL bei gleicher Herkunft", submit[0].url === "/api/submit", submit[0].url);
    }
    check("Aggregat abgefragt",
      calls.some(c => c.url === "/api/aggregate?room=wien"), calls.map(c => c.url));

    check("Titel Gruppenprofil", $(doc, "result-title").textContent === "LASTA-Profil der Gruppe");
    const lead = $(doc, "result-lead").textContent;
    check("Gruppenmittel 3,0 von 5", lead.includes("3,0 von 5"), lead);
    check("stärkste Dimension der Gruppe ist Teams", lead.includes("Am stärksten ist Teams"), lead);
    check("Einleitung spricht von der Gruppe", lead.includes("die Einschätzung der Gruppe"));

    const head = [...doc.querySelectorAll("#scores-head th")].map(t => t.textContent).join("|");
    check("Tabelle mit Gruppe und Du", head === "Dimension|Gruppe|Du|Einordnung", head);
    const first = [...doc.querySelectorAll("#scores-body tr")[0].querySelectorAll("td.num")]
      .map(t => t.textContent.replace(/\s+/g, " ").trim());
    check("Leadership: Gruppe 4,0 und eigener Wert 5,0",
      first[0] === "4,0 von 5" && first[1] === "5,0", first);

    check("zwei Messreihen in der Zielscheibe",
      doc.querySelectorAll("#radar polygon[stroke='#ea5d12']").length === 1 &&
      doc.querySelectorAll("#radar polygon[stroke='#55554e']").length === 1);
    check("eigene Reihe gestrichelt",
      doc.querySelector("#radar polygon[stroke='#55554e']").getAttribute("stroke-dasharray") === "6 4");
    check("Achsenwerte folgen der Gruppe",
      [...doc.querySelectorAll("#radar text")].some(t => t.textContent.replace(/\s+/g, " ").trim() === "Leadership 4,0"));
    const legend = [...doc.querySelectorAll("#zone-legend li")].map(l => l.textContent.trim());
    check("Legende nennt Gruppe und eigene Antworten",
      legend.includes("Gruppe") && legend.includes("deine Antworten"), legend);
    // Gruppe: Leadership 4,0 und Teams 5,0 sind wirksam, Alignment 3,0 und
    // Steuerung 2,0 teilweise wirksam, Architektur 1,0 Entwicklungsfeld.
    const mTxt = $(doc, "measures").textContent;
    check("Ansatzpunkte folgen der Gruppe", mTxt.includes("Mittelwert 1,0 von 5"));
    check("nur 3 Blöcke im Teammodus",
      doc.querySelectorAll("#measures .measure").length === 3,
      doc.querySelectorAll("#measures .measure").length);
    check("keine Tipps für wirksame Gruppenwerte",
      !mTxt.includes("Delegationpoker") && !mTxt.includes("Retrospektiven etablieren"));
    check("Filter richtet sich nach der Gruppe, nicht nach den eigenen Antworten",
      // eigener Wert für Teams war 2, Gruppenwert 5: es darf keinen Teams-Block geben
      ![...doc.querySelectorAll("#measures .measure h3")]
        .some(h => h.textContent.trim().startsWith("Teams")));
    check("Etiketten im Teammodus",
      [...doc.querySelectorAll("#scores-body .pill")].map(p => p.textContent.trim()).join("|") ===
      "wirksam|teilweise wirksam|teilweise wirksam|wirksam|Entwicklungsfeld",
      [...doc.querySelectorAll("#scores-body .pill")].map(p => p.textContent.trim()));
    check("Zähler zeigt 4 Rückmeldungen", $(doc, "counter").textContent === "4 Rückmeldungen");
    check("Hinweis nennt Anzahl", $(doc, "result-notes").textContent.includes("4 Rückmeldungen"));
    check("CTA im Teammodus verborgen", $(doc, "cta-box").hidden);
    win.close();
  }

  section("[10] Teammodus: Moderationsansicht mit QR-Code");
  {
    const teamFetch = (url) => {
      if (url.indexOf("/api/aggregate") !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(aggregate(7, flat(4))) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    };
    const { doc, win, calls } = boot(teamHtml, {
      url: "https://quick-check.it-team-flow.de/quick-check/?room=wien&present=1", fetchImpl: teamFetch
    });
    await new Promise(r => setTimeout(r, 40));
    check("Moderationsansicht sichtbar", visible(doc, "screen-present"));
    check("keine Fragen in der Moderationsansicht", !visible(doc, "screen-questions"));
    check("Raumcode angezeigt", $(doc, "present-room").textContent === "wien");
    check("Beitrittsadresse ohne Schema",
      $(doc, "present-url").textContent === "quick-check.it-team-flow.de/quick-check/?room=wien",
      $(doc, "present-url").textContent);
    const img = doc.querySelector("#present-qr img");
    check("QR-Code als Bild eingebunden", !!img);
    check("QR-Endpunkt mit Raum", img.getAttribute("src") === "/api/qr?room=wien", img && img.getAttribute("src"));
    check("QR-Bild mit Alternativtext", img.getAttribute("alt").length > 5);
    check("Anzahl gross dargestellt", $(doc, "present-count").textContent === "7");
    check("Gruppenprofil gezeichnet", !!doc.querySelector("#present-radar svg"));
    check("Tabelle der Moderationsansicht gefüllt",
      doc.querySelectorAll("#present-scores tr").length === 5);
    check("Layout breiter geschaltet", doc.getElementById("main").classList.contains("wide"));
    check("Aggregat abgefragt", calls.some(c => c.url === "/api/aggregate?room=wien"));

    $(doc, "btn-reset").click();
    await new Promise(r => setTimeout(r, 30));
    const reset = calls.filter(c => c.url.indexOf("/api/reset") !== -1);
    check("Zurücksetzen sendet Token im Header",
      reset.length === 1 && reset[0].init.headers["x-admin-token"] === "tok", reset.length);
    check("Zurücksetzen nennt den Raum",
      reset.length === 1 && JSON.parse(reset[0].init.body).room === "wien");
    win.close();
  }
  {
    const { doc, win } = boot(teamHtml, {
      url: "https://qc.example.org/quick-check/?room=wien&present=1",
      promptValue: null,
      fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(aggregate(0, flat(0))) })
    });
    await new Promise(r => setTimeout(r, 30));
    const before = 0;
    $(doc, "btn-reset").click();
    await new Promise(r => setTimeout(r, 20));
    check("abgebrochene Token-Eingabe sendet nichts",
      !$(doc, "present-msg").textContent.length, $(doc, "present-msg").textContent);
    check("Hinweis bei null Rückmeldungen",
      $(doc, "present-hint").textContent.includes("Noch keine Rückmeldungen"));
    win.close();
  }

  section("[11] Backend: echter Server");
  const PORT = 31739;
  const DATA = path.join(require("os").tmpdir(), "qc-test-" + Date.now() + ".json");
  const TOKEN = "test-token-123";
  const srv = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_FILE: DATA, ADMIN_TOKEN: TOKEN,
      ALLOWED_ORIGINS: "https://it-team-flow.de",
      PUBLIC_URL: "https://quick-check.it-team-flow.de"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let srvOut = "";
  srv.stdout.on("data", d => { srvOut += d; });
  srv.stderr.on("data", d => { srvOut += d; });

  const base = "http://127.0.0.1:" + PORT;
  const ready = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(base + "/api/aggregate?room=probe");
        if (r.ok) return true;
      } catch (e) { /* noch nicht bereit */ }
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  })();
  check("Server gestartet", ready, srvOut.slice(0, 300));

  if (ready) {
    const answersFor = v => {
      const a = {};
      for (let i = 0; i < 15; i++) a["q" + i] = v;
      return a;
    };
    const post = (p, body, headers) => fetch(base + p, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: JSON.stringify(body)
    });

    let r = await post("/api/submit", { id: "a1", room: "wien", answers: answersFor(4) });
    check("gültige Einreichung angenommen", r.status === 200 && (await r.json()).ok === true);

    r = await post("/api/submit", { id: "a1", room: "wien", answers: answersFor(2) });
    check("gleiche id wird nicht doppelt gezählt", (await r.json()).alreadyExists === true);

    r = await post("/api/submit", { id: "a2", room: "wien", answers: answersFor(2) });
    check("zweite Einreichung angenommen", r.status === 200);

    r = await post("/api/submit", { id: "b1", room: "hamburg", answers: answersFor(5) });
    check("Einreichung in anderem Raum angenommen", r.status === 200);

    for (const [label, body] of [
      ["Wert 0", { id: "x1", answers: { q0: 0 } }],
      ["Wert 6", { id: "x2", answers: { q0: 6 } }],
      ["Kommazahl", { id: "x3", answers: { q0: 3.5 } }],
      ["Text statt Zahl", { id: "x4", answers: { q0: "4" } }],
      ["unbekannter Schlüssel", { id: "x5", answers: { foo: 4 } }],
      ["leere Antworten", { id: "x6", answers: {} }],
      ["Antworten kein Objekt", { id: "x7", answers: [4, 4] }]
    ]) {
      const res = await post("/api/submit", body);
      check("abgelehnt: " + label, res.status === 400, res.status);
    }
    r = await post("/api/submit", { answers: answersFor(3) });
    check("abgelehnt: fehlende id", r.status === 400);

    r = await fetch(base + "/api/aggregate?room=wien");
    const agg = await r.json();
    check("Aggregat zählt 2 Rückmeldungen", agg.count === 2, agg.count);
    check("Aggregat mittelt je Frage korrekt", agg.questions.q0 === 3 && agg.questions.q14 === 3, agg.questions.q0);
    check("Aggregat enthält alle 15 Fragen", Object.keys(agg.questions).length === 15);
    check("Aggregat liefert KEINE Rohdaten", agg.submissions === undefined && agg.contact === undefined);
    check("Aggregat nicht zwischengespeichert", r.headers.get("cache-control") === "no-store");

    r = await fetch(base + "/api/aggregate?room=hamburg");
    const agg2 = await r.json();
    check("Räume sind getrennt", agg2.count === 1 && agg2.questions.q0 === 5, agg2);

    r = await fetch(base + "/api/aggregate");
    check("Standardraum ist leer", (await r.json()).count === 0);

    // Kontaktdaten: Bereinigung
    r = await post("/api/submit", {
      id: "lead1", room: "public", answers: answersFor(3),
      contact: {
        firstname: "Ralf", lastname: "L", email: "r@example.org",
        phone: "040 4135848 0", company: "it-agile", topic: "Bitte um Beratung",
        message: "M".repeat(5000), consent: true,
        boesesFeld: "sollte verschwinden", company2: "x".repeat(500)
      },
      source: "it-team-flow.de/quick-check"
    });
    check("Einreichung mit Kontaktdaten angenommen", r.status === 200);

    r = await post("/api/submit", { id: "lead2", answers: answersFor(3), contact: "kein objekt" });
    check("abgelehnt: Kontaktdaten kein Objekt", r.status === 400, r.status);

    r = await fetch(base + "/api/data");
    check("Rohdaten ohne Token abgelehnt", r.status === 401, r.status);
    r = await fetch(base + "/api/data", { headers: { "x-admin-token": "falsch" } });
    check("Rohdaten mit falschem Token abgelehnt", r.status === 401);

    r = await fetch(base + "/api/data", { headers: { "x-admin-token": TOKEN } });
    check("Rohdaten mit Token abrufbar", r.status === 200);
    const data = await r.json();
    const lead = data.submissions.find(s => s.id === "lead1");
    check("Kontaktdaten gespeichert", lead && lead.contact.email === "r@example.org");
    check("Telefon gespeichert", lead && lead.contact.phone === "040 4135848 0");
    check("Thema gespeichert", lead && lead.contact.topic === "Bitte um Beratung");
    check("unbekanntes Feld verworfen", lead && lead.contact.boesesFeld === undefined);
    check("überlanges unbekanntes Feld verworfen", lead && lead.contact.company2 === undefined);
    check("Freitext auf 4000 Zeichen gekappt",
      lead && lead.contact.message.length === 4000, lead && lead.contact.message.length);
    check("Einwilligung als Wahrheitswert", lead && lead.contact.consent === true);
    check("Zeitstempel gesetzt", lead && typeof lead.ts === "number");
    check("Raum gespeichert", lead && lead.room === "public");
    check("Antworten im Teamraum ohne Kontaktdaten",
      data.submissions.find(s => s.id === "a1").contact === undefined);

    r = await post("/api/submit", {
      id: "lead2b", room: "public", answers: answersFor(4),
      contact: { firstname: "A", lastname: "B", email: "a@b.de", message: "kurz", consent: true }
    });
    check("Einreichung mit leeren optionalen Feldern angenommen", r.status === 200);
    const d2 = await (await fetch(base + "/api/data?room=public",
      { headers: { "x-admin-token": TOKEN } })).json();
    const l2 = d2.submissions.find(x => x.id === "lead2b");
    check("kurzer Freitext unverändert gespeichert", l2 && l2.contact.message === "kurz");
    check("nicht gesendete Felder fehlen einfach",
      l2 && l2.contact.phone === undefined && l2 && l2.contact.topic === undefined);

    r = await fetch(base + "/api/data?room=wien", { headers: { "x-admin-token": TOKEN } });
    check("Rohdaten nach Raum filterbar", (await r.json()).count === 2);

    // QR-Code
    r = await fetch(base + "/api/qr?room=wien");
    const svgText = await r.text();
    check("QR-Code ausgeliefert", r.status === 200);
    check("QR als SVG", (r.headers.get("content-type") || "").indexOf("image/svg+xml") === 0,
      r.headers.get("content-type"));
    check("QR enthält SVG-Inhalt", svgText.indexOf("<svg") !== -1 && svgText.indexOf("</svg>") !== -1);
    check("QR hat Modulraster", /viewBox="0 0 (\d+) \1"/.test(svgText), svgText.slice(0, 120));
    const svg2 = await (await fetch(base + "/api/qr?room=wien")).text();
    check("QR ist für denselben Raum stabil", svgText === svg2);
    const svg3 = await (await fetch(base + "/api/qr?room=hamburg")).text();
    check("QR unterscheidet sich je Raum", svgText !== svg3);

    // CORS
    r = await fetch(base + "/api/submit", {
      method: "OPTIONS", headers: { origin: "https://it-team-flow.de" }
    });
    check("Vorabanfrage erlaubter Herkunft", r.status === 204 &&
      r.headers.get("access-control-allow-origin") === "https://it-team-flow.de",
      r.headers.get("access-control-allow-origin"));
    r = await fetch(base + "/api/submit", {
      method: "OPTIONS", headers: { origin: "https://boese.example" }
    });
    check("fremde Herkunft erhält keine Freigabe",
      r.headers.get("access-control-allow-origin") === null);

    // Auslieferung der App
    r = await fetch(base + "/quick-check/");
    const page = await r.text();
    check("App unter /quick-check/ ausgeliefert", r.status === 200);
    check("ausgelieferte App ist die Teamvariante", page.includes('mode: "team"'));
    check("Schriften erreichbar",
      (await fetch(base + "/fonts/NotoSans-Regular.ttf")).status === 200);
    r = await fetch(base + "/", { redirect: "manual" });
    check("Wurzel leitet auf /quick-check/", r.status === 302 && r.headers.get("location") === "/quick-check/",
      r.status + " " + r.headers.get("location"));

    // Zurücksetzen
    r = await post("/api/reset", { room: "wien" });
    check("Zurücksetzen ohne Token abgelehnt", r.status === 401);
    r = await post("/api/reset", { room: "wien" }, { "x-admin-token": TOKEN });
    check("Raum zurückgesetzt", r.status === 200);
    check("nur dieser Raum ist leer",
      (await (await fetch(base + "/api/aggregate?room=wien")).json()).count === 0 &&
      (await (await fetch(base + "/api/aggregate?room=hamburg")).json()).count === 1);
    r = await post("/api/reset", { room: "*" }, { "x-admin-token": TOKEN });
    check("Alles zurücksetzen", r.status === 200 && (await r.json()).remaining === 0);

    check("Datendatei angelegt", fs.existsSync(DATA));
  }

  srv.kill("SIGTERM");
  try { fs.unlinkSync(DATA); } catch (e) { }

  section("[12] Backend ohne ADMIN_TOKEN verweigert Rohdaten");
  {
    const PORT2 = PORT + 1;
    const DATA2 = DATA + ".2";
    const srv2 = spawn(process.execPath, ["server.js"], {
      cwd: SERVER_DIR,
      env: Object.assign({}, process.env, { PORT: String(PORT2), DATA_FILE: DATA2, ADMIN_TOKEN: "" }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out2 = "";
    srv2.stdout.on("data", d => { out2 += d; });
    srv2.stderr.on("data", d => { out2 += d; });
    const b2 = "http://127.0.0.1:" + PORT2;
    let up = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(b2 + "/api/aggregate")).ok) { up = true; break; } } catch (e) { }
      await new Promise(r => setTimeout(r, 100));
    }
    check("Server ohne Token gestartet", up);
    if (up) {
      check("Rohdaten gesperrt statt offen", (await fetch(b2 + "/api/data")).status === 503);
      const r = await fetch(b2 + "/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      check("Zurücksetzen gesperrt", r.status === 503);
      check("Einreichen funktioniert weiterhin",
        (await fetch(b2 + "/api/submit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "z1", answers: { q0: 3 } })
        })).status === 200);
      check("Warnung im Protokoll", out2.includes("ADMIN_TOKEN ist nicht gesetzt"), out2.slice(0, 200));
    }
    srv2.kill("SIGTERM");
    try { fs.unlinkSync(DATA2); } catch (e) { }
  }

  section("[13] Kontaktformular deckt sich mit it-agile.de/kontakt/");
  {
    const { doc } = boot(soloHtml);
    const label = (id) => (doc.querySelector('label[for="' + id + '"]') || {}).textContent || "";
    const norm = (t) => t.replace(/\s+/g, " ").trim();

    // Beschriftungen wörtlich wie im Powermail-Formular auf it-agile.de
    check("Beschriftung Vorname", norm(label("c-firstname")) === "Vorname *", norm(label("c-firstname")));
    check("Beschriftung Nachname", norm(label("c-lastname")) === "Nachname *");
    check("Beschriftung E-Mail", norm(label("c-email")) === "E-Mail *");
    check("Beschriftung Telefon", norm(label("c-phone")) === "Telefon");
    check("Beschriftung des Themenfelds",
      norm(label("c-topic")) === "Womit können wir Dir helfen?", norm(label("c-topic")));
    check("Platzhalter des Telefonfelds wie dort",
      $(doc, "c-phone").getAttribute("placeholder") === "Telefon für schnellsten Kontakt");

    // Auswahlliste exakt wie dort
    const optionen = [...$(doc, "c-topic").options].map(o => o.textContent);
    check("Auswahlliste identisch zu it-agile.de",
      JSON.stringify(optionen) === JSON.stringify(["Bitte wählen", "Frage zu einer Schulung",
        "Frage zu einem Angebot", "Bitte um Beratung", "Organisatorische Frage", "Sonstiges"]), optionen);

    // Einwilligungstext wörtlich
    const cons = norm(label("c-consent"));
    check("Einwilligungstext wörtlich übernommen",
      cons.startsWith("Ich willige in die Verarbeitung meiner Daten durch die it-agile GmbH ein und habe die Datenschutzerklärung zur Kenntnis genommen."),
      cons);
    check("Datenschutzerklärung im Einwilligungstext verlinkt",
      !!doc.querySelector('label[for="c-consent"] a[href="../datenschutz.html"]'));
    check("Hinweis auf Pflichtfelder wie dort",
      norm($(doc, "screen-contact").textContent).includes("* Benötigte Angaben"));

    // Freitextfeld und Spam-Falle
    check("Freitextfeld vorhanden", $(doc, "c-message").tagName === "TEXTAREA");
    check("Freitextfeld ausdrücklich optional", label("c-message").includes("optional"));
    check("Spam-Falle mit der Beschriftung von dort",
      label("c-website").includes("Don't fill this field!"), norm(label("c-website")));
    check("Spam-Falle für Screenreader und Tastatur ausgenommen",
      $(doc, "c-website").getAttribute("tabindex") === "-1" &&
      $(doc, "c-website").closest("[aria-hidden]").getAttribute("aria-hidden") === "true");

    // Felder, die es dort NICHT gibt, sind auch hier weg
    check("kein Rollenfeld mehr", !doc.getElementById("c-role"));
    check("kein Teamanzahl-Feld mehr", !doc.getElementById("c-teams"));
  }

  section("[14] Webinar-Verweis der Landingpage");
  {
    /* Die sechs Webinar-Schaltflaechen ziehen ihre Adresse aus einer einzigen
     * Einstellung. Der Zoom-Link war tot (HTTP 404) und ist auskommentiert,
     * damit er wiederzufinden ist. */
    const toml = fs.readFileSync(path.join(REPO, "hugo.toml"), "utf8");
    const aktiv = toml.split("\n").filter(l => !l.trim().startsWith("#"));
    const zeile = aktiv.find(l => l.includes("webinar_url"));
    check("genau eine aktive Webinar-Einstellung",
      aktiv.filter(l => l.includes("webinar_url")).length === 1, zeile);
    const wert = ((zeile || "").match(/webinar_url\s*=\s*"([^"]*)"/) || [])[1];
    check("Einstellung hat einen Wert", !!wert && wert.length > 8, wert);
    check("Wert ist eine absolute Adresse oder ein mailto",
      /^(https:\/\/|mailto:)/.test(wert || ""), wert);
    /* Diese Anmeldung lief unbemerkt auf HTTP 404. Sie darf nie wieder aktiv
     * eingetragen sein. */
    check("die als tot bekannte Anmeldung ist nicht eingetragen",
      !(wert || "").includes("WN_N_4awQcYTfu5N10W7sXCcw"), wert);

    const quellen = ["layouts", "content"];
    quellen.forEach((d) => {
      const treffer = [];
      const walk = (p2) => fs.readdirSync(p2, { withFileTypes: true }).forEach((e) => {
        const full = path.join(p2, e.name);
        if (e.isDirectory()) return walk(full);
        if (!/\.(html|md)$/.test(e.name)) return;
        if (fs.readFileSync(full, "utf8").includes("us02web.zoom.us")) treffer.push(full);
      });
      walk(path.join(REPO, d));
      check("keine fest verdrahtete Zoom-URL in " + d + "/", treffer.length === 0, treffer);
    });
  }

  section("[15] Auffindbarkeit und Linkvorschau des Quick Checks");
  {
    const { doc } = boot(soloHtml);
    const meta = (sel) => (doc.querySelector(sel) || {}).content;

    const toml = fs.readFileSync(path.join(REPO, "hugo.toml"), "utf8");
    const basis = (toml.match(/^\s*baseURL\s*=\s*['"]([^'"]+)['"]/m) || [])[1].replace(/\/$/, "");
    check("Basisadresse aus hugo.toml gelesen", !!basis && basis.startsWith("https://"), basis);
    check("kein Platzhalter im erzeugten Stand",
      !soloHtml.includes("__QC_BASE__") && !teamHtml.includes("__QC_BASE__"));

    const kanonisch = (doc.querySelector('link[rel=canonical]') || {}).href;
    check("kanonische Adresse gesetzt", kanonisch === basis + "/quick-check/", kanonisch);
    check("og:url gesetzt", meta('meta[property="og:url"]') === basis + "/quick-check/",
      meta('meta[property="og:url"]'));

    /* Linkvorschauen in Slack, LinkedIn und Co. brauchen ein Bild mit
     * absoluter Adresse, sonst erscheint beim Teilen nur Text. */
    const bild = meta('meta[property="og:image"]');
    check("og:image gesetzt und absolut", !!bild && bild.startsWith(basis + "/images/"), bild);
    if (bild) {
      const rel = bild.slice(basis.length + 1);
      check("og:image liegt im Repo", fs.existsSync(path.join(REPO, "static", rel)), rel);
    }
    /* Die angegebenen Masse muessen zur Datei passen. Aus der Datei gelesen,
     * damit die Angaben nicht auseinanderlaufen, wenn das Bild getauscht wird. */
    if (bild) {
      const roh = fs.readFileSync(path.join(REPO, "static", bild.slice(basis.length + 1)));
      const istPng = roh.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
      check("Vorschaubild ist ein PNG", istPng);
      if (istPng) {
        const bw = roh.readUInt32BE(16), bh = roh.readUInt32BE(20);
        check("Bildmaße stimmen mit der Datei überein",
          meta('meta[property="og:image:width"]') === String(bw) &&
          meta('meta[property="og:image:height"]') === String(bh),
          { datei: bw + "x" + bh,
            deklariert: meta('meta[property="og:image:width"]') + "x" +
                        meta('meta[property="og:image:height"]') });
        /* Linkvorschauen schneiden auf etwa 1,91 zu 1. Deutlich abweichende
         * Verhaeltnisse werden oben und unten beschnitten. */
        const v = bw / bh;
        check("Seitenverhältnis für Linkvorschauen geeignet",
          v > 1.7 && v < 2.1, v.toFixed(2));
      }
    }
    check("Alternativtext für das Vorschaubild", !!meta('meta[property="og:image:alt"]'));
    check("og:site_name gesetzt", !!meta('meta[property="og:site_name"]'));

    check("Twitter-Karte als große Vorschau",
      meta('meta[name="twitter:card"]') === "summary_large_image");
    check("twitter:image absolut", (meta('meta[name="twitter:image"]') || "").startsWith(basis));
    check("twitter:title und -description gesetzt",
      !!meta('meta[name="twitter:title"]') && !!meta('meta[name="twitter:description"]'));

    check("Beschreibung vorhanden",
      (meta('meta[name=description]') || "").length > 40, meta('meta[name=description]'));

    /* Der Quick Check liegt unter static/ und ist damit keine Hugo-Seite. Ohne
     * eigenen Eintrag fehlt er in der Sitemap, also fuer Suchmaschinen. */
    const smPfad = path.join(REPO, "layouts", "sitemap.xml");
    check("eigene Sitemap-Vorlage vorhanden", fs.existsSync(smPfad));
    if (fs.existsSync(smPfad)) {
      const sm = fs.readFileSync(smPfad, "utf8");
      check("Sitemap führt den Quick Check ausdrücklich", /quick-check\/"\s*\|\s*absURL/.test(sm), sm.match(/.{0,40}quick-check.{0,40}/));
      check("Sitemap listet weiterhin alle Hugo-Seiten", /range\s+\.Data\.Pages/.test(sm));
    }
  }

  section("[16] Übersichtsgrafiken der Startseite");
  {
    const idx = fs.readFileSync(path.join(REPO, "layouts", "index.html"), "utf8");
    const css = fs.readFileSync(path.join(REPO, "static", "css",
      "it-agile-flow-staging.css"), "utf8");

    const dateien = ["ita-flow-uebersicht-1-problem.svg",
                     "ita-flow-uebersicht-2-angebot.svg",
                     "ita-flow-uebersicht-3-loesung.svg"];
    dateien.forEach((f) => {
      const p2 = path.join(REPO, "static", "images", f);
      check("vorhanden: " + f, fs.existsSync(p2));
      if (!fs.existsSync(p2)) return;
      const t = fs.readFileSync(p2, "utf8");
      check("gültiges SVG mit Querformatangabe: " + f,
        t.startsWith("<svg") && /viewBox="0 0 1080 900"/.test(t));
      check("in index.html verlinkt: " + f, idx.includes("images/" + f));
    });

    check("keine alten Rastergrafiken mehr in den Vorlagen",
      !/Uebersichtsgrafik[^"]*\.jpg/.test(idx));
    check("kein srcset mehr für die Übersichtsgrafiken",
      !/srcset="[^"]*Uebersichtsgrafik/.test(idx));

    /* Entscheidend: .graphic-2 und .graphic-3 stehen im CSS auf opacity 0 und
     * werden ausschliesslich ueber die Webflow-Interaktionen eingeblendet.
     * Fehlt data-w-id, bleiben zwei der drei Grafiken dauerhaft unsichtbar. */
    ["graphic-2", "graphic-3"].forEach((k) => {
      const regel = css.match(new RegExp("\\." + k + "\\s*\\{[^}]*\\}"));
      check(k + " startet unsichtbar, braucht also die Interaktion",
        !!regel && /opacity:\s*0/.test(regel[0]), regel && regel[0]);
    });
    ["19a90117-dc2f-8216-f6ff-0c727589fbb4",
     "2324877a-faf4-6829-62e0-8018dadf5e53",
     "f889bd12-266c-4dbe-693b-5301ea117374"].forEach((id) => {
      check("Interaktions-ID erhalten: " + id.slice(0, 8), idx.includes('data-w-id="' + id + '"'));
    });

    // Informative Grafiken brauchen Alternativtexte, vorher stand dort alt=""
    const bilder = idx.match(/<img[^>]*ita-flow-uebersicht[^>]*>/g) || [];
    check("drei Grafiken im Markup", bilder.length === 3, bilder.length);
    bilder.forEach((b, i) => {
      const alt = (b.match(/alt="([^"]*)"/) || [])[1] || "";
      check("Alternativtext bei Grafik " + (i + 1) + " (" + alt.length + " Zeichen)",
        alt.length > 60, alt.slice(0, 50));
    });
  }

  section("[17] Fremdnetze und Skripte der Landingpage");
  {
    const crypto = require("crypto");
    const lies = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
    const alleVorlagen = [];
    const walkV = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) return walkV(full);
      if (/\.(html|md)$/.test(e.name)) alleVorlagen.push(full);
    });
    walkV(path.join(REPO, "layouts"));
    walkV(path.join(REPO, "content"));

    /* Die Seite lud jQuery aus einem Webflow-Netz. Bei jedem Aufruf ging damit
     * die IP-Adresse der Besucherin an einen Dritten. Die Datei liegt jetzt
     * lokal, byteweise dieselbe. */
    const fremd = alleVorlagen.filter((f) =>
      /d3e54v103j8qbb|cloudfront\.net/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(REPO, f));
    check("kein Verweis auf das Webflow-Netz mehr", fremd.length === 0, fremd);

    const jq = path.join(REPO, "static", "js", "jquery-3.5.1.min.js");
    check("jQuery liegt lokal", fs.existsSync(jq));
    if (fs.existsSync(jq)) {
      const summe = crypto.createHash("sha256").update(fs.readFileSync(jq)).digest("hex");
      /* Exakt dieselbe Datei wie von code.jquery.com und wie die bisherige
       * Fassung aus dem Webflow-Netz, am 03.09.2026 gegen beide verglichen. */
      check("jQuery ist unverändertes 3.5.1",
        summe === "f7f6a5894f1d19ddad6fa392b2ece2c5e578cbf7da4ea805b6885eb6985b6e3d", summe);
    }

    /* Reihenfolge zaehlt: der Webflow-Laufzeitcode greift auf window.jQuery zu
     * und muss danach geladen werden. */
    const start = lies("layouts/index.html");
    const posJq = start.indexOf("jquery-3.5.1.min.js");
    const posWf = start.indexOf("it-agile-flow-staging.js");
    check("Startseite lädt jQuery", posJq > -1);
    check("Startseite lädt den Webflow-Laufzeitcode", posWf > -1);
    check("jQuery wird vor dem Laufzeitcode geladen", posJq > -1 && posJq < posWf,
      { jquery: posJq, laufzeit: posWf });

    /* Die Startseite hat verborgene Startzustaende (opacity:0, translate3d).
     * Ohne den Laufzeitcode blieben diese Elemente unsichtbar. Diese Pruefung
     * verhindert, dass der Code dort versehentlich entfernt wird. */
    const verborgen = (start.match(/opacity:\s*0|translate3d/g) || []).length;
    check("Startseite hat verborgene Startzustände, braucht den Laufzeitcode",
      verborgen > 10 && posWf > -1, verborgen);

    /* Seiten ohne Interaktionen und ohne verborgene Zustaende sollen die
     * beiden Skripte nicht laden. Zusammen rund 305 KB je Aufruf. */
    ["layouts/404.html", "layouts/danke.html", "layouts/blog/single.html",
      "layouts/_default/impressum.html", "layouts/_default/datenschutz.html"].forEach((rel) => {
        const t = lies(rel);
        const hatVerborgene = /opacity:\s*0|translate3d/.test(t);
        const hatSlider = /w-slider/.test(t);
        check("ohne verborgene Zustände und Slider: " + rel,
          !hatVerborgene && !hatSlider, { verborgen: hatVerborgene, slider: hatSlider });
        check("lädt weder jQuery noch Laufzeitcode: " + rel,
          !/jquery|it-agile-flow-staging\.js/.test(t));
      });
  }

  section("[18] Verlinkungen, Assets, Barrierefreiheit");
  {
    const { doc } = boot(soloHtml);

    /* Kernprüfung: JEDER seiteninterne Link muss auf etwas zeigen, das im Repo
     * auch entsteht. Nur zu prüfen, ob eine Quelldatei existiert, reicht nicht:
     * Hugo bestimmt die Adresse über das Frontmatter-Feld "url". Genau daran ist
     * der Datenschutz-Link zuvor gescheitert (../datenschutz/ statt
     * ../datenschutz.html). */
    function frontmatterUrls() {
      const out = new Map();      // Adresse -> Quelldatei
      const eigen = new Set();    // Quelldateien MIT eigener Adresse
      const dir = path.join(REPO, "content");
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const full = path.join(d, e.name);
        if (e.isDirectory()) return walk(full);
        if (!/\.(md|html)$/.test(e.name)) return;
        const head = fs.readFileSync(full, "utf8").split("---")[1] || "";
        const m = head.match(/^\s*url:\s*(\S+)\s*$/m);
        if (m) {
          out.set(m[1].replace(/^\//, ""), path.relative(REPO, full));
          eigen.add(path.resolve(full));
        }
      });
      walk(dir);
      return { out, eigen };
    }

    const { out: urls, eigen: eigeneAdresse } = frontmatterUrls();
    check("Frontmatter-Adressen gefunden", urls.size >= 2, [...urls.keys()]);

    /** Loest einen "../"-Link gegen die Wurzel der Hugo-Site auf. */
    function resolves(href) {
      if (!href.startsWith("../")) return null;         // extern oder anders
      const target = href.slice(3);
      if (target === "") return "Startseite (layouts/index.html)";
      if (urls.has(target)) return "Frontmatter: " + urls.get(target);
      const asStatic = path.join(REPO, "static", target);
      if (fs.existsSync(asStatic)) return "static/" + target;
      /* Hugos Standardadresse gilt nur, wenn die Seite KEINE eigene Adresse im
       * Frontmatter deklariert. Sonst waere ../datenschutz/ scheinbar gueltig,
       * obwohl ausgeliefert wird unter ../datenschutz.html. */
      const asPage = path.join(REPO, "content", target.replace(/\/$/, "") + ".md");
      if (fs.existsSync(asPage)) {
        if (eigeneAdresse.has(path.resolve(asPage))) return false;
        return "content/" + target.replace(/\/$/, "") + ".md";
      }
      const asIndex = path.join(REPO, "content", target.replace(/\/$/, ""), "_index.md");
      if (fs.existsSync(asIndex)) return "content/" + target + "_index.md";
      return false;
    }

    const interne = [...doc.querySelectorAll("[href], [src]")]
      .map(el => el.getAttribute("href") || el.getAttribute("src"))
      .filter(h => h && h.startsWith("../"));
    check("seiteninterne Links vorhanden", interne.length >= 3, interne);
    interne.forEach((h) => {
      const r = resolves(h);
      check("Link löst auf: " + h, !!r, r === false ? "KEIN ZIEL IM REPO" : r);
    });

    const links = [...doc.querySelectorAll("a[href]")].map(a => a.getAttribute("href"));
    const dsUrl = [...urls.keys()].find(u => /datenschutz/.test(u));
    check("Datenschutzseite hat eine Frontmatter-Adresse", !!dsUrl, dsUrl);
    check("Datenschutz-Link zeigt genau darauf", links.includes("../" + dsUrl),
      { erwartet: "../" + dsUrl, gefunden: links.filter(l => /datenschutz/.test(l)) });
    check("kein Link auf das nicht existierende ../datenschutz/",
      !links.includes("../datenschutz/"));
    check("Calendly verlinkt", links.includes("https://calendly.com/it-agile?l=kontaktseite"));
    check("Whitepaper verlinkt",
      links.some(l => l.includes("ITA-Flowoptimierung-Whitepaper-2025.pdf")));
    check("Startseite verlinkt", links.includes("../"));

    check("externe Links mit rel=noopener",
      [...doc.querySelectorAll('a[target="_blank"]')]
        .every(a => (a.getAttribute("rel") || "").includes("noopener")));
    check("lang=de", doc.documentElement.getAttribute("lang") === "de");
    check("Viewport-Meta", !!doc.querySelector("meta[name=viewport]"));
    check("keine externen Ressourcen",
      [...doc.querySelectorAll("script[src], link[rel=stylesheet]")].length === 0);
    check("alle Formularfelder mit Label",
      [...doc.querySelectorAll("#form-contact input, #form-contact select, #form-contact textarea")]
        .filter(el => el.type !== "hidden")
        .every(el => !!doc.querySelector('label[for="' + el.id + '"]')));
    check("Pflichtfelder als required markiert",
      ["c-firstname", "c-lastname", "c-email", "c-consent"].every(id => $(doc, id).required));
    check("optionale Felder nicht als required markiert",
      ["c-company", "c-phone", "c-topic", "c-message"].every(id => !$(doc, id).required));
    check("Fortschritt mit aria-live", !!doc.querySelector("#progress[aria-live]"));
    check("Schrittanzeige für Screenreader ausgeblendet",
      doc.querySelector("#steps").getAttribute("aria-hidden") === "true");
    check("Tabelle in eigenem Scrollbereich", !!doc.querySelector(".table-wrap table.scores"));

    /* Auch die Dokumente, die die Landingpage selbst verlinkt, muessen liegen.
     * Sie stehen in den Hugo-Vorlagen, nicht in der Quick-Check-Seite, und
     * waeren sonst von keiner Pruefung erfasst. */
    const vorlagen = [];
    const walkT = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) return walkT(full);
      if (/\.(html|md)$/.test(e.name)) vorlagen.push(full);
    });
    walkT(path.join(REPO, "layouts"));
    walkT(path.join(REPO, "content"));

    /* Pfade werden je nach Ort unterschiedlich geschrieben: direkt als
     * href="images/x.svg", in Vorlagen als {{ relURL "images/x.svg" }}, in
     * Inhaltsdateien als {{< asset "images/x.svg" >}} und in srcset-Listen
     * mehrfach hintereinander. Deshalb wird nicht auf die Schreibweise
     * gesucht, sondern auf pfadartige Vorkommen selbst. */
    const dokumente = new Set();
    vorlagen.forEach((f) => {
      /* Externe Adressen zuerst entfernen: die Seite laedt jQuery von einem
       * fremden Netz, und darin steckt ebenfalls ein "js/..."-Pfad, der
       * natuerlich nicht unter static/ liegt. */
      const t = fs.readFileSync(f, "utf8").replace(/https?:\/\/[^"'\s)]+/g, "");
      (t.match(/(?:documents|images|fonts|css|js)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g) || [])
        .forEach((rel) => dokumente.add(rel));
    });
    check("verlinkte Dateien in den Vorlagen gefunden", dokumente.size > 5, dokumente.size);

    /* Kernpruefung gegen den Fehler, der die Blog-Seite auf dem Fork
     * unformatiert liess: absolute Pfade brechen, sobald die Seite unter einem
     * Unterpfad liegt. Alle Vorlagen bis auf eine benutzten schon relative
     * Pfade, diese eine fiel jahrelang nicht auf, weil die echte Domain in der
     * Wurzel liegt. */
    const absolut = [];
    vorlagen.forEach((f) => {
      const t = fs.readFileSync(f, "utf8");
      /* Bewusst OHNE Positivliste: die erste Fassung dieser Pruefung deckte nur
       * css, images und js ab und liess /impressum.html und /datenschutz.html
       * durchgehen, die genauso brechen. Jeder wurzelbezogene Verweis zaehlt,
       * ausser protokollrelativen (//host/...). */
      const treffer = t.match(/(?:href|src)="\/(?!\/)[^"]*"/g);
      if (treffer) absolut.push(path.relative(REPO, f) + ": " + treffer.join(", "));
    });
    check("keine absoluten Pfade in Vorlagen und Inhalten", absolut.length === 0, absolut);

    /* Der Quick Check ersetzt das Typeform. Ein zurueckbleibender Verweis
     * wuerde Besucher weiter auf den alten Fragebogen fuehren. */
    const mitTypeform = vorlagen.filter((f) =>
      /typeform/i.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(REPO, f));
    check("kein Verweis auf Typeform mehr", mitTypeform.length === 0, mitTypeform);

    // Die neue Seite muss von der Site aus erreichbar sein, nicht nur per Adresse.
    const eintraege = fs.readFileSync(path.join(REPO, "content", "blog_entries.md"), "utf8");
    check("Quick Check ist von der Startseite aus verlinkt",
      /url:\s*"quick-check\/"/.test(eintraege));
    [...dokumente].sort().forEach((rel) => {
      check("in static/ vorhanden: " + rel,
        fs.existsSync(path.join(REPO, "static", rel)));
    });

    // Das Angebots-PDF ausdruecklich, weil es der Haupt-Download der Seite ist.
    const angebot = path.join(REPO, "static", "documents", "UnserFlowAngebot.pdf");
    check("Angebots-PDF vorhanden", fs.existsSync(angebot));
    if (fs.existsSync(angebot)) {
      const roh = fs.readFileSync(angebot);
      check("Angebots-PDF ist ein gueltiges PDF",
        roh.subarray(0, 5).toString() === "%PDF-" &&
        roh.subarray(roh.length - 6).toString().includes("%%EOF"));
      check("Angebots-PDF nicht leer", roh.length > 50000, roh.length);
    }

    ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf"]
      .forEach(f => check("Schrift im Repo: " + f,
        fs.existsSync(path.join(REPO, "static", "fonts", f))));
    check("Favicon im Repo", fs.existsSync(path.join(REPO, "static", "images", "favicon.png")));
  }

  console.log("\n=======================================");
  console.log("  " + pass + " Prüfungen bestanden, " + fail + " fehlgeschlagen");
  console.log("=======================================");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
