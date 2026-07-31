import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("button:has-text('Click to play'), button:has-text('Tap to play')", { timeout: 15000 });
await page.getByRole("button", { name: /to play/i }).click();
await page.waitForTimeout(500);

// Diagnose engine
const diag = await page.evaluate(async () => {
  const t = window.__controlsTest;
  if (!t) return { err: "no probe" };
  t.setPlaying(true);
  const p0 = t.getPosition();
  t.setKeys(["KeyW"]);
  // wait using rAF frames
  await new Promise((r) => {
    let n = 0;
    const tick = () => {
      n++;
      if (n >= 60) r(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const p1 = t.getPosition();
  const speed = t.getSpeed();
  t.setKeys([]);
  await new Promise((r) => setTimeout(r, 100));
  t.setKeys(["KeyA"]);
  await new Promise((r) => {
    let n = 0;
    const tick = () => {
      n++;
      if (n >= 60) r(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const p2 = t.getPosition();
  t.setKeys(["KeyD"]);
  await new Promise((r) => {
    let n = 0;
    const tick = () => {
      n++;
      if (n >= 60) r(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const p3 = t.getPosition();
  t.setKeys([]);
  return { p0, p1, speedAfterW: speed, p2, p3, yaw: t.getYaw() };
});

await page.screenshot({ path: "/workspace/screenshots/blockworld-playing.png" });

// Try real keyboard
await page.evaluate(() => window.__controlsTest?.setPlaying(true));
const beforeKb = await page.evaluate(() => window.__controlsTest?.getPosition());
await page.keyboard.down("w");
await page.waitForTimeout(1000);
await page.keyboard.up("w");
const afterKb = await page.evaluate(() => window.__controlsTest?.getPosition());

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: "/workspace/screenshots/blockworld-mobile.png" });

const wDeltaZ = (diag.p1?.z ?? 0) - (diag.p0?.z ?? 0);
const aDeltaX = (diag.p2?.x ?? 0) - (diag.p1?.x ?? 0);
const dDeltaX = (diag.p3?.x ?? 0) - (diag.p2?.x ?? 0);
const kbDeltaZ = (afterKb?.z ?? 0) - (beforeKb?.z ?? 0);

const result = {
  diag,
  beforeKb,
  afterKb,
  wDeltaZ,
  aDeltaX,
  dDeltaX,
  kbDeltaZ,
  wOk: wDeltaZ < -1,
  aOk: aDeltaX < -1,
  dOk: dDeltaX > 1,
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(errors.length || !result.wOk ? 1 : 0);
