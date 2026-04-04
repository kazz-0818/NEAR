import type { ModuleContext, ModuleResult } from "./types.js";

export async function greetingReply(_ctx: ModuleContext): Promise<ModuleResult> {
  return {
    success: true,
    draft: "こんにちは。NEARです。本日はどのようなことでお手伝いできますでしょうか。",
    situation: "success",
  };
}
