import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  FeedbackQuestion,
  Institution,
  Motion,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";

export interface DebateXmlArchiveInput {
  tournament: Tournament;
  rounds: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  motions: Motion[];
  breakCategories: BreakCategory[];
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback: FeedbackSubmission[];
  institutions: Institution[];
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attribute(name: string, value: unknown): string {
  return value === undefined || value === null || value === ""
    ? ""
    : ` ${name}="${escapeXml(value)}"`;
}

class XmlIds {
  private readonly used = new Set<string>();

  allocate(prefix: string, rawId: string): string {
    const safe = rawId.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[^A-Za-z_]+/, "");
    const base = `${prefix}_${safe || "item"}`;
    let candidate = base;
    let suffix = 2;
    while (this.used.has(candidate)) candidate = `${base}_${suffix++}`;
    this.used.add(candidate);
    return candidate;
  }
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

export function createDebateXmlArchive(input: DebateXmlArchiveInput): string {
  const ids = new XmlIds();
  const rounds = [...input.rounds].filter((round) => !round.cancelled).sort((a, b) => a.seq - b.seq);
  const teamMap = new Map(input.teams.map((team) => [team.id, team]));
  const adjudicatorMap = new Map(input.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const venueMap = new Map(input.venues.map((venue) => [venue.id, venue]));
  const motionMap = new Map(input.motions.map((motion) => [motion.id, motion]));
  const breakCategoryMap = new Map(input.breakCategories.map((category) => [category.id, category]));
  const teamIds = new Map(input.teams.map((team) => [team.id, ids.allocate("team", team.id)]));
  const adjudicatorIds = new Map(input.adjudicators.map((adj) => [adj.id, ids.allocate("adj", adj.id)]));
  const venueIds = new Map(input.venues.map((venue) => [venue.id, ids.allocate("venue", venue.id)]));
  const motionIds = new Map(input.motions.map((motion) => [motion.id, ids.allocate("motion", motion.id)]));
  const breakIds = new Map(input.breakCategories.map((category) => [category.id, ids.allocate("break", category.id)]));
  const roundIds = new Map(rounds.map((round) => [round.id, ids.allocate("round", round.id)]));
  const debateIds = new Map(input.debates.map((debate) => [debate.id, ids.allocate("debate", debate.id)]));
  const speakerEntries = input.teams.flatMap((team) => team.speakers.map((speaker) => ({ team, speaker })));
  const speakerIds = new Map<string, string>();
  for (const { team, speaker } of speakerEntries) {
    if (speakerIds.has(speaker.id)) throw new Error(`Speaker ID ${speaker.id} is duplicated; fix the participant record before exporting.`);
    speakerIds.set(speaker.id, ids.allocate("speaker", `${team.id}_${speaker.id}`));
  }

  const institutionNames = new Map<string, { id: string; name: string; code?: string }>();
  for (const institution of input.institutions) {
    institutionNames.set(institution.name.trim().toLowerCase(), {
      id: institution.id,
      name: institution.name,
      code: institution.code,
    });
  }
  const addInstitutionName = (id: string | undefined, name: string | undefined) => {
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase();
    if (!institutionNames.has(key)) institutionNames.set(key, { id: id || `name-${key}`, name: name.trim() });
  };
  input.teams.forEach((team) => addInstitutionName(team.institutionId, team.institutionName));
  input.adjudicators.forEach((adj) => addInstitutionName(adj.institutionId, adj.institutionName));
  const institutions = [...institutionNames.values()];
  const institutionIds = new Map<string, string>();
  const institutionIdByName = new Map<string, string>();
  for (const institution of institutions) {
    const xmlId = ids.allocate("institution", institution.id);
    institutionIds.set(institution.id, xmlId);
    institutionIdByName.set(institution.name.trim().toLowerCase(), xmlId);
  }
  const institutionRef = (id?: string, name?: string) =>
    (id ? institutionIds.get(id) : undefined) ??
    (name ? institutionIdByName.get(name.trim().toLowerCase()) : undefined);

  const divisionDefinitions = new Map<string, string>();
  for (const team of input.teams) {
    const divisionId = team.divisionId || team.divisionName;
    if (divisionId) divisionDefinitions.set(divisionId, team.divisionName || divisionId);
  }
  for (const round of rounds) {
    if (round.divisionId && !divisionDefinitions.has(round.divisionId)) {
      divisionDefinitions.set(round.divisionId, round.divisionId);
    }
  }
  if (divisionDefinitions.size > 5) {
    throw new Error("DebateXML supports at most five divisions; reduce the division count before exporting.");
  }
  const divisionIds = new Map([...divisionDefinitions.keys()].map((id) => [id, ids.allocate("division", id)]));

  const speakerCategoryNames = [...new Set(input.teams.flatMap((team) => [
    ...team.speakerCategories,
    ...team.speakers.flatMap((speaker) => speaker.categories || []),
  ]))];
  const speakerCategoryIds = new Map(speakerCategoryNames.map((name) => [name, ids.allocate("speaker_category", name)]));
  if (input.teams.length < 2) throw new Error("DebateXML requires at least two teams.");
  if (input.adjudicators.length < 1) throw new Error("DebateXML requires at least one adjudicator.");
  if (input.venues.length < 1) throw new Error("DebateXML requires at least one venue.");
  if (rounds.length < 1) throw new Error("DebateXML requires at least one active round.");
  if (input.breakCategories.length > 10) throw new Error("DebateXML supports at most ten break categories.");

  const preferences = input.tournament.preferences;
  const teamQuestions = preferences?.teamFeedbackQuestions ?? preferences?.feedbackQuestions ?? [];
  const adjudicatorQuestions = preferences?.adjudicatorFeedbackQuestions ?? preferences?.feedbackQuestions ?? [];
  const questionDefinitions = [
    ...teamQuestions.map((question) => ({ question, fromTeams: true, fromAdjudicators: false })),
    ...adjudicatorQuestions.map((question) => ({ question, fromTeams: false, fromAdjudicators: true })),
  ];
  const questionIdsBySource = new Map<"team" | "adjudicator", Map<string, string>>([
    ["team", new Map()],
    ["adjudicator", new Map()],
  ]);
  const questionXml = questionDefinitions.map(({ question, fromTeams, fromAdjudicators }, index) => {
    const typeMap = { text: "t", textarea: "tl", scale: "is", yes_no: "bs", select_one: "ss", select_many: "ms" } as const;
    const xmlQuestionId = ids.allocate("question", question.id || String(index + 1));
    questionIdsBySource.get(fromTeams ? "team" : "adjudicator")!.set(question.id, xmlQuestionId);
    const choices = (question.options || []).map((option) => `<choice>${escapeXml(option)}</choice>`).join("");
    return `<question id="${xmlQuestionId}" name="${escapeXml(question.label)}" type="${typeMap[question.type]}" from-teams="${fromTeams}" from-adjudicators="${fromAdjudicators}">${escapeXml(question.label)}${choices}</question>`;
  }).join("");

  const ballotsByDebate = groupBy(
    input.ballots.filter((ballot) => ballot.confirmed && !ballot.discarded),
    (ballot) => ballot.debateId
  );
  const debatesByRound = groupBy(input.debates, (debate) => debate.roundId);
  const exportedDebateIds = new Set<string>();
  const roundXml = rounds.map((round) => {
    const roundDebates = debatesByRound.get(round.id) ?? [];
    const debateXml: string[] = [];
    const byeXml: string[] = [];
    for (const debate of roundDebates) {
      if (debate.postponed) continue;
      if (debate.byeTeamId && teamIds.has(debate.byeTeamId)) {
        byeXml.push(`<bye>${teamIds.get(debate.byeTeamId)}</bye>`);
        continue;
      }
      const slots = Object.entries(debate.teams || {})
        .filter(([, slot]) => slot?.teamId && teamIds.has(slot.teamId));
      if (slots.length === 0) continue;
      if (slots.length < 2) {
        throw new Error(`Debate ${debate.id} has an incomplete assignment and cannot be archived.`);
      }
      const assignedAdjudicators = [
        debate.adjudicators.chairId,
        ...(debate.adjudicators.panellistIds || []),
        ...(debate.adjudicators.traineeIds || []),
      ].filter((id): id is string => Boolean(id && adjudicatorIds.has(id)));
      exportedDebateIds.add(debate.id);
      const chairId = debate.adjudicators.chairId
        ? adjudicatorIds.get(debate.adjudicators.chairId)
        : undefined;
      const venueId = debate.venueId ? venueIds.get(debate.venueId) : undefined;
      const motionId = debate.motionId ? motionIds.get(debate.motionId) : undefined;
      const debateBallots = ballotsByDebate.get(debate.id) ?? [];
      const sideXml = slots.map(([side, slot]) => {
        const team = teamMap.get(slot.teamId)!;
        const sideBallots = debateBallots.map((ballot) => {
          const score = ballot.teamScores?.[side as keyof typeof ballot.teamScores];
          const rank = score?.rank ?? (score?.win === true ? 1 : undefined);
          const judgeIds = ballot.chairId ? adjudicatorIds.get(ballot.chairId) : undefined;
          return `<ballot${attribute("rank", rank)}${attribute("adjudicators", judgeIds)}>${escapeXml(score?.points ?? "")}</ballot>`;
        });
        if (sideBallots.length === 0) sideBallots.push("<ballot/>");
        const speeches = team.speakers.flatMap((speaker) => {
          const xmlSpeakerId = speakerIds.get(speaker.id);
          if (!xmlSpeakerId) return [];
          const entries = debateBallots.flatMap((ballot) =>
            (ballot.speakerScores?.[side as keyof typeof ballot.speakerScores] || [])
              .filter((entry) => entry.speakerId === speaker.id)
              .map((entry) => ({ entry, ballot }))
          );
          if (entries.length === 0) return [];
          const replyPosition = input.tournament.preferences?.substantiveSpeakers ?? 2;
          return [`<speech speaker="${xmlSpeakerId}"${attribute("reply", entries.some(({ entry }) => entry.position > replyPosition) ? "true" : undefined)}>${entries.map(({ entry, ballot }) =>
            `<ballot${attribute("adjudicators", ballot.chairId ? adjudicatorIds.get(ballot.chairId) : undefined)}>${escapeXml(entry.score)}</ballot>`
          ).join("")}</speech>`];
        }).join("");
        return `<side team="${teamIds.get(team.id)}">${sideBallots.join("")}${speeches}</side>`;
      }).join("");
      debateXml.push(`<debate id="${debateIds.get(debate.id)}"${attribute("chair", chairId)}${attribute("venue", venueId)}${attribute("motion", motionId)}${attribute("adjudicators", assignedAdjudicators.map((id) => adjudicatorIds.get(id)).join(" "))}>${sideXml}</debate>`);
    }
    const categoryId = round.breakCategoryIds?.length === 1
      ? breakIds.get(round.breakCategoryIds[0])
      : undefined;
    const divisionId = round.divisionId ? divisionIds.get(round.divisionId) : undefined;
    return `<round${attribute("name", round.name)}${attribute("elimination", round.stage === "elimination" ? "true" : undefined)}${attribute("feedback-weight", round.feedbackWeight)}${attribute("break-category", categoryId)}${attribute("division", divisionId)}>${debateXml.join("")}${byeXml.join("")}</round>`;
  }).join("");

  const participantsXml = [
    ...input.teams.map((team) => {
      const breakEligibility = team.breakCategories
        .map((id) => breakIds.get(id))
        .filter((id): id is string => Boolean(id))
        .join(" ");
      const divisionKey = team.divisionId || team.divisionName;
      const divisionId = divisionKey ? divisionIds.get(divisionKey) : undefined;
      const speakers = team.speakers.map((speaker) => {
        const speakerCategoryRefs = (speaker.categories || [])
          .map((category) => speakerCategoryIds.get(category))
          .filter((id): id is string => Boolean(id))
          .join(" ");
        return `<speaker${attribute("id", speakerIds.get(speaker.id))}${attribute("name", speaker.name)}${attribute("institutions", institutionRef(team.institutionId, team.institutionName))}${attribute("categories", speakerCategoryRefs)}>${escapeXml(speaker.name)}</speaker>`;
      }).join("");
      return `<team${attribute("id", teamIds.get(team.id))}${attribute("code", team.codeName)}${attribute("name", team.name)}${attribute("break-eligibilities", breakEligibility)}${attribute("division", divisionId)}>${speakers}</team>`;
    }),
    ...input.adjudicators.map((adj) =>
      `<adjudicator${attribute("id", adjudicatorIds.get(adj.id))}${attribute("name", adj.name)}${attribute("institutions", institutionRef(adj.institutionId, adj.institutionName))}${attribute("score", adj.baseScore)}${attribute("independent", adj.independent ? "true" : undefined)}>${escapeXml(adj.name)}${input.feedback.filter((item) =>
        item.confirmed &&
        item.targetType === "adjudicator" &&
        item.targetAdjudicatorId === adj.id &&
        exportedDebateIds.has(item.debateId)
      ).map((item) => {
        const sourceId = item.sourceType === "team"
          ? teamIds.get(item.sourceId)
          : adjudicatorIds.get(item.sourceId);
        const questionIds = questionIdsBySource.get(item.sourceType)!;
        const answers = Object.entries(item.answers || {}).flatMap(([questionId, answer]) => {
          const xmlQuestionId = questionIds.get(questionId);
          return xmlQuestionId
            ? [`<answer question="${xmlQuestionId}">${escapeXml(Array.isArray(answer) ? answer.join(", ") : answer)}</answer>`]
            : [];
        }).join("");
        return `<feedback${attribute("source-team", item.sourceType === "team" ? sourceId : undefined)}${attribute("source-adjudicator", item.sourceType === "adjudicator" ? sourceId : undefined)}${attribute("debate", debateIds.get(item.debateId))}${attribute("score", item.score)}>${answers}</feedback>`;
      }).join("")}</adjudicator>`
    ),
  ].join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tournament${attribute("name", input.tournament.name)}${attribute("short", input.tournament.shortName)}${attribute("style", input.tournament.format === "custom_2team" ? undefined : input.tournament.format)}>\n${roundXml}\n<participants>${participantsXml}</participants>\n${institutions.map((institution) => `<institution${attribute("id", institutionIds.get(institution.id))}${attribute("reference", institution.code)}>${escapeXml(institution.name)}</institution>`).join("")}\n${input.motions.map((motion) => `<motion id="${motionIds.get(motion.id)}"${attribute("reference", motion.reference)}>${escapeXml(motion.text)}${motion.infoSlide ? `<info-slide>${escapeXml(motion.infoSlide)}</info-slide>` : ""}</motion>`).join("")}\n${input.venues.map((venue) => `<venue id="${venueIds.get(venue.id)}"${attribute("priority", venue.priority)}>${escapeXml(venue.name)}</venue>`).join("")}\n${questionXml}\n${input.breakCategories.map((category) => `<break-category${attribute("id", breakIds.get(category.id))}${attribute("priority", category.priority)}>${escapeXml(category.name)}</break-category>`).join("")}\n${speakerCategoryNames.map((name) => `<speaker-category id="${speakerCategoryIds.get(name)}">${escapeXml(name)}</speaker-category>`).join("")}\n${[...divisionDefinitions].map(([id, name]) => `<division id="${divisionIds.get(id)}">${escapeXml(name)}</division>`).join("")}\n</tournament>`;

  return xml;
}
