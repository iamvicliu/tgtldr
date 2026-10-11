alter table chats
    add column if not exists summary_frequency text not null default 'daily';
