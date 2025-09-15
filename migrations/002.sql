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
