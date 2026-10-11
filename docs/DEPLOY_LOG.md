# Deployment notes

The full-feature fork combines upstream updates with channel support, bounded Bot delivery retries, keyword alerts, chat defaults, daily/weekly/monthly summaries, batch reruns, summary and chat follow-up questions, sync timestamps and chat filtering improvements.

## 2026-10-11

- Integrate upstream digest history and source citation improvements.
- Upgrade single-summary follow-up to use configured model request settings and bounded context. Load the summary period for daily, weekly and monthly chats, identify the answer source, and retain chat-wide follow-up.
- Keep prompt previews stable during list polling and toast updates.
- No database migration is introduced by this update. Existing migrations must retain their filenames when upgrading deployed databases.

## Upgrade procedure

1. Back up the database and record the currently running application and web image IDs.
2. Verify migration compatibility and run backend tests against an isolated database.
3. Build application and web images from the same Git commit.
4. Preserve the old images under rollback tags before replacing the running application and web services.
5. Check service health, authentication, summary retrieval and follow-up behavior.

Deployment addresses, credentials, backups and host-specific configuration belong in private operator records.
