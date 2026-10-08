// Runs inside the report, added by the viewer's server to the copy it serves.
// The report sits in a sandboxed frame, so the panel cannot touch it; the two
// talk only through postMessage. A classic script: it is inlined in a tag, and
// the frame's origin is "null", so it cannot import or fetch anything.
(function () {
  var BOUND = "[data-trailline]";
  var CSS_TEXT =
    BOUND +
    " { cursor: pointer; transition: outline-color .15s, background-color .15s; outline: 1.5px solid transparent; outline-offset: 2px; border-radius: 2px; }" +
    " .tl-hover { outline-color: rgba(35, 70, 176, .45) !important; }" +
    " .tl-peek { outline: 1.5px dashed #111 !important; }" +
    " .tl-sel { outline: 2px solid #2346b0 !important; background-color: rgba(35, 70, 176, .07) !important; }" +
    " @keyframes tl-flash { 0% { background-color: rgba(35,70,176,.28); } 100% { background-color: rgba(35,70,176,.07); } }" +
    " .tl-flash { animation: tl-flash .9s ease-out; }" +
    " " +
    BOUND +
    ":focus-visible { outline: 2px solid #2346b0; }";

  var marked = null; // the id the panel has open
  var current = null; // the element of it that is outlined

  function post(message) {
    parent.postMessage(message, "*");
  }

  function bound() {
    return Array.prototype.slice.call(document.querySelectorAll(BOUND));
  }

  function places(id) {
    return bound().filter(function (el) {
      return el.getAttribute("data-trailline") === id;
    });
  }

  function clear(name) {
    Array.prototype.forEach.call(
      document.querySelectorAll("." + name),
      function (el) {
        el.classList.remove(name);
      },
    );
  }

  function paint() {
    clear("tl-sel");
    if (marked === null) return;
    var id = marked;
    if (
      !current ||
      !current.isConnected ||
      current.getAttribute("data-trailline") !== id
    ) {
      current = places(id)[0] || null;
    }
    if (current) current.classList.add("tl-sel");
  }

  function open(el) {
    current = el;
    post({ trailline: "select", id: el.getAttribute("data-trailline") });
  }

  function start() {
    var style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
  }

  function ready() {
    var counts = {};
    bound().forEach(function (el) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      var id = el.getAttribute("data-trailline");
      counts[id] = (counts[id] || 0) + 1;
    });
    post({ trailline: "ready", counts: counts });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest(BOUND);
    if (!el) return;
    e.preventDefault();
    open(el);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") return post({ trailline: "back" });
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target.closest && e.target.closest(BOUND);
    if (!el || el !== e.target) return;
    e.preventDefault();
    open(el);
  });

  document.addEventListener("mouseover", function (e) {
    clear("tl-hover");
    var el = e.target.closest && e.target.closest(BOUND);
    if (el) el.classList.add("tl-hover");
  });

  document.addEventListener("mouseleave", function () {
    clear("tl-hover");
  });

  // What the panel asks for: outline the open node, outline one on hover,
  // scroll to one of a node's places on the page.
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.trailline === "mark") {
      marked = typeof m.id === "string" ? m.id : null;
      paint();
    } else if (m.trailline === "peek") {
      clear("tl-peek");
      if (typeof m.id === "string") {
        places(m.id).forEach(function (el) {
          el.classList.add("tl-peek");
        });
      }
    } else if (m.trailline === "scroll") {
      var el = typeof m.id === "string" && places(m.id)[m.index];
      if (!el) return;
      current = el;
      paint();
      var calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({
        behavior: calm ? "auto" : "smooth",
        block: "center",
      });
      el.classList.remove("tl-flash");
      void el.offsetWidth;
      el.classList.add("tl-flash");
    }
  });

  start();
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready);
})();
