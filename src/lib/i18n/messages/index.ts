import type { Locale } from "@/lib/i18n/config";
import { bn } from "@/lib/i18n/messages/bn";
import { en } from "@/lib/i18n/messages/en";

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

/** Every key in the English source catalogue. */
export type MessageKey = keyof typeof en;

/** Base names of plural messages: `public.completedRounds` for `public.completedRounds_other`. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;

/**
 * A translation. Keys may be missing (they fall back to English) and may add plural categories
 * English lacks (`_few`, `_many`, …); the catalogue test rejects anything else.
 */
export type Catalogue = Partial<Record<MessageKey | `${PluralKey}_${PluralSuffix}`, string>>;

export const catalogues: Record<Locale, Catalogue> = { en, bn };
