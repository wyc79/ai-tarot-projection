/**
 * The reading as a graph. One user turn is one run of it.
 *
 * This is the session controller's control flow, re-expressed as a LangGraph
 * StateGraph so that it can be drawn from itself: every reader turn kind is a
 * node of that name, every `if` the old say() had is a conditional edge, and
 * the label on a dashed edge is the key its router returned. What the reading
 * records, judges and decides has not moved -- the nodes call the same state.js
 * functions in the same order the plain functions did.
 *
 * The graph's state is the turn and nothing else. The session is closed over,
 * the way it always was, and mutated in place by state.js. Carrying it through
 * reducers would have meant rewriting state.js for no product reason.
 *
 * buildGraph() with no ctx compiles a graph whose nodes are never run. That is
 * what the drawing script and graph.html use, and it is why every ctx access
 * is inside a node body rather than at build time.
 *
 * Each node and each key carries its note here, beside the thing it explains,
 * so the two cannot be added or removed separately. The page shows them as
 * tooltips; a test checks that the notes cover exactly the compiled graph.
 */

import { Annotation, END, START, StateGraph } from "../../vendor/langgraph.js";
import { flipDirection } from "./prompts.js";
import {
  afterglowDrift, close, commitAnchor, currentCard, end, epilogueEarned, farewellDue,
  flipCard, flipDecision, flipEpilogue, nextPosition, recordAfterward, recordAside,
  recordExchange, recordOffFrame, recordOpening, spreadComplete, updateAnchor,
} from "./state.js";

/**
 * The first card is not earned, it is dealt: the gate has nothing to judge
 * yet. Saying so is better than leaving the one blank flip reason in the
 * ledger to be read as a missing value.
 */
export const OPENING_FLIP_REASON = "the opening question was answered; the reading begins";

const EPILOGUE_FLIP_REASON = "earned before the close: the reading had somewhere left to go";

/** Turn-local scratch. Nothing here outlives the run. */
const Turn = Annotation.Root({
  kind: Annotation(),      // "say" | "meanings"
  answer: Annotation(),    // what they said, or the meanings request
  opening: Annotation(),   // judge.opening's verdict, on the opening turn only
  gate: Annotation(),      // judge.gate's verdict
  decision: Annotation(),  // flipDecision's result
  text: Annotation(),      // the reader's turn
  result: Annotation(),    // what say() / meanings() return, in the shapes they always had
});

/**
 * @param {object} [ctx]
 * @param {object} ctx.session
 * @param {object} ctx.pack
 * @param {object} ctx.judge         the three judgements, bound to this reading
 * @param {(turn: string, options?: object) => Promise<string>} ctx.readerTurn
 * @param {(position: string) => Promise<string>} ctx.cardFor
 * @param {() => void} ctx.persist
 * @param {(event: object) => void} ctx.onEvent
 * @param {() => string} ctx.question  the reader's standing question
 * @returns {{ graph: object, notes: { nodes: Record<string, string>, keys: Record<string, string> } }}
 */
