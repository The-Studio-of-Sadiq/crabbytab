import type { Catalogue } from "@/lib/i18n/messages";

/** Bengali messages for the tabroom area, part "common" (machine-drafted; see ../bn-tabroom.ts). */
export const commonBn: Catalogue = {
  "tabroom.common.noCancel": "না, বাতিল করুন",
  "tabroom.common.saving": "সংরক্ষণ করা হচ্ছে…",
  "tabroom.common.closeDialog": "ডায়ালগ বন্ধ করুন",
  "tabroom.common.cancelEsc": "বাতিল (Esc)",
  "tabroom.common.moveCancelled": "সরানো বাতিল হয়েছে।",
  "tabroom.common.nothingChanged": "কিছুই পরিবর্তন হয়নি।",

  "tabroom.common.roundsInSlot": "সময়সূচির স্লট {slot}-এর রাউন্ডগুলো",
  "tabroom.common.runningSameTime": "একই সময়ে চলছে:",
  "tabroom.common.noDraw": "ড্র নেই",
  "tabroom.common.resultsProgress": "{done}/{count}টি ফলাফল",
  "tabroom.common.debateCount_one": "{count}টি বিতর্ক",
  "tabroom.common.debateCount_other": "{count}টি বিতর্ক",
  "tabroom.common.sharesParticipants": "(অন্য একটি রাউন্ডের সাথে অংশগ্রহণকারী ভাগ করে)",
  "tabroom.common.clash": "সংঘাত",
  "tabroom.common.clashSummary_one": "{round} {rounds}-এর সাথে একই সময়ে চলে, কিন্তু এর সাথে {items} ভাগ করে।",
  "tabroom.common.clashSummary_other": "{round} {rounds}-এর সাথে একই সময়ে চলে, কিন্তু সেগুলোর সাথে {items} ভাগ করে।",
  "tabroom.common.clashTeams_one": "{count}টি দল ({names})",
  "tabroom.common.clashTeams_other": "{count}টি দল ({names})",
  "tabroom.common.clashAdjudicators_one": "{count} জন বিচারক ({names})",
  "tabroom.common.clashAdjudicators_other": "{count} জন বিচারক ({names})",
  "tabroom.common.clashVenues_one": "{count}টি ভেন্যু ({names})",
  "tabroom.common.clashVenues_other": "{count}টি ভেন্যু ({names})",
  "tabroom.common.clashItem": "{round}-এ {name}",
  "tabroom.common.andMore": "{list}, …",

  "tabroom.common.computeDraw": "ড্র তৈরি করা হচ্ছে… {seconds} সে.",
  "tabroom.common.computeAllocation": "বিচারক বরাদ্দ করা হচ্ছে… {seconds} সে.",
};
