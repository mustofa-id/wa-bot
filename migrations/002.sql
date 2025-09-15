-- We need to do this so adding the created_at column won’t fail, 
-- since SQLite doesn’t allow non-constant default values if there’s
-- already data in the table. This isn’t really a problem since there 
-- wasn’t any specific relation to the users table before.
delete from users where true;

alter table users add column created_at text not null default (current_timestamp);

alter table users add column is_active integer not null default 1;

alter table users add column is_owner integer not null default 0;

create table if not exists bookkeeping (
	id integer primary key autoincrement,
	user_id integer not null references users (id),
	amount integer not null,
	date text not null,
	description text not null,
	created_at text not null default (current_timestamp)
);
