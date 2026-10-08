// The viewer page: click a number, see how it was computed, read from the
// source up. All the logic with no page in it is in lineage.js; this file is
// the DOM, the events, the report frame and the clipboard.
import {
  beats,
  chainSql,
  copyText,
  fromReport,
  highlightSql,
  needsAttention,
  nodeState,
  nodesOf,
  overview,
  reportSql,
  reviewerWording,
  stepSql,
  title,
} from "./lineage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const ICON = {
  back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>',
  up: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10.5V1.5M2.5 5 6 1.5 9.5 5"/></svg>',
  chev: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>',
  caret:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg>',
  page: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>',
  point:
    '<svg viewBox="0 0 26 26" aria-hidden="true"><path d="M4 13h13M12 8l5 5-5 5"/><path d="M21 4v18M24 4v18"/></svg>',
};

// ---------- state ----------
const S = {
  fx: null,
  nodes: {},
  issues: {},
  usedBy: {},
  sel: null,
  history: [],
  openSnips: new Set(),
  showUses: false,
  upOpen: new Set(),
  counts: {},
  cycle: {},
};

function load(fx) {
  S.fx = fx;
  S.nodes = nodesOf(fx.graph);
  S.issues = {};
  for (const i of fx.summary.issues || []) (S.issues[i.node] ||= []).push(i);
  S.usedBy = {};
  for (const [id, n] of Object.entries(S.nodes))
    for (const p of n.from || []) (S.usedBy[p] ||= []).push(id);
  S.sel = null;
  S.history = [];
  S.openSnips = new Set();
  S.showUses = false;
  S.upOpen = new Set();
  S.cycle = {};
}

// ---------- reading the graph ----------
const STEP = {
  source: "Source",
  view: "View",
  figure: "Figure",
  insight: "Claim",
};
const stepWord = (id) => STEP[S.nodes[id]?.step] || "Missing";
const state = (id) => nodeState(S.fx, id);
const val = (id) => {
  const n = S.nodes[id];
  return n ? String(n.display ?? n.value ?? "") : "";
};
const lead = (sql) => {
  const m = /^\s*--\s*(.+)/.exec(sql || "");
  return m ? m[1].trim() : "";
};
const nameOf = (id) => title(S.fx.graph, id);
const visual = (id) => {
  const v = S.nodes[id]?.encoding?.visual;
  return v ? (v === "table" ? "table" : `${v} chart`) : "view";
};

function ancestors(id) {
  const out = new Set();
  const walk = (x) => {
    if (out.has(x)) return;
    out.add(x);
    for (const p of S.nodes[x]?.from || []) walk(p);
  };
  walk(id);
  return out;
}
const fmtDate = (d) => {
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return esc(d);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};
// let long identifiers break after dots and underscores
const wb = (s) => esc(s).replace(/([._])/g, "$1<wbr>");
const period = (p) => (p ? `${fmtDate(p.from)} – ${fmtDate(p.to)}` : "");

// ---------- warnings, in the reviewer's words ----------
const codeify = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const warnList = (id) => {
  const iss = S.issues[id];
  if (!iss?.length) return "";
  const words = iss.map((i) => ({ code: i.code, ...reviewerWording(i) }));
  const sorted = words.sort(
    (a, b) => (b.tone !== "note") - (a.tone !== "note"),
  );
  return `<ul class="warns">${sorted.map((w) => `<li class="${w.tone}"><span class="code">${esc(w.code)}</span><span>${w.html}</span></li>`).join("")}</ul>`;
};

// ---------- small renderers ----------
const idBtn = (id) =>
  S.nodes[id]
    ? `<button class="id" type="button" data-go="${esc(id)}" title="${esc(stepWord(id))}: ${esc(nameOf(id))}">${esc(id)}</button>`
    : `<span class="id missing" title="Not in the graph">${esc(id)}</span>`;
const sw = (st) => `<span class="sw ${st}" aria-hidden="true"></span>`;
// A copy button. When there is nothing to copy it is disabled and says why.
const copyBtn = (attr, id, { sql, reason }, label, tip) =>
  `<button class="btn" type="button" ${attr}="${esc(id)}" ${sql === null ? "disabled" : ""} title="${esc(reason ?? tip)}">${ICON.copy}${label}</button>`;
