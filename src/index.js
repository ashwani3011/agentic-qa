#!/usr/bin/env node
// index.js — orchestrator. Plan tests from the PR context, run each with
// the browser agent, report, and gate the merge on high-severity issues.
//
// Usage:
//   node src/index.js --url http://localhost:3000 \
//     --title "Add signup form" --desc "New signup flow" --diff-file pr.diff
import fs from "node:fs";
import { planTests } from "./planner.js";
import { runTest } from "./agent.js";
import { buildReport, hasBlockingIssues, postToPR } from "./reporter.js";

function arg(flag, fallback = "") {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const baseUrl = arg("--url", "http://localhost:3000");
const title = arg("--title", process.env.PR_TITLE || "Untitled change");
const description = arg("--desc", process.env.PR_BODY || "");
const diffFile = arg("--diff-file");
const diff = diffFile ? fs.readFileSync(diffFile, "utf8") : "";
const artifactsDir = arg("--out", "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });

console.log("📋 Planning tests from PR context...");
const plan = await planTests({ title, description, diff });
plan.forEach((t) => console.log(`   • [${t.type}] ${t.name} — ${t.goal}`));

const results = [];
for (const test of plan) {
  console.log(`\n▶️  ${test.name}`);
  const result = await runTest({ baseUrl, test, artifactsDir });
  console.log(`   ${result.status === "passed" ? "✅" : "❌"} ${result.summary}`);
  results.push(result);
}

const report = buildReport(plan, results);
fs.writeFileSync(`${artifactsDir}/report.md`, report);
console.log("\n" + report);

if (await postToPR(report)) console.log("\n💬 Posted report to the PR.");

if (hasBlockingIssues(results)) {
  console.error("\n⛔ High-severity issues found — blocking merge.");
  process.exit(1);
}
