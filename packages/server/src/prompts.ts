/** System prompt sent via --system-prompt flag to the Claude CLI. */
export const SYSTEM_PROMPT = `\
You are a text-processing tool that transforms ASCII diagrams. \
You receive a diagram and output a modified version. \
Your ENTIRE stdout will be written directly to a file. \
Output ONLY the diagram content. No prose, no explanations, no questions, \
no markdown fences, no commentary. Never ask for permission.`;

/** Detects conversational output that isn't a diagram. */
export const LOOKS_LIKE_CHAT =
  /^(I |I'm |I need |I can|I've |It seems|Sure|Here|The |This |Let me|Unfortunately|I apologize|Could you|Please |Would you|Note:)/m;

/**
 * Task descriptions keyed by action name.
 * Each value is the full text sent to the LLM after "Task: ".
 */
export const TASK_DESCRIPTIONS: Record<string, string> = {
  repair: `\
REPAIR this diagram.
Look for broken or incomplete widget patterns — missing box corners, unclosed edges,
misaligned borders, partially erased widgets — and fix them.
Do not add new widgets or change the layout. Only repair damaged patterns.`,

  remix: `\
REMIX this diagram.
Produce a completely new layout that preserves ALL existing content but rearranges it.

What "preserve content" means:
- Every button label that exists must appear in the output (same text, not reworded)
- Every text widget that exists must appear in the output (same text, not reworded)
- The total number of boxes, buttons, text widgets, and lines should stay the same

What "new layout" means:
- Change the positions of widgets — move things to different rows and columns
- Change box sizes (wider, taller, narrower, shorter)
- Change grouping — nest widgets inside boxes that previously were outside, or vice versa
- Change alignment — if things were stacked vertically, try horizontal, or a grid
- Change spacing between widgets
- Be creative: the result should look noticeably different, not like a minor shift

Do not add new widgets that were not in the original.
Do not remove any widgets that were in the original.
Do not rename or reword any labels or text.
All box-drawing characters must form valid, complete boxes (no broken corners or edges).
All buttons must use correct [ Label ] syntax.`,

  predict: `\
PREDICT what comes next in this diagram and complete it.
The diagram is a work in progress. Analyze what is already there and add what is missing.

How to analyze:
- Look for repeating patterns (e.g., a series of form fields — if there is "Username" but no "Password", add it)
- Look for incomplete structures (e.g., a header and content area but no footer — add the footer)
- Look for asymmetry that suggests missing pieces (e.g., three buttons in a row with space for a fourth)
- Look for conventional UI patterns (e.g., a login form missing a submit button, a nav bar missing expected items)
- Infer intent from text and layout (e.g., a "Settings" box with only one option probably needs more)

Rules for prediction:
- Preserve everything that already exists — do not move, resize, or restyle existing widgets
- Only add new widgets; never remove or modify existing ones
- Match the visual style of existing widgets: same box sizes for similar items, same spacing conventions, same alignment patterns
- Place new widgets in logical positions relative to existing ones (below, beside, continuing a sequence)
- Do not add more than what the pattern suggests — complete the thought, do not over-extend
- Use the same character conventions already present in the diagram
- If the diagram appears complete and nothing is obviously missing, output it unchanged`,
};

/** Rules appended to every prompt. */
export const OUTPUT_RULES = `\
- Remove any line starting with '# @ai'
- Keep other comment lines (like '# see PATTERNS.md for widget syntax')
- Output the complete file contents and NOTHING else`;
