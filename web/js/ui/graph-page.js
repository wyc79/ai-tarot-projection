/**
 * The graph page: the reading's control flow, drawn from the compiled graph.
 *
 * Three things happen here and none of them is a reading. The graph is
 * compiled with no context and asked to draw itself; Mermaid renders the
 * text; then the notes from graph.js are bound to the rendered nodes and edge
 * labels as tooltips, and the recorded scenarios are bound to buttons that
 * colour the path each one took. The scenarios were recorded by
 * scripts/draw_graph.mjs running the real engine; this page runs nothing and
 * fetches nothing from anywhere but its own origin.
 */

import { buildGraph } from "../engine/graph.js";

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
  for (const [from, to] of scenario.edges) edgePath(from, to)?.classList.add("lit");
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
    button.innerHTML = `${scenario.title}<small></small>`;
    button.querySelector("small").textContent = scenario.blurb;
    button.addEventListener("click", () => {
      for (const other of list.querySelectorAll(".scenario.active")) other.classList.remove("active");
      button.classList.add("active");
      light(svg, scenario);
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
  // Mermaid gives the svg width="100%" and no height attribute, so it has no
  // intrinsic size of its own — CSS "width: auto" then fills the container
  // (per the replaced-element sizing rules) instead of using the viewBox's
  // pixel size. Setting the attributes from the viewBox gives it a real
  // intrinsic size, which is what lets graph.css render it at natural size.
  const box = drawing.viewBox.baseVal;
  drawing.setAttribute("width", box.width);
  drawing.setAttribute("height", box.height);
  bindTooltips(drawing, notes);

  const response = await fetch("graph-scenarios.json");
  if (!response.ok) throw new Error(`graph-scenarios.json: ${response.status}`);
  const { scenarios } = await response.json();
  renderScenarios(drawing, scenarios);
}

main().catch((error) => {
  $("picture").textContent = `the graph failed to draw: ${error.message}`;
  $("picture").className = "picture bad";
});