const STATE_WORD = {
  full: "Traced to SQL",
  partial: "Rests on an external source",
  ungrounded: "Nothing recorded behind it",
};

function snippet(id) {
  const n = S.nodes[id];
  if (!n?.sql) return "";
  let lines = n.sql.replace(/\s+$/, "").split("\n");
  if (/^\s*--/.test(lines[0])) lines = lines.slice(1);
  const SHOW = 4;
  const extra = lines.length - SHOW;
  const open = S.openSnips.has(id);
  const shown = open || extra <= 1 ? lines : lines.slice(0, SHOW);
  return `<div class="snip"><pre>${highlightSql(shown.join("\n"))}</pre><div class="snip-bar">${
    extra > 1
      ? `<button class="link" type="button" data-more="${esc(id)}" aria-expanded="${open}">${open ? "Show less" : `… ${extra} more lines`}</button>`
      : `<span class="muted" style="font-size:12.5px">${lines.length} line${lines.length > 1 ? "s" : ""}</span>`
  }<span class="gap"></span>${copyBtn("data-copy-sql", id, stepSql(S.fx, id), "Copy SQL", "")}</div></div>`;
}

// The figures column: what the step yields.
function fig(id) {
  const n = S.nodes[id];
  if (!n) return "";
  if (n.step === "figure") return `<span class="fig">${esc(val(id))}</span>`;
  if (n.step === "source" && n.kind === "sql")
    return `<span class="fig small">${n.period ? esc(`${fmtDate(n.period.from)} – ${fmtDate(n.period.to)}`) : ""}</span>`;
  if (n.step === "view")
    return `<span class="fig small">${esc(visual(id))}</span>`;
  return "";
}

// How many places a node has on the page, as the report said when it loaded.
const pageCount = (id) => S.counts[id] || 0;

// What the step reads and does, in one or two lines, then its evidence.
function body(id, isTop) {
  const n = S.nodes[id];
  if (!n)
    return `<p class="reads"><span class="stamp stop">Missing</span> Something here reads from <code>${esc(id)}</code>, but there is no such node in the graph.</p>`;
  if (n.ungrounded) {
    return `<div class="ext-body"><span class="stamp stop">Nothing behind it</span><p>No source, view or figure was recorded for this. Ask the builder where it comes from.</p></div>`;
  }
  const from = (n.from || []).map(idBtn).join(" ");
  let h = "";
  if (n.step === "source") {
    if (n.kind !== "sql") {
      h += `<div class="ext-body"><span class="stamp ext">External ${esc(n.type || "source")}</span><p>${n.given ? esc(n.given) + ". " : ""}Trailline can't see inside it; ask the builder for the file.</p></div>`;
      if (n.columns)
        h += `<p class="reads cols">Columns: ${n.columns.map((c) => `<code>${esc(c)}</code>`).join(", ")}</p>`;
      return h;
    }
    const note = lead(n.sql);
    h += `<p class="reads">${note ? `${esc(note)}.` : `Reads <code>${wb(n.mart || "an unnamed mart")}</code>.`}</p>`;
    if (n.columns)
      h += `<p class="reads cols">Columns: ${n.columns.map((c) => `<code>${esc(c)}</code>`).join(", ")}</p>`;
    return h + snippet(id);
  }
  if (n.step === "view") {
    const shown = pageCount(id)
      ? ` On the page as a <button class="link" type="button" data-scroll="${esc(id)}">${esc(visual(id))}</button>.`
      : "";
    h += `<p class="reads">Reads ${from}, gives ${(n.columns || []).map((c) => `<code>${esc(c)}</code>`).join(", ")}.${shown}</p>`;
    return h + snippet(id);
  }
  if (n.step === "figure") {
    if (n.expr) {
      const pretty = (s) =>
        s
          .replace(/\s*-\s*/g, " − ")
          .replace(/\s*\*\s*/g, " × ")
          .replace(/\s*\/\s*/g, " / ")
          .replace(/\s*\+\s*/g, " + ");
      const tokens = (fn) =>
        pretty(n.expr)
          .split(/\b([a-zA-Z]\w*)\b/)
          .map((t, k) => (k % 2 && S.nodes[t] ? fn(t) : esc(t)))
          .join("");
      h += `<p class="reads">Arithmetic over ${from}.</p>`;
      h += `<div class="formula"><span class="eq"></span><span>${tokens((t) => idBtn(t))}</span><span class="eq">=</span><span>${tokens((t) => esc(val(t)))}</span><span class="eq">=</span><span class="res res-line">${esc(val(id))}</span></div>`;
      return h;
    }
    h += `<p class="reads">Picks one value from ${from}.</p>`;
    return h + snippet(id);
  }
  if (n.step === "insight") {
    const parts = (n.from || []).map(
      (p) =>
        `${idBtn(p)}${S.nodes[p]?.step === "figure" ? ` <b>${esc(val(p))}</b>` : ` <span class="muted">${esc(stepWord(p).toLowerCase())}</span>`}`,
    );
    h += `<p class="reads">${isTop ? "Rests on" : `“${esc(n.text)}” rests on`} ${parts.join(", ")}.</p>`;
    return h;
  }
  return h;
}

