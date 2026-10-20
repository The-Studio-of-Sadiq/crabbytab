/**
 * English messages for the tabroom area: draw, allocation, preformed panels, check-ins, venues, print pages.
 * Each page area owns one file so parallel work never edits the same catalogue. Keys follow the
 * conventions in ../en.ts (`area.subject`, `{placeholder}`, `_one`/`_other` plurals).
 *
 * The tabroom area is split again into parts (./tabroom/*.en.ts), one per group of pages:
 * `common` (shared words and components), `draw`, `allocation` (incl. preformed panels and
 * shards) `ops` (check-ins, print pages) and `schedule` (schedule, round motions and motion release). Keys are `tabroom.<part>.<subject>`.
 */
import { commonEn } from "@/lib/i18n/messages/areas/tabroom/common.en";
import { drawEn } from "@/lib/i18n/messages/areas/tabroom/draw.en";
import { allocationEn } from "@/lib/i18n/messages/areas/tabroom/allocation.en";
import { opsEn } from "@/lib/i18n/messages/areas/tabroom/ops.en";
import { scheduleEn } from "@/lib/i18n/messages/areas/tabroom/schedule.en";

export const enTabroom = {
  ...commonEn,
  ...drawEn,
  ...allocationEn,
  ...opsEn,
  ...scheduleEn,
} as const;
