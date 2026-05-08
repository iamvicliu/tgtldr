alter table telegram_auth
    add column if not exists chats_synced_at timestamptz;