function stepRow(id, { beatStart, n, lane, isTop, i }) {
  const node = S.nodes[id];
  const t = nameOf(id);
  const ttl =
    node?.step === "source" && node.kind === "sql"
      ? `<code>${wb(t)}</code>`
      : isTop
        ? `<span class="muted" style="font-weight:500">${node?.step === "insight" ? "The claim you clicked" : "The number you clicked"}</span>`
        : esc(t);
  return `<div class="row${beatStart ? " beat-start" : " beat-cont"}${isTop ? " is-top" : ""}" data-row="${esc(id)}">
      <div class="n">${n}</div>
      <div class="st"><span class="blk ${state(id)}${lane ? " r" : ""}${isTop ? " top" : ""}" style="--i:${i}"></span></div>
      <article class="step" aria-label="${esc(stepWord(id))} ${esc(id)}">
        <div class="step-h${node?.step === "source" ? " src" : ""}">${idBtn(id)}<span class="kind">${esc(stepWord(id))}</span><span class="ttl">${ttl}</span>${fig(id)}</div>
        ${body(id, isTop)}
        ${warnList(id)}
      </article>
    </div>`;
}

// ---------- default state: the summary ----------
function renderSummary() {
  const sum = S.fx.summary;
  const c = sum.counts;
  const { lede, sub } = overview(S.fx);

  const split = (step) => {
    const ids = Object.keys(S.nodes).filter((id) => S.nodes[id].step === step);
    const by = { full: 0, partial: 0, ungrounded: 0 };
    ids.forEach((id) => by[state(id)]++);
    return { total: ids.length, by };
  };
  const rows = [
    ["insight", "Claims", 4],
    ["figure", "Figures", 3],
    ["view", "Views", 2],
    ["source", "Sources", 1],
  ]
    .map(([step, name, k]) => {
      const { total, by } = split(step);
      const words =
        step === "source"
          ? [
              ["full", `${by.full} SQL`],
              ["partial", `${c.sources.external} external`],
            ]
          : step === "view"
            ? [["full", `${c.views.shown} on the page`]]
            : [
                ["full", `${by.full} traced`],
                ["partial", `${by.partial} external`],
                ["ungrounded", `${by.ungrounded} nothing behind`],
              ];
      const bar = total
        ? ["full", "partial", "ungrounded"]
            .map((s) =>
              by[s] ? `<i class="${s}" style="flex:${by[s]}"></i>` : "",
            )
            .join("")
        : "";
      return `<div class="key-row"><div class="num">${k}</div><div class="staff"><span class="bar">${bar}</span></div>
        <div class="what"><b>${total}</b><span class="step-n">${name}</span><span class="split">${words
          .filter(([s, w]) => !/^0 /.test(w) || s === "full")
          .map(([s, w]) => `<span>${sw(s)}${esc(w)}</span>`)
          .join("")}</span></div></div>`;
    })
    .join("");

  // Needs attention: what the reviewer should look at first.
  const { items: att, notes } = needsAttention(sum);

  const attHtml = att.length
    ? `<ul class="attn">${att.map((a) => (a.node === null ? `<li><div class="plain"><span class="sw ${a.swatch}"></span><span class="what"><span class="tag ${a.tone}">${esc(a.tag)}.</span> ${a.html}</span></div></li>` : `<li><button type="button" data-go="${esc(a.node)}" data-from-summary><span class="sw ${a.swatch}"></span><span class="id">${esc(a.node)}</span><span class="what"><span class="tag ${a.tone}">${esc(a.tag)}.</span> ${a.html}</span></button></li>`)).join("")}</ul>`
    : `<p class="calm">${sw("full")}<span>Nothing needs attention. Every number and claim traces back to a SQL source, and <code>check</code> raised no warnings.</span></p>`;
  const notesHtml = notes.length
    ? `<details class="notes"><summary>${ICON.chev}${notes.length} note${notes.length > 1 ? "s" : ""} for the builder</summary><ul>${notes.map((i) => `<li>${idBtn(i.node)}<span><b>${esc(i.code)}</b> ${codeify(i.message)}</span></li>`).join("")}</ul></details>`
    : "";

  return `<div class="sec">
        <p class="lede">${esc(lede)}</p>
        <p class="lede-sub">${esc(sub)}</p>
        <div class="key" role="table" aria-label="What the report rests on, by step">${rows}</div>
        <div class="key-legend"><span>${sw("full")}Traced to SQL</span><span>${sw("partial")}External</span><span>${sw("ungrounded")}Nothing behind it</span></div>
      </div>
      <div class="sec">
        <h2 class="h">Needs attention <small>${att.length || "none"}</small></h2>
        ${attHtml}
        ${notesHtml}
      </div>
      <p class="prompt">${ICON.point}<span>Click any number, sentence, table or chart in the report to see how it was computed.</span></p>`;
}

