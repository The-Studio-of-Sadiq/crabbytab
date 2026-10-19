"""Runs the differential-testing fixtures through a real Tabbycat install and writes golden JSON.

Usage (from any directory, with Tabbycat's Python environment):

    python -I run_tabbycat.py --tabbycat <tabbycat checkout> --fixtures <fixtures dir> --out <golden dir>

The script imports each fixture's DebateXML with Tabbycat's own archive importer, applies the
fixture's configuration (preferences, break sizes, availability, ghost speeches: things the
importer does not read), and then asks Tabbycat's own code for:

  * team and speaker standings after every played round (TeamStandingsGenerator / SpeakerStandingsGenerator),
  * the draw for every round, generated from the history before it (DrawManager),
  * the break for every category, highest priority first (BreakGenerator),
  * an adjudicator allocation for one round (Voting/ConsensusHungarianAllocator).

Everything for a fixture happens inside one transaction that is rolled back at the end, and every
"what if" (a regenerated draw, a re-allocation) inside a savepoint that is rolled back too, so the
database is left empty and runs are repeatable. Python's `random` is seeded per step.

Output uses the archive's ids (T1, S1, A1, D1_1, BC1, ...), so the CrabbyTab side can be compared
without any id mapping.
"""
import argparse
import json
import os
import random
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

TEAM_METRICS = {
    "bp": ["points", "wins", "speaks_sum", "speaks_avg", "speaks_stddev", "draw_strength",
           "draw_strength_speaks", "firsts", "seconds", "thirds"],
    "two_team": ["wins", "points", "speaks_sum", "speaks_avg", "speaks_ind_avg", "speaks_stddev",
                 "margin_sum", "margin_avg", "draw_strength", "draw_strength_speaks", "num_adjs"],
}
SPEAKER_METRICS = {
    "bp": ["total", "average", "stdev", "count"],
    "two_team": ["total", "average", "stdev", "count"],
}
REPLY_METRICS = ["replies_sum", "replies_avg", "replies_count"]
# Draws per round: the primary one plus this many minus one with other seeds.
DRAW_SAMPLES = 8


class Rollback(Exception):
    """Raised to leave a savepoint without keeping its changes."""


