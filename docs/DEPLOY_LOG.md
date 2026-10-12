# Deployment notes

The full-feature fork is upstream main plus the open upstream pull requests: channel support, bounded Bot delivery retries, keyword alerts, chat defaults, summary and chat follow-up questions, raw prompt drawer stability, sync times, chat list toggles, summary chat filters, batch generation, and weekly and monthly summaries.

## 2026-10-12

- Rebuild the fork from upstream main and the open upstream pull requests #11–#22, so the deployed code matches the code under review.
- Replace the earlier weekly/monthly frequency and batch rerun implementations with the reviewed versions: Monday–Sunday weeks and calendar months, frequency switches that take effect from the next full period, and a persistent batch queue.
- Generate batch items per period, read the whole period for follow-up questions, and label weekly and monthly follow-ups with the full date range.
- Migrations `026_account_chats_synced_at`, `027_summary_batch` and `028_summary_frequency` only add tables and columns. On databases that already applied the fork's `026_summary_frequency` and `027_chats_synced_at`, the existing columns are kept and existing rows are not modified; a stored `daily` frequency is read as daily.

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