// ---------- selected state ----------
function renderSelected(id) {
  const n = S.nodes[id];
  const st = state(id);
  const step = stepWord(id);

  // head: what this is, in plain words
  const meta = `<div class="head-meta"><span class="id static">${esc(id)}</span><span class="kind">${esc(step)}</span><span class="state">${sw(st)}${esc(STATE_WORD[st])}</span></div>`;
  let head = `<div class="head">`;
  if (n.step === "figure") {
    head += `<p class="value">${esc(val(id))}</p><p class="label">${n.label ? esc(n.label) : `<span class="muted">No label was recorded for this number.</span>`}</p>${meta}`;
  } else if (n.step === "insight") {
    let text = esc(n.text);
    for (const p of n.from || []) {
      const d = val(p);
      if (d && S.nodes[p]?.step === "figure")
        text = text.split(esc(d)).join(`<mark>${esc(d)}</mark>`);
    }
    head += `<p class="claim">${text}</p>${meta}`;
  } else if (n.step === "view") {
    head += `<p class="claim">${esc(nameOf(id))}</p><p class="label muted">${esc(visual(id))} · ${(n.columns || []).length} columns</p>${meta}`;
  } else {
    head += `<p class="claim"><code>${wb(nameOf(id))}</code></p><p class="label muted">${n.kind === "sql" ? esc(period(n.period)) : esc(n.given || "")}</p>${meta}`;
  }
  head += `<div class="head-act">
      ${copyBtn("data-copy-chain", id, chainSql(S.fx, id), `Copy SQL for this ${n.step === "insight" ? "claim" : n.step}`, "Every query this rests on, composed into one runnable script")}
      ${pageCount(id) ? `<button class="btn" type="button" data-scroll="${esc(id)}">${ICON.page}Show on the page</button>` : ""}
    </div></div>`;

  // rests on: the overview of the chain
  const anc = [...ancestors(id)];
  const items = [];
  for (const x of anc) {
    const m = S.nodes[x];
    if (!m) {
      items.push(
        `<li>${sw("ungrounded")}<span class="what"><code>${esc(x)}</code></span><span class="when stop">Not in the graph</span></li>`,
      );
      continue;
    }
    if (m.step === "source" && m.kind === "sql") {
      const c7 = (S.issues[x] || []).some((i) => i.code === "C7");
      items.push(
        `<li data-jump="${esc(x)}">${sw("full")}<span class="what"><code>${wb(m.mart || "(no mart)")}</code></span><span class="when${c7 ? " warn" : ""}">${m.period ? esc(period(m.period)) : "No period"}${c7 ? " · not pinned" : ""}</span></li>`,
      );
    } else if (m.step === "source") {
      items.push(
        `<li data-jump="${esc(x)}">${sw("partial")}<span class="what"><code>${esc(m.ref || x)}</code> <span class="muted">external ${esc(m.type || "")}</span></span><span class="when">Can't be traced</span></li>`,
      );
    } else if (m.ungrounded) {
      items.push(
        `<li data-jump="${esc(x)}">${sw("ungrounded")}<span class="what">${x === id ? "This" : `${esc(x)}, ${esc(stepWord(x).toLowerCase())},`} has no source</span><span class="when stop">Nothing behind it</span></li>`,
      );
    }
  }
  const nWarn = anc.reduce(
    (k, x) =>
      k +
      (S.issues[x] || []).filter((i) => reviewerWording(i).tone !== "note")
        .length,
    0,
  );
  const rests = `<div class="rests"><h2 class="h">Rests on</h2><ul>${items.join("")}</ul>${
    nWarn
      ? `<p class="foot"><span class="sw"></span>${nWarn} warning${nWarn > 1 ? "s" : ""} in this chain, shown on the step${nWarn > 1 ? "s" : ""} below.</p>`
      : ""
  }</div>`;

  // used by (dashed, above the clicked node)
  const direct = S.usedBy[id] || [];
  let uses = `<div class="uses">`;
  if (!direct.length) {
    uses += `<button class="btn" type="button" disabled>Nothing else uses this</button>`;
  } else {
    uses += `<button class="btn" type="button" data-uses aria-expanded="${S.showUses}">${S.showUses ? ICON.caret.replace("M2.5 7.5 6 4l3.5 3.5", "M2.5 4.5 6 8l3.5-3.5") : ICON.caret}${S.showUses ? "Hide what uses this" : `Show what uses this ${n.step === "insight" ? "claim" : n.step === "figure" ? "number" : n.step} (${direct.length})`}</button>`;
  }
  uses += `</div>`;
  let usesList = "";
  if (S.showUses && direct.length) {
    // farther users sit higher: walk, then reverse so the nearest is at the bottom
    const rows = [];
    const seen = new Set([id]);
    const walk = (x, depth) => {
      for (const u of S.usedBy[x] || []) {
        if (seen.has(u)) continue;
        seen.add(u);
        rows.push({ u, depth });
        if (S.upOpen.has(u)) walk(u, depth + 1);
      }
    };
    walk(id, 0);
    rows.reverse();
    usesList = `<div class="score uses-list">${rows
      .map(({ u, depth }) => {
        return `<div class="row" data-row="${esc(u)}"><div class="n">${depth ? "" : ""}</div><div class="st"><span class="blk${depth % 2 ? " r" : ""}"></span></div>
          <div class="step"><div class="step-h" style="padding-left:${depth * 14}px">${idBtn(u)}<span class="kind">${esc(stepWord(u))}</span><span class="ttl">${esc(nameOf(u))}</span>${fig(u)}<button class="tw${(S.usedBy[u] || []).length ? "" : " none"}" type="button" data-upopen="${esc(u)}" aria-expanded="${S.upOpen.has(u)}" title="What uses ${esc(u)}">${ICON.caret}</button></div></div></div>`;
      })
      .join(
        "",
      )}</div><p class="uses-cap">Dashed: what uses this. Solid, below: how it was computed.</p>`;
  }

  // the score
  const bs = beats(S.fx.graph, id);
  const total = bs.length;
  const scoreRows = bs
    .map((b) =>
      b.ids
        .map((x, k) =>
          stepRow(x, {
            beatStart: k === 0,
            n: b.n,
            lane: k % 2 === 1,
            isTop: x === id,
            i: 0,
          }),
        )
        .join(""),
    )
    .join("");
  const score = `<div class="score-h"><h2 class="h">How it was computed</h2><span class="read">${ICON.up}Read from step 1 up</span></div><div class="score" id="score">${scoreRows}</div>
      <p class="end">${total > 1 ? `Step 1 is where the data comes from. Each step above reads from the ones below it.` : n.ungrounded ? "" : "This is where the data comes from."}</p>`;

  return head + rests + uses + usesList + score;
}

