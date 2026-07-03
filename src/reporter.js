// reporter.js — polished report + sticky PR comment (updates itself on re-runs).
const MARKER = "<!-- agentic-qa-report -->";

export function buildReport(planned, results) {
  const allIssues = results.flatMap((r) => r.issues);
  const high = allIssues.filter((i) => i.severity === "high").length;
  const badge = { high: "🔴", medium: "🟠", low: "🟡" };
  const fmt = (ms) => (ms ? `${(ms / 1000).toFixed(0)}s` : "—");

  const failed = results.filter((r) => r.status !== "passed").length;

  const verdict =
    high > 0
      ? `> [!CAUTION]\n> ### ⛔ Merge blocked — ${high} high-severity issue${high > 1 ? "s" : ""} found`
      : failed > 0
        ? `> [!WARNING]\n> ### ⚠️ ${failed} test${failed > 1 ? "s" : ""} did not complete — no blocking issues, but worth a look`
        : allIssues.length > 0
          ? `> [!WARNING]\n> ### ⚠️ Passed with ${allIssues.length} non-blocking issue${allIssues.length > 1 ? "s" : ""}`
          : `> [!TIP]\n> ### ✅ All tests passed — no issues found`;

  const lines = [
    MARKER,
    "## 🤖 Agentic QA Report",
    "",
    verdict,
    "",
    `Planned **${results.length} browser tests** from this PR's title, description & diff, then ran them against the live app.`,
    "",
    "| | Test | Type | Duration | Result |",
    "|---|---|---|---|---|",
    ...results.map((r, i) => {
      const icon = r.status === "passed" ? "✅" : "❌";
      const type =
        {
          critical: "🎯 critical",
          edge: "🧪 edge",
          regression: "🔁 regression",
        }[planned[i].type] ?? planned[i].type;
      return `| ${icon} | ${planned[i].name} | ${type} | ${fmt(r.duration)} | ${r.status} |`;
    }),
    "",
  ];

  if (allIssues.length > 0) {
    lines.push(`### Issues (${allIssues.length})`, "");
    for (const it of allIssues) {
      lines.push(
        "<details>",
        `<summary><strong>${badge[it.severity] ?? ""} [${it.severity.toUpperCase()}]</strong> ${it.title}</summary>`,
        "",
        `> _Found during: ${it.test}_`,
        "",
        "**Evidence**",
        "",
        it.evidence,
        "",
      );
      if (it.suggested_fix)
        lines.push("**Suggested fix**", "", it.suggested_fix, "");
      lines.push("</details>", "");
    }
  }

  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const runUrl =
    GITHUB_REPOSITORY && GITHUB_RUN_ID
      ? `${GITHUB_SERVER_URL || "https://github.com"}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
      : null;

  lines.push(
    "---",
    runUrl
      ? `🎬 **Replays:** [download the \`qa-replays\` artifact](${runUrl}) (videos, screenshots & Playwright traces), then \`npx playwright show-trace trace-<test>.zip\` for a synced video + network + console timeline.`
      : "🎬 **Replays:** see `artifacts/` — `npx playwright show-trace artifacts/trace-<test>.zip` for a synced video + network + console timeline.",
    "",
    "<sub>Agentic QA · planned & executed by an AI agent in a real browser · high severity blocks merge</sub>",
  );
  return lines.join("\n");
}

export function hasBlockingIssues(results) {
  return results.some((r) => r.issues.some((i) => i.severity === "high"));
}

// Posts the report as a PR comment. Sticky: updates its previous comment
// on re-runs instead of posting a new one each time.
export async function postToPR(markdown) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return false;
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  // Find our previous comment (contains the marker).
  let existingId = null;
  const list = await fetch(`${api}/issues/${PR_NUMBER}/comments?per_page=100`, {
    headers,
  });
  if (list.ok) {
    const comments = await list.json();
    existingId = comments.find((c) => c.body?.includes(MARKER))?.id ?? null;
  }

  const res = existingId
    ? await fetch(`${api}/issues/comments/${existingId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body: markdown }),
      })
    : await fetch(`${api}/issues/${PR_NUMBER}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: markdown }),
      });
  return res.ok;
}
