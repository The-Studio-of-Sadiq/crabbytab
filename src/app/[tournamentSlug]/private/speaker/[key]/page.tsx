/**
 * A speaker's own private URL (Tabbycat Person.url_key; docs/public-pages-and-notifications.md).
 * It opens the same portal as the team URL, with the speaker's own key and passcode; the server
 * resolves the key to the speaker's team, so the portal can only act for that team.
 */
export { default } from "../../team/[key]/page";
