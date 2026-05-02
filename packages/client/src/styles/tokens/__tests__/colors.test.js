import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const colorsCss = readFileSync("src/styles/tokens/colors.css", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const remoteHtml = readFileSync("remote.html", "utf8");

function readBlock(css, marker) {
  const start = css.indexOf(marker);
  expect(start, `${marker} missing`).toBeGreaterThanOrEqual(0);

  const openBrace = css.indexOf("{", start);
  if (openBrace === -1) {
    throw new Error(`Missing block for ${marker}`);
  }

  let depth = 0;
  for (let index = openBrace; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    }
    if (css[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return css.slice(openBrace + 1, index);
    }
  }

  throw new Error(`Unclosed block for ${marker}`);
}

describe("theme color tokens", () => {
  it("resolves auto as very dark unless the system prefers light", () => {
    const autoBlock = readBlock(colorsCss, '[data-theme="auto"]');
    expect(autoBlock).toContain("color-scheme: dark;");
    expect(autoBlock).toContain("--bg-surface:   #09090b;");
    expect(autoBlock).toContain("--text-primary:   #f4f4f5;");

    const lightMediaBlock = readBlock(
      colorsCss,
      "@media (prefers-color-scheme: light)",
    );
    const autoLightBlock = readBlock(lightMediaBlock, '[data-theme="auto"]');

    expect(autoLightBlock).toContain("color-scheme: light;");
    expect(autoLightBlock).toContain("--bg-surface:   #ffffff;");
    expect(autoLightBlock).toContain("--text-primary:   #09090b;");
    expect(autoLightBlock).toContain("--border-default: #e4e4e7;");
    expect(autoLightBlock).toContain("--status-badge-running-text: #c2410c;");
  });

  it("prevents auto theme background flash in both HTML entrypoints", () => {
    for (const html of [indexHtml, remoteHtml]) {
      expect(html).toContain('html[data-theme="auto"]');
      expect(html).toContain('html:not([data-theme]), html[data-theme="auto"]');
    }
  });
});
