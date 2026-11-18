import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3000/";
const out = new URL("../src/features/landing/plates/thumbs/", import.meta.url);
const CHAPTERS = ["Home", "Inbox", "Board", "Activity", "Briefs"];
const WIDTH = 320;
const HEIGHT = 200;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.addStyleTag({
  content:
    '#tour button[aria-label$="chapter"], nav[aria-label="Worklog"] { display: none !important }',
});
for (const chapter of CHAPTERS) {
  await page.click(`[role="tab"][aria-label="${chapter}"]`);
  // oxlint-disable-next-line no-await-in-loop -- one chapter on screen at a time
  await page.waitForTimeout(1500);
  const shot = await page.locator("#tour > div").first().screenshot();
  const webp = await page.evaluate(
    async ({
      png,
      width,
      height,
    }: {
      png: string;
      width: number;
      height: number;
    }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const crop = image.width / (width / height);
      canvas
        .getContext("2d")
        ?.drawImage(
          image,
          0,
          Math.max(0, (image.height - crop) / 2),
          image.width,
          Math.min(crop, image.height),
          0,
          0,
          width,
          height
        );
      return canvas.toDataURL("image/webp", 0.82).split(",")[1] ?? "";
    },
    { png: shot.toString("base64"), width: WIDTH, height: HEIGHT }
  );
  await Bun.write(
    new URL(`${chapter.toLowerCase()}.webp`, out),
    Buffer.from(webp, "base64")
  );
}
await context.close();
await browser.close();
