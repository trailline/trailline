import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { bareNumbers } from "../src/graph/numbers.js";
import { readGraph } from "../src/graph/parse.js";
import { proseSkip, readPage } from "../src/html/page.js";
import { loadFixture } from "./helpers.js";

const bare = (page) =>
  page.prose.flatMap((p) =>
    bareNumbers(p.text).map((t) => ({ text: t.text, node: p.node })),
  );

describe("readPage: bindings", () => {
  it("lists every bound element in document order", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const page = readPage(html);
    assert.deepEqual(
      page.bindings.map((b) => b.id),
      [
        "i1",
        "f6",
        "f1",
        "f2",
        "f3",
        "f5",
        "i2",
        "f1",
        "f3",
        "f2",
        "f4",
        "i3",
        "f5",
        "v1",
        "v2",
      ],
    );
  });

  it("gives each figure its visible text", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const page = readPage(html);
    assert.deepEqual(
      page.bindings
        .filter((b) => b.id.startsWith("f"))
        .map((b) => [b.id, b.text]),
      [
        ["f6", "Paid social"],
        ["f1", "46.6%"],
        ["f2", "41.7%"],
        ["f3", "11.8%"],
        ["f5", "31.2%"],
        ["f1", "46.6%"],
        ["f3", "11.8%"],
        ["f2", "41.7%"],
        ["f4", "#1"],
        ["f5", "31.2%"],
      ],
    );
    const i1 = page.bindings.find((b) => b.id === "i1");
    assert.equal(i1.text, "Paid social led August retention");
  });

  it("points each offset at the element's start tag", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const page = readPage(html);
    for (const binding of page.bindings) {
      assert.equal(html.startsWith("<", binding.offset), true, binding.id);
      const tag = html.slice(binding.offset, html.indexOf(">", binding.offset));
      assert.equal(tag.includes(`data-trailline="${binding.id}"`), true);
    }
    assert.equal(
      html
        .slice(page.bindings[0].offset)
        .startsWith('<h1 data-trailline="i1">'),
      true,
    );
  });

  it("keeps ids as written", () => {
    const { reportPath } = loadFixture("broken");
    const html = readFileSync(reportPath, "utf8");
    const page = readPage(html);
    assert.deepEqual(
      page.bindings.map((b) => b.id),
      ["i1", "Top-Plan", "f1", "f2", "i2", "i3", "f5", "f3", "f4", "f9", "v1"],
    );
  });

  it("collapses whitespace and decodes entities", () => {
    const html = `<p data-trailline="i1">A&amp;B  rose\n to <span data-trailline="f1">&#36;5</span></p>`;
    const page = readPage(html);
    assert.deepEqual(page.bindings, [
      { id: "i1", text: "A&B rose to $5", offset: 0 },
      { id: "f1", text: "$5", offset: 41 },
    ]);
  });

  it("keeps empty and valueless ids", () => {
    const html = `<p data-trailline="">a</p><p data-trailline>b</p>`;
    const page = readPage(html);
    assert.deepEqual(page.bindings, [
      { id: "", text: "a", offset: 0 },
      { id: "", text: "b", offset: 26 },
    ]);
  });

  it("finds bindings inside pre", () => {
    const html = `<pre>x <span data-trailline="f1">4%</span></pre>`;
    const page = readPage(html);
    assert.deepEqual(page.bindings, [{ id: "f1", text: "4%", offset: 7 }]);
    assert.deepEqual(page.prose, [
      { text: "x", node: null, offset: 5 },
      { text: "4%", node: "f1", offset: 33 },
    ]);
  });

  it("returns empty lists for a page with no text or bindings", () => {
    const page = readPage("");
    assert.deepEqual(page, { bindings: [], prose: [] });
  });
});

