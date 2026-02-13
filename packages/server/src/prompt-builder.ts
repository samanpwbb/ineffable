import fs from "node:fs";
import { SYSTEM_PROMPT, TASK_DESCRIPTIONS, OUTPUT_RULES } from "./prompts.js";

export interface PromptInput {
  patternsPath: string;
  diagramPath: string;
  instruction: string;
  userMessage?: string;
}

export interface BuiltPrompt {
  prompt: string;
  systemPrompt: string;
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const patterns = fs.readFileSync(input.patternsPath, "utf-8");
  const diagramContent = fs.readFileSync(input.diagramPath, "utf-8");

  let taskDescription = TASK_DESCRIPTIONS[input.instruction.toLowerCase()];

  if (!taskDescription) {
    taskDescription = [
      "The user has left this instruction in the file:",
      `"${input.instruction}"`,
      "\nEdit the diagram to fulfill the instruction.",
    ].join("\n");
  }

  if (input.userMessage) {
    taskDescription += "\n\nAdditional user instruction: " + input.userMessage;
  }

  const prompt = [
    "Widget pattern definitions:\n",
    patterns,
    "\nCurrent file content:\n",
    diagramContent,
    "\nTask: " + taskDescription,
    "\nRules:",
    OUTPUT_RULES,
  ].join("\n");

  return { prompt, systemPrompt: SYSTEM_PROMPT };
}
