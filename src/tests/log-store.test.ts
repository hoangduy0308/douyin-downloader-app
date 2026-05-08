import { describe, expect, it } from "vitest";
import { AppLogStore } from "../services/logStore";

describe("AppLogStore", () => {
  it("keeps only the newest 1000 events", () => {
    const store = new AppLogStore(1000);

    for (let index = 0; index < 1005; index += 1) {
      store.append({
        level: "info",
        source: "test",
        message: `line-${index}`,
      });
    }

    const events = store.getEventsNewestFirst();
    expect(events).toHaveLength(1000);
    expect(events[0].message).toBe("line-1004");
    expect(events[events.length - 1].message).toBe("line-5");
  });

  it("redacts sensitive cookie and auth content before storing", () => {
    const store = new AppLogStore(10);
    store.append({
      level: "error",
      source: "cookie",
      message: "Authorization: Bearer abc123 cookie=secret-cookie-value msToken=my-secret-token",
      context: {
        cookie: "very-secret",
        authorizationHeader: "Bearer xyz",
        normal: "ok",
      },
    });

    const [event] = store.getEventsNewestFirst();
    expect(event.message).not.toContain("abc123");
    expect(event.message).not.toContain("secret-cookie-value");
    expect(event.message).not.toContain("my-secret-token");
    expect(event.message).toContain("[REDACTED]");
    expect(event.context?.cookie).toBe("[REDACTED]");
    expect(event.context?.authorizationHeader).toBe("[REDACTED]");
    expect(event.context?.normal).toBe("ok");
  });
});
