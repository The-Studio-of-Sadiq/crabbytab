/** English messages for the setup area, part "wizard" (see ../en-setup.ts). */
export const wizardEn = {
  // Page
  "setup.wizard.title": "Create a tournament",
  "setup.wizard.intro": "Answer a few questions and CrabbyTab will set up the rounds and break categories for you.",
  "setup.wizard.checkingAccess": "Checking administrator access…",
  "setup.wizard.adminOnlyTitle": "Only a global administrator can create a tournament.",
  "setup.wizard.adminOnlyBody": "Ask an administrator to assign you to an existing tournament.",
  "setup.wizard.errAdminOnly": "Only a global administrator can create a tournament.",

  // Step indicator
  "setup.wizard.stepsLabel": "Setup steps",
  "setup.wizard.stepCompleted": "(completed)",
  "setup.wizard.stepProgress": "Step {current} of {total}",
  "setup.wizard.stepBasics": "Basics",
  "setup.wizard.stepFormat": "Format",
  "setup.wizard.stepScoring": "Scoring",
  "setup.wizard.stepRounds": "Rounds",
  "setup.wizard.stepBreaks": "Breaks",
  "setup.wizard.stepPublic": "Public & feedback",
  "setup.wizard.stepReview": "Review",

  // Basics
  "setup.wizard.nameLabel": "Tournament name",
  "setup.wizard.namePlaceholder": "e.g. Australasian Debating Championship 2026",
  "setup.wizard.shortNameLabel": "Short name",
  "setup.wizard.shortNameHelp": "Shown in tight spaces. Up to 15 characters. Optional.",
  "setup.wizard.shortNamePlaceholder": "e.g. Australs 26",
  "setup.wizard.slugLabel": "URL slug",
  "setup.wizard.slugHelp": "Participants will visit this address to see the draw and results. It can't be changed later.",
  "setup.wizard.slugPlaceholder": "australs2026",

  // Format
  "setup.wizard.formatIntro": "Pick the debating format. This sets sensible defaults for the next steps, which you can still change.",
  "setup.wizard.formatLegend": "Debating format",
  "setup.wizard.formatBp": "British Parliamentary (BP)",
  "setup.wizard.formatBpBlurb": "4 teams per room, 2 speakers per team, no reply speeches.",
  "setup.wizard.formatUadc": "Asian Parliamentary (UADC)",
  "setup.wizard.formatUadcBlurb": "2 teams per room, 3 speakers plus a reply speech.",
  "setup.wizard.formatAustrals": "Australs",
  "setup.wizard.formatAustralsBlurb": "2 teams per room, 3 speakers plus a reply speech.",
  "setup.wizard.formatWsdc": "World Schools (WSDC)",
  "setup.wizard.formatWsdcBlurb": "2 teams per room, 3 speakers plus a reply speech.",
  "setup.wizard.formatCustom2Team": "Custom two-team format",
  "setup.wizard.formatCustom2TeamBlurb": "2 teams per room. Set the speaker count and scoring yourself.",
  "setup.wizard.rulesPresetLabel": "Tabbycat rules preset (optional)",
  "setup.wizard.rulesPresetHelp":
    "Applies the settings Tabbycat's preset sets: speakers, score scale, ballot mode, motion vetoes, draw rules and standings precedence.",
  "setup.wizard.rulesPresetNone": "None (format defaults)",
  "setup.wizard.rulesPresetUnsupported": "Not available in CrabbyTab: {items}.",

  // Scoring
  "setup.wizard.speakersLabel": "Substantive speakers per team",
  "setup.wizard.minSpeakerScore": "Minimum speaker score",
  "setup.wizard.maxSpeakerScore": "Maximum speaker score",
  "setup.wizard.scoreStep": "Score step",
  "setup.wizard.scoreStepHelp": "e.g. 1 or 0.5",
  "setup.wizard.replyScored": "Reply speeches are scored",
  "setup.wizard.replyScoredHelp": "Used by Asian Parliamentary, Australs and World Schools.",
  "setup.wizard.minReplyScore": "Minimum reply score",
  "setup.wizard.maxReplyScore": "Maximum reply score",

  // Rounds
  "setup.wizard.prelimRoundsLabel": "Number of preliminary rounds",
  "setup.wizard.drawMethodLabel": "Draw method",
  "setup.wizard.drawMethodHelp":
    "With power pairing, Round 1 is random (there are no standings yet) and later rounds pair teams by standing.",
  "setup.wizard.drawPowerPaired": "Power-paired (Swiss)",
  "setup.wizard.drawRandom": "Random",
  "setup.wizard.drawRoundRobin": "Round robin",
  "setup.wizard.sideAllocationLabel": "Side allocation",
  "setup.wizard.sideBalancedOption": "Balanced (equalise sides over the tournament)",
  "setup.wizard.sideRandomOption": "Random",
  "setup.wizard.sideManualBallotOption": "Chosen on the ballot (sides recorded with the result)",
  "setup.wizard.sideBalanced": "Balanced",
  "setup.wizard.sideRandom": "Random",
  "setup.wizard.sidePreallocated": "Preallocated",
  "setup.wizard.sideManualBallot": "Chosen on the ballot",
  "setup.wizard.doubleEntryLabel": "Require double entry of ballots",
  "setup.wizard.doubleEntryHelp": "Two people enter each result and they must match before it is confirmed.",

  // Breaks
  "setup.wizard.breaksIntro":
    "Break categories decide who advances to elimination rounds. Elimination rounds are created automatically from the largest break size.",
  "setup.wizard.breakCategoryLegend": "Break category {number}",
  "setup.wizard.breakNameLabel": "Name",
  "setup.wizard.breakNamePlaceholder": "e.g. Open, ESL, Novice",
  "setup.wizard.breakSizeLabel": "Teams that break",
  "setup.wizard.reserveSizeLabel": "Reserve size",
  "setup.wizard.generalBreakLabel": "General (open) break",
  "setup.wizard.removeBreak": "Remove break category {number}",
  "setup.wizard.noBreaks": "No break categories. The tournament will have preliminary rounds only.",
  "setup.wizard.addBreak": "Add break category",

  // Public & feedback
  "setup.wizard.publicHeading": "What the public can see",
  "setup.wizard.publicDraw": "Draw",
  "setup.wizard.publicMotions": "Motions",
  "setup.wizard.publicResults": "Results",
  "setup.wizard.publicStandings": "Standings",
  "setup.wizard.feedbackHeading": "Adjudicator feedback",
  "setup.wizard.feedbackEnabled": "Collect feedback on adjudicators",
  "setup.wizard.feedbackMinScore": "Minimum feedback score",
  "setup.wizard.feedbackMaxScore": "Maximum feedback score",

  // Review
  "setup.wizard.reviewName": "Name",
  "setup.wizard.reviewAddress": "Address",
  "setup.wizard.reviewFormat": "Format",
  "setup.wizard.reviewSpeakers": "Speakers",
  "setup.wizard.reviewDraw": "Draw",
  "setup.wizard.reviewBreaks": "Breaks",
  "setup.wizard.speakersSummary": "{count} per team, scored {min} to {max} in steps of {step}",
  "setup.wizard.speakersSummaryReply":
    "{count} per team + reply, scored {min} to {max} in steps of {step} (reply {replyMin} to {replyMax})",
  "setup.wizard.drawSummary": "{draw}; sides: {sides}",
  "setup.wizard.breakSummaryItem": "{name} ({size})",
  "setup.wizard.roundsHeading_one": "Rounds that will be created ({count})",
  "setup.wizard.roundsHeading_other": "Rounds that will be created ({count})",
  "setup.wizard.roundsPrelim": "Preliminary",
  "setup.wizard.roundsElimination": "Elimination",
  "setup.wizard.noEliminationRounds":
    "The largest break size is too small for this format, so no elimination rounds will be created.",
  "setup.wizard.savedOnDevice": "This tournament is saved on this device. Upload it to Firestore only when you choose to.",

  // Buttons
  "setup.wizard.create": "Create tournament",
  "setup.wizard.creating": "Creating…",

  // Validation (shown in the step's error alert)
  "setup.wizard.errName": "Give the tournament a name (at least 3 characters).",
  "setup.wizard.errSpeakers": "Speakers per team must be a whole number from 1 to 6.",
  "setup.wizard.errStepPositive": "The score step must be greater than 0.",
  "setup.wizard.errSpeakerRange": "The minimum speaker score must be lower than the maximum.",
  "setup.wizard.errStepTooLarge": "The score step can't be larger than the score range.",
  "setup.wizard.errReplyRange": "The minimum reply score must be lower than the maximum.",
  "setup.wizard.errPrelimRounds": "Preliminary rounds must be a whole number from 1 to 20.",
  "setup.wizard.errBreakNameMissing": "Every break category needs a name.",
  "setup.wizard.errBreakNameDuplicate": "There are two break categories called \"{name}\".",
  "setup.wizard.errBreakSize": "\"{name}\": {problem}",
  "setup.wizard.errReserveSize": "Reserve size for \"{name}\" must be 0 or more.",
  "setup.wizard.errFeedbackRange": "The minimum feedback score must be lower than the maximum.",
  "setup.wizard.errSlugTaken": "\"{slug}\" already exists on this device. Choose a different slug.",
  "setup.wizard.errCreateFailed": "Failed to create the tournament. Please try again.",

  // Standings precedence editor (also used on the configuration page)
  "setup.wizard.precedenceEmpty": "No metrics set — using the format default.",
  "setup.wizard.precedenceMoveUp": "Move {metric} up",
  "setup.wizard.precedenceMoveDown": "Move {metric} down",
  "setup.wizard.precedenceRemove": "Remove {metric}",
  "setup.wizard.precedenceAdd": "Add a metric…",
  "setup.wizard.precedenceAddLabel": "Add a metric",
  "setup.wizard.precedenceNotApplicable": "{metric} (not applicable to this format)",
  "setup.wizard.precedenceLimit": "Up to {max} metrics. Teams tied on every metric here share a rank.",
} as const;
