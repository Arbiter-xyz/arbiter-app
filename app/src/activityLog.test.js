import { describe, expect, it } from "vitest";
import { createActivityLog } from "./activityLog.js";

function setup() {
  const lines = [];
  const notifications = [];
  const log = createActivityLog({
    write: (l) => lines.push(l),
    notify: (n) => notifications.push(n),
    now: () => "12:00",
  });
  return { log, lines, notifications };
}

describe("createActivityLog (#465)", () => {
  it("mirrors ordinary messages into the notification center", () => {
    const { log, lines, notifications } = setup();
    log("Connected.");
    expect(lines).toEqual(["[12:00] Connected."]);
    expect(notifications).toEqual(["Connected."]);
  });

  it("keeps question and answer text out of the notification center", () => {
    const { log, lines, notifications } = setup();
    // The two calls main.js makes for dispatched questions and answers.
    log('New question dispatched: "Is the bridge open?"', {
      notification: "New question dispatched (id q-42)",
    });
    log('Answer submitted: "yes, until 6pm"', {
      notification: "Answer submitted for question q-42",
    });

    expect(lines.join("\n")).toContain("Is the bridge open?");
    const stored = JSON.stringify(notifications);
    expect(stored).not.toContain("Is the bridge open?");
    expect(stored).not.toContain("until 6pm");
    expect(notifications).toEqual([
      "New question dispatched (id q-42)",
      "Answer submitted for question q-42",
    ]);
  });

  it("can skip the notification entirely", () => {
    const { log, notifications } = setup();
    log("local only", { notification: null });
    expect(notifications).toEqual([]);
  });
});