// ---------- render ----------
function nav() {
  if (!S.sel) return "";
  const prev = S.history[S.history.length - 1];
  const backLabel = prev ? `Back to ${prev}` : "Summary";
  return `<div class="nav"><button class="back" type="button" data-back>${ICON.back}${esc(backLabel)}</button><span class="gap"></span>${
    prev
      ? `<button class="link" type="button" data-home style="font-size:13px">Report summary</button>`
      : ""
  }</div>`;
}

function render({ rise = false, keepScroll = false } = {}) {
  const pane = $("#lineage");
  const top = pane.scrollTop;
  pane.innerHTML = nav() + (S.sel ? renderSelected(S.sel) : renderSummary());
  if (rise) {
    const sc = $("#score", pane);
    if (sc) {
      // the blocks rise once, from step 1 up
      const rows = [...sc.querySelectorAll(".row")];
      rows
        .reverse()
        .forEach((r, k) =>
          r.querySelector(".blk")?.style.setProperty("--i", k),
        );
      sc.classList.add("rise");
    }
  }
  pane.scrollTop = keepScroll ? top : 0;
  paintPage();
  writeHash();
}

// ---------- the report pane ----------
// The report runs in a sandboxed frame; the panel and the bridge script the
// server adds to it talk only through messages.
const tell = (message) =>
  $("#report").contentWindow?.postMessage(
    { trailline: message.type, ...message },
    "*",
  );

