alter table public.cards
  add column if not exists card_slot smallint;

do $$
begin
  if exists (
    select 1
    from public.cards
    where user_id is not null
    group by user_id
    having count(*) > 3
  ) then
    raise exception 'CARD_SLOT_BACKFILL_BLOCKED: at least one user already has more than three cards';
  end if;
end $$;

with ranked_cards as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at asc, id asc
    ) as slot_number
  from public.cards
  where user_id is not null
)
update public.cards
set card_slot = ranked_cards.slot_number
from ranked_cards
where public.cards.id = ranked_cards.id
  and public.cards.card_slot is null;

alter table public.cards
  drop constraint if exists cards_card_slot_check;

alter table public.cards
  add constraint cards_card_slot_check
  check (card_slot is null or card_slot in (1, 2, 3));

create unique index if not exists cards_user_id_card_slot_unique_idx
  on public.cards (user_id, card_slot)
  where user_id is not null
    and card_slot is not null;

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

drop trigger if exists cards_assign_card_slot on public.cards;

create trigger cards_assign_card_slot
before insert or update on public.cards
for each row
execute function public.assign_card_slot();
