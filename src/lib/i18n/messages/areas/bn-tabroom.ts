import type { Catalogue } from "@/lib/i18n/messages";
import { commonBn } from "@/lib/i18n/messages/areas/tabroom/common.bn";
import { drawBn } from "@/lib/i18n/messages/areas/tabroom/draw.bn";
import { allocationBn } from "@/lib/i18n/messages/areas/tabroom/allocation.bn";
import { opsBn } from "@/lib/i18n/messages/areas/tabroom/ops.bn";

/** Bengali messages for the tabroom area (machine-drafted; see ../bn.ts). Missing keys fall back to English. */
export const bnTabroom: Catalogue = {
  ...commonBn,
  ...drawBn,
  ...allocationBn,
  ...opsBn,
};
