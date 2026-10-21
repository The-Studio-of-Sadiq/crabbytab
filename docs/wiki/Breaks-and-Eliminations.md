# Breaks and eliminations

The **Break** page (sidebar → **Results** → **Break**) manages break categories, calculates and generates each category's break, and links to **Edit eligibility** and **Breaking adjudicators**. Elimination rounds then run from the **Draw** and **Results** pages. Staff with `standings.view` can see the Break page; changing it is for administrators.

Developer reference: [standings-and-breaks.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/standings-and-breaks.md), [draw-generation.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/draw-generation.md), [tournament-rules-enforcement.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tournament-rules-enforcement.md). Code: `src/lib/breakqual/`, `src/lib/draw/elimination.ts`, `src/features/tournament/application/breaks.ts`.

## Step by step

1. **Create the elimination rounds** (the setup wizard does this from your largest break size, or add them from the round menu). A break needs enough non-cancelled elimination rounds for its size.
2. **Add break categories** on the Break page (*Add break category*), e.g. Open, ESL, Novice.
3. **Set eligibility**: *Edit eligibility* on the Break page, the team's own record, the `break_categories` CSV column, or a speaker-category rule (below).
4. When the preliminary rounds are done, check each category's calculated break, resolve any **cutoff tie** or **too few eligible** error, then press **Generate Break**.
5. **Release** the break in the **Public release** panel (Standings page) when you announce it.
6. Draw each elimination round on the **Draw** page, enter ballots, then **Proceed to next round** on the **Results** page.

## Break categories

| Field | Meaning |
| --- | --- |
| Category name | e.g. "ESL Break". |
| Break size | Teams that break. Two-team: at least 2. BP: even and at least 4. N teams per room: at least 1. It need not be a power of two (see partial eliminations). |
| Reserve size | Reserves listed after the breaking teams (R1, R2, …). 0 or more. |
| Priority order (higher takes precedence) | Categories are processed from the highest priority down. A team that breaks in a category is left out of every **lower-priority** category ("Different break"). Categories of **equal priority** do not exclude each other, so a team can break in both (as in Tabbycat). |
| General category | Every team is eligible (like an Open break) unless marked *Ineligible*. Otherwise only teams marked eligible for this category. |
| Break qualification rule | See below. |
| Maximum qualifiers per institution | 0 = no limit. Applies to breaking teams and reserves, **Standard rule only** (excluded teams show as "Capped (institution limit)"). |
| Public tab limit | The public team tab for this category shows only teams ranked this high or better (ties at the limit are kept, and the page says "Showing the top N only"). 0 = every team. |

A category cannot be deleted while it has a generated break or an elimination round using it has been drawn.

### Eligibility

- **Edit eligibility** (`/break/eligibility`) is a team × category checkbox grid with a whole-column checkbox per category (for the teams the search shows). A **general** category's column sets the *Ineligible* override instead of membership. Changes are a draft until saved; regenerate a break to use them.
- **Eligibility from speaker categories** (panel on the Break page, non-general categories): a rule such as "every speaker" or "at least N speakers" in a speaker category (e.g. ESL). The page shows how many teams would gain or lose eligibility and applies it only when you confirm, as one batch with an audit event. It is not re-applied automatically, so later manual edits are kept until the next apply.

## Qualification rules

| Rule | Formats | Behaviour |
| --- | --- | --- |
| **Standard** (default) | All | Highest-ranked eligible teams; the per-institution limit applies. |
| **AIDA 1996** | All | At most three teams per institution. |
| **AIDA 2016 Australs** | Two-team | Only teams with at least the wins of the team in the last breaking place can break **or be reserves**. A team is capped if it is its institution's 2nd or later team below the natural cutoff, or its institution's 4th or later team. If the break comes up short, capped teams are reinserted in rank order, teams tied on every metric together. |
| **AIDA 2016 Easters** | Two-team | As Australs, but capped teams within their institution's top three are reinserted first. |
| **AIDA 2019 Australs (open, dynamic cap)** | Two-team | AIDA 2016 Australs with an institution cap of 3, plus one for every 8 teams the break exceeds 16 (3 up to 23, 4 for 24–31, 5 for 32–39, …). |