def setup_django(tabbycat_dir):
    app_dir = Path(tabbycat_dir).resolve() / "tabbycat"
    sys.path.insert(0, str(app_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    os.environ.setdefault("DISABLE_SENTRY", "1")
    import django
    django.setup()
    # Tabbycat's settings log every SQL annotation at DEBUG to stdout; keep the run readable.
    import logging
    logging.disable(logging.INFO)


def tabbycat_version(tabbycat_dir):
    try:
        return subprocess.run(
            ["git", "-C", str(tabbycat_dir), "describe", "--tags", "--always"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return os.environ.get("TABBYCAT_VERSION", "unknown")


def rank_of(info):
    """The 'rank' ranking: an int, or (rank, equal) depending on the annotator."""
    ranking = info.get_ranking("rank")
    return ranking[0] if isinstance(ranking, (tuple, list)) else ranking


def number(value):
    if value is None:
        return None
    return round(float(value), 6)


class FixtureRun:

    def __init__(self, fixture_dir):
        from django.db import transaction  # noqa: F401 (Django must be set up first)
        self.dir = Path(fixture_dir)
        self.config = json.loads((self.dir / "config.json").read_text(encoding="utf-8"))
        self.xml = ElementTree.fromstring((self.dir / "tournament.xml").read_bytes())
        self.format = self.config["format"]

    # ------------------------------------------------------------------ import

    def import_archive(self):
        from importer.archive import Importer
        self.importer = Importer(self.xml)
        self.importer.import_tournament()
        self.t = self.importer.tournament
        self.team_ids = {team.id: xml_id for xml_id, team in self.importer.teams.items()}
        self.speaker_ids = {speaker.id: xml_id for xml_id, speaker in self.importer.speakers.items()}
        self.adj_ids = {adj.id: xml_id for xml_id, adj in self.importer.adjudicators.items()}
        self.category_ids = {cat.id: xml_id for xml_id, cat in self.importer.team_breaks.items()}
        self.rounds = {r.seq: r for r in self.t.round_set.all()}

    def apply_configuration(self):
        """Settings the DebateXML importer leaves at defaults (see README, "Configuration fixups")."""
        from availability.models import RoundAvailability
        from django.contrib.contenttypes.models import ContentType
        from results.models import SpeakerScore, SpeakerScoreByAdj

        for key, value in self.config["tabbycatPreferences"].items():
            self.t.preferences[key] = value

        for spec in self.config["breakCategories"]:
            category = self.importer.team_breaks[spec["id"]]
            category.break_size = spec["breakSize"]
            category.reserve_size = spec["reserveSize"]
            category.priority = spec["priority"]
            category.is_general = spec["general"]
            category.rule = spec["rule"]
            category.save()

        # Every team and adjudicator is available, except where the fixture says otherwise.
        team_ct = ContentType.objects.get_for_model(self.importer.teams[next(iter(self.importer.teams))])
        adj_ct = ContentType.objects.get_for_model(self.importer.adjudicators[next(iter(self.importer.adjudicators))])
        rows = []
        for seq, round in self.rounds.items():
            unavailable = set(self.config["unavailableTeams"].get(str(seq), []))
            for xml_id, team in self.importer.teams.items():
                if xml_id not in unavailable:
                    rows.append(RoundAvailability(content_type=team_ct, object_id=team.id, round=round))
            for adj in self.importer.adjudicators.values():
                rows.append(RoundAvailability(content_type=adj_ct, object_id=adj.id, round=round))
        RoundAvailability.objects.bulk_create(rows)

        # Speeches flagged ghost="true" (iron-person duplicates) do not count for the speaker.
        for debate in self.xml.iter("debate"):
            debate_obj = self.importer.debates[debate.get("id")]
            for side in debate.findall("side"):
                for position, speech in enumerate(side.findall("speech"), start=1):
                    if speech.get("ghost") == "true":
                        dt = self.importer.debateteams[(debate.get("id"), side.get("team"))]
                        SpeakerScore.objects.filter(
                            ballot_submission__debate=debate_obj, debate_team=dt, position=position,
                        ).update(ghost=True)
                        SpeakerScoreByAdj.objects.filter(
                            ballot_submission__debate=debate_obj, debate_team=dt, position=position,
                        ).update(ghost=True) if hasattr(SpeakerScoreByAdj, "ghost") else None

    # -------------------------------------------------------------- standings

    def team_standings(self, round):
        from standings.teams import TeamStandingsGenerator
        precedence = self.t.pref("team_standings_precedence")
        extra = [m for m in TEAM_METRICS[self.format] if m not in precedence]
        generator = TeamStandingsGenerator(precedence, ("rank",), extra_metrics=extra)
        standings = generator.generate(self.t.team_set.all(), round=round)
        return {
            "precedence": list(precedence),
            "rows": sorted([{
                "team": self.team_ids[info.team.id],
                "rank": rank_of(info),
                "metrics": {key: number(value) for key, value in info.metrics.items()},
            } for info in standings], key=lambda row: (row["rank"] or 10 ** 6, row["team"])),
        }

    def speaker_standings(self, round, replies=False):
        from participants.models import Speaker
        from standings.speakers import SpeakerStandingsGenerator
        from tournaments.models import Round
        if replies:
            precedence = ["replies_avg"]
            extra = [m for m in REPLY_METRICS if m not in precedence]
            missable = self.t.pref("standings_missed_replies")
            field = "replies_count"
        else:
            precedence = list(self.t.pref("speaker_standings_precedence"))
            extra = [m for m in SPEAKER_METRICS[self.format] if m not in precedence]
            missable = self.t.pref("standings_missed_debates")
            field = "count"
        rank_filter = (None, None)
        if missable >= 0:
            prelims = self.t.round_set.filter(stage=Round.Stage.PRELIMINARY, seq__lte=round.seq).count()
            rank_filter = (field, prelims - missable)
        generator = SpeakerStandingsGenerator(precedence, ("rank",), extra, rank_filter=rank_filter)
        standings = generator.generate(Speaker.objects.filter(team__tournament=self.t), round=round)
        return {
            "precedence": precedence,
            "minimumForRank": rank_filter[1],
            "rows": sorted([{
                "speaker": self.speaker_ids[info.speaker.id],
                "rank": rank_of(info),
                "metrics": {key: number(value) for key, value in info.metrics.items()},
            } for info in standings], key=lambda row: (row["rank"] or 10 ** 6, row["speaker"])),
        }

    def standings(self):
        out = []
        for seq in self.config["standingsAfterRounds"]:
            round = self.rounds[seq]
            random.seed(self.config["seed"] * 100 + seq)
            entry = {
                "afterRound": seq,
                "teams": self.team_standings(round),
                "speakers": self.speaker_standings(round),
            }
            if self.t.pref("reply_scores_enabled"):
                entry["replies"] = self.speaker_standings(round, replies=True)
            out.append(entry)
        return out

    # ------------------------------------------------------------------ draws

    def draw_once(self, seq, seed):
        """One draw of round `seq` from the history before it, with Python's RNG seeded."""
        from django.db import transaction
        from draw.generator import DrawUserError
        from draw.manager import DrawManager
        from draw.models import Debate
        from tournaments.models import Round

        result = {}
        try:
            with transaction.atomic():
                # Only the history before this round exists while it is drawn.
                Debate.objects.filter(round__tournament=self.t, round__seq__gte=seq).delete()
                round = Round.objects.get(pk=self.rounds[seq].pk)
                round.draw_status = Round.Status.NONE
                round.draw_type = Round.DrawType.RANDOM if seq == 1 else Round.DrawType.POWERPAIRED
                round.completed = False
                round.save()
                random.seed(seed)
                try:
                    DrawManager(round).create()
                except DrawUserError as error:
                    result["error"] = str(error)
                    raise Rollback()
                result["drawType"] = round.draw_type
                result["debates"] = []
                result["byes"] = []
                for debate in round.debate_set.all().prefetch_related("debateteam_set__team").order_by("room_rank"):
                    dts = list(debate.debateteam_set.all())
                    if len(dts) == 1 and dts[0].side == -1:
                        result["byes"].append(self.team_ids[dts[0].team_id])
                        continue
                    result["debates"].append({
                        "bracket": number(debate.bracket),
                        "roomRank": debate.room_rank,
                        "teams": [{
                            "team": self.team_ids[dt.team_id],
                            "side": dt.side,
                            "flags": list(dt.flags or []),
                        } for dt in sorted(dts, key=lambda dt: dt.side)],
                        "flags": list(debate.flags or []),
                    })
                result["byes"].sort()
                raise Rollback()
        except Rollback:
            pass
        return result

    def draw(self, seq):
        """The primary draw, plus `samples` drawn with other seeds so the comparison can tell
        seed-to-seed variation from a rule difference."""
        base = self.config["seed"] * 1000 + seq
        result = {"round": seq, **self.draw_once(seq, base)}
        result["samples"] = [self.draw_once(seq, base + 7919 * k) for k in range(1, DRAW_SAMPLES)]
        return result

    # ----------------------------------------------------------------- breaks

    def breaks(self):
        from breakqual.base import BreakGeneratorError
        from breakqual.generator import BreakGenerator
        from breakqual.models import BreakingTeam
        out = []
        categories = sorted(self.t.breakcategory_set.all(), key=lambda c: (-c.priority, c.seq))
        for category in categories:
            random.seed(self.config["seed"] * 10 + category.seq)
            entry = {"category": self.category_ids[category.id], "rule": category.rule,
                     "breakSize": category.break_size, "reserveSize": category.reserve_size}
            try:
                BreakGenerator(category).generate()
            except BreakGeneratorError as error:
                entry["error"] = str(error)
                out.append(entry)
                continue
            rows = BreakingTeam.objects.filter(break_category=category).order_by("rank", "team_id")
            entry["breaking"] = [{"team": self.team_ids[bt.team_id], "rank": bt.rank, "breakRank": bt.break_rank}
                                 for bt in rows if bt.break_rank is not None]
            entry["reserves"] = [{"team": self.team_ids[bt.team_id], "rank": bt.rank}
                                 for bt in rows if bt.remark == BreakingTeam.Remark.RESERVE]
            entry["excluded"] = [{"team": self.team_ids[bt.team_id], "rank": bt.rank, "remark": bt.remark}
                                 for bt in rows if bt.break_rank is None and bt.remark not in (None, "", BreakingTeam.Remark.RESERVE)]
            out.append(entry)
        return out

    # ------------------------------------------------------------- allocation

    def allocation(self):
        from adjallocation.allocators.hungarian import ConsensusHungarianAllocator, VotingHungarianAllocator
        from adjallocation.models import DebateAdjudicator
        from django.db import transaction
        from draw.models import Debate

        seq = self.config["allocationRound"]
        result = {"round": seq}
        debate_ids = {debate.id: xml_id for xml_id, debate in self.importer.debates.items()}
        try:
            with transaction.atomic():
                Debate.objects.filter(round__tournament=self.t, round__seq__gt=seq).delete()
                DebateAdjudicator.objects.filter(debate__round=self.rounds[seq]).delete()
                round = self.rounds[seq]
                random.seed(self.config["seed"] * 7 + seq)
                debates = round.debate_set.all()
                adjs = round.active_adjudicators.all()
                klass = VotingHungarianAllocator if round.ballots_per_debate == "per-adj" else ConsensusHungarianAllocator
                result["allocator"] = klass.key
                allocation, warnings = klass(debates, adjs, round).allocate()
                result["warnings"] = [str(w) for w in warnings]
                result["debates"] = sorted([{
                    "debate": debate_ids[alloc.container.id],
                    "chair": self.adj_ids[alloc.chair.id] if alloc.chair else None,
                    "panellists": sorted(self.adj_ids[a.id] for a in alloc.panellists),
                    "trainees": sorted(self.adj_ids[a.id] for a in alloc.trainees),
                } for alloc in allocation], key=lambda row: row["debate"])
                raise Rollback()
        except Rollback:
            pass
        return result

    # -------------------------------------------------------------------- run

    def run(self, version):
        from django.db import transaction
        output = {}
        try:
            with transaction.atomic():
                self.import_archive()
                self.apply_configuration()
                output = {
                    "fixture": self.config["name"],
                    "engine": "tabbycat",
                    "engineVersion": version,
                    "preferences": {
                        key: self.t.pref(key.split("__", 1)[1]) for key in [
                            "standings__team_standings_precedence", "standings__speaker_standings_precedence",
                            "standings__standings_missed_debates", "draw_rules__draw_odd_bracket",
                            "draw_rules__draw_pairing_method", "draw_rules__draw_avoid_conflicts",
                            "draw_rules__draw_side_allocations", "draw_rules__avoid_same_institution",
                            "draw_rules__avoid_team_history", "draw_rules__bye_team_selection",
                            "draw_rules__bye_team_results", "draw_rules__max_times_per_side",
                            "draw_rules__draw_pullup_restriction", "draw_rules__bp_pullup_distribution",
                            "draw_rules__bp_position_cost", "draw_rules__bp_assignment_method",
                            "draw_rules__bp_renyi_order", "draw_rules__bp_position_cost_exponent",
                            "draw_rules__draw_pullup_penalty", "draw_rules__team_history_penalty",
                            "draw_rules__team_institution_penalty", "debate_rules__ballots_per_debate_prelim",
                            "debate_rules__substantive_speakers", "debate_rules__reply_scores_enabled",
                            "scoring__margin_includes_dissenters", "scoring__teamscore_includes_ghosts",
                            "feedback__adj_min_score", "feedback__adj_max_score",
                        ]
                    },
                    "standings": self.standings(),
                    "draws": [self.draw(seq) for seq in self.config["drawRounds"]],
                    "breaks": self.breaks(),
                    "allocation": self.allocation(),
                }
                raise Rollback()
        except Rollback:
            pass
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--tabbycat", required=True, help="Path to the Tabbycat checkout")
    parser.add_argument("--fixtures", required=True, help="Directory holding one folder per fixture")
    parser.add_argument("--out", required=True, help="Directory for <fixture>.tabbycat.json")
    parser.add_argument("--only", action="append", help="Run only this fixture (repeatable)")
    args = parser.parse_args()

    setup_django(args.tabbycat)
    version = tabbycat_version(args.tabbycat)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for fixture_dir in sorted(Path(args.fixtures).iterdir()):
        if not (fixture_dir / "config.json").exists():
            continue
        if args.only and fixture_dir.name not in args.only:
            continue
        print(f"[tabbycat-diff] {fixture_dir.name}", file=sys.stderr)
        output = FixtureRun(fixture_dir).run(version)
        (out_dir / f"{fixture_dir.name}.tabbycat.json").write_text(
            json.dumps(output, indent=2, sort_keys=False, default=str) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
