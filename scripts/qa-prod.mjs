import { chromium } from "playwright";
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

// Start preview on 8081 without killing dev on 8080
const child = spawn("npx", ["vite", "preview", "--host", "0.0.0.0", "--port", "8081"], {
  cwd: "/workspace",
  stdio: ["ignore", "pipe", "pipe"],
});
let ready = false;
child.stdout.on("data", (d) => {
  if (String(d).includes("8081")) ready = true;
});
child.stderr.on("data", (d) => {
  if (String(d).includes("8081")) ready = true;
});

for (let i = 0; i < 40 && !ready; i++) await sleep(250);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://127.0.0.1:8081/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("button:has-text('play')", { timeout: 20000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: "/workspace/screenshots/blockworld-prod.png" });
const body = await page.locator("body").innerText();
const hasCanvas = await page.locator("canvas").count();

console.log(JSON.stringify({ errors, body: body.slice(0, 200), hasCanvas, title: await page.title() }, null, 2));
await browser.close();
child.kill("SIGTERM");
process.exit(errors.length || hasCanvas < 1 ? 1 : 0);
