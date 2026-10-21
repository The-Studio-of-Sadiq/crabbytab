import type { Catalogue } from "@/lib/i18n/messages";

/** Bengali messages for the setup area, part "wizard". MACHINE-DRAFTED: not yet reviewed by a fluent speaker. */
export const wizardBn: Catalogue = {
  // Page
  "setup.wizard.title": "টুর্নামেন্ট তৈরি করুন",
  "setup.wizard.intro": "কয়েকটি প্রশ্নের উত্তর দিন, CrabbyTab আপনার জন্য রাউন্ড ও ব্রেক বিভাগ তৈরি করে দেবে।",
  "setup.wizard.checkingAccess": "প্রশাসকের অনুমতি যাচাই করা হচ্ছে…",
  "setup.wizard.adminOnlyTitle": "কেবল একজন গ্লোবাল প্রশাসক টুর্নামেন্ট তৈরি করতে পারেন।",
  "setup.wizard.adminOnlyBody": "কোনো বিদ্যমান টুর্নামেন্টে আপনাকে যুক্ত করতে একজন প্রশাসককে অনুরোধ করুন।",
  "setup.wizard.errAdminOnly": "কেবল একজন গ্লোবাল প্রশাসক টুর্নামেন্ট তৈরি করতে পারেন।",

  // Step indicator
  "setup.wizard.stepsLabel": "সেটআপের ধাপসমূহ",
  "setup.wizard.stepCompleted": "(সম্পন্ন)",
  "setup.wizard.stepProgress": "{total} ধাপের মধ্যে ধাপ {current}",
  "setup.wizard.stepBasics": "মৌলিক তথ্য",
  "setup.wizard.stepFormat": "ফরম্যাট",
  "setup.wizard.stepScoring": "স্কোরিং",
  "setup.wizard.stepRounds": "রাউন্ড",
  "setup.wizard.stepBreaks": "ব্রেক",
  "setup.wizard.stepPublic": "প্রকাশ্য তথ্য ও ফিডব্যাক",
  "setup.wizard.stepReview": "পর্যালোচনা",

  // Basics
  "setup.wizard.nameLabel": "টুর্নামেন্টের নাম",
  "setup.wizard.namePlaceholder": "যেমন Australasian Debating Championship 2026",
  "setup.wizard.shortNameLabel": "সংক্ষিপ্ত নাম",
  "setup.wizard.shortNameHelp": "জায়গা কম থাকলে দেখানো হয়। সর্বোচ্চ 15 অক্ষর। ঐচ্ছিক।",
  "setup.wizard.shortNamePlaceholder": "যেমন Australs 26",
  "setup.wizard.slugLabel": "URL স্লাগ",
  "setup.wizard.slugHelp": "অংশগ্রহণকারীরা ড্র ও ফলাফল দেখতে এই ঠিকানায় যাবেন। পরে এটি বদলানো যাবে না।",
  "setup.wizard.slugPlaceholder": "australs2026",

  // Format
  "setup.wizard.formatIntro": "বিতর্কের ফরম্যাট বেছে নিন। এটি পরবর্তী ধাপগুলোর জন্য উপযুক্ত ডিফল্ট মান নির্ধারণ করে, যা আপনি পরেও বদলাতে পারবেন।",
  "setup.wizard.formatLegend": "বিতর্কের ফরম্যাট",
  "setup.wizard.formatBp": "ব্রিটিশ পার্লামেন্টারি (BP)",
  "setup.wizard.formatBpBlurb": "প্রতি কক্ষে 4টি দল, প্রতি দলে 2 জন বক্তা, কোনো রিপ্লাই বক্তৃতা নেই।",
  "setup.wizard.formatUadc": "এশিয়ান পার্লামেন্টারি (UADC)",
  "setup.wizard.formatUadcBlurb": "প্রতি কক্ষে 2টি দল, 3 জন বক্তা এবং একটি রিপ্লাই বক্তৃতা।",
  "setup.wizard.formatAustrals": "Australs",
  "setup.wizard.formatAustralsBlurb": "প্রতি কক্ষে 2টি দল, 3 জন বক্তা এবং একটি রিপ্লাই বক্তৃতা।",
  "setup.wizard.formatWsdc": "ওয়ার্ল্ড স্কুলস (WSDC)",
  "setup.wizard.formatWsdcBlurb": "প্রতি কক্ষে 2টি দল, 3 জন বক্তা এবং একটি রিপ্লাই বক্তৃতা।",
  "setup.wizard.formatCustom2Team": "কাস্টম দুই-দলের ফরম্যাট",
  "setup.wizard.formatCustom2TeamBlurb": "প্রতি কক্ষে 2টি দল। বক্তার সংখ্যা ও স্কোরিং নিজে নির্ধারণ করুন।",
  "setup.wizard.rulesPresetLabel": "Tabbycat নিয়মের প্রিসেট (ঐচ্ছিক)",
  "setup.wizard.rulesPresetHelp":
    "Tabbycat-এর প্রিসেট যে সেটিংস নির্ধারণ করে সেগুলো প্রয়োগ করে: বক্তা, স্কোরের পরিসর, ব্যালট মোড, মোশন ভেটো, ড্র-এর নিয়ম এবং স্ট্যান্ডিংসের অগ্রাধিকার।",
  "setup.wizard.rulesPresetNone": "কোনোটি নয় (ফরম্যাটের ডিফল্ট)",
  "setup.wizard.rulesPresetUnsupported": "CrabbyTab-এ উপলভ্য নয়: {items}।",

  // Scoring
  "setup.wizard.speakersLabel": "প্রতি দলে মূল বক্তার সংখ্যা",
  "setup.wizard.minSpeakerScore": "বক্তার সর্বনিম্ন স্কোর",
  "setup.wizard.maxSpeakerScore": "বক্তার সর্বোচ্চ স্কোর",
  "setup.wizard.scoreStep": "স্কোরের ধাপ",
  "setup.wizard.scoreStepHelp": "যেমন 1 বা 0.5",
  "setup.wizard.replyScored": "রিপ্লাই বক্তৃতায় স্কোর দেওয়া হয়",
  "setup.wizard.replyScoredHelp": "এশিয়ান পার্লামেন্টারি, Australs এবং ওয়ার্ল্ড স্কুলস-এ ব্যবহৃত হয়।",
  "setup.wizard.minReplyScore": "রিপ্লাইয়ের সর্বনিম্ন স্কোর",
  "setup.wizard.maxReplyScore": "রিপ্লাইয়ের সর্বোচ্চ স্কোর",

  // Rounds
  "setup.wizard.prelimRoundsLabel": "প্রাথমিক রাউন্ডের সংখ্যা",
  "setup.wizard.drawMethodLabel": "ড্র-এর পদ্ধতি",
  "setup.wizard.drawMethodHelp":
    "পাওয়ার পেয়ারিংয়ে রাউন্ড 1 এলোমেলো হয় (তখনও কোনো স্ট্যান্ডিংস নেই) এবং পরের রাউন্ডগুলোতে দলগুলোকে স্ট্যান্ডিং অনুযায়ী জোড়া করা হয়।",
  "setup.wizard.drawPowerPaired": "পাওয়ার-পেয়ার্ড (সুইস)",
  "setup.wizard.drawRandom": "এলোমেলো",
  "setup.wizard.drawRoundRobin": "রাউন্ড রবিন",
  "setup.wizard.sideAllocationLabel": "পক্ষ বণ্টন",
  "setup.wizard.sideBalancedOption": "ভারসাম্যপূর্ণ (পুরো টুর্নামেন্টে পক্ষ সমান রাখা)",
  "setup.wizard.sideRandomOption": "এলোমেলো",
  "setup.wizard.sideManualBallotOption": "ব্যালটে নির্বাচিত (ফলাফলের সাথে পক্ষ লেখা হয়)",
  "setup.wizard.sideBalanced": "ভারসাম্যপূর্ণ",
  "setup.wizard.sideRandom": "এলোমেলো",
  "setup.wizard.sidePreallocated": "আগে থেকে নির্ধারিত",
  "setup.wizard.sideManualBallot": "ব্যালটে নির্বাচিত",
  "setup.wizard.doubleEntryLabel": "ব্যালটের দ্বৈত এন্ট্রি আবশ্যক",
  "setup.wizard.doubleEntryHelp": "দুজন ব্যক্তি প্রতিটি ফলাফল এন্ট্রি করেন এবং নিশ্চিত হওয়ার আগে দুটি মিলতে হবে।",

  // Breaks
  "setup.wizard.breaksIntro":
    "ব্রেক বিভাগ ঠিক করে কারা এলিমিনেশন রাউন্ডে যাবে। সবচেয়ে বড় ব্রেক আকার থেকে এলিমিনেশন রাউন্ড স্বয়ংক্রিয়ভাবে তৈরি হয়।",
  "setup.wizard.breakCategoryLegend": "ব্রেক বিভাগ {number}",
  "setup.wizard.breakNameLabel": "নাম",
  "setup.wizard.breakNamePlaceholder": "যেমন Open, ESL, Novice",
  "setup.wizard.breakSizeLabel": "যতগুলো দল ব্রেক করবে",
  "setup.wizard.reserveSizeLabel": "রিজার্ভের সংখ্যা",
  "setup.wizard.generalBreakLabel": "সাধারণ (ওপেন) ব্রেক",
  "setup.wizard.removeBreak": "ব্রেক বিভাগ {number} সরান",
  "setup.wizard.noBreaks": "কোনো ব্রেক বিভাগ নেই। টুর্নামেন্টে কেবল প্রাথমিক রাউন্ড থাকবে।",
  "setup.wizard.addBreak": "ব্রেক বিভাগ যোগ করুন",

  // Public & feedback
  "setup.wizard.publicHeading": "সাধারণ দর্শকেরা কী দেখতে পাবেন",
  "setup.wizard.publicDraw": "ড্র",
  "setup.wizard.publicMotions": "মোশন",
  "setup.wizard.publicResults": "ফলাফল",
  "setup.wizard.publicStandings": "স্ট্যান্ডিংস",
  "setup.wizard.feedbackHeading": "বিচারকের ফিডব্যাক",
  "setup.wizard.feedbackEnabled": "বিচারকদের সম্পর্কে ফিডব্যাক সংগ্রহ করুন",
  "setup.wizard.feedbackMinScore": "ফিডব্যাকের সর্বনিম্ন স্কোর",
  "setup.wizard.feedbackMaxScore": "ফিডব্যাকের সর্বোচ্চ স্কোর",

  // Review
  "setup.wizard.reviewName": "নাম",
  "setup.wizard.reviewAddress": "ঠিকানা",
  "setup.wizard.reviewFormat": "ফরম্যাট",
  "setup.wizard.reviewSpeakers": "বক্তা",
  "setup.wizard.reviewDraw": "ড্র",
  "setup.wizard.reviewBreaks": "ব্রেক",
  "setup.wizard.speakersSummary": "প্রতি দলে {count} জন, স্কোর {min} থেকে {max}, ধাপ {step}",
  "setup.wizard.speakersSummaryReply":
    "প্রতি দলে {count} জন + রিপ্লাই, স্কোর {min} থেকে {max}, ধাপ {step} (রিপ্লাই {replyMin} থেকে {replyMax})",
  "setup.wizard.drawSummary": "{draw}; পক্ষ: {sides}",
  "setup.wizard.breakSummaryItem": "{name} ({size})",
  "setup.wizard.roundsHeading_one": "যে রাউন্ডগুলো তৈরি হবে ({count})",
  "setup.wizard.roundsHeading_other": "যে রাউন্ডগুলো তৈরি হবে ({count})",
  "setup.wizard.roundsPrelim": "প্রাথমিক",
  "setup.wizard.roundsElimination": "এলিমিনেশন",
  "setup.wizard.noEliminationRounds":
    "এই ফরম্যাটের জন্য সবচেয়ে বড় ব্রেক আকারটি খুব ছোট, তাই কোনো এলিমিনেশন রাউন্ড তৈরি হবে না।",
  "setup.wizard.savedOnDevice": "এই টুর্নামেন্টটি এই ডিভাইসে সংরক্ষিত। আপনি চাইলে তবেই এটি Firestore-এ আপলোড করুন।",

  // Buttons
  "setup.wizard.create": "টুর্নামেন্ট তৈরি করুন",
  "setup.wizard.creating": "তৈরি করা হচ্ছে…",

  // Validation
  "setup.wizard.errName": "টুর্নামেন্টের একটি নাম দিন (অন্তত 3 অক্ষর)।",
  "setup.wizard.errSpeakers": "প্রতি দলে বক্তার সংখ্যা 1 থেকে 6-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে।",
  "setup.wizard.errStepPositive": "স্কোরের ধাপ 0-এর চেয়ে বড় হতে হবে।",
  "setup.wizard.errSpeakerRange": "বক্তার সর্বনিম্ন স্কোর সর্বোচ্চ স্কোরের চেয়ে কম হতে হবে।",
  "setup.wizard.errStepTooLarge": "স্কোরের ধাপ স্কোরের পরিসরের চেয়ে বড় হতে পারবে না।",
  "setup.wizard.errReplyRange": "রিপ্লাইয়ের সর্বনিম্ন স্কোর সর্বোচ্চ স্কোরের চেয়ে কম হতে হবে।",
  "setup.wizard.errPrelimRounds": "প্রাথমিক রাউন্ডের সংখ্যা 1 থেকে 20-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে।",
  "setup.wizard.errBreakNameMissing": "প্রতিটি ব্রেক বিভাগের একটি নাম প্রয়োজন।",
  "setup.wizard.errBreakNameDuplicate": "\"{name}\" নামে দুটি ব্রেক বিভাগ আছে।",
  "setup.wizard.errBreakSize": "\"{name}\": {problem}",
  "setup.wizard.errReserveSize": "\"{name}\"-এর রিজার্ভের সংখ্যা 0 বা তার বেশি হতে হবে।",
  "setup.wizard.errFeedbackRange": "ফিডব্যাকের সর্বনিম্ন স্কোর সর্বোচ্চ স্কোরের চেয়ে কম হতে হবে।",
  "setup.wizard.errSlugTaken": "\"{slug}\" এই ডিভাইসে আগে থেকেই আছে। অন্য একটি স্লাগ বেছে নিন।",
  "setup.wizard.errCreateFailed": "টুর্নামেন্ট তৈরি করা যায়নি। আবার চেষ্টা করুন।",

  // Standings precedence editor
  "setup.wizard.precedenceEmpty": "কোনো মেট্রিক নির্ধারিত নেই — ফরম্যাটের ডিফল্ট ব্যবহার করা হচ্ছে।",
  "setup.wizard.precedenceMoveUp": "{metric} উপরে সরান",
  "setup.wizard.precedenceMoveDown": "{metric} নিচে সরান",
  "setup.wizard.precedenceRemove": "{metric} সরান",
  "setup.wizard.precedenceAdd": "একটি মেট্রিক যোগ করুন…",
  "setup.wizard.precedenceAddLabel": "একটি মেট্রিক যোগ করুন",
  "setup.wizard.precedenceNotApplicable": "{metric} (এই ফরম্যাটে প্রযোজ্য নয়)",
  "setup.wizard.precedenceLimit": "সর্বোচ্চ {max}টি মেট্রিক। এখানকার প্রতিটি মেট্রিকে সমান দলগুলো একই র‍্যাঙ্ক পায়।",
};
