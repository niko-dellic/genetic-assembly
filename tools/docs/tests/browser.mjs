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
  // Shared navigation must not jump when a documentation sidebar appears.
  for (const width of [390, 960, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    let homeLayout;
    for (const path of ["/", "/docs/", "/docs/api-reference/", "/docs/examples.html"]) {
      await page.goto(url + path);
      await hydrated();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const selectors = [".VPNavBarTitle", ".VPNavBarSearch", ".VPNavBarMenu", ".VPNavBarAppearance", ".VPNavBar .docs-theme-picker"];
        return selectors.map(selector => {
          const element = document.querySelector(selector);
          if (!element || !element.getClientRects().length) return null;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        });
      });
      if (!homeLayout) homeLayout = layout;
      else layout.forEach((box, index) => {
        assert.equal(Boolean(box), Boolean(homeLayout[index]), `Navbar visibility at ${width}px ${path}`);
        if (box) for (const key of ["x", "y", "width", "height"])
          assert(Math.abs(box[key] - homeLayout[index][key]) < 1, `Navbar ${index} ${key} moved at ${width}px ${path}: ${homeLayout[index][key]} -> ${box[key]}`);
      });
      const navbarColor = await page.locator(".VPNavBar").evaluate(element => getComputedStyle(element).backgroundColor);
      assert.notEqual(navbarColor, "rgba(0, 0, 0, 0)", `Transparent navbar exposes sidebar at ${width}px ${path}`);
      if (width >= 960 && await page.locator(".VPSidebar").count()) {
        const sidebar = await page.locator(".VPSidebar").boundingBox();
        const navbar = await page.locator(".VPNavBar").boundingBox();
        assert(sidebar.y >= navbar.y + navbar.height, "Sidebar background extends behind navbar title");
      }
      const logo = page.locator(".VPNavBarTitle img.logo");
      await logo.waitFor();
      assert(await logo.evaluate(image => image.complete && image.naturalWidth > 0), "Missing navbar icon");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Horizontal overflow at ${width}px ${path}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
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
  // Theme colors must settle in the same frame, without delayed navbar/search fades.
  for (const path of ["/", "/docs/"]) {
    await page.goto(url + path);
    await hydrated();
    for (const palette of ["neutral"]) {
      await page.waitForTimeout(550);
      for (let direction = 0; direction < 2; direction++) {
        const frames = await page.evaluate(async () => {
          const selectors = ["body", ".VPNavBar", ".VPNavBar .content-body", ".DocSearch-Button", ".DocSearch-Button-Placeholder", ".DocSearch-Button-Key"];
          document.querySelector('.VPNavBar [role="switch"]').click();
          const frames = [];
          for (let i = 0; i < 24; i++) {
            await new Promise(requestAnimationFrame);
            frames.push(selectors.map(selector => {
              const element = document.querySelector(selector);
              if (!element) throw Error(`Missing theme surface: ${selector}`);
              const style = getComputedStyle(element);
              return [style.backgroundColor, style.color, style.borderColor];
            }));
          }
          return frames;
        });
        for (const frame of frames) assert.deepEqual(frame, frames.at(-1), `Theme colors lagged or flickered on ${path} (${palette}, toggle ${direction})`);
      }
    }
  }
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
    "Browser checks passed: navigation, search, dark mode, recorded charts, and mobile menu.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
