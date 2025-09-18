create table user_settings (
	id integer primary key autoincrement,
	user_id integer not null references users (id),
	money_daily_reminder integer not null default 1
);

insert or ignore into user_settings (user_id)
select id from users;

create trigger ensure_user_has_settings
after insert on users
begin
  insert or ignore into user_settings (user_id)
  values (new.id);
end;
