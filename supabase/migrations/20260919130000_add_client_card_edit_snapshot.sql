-- Additive, read-only prerequisite for the media finalizer's edit revision.
-- The protected server derives p_owner; clients cannot execute this function.
begin;

create function public.get_client_card_edit_snapshot(p_owner uuid, p_card_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  card_row public.cards%rowtype;
  result jsonb;
begin
  select c.* into card_row
  from public.cards as c
  where c.id = p_card_id and c.user_id = p_owner;

  -- Identical result for a missing card, foreign-owned card or null identity.
  if not found then
    return null;
  end if;

  result := jsonb_build_object(
    'card', to_jsonb(card_row),
    'revision', encode(sha256(convert_to(to_jsonb(card_row)::text,'UTF8')),'hex')
  );

  -- Bounded full snapshot, with room for legacy inline media. Never truncate:
  -- the revision must describe exactly the complete card returned to the editor.
  -- This response ceiling does not change any write/upload/field validation limit.
  if octet_length(result::text) > 16777216 then
    raise exception 'CARD_EDIT_SNAPSHOT_TOO_LARGE' using errcode = '54000';
  end if;

  return result;
end;
$$;

revoke all on function public.get_client_card_edit_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_client_card_edit_snapshot(uuid, uuid)
  to service_role;

commit;
