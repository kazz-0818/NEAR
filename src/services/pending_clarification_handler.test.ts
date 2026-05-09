import assert from "node:assert/strict";
import test from "node:test";
import { tryHandlePendingClarification } from "./pending_clarification_handler.js";

test("consume pending reminder target by 1ばん", async () => {
  let consumedStatus: string | null = null;
  const r = await tryHandlePendingClarification(
    {
      db: {} as never,
      channel: "line",
      channelUserId: "U1",
      actorUserId: "U1",
      text: "1ばん",
    },
    {
      getPending: async () => ({
        id: 99,
        kind: "reminder_task_target",
        required_slot: "target_number",
        payload_json: {
          when_description: "5分後",
          candidate_items: [{ number: 1, title: "システム開発" }],
        },
      }),
      markStatus: async (_db, _id, status) => {
        consumedStatus = status;
      },
    }
  );
  assert.equal(r.handled, false);
  if (!r.handled && "forceIntent" in r) {
    assert.equal(r.forceIntent, "reminder_request");
    assert.equal(r.forceRequiredParams.message, "システム開発");
    assert.equal(r.forceRequiredParams.when_description, "5分後");
  }
  assert.equal(consumedStatus, "consumed");
});