describe("readPage: prose", () => {
  it("tags each text run with its nearest bound ancestor", () => {
    const html = `<p data-trailline="i1">up <b>5%</b> on <span data-trailline="f1">7%</span></p><p>9%</p>`;
    const page = readPage(html);
    assert.deepEqual(page.prose, [
      { text: "up", node: "i1", offset: 23 },
      { text: "5%", node: "i1", offset: 29 },
      { text: "on", node: "i1", offset: 35 },
      { text: "7%", node: "f1", offset: 65 },
      { text: "9%", node: null, offset: 81 },
    ]);
  });

  it("leaves out head, script, style, noscript, template, comments and doctype", () => {
    const html = `<!DOCTYPE html><html><head><title>12%</title><style>p{width:5%}</style></head><body><!-- 9% --><script>var a = 3;</script><noscript>8%</noscript><template><p>7%</p></template><p>ok</p></body></html>`;
    const page = readPage(html);
    assert.deepEqual(page.prose, [{ text: "ok", node: null, offset: 178 }]);
  });

  it("leaves out hidden tags regardless of case", () => {
    const html = `<html><Head><Title>Q3 2026 at 12%</Title></Head><body><p>ok</p><SCRIPT type="application/trailline+json">{"nodes":{"f1":{"value":0.466,"display":"46.6%"}}}</SCRIPT></body></html>`;
    const page = readPage(html);
    assert.deepEqual(page.prose, [
      { text: "ok", node: null, offset: html.indexOf("ok") },
    ]);
  });

  it("collapses, trims and decodes text but offsets the raw run", () => {
    const html = "<p>\n  rose&nbsp;to\n  4 %  </p>";
    const page = readPage(html);
    assert.deepEqual(page.prose, [
      { text: "rose to 4 %", node: null, offset: 3 },
    ]);
  });

  it("drops whitespace-only runs", () => {
    const html = "<div>\n  <p>a</p>\n  </div>";
    const page = readPage(html);
    assert.deepEqual(page.prose, [{ text: "a", node: null, offset: 11 }]);
  });

  it("skips the whole subtree of a skipped binding", () => {
    const html = `<div data-trailline="v1"><p data-trailline="i9">5%</p></div><p data-trailline="i1">6%</p>`;
    const page = readPage(html, { skip: (id) => id === "v1" });
    assert.deepEqual(page.prose, [{ text: "6%", node: "i1", offset: 83 }]);
    assert.deepEqual(
      page.bindings.map((b) => b.id),
      ["v1", "i9", "i1"],
    );
  });
});

describe("proseSkip", () => {
  const graph = {
    nodes: {
      q1: { step: "source" },
      v1: { step: "view" },
      f1: { step: "figure" },
      i1: { step: "insight" },
      i2: { step: "insight", ungrounded: true },
      i3: { step: "insight", ungrounded: false },
      m1: { step: "metric" },
    },
  };

  it("counts only unbound text and grounded insights", () => {
    const skip = proseSkip(graph);
    assert.equal(skip("i1"), false);
    assert.equal(skip("i3"), false);
    for (const id of ["q1", "v1", "f1", "i2", "m1", "zz", "", "constructor"]) {
      assert.equal(skip(id), true, id);
    }
  });

  it("skips every binding when the graph has no nodes", () => {
    for (const bad of [{}, null, { nodes: [] }]) {
      const skip = proseSkip(bad);
      assert.doesNotThrow(() => skip("i1"));
      assert.equal(skip("i1"), true);
    }
  });
});

describe("readPage on fixtures", () => {
  it("clean has no bare numbers once views and figures are skipped", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const page = readPage(html, { skip: proseSkip(graph) });
    assert.deepEqual(bare(page), []);
    assert.equal(page.prose.length, 20);
    assert.equal(page.prose[0].text, "Growth review · August 2026");
    assert.equal(
      page.prose[0].offset,
      html.indexOf("Growth review · August 2026"),
    );
    assert.equal(page.prose[0].node, null);
  });

  it("clean without a skip shows the chart and table numbers", () => {
    const { reportPath } = loadFixture("clean");
    const html = readFileSync(reportPath, "utf8");
    const page = readPage(html);
    assert.deepEqual(
      bare(page).map((t) => t.text),
      [
        "46.6%",
        "41.7%",
        "11.8%",
        "31.2%",
        "46.6%",
        "11.8%",
        "41.7%",
        "#1",
        "31.2%",
        "36%",
        "40%",
        "44%",
        "48%",
        "4,120",
        "46.6%",
        "1,900",
        "45.2%",
        "3,870",
        "43.1%",
        "3,310",
        "38.8%",
      ],
    );
  });

  it("messy has one bare number, in i1", () => {
    const { reportPath } = loadFixture("messy");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const page = readPage(html, { skip: proseSkip(graph) });
    assert.deepEqual(bare(page), [{ text: "1,240", node: "i1" }]);
  });

  it("broken has no bare numbers", () => {
    const { reportPath } = loadFixture("broken");
    const html = readFileSync(reportPath, "utf8");
    const { graph } = readGraph({ reportPath });
    const page = readPage(html, { skip: proseSkip(graph) });
    assert.deepEqual(bare(page), []);
  });
});
