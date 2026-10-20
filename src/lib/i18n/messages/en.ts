/**
 * English source catalogue. Every key used by the UI is defined here; other catalogues translate
 * these keys and fall back to English for any key they lack.
 *
 * Conventions (docs/internationalization.md):
 * - Keys are `area.subject`; reuse `common.*` only for words that mean the same everywhere.
 * - `{name}` is a placeholder. Plurals are `key_one` / `key_other` (+ other CLDR categories).
 * - `<b>…</b>` / `<n>…</n>` mark spans the component styles (bold text, numbers).
 */

import { enPublic } from "@/lib/i18n/messages/areas/en-public";
import { enResults } from "@/lib/i18n/messages/areas/en-results";
import { enSetup } from "@/lib/i18n/messages/areas/en-setup";
import { enTabroom } from "@/lib/i18n/messages/areas/en-tabroom";

export const en = {
  // Per-area catalogues (areas/en-*.ts), so parallel work on different page areas never conflicts.
  ...enSetup,
  ...enTabroom,
  ...enResults,
  ...enPublic,
  "common.tournament": "Tournament",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.tba": "TBA",
  "common.tbd": "TBD",
  "common.sidesTbc": "Sides chosen at the debate",
  "common.independent": "Independent",

  "language.label": "Language",
  "language.trigger": "Language: {language}",
  "language.automatic": "Automatic",
  "language.automaticHelp": "Uses the tournament or browser language",
  "language.machineDrafted": "Machine-drafted translation",

  "format.bp": "British Parliamentary",
  "format.uadc": "UADC",
  "format.australs": "Australs",
  "format.wsdc": "WSDC",
  "format.custom_2team": "Custom 2-Team",

  "side.OG": "Opening Gov",
  "side.OO": "Opening Opp",
  "side.CG": "Closing Gov",
  "side.CO": "Closing Opp",
  "side.AFF": "Affirmative",
  "side.NEG": "Negative",

  "role.chair": "Chair",
  "role.panellist": "Panellist",
  "role.trainee": "Trainee",
  "role.judge": "Judge",

  "metric.team.wins": "Wins",
  "metric.team.points": "Points",
  "metric.team.speaks_sum": "Total speaks",
  "metric.team.speaks_avg": "Avg total speaks",
  "metric.team.speaks_ind_avg": "Avg individual speaks",
  "metric.team.speaks_stddev": "Speaks std. dev.",
  "metric.team.margin_sum": "Total margin",
  "metric.team.margin_avg": "Avg margin",
  "metric.team.draw_strength_wins": "Draw strength (wins)",
  "metric.team.draw_strength": "Draw strength",
  "metric.team.draw_strength_speaks": "Draw strength (speaks)",
  "metric.team.draw_strength_rank": "Draw strength (rank)",
  "metric.team.firsts": "1sts",
  "metric.team.seconds": "2nds",
  "metric.team.thirds": "3rds",
  "metric.team.pullups": "Pull-ups",
  "metric.team.pullup_debates": "Pull-up debates",
  "metric.team.num_adjs": "Ballots carried",
  "metric.team.num_iron": "Iron-person speeches",
  "metric.speaker.speaks_sum": "Total",
  "metric.speaker.speaks_avg": "Average",
  "metric.speaker.speaks_stddev": "Std. dev.",
  "metric.speaker.speaks_trimmed_mean": "Trimmed mean",
  "metric.speaker.speeches_count": "Speeches",
  "metric.speaker.reply_sum": "Reply total",
  "metric.speaker.reply_avg": "Reply average",
  "metric.speaker.reply_stddev": "Reply std. dev.",
  "metric.speaker.reply_count": "Replies",
  "metric.speaker.team_points": "Team points",
  "metric.speaker.team_wins": "Team wins",
  "metric.speaker.firsts": "1sts",
  "metric.speaker.seconds": "2nds",
  "metric.speaker.thirds": "3rds",
  "metric.speaker.num_adjs": "Ballots carried",

  "feedbackQuestions.legend": "Tournament questions",
  "feedbackQuestions.choose": "Choose…",
  "feedbackQuestions.yes": "Yes",
  "feedbackQuestions.no": "No",

  "invite.title": "Tournament staff invitation",
  "invite.loading": "Checking your invitation…",
  "invite.missingLink": "This page needs the full link from your invitation email.",
  "invite.loadFailed": "Could not check this invitation.",
  "invite.failed": "Could not complete that request. Try again.",
  "invite.invalidTitle": "Invitation unavailable",
  "invite.summary": "You are invited as {role} ({email}).",
  "invite.roleAdmin": "a tournament administrator",
  "invite.roleDataEntry": "data-entry staff",
  "invite.expires": "This invitation expires {time}.",
  "invite.state.accepted": "This invitation has already been used",
  "invite.state.revoked": "This invitation was withdrawn",
  "invite.state.expired": "This invitation has expired",
  "invite.askForNew": "Ask a tournament administrator to send you a new invitation.",
  "invite.accept": "Accept invitation",
  "invite.wrongAccount": "You are signed in as {current}, but this invitation is for {expected}. Sign out and sign in with the invited address.",
  "invite.signOut": "Sign out",
  "invite.signInIntro": "An account already exists for this address. Sign in to accept.",
  "invite.email": "Email",
  "invite.password": "Password",
  "invite.signInAccept": "Sign in and accept",
  "invite.forgotPassword": "Forgot password?",
  "invite.createIntro": "Create your CrabbyTab account for this address to accept.",
  "invite.name": "Your name",
  "invite.newPassword": "Choose a password",
  "invite.passwordHelp": "At least 8 characters.",
  "invite.confirmPassword": "Confirm password",
  "invite.passwordMismatch": "The passwords do not match.",
  "invite.createAccept": "Create account and accept",
  "invite.acceptedTitle": "Invitation accepted",
  "invite.acceptedBody": "Your account now has access to this tournament.",
  "invite.openTournament": "Open the tournament",
} as const;
