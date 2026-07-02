// reporter.js — turn findings into a markdown report; optionally post to the PR.
export function buildReport(planned, results) {
  const allIssues = results.flatMap((r) => r.issues);
  const badge = { high: "🔴", medium: "🟠", low: "🟡" };
  const lines = [
    "## 🤖 Agentic QA Report",
    "",
    `Ran **${results.length}** browser tests planned from this PR's diff.`,
    "",
    "| Test | Type | Result |",
    "|---|---|---|",
    ...results.map(
      (r, i) =>
        `| ${planned[i].name} | ${planned[i].type} | ${
          r.status === "passed" ? "✅ passed" : "❌ failed"
        } |`
    ),
    "",
  ];
  if (allIssues.length === 0) {
    lines.push("No issues found. 🎉");
  } else {
    lines.push(`### Issues found (${allIssues.length})`, "");
    for (const it of allIssues) {
      lines.push(
        `#### ${badge[it.severity] ?? ""} [${it.severity.toUpperCase()}] ${it.title}`,
        `*Found during: ${it.test}*`,
        "",
        `**Evidence:** ${it.evidence}`,
        ""
      );
      if (it.suggested_fix) lines.push(`**Suggested fix:** ${it.suggested_fix}`, "");
    }
  }
  lines.push(
    "---",
    "*Replay available: `npx playwright show-trace artifacts/trace-<test>.zip` — video, network & console, synced.*"
  );
  return lines.join("\n");
}

export function hasBlockingIssues(results) {
  return results.some((r) => r.issues.some((i) => i.severity === "high"));
}

// Posts the report as a PR comment when running inside GitHub Actions.
export async function postToPR(markdown) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return false;
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body: markdown }),
    }
  );
  return res.ok;
}
