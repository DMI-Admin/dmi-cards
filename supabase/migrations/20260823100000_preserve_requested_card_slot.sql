create or replace function public.assign_card_slot()
returns trigger
language plpgsql
as $$
declare
  next_slot smallint;
begin
  if tg_op = 'UPDATE' then
    new.card_slot = old.card_slot;
    return new;
  end if;

  if new.user_id is null then
    new.card_slot = null;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public.cards.card_slot:' || new.user_id::text, 0)
  );

  if new.card_slot is not null then
    if exists (
      select 1
      from public.cards
      where user_id = new.user_id
        and card_slot = new.card_slot
    ) then
      raise exception 'CARD_SLOT_ALREADY_OCCUPIED: requested card slot is no longer available';
    end if;

    return new;
  end if;

  select slot
  into next_slot
  from generate_series(1, 3) as slot
  where not exists (
    select 1
    from public.cards
    where user_id = new.user_id
      and card_slot = slot
  )
  order by slot asc
  limit 1;

  if next_slot is null then
    raise exception 'CARD_SLOT_LIMIT_REACHED: users can have at most three cards';
  end if;

  new.card_slot = next_slot;
  return new;
end;
$$;
