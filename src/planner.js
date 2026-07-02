// planner.js — the "context-aware" part. One Claude call:
// PR title + description + diff in, structured test plan out.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export async function planTests({ title, description, diff }) {
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system:
      "You are a QA lead planning browser tests for a pull request. " +
      "Given the PR context, output a focused test plan as pure JSON " +
      "(no markdown fences): an array of 2-5 tests, each " +
      '{"name": string, "type": "critical"|"edge"|"regression", ' +
      '"goal": string (one concrete, verifiable objective the agent can ' +
      "pursue in a browser, e.g. 'Submit the signup form with a valid " +
      "email and verify a success message appears AND the API call " +
      "succeeds')}. Cover the happy path, at least one edge case " +
      "(invalid/unusual input), and one regression check of nearby " +
      "functionality. Keep goals specific to what the diff changed.",
    messages: [
      {
        role: "user",
        content:
          `PR title: ${title}\n\nPR description: ${description}\n\n` +
          `Diff:\n${(diff || "").slice(0, 12000)}`,
      },
    ],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}
