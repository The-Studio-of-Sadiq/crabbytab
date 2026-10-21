/**
 * English messages for the setup area: tournament setup, configuration, imports, staff, API, email, registration admin, private URLs, audit, tournaments list, login.
 * Each page area owns one file so parallel work never edits the same catalogue. Keys follow the
 * conventions in ../en.ts (`area.subject`, `{placeholder}`, `_one`/`_other` plurals).
 *
 * The setup area is split again into parts (./setup/*.en.ts), one per group of pages, so its
 * pages can also be worked on in parallel. Keys are `setup.<part>.<subject>`.
 */
import { commonEn } from "@/lib/i18n/messages/areas/setup/common.en";
import { shellEn } from "@/lib/i18n/messages/areas/setup/shell.en";
import { entryEn } from "@/lib/i18n/messages/areas/setup/entry.en";
import { wizardEn } from "@/lib/i18n/messages/areas/setup/wizard.en";
import { configEn } from "@/lib/i18n/messages/areas/setup/config.en";
import { importsEn } from "@/lib/i18n/messages/areas/setup/imports.en";
import { importsExtraEn } from "@/lib/i18n/messages/areas/setup/importsExtra.en";
import { staffEn } from "@/lib/i18n/messages/areas/setup/staff.en";
import { emailEn } from "@/lib/i18n/messages/areas/setup/email.en";
import { registrationEn } from "@/lib/i18n/messages/areas/setup/registration.en";
import { dataEn } from "@/lib/i18n/messages/areas/setup/data.en";

export const enSetup = {
  ...commonEn,
  ...shellEn,
  ...entryEn,
  ...wizardEn,
  ...configEn,
  ...importsEn,
  ...importsExtraEn,
  ...staffEn,
  ...emailEn,
  ...registrationEn,
  ...dataEn,
} as const;
