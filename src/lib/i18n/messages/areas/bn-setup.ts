import type { Catalogue } from "@/lib/i18n/messages";
import { commonBn } from "@/lib/i18n/messages/areas/setup/common.bn";
import { shellBn } from "@/lib/i18n/messages/areas/setup/shell.bn";
import { entryBn } from "@/lib/i18n/messages/areas/setup/entry.bn";
import { wizardBn } from "@/lib/i18n/messages/areas/setup/wizard.bn";
import { configBn } from "@/lib/i18n/messages/areas/setup/config.bn";
import { importsBn } from "@/lib/i18n/messages/areas/setup/imports.bn";
import { importsExtraBn } from "@/lib/i18n/messages/areas/setup/importsExtra.bn";
import { staffBn } from "@/lib/i18n/messages/areas/setup/staff.bn";
import { emailBn } from "@/lib/i18n/messages/areas/setup/email.bn";
import { registrationBn } from "@/lib/i18n/messages/areas/setup/registration.bn";

/** Bengali messages for the setup area (machine-drafted; see ../bn.ts). Missing keys fall back to English. */
export const bnSetup: Catalogue = {
  ...commonBn,
  ...shellBn,
  ...entryBn,
  ...wizardBn,
  ...configBn,
  ...importsBn,
  ...importsExtraBn,
  ...staffBn,
  ...emailBn,
  ...registrationBn,
};
