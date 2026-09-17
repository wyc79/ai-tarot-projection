/**
 * The graph page: the reading's control flow, drawn from the compiled graph.
 *
 * Four things happen here and none of them is a reading. The graph is
 * compiled with no context and asked to draw itself; Mermaid renders the
 * text; the picture becomes a viewport that pan-zoom.js moves; then the notes
 * from graph.js are bound to the rendered nodes and edge labels as tooltips,
 * and the recorded scenarios are bound to buttons that colour the path each
 * one took. The scenarios were recorded by scripts/draw_graph.mjs running the
 * real engine; this page runs nothing and fetches nothing from anywhere but
 * its own origin.
 */

import { buildGraph } from "../engine/graph.js";
import { attachPanZoom } from "./pan-zoom.js";

const $ = (id) => document.getElementById(id);

// Mermaid prefixes every id it generates with the id the render was given.
const PREFIX = "reading";
const NODE_ID = new RegExp(`^${PREFIX}-flowchart-(.+)-\\d+$`);

const nodeName = (group) => group.id.match(NODE_ID)?.[1] ?? null;
const nodeGroups = (svg) => [...svg.querySelectorAll("g.node")];
const edgePath = (from, to) => document.getElementById(`${PREFIX}-L_${from}_${to}_0`);

function bindTooltips(svg, notes) {
  const tip = $("tip");
  const move = (event) => {
    tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${event.clientY + 14}px`;
  };
  const attach = (element, note) => {
    element.addEventListener("mouseenter", (event) => { tip.textContent = note; tip.hidden = false; move(event); });
    element.addEventListener("mousemove", move);
    element.addEventListener("mouseleave", () => { tip.hidden = true; });
  };
  for (const group of nodeGroups(svg)) {
    const note = notes.nodes[nodeName(group)];
    if (note) attach(group, note);
  }
  for (const label of svg.querySelectorAll("g.edgeLabel")) {
    const note = notes.keys[label.textContent.trim()];
    if (note) attach(label, note);
  }
}

/** The verdict as a line: every field but the judge's free-text gloss. */
function describe(verdict) {
  if (!verdict) return "(no verdict: the judge was not consulted on this turn)";
  return Object.entries(verdict)
    .filter(([key]) => key !== "reading_of_them")
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

function light(svg, scenario) {
  for (const lit of svg.querySelectorAll(".lit")) lit.classList.remove("lit");
  const names = new Set(scenario.nodes);
  for (const group of nodeGroups(svg)) if (names.has(nodeName(group))) group.classList.add("lit");
  for (const [from, to] of scenario.edges) {
    const path = edgePath(from, to);
    // The one console.* allowed on this page, and a diagnostic rather than
    // silence: a Mermaid re-vendor that changed the id scheme would otherwise
    // make every highlight vanish with no signal for the hand check to catch.
    if (path) path.classList.add("lit");
    else console.warn(`no drawn edge for ${from} -> ${to}`);
  }
  $("trace-answer").textContent = scenario.answer;
  $("trace-verdict").textContent = describe(scenario.verdict);
  $("trace-reason").textContent = scenario.reason;
  $("trace").hidden = false;
}

function renderScenarios(svg, scenarios) {
  const list = $("scenarios");
  for (const scenario of scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scenario";
    button.append(document.createTextNode(scenario.title));
    const small = document.createElement("small");
    small.textContent = scenario.blurb;
    button.append(small);
    button.addEventListener("click", () => {
      for (const other of list.querySelectorAll(".scenario.active")) other.classList.remove("active");
      button.classList.add("active");
      light(svg, scenario);
      // The row is sized to be all there is on screen once scrolled to (graph.css);
      // the click is what scrolls to it, so the lit path is in view without a
      // wheel that, over the picture, would zoom instead.
      $("graph-row").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    list.append(button);
  }
}

async function main() {
  const { graph, notes } = buildGraph();
  const text = (await graph.getGraphAsync()).drawMermaid();
  window.mermaid.initialize({ startOnLoad: false });
  const { svg } = await window.mermaid.render(PREFIX, text);
  $("picture").innerHTML = svg;
  const drawing = $("picture").querySelector("svg");
  attachPanZoom(drawing, $("picture"), { zoomIn: $("zoom-in"), zoomOut: $("zoom-out"), fitButton: $("zoom-fit") });
  bindTooltips(drawing, notes);

  // A scenarios failure is not a drawing failure: the graph is already on
  // screen, and losing it to a fetch error that has nothing to do with it
  // would be worse than showing the picture with no scenario list beside it.
  try {
    const response = await fetch("graph-scenarios.json");
    if (!response.ok) throw new Error(`graph-scenarios.json: ${response.status}`);
    const { scenarios } = await response.json();
    renderScenarios(drawing, scenarios);
  } catch (error) {
    $("scenarios").textContent = `the scenarios failed to load: ${error.message}`;
    $("scenarios").className = "bad";
  }
}

main().catch((error) => {
  $("picture").textContent = `the graph failed to draw: ${error.message}`;
  $("picture").className = "picture bad";
});
