# Email and notifications

The **Email** page (sidebar → Public → Email, administrators only; titled *Tournament email*) sends plain-text email through your SMTP server, sends automatic notifications, holds the tournament's email templates and keeps a history. Everything is sent by the server; nothing is sent from the browser.

## Setting up SMTP

SMTP is configured by whoever deploys CrabbyTab, as server environment variables (`SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), plus `FIREBASE_SERVICE_ACCOUNT_JSON`; see [Installation](Installation-and-Local-Development). Credentials are never stored in tournament data. Port 587 uses STARTTLS, port 465 implicit TLS. Use **Send test email** on the Email page to check the setup.

Without SMTP every send fails before anything is recorded as sent.

## Sending an email by hand

1. Under **Compose tournament email**, pick **Recipients**:

   | Group | Who |
   | --- | --- |
   | All teams / Breaking teams / Non-breaking teams | Every speaker with an email on those teams |
   | All adjudicators / Checked-in adjudicators / All trainees | Adjudicators with an email |
   | All participants | Teams and adjudicators |
   | Teams in a round / Adjudicators in a round / Chairs in a round / Panellists in a round | Needs a **Round** |
   | Institution coaches and representatives | Coaches stored on institutions (registration representatives once saved as coaches) |

2. Pick a **Template**: Tournament announcement, Round details, Adjudicator assignment, Feedback reminder, Adjudicator private portal credentials, Team private portal credentials, or Custom. The two credential templates also switch the recipients to all adjudicators / all teams. Saved templates from **Email settings and templates** can be loaded with **Use in the compose form** (see below).
3. Edit subject and message, check the preview, tick the confirmation and send.

Each recipient gets a separate message. Addresses are de-duplicated (case-insensitive).

**Limits:** at most **100 unique recipients per send**, subject up to 200 characters on one line, message up to 20,000 characters.

### Variables

Write `{{variable}}` (spaces inside the braces are allowed). An unknown variable is an error.

| Variables | Filled with |
| --- | --- |
| `name` `email` `tournament` `round` `institution` `team` | Always available (`team` empty for adjudicators) |
| `long_name` | The team's long name with institution (Tabbycat LONG) |
| `debate` `venue` `venue_url` `chair` `panellists` `position` | The recipient's debate in the chosen round; `position` is Chair, Panellist or Trainee |
| `private_url` `passcode` `key` | The recipient's private portal link, passcode, and link key |
| `speakers` `code_name` `emoji` `break_categories` | Team registration details (empty for adjudicators) |
| `side` `result` `points` `ballot` `motions` | Filled only in the matching automatic notifications |
| `entry` `url` `teams_allocated` `adjudicators_allocated` | Filled only in registration emails |

Private links:

- If the template uses `{{private_url}}` or `{{passcode}}` and a recipient has none, the send is refused ("Generate private URLs and try again").
- A send is refused if one address would receive two different private links (for example a speaker on two teams).
- Speakers get their team's link, or their own speaker link if they have one. Coaches have no private link.

## History and retries

**Campaign history** lists the latest 50 sends (manual, retries and automatic notifications) with status, sender, counts and per-recipient errors. **Retry failed** resends only to failed recipients; each attempt can be retried once (retry the latest attempt after that). Private links and passcodes are never stored in the history; a retry looks them up again.

## Automatic notifications

Turn each event on in **Automatic notifications** on the Email page. All are off by default.

| Event | Sent to | When |
| --- | --- | --- |
| Draw released | Each team's speakers | The draw is released to teams (teams-only or full release) |
| Draw released | Each adjudicator on a panel | The draw is fully released **and** panels are revealed |
| Team results | Each team's speakers (result and running team points) | The round's results are released, the round is not silent and public results are on |
| Motions released | Speakers and adjudicators in the round (motions and info slides) | Motions released and the draw fully released |
| Ballot confirmed | Consensus: every adjudicator of the debate, trainees included. Voting: each voting adjudicator, with only their own sheet | The tab room confirms a result in a running round |
| Ballot receipts | The adjudicator who submitted (private URL or public form); the debate's adjudicators when the tab room or staff enter and confirm a result | On submission or tab-room confirmation. Never for BP elimination rounds |

How they work:

- The server reads the **cloud copy**: a release is emailed only after it has been **uploaded**. Each upload sends what is due; **Send due notifications now** does the same on demand.
- Turning an event on marks items already released in the cloud as done, so old rounds are not emailed (the message says how many were skipped).
- Each event and round is sent once, in chunks of up to 100 recipients claimed in a transaction first, so concurrent triggers never double-send. A claimed chunk that fails is not resent automatically: use **Retry failed**.
- Team results count released, non-silent preliminary rounds only. A team without a confirmed result gets no email (never a zero). Elimination rounds produce no team-results email.
- Ballot confirmed only covers running rounds (draw out, not completed); confirmations in completed rounds are not emailed.
- A failing receipt never fails the ballot submission.

## Email settings and templates

**Email settings and templates** (Email page) is stored on the server and applies to the next email at once (no upload needed):

| Setting | Effect |
| --- | --- |
| Reply-To name / address | Added to every email the tournament sends: campaigns, retries, notifications, receipts, registration emails |
| Email registrants | Sends *Registration received* and *Registration approved* to registrants |
| Templates | Your own subject and message for each event below; **Reset this template to the default** undoes it. Unknown variables are refused on save |

Templates: Draw released (teams), Draw released (adjudicators), Team results, Ballot receipt, Ballot confirmed, Motions released, Private URL, Feedback URL, Team registration details, Registration received, Registration approved, Places allocated, Institution registered.

- **Private URL**, **Feedback URL** and **Team registration details** are sent by hand: **Use in the compose form** loads them (Team registration details also picks *All teams*). The team details email tells each speaker who is on their team, its code name, emoji and break categories.
- **Places allocated** goes to an institution representative when their link is sent; **Institution registered** goes to an institution's contact when it registers (always sent). See [registration.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/registration.md).

## Delivery status (webhook)

Every message carries an `X-CrabbyTab-Ref` header. If the server has `EMAIL_WEBHOOK_SECRET`, point your provider (or a small adapter) at `POST /api/email/webhook`, signed with an HMAC-SHA256 of the body in `X-CrabbyTab-Signature`. Campaign history then shows each address's latest status (delivered, bounce, open, and so on). Without the secret the endpoint is off; the settings panel shows whether it is configured. No provider is built in.

## SMS relay

The server has an SMS hook: with `SMS_WEBHOOK_URL` (https) and `SMS_WEBHOOK_SECRET`, an SMS would be posted, signed, to a relay you control (Twilio, Vonage, a gateway). **Nothing sends SMS yet**; it is an interface for future work. Phone numbers collected at registration must be in international format.

## Tips

- Use an SMTP provider that authenticates your sending domain (SPF/DKIM) and set `SMTP_FROM` to an address on that domain.
- Check your provider's daily limit against teams × speakers × rounds.
- Emails are plain text only.

## Differences from Tabbycat

- SMTP is the only built-in transport; delivery status needs your own webhook adapter.
- No browser push notifications.
- Sends are capped at 100 recipients each.

More: [email-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/email-notifications.md), [public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md).
