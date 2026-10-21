import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { buildLanguageTemplate } from "./template";

/**
 * `npm run i18n:new -- <code>` runs this file with I18N_NEW_LOCALE set: it writes
 * src/lib/i18n/messages/locales/<code>.json with every English key (English text as the
 * placeholder to translate) and every plural category <code> needs. In a normal `npm test` run
 * the variable is unset and only the template builder is checked.
 */
const requested = process.env.I18N_NEW_LOCALE;

describe("new language template", () => {
  it("covers every English key and the language's plural categories", () => {
    const template = buildLanguageTemplate("ru", en as Record<string, string>);
    for (const key of Object.keys(en)) expect(template).toHaveProperty(key);
    const pluralBase = Object.keys(en).find((key) => key.endsWith("_other"))!.slice(0, -"_other".length);
    for (const category of ["one", "few", "many", "other"]) expect(template).toHaveProperty(`${pluralBase}_${category}`);
  });

  it.runIf(Boolean(requested))("writes the requested catalogue", () => {
    const code = requested!;
    const target = path.resolve(__dirname, "../../src/lib/i18n/messages/locales", `${code}.json`);
    if (existsSync(target) && process.env.I18N_OVERWRITE !== "1") {
      throw new Error(`${target} already exists. Set I18N_OVERWRITE=1 to replace it.`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(buildLanguageTemplate(code, en as Record<string, string>), null, 2) + "\n");
    console.log(`Wrote ${target}`);
  });
});
