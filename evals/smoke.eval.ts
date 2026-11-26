import { describe, expect, it } from "vitest";
import { app } from "../src/server.js";

describe("Hands-On Diet MCP smoke", () => {
  it("exports a Skybridge app with tools", () => {
    expect(app).toBeTruthy();
  });
});