export function buildGraph(ctx = {}) {
  const notes = { nodes: {}, keys: {} };
  const s = () => ctx.session;
  const dropped = () => s().safety_state === "drop_frame";

  /**
   * The anchor revision in flight, if any. Started by decide, landed by
   * revise_anchor, and held here rather than in graph state because it is a
   * Promise, not data. See the revise_anchor node for why it is not a
   * parallel branch.
   */
  let pending = null;

  function beginRevision(gate) {
    if (!s().anchor || !gate.has_life_content || gate.hedged) return null;
    return ctx.judge.anchor(s(), { rolling: true }).catch((error) => {
      // A failed revision is not a failed turn. The reading carries on with
      // the plan it already had, and says so rather than swallowing it.
      ctx.onEvent({ type: "anchor_failed", error: error.message });
      return null;
    });
  }

  async function flipInto(position, reason) {
    // Off the table, not off the pile: the card has been lying on this
    // position face down since the reading began.
    flipCard(s(), await ctx.cardFor(position), { reason });
    const entry = currentCard(s());
    ctx.onEvent({ type: "flip", card: ctx.pack.card(entry.card_id), position: entry.position, reason });
  }

  const stage = () => ({ stageDirection: flipDirection(ctx.pack, s()) });
  const held = (reason) => ({ flip: false, reason });

  // -- nodes ------------------------------------------------------------------

  const g = new StateGraph(Turn);

  function node(name, note, fn) {
    notes.nodes[name] = note;
    g.addNode(name, fn);
  }

  /** A path map for addConditionalEdges, and the note for each key in it. */
  function branches(spec) {
    const map = {};
    for (const [key, { to, note }] of Object.entries(spec)) {
      if (notes.keys[key] !== undefined && notes.keys[key] !== note) {
        throw new Error(`the key "${key}" is used with two different notes`);
      }
      notes.keys[key] = note;
      map[key] = to;
    }
    return map;
  }

  node("judge_opening",
    "The answer to the opening question is judged: did they name something to look at, and what are the stakes? Recorded before anything is dealt.",
    async (state) => {
      const opening = await ctx.judge.opening({ question: ctx.question(), answer: state.answer });
      recordOpening(s(), { question: ctx.question(), answer: state.answer, opening });
      ctx.onEvent({ type: "opening", opening, topic: s().topic });
      // Safety before the first card, not after it: if a tarot frame is the
      // wrong thing here, nothing should be dealt at all.
      if (dropped()) ctx.onEvent({ type: "frame_dropped" });
      return { opening, result: { opening, dealt: false } };
    });

  node("judge_gate",
    "The flip gate: the answer is judged for depth, life content, hedging, stakes, and whether it was a question back. The verdict is what every decision after this is made from.",
    async (state) => {
      // A turn that failed after decide may have left a revision in flight. It
      // belonged to that turn, and reading.js dropped it the same way.
      pending = null;
      return {
        gate: await ctx.judge.gate({ card: currentCard(s()), question: ctx.question(), answer: state.answer }),
      };
    });

  node("off_frame",
    "The frame was dropped before a card was ever dealt. There is no reading to continue, only a conversation, and it must not crash looking for a card that was deliberately never turned.",
    async (state) => {
      recordOffFrame(s(), { question: ctx.question(), answer: state.answer });
      return { result: { dealt: false, offFrame: true } };
    });

  node("aside",
    "They asked what the question meant instead of answering it. Recorded as an aside: nothing counts it, not the card's budget, not the dwell, not the ladder.",
    async (state) => {
      recordAside(s(), { question: ctx.question(), answer: state.answer, gate: state.gate });
      ctx.onEvent({ type: "gate", gate: state.gate });
      if (dropped()) ctx.onEvent({ type: "frame_dropped" });
      return { result: { gate: state.gate, decision: held("they asked what the question meant") } };
    });

  node("exchange",
    "The answer goes on the ledger under the current card, with its verdict. The ledger is written before the decision, so the decision is made from the record.",
    async (state) => {
      recordExchange(s(), { question: ctx.question(), answer: state.answer, gate: state.gate });
      ctx.onEvent({ type: "gate", gate: state.gate });
      // Safety outranks the rhythm. Once the frame is dropped there are no
      // more cards, so the decision is never even consulted.
      if (dropped()) ctx.onEvent({ type: "frame_dropped" });
      return { result: { gate: state.gate, decision: held("frame dropped") } };
    });

  node("tail",
    "A turn after the closing beat, recorded under its own position (afterward, or afterglow if they chose to stay) so it touches no card's rhythm. The gate still ran: stakes do not stop mattering because a reading finished.",
    async (state) => {
      recordAfterward(s(), {
        question: ctx.question(), answer: state.answer, gate: state.gate,
        position: s().phase === "afterglow" ? "afterglow" : "afterward",
      });
      ctx.onEvent({ type: "gate", gate: state.gate });
      if (dropped()) ctx.onEvent({ type: "frame_dropped" });
      return { result: { gate: state.gate, decision: held("frame dropped") } };
    });

  node("decide",
    "The flip decision: hold, or turn the next card. Depth-gated, not count-gated, with the dwell and settle rules and each position's budget applied. The anchor revision starts here too, alongside whatever the reader says next.",
    async (state) => {
      // Started here, landed in revise_anchor: this turn's reply does not
      // need the revised plan, so it does not wait for it.
      pending = beginRevision(state.gate);
      const decision = flipDecision(s(), state.gate);
      ctx.onEvent({ type: "flip_decision", decision, gate: state.gate });
      return { decision, result: { gate: state.gate, decision } };
    });

  node("commit_anchor",
    "The anchor -- theme, their phrases, the resolution beat -- is committed off the first card, before any second card exists to be reconciled with it.",
    async () => {
      commitAnchor(s(), await ctx.judge.anchor(s()));
      // Persist before announcing: a listener that reads storage on the
      // event would otherwise see the state as it was a moment ago.
      ctx.persist();
      ctx.onEvent({ type: "anchor", anchor: s().anchor });
      return {};
    });

  node("flip",
    "The next position's card turns over in place. It was dealt face down at the start; the reading has just earned it.",
    async (state) => {
      const opening = Boolean(state.opening);
      await flipInto(nextPosition(s()), opening ? OPENING_FLIP_REASON : state.decision.reason);
      return opening
        ? { result: { opening: state.opening, dealt: true } }
        : { result: { gate: state.gate, decision: state.decision, flipped: true } };
    });

  node("flip_epilogue",
    "The fourth card, decided at the advice-to-close boundary and before anything is closed: earned by something of their own, it turns and the reading closes once, over four.",
    async (state) => {
      flipEpilogue(s(), await ctx.cardFor(s().epilogue_position), { reason: EPILOGUE_FLIP_REASON });
      const entry = currentCard(s());
      ctx.onEvent({ type: "flip", card: ctx.pack.card(entry.card_id), position: entry.position, reason: entry.flip_reason });
      return { result: { gate: state.gate, decision: state.decision, flipped: true } };
    });

  node("invite",
    "The first card is up. The reader names it and asks them to read it first -- what does it feel like it is pointing at? -- and nothing else.",
    async () => ({ text: await ctx.readerTurn("invite", stage()) }));

  node("respond",
    "No card turns over on this turn. One observation, then one question, inside what they said. The most common turn in a reading.",
    async () => {
      const text = await ctx.readerTurn("respond", { onCard: !s().closed });
      ctx.persist();
      return { text };
    });

  node("clarify",
    "Their question back is answered plainly, and the reader asks again, smaller. Never the same question that just failed.",
    async () => {
      const text = await ctx.readerTurn("clarify", { onCard: false });
      ctx.persist();
      return { text };
    });

  node("bridge",
    "A card has just turned. The reader answers the card behind it while the new one is already up, then asks them to read the new one.",
    async () => ({ text: await ctx.readerTurn("bridge", { ...stage(), readingOffset: 1 }) }));

  node("epilogue",
    "The fourth card's turn: the reader hands the reading back over four cards, in their own words, and closes once.",
    async () => ({ text: await ctx.readerTurn("epilogue", { ...stage(), readingOffset: 1 }) }));

  node("close",
    "The closing beat over three cards, unconditional once the advice card's budget is spent. If the fourth card stayed face down, one line names it as an invitation, never a grade.",
    async (state) => {
      const text = await ctx.readerTurn("close");
      close(s(), text);
      // The spread is spent. What is left is a short tail and a goodbye.
      s().phase = "afterward";
      ctx.persist();
      ctx.onEvent({ type: "closed", reflection: text });
      return { text, result: { gate: state.gate, decision: state.decision, closed: true } };
    });

  node("after",
    "The short tail after the close. A last question gets a real answer; the budget is one, at most three.",
    async (state) => {
      const text = await ctx.readerTurn("after", { onCard: false });
      ctx.persist();
      return { text, result: { gate: state.gate, decision: held("the reading is closed; this is after it") } };
    });

  node("farewell",
    "The goodbye: echo the noticing in one line, leave the door open, and ask nothing. The one turn that deliberately ends without a question. It ends the session.",
    async (state) => {
      const text = await ctx.readerTurn("farewell", { onCard: false });
      end(s(), text);
      ctx.persist();
      ctx.onEvent({ type: "ended", farewell: text });
      return { text, result: { gate: state.gate, decision: held("the reading is over; that was goodbye") } };
    });

  node("afterglow",
    "They chose to stay. Questions stay inside the anchor's territory and move up into what was found, never sideways; a reflective turn with no question is legal here and only here.",
    async (state) => {
      const text = await ctx.readerTurn("afterglow", { onCard: false });
      ctx.persist();
      return { text, result: { gate: state.gate, decision: held("afterglow") } };
    });

  node("regroup",
    "Two afterglow answers in a row with nothing of theirs in them. The reader goes back to what the reading was about, or offers the door again.",
    async (state) => {
      const text = await ctx.readerTurn("regroup", { onCard: false });
      ctx.persist();
      return { text, result: { gate: state.gate, decision: held("the afterglow drifted off the anchor; back to it, or out") } };
    });

  node("meanings",
    "They asked what the cards traditionally mean. Answered plainly from the pack, after the close and only on request, and recorded as an aside that spends none of their turns.",
    async (state) => {
      recordAfterward(s(), {
        // q is the reader's standing turn and a is theirs, the way every
        // exchange is built. The standing turn rather than the last one: after
        // a farewell there is none, and the last one is still the goodbye.
        question: s().pending_question,
        answer: state.answer,
        gate: {},
        aside: true,
        position: s().phase === "afterglow" ? "afterglow" : "afterward",
      });
      const text = await ctx.readerTurn("meanings", { onCard: false });
      ctx.persist();
      return { text, result: { text, decision: held("they asked what the cards mean") } };
    });

  node("revise_anchor",
    "The anchor revision started in decide lands here, after the reader has spoken, so it cost no latency on the turn. On paths that started none this does nothing.",
    async () => {
      // Not a parallel branch: LangGraph runs a superstep to completion before
      // the next begins, so a fan-out beside the reader node would make the
      // reply wait for the revision -- the exact round trip the begin/settle
      // split was built to take out from in front of the person.
      const revision = pending;
      pending = null;
      if (!revision) return {};
      const revised = await revision;
      if (!revised) return {};
      updateAnchor(s(), revised);
      ctx.persist();
      ctx.onEvent({ type: "anchor", anchor: s().anchor, rolling: true });
      return {};
    });

  // -- routers ----------------------------------------------------------------
  //
  // Pure over (state, session), and they return a key, never a node name. The
  // key is the label LangGraph draws on the dashed edge -- and it must not be
  // a node's name, because LangGraph drops the label when key and destination
  // are the same string.

  const entry = (state) => {
    if (state.kind === "meanings") return "asked for the meanings";
    if (s().phase === "opening") return "opening";
    if (dropped() && !currentCard(s())) return "frame dropped";
    return "answer";
  };
  const afterOpening = () => (dropped() ? "frame dropped" : "dealt");
  const afterFlip = (state) => (state.opening ? "first card" : "next card");
  const afterGate = (state) => {
    // Before the closed branch, because it is just as true afterwards: an
    // epilogue card has a budget of its own, and an aside must not spend it.
    if (state.gate.asked_back && currentCard(s())) return "asked back";
    if (s().closed) return "closed";
    return "on a card";
  };
  const afterExchange = () => (dropped() ? "frame dropped" : "judged");
  const advance = (state) => {
    if (!state.decision.flip) return "hold";
    if (!s().anchor) return "no anchor yet";
    if (spreadComplete(s())) return epilogueEarned(s()) ? "epilogue earned" : "spread complete";
    return "earned";
  };
  const afterTail = (state) => {
    if (dropped()) return "frame dropped";
    if (s().phase === "afterglow") return afterglowDrift(s()) ? "drifted" : "stayed";
    return farewellDue(s(), state.gate) ? "farewell due" : "still talking";
  };

  // -- edges ------------------------------------------------------------------

  // One key, one note: "frame dropped" leaves four different nodes and means
  // the same thing from each of them.
  const FRAME_DROPPED = "Safety outranks the rhythm: the stakes were judged as crisis, the tarot frame is dropped, and the reader responds plainly with no card in play.";

  g.addConditionalEdges(START, entry, branches({
    "asked for the meanings": { to: "meanings", note: "They pressed the button that asks what the cards traditionally mean. Only after the close." },
    opening: { to: "judge_opening", note: "The reading has not started: this is the answer to the opening question." },
    "frame dropped": { to: "off_frame", note: FRAME_DROPPED },
    answer: { to: "judge_gate", note: "An ordinary answer, on a card or after the close. It goes to the gate." },
  }));
  g.addConditionalEdges("judge_opening", afterOpening, branches({
    "frame dropped": { to: "respond", note: FRAME_DROPPED },
    dealt: { to: "flip", note: "The first card is dealt, not earned: the gate has nothing to judge yet." },
  }));
  g.addEdge("off_frame", "respond");
  g.addConditionalEdges("judge_gate", afterGate, branches({
    "asked back": { to: "aside", note: "A question back is not an answer. It costs the reader a turn, not them one of theirs." },
    closed: { to: "tail", note: "The reading has closed and they are still talking. That is allowed, and it is not a second reading." },
    "on a card": { to: "exchange", note: "An answer on the current card. It goes on the ledger, then to the decision." },
  }));
  g.addEdge("aside", "clarify");
  g.addConditionalEdges("tail", afterTail, branches({
    "frame dropped": { to: "respond", note: FRAME_DROPPED },
    stayed: { to: "afterglow", note: "They chose to stay after the goodbye, and this answer had something in it." },
    drifted: { to: "regroup", note: "Two consecutive afterglow answers with no life content: the reader stops following the wandering." },
    "farewell due": { to: "farewell", note: "The tail's budget is spent, or they said nothing real past its target. Time to say goodbye." },
    "still talking": { to: "after", note: "The first turns after the close get real replies; that is what the tail's budget is for." },
  }));
  g.addConditionalEdges("exchange", afterExchange, branches({
    "frame dropped": { to: "respond", note: FRAME_DROPPED },
    judged: { to: "decide", note: "The answer is on the record with its verdict; now the flip decision is made from it." },
  }));
  g.addConditionalEdges("decide", advance, branches({
    hold: { to: "respond", note: "No card turns: the answer was thin, or a fresh disclosure gets one exchange inside it first (the dwell rule), or the card has not settled yet." },
    "no anchor yet": { to: "commit_anchor", note: "The first flip of the reading. The anchor is committed off the first card before the second exists." },
    earned: { to: "flip", note: "The card is earned: enough depth, the position's budget spent, the dwell honoured." },
    "epilogue earned": { to: "flip_epilogue", note: "The spread is complete and something of their own landed: the fourth card turns and the close covers four." },
    "spread complete": { to: "close", note: "The spread is complete and the fourth card was not earned: it stays face down and the close names it in a line." },
  }));
  g.addEdge("commit_anchor", "flip");
  g.addConditionalEdges("flip", afterFlip, branches({
    "first card": { to: "invite", note: "The first card of the reading. The reader asks them to read it before saying anything about it." },
    "next card": { to: "bridge", note: "A later card. The reader bridges from the card behind it to the one now up." },
  }));
  g.addEdge("flip_epilogue", "epilogue");
  // Separate edges, not one multi-source edge: a multi-source addEdge is a join
  // that waits for every source, and only one of these runs in a turn.
  for (const from of ["respond", "bridge", "epilogue", "close"]) g.addEdge(from, "revise_anchor");
  g.addEdge("revise_anchor", END);
  for (const from of ["invite", "clarify", "after", "farewell", "afterglow", "regroup", "meanings"]) {
    g.addEdge(from, END);
  }

  const graph = g.compile();

  return { graph, notes };
}
