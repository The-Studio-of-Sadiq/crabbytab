/**
 * A starting catalogue for a new language: every English key with its English text, plus the
 * plural forms the language needs (from Intl.PluralRules; English only defines `_one`/`_other`).
 * Extra categories start from the English `_other` text. Translators replace the values; keep
 * `{placeholders}` and `<tag>` markup exactly as in English.
 */
export function buildLanguageTemplate(code: string, english: Record<string, string>): Record<string, string> {
  const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  const template: Record<string, string> = {};
  for (const [key, message] of Object.entries(english)) {
    template[key] = message;
    const base = key.endsWith("_other") ? key.slice(0, -"_other".length) : null;
    if (!base) continue;
    for (const category of categories) {
      const pluralKey = `${base}_${category}`;
      if (!(pluralKey in english)) template[pluralKey] = message;
    }
  }
  return template;
}