function mountReport() {
  window.addEventListener("message", (e) => {
    if (e.source !== $("#report").contentWindow) return;
    const message = fromReport(S.fx, e.data);
    if (message === null) return;
    if (message.type === "select") select(message.id, { fromPage: true });
    else if (message.type === "back") back();
    else onPageReady(message.counts);
  });
  $("#report").src = `/report/${encodeURIComponent(S.fx.report)}`;
}

function paintPage() {
  tell({ type: "mark", id: S.sel });
}

function scrollPage(id) {
  const n = pageCount(id);
  if (!n) return;
  const k = (S.cycle[id] = ((S.cycle[id] ?? -1) + 1) % n);
  tell({ type: "scroll", id, index: k });
  if (n > 1) toast(`${k + 1} of ${n} places on the page`);
}

function peek(id, on) {
  tell({ type: "peek", id: on && id !== S.sel ? id : null });
}

// ---------- actions ----------
function select(id, { fromPage = false, push = true } = {}) {
  if (!S.nodes[id]) return;
  if (S.sel && push && S.sel !== id) S.history.push(S.sel);
  if (!S.sel && push) S.history = [];
  S.sel = id;
  S.showUses = false;
  S.upOpen = new Set();
  render({ rise: true });
  if (!fromPage && pageCount(id)) {
    S.cycle[id] = -1;
    scrollPage(id);
  }
}
function back() {
  if (!S.sel) return;
  const prev = S.history.pop();
  if (prev) {
    S.sel = prev;
    S.showUses = false;
    render({ rise: true });
    if (pageCount(prev)) {
      S.cycle[prev] = -1;
      scrollPage(prev);
    }
  } else home();
}
function home() {
  S.sel = null;
  S.history = [];
  render();
}

// The old way to copy, for when the Clipboard API is missing or refuses.
function execCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

async function copy(text, btn) {
  if (!(await copyText(text, { clipboard: navigator.clipboard, execCopy }))) {
    return toast("Could not copy to the clipboard");
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.classList.add("done");
    btn.innerHTML = btn.innerHTML.replace(/Copy[^<]*/, "Copied");
    setTimeout(() => {
      btn.classList.remove("done");
      btn.innerHTML = old;
    }, 1400);
  }
  toast("Copied to the clipboard");
}

let toastT;
function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("on"), 1600);
}

