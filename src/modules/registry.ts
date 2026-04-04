import type { IntentName } from "../models/intent.js";
import type { ModuleHandler } from "./types.js";
import { greetingReply } from "./reply_generator.js";
import { faqAnswerer } from "./faq_answerer.js";
import { taskManager } from "./task_manager.js";
import { reminderManager } from "./reminder_manager.js";
import { memoStore } from "./memo_store.js";
import { summarizer } from "./summarizer.js";
import { helpCapabilities } from "./capabilities.js";

const registry = new Map<IntentName, ModuleHandler>([
  ["greeting", greetingReply],
  ["simple_question", faqAnswerer],
  ["task_create", taskManager],
  ["reminder_request", reminderManager],
  ["memo_save", memoStore],
  ["summarize", summarizer],
  ["help_capabilities", helpCapabilities],
]);

export function getHandler(intent: IntentName): ModuleHandler | undefined {
  return registry.get(intent);
}

export function listRegisteredIntents(): IntentName[] {
  return [...registry.keys()];
}
