import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../../docs/dist/", import.meta.url));
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path.endsWith("/")) path += "index.html";
    else if (!extname(path)) path += ".html";
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
    };
    res.setHeader(
      "Content-Type",
      types[extname(path)] ?? "application/octet-stream",
    );
    res.end(await readFile(resolve(root, "." + path)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const hydrated = () =>
    page.waitForFunction(() =>
      Boolean(document.querySelector("#app")?.__vue_app__),
    );
  page.on("pageerror", (error) => errors.push(error.message));
  const url =
    process.env.DOCS_TEST_URL ?? `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await hydrated();
  await page.locator("h1").filter({ hasText: "Genetic Assembly" }).waitFor();
  assert.equal(await page.locator(".VPSidebar:visible").count(), 0);
  await page.screenshot({
    path: "/tmp/genetic-assembly-home.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Read the documentation", exact: true })
    .click();
  await page.waitForURL("**/docs/");
  await page.getByLabel("Color palette").first().selectOption("violet");
  assert.equal(
    await page.locator("html").getAttribute("data-palette"),
    "violet",
  );
  await page.reload();
  await hydrated();
  assert.equal(
    await page.locator("html").getAttribute("data-palette"),
    "violet",
  );
  await page.getByRole("switch").click();
  await page
    .getByRole("button", { name: /Search/ })
    .first()
    .click();
  await page.locator("#localsearch-input").fill("StudyClient");
  await page.locator(".VPLocalSearchBox .result").first().waitFor();
  await page.keyboard.press("Escape");
  await page.goto(url + "/docs/examples.html");
  await page.getByRole("button", { name: /Recorded search history/ }).click();
  await page.locator(".recorded-chart svg").first().waitFor();
  await page.locator(".recorded-chart circle").first().click({ force: true });
  await page.getByText(/Selected candidate/).waitFor();
  assert.equal(await page.locator(".recorded-chart svg").count(), 2);
  await page.getByRole("button", { name: /Two competing targets/ }).click();
  await page
    .getByRole("button", { name: "Run numerical study", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".numerical-example [role=status]")
      ?.textContent?.includes("completed"),
  );
  await page.locator(".numerical-example svg [role=button]").first().click();
  await page.getByText(/Position .* · left/).waitFor();
  await page.getByRole("button", { name: /Neighborhood services/ }).click();
  await page
    .getByRole("button", { name: "Run neighborhood study", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/genetic-assembly-docs-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await hydrated();
  await page.getByRole("button", { name: /mobile navigation/i }).click();
  await page.getByLabel("Color palette").last().selectOption("green");
  await page.waitForFunction(() => {
    const menu = document.querySelector(".VPNavScreen");
    return (
      menu &&
      getComputedStyle(menu).opacity === "1" &&
      !menu.classList.contains("fade-enter-active")
    );
  });
  await page.screenshot({
    path: "/tmp/genetic-assembly-docs-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: navigation, search, palettes, dark mode, recorded charts, and mobile menu.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
