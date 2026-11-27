import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://localhost:15175/";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:15173";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => { log.push(line); console.log(line); };

async function setMode(mode) {
  const response = await fetch(`${MOCK}/api/mock/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  note(`mock mode -> ${mode} (${response.status})`);
}

// Reuse the browser build already present on this machine instead of downloading one.
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.USERPROFILE}\\AppData\\Local\\ms-playwright\\chromium-1255\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on("console", (message) => { if (message.type() === "error") note(`console.error: ${message.text()}`); });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  note(`screenshot ${name}.png`);
}

// 1. idle panel with the composer
await setMode("normal");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByTestId("composer-input").waitFor();
await shot("01-composer-idle");

// AC1: IME composition then Enter must not send
const input = page.getByTestId("composer-input");
await input.click();
await input.fill("会员空间的对接流程是什么");
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, isComposing: true }));
  el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "会员空间的对接流程是什么" }));
});
await page.waitForTimeout(200);
const msgCountAfterIme = await page.getByTestId("user-msg").count();
note(`AC1 user messages after IME Enter = ${msgCountAfterIme}`);
await shot("02-ac1-ime-enter-no-send");

// AC4: draft survives closing and reopening the panel
await page.getByTestId("toggle-panel").click();
await page.waitForTimeout(150);
note(`panel closed, composer present = ${await page.getByTestId("composer-input").count()}`);
await shot("03-ac4-panel-closed");
await page.getByTestId("toggle-panel").click();
await page.getByTestId("composer-input").waitFor();
const draftValue = await page.getByTestId("composer-input").inputValue();
note(`AC4 draft after reopen = ${JSON.stringify(draftValue)}`);
await shot("04-ac4-draft-restored");

// normal streaming
await setMode("normal");
await page.getByTestId("send-button").click();
await page.getByTestId("assistant-msg").first().waitFor();
await page.waitForTimeout(1200);
await shot("05-streaming-normal");
await page.waitForTimeout(2500);
note(`normal stream text = ${JSON.stringify((await page.getByTestId("assistant-msg").first().innerText()).slice(0, 80))}`);
await shot("06-streaming-done");

// stop generation
await setMode("slow");
await page.getByTestId("composer-input").fill("停止生成的演示问题");
await page.getByTestId("send-button").click();
await page.waitForTimeout(700);
await shot("07-stop-button-visible");
await page.getByTestId("stop-button").click();
await page.waitForTimeout(400);
note(`stop tag present = ${await page.getByTestId("stopped-tag").count()}`);
await shot("08-stopped");

// AC2: drop -> three reconnects -> retry banner -> retry succeeds
const chatRequests = [];
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/assistant/chat")) {
    chatRequests.push({ at: Date.now(), body: request.postData() });
  }
});
// Start the reconnect demo on a fresh page so the turn below is the only one in the thread.
await setMode("drop");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("composer-input").fill("断线重连的演示问题");
await page.getByTestId("send-button").click();
await page.getByTestId("retrying-banner").waitFor({ timeout: 5000 });
await shot("09-ac2-retrying");
await page.getByTestId("retry-banner").waitFor({ timeout: 15000 });
const gaps = chatRequests.slice(1).map((item, index) => item.at - chatRequests[index].at);
note(`AC2 chat requests before retry = ${chatRequests.length}, gaps ms = ${JSON.stringify(gaps)}`);
note(`AC2 banner text = ${JSON.stringify(await page.getByTestId("retry-banner").innerText())}`);
await shot("10-ac2-retry-banner");

await setMode("normal");
await page.getByTestId("retry-button").click();
await page.getByTestId("assistant-msg").last().waitFor({ timeout: 10000 });
await page.waitForFunction(
  () => document.querySelector('[data-testid="assistant-msg"]')?.getAttribute("data-status") === "done",
  null,
  { timeout: 15000 },
);
const assistantMessages = await page.getByTestId("assistant-msg").count();
note(`AC2 assistant messages after retry = ${assistantMessages}, total chat requests = ${chatRequests.length}`);
await shot("11-ac2-retry-success");

// AC3: 503 ASSISTANT_DISABLED disables the composer
await setMode("disabled");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("composer-input").fill("暂停分支的演示问题");
await page.getByTestId("send-button").click();
await page.getByTestId("paused-notice").waitFor({ timeout: 8000 });
const disabledAttr = await page.getByTestId("composer-input").isDisabled();
note(`AC3 composer disabled = ${disabledAttr}, paused notice = ${JSON.stringify(await page.getByTestId("paused-notice").innerText())}`);
await shot("12-ac3-assistant-disabled");

// 503 RATE_LIMITED keeps the composer enabled
await setMode("ratelimit");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("composer-input").fill("限流分支的演示问题");
await page.getByTestId("send-button").click();
await page.getByTestId("retry-banner").waitFor({ timeout: 8000 });
note(`RATE_LIMITED composer disabled = ${await page.getByTestId("composer-input").isDisabled()}, banner = ${JSON.stringify(await page.getByTestId("retry-banner").innerText())}`);
await shot("13-503-ratelimited");

await setMode("normal");
writeFileSync(`${OUT}/screenshots.log`, log.join("\n") + "\n", "utf8");
await browser.close();
note("done");
