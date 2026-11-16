window.__spicaHome = function () {
  var root = document.querySelector(".sd");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  var motionOK = !window.matchMedia || !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (motionOK) root.classList.add("anim");
  if (motionOK && "IntersectionObserver" in window) root.classList.add("io");

(function () {
  var root = document.querySelector(".sd");
  var anim = root.classList.contains("anim");

  /* ---------- hero: CEFR ring, QR, counters ---------- */
  var ring = document.querySelector(".ring"), cx = 56, cy = 56, r = 52, h = "";
  function arc(a0, a1) {
    var p = function (a) { var t = (a - 90) * Math.PI / 180; return (cx + r * Math.cos(t)).toFixed(2) + " " + (cy + r * Math.sin(t)).toFixed(2); };
    return "M" + p(a0) + " A" + r + " " + r + " 0 0 1 " + p(a1);
  }
  for (var k = 0; k < 6; k++) h += '<path class="seg track" pathLength="1" style="--i:' + k + '" d="' + arc(k * 60 + 5, k * 60 + 55) + '"/>';
  for (var j = 0; j < 4; j++) h += '<path class="seg on" pathLength="1" style="--i:' + j + '" d="' + arc(j * 60 + 5, j * 60 + 55) + '"/>';
  ring.innerHTML = h;

  var qr = document.getElementById("qr"), n = 25, seed = 7, out = "";
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  function inFinder(x, y) { return (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9); }
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
    if (!inFinder(x, y) && rnd() > .52) out += '<rect class="m" style="--d:' + rnd().toFixed(2) + '" x="' + x + '" y="' + y + '" width="1" height="1"/>';
  }
  [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (f) {
    out += '<g class="m" style="--d:0"><rect x="' + f[0] + '" y="' + f[1] + '" width="7" height="7"/><rect x="' + (f[0] + 1) + '" y="' + (f[1] + 1) + '" width="5" height="5" style="fill:var(--surface)"/><rect x="' + (f[0] + 2) + '" y="' + (f[1] + 2) + '" width="3" height="3"/></g>';
  });
  out += '<rect class="scan" x="-1" y="0" width="27" height="2" rx="1"/>';
  qr.innerHTML = out;

  function count(el, from, to, delay, dur) {
    if (!anim) { el.textContent = to; return; }
    el.textContent = from;
    setTimeout(function () {
      var t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (to - from) * e);
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }, delay);
  }
  if (anim) {
    document.querySelectorAll(".cert .skill output").forEach(function (o, i) { count(o, 0, +o.dataset.to, 1450 + i * 150, 1000); });
    var s = document.getElementById("score"); count(s, +s.dataset.from, +s.dataset.to, 2600, 1100);
    var lvl = document.getElementById("lvl");
    ["A1", "A2", "B1", "B2"].forEach(function (v, i) { if (i === 0) lvl.textContent = v; setTimeout(function () { lvl.textContent = v; }, 1550 + i * 200); });
  }

  /* waveform bars */
  var wave = document.getElementById("wave"), w = "", s2 = 3;
  for (var i = 0; i < 46; i++) {
    s2 = (s2 * 9301 + 49297) % 233280;
    var hh = 25 + Math.round((s2 / 233280) * 75 * Math.abs(Math.sin(i / 4)) + 8);
    w += '<i class="' + (i < 18 ? "on" : "") + '" style="--k:' + i + ';height:' + Math.min(hh, 100) + '%"></i>';
  }
  wave.innerHTML = w;

  /* ---------- scroll reveal and per-section effects ---------- */
  var onIn = {};
  function startCounters(scope) {
    scope.querySelectorAll("[data-count]").forEach(function (el) {
      if (el.dataset.done) return; el.dataset.done = "1";
      count(el, el.dataset.from ? +el.dataset.from : 0, +el.dataset.count, 100, 1400);
    });
  }
  var revealEls = document.querySelectorAll("[data-reveal]");
  if (root.classList.contains("io")) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        startCounters(en.target);
        if (en.target.id && onIn[en.target.id]) onIn[en.target.id]();
        io.unobserve(en.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* proctoring console: checks tick one by one */
  var clist = document.querySelectorAll("#console .clist li");
  function runConsole() {
    clist.forEach(function (li) { li.classList.remove("done", "work"); });
    clist.forEach(function (li, idx) {
      setTimeout(function () { li.classList.add("work"); }, 300 + idx * 650);
      setTimeout(function () { li.classList.remove("work"); li.classList.add("done"); }, 800 + idx * 650);
    });
  }
  if (anim && root.classList.contains("io")) { onIn["console"] = runConsole; }
  else { clist.forEach(function (li) { li.classList.add("done"); }); }

  /* ---------- tabs helper (audiences, reports) ---------- */
  function tabs(tablist, panelSel) {
    var btns = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    function select(b, focus) {
      btns.forEach(function (x) {
        var on = x === b;
        x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1;
        var p = document.getElementById(x.getAttribute("aria-controls"));
        p.hidden = !on; p.classList.remove("show");
        if (on) { void p.offsetWidth; p.classList.add("show"); }
      });
      if (focus) b.focus();
    }
    btns.forEach(function (b, idx) {
      b.addEventListener("click", function () { select(b); });
      b.addEventListener("keydown", function (e) {
        var k = e.key, t = null;
        if (k === "ArrowRight" || k === "ArrowDown") t = btns[(idx + 1) % btns.length];
        if (k === "ArrowLeft" || k === "ArrowUp") t = btns[(idx - 1 + btns.length) % btns.length];
        if (k === "Home") t = btns[0];
        if (k === "End") t = btns[btns.length - 1];
        if (t) { e.preventDefault(); select(t, true); }
      });
    });
  }
  tabs(document.querySelector('#audiences [role="tablist"]'));
  tabs(document.querySelector('#reports [role="tablist"]'));
  tabs(document.querySelector('#plans [role="tablist"]'));

  /* ---------- stepper with auto-advance ---------- */
  var stepBtns = Array.prototype.slice.call(document.querySelectorAll(".steps button"));
  var panel = document.getElementById("sp"), plabel = document.getElementById("sp-label");
  var labels = ["Placement test", "Study plan", "Practice", "Mock test", "Proctored test", "Certificate"];
  var cur = 0, timer = null, auto = anim;
  function showStep(i, focus) {
    cur = i;
    stepBtns.forEach(function (b, idx) {
      var on = idx === i;
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
      var pr = b.querySelector(".prog"); pr.classList.remove("run");
      if (on && auto) { void pr.offsetWidth; pr.classList.add("run"); }
    });
    panel.setAttribute("aria-labelledby", stepBtns[i].id);
    panel.innerHTML = document.getElementById("tp-" + i).innerHTML;
    plabel.textContent = labels[i];
    panel.classList.remove("show"); void panel.offsetWidth; panel.classList.add("show");
    if (focus) stepBtns[i].focus();
    clearTimeout(timer);
    if (auto) timer = setTimeout(function () { showStep((cur + 1) % stepBtns.length); }, 6000);
  }
  function stopAuto() { auto = false; clearTimeout(timer); stepBtns.forEach(function (b) { b.querySelector(".prog").classList.remove("run"); }); }
  stepBtns.forEach(function (b, idx) {
    b.addEventListener("click", function () { stopAuto(); showStep(idx); });
    b.addEventListener("keydown", function (e) {
      var t = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") t = (idx + 1) % stepBtns.length;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") t = (idx - 1 + stepBtns.length) % stepBtns.length;
      if (e.key === "Home") t = 0;
      if (e.key === "End") t = stepBtns.length - 1;
      if (t !== null) { e.preventDefault(); stopAuto(); showStep(t, true); }
    });
  });
  var stepperEl = document.querySelector(".stepper");
  stepperEl.addEventListener("mouseenter", function () { if (auto) { clearTimeout(timer); } });
  stepperEl.addEventListener("mouseleave", function () { if (auto) showStep(cur); });
  showStep(0);

  /* ---------- CEFR stairs ---------- */
  var L = [
    ["A1", "Beginner", "Understands and uses familiar everyday expressions and very basic phrases."],
    ["A2", "Elementary", "Handles simple, routine exchanges on familiar topics and everyday needs."],
    ["B1", "Intermediate", "Deals with most everyday situations and can describe experiences, plans and opinions."],
    ["B2", "Upper intermediate", "Talks with fluency on a wide range of topics, including technical discussions in their own field."],
    ["C1", "Advanced", "Uses English flexibly and effectively for work, study and social life."],
    ["C2", "Proficient", "Understands almost everything heard or read and expresses ideas precisely."]
  ];
  var stairs = document.querySelectorAll(".stair"), lc = document.getElementById("lvlcard");
  stairs.forEach(function (b) {
    b.addEventListener("click", function () {
      var d = L[+b.dataset.l];
      stairs.forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      document.getElementById("lc-code").textContent = d[0];
      document.getElementById("lc-name").textContent = d[1];
      document.getElementById("lc-desc").textContent = d[2];
      lc.classList.remove("swap"); void lc.offsetWidth; lc.classList.add("swap");
    });
  });


  /* ---------- tests carousel ---------- */
  var track = document.getElementById("tcar-track"), cards = track.querySelectorAll(".test");
  var dotsEl = document.getElementById("tdots"), prev = document.getElementById("tprev"), next = document.getElementById("tnext");
  var names = Array.prototype.map.call(cards, function (c) { return c.querySelector("h3").textContent; });
  cards.forEach(function (c, i) {
    var b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", "Show " + names[i]);
    b.addEventListener("click", function () { go(i); }); dotsEl.appendChild(b);
  });
  var dots = dotsEl.querySelectorAll("button");
  function step() { return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth; }
  function go(i) { track.scrollTo({ left: Math.max(0, Math.min(i, cards.length - 1)) * step(), behavior: anim ? "smooth" : "auto" }); }
  function tcur() { return Math.round(track.scrollLeft / step()); }
  function sync() {
    var i = tcur(), max = track.scrollWidth - track.clientWidth - 2;
    dots.forEach(function (d, k) { if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
    prev.disabled = track.scrollLeft <= 2; next.disabled = track.scrollLeft >= max;
  }
  prev.addEventListener("click", function () { go(tcur() - 1); });
  next.addEventListener("click", function () { go(tcur() + 1); });
  track.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); go(tcur() + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(tcur() - 1); }
  });
  var st = false;
  track.addEventListener("scroll", function () { if (!st) { st = true; requestAnimationFrame(function () { sync(); st = false; }); } }, { passive: true });
  window.addEventListener("resize", sync);
  sync();

  /* ---------- sample answer: pulsing waveform, play and pause ---------- */
  var audio = document.getElementById("audio"), playbtn = document.getElementById("playbtn");
  if (!anim) { audio.classList.add("paused"); playbtn.setAttribute("aria-pressed", "false"); playbtn.setAttribute("aria-label", "Play sample answer"); }
  playbtn.addEventListener("click", function () {
    var paused = audio.classList.toggle("paused");
    playbtn.setAttribute("aria-pressed", String(!paused));
    playbtn.setAttribute("aria-label", paused ? "Play sample answer" : "Pause sample answer");
  });

  /* ---------- section nav active state ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".secnav ul a[href^='#']"));
  var targets = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  function setActive() {
    var y = window.scrollY + 140, idx = -1;
    targets.forEach(function (t, i) { if (t && t.offsetTop <= y) idx = i; });
    navLinks.forEach(function (a, i) {
      var on = i === idx;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    if (idx >= 0) {
      var a = navLinks[idx], ul = a.closest("ul");
      if (ul && (a.offsetLeft < ul.scrollLeft || a.offsetLeft + a.offsetWidth > ul.scrollLeft + ul.clientWidth)) ul.scrollTo({ left: a.offsetLeft - 20, behavior: "smooth" });
    }
  }
  var ticking = false;
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { setActive(); ticking = false; }); } }, { passive: true });
  setActive();

  /* ---------- shared platforms and tools form (edpf) ---------- */
  var FORM_ENDPOINT = window.SPICA_FORM_ENDPOINT || ""; // Edstellar form system (POST FormData); set NEXT_PUBLIC_FORM_ENDPOINT
  var GENERIC = ["Building skills across the workforce", "Finding capability and skills gaps", "Developing leaders and managers", "Improving learning engagement"];
  var PLATFORMS = [
    { id: "spectra-lms", name: "Spectra LMS", button: "Request a demo", days: 1, challenges: GENERIC, prompt: "For example: our learners rarely finish assigned courses." },
    { id: "capability-intelligence-platform", name: "Capability OS", button: "Request a demo", days: 1, challenges: GENERIC, prompt: "For example: we cannot see skills across the organization." },
    { id: "tna-tni-engine", name: "TNA/TNI Engine", button: "Request a demo", days: 1, challenges: GENERIC, prompt: "For example: we need a training needs analysis for 2,000 staff." },
    { id: "zenith", name: "Zenith", button: "Book a consultation", days: 1, challenges: GENERIC, prompt: "For example: we want to build our next line of leaders." },
    { id: "orbit", name: "Orbit", button: "Book a consultation", days: 1, challenges: GENERIC, prompt: "For example: we want 360-degree feedback for 80 managers." },
    { id: "polaris", name: "Polaris", button: "Get a free demo", days: 2, challenges: GENERIC, prompt: "For example: our leadership team avoids hard conversations." },
    { id: "meridian", name: "Meridian", button: "Get a free demo", days: 1, challenges: GENERIC, prompt: "For example: we want coaching for 20 new managers." },
    { id: "spica", name: "Spica", button: "Book a free demo", days: 1, challenges: ["Screening applicants' spoken English", "Measuring staff English levels", "Improving English for client-facing teams", "Preparing students for placements", "Showing clients proof of candidates' English"], prompt: "For example: we hire 200 support agents a month and need to check spoken English before interviews." },
    { id: "not-sure", name: "Not sure yet", button: "Talk to a specialist", days: 1, challenges: GENERIC, prompt: "Tell us what you want to achieve." }
  ];
  var byId = {}; PLATFORMS.forEach(function (x) { byId[x.id] = x; });
  var edpf = document.querySelector(".edpf"), form = document.getElementById("leadform");
  var platformSel = document.getElementById("f-platform"), chSel = document.getElementById("f-challenge");
  var country = document.getElementById("f-country"), dial = document.getElementById("dial");
  function setPlatform() {
    var pl = byId[platformSel.value] || byId["not-sure"];
    chSel.innerHTML = '<option value="">Select</option>' + pl.challenges.concat(["Something else"]).map(function (c) { return "<option>" + c.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</option>"; }).join("");
    document.getElementById("f-goals").placeholder = pl.prompt;
    document.getElementById("f-submit").textContent = pl.button;
    var reply = pl.days === 2 ? "two business days" : "one business day";
    document.getElementById("edpf-reply").textContent = "We reply within " + reply + ".";
    document.getElementById("edpf-reply-l").textContent = reply;
    document.getElementById("thanks-p").textContent = "An Edstellar specialist will reply within " + reply + ".";
    document.getElementById("f-intent").value = pl.id;
    document.getElementById("f-platform-name").value = pl.name;
    document.querySelectorAll("#also label").forEach(function (l) {
      var same = l.dataset.id === pl.id; l.hidden = same; if (same) l.querySelector("input").checked = false;
    });
  }
  var pagePlatform = edpf.getAttribute("data-platform");
  if (pagePlatform && byId[pagePlatform]) platformSel.value = pagePlatform;
  document.getElementById("f-source").value = pagePlatform || "platforms-hub";
  platformSel.addEventListener("change", setPlatform);
  setPlatform();
  country.addEventListener("change", function () {
    var o = country.options[country.selectedIndex];
    var d = o && o.dataset.dial ? o.dataset.dial : "+";
    dial.textContent = d; document.getElementById("f-dial").value = d === "+" ? "" : d;
  });
  var rules = [
    ["f-platform", "e-platform", function (v) { return v !== ""; }, "Select a platform or tool."],
    ["f-name", "e-name", function (v) { return v.trim().length > 1; }, "Enter your full name."],
    ["f-email", "e-email", function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }, "Enter a valid work email, like name@company.com."],
    ["f-company", "e-company", function (v) { return v.trim().length > 1; }, "Enter your company name."],
    ["f-title", "e-title", function (v) { return v.trim().length > 1; }, "Enter your job title."],
    ["f-country", "e-country", function (v) { return v !== ""; }, "Select your country."],
    ["f-phone", "e-phone", function (v) { return v.replace(/\D/g, "").length >= 6; }, "Enter a phone number with at least 6 digits."],
    ["f-size", "e-size", function (v) { return v !== ""; }, "Select your company size."],
    ["f-challenge", "e-challenge", function (v) { return v !== ""; }, "Select your current challenge."],
    ["f-time-sel", "e-timeline", function (v) { return v !== ""; }, "Select a timeline."]
  ];
  function check(r) {
    var el = document.getElementById(r[0]), er = document.getElementById(r[1]), ok = r[2](el.value);
    el.closest(".field").classList.toggle("invalid", !ok);
    er.textContent = ok ? "" : r[3];
    el.setAttribute("aria-invalid", String(!ok));
    if (!ok) el.setAttribute("aria-describedby", r[1]); else el.removeAttribute("aria-describedby");
    return ok;
  }
  rules.forEach(function (r) { document.getElementById(r[0]).addEventListener("blur", function (e) { if (e.target.value) check(r); }); });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var firstBad = null;
    rules.forEach(function (r) { if (!check(r) && !firstBad) firstBad = document.getElementById(r[0]); });
    var c = document.getElementById("f-consent"), ce = document.getElementById("e-consent");
    ce.textContent = c.checked ? "" : "Please agree to the privacy policy to continue.";
    c.setAttribute("aria-invalid", String(!c.checked));
    if (!c.checked && !firstBad) firstBad = c;
    document.getElementById("errsum").hidden = !firstBad;
    if (firstBad) { firstBad.focus(); return; }
    document.getElementById("f-also").value = Array.prototype.map.call(document.querySelectorAll("#also label:not([hidden]) input:checked"), function (x) { return x.value; }).join(", ");
    document.getElementById("f-url").value = location.href;
    document.getElementById("f-time").value = new Date().toISOString();
    function done() {
      form.hidden = true; var t = document.getElementById("thanks"); t.hidden = false; t.focus();
      edpf.dispatchEvent(new CustomEvent("edpf:submitted", { bubbles: true, detail: { platform: platformSel.value } }));
      if (window.dataLayer) window.dataLayer.push({ event: "platform_form_submit", platform: platformSel.value, source_page: document.getElementById("f-source").value });
    }
    if (document.getElementById("f-hp").value) { done(); return; } // honeypot: show success, send nothing
    if (!FORM_ENDPOINT) { done(); return; }
    fetch(FORM_ENDPOINT, { method: "POST", body: new FormData(form) }).then(function (r) { if (!r.ok) throw 0; done(); })
      .catch(function () { var es = document.getElementById("errsum"); es.textContent = "Something went wrong sending your request. Please try again in a moment."; es.hidden = false; });
  });
})();

};