// ---------- events in the panel ----------
const pane = $("#lineage");
pane.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-jump], a");
  if (!t) return;
  if (t.dataset.go) return select(t.dataset.go);
  if (t.hasAttribute("data-back")) return back();
  if (t.hasAttribute("data-home")) return home();
  if (t.dataset.more) {
    S.openSnips.has(t.dataset.more)
      ? S.openSnips.delete(t.dataset.more)
      : S.openSnips.add(t.dataset.more);
    return render({ keepScroll: true });
  }
  if (t.dataset.copySql) return copy(stepSql(S.fx, t.dataset.copySql).sql, t);
  if (t.dataset.copyChain)
    return copy(chainSql(S.fx, t.dataset.copyChain).sql, t);
  if (t.dataset.scroll) return scrollPage(t.dataset.scroll);
  if (t.hasAttribute("data-uses")) {
    S.showUses = !S.showUses;
    return render({ keepScroll: true });
  }
  if (t.dataset.upopen) {
    const u = t.dataset.upopen;
    S.upOpen.has(u) ? S.upOpen.delete(u) : S.upOpen.add(u);
    return render({ keepScroll: true });
  }
  if (t.dataset.jump) {
    // a row in "Rests on": bring its step into view and band it
    const row = pane.querySelector(
      `#score [data-row="${CSS.escape(t.dataset.jump)}"]`,
    );
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      pane
        .querySelectorAll(".row.band")
        .forEach((r) => r.classList.remove("band"));
      row.classList.add("band");
    }
  }
});
// hovering a step bands it, bands what it reads from, and outlines it on the page
pane.addEventListener("mouseover", (e) => {
  const row = e.target.closest(".row[data-row]");
  pane
    .querySelectorAll(".parent-band")
    .forEach((r) => r.classList.remove("parent-band"));
  if (!row) return peek(null, false);
  const id = row.dataset.row;
  for (const p of S.nodes[id]?.from || [])
    pane
      .querySelector(`#score [data-row="${CSS.escape(p)}"]`)
      ?.classList.add("parent-band");
  peek(id, true);
});
pane.addEventListener("mouseleave", () => {
  peek(null, false);
  pane
    .querySelectorAll(".parent-band")
    .forEach((r) => r.classList.remove("parent-band"));
});
pane.addEventListener("mouseover", (e) => {
  const li = e.target.closest("[data-jump]");
  if (li) li.style.cursor = "pointer";
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest("input, select, textarea"))
    back();
});
$("[data-home]").addEventListener("click", (e) => {
  e.preventDefault();
  home();
});
$("#copyReport").addEventListener("click", (e) =>
  copy(reportSql(S.fx).sql, e.currentTarget),
);

// ---------- hash (for links) ----------
const H = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
function writeHash() {
  const p = new URLSearchParams();
  if (S.sel) p.set("sel", S.sel);
  history.replaceState(null, "", `#${p}`);
}
let ready = null;
// The report has loaded: now the panel knows where each node is on the page.
function onPageReady(counts) {
  S.counts = counts;
  const r = ready;
  ready = null;
  if (r?.sel && S.nodes[r.sel]) select(r.sel, { push: false });
  else render({ keepScroll: true });
}

async function boot() {
  const res = await fetch("/data.json");
  if (!res.ok) {
    $("#lineage").textContent = await res.text();
    return;
  }
  load(await res.json());
  $("#reportName").textContent = S.fx.report;
  document.title = `${S.fx.report} · Trailline`;
  const all = reportSql(S.fx);
  const btn = $("#copyReport");
  btn.disabled = all.sql === null;
  btn.title = all.reason ?? "";
  render();
  mountReport();
}

// light or dark: follows the OS until the reviewer picks one
const root = document.documentElement;
const setMode = (m) => {
  root.dataset.theme = m === "dark" ? "console" : "console-light";
};
let saved = null;
try {
  saved = localStorage.getItem("tl-mode");
} catch {
  /* private mode */
}
if (H.mode) saved = H.mode;
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!saved) setMode(e.matches ? "dark" : "light");
});
$("#mode").addEventListener("click", () => {
  saved = root.dataset.theme === "console" ? "light" : "dark";
  setMode(saved);
  try {
    localStorage.setItem("tl-mode", saved);
  } catch {
    /* private mode */
  }
});
ready = H;
boot();
