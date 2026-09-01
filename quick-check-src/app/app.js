/* LASTA Quick Check – gemeinsame Logik für Einzel- und Teammodus.
 *
 * Der Modus kommt aus window.QC_CONFIG (siehe config.solo.js / config.team.js):
 *   mode: "solo"  Eine Person, eigenes Ergebnis, optional Kontaktdaten als Lead.
 *   mode: "team"  Mehrere Personen über QR-Code, Ergebnis ist der Mittelwert
 *                 der Gruppe und aktualisiert sich laufend.
 *
 * Diese Datei wird von sync.py in beide Deployments eingesetzt. Änderungen
 * gehören immer hierher, nie in die erzeugten Dateien unter static/ oder
 * server/public/.
 */
(function () {
  "use strict";

  // =====================================================================
  // MODUS UND KONFIGURATION
  // =====================================================================

  var CFG = window.QC_CONFIG || {};
  var MODE = CFG.mode === "team" ? "team" : "solo";
  var API = (CFG.apiBase || "").replace(/\/+$/, "");
  var POLL_MS = CFG.pollMs || 3000;
  var STORAGE_KEY = "lasta-quick-check-draft";

  // Im Teammodus liefert immer ein Backend die Seite aus, dann ist ein leerer
  // apiBase gleichbedeutend mit "gleiche Herkunft". Im Einzelmodus bedeutet ein
  // leerer apiBase dagegen: kein Backend, es wird nichts übertragen.
  var HAS_BACKEND = MODE === "team" ? true : !!CFG.apiBase;
  var ASK_FOR_CONTACT = MODE === "solo" && CFG.askForContact !== false;

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }

  var ROOM = (param("room") || CFG.room || "default").slice(0, 40);
  var PRESENT = MODE === "team" && param("present") === "1";

  // =====================================================================
  // FRAGEBOGEN
  // =====================================================================

  var DIMENSIONS = ["Leadership", "Alignment", "Steuerung", "Teams", "Architektur"];

  // Erklärung der Dimensionen. Bewusst NICHT im Fragenteil, sondern erst im
  // Ergebnis: eine vorangestellte Definition rahmt die Antwort und verschiebt
  // sie von "trifft diese Aussage zu" zu "wie gut sind wir in der Kategorie".
  var DIM_INTRO = {
    Leadership: "Wie Entscheidungen getroffen und Teams geführt werden.",
    Alignment: "Wie klar Initiativen und Ziele im Unternehmen verbunden sind.",
    Steuerung: "Wie gut Arbeit und Abhängigkeiten über Teams hinweg gesteuert werden.",
    Teams: "Wie die Teams selbst arbeiten und sich verbessern.",
    Architektur: "Wie unabhängig Teams businessrelevante Funktionen liefern können."
  };

  var QUESTIONS = [
    { dim: "Leadership", text: "Entscheidungen haben den Kunden im Fokus." },
    { dim: "Leadership", text: "Wir übernehmen Verantwortung für Entscheidungen." },
    { dim: "Leadership", text: "Führung fokussiert Mitarbeiter und Teams." },

    { dim: "Alignment", text: "Allen ist klar, welche Initiativen in deinem Unternehmen im Fokus stehen." },
    { dim: "Alignment", text: "Deine Teams wissen genau, wie ihre Arbeit auf Initiativen einzahlt." },
    { dim: "Alignment", text: "Teams und Abteilungen unterstützen sich bei der Erreichung von Zielen." },

    { dim: "Steuerung", text: "Die anfallende Arbeit bekommen wir in der Regel gut abgearbeitet." },
    { dim: "Steuerung", text: "Der Arbeitsablauf wird wertschöpfungsübergreifend optimiert." },
    { dim: "Steuerung", text: "Abhängigkeiten sind bekannt und werden frühzeitig adressiert." },

    { dim: "Teams", text: "Eure Teams kennen die Kundenerwartungen." },
    { dim: "Teams", text: "Eure Teams reflektieren regelmäßig über teaminterne Verbesserungsmöglichkeiten." },
    { dim: "Teams", text: "Deine Teams gehen Probleme teamübergreifend an." },

    { dim: "Architektur", text: "Businessrelevante Funktionalitäten werden nach der Übergabe an ein anderes Team ohne Stocken sofort weiterentwickelt." },
    { dim: "Architektur", text: "Jedes Team kann unabhängig von anderen Teams businessrelevante Funktionen in die Produktion überführen." },
    { dim: "Architektur", text: "Unsere Teams liefern gemeinsam alle 1–2 Sprints businessrelevante Funktionen in die Produktion." }
  ].map(function (q, i) { q.id = "q" + i; return q; });

  // Beschriftung wie im bisherigen Typeform: nur die drei Anker sind benannt.
  var SCALE = [
    { v: 1, label: "Stimme gar nicht zu" },
    { v: 2, label: "" },
    { v: 3, label: "Weder noch" },
    { v: 4, label: "" },
    { v: 5, label: "Stimme voll und ganz zu" }
  ];

  // Zonen der Zielscheibe. "inclusive" legt fest, ob der obere Randwert noch zur
  // Zone gehört. "tragfähig" beginnt bewusst erst bei 4,0: bei Selbstauskunft
  // über die eigene Organisation ist durchgängige Zustimmung der häufigste Fall,
  // mildere Schwellen liefern dann kein verwertbares Ergebnis.
  var ZONES = [
    { key: "low", to: 2, inclusive: false, fill: "#f4ded9", label: "Entwicklungsfeld", range: "unter 2,0" },
    { key: "mid", to: 4, inclusive: false, fill: "#f9ecd6", label: "teilweise wirksam", range: "2,0 bis unter 4,0" },
    { key: "high", to: 5, inclusive: true, fill: "#e3ede1", label: "wirksam", range: "4,0 und höher" }
  ];

  function zoneFor(value) {
    for (var i = 0; i < ZONES.length; i++) {
      var z = ZONES[i];
      if (z.inclusive ? value <= z.to : value < z.to) return z;
    }
    return ZONES[ZONES.length - 1];
  }

  // Gesamtbewertung. Texte wörtlich aus dem bisherigen Typeform, Grenzen aus
  // dessen Punktelogik (Gesamtscore 15 bis 75 über 15 Aussagen). Gerechnet wird
  // über den Mittelwert, damit dieselbe Einordnung auch für Gruppenmittelwerte
  // gilt; angezeigt werden Punkte nicht, sie sind exakt das Dreifache des
  // Mittelwerts und damit eine zweite Einheit für dieselbe Größe.
  var OVERALL_BANDS = [
    {
      maxPoints: 29,
      title: "Ihr scheint in Euren Teams noch viele Möglichkeiten zu haben, an denen Ihr anpacken könnt.",
      text: "Wirf die Flinte nicht ins Korn. Oder um es mit Kent Beck zu sagen: „Perfect is a Verb.“"
    },
    {
      maxPoints: 45,
      title: "Ihr scheint schon einiges richtig zu machen, bleibt am Ball!",
      text: ""
    },
    {
      maxPoints: 75,
      title: "Nicht schlecht, Ihr scheint viele Dinge richtig zu machen.",
      text: "Bleibt dran."
    }
  ];

  function overallBandFor(overallMean) {
    var points = overallMean * QUESTIONS.length;
    for (var i = 0; i < OVERALL_BANDS.length; i++) {
      if (points <= OVERALL_BANDS[i].maxPoints) return OVERALL_BANDS[i];
    }
    return OVERALL_BANDS[OVERALL_BANDS.length - 1];
  }

  // Ansatzpunkte je Dimension, wörtlich aus dem bisherigen Typeform.
  var MEASURES = {
    Leadership: [
      "Delegationpoker einführen",
      "Gemba Walks etablieren",
      "Entscheidungen in kleinen Gremien treffen"
    ],
    Alignment: [
      "Übergreifende Boards erstellen, die den gesamten Wertstrom abbilden",
      "Workflow-Replenishments",
      "Gemeinsames Erstellen und Pflegen einer Strategie auf Flight Level 3"
    ],
    Steuerung: [
      "Fluss der Arbeit transparent machen",
      "Flussmetriken etablieren",
      "Flow Review einführen"
    ],
    Teams: [
      "Regelmäßige Reflexion über die Zusammenarbeit mit Schnittstellen",
      "Produktreviews durchführen",
      "Retrospektiven etablieren"
    ],
    Architektur: [
      "Continuous Integration aufbauen",
      "Testgetriebene Entwicklung anwenden",
      "Systeme modularisieren"
    ]
  };

  // =====================================================================
  // HILFSFUNKTIONEN
  // =====================================================================

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmt(v) { return v.toFixed(1).replace(".", ","); }

  function joinAnd(list) {
    if (list.length === 1) return esc(list[0]);
    return list.slice(0, -1).map(esc).join(", ") + " und " + esc(list[list.length - 1]);
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function questionsOf(dim) {
    return QUESTIONS.filter(function (q) { return q.dim === dim; });
  }

  function isStepComplete(i) {
    return questionsOf(DIMENSIONS[i]).every(function (q) { return typeof answers[q.id] === "number"; });
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return d && d.answers && typeof d.answers === "object" ? d : null;
    } catch (e) { return null; }
  }

  function writeDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ answers: answers, ts: Date.now() }));
    } catch (e) { /* privates Fenster o. ä. – kein Problem */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  }

  function api(path) { return API + path; }

  // =====================================================================
  // AUSWERTUNG
  // =====================================================================

  /** Mittelwerte je Dimension aus einem Antwortobjekt {q0: 4, ...}. */
  function scoresFromAnswers(ans) {
    var sums = {}, counts = {}, avg = {};
    DIMENSIONS.forEach(function (d) { sums[d] = 0; counts[d] = 0; });
    QUESTIONS.forEach(function (q) {
      var v = ans[q.id];
      if (typeof v === "number") { sums[q.dim] += v; counts[q.dim] += 1; }
    });
    DIMENSIONS.forEach(function (d) { avg[d] = counts[d] ? sums[d] / counts[d] : 0; });
    return withOverall(avg);
  }

  /* Mittelwerte je Dimension aus den Fragen-Mittelwerten des Backends.
   * Das Backend aggregiert absichtlich nur je Frage und kennt die Dimensionen
   * nicht: sonst müsste der Fragebogen an zwei Stellen gepflegt werden. */
  function scoresFromQuestionMeans(qMeans) {
    var sums = {}, counts = {}, avg = {};
    DIMENSIONS.forEach(function (d) { sums[d] = 0; counts[d] = 0; });
    QUESTIONS.forEach(function (q) {
      var v = qMeans[q.id];
      if (typeof v === "number") { sums[q.dim] += v; counts[q.dim] += 1; }
    });
    DIMENSIONS.forEach(function (d) { avg[d] = counts[d] ? sums[d] / counts[d] : 0; });
    return withOverall(avg);
  }

  /** Ergänzt ein Mittelwert-Objekt um den Gesamtmittelwert. */
  function withOverall(avg) {
    var values = DIMENSIONS.map(function (d) { return avg[d] || 0; });
    return {
      avg: avg,
      overall: values.reduce(function (a, b) { return a + b; }, 0) / values.length
    };
  }

  // =====================================================================
  // ZIELSCHEIBE
  // =====================================================================

  /* series: Liste von { avg, fill, stroke, dash, label, dots }.
   * Das erste Element ist die Leitreihe: es bestimmt die Werte an den Achsen
   * und die Beschreibung für Screenreader. */
  function renderRadar(targetId, legendId, series) {
    var w = 520, h = 440, cx = w / 2, cy = h / 2, R = 125;
    var n = DIMENSIONS.length;
    var primary = series[0].avg;

    function point(i, r) {
      var a = (Math.PI * 2 * i) / n - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }

    function ring(value) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var p = point(i, (R * value) / 5);
        pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
      }
      return pts.join(" ");
    }

    function polyFor(avg) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var p = point(i, (R * (avg[DIMENSIONS[i]] || 0)) / 5);
        pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
      }
      return pts;
    }

    var described = DIMENSIONS.map(function (d) {
      return d + " " + fmt(primary[d] || 0) + " von 5, " + zoneFor(primary[d] || 0).label;
    }).join(". ");

    var svg = '<svg viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="Zielscheibe der fünf LASTA-Dimensionen. ' + esc(described) + '">';

    // Bewertungszonen, von außen nach innen gemalt
    ZONES.slice().reverse().forEach(function (z) {
      svg += '<polygon points="' + ring(z.to) + '" fill="' + z.fill + '"/>';
    });

    // Ringe für die Werte 1 bis 5
    for (var lvl = 1; lvl <= 5; lvl++) {
      svg += '<polygon points="' + ring(lvl) + '" fill="none" stroke="#ffffff" stroke-width="1.5"/>';
    }

    // Zonengrenzen hervorheben
    ZONES.forEach(function (z) {
      if (z.to < 5) {
        svg += '<polygon points="' + ring(z.to) +
          '" fill="none" stroke="#9d9d8c" stroke-width="1" stroke-dasharray="4 3"/>';
      }
    });

    // Achsen
    for (var i2 = 0; i2 < n; i2++) {
      var pa = point(i2, R);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + pa[0].toFixed(1) + '" y2="' + pa[1].toFixed(1) +
        '" stroke="#ffffff" stroke-width="1.5"/>';
    }

    // Messreihen, hintere zuerst
    series.slice().reverse().forEach(function (s) {
      var pts = polyFor(s.avg);
      svg += '<polygon points="' + pts.join(" ") + '" fill="' + (s.fill || "none") +
        '" stroke="' + s.stroke + '" stroke-width="2.5"' +
        (s.dash ? ' stroke-dasharray="' + s.dash + '"' : "") + "/>";
      if (s.dots) {
        pts.forEach(function (pt) {
          var xy = pt.split(",");
          svg += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="5" fill="' + s.stroke +
            '" stroke="#ffffff" stroke-width="1.5"/>';
        });
      }
    });

    // Ringzahlen auf der senkrechten Achse nach unten: dort verläuft bei fünf
    // Achsen keine Speiche, es gibt also keine Überdeckung.
    for (var lvl2 = 1; lvl2 <= 5; lvl2++) {
      svg += '<text x="' + cx + '" y="' + (cy + (R * lvl2) / 5 + 4).toFixed(1) +
        '" text-anchor="middle" font-size="11" fill="#55554e" paint-order="stroke" stroke="#ffffff" ' +
        'stroke-width="3.5" stroke-linejoin="round">' + lvl2 + "</text>";
    }

    // Achsenbeschriftung mit dem Wert der Leitreihe
    for (var i4 = 0; i4 < n; i4++) {
      var d = DIMENSIONS[i4];
      var pl = point(i4, R + 26);
      var anchor = "middle";
      if (pl[0] > cx + 6) anchor = "start";
      else if (pl[0] < cx - 6) anchor = "end";
      svg += '<text x="' + pl[0].toFixed(1) + '" y="' + (pl[1] + 5).toFixed(1) + '" text-anchor="' + anchor +
        '" font-size="15" font-weight="700" fill="#222">' + esc(d) +
        ' <tspan font-weight="400" font-size="13.5" fill="#55554e">' + fmt(primary[d] || 0) + "</tspan></text>";
    }

    svg += "</svg>";
    $(targetId).innerHTML = svg;

    if (legendId) {
      var leg = ZONES.map(function (z) {
        return '<li><span class="swatch" style="background:' + z.fill + '"></span>' +
          esc(z.label) + ' <span class="muted">(' + esc(z.range) + ")</span></li>";
      }).join("");
      series.forEach(function (s) {
        leg += '<li><span class="swatch ' + s.swatch + '"></span>' + esc(s.label) + "</li>";
      });
      $(legendId).innerHTML = leg;
    }
  }

  /** Balken mit Zonenhintergrund und Marke beim Messwert. */
  function barHtml(value) {
    var html = '<div class="bar" aria-hidden="true">';
    var prev = 0;
    ZONES.forEach(function (z) {
      html += '<span class="bar-zone" style="width:' + (((z.to - prev) / 5) * 100).toFixed(1) +
        "%;background:" + z.fill + '"></span>';
      prev = z.to;
    });
    html += '<span class="bar-mark" style="left:' + ((value / 5) * 100).toFixed(1) + '%"></span>';
    return html + "</div>";
  }

  /* series wie bei renderRadar. Bei zwei Reihen bekommt die Tabelle eine
   * zusätzliche Spalte; die Einordnung richtet sich stets nach der Leitreihe. */
  function renderScores(bodyId, headId, series) {
    if (headId) {
      var head = '<th scope="col">Dimension</th>';
      series.forEach(function (s) {
        head += '<th scope="col" style="text-align:right">' + esc(s.column) + "</th>";
      });
      head += '<th scope="col" style="text-align:right">Einordnung</th>';
      $(headId).innerHTML = head;
    }

    $(bodyId).innerHTML = DIMENSIONS.map(function (d) {
      var v = series[0].avg[d] || 0;
      var z = zoneFor(v);
      var row = '<td><span class="dim-name">' + esc(d) + "</span>" + barHtml(v) + "</td>";
      series.forEach(function (s, i) {
        row += '<td class="num' + (i ? " secondary" : "") + '">' + fmt(s.avg[d] || 0) +
          (i ? "" : " <small>von 5</small>") + "</td>";
      });
      row += '<td class="pill-cell"><span class="pill pill-' + z.key + '">' + esc(z.label) + "</span></td>";
      return "<tr>" + row + "</tr>";
    }).join("");
  }

  function renderMeasures(containerId, avg) {
    /* Ansatzpunkte nur dort, wo etwas zu holen ist: für Entwicklungsfelder und
     * für teilweise wirksame Dimensionen. Was wirksam ist, braucht keinen Tipp. */
    var order = DIMENSIONS.filter(function (d) {
      return zoneFor(avg[d] || 0).key !== "high";
    }).sort(function (a, b) {
      var diff = (avg[a] || 0) - (avg[b] || 0);
      return diff !== 0 ? diff : DIMENSIONS.indexOf(a) - DIMENSIONS.indexOf(b);
    });

    var html = "<h2>Ansatzpunkte</h2>";
    if (!order.length) {
      html += '<p class="muted">Alle fünf Dimensionen sind wirksam. Ansatzpunkte nennen wir nur dort, ' +
        "wo zuerst etwas zu holen ist.</p>";
      $(containerId).innerHTML = html;
      return;
    }

    html += '<p class="muted">Nur für die Dimensionen, die noch nicht wirksam sind – die mit dem ' +
      "niedrigsten Wert zuerst. Das sind erste Ansatzpunkte, keine fertige Maßnahmenplanung.</p>";

    order.forEach(function (d) {
      var v = avg[d] || 0;
      var z = zoneFor(v);
      html += '<div class="measure">';
      html += "<h3>" + esc(d) + ' <span class="pill pill-' + z.key + '">' + esc(z.label) + "</span></h3>";
      html += '<p class="meta">' + esc(DIM_INTRO[d]) + " Mittelwert " + fmt(v) + " von 5.</p>";
      html += "<ul>" + MEASURES[d].map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
      html += "</div>";
    });

    $(containerId).innerHTML = html;
  }

  /** Einleitungssatz mit Stärken, Hebeln und vollständig genannten Gleichständen. */
  function leadText(sc, subject) {
    var values = DIMENSIONS.map(function (d) { return sc.avg[d] || 0; });
    var minVal = Math.min.apply(null, values);
    var maxVal = Math.max.apply(null, values);
    var lowest = DIMENSIONS.filter(function (d) { return (sc.avg[d] || 0) === minVal; });
    var highest = DIMENSIONS.filter(function (d) { return (sc.avg[d] || 0) === maxVal; });
    var z = zoneFor(sc.overall);

    var out = "Über alle fünf Dimensionen liegt " + subject + " im Mittel bei <strong>" +
      fmt(sc.overall) + " von 5</strong> – <span class=\"pill pill-" + z.key + '">' + esc(z.label) + "</span>. ";

    if (lowest.length === DIMENSIONS.length) {
      out += "Alle Dimensionen liegen gleich hoch, ein einzelner Hebel sticht damit nicht heraus.";
    } else {
      out += (highest.length > 1 ? "Am stärksten sind <strong>" : "Am stärksten ist <strong>") +
        joinAnd(highest) + "</strong>, ";
      out += lowest.length > 1
        ? "den größten Hebel siehst du bei <strong>" + joinAnd(lowest) +
          "</strong> – dort liegen mehrere Dimensionen gleich niedrig."
        : "den größten Hebel siehst du bei <strong>" + joinAnd(lowest) + "</strong>.";
    }
    return out;
  }

  // =====================================================================
  // ZUSTAND UND NAVIGATION
  // =====================================================================

  var answers = {};
  var step = 0;
  var submitted = false;
  var groupData = null;   // { count, avg } aus /api/aggregate
  var pollTimer = null;
  var SCREENS = ["screen-intro", "screen-questions", "screen-contact", "screen-result", "screen-present"];

  function show(id) {
    SCREENS.forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
    updateProgress(id);
  }

  function updateProgress(id) {
    var stepsEl = $("steps");
    if (id === "screen-questions") {
      $("progress").textContent = "Dimension " + (step + 1) + " von " + DIMENSIONS.length;
      stepsEl.hidden = false;
      stepsEl.innerHTML = DIMENSIONS.map(function (d, i) {
        var cls = i === step ? "current" : (isStepComplete(i) ? "done" : "");
        return '<li class="' + cls + '"></li>';
      }).join("");
    } else {
      stepsEl.hidden = true;
      $("progress").textContent = id === "screen-contact" ? "Kontaktdaten"
        : (id === "screen-result" ? "Ergebnis" : (id === "screen-present" ? "Moderation" : ""));
    }
    updateCounter();
  }

  function updateCounter() {
    var el = $("counter");
    if (MODE !== "team" || !groupData) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = groupData.count === 1 ? "1 Rückmeldung" : groupData.count + " Rückmeldungen";
  }

  // =====================================================================
  // FRAGEN RENDERN
  // =====================================================================

  function renderStep() {
    var dim = DIMENSIONS[step];
    $("dim-letter").textContent = dim.charAt(0);
    $("dim-title").textContent = dim;
    $("questions-error").hidden = true;

    var html = "";
    questionsOf(dim).forEach(function (q) {
      html += '<fieldset class="q" id="fs-' + q.id + '">';
      html += "<legend>" + esc(q.text) + "</legend>";
      html += '<div class="scale">';
      SCALE.forEach(function (st) {
        var aria = st.label ? st.v + " – " + st.label : st.v + " von 5";
        var checked = answers[q.id] === st.v ? " checked" : "";
        html += '<label><input type="radio" name="' + q.id + '" value="' + st.v +
          '" aria-label="' + esc(aria) + '"' + checked + ">" +
          '<span class="scale-inner"><span class="scale-num">' + st.v + "</span>" +
          (st.label ? '<span class="scale-txt">' + esc(st.label) + "</span>" : "") +
          "</span></label>";
      });
      html += "</div>";
      html += '<div class="scale-anchors" aria-hidden="true"><span>Stimme gar nicht zu</span>' +
        "<span>Stimme voll und ganz zu</span></div>";
      html += "</fieldset>";
    });

    $("questions").innerHTML = html;
    $("btn-next").textContent = step === DIMENSIONS.length - 1
      ? (ASK_FOR_CONTACT ? "Weiter zu den Kontaktdaten" : "Ergebnis anzeigen")
      : "Weiter";
    $("btn-back").textContent = step === 0 ? "Zurück zum Start" : "Zurück: " + DIMENSIONS[step - 1];
  }

  function goToStep(i) {
    step = Math.max(0, Math.min(DIMENSIONS.length - 1, i));
    renderStep();
    show("screen-questions");
  }

  // =====================================================================
  // ERGEBNIS
  // =====================================================================

  function renderResultSolo(submitState) {
    var sc = scoresFromAnswers(answers);
    $("result-title").textContent = "Dein LASTA-Profil";
    $("result-lead").innerHTML = leadText(sc, "deine Einschätzung");

    var band = overallBandFor(sc.overall);
    $("result-band").innerHTML = "<p><strong>" + esc(band.title) + "</strong></p>" +
      (band.text ? "<p>" + esc(band.text) + "</p>" : "");

    var series = [{
      avg: sc.avg, fill: "rgba(234,93,18,0.30)", stroke: "#ea5d12", dots: true,
      label: "deine Werte", column: "Mittelwert", swatch: "swatch-group"
    }];
    renderRadar("radar", "zone-legend", series);
    renderScores("scores-body", "scores-head", series);
    renderMeasures("measures", sc.avg);

    $("result-disclaimer").textContent =
      "Momentaufnahme aus deiner Sicht, keine Messung. Sie zeigt, wo sich ein genauerer Blick lohnt.";
    $("scores-note").textContent =
      "Je Dimension drei Aussagen. Gezeigt ist der Mittelwert auf der Skala 1 bis 5.";

    var notes = "";
    if (submitState === "sent") {
      notes = '<div class="notice">Danke. Wir haben deine Angaben erhalten und melden uns.</div>';
    } else if (submitState === "static") {
      notes = '<div class="notice"><strong>Testbetrieb:</strong> Diese Seite läuft ohne Backend. ' +
        "Dein Ergebnis wurde nur in deinem Browser berechnet, es wurde nichts übertragen und nichts gespeichert.</div>";
    } else if (submitState === "skipped") {
      notes = '<div class="notice">Du hast den Check ohne Kontaktdaten abgeschlossen. Es wurde nichts übertragen.</div>';
    } else if (submitState === "failed") {
      notes = '<div class="notice">Dein Ergebnis konnte nicht übertragen werden. Es steht dir hier trotzdem ' +
        "vollständig zur Verfügung.</div>";
    }
    $("result-notes").innerHTML = notes;
  }

  function renderResultTeam() {
    var own = scoresFromAnswers(answers);
    var group = groupData ? withOverall(groupData.avg) : own;
    var count = groupData ? groupData.count : 1;

    $("result-title").textContent = "LASTA-Profil der Gruppe";
    $("result-lead").innerHTML = leadText(group, "die Einschätzung der Gruppe");

    var band = overallBandFor(group.overall);
    $("result-band").innerHTML = "<p><strong>" + esc(band.title) + "</strong></p>" +
      (band.text ? "<p>" + esc(band.text) + "</p>" : "");

    var series = [{
      avg: group.avg, fill: "rgba(234,93,18,0.30)", stroke: "#ea5d12", dots: true,
      label: "Gruppe", column: "Gruppe", swatch: "swatch-group"
    }, {
      avg: own.avg, fill: "none", stroke: "#55554e", dash: "6 4", dots: false,
      label: "deine Antworten", column: "Du", swatch: "swatch-own"
    }];
    renderRadar("radar", "zone-legend", series);
    renderScores("scores-body", "scores-head", series);
    renderMeasures("measures", group.avg);

    $("result-disclaimer").textContent = "Momentaufnahme aus Sicht der Teilnehmenden, keine Messung.";
    $("scores-note").textContent = "Je Dimension drei Aussagen, Skala 1 bis 5. Der Gruppenwert ist der " +
      "Mittelwert über alle Rückmeldungen und aktualisiert sich laufend.";
    $("result-notes").innerHTML = '<div class="notice">Dein Beitrag ist eingegangen. Das Profil beruht auf ' +
      (count === 1 ? "einer Rückmeldung" : count + " Rückmeldungen") + " und aktualisiert sich automatisch.</div>";

    $("cta-box").hidden = true;
    $("btn-restart").hidden = true;
  }

  function renderPresent() {
    var group = groupData ? withOverall(groupData.avg) : withOverall(
      DIMENSIONS.reduce(function (o, d) { o[d] = 0; return o; }, {}));
    var count = groupData ? groupData.count : 0;

    $("present-count").textContent = count;
    $("present-count-label").textContent = count === 1 ? "Rückmeldung" : "Rückmeldungen";
    $("present-room").textContent = ROOM;

    var joinUrl = window.location.origin + window.location.pathname +
      "?room=" + encodeURIComponent(ROOM);
    $("present-url").textContent = joinUrl.replace(/^https?:\/\//, "");
    $("present-qr").innerHTML = '<img alt="QR-Code zum Mitmachen" src="' +
      esc(api("/api/qr?room=" + encodeURIComponent(ROOM))) + '">';

    var series = [{
      avg: group.avg, fill: "rgba(234,93,18,0.30)", stroke: "#ea5d12", dots: true,
      label: "Gruppe", column: "Mittelwert", swatch: "swatch-group"
    }];
    renderRadar("present-radar", "present-legend", series);
    renderScores("present-scores", null, series);

    $("present-hint").textContent = count === 0
      ? "Noch keine Rückmeldungen. Das Diagramm aktualisiert sich automatisch."
      : "Das Diagramm aktualisiert sich automatisch.";
  }

  function refreshView() {
    if (PRESENT) renderPresent();
    else if (MODE === "team" && submitted) renderResultTeam();
  }

  // =====================================================================
  // BACKEND
  // =====================================================================

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json();
    });
  }

  function loadAggregate() {
    if (!HAS_BACKEND) return Promise.resolve(null);
    return fetchJson(api("/api/aggregate?room=" + encodeURIComponent(ROOM))).then(function (d) {
      groupData = { count: d.count || 0, avg: scoresFromQuestionMeans(d.questions || {}).avg };
      updateCounter();
      refreshView();
      return groupData;
    }).catch(function (e) {
      if (window.console) console.warn("[Quick Check] Gruppendaten nicht abrufbar:", e);
      return null;
    });
  }

  function startPolling() {
    if (!HAS_BACKEND || pollTimer) return;
    pollTimer = setInterval(loadAggregate, POLL_MS);
  }

  function submitAnswers(contact) {
    var payload = {
      id: uuid(),
      answers: answers,
      room: ROOM,
      source: MODE === "team" ? "quick-check/team" : "it-team-flow.de/quick-check"
    };
    if (contact) payload.contact = contact;

    if (!HAS_BACKEND) {
      if (window.console) console.info("[Quick Check] Kein Backend konfiguriert. Nicht gesendet:", payload);
      return Promise.resolve("static");
    }

    return fetch(api("/api/submit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("http_" + r.status);
      return "sent";
    }).catch(function (e) {
      if (window.console) console.warn("[Quick Check] Senden fehlgeschlagen:", e);
      return "failed";
    });
  }

  // =====================================================================
  // VALIDIERUNG
  // =====================================================================

  function validateStep() {
    var qs = questionsOf(DIMENSIONS[step]);
    var missing = qs.filter(function (q) { return typeof answers[q.id] !== "number"; });
    qs.forEach(function (q) { $("fs-" + q.id).classList.remove("missing"); });

    var box = $("questions-error");
    if (!missing.length) {
      box.hidden = true;
      return true;
    }
    missing.forEach(function (q) { $("fs-" + q.id).classList.add("missing"); });
    box.hidden = false;
    box.innerHTML = missing.length === 1
      ? "Eine Aussage ist noch offen. Sie ist hervorgehoben."
      : "Es sind noch <strong>" + missing.length + "</strong> Aussagen offen. Sie sind hervorgehoben.";
    $("fs-" + missing[0].id).scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  function setFieldError(inputId, errId, message) {
    var input = $(inputId), err = $(errId);
    if (message) {
      input.setAttribute("aria-invalid", "true");
      err.hidden = false;
      err.textContent = message;
    } else {
      input.removeAttribute("aria-invalid");
      err.hidden = true;
      err.textContent = "";
    }
  }

  function collectContact() {
    return {
      firstname: $("c-firstname").value.trim(),
      lastname: $("c-lastname").value.trim(),
      email: $("c-email").value.trim(),
      company: $("c-company").value.trim(),
      role: $("c-role").value,
      teams: $("c-teams").value,
      consent: $("c-consent").checked
    };
  }

  function validateContact() {
    var ok = true;
    var c = collectContact();

    setFieldError("c-firstname", "err-firstname", c.firstname ? "" : "Bitte gib deinen Vornamen an.");
    if (!c.firstname) ok = false;

    setFieldError("c-lastname", "err-lastname", c.lastname ? "" : "Bitte gib deinen Nachnamen an.");
    if (!c.lastname) ok = false;

    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email);
    setFieldError("c-email", "err-email", emailOk ? "" : "Bitte gib eine gültige E-Mail-Adresse an.");
    if (!emailOk) ok = false;

    setFieldError("c-company", "err-company", c.company ? "" : "Bitte gib dein Unternehmen an.");
    if (!c.company) ok = false;

    var consentErr = $("err-consent");
    if (!c.consent) {
      consentErr.hidden = false;
      consentErr.textContent = "Ohne diese Einwilligung dürfen wir deine Angaben nicht speichern. " +
        "Du kannst dein Ergebnis auch ohne Kontaktdaten ansehen.";
      ok = false;
    } else {
      consentErr.hidden = true;
    }
    return ok;
  }

  // =====================================================================
  // ABSCHLUSS
  // =====================================================================

  function finishSolo(submitState) {
    clearDraft();
    renderResultSolo(submitState);
    show("screen-result");
  }

  function finishTeam() {
    submitted = true;
    clearDraft();
    submitAnswers(null).then(function () {
      return loadAggregate();
    }).then(function () {
      renderResultTeam();
      show("screen-result");
      startPolling();
    });
  }

  // =====================================================================
  // EVENTS
  // =====================================================================

  $("questions").addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.type === "radio") {
      answers[t.name] = parseInt(t.value, 10);
      writeDraft();
      $("fs-" + t.name).classList.remove("missing");
      updateProgress("screen-questions");
    }
  });

  $("btn-start").addEventListener("click", function () { goToStep(0); });

  var draft = readDraft();
  if (draft && Object.keys(draft.answers).length) {
    var count = Object.keys(draft.answers).length;
    $("btn-resume").hidden = false;
    $("btn-resume").textContent = "Begonnenen Check fortsetzen (" + count + " von " +
      QUESTIONS.length + " bewertet)";
    $("btn-resume").addEventListener("click", function () {
      answers = draft.answers;
      var target = 0;
      for (var i = 0; i < DIMENSIONS.length; i++) {
        if (!isStepComplete(i)) { target = i; break; }
        target = i;
      }
      goToStep(target);
    });
  }

  $("btn-back").addEventListener("click", function () {
    if (step === 0) show("screen-intro");
    else goToStep(step - 1);
  });

  $("form-questions").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validateStep()) return;
    if (step < DIMENSIONS.length - 1) {
      goToStep(step + 1);
    } else if (MODE === "team") {
      finishTeam();
    } else if (ASK_FOR_CONTACT) {
      show("screen-contact");
    } else {
      finishSolo("skipped");
    }
  });

  $("btn-back-questions").addEventListener("click", function () { goToStep(DIMENSIONS.length - 1); });

  $("form-contact").addEventListener("submit", function (e) {
    e.preventDefault();
    $("submit-error").hidden = true;

    // Spam-Falle gefüllt: still abbrechen, Ergebnis trotzdem zeigen
    if ($("c-website").value) {
      finishSolo("skipped");
      return;
    }
    if (!validateContact()) return;

    var btn = $("btn-submit");
    btn.disabled = true;
    btn.textContent = "Wird gesendet …";

    submitAnswers(collectContact()).then(function (state) {
      btn.disabled = false;
      btn.textContent = "Absenden und Ergebnis anzeigen";
      finishSolo(state);
    });
  });

  $("btn-skip").addEventListener("click", function () { finishSolo("skipped"); });

  $("btn-print").addEventListener("click", function () { window.print(); });

  $("btn-restart").addEventListener("click", function () {
    answers = {};
    step = 0;
    submitted = false;
    clearDraft();
    $("form-contact").reset();
    renderStep();
    show("screen-intro");
  });

  $("btn-reset").addEventListener("click", function () {
    var token = window.prompt("Admin-Token für das Zurücksetzen des Raums „" + ROOM + "“:");
    if (token === null) return;
    var msg = $("present-msg");
    fetch(api("/api/reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ room: ROOM })
    }).then(function (r) {
      msg.hidden = false;
      msg.textContent = r.ok
        ? "Raum zurückgesetzt."
        : (r.status === 401 ? "Token abgelehnt." : "Zurücksetzen fehlgeschlagen (HTTP " + r.status + ").");
      if (r.ok) loadAggregate();
    }).catch(function () {
      msg.hidden = false;
      msg.textContent = "Backend nicht erreichbar.";
    });
  });

  // =====================================================================
  // START
  // =====================================================================

  $("intro-note").textContent = MODE === "team"
    ? "15 Aussagen in fünf Schritten, Skala 1 bis 5. Dauer etwa 4 Minuten. Deine Antworten werden ohne Namen " +
      "gespeichert und mit den Antworten der anderen zu einem gemeinsamen Profil zusammengefasst."
    : "15 Aussagen in fünf Schritten, Skala 1 bis 5. Dauer etwa 4 Minuten. Am Ende fragen wir nach deinen " +
      "Kontaktdaten – dein Ergebnis kannst du auch ohne ansehen. Deine Antworten bleiben bis dahin in deinem Browser.";

  renderStep();

  if (PRESENT) {
    document.getElementById("main").classList.add("wide");
    renderPresent();
    show("screen-present");
    loadAggregate();
    startPolling();
  } else {
    updateProgress("screen-intro");
  }
})();
