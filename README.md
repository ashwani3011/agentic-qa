# Agentic QA (MVP)

An AI agent that tests your web app **in a real browser** on every PR — plans
tests from the diff, clicks through the app like a user, cross-checks the UI
against console errors and failed network calls, files issues with evidence,
and blocks the merge on high-severity bugs.

~500 lines total. Built with Playwright + the Claude API.

## How it works

```
PR opened
   │
   ├─ planner.js   diff + title + description → JSON test plan
   │               (critical flows / edge cases / regression)
   │
   ├─ agent.js     for each test: Claude tool-use loop drives Playwright
   │               tools: navigate · click · type · snapshot · report_issue
   │               every snapshot includes new console errors + failed requests,
   │               so "UI says success but the API 500'd" gets caught
   │
   ├─ reporter.js  markdown report → posted as a PR comment
   │               high severity → process.exit(1) → merge blocked
   │
   └─ artifacts/   Playwright traces = replays (video + network + console,
                   synced): npx playwright show-trace artifacts/trace-*.zip
```

## Quick start (local demo)

```bash
npm install
npx playwright install chromium
export ANTHROPIC_API_KEY=sk-ant-...

# terminal 1: the app under test (has a planted bug)
npm run demo

# terminal 2: run the agent against it
node src/index.js --url http://localhost:3000 \
  --title "Add newsletter signup form" \
  --desc "New signup form posting to /api/signup. Should show a success message on signup and handle invalid input gracefully."
```

Watch the console: the agent narrates its reasoning, fills the form, tries a
plus-addressed email (`ada+test@example.com`), sees the UI claim success while
the network panel shows a 500 — and files a HIGH severity "silent failure" bug.

Then open the replay:

```bash
npx playwright show-trace artifacts/trace-*.zip
```

## The planted bugs (demo-app/)

1. **Backend**: emails containing `+` throw → 500 (`server.js`)
2. **Frontend**: `fetch` response is never checked — the UI shows
   "🎉 Thanks for signing up!" even when the API failed (`index.html`)

Together they produce the exact class of bug static code review can't catch:
the page *looks* fine; only using the app reveals it.

## Running on real PRs

`.github/workflows/qa-agent.yml` wires it into GitHub Actions:
on every PR it boots the app, diffs the PR, runs the agent, posts the report
as a comment, uploads traces as artifacts, and fails the check (blocking
merge) if any high-severity issue is found.

Setup: add `ANTHROPIC_API_KEY` to the repo's Actions secrets.

## Costs & limits (honest notes for the demo)

- Each test ≈ 8–20 Claude calls. A 3-test run is typically a few cents on
  Sonnet; use Haiku for cheaper exploratory runs.
- The snapshot is a simplified DOM view — canvas-heavy or highly dynamic UIs
  need richer snapshots (screenshots + vision would be the next step).
- No auth handling yet: point it at an app with a seeded/logged-in state, or
  add a login step to the test goals.
- The agent can misjudge intent (flag intended behavior). Severity gating and
  human review of the PR comment are the guardrails.