The AIDA 2016/2019 rules need wins, so they are refused for BP. **Institution rank** (the AIDA rules' "nth team of its institution") is counted over every team in the category's standings, including ineligible, excluded and already-broken teams, and teams tied in the standings share it. Institutions are matched by id, falling back to the name.

## Ranking within a category

- A **general** category ranks every team on the overall standings and keeps overall ranks (column "Tab rank").
- A **non-general** category ranks only its own teams (eligible plus manually included) among themselves: ranks restart at 1 (column "Category rank") and who-beat-whom compares teams tied within the category. Teams that broke in a higher-priority category stay in this ranking, so the first ESL breaker can be ranked 2nd. Other metrics (draw strength included) are tournament-wide values.

## Overrides

Under **Manual overrides**, each team can get one override per category:

- **Manually included**: takes a break place first, bypassing eligibility and caps. A team still never breaks in two categories of different priority.
- **Ineligible**, **Withdrawn**, **Different break**, **Disqualified**, **Lost coin toss**: remove the team from this category.

The list of excluded teams shows every manual exclusion, plus rule-based exclusions (different break, capped) of teams ranked above the last breaking team. Overrides (remarks) are never published.

## Ties at the cutoff

When teams level on every precedence metric straddle the last breaking place or the last reserve place, CrabbyTab **holds the whole tied group out** and **refuses to generate the break** until you decide. It never settles a tie by name or any other arbitrary order, and never makes a break larger than its size (the elimination bracket depends on it).

- The Break page lists the tied teams as "Tied" and explains the fix; *Generate Break* stays disabled.
- Resolve it (for example by coin toss) with overrides: **Manually included** for the team(s) that go through (the others stay in the running for reserve places), or **Lost coin toss** for the others.
- Reserve places after a tied group are counted from the end of the group, as Tabbycat does: a break of 3 + 2 reserves with three teams tied for 2 places leaves one reserve place.

This differs from Tabbycat, which lets every tied team through and leaves it to the tab director.

**Break ranks.** The *Seed* column shows each breaking team's break rank as Tabbycat does: teams tied on every metric (for example two manually included teams) share it, shown as "=2". The bracket still uses a unique seed per team. Reserves show R1, R2, ….

## Generating the break

**Generate Break** (or **Regenerate Break**) for one category:

- is refused (hard rules) when there are **too few eligible teams** for the break size, when a **cutoff tie** is unresolved, or when an elimination round the change would touch has already been drawn or advanced;
- warns (a soft rule you can override with a recorded reason) when preliminary rounds are not finished;
- needs a valid break size and enough pre-created, non-cancelled elimination rounds;
- assigns categories to elimination rounds by schedule: smaller breaks join later rounds (with N teams per room, every category is in every elimination round);
- marks this category's teams *breaking* (teams that break in no category become *eliminated*); other categories keep their own generated break;
- stores a snapshot of the break and writes an audit event, then makes the category's first elimination round the active round.

If standings, settings or overrides change afterwards, the page warns that the calculated break differs from the generated one; regenerate to apply it. A generated break can also be cleared through the API (refused once one of its rounds has a draw); see [API and tokens](API-and-Tokens).

The break is not public until you release that category in the **Public release** panel on the Standings page; see [Public pages and releases](Public-Pages-and-Releases).

## Elimination draws

Draw the elimination round on the **Draw** page as usual (see [Rounds and draws](Rounds-and-Draws)).

- **Seeds** are the teams' places in the category's break; each team keeps its bracket position throughout.
- **Bracket positions carry forward**: later rounds inherit the position of the room a team came from instead of re-seeding.
- **Full fields** (two-team 2ᵏ, BP 4 × 2ᵏ) use standard seeded brackets, e.g. two-team 16: 1v16, 8v9, 4v13, 5v12, 2v15, 7v10, 3v14, 6v11; BP 16: [1,8,9,16], [4,5,12,13], [2,7,10,15], [3,6,11,14].
- **Sides** follow **Configuration → Draw rules → Sides in elimination rounds**: *By seed* (default; the higher seed takes Affirmative / Opening Government and sides are final) or *Random* (as Tabbycat; drawn with the draw's seed and left unconfirmed, and two-team ballots record the sides taken).
- **N teams per room**: elimination draws are not generated (as in Tabbycat). Set the round's draw type to manual and draw it by hand.

### Partial eliminations

A break that does not halve cleanly (e.g. 12 two-team teams, or 24 or 6 BP teams) starts with a **partial elimination round**. With T the largest full field below N, the top 2T − N seeds get an elimination **bye** (they advance without a ballot), and the remaining seeds are folded: two-team, best remaining against weakest; BP room j holds seeds B+j, T+1−j, T+j, N+1−j. The Break page shows "Partial elimination: the top N seeds get a bye".

## Advancing

When every non-bye debate has a confirmed ballot, press **Proceed to next round** on the **Results** page of the elimination round. It:

- checks the round has a draw, every eligible team is in a debate, no team that did not qualify for this stage is in the round, and every ballot names the draw's current teams;
- advances the winner (two-team), the top two of each room (BP; the winner only in the final), or for N teams per room the top two by rank (one in the final) or the teams a results-only ballot declares advancing;
- marks the rest eliminated, marks the round completed, and activates the next elimination round.

Elimination rounds never count in standings.

## Breaking adjudicators

**Breaking adjudicators** (`/break/adjudicators`) lists every adjudicator with a search, a *Breaking only* filter and an inline breaking toggle (also available from the feedback overview). There is no adjudicator break calculation; releasing the public list is a separate switch in the Public release panel.

## Details and differences from Tabbycat

- Cutoff ties are held out for the tab director instead of all breaking.
- Swing teams never break and are left out of liveness counts.
- Elimination sides default to *By seed* (Tabbycat randomises); choose *Random* to match Tabbycat.
- BP eliminations work from any even field of at least 4 teams, using partial elimination rounds.
- WADL is not a Tabbycat break rule and is not offered.
- Break liveness (safe / live / dead) is described on [Standings and metrics](Standings-and-Metrics#break-liveness).
