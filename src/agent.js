// agent.js — the core: a Claude tool-use loop that drives the browser.
// Claude sees page snapshots (including console + network errors),
// decides actions, and files issues when reality diverges from intent.
import Anthropic from "@anthropic-ai/sdk";
import { Browser } from "./browser.js";

const client = new Anthropic();
const MAX_STEPS = 10;

const TOOLS = [
  {
    name: "navigate",
    description: "Go to a path or URL. Returns a page snapshot.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "click",
    description:
      "Click an interactive element by its [ref] number from the latest snapshot. Returns a new snapshot.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "integer" } },
      required: ["ref"],
    },
  },
  {
    name: "type",
    description:
      "Clear and type text into an input/textarea by its [ref] number from the latest snapshot.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "integer" }, text: { type: "string" } },
      required: ["ref", "text"],
    },
  },
  {
    name: "snapshot",
    description:
      "Take a fresh snapshot of the current page (visible text, interactive elements, new console/network errors).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "report_issue",
    description:
      "File a bug you have verified. Include concrete evidence (what you did, what happened, console/network errors observed).",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["high", "medium", "low"] },
        title: { type: "string" },
        evidence: { type: "string" },
        suggested_fix: { type: "string" },
      },
      required: ["severity", "title", "evidence"],
    },
  },
  {
    name: "test_complete",
    description: "Call when the test goal is fully verified (pass or fail).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["passed", "failed"] },
        summary: { type: "string" },
      },
      required: ["status", "summary"],
    },
  },
];

const SYSTEM = `You are an autonomous QA agent testing a web app in a real browser, like a meticulous human tester.

Rules:
- Pursue the test goal step by step. Take a snapshot after actions that change the page.
- Element refs are ONLY valid for the latest snapshot. After the page changes, re-snapshot before clicking.
- A UI that LOOKS fine can still be broken: always cross-check the UI against consoleErrors and failedRequests in snapshots. A success message alongside a failed API call is a HIGH severity bug (silent failure).
- Report issues with report_issue as soon as you verify them — include the exact user action, observed behavior, and the console/network evidence.
- Do not report an issue you have not reproduced. Do not report styling nitpicks.
- Severity: high = broken/misleading core flow or data loss; medium = degraded UX or unhandled error shown; low = minor.
- Always finish by calling test_complete.`;

export async function runTest({
  baseUrl,
  test,
  artifactsDir,
  log = console.log,
}) {
  const browser = new Browser(baseUrl, artifactsDir);
  await browser.launch(test.name);
  const issues = [];
  let result = {
    status: "failed",
    summary: "Agent did not complete within step limit.",
  };

  const messages = [
    {
      role: "user",
      content:
        `Test name: ${test.name}\nType: ${test.type}\nGoal: ${test.goal}\n\n` +
        `The app is at ${baseUrl}. Begin by navigating to "/".`,
    },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter((b) => b.type === "tool_use");
      const thought = res.content.find((b) => b.type === "text")?.text;
      if (thought) log(`  🧠 ${thought.slice(0, 160)}`);
      if (toolUses.length === 0) break;

      const results = [];
      let done = false;
      for (const tu of toolUses) {
        let output;
        try {
          if (tu.name === "navigate")
            output = await browser.navigate(tu.input.path);
          else if (tu.name === "click") {
            log(`  🖱  click [${tu.input.ref}]`);
            output = await browser.click(tu.input.ref);
          } else if (tu.name === "type") {
            log(`  ⌨️  type "${tu.input.text}" into [${tu.input.ref}]`);
            output = await browser.type(tu.input.ref, tu.input.text);
          } else if (tu.name === "snapshot") output = await browser.snapshot();
          else if (tu.name === "report_issue") {
            const shot = await browser.screenshot(tu.input.title);
            issues.push({ ...tu.input, test: test.name, screenshot: shot });
            log(`  🐞 [${tu.input.severity.toUpperCase()}] ${tu.input.title}`);
            output = { filed: true };
          } else if (tu.name === "test_complete") {
            result = { status: tu.input.status, summary: tu.input.summary };
            done = true;
            output = { ok: true };
          }
        } catch (err) {
          output = { error: String(err).slice(0, 300) };
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output),
        });
      }
      messages.push({ role: "user", content: results });
      if (done) break;
    }
  } finally {
    await browser.close();
  }
  return { ...result, issues };
}
