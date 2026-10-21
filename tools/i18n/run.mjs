// npm run i18n:new -- <code>     create src/lib/i18n/messages/locales/<code>.json from English
// npm run i18n:check             check every catalogue (keys, placeholders, markup, plurals)
import { spawnSync } from "node:child_process";

const [command, code] = process.argv.slice(2);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const vitest = (files, env = {}) =>
  spawnSync(npx, ["vitest", "run", ...files], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } }).status ?? 1;

if (command === "new") {
  if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
    console.error("Usage: npm run i18n:new -- <BCP 47 code, e.g. sw or pt-BR>");
    process.exit(1);
  }
  const status = vitest(["tools/i18n/newLanguage.test.ts"], { I18N_NEW_LOCALE: code });
  if (status === 0) {
    console.log(`\nNext steps (docs/internationalization.md, "Adding a language"):
  1. Translate the values in src/lib/i18n/messages/locales/${code}.json.
  2. Add ${code} to LOCALES in src/lib/i18n/config.ts (nativeName, englishName, intlLocale, machineDrafted).
  3. Add a loader line for ${code} in src/lib/i18n/messages/index.ts.
  4. Run npm run i18n:check.`);
  }
  process.exit(status);
} else if (command === "check") {
  process.exit(vitest(["src/lib/i18n"]));
} else {
  console.error("Usage: node tools/i18n/run.mjs <new|check> [code]");
  process.exit(1);
}
