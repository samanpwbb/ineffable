/**
 * Built-in parser plugins, exported in priority order.
 */

import type { ParserPlugin } from "../plugin.js";
import { BoxParserPlugin } from "./box.js";
import { ButtonParserPlugin } from "./button.js";
import { LineParserPlugin } from "./line.js";
import { TextParserPlugin } from "./text.js";

/** The default set of parser plugins, in priority order. */
export const DEFAULT_PLUGINS: ParserPlugin[] = [
  new BoxParserPlugin(),
  new ButtonParserPlugin(),
  new LineParserPlugin(),
  new TextParserPlugin(),
];

export { BoxParserPlugin } from "./box.js";
export { ButtonParserPlugin } from "./button.js";
export { LineParserPlugin } from "./line.js";
export { TextParserPlugin } from "./text.js";
