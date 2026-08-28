create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.enforce_contact_card_attribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_user_id uuid;
  persisted_card_slot smallint;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'CONTACT_OWNER_REQUIRED: authenticated user is required'
      using errcode = '42501';
  end if;

  if new.owner_user_id is distinct from current_user_id then
    raise exception 'CONTACT_OWNER_MISMATCH: contacts must belong to the authenticated user'
      using errcode = '42501';
  end if;

  if new.card_id is null then
    return new;
  end if;

  select card_slot
  into persisted_card_slot
  from public.cards
  where id = new.card_id
    and user_id = current_user_id;

  if not found then
    raise exception 'CONTACT_CARD_NOT_OWNED: contact card attribution is invalid'
      using errcode = '42501';
  end if;

  new.card_slot = persisted_card_slot;
  return new;
end;
$$;

revoke all on function private.enforce_contact_card_attribution() from public;
revoke all on function private.enforce_contact_card_attribution() from anon;
revoke all on function private.enforce_contact_card_attribution() from authenticated;

drop trigger if exists contacts_enforce_card_attribution on public.contacts;

create trigger contacts_enforce_card_attribution
before insert or update on public.contacts
for each row
execute function private.enforce_contact_card_attribution();
