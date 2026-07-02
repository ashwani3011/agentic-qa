// browser.js — Playwright wrapper the agent drives.
// Exposes: snapshot() of the page, click/type actions by element ref,
// and captures console errors + failed network requests as evidence.
import { chromium } from "playwright";
import path from "node:path";

export class Browser {
  constructor(baseUrl, artifactsDir) {
    this.baseUrl = baseUrl;
    this.artifactsDir = artifactsDir;
    this.consoleErrors = [];
    this.networkErrors = [];
    this.elements = []; // last snapshot's locators, indexed by ref
    this.step = 0;
  }

  async launch(testName) {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      recordVideo: { dir: path.join(this.artifactsDir, "videos") },
    });
    // Trace = your "replay": video + network + console, synced.
    await this.context.tracing.start({ screenshots: true, snapshots: true });
    this.page = await this.context.newPage();

    // Evidence listeners — this is how silent failures get caught.
    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.consoleErrors.push(msg.text().slice(0, 300));
      }
    });
    this.page.on("response", (res) => {
      if (res.status() >= 400) {
        this.networkErrors.push(
          `${res.request().method()} ${res.url()} → ${res.status()}`
        );
      }
    });
    this.page.on("pageerror", (err) => {
      this.consoleErrors.push(`Uncaught: ${String(err).slice(0, 300)}`);
    });
    this.traceName = testName.replace(/\W+/g, "-").toLowerCase();
  }

  // Returns fresh console/network errors since last drained, then clears them.
  drainEvidence() {
    const evidence = {
      consoleErrors: [...this.consoleErrors],
      failedRequests: [...this.networkErrors],
    };
    this.consoleErrors = [];
    this.networkErrors = [];
    return evidence;
  }

  async navigate(urlPath) {
    const url = urlPath.startsWith("http")
      ? urlPath
      : new URL(urlPath, this.baseUrl).href;
    await this.page.goto(url, { waitUntil: "networkidle" });
    return this.snapshot();
  }

  // A compact, LLM-friendly view of the page: visible text + numbered
  // interactive elements the agent can click/type into by ref.
  async snapshot() {
    await this.page.waitForTimeout(300); // let UI settle
    const handles = await this.page.$$(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"]'
    );
    this.elements = [];
    const lines = [];
    for (const h of handles) {
      if (!(await h.isVisible().catch(() => false))) continue;
      const ref = this.elements.length;
      this.elements.push(h);
      const desc = await h.evaluate((el) => {
        const bits = [el.tagName.toLowerCase()];
        if (el.type) bits.push(`type=${el.type}`);
        if (el.name) bits.push(`name=${el.name}`);
        if (el.placeholder) bits.push(`placeholder="${el.placeholder}"`);
        if (el.value) bits.push(`value="${String(el.value).slice(0, 40)}"`);
        const label = el.getAttribute("aria-label");
        if (label) bits.push(`label="${label}"`);
        const text = (el.innerText || "").trim().slice(0, 60);
        if (text) bits.push(`text="${text}"`);
        return bits.join(" ");
      });
      lines.push(`[${ref}] ${desc}`);
    }
    const bodyText = (await this.page.innerText("body").catch(() => ""))
      .replace(/\n{2,}/g, "\n")
      .slice(0, 2500);
    return {
      url: this.page.url(),
      title: await this.page.title(),
      visibleText: bodyText,
      interactiveElements: lines,
      ...this.drainEvidence(),
    };
  }

  async click(ref) {
    const el = this.elements[ref];
    if (!el) return { error: `No element with ref ${ref}. Take a new snapshot.` };
    await el.click({ timeout: 5000 });
    return this.snapshot();
  }

  async type(ref, text) {
    const el = this.elements[ref];
    if (!el) return { error: `No element with ref ${ref}. Take a new snapshot.` };
    await el.fill(text, { timeout: 5000 });
    return { ok: true, typed: text };
  }

  async screenshot(label) {
    const file = path.join(
      this.artifactsDir,
      `${this.traceName}-${++this.step}-${label.replace(/\W+/g, "-")}.png`
    );
    await this.page.screenshot({ path: file, fullPage: true });
    return file;
  }

  async close() {
    await this.context.tracing.stop({
      path: path.join(this.artifactsDir, `trace-${this.traceName}.zip`),
    });
    await this.context.close();
    await this.browser.close();
  }
}
