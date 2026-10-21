# CrabbyTab

Welcome to the CrabbyTab wiki. This is the place to learn how to install CrabbyTab, run a debate tournament with it, and work on its code.

**CrabbyTab** is a free, open-source debate tabulation system for **British Parliamentary**, **two-team** formats (Asian/UADC, Australs, World Schools, APDA, Karl Popper and custom) and **N teams per room** (for example public speaking). It handles the whole tournament: setup, participant imports, check-ins, draws, adjudicator and venue allocation, ballots, feedback, standings, breaks and elimination rounds, public pages, private URLs and email. Its algorithms follow [Tabbycat](https://github.com/TabbycatDebate/tabbycat)'s. CrabbyTab is an independent project and is not affiliated with Tabbycat.

**Who it is for:** tab directors, adjudication cores and organisers who want a capable tab system without paying for or maintaining a server. It runs on Vercel's and Firebase's free tiers.

## How it works, in one paragraph

CrabbyTab is **local-first**. The tab room's working copy lives in the browser (IndexedDB), and draws, allocations, standings and breaks are computed there, so the tab room keeps working on a flaky connection. For cloud tournaments, ballots, check-ins, draws and allocations sync **live** between administrator devices; other changes go up with **Upload**, which merges into Firebase Firestore and reports conflicting edits instead of overwriting them. A sanitised, cached snapshot of whatever you have released is then published for the public pages. Participants use private URLs (or optional public forms), which write to the cloud copy through server routes. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync) and [Caching, indexing and performance](Caching-Indexing-and-Performance).

## Quick links

| I want to… | Go to |
| --- | --- |
| Try it locally | [Installation and local development](Installation-and-Local-Development) |
| Host it for a tournament | [Deploying to Vercel and Firebase](Deploying-to-Vercel-and-Firebase) |
| Run my first tournament | [First tournament walkthrough](First-Tournament-Walkthrough) |
| Build the tournament's public homepage (no separate website needed) | [Public homepage](Public-Homepage) |
| Look up a setting | [Settings reference](Settings-Reference) |
| Import teams and adjudicators | [Participants and imports](Participants-and-Imports) · [CSV formats](CSV-Formats) |
| Understand the draw | [Rounds and draws](Rounds-and-Draws) |
| Move from Tabbycat | [Comparison with Tabbycat](Comparison-with-Tabbycat#migrating-from-tabbycat) |
| Translate or add a language | [Languages and translations](Languages-and-Translations) |
| Keep within the free tier / control search engines | [Caching, indexing and performance](Caching-Indexing-and-Performance) |
| Fix a problem | [FAQ and troubleshooting](FAQ-and-Troubleshooting) |
| Contribute code | [Architecture](Architecture) · [Testing](Testing) · [Contributing](Contributing) |

## Organiser guide

- [Tournament setup and formats](Tournament-Setup-and-Formats)
- [Participants and imports](Participants-and-Imports)
- [Check-ins and availability](Check-ins-and-Availability)
- [Rounds and draws](Rounds-and-Draws)
- [Adjudicator allocation and preformed panels](Adjudicator-Allocation)
- [Venues and constraints](Venues-and-Constraints)
- [Ballots and results](Ballots-and-Results)
- [Feedback](Feedback)
- [Standings and metrics](Standings-and-Metrics)
- [Breaks and eliminations](Breaks-and-Eliminations)
- [Public pages and releases](Public-Pages-and-Releases)
- [Public homepage (Home tab)](Public-Homepage)
- [Private URLs and portals](Private-URLs-and-Portals)
- [Email and notifications](Email-and-Notifications)
- [Staff and roles](Staff-and-Roles)
- [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync)
- [API and tokens](API-and-Tokens)
- [Printing and display](Printing-and-Display)
- [Audit log](Audit-Log)

## Status

The behaviour described here is what the code on the `beta` branch does (development is integrated there before release to `main`). A source-level audit against Tabbycat v2.12.1, a second independent audit and the remaining deliberate differences are summarised on [Comparison with Tabbycat](Comparison-with-Tabbycat) and in the [parity plan](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tabbycat-parity-plan.md). This wiki is generated from [`docs/wiki/`](https://github.com/The-Studio-of-Sadiq/crabbytab/tree/beta/docs/wiki) in the repository and also published as a browsable guide at <https://the-studio-of-sadiq.github.io/crabbytab/>.

## License

CrabbyTab is licensed under the **GNU Affero General Public License v3.0 or later**. Source: <https://github.com/The-Studio-of-Sadiq/crabbytab>.
