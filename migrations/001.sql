create table if not exists users (
	id integer primary key autoincrement,
	number text unique not null,
	name text
);
