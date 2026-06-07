create or replace function public.get_current_client_account_status()
returns table (
  client_id uuid,
  client_status text,
  client_user_id uuid,
  client_user_status text,
  is_suspended boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_email text;
  selected_client_id uuid;
  selected_client_status text;
  selected_client_user_id uuid;
  selected_client_user_status text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  select users.email
  into current_email
  from auth.users as users
  where users.id = current_user_id;

  select clients.id, clients.status
  into selected_client_id, selected_client_status
  from public.clients
  where clients.profile_id = current_user_id
     or clients.user_id = current_user_id
     or (
       current_email is not null
       and lower(coalesce(clients.email, '')) = lower(current_email)
     )
  order by
    case
      when clients.profile_id = current_user_id or clients.user_id = current_user_id then 0
      else 1
    end,
    clients.created_at asc
  limit 1;

  select client_users.id, client_users.status
  into selected_client_user_id, selected_client_user_status
  from public.client_users
  where client_users.profile_id = current_user_id
     or client_users.user_id = current_user_id
     or (
       selected_client_id is not null
       and client_users.client_id = selected_client_id
       and current_email is not null
       and lower(coalesce(client_users.email, '')) = lower(current_email)
     )
     or (
       current_email is not null
       and lower(coalesce(client_users.email, '')) = lower(current_email)
     )
  order by
    case
      when client_users.profile_id = current_user_id or client_users.user_id = current_user_id then 0
      else 1
    end,
    client_users.created_at asc
  limit 1;

  client_id := selected_client_id;
  client_status := coalesce(selected_client_status, 'active');
  client_user_id := selected_client_user_id;
  client_user_status := coalesce(selected_client_user_status, 'active');
  is_suspended :=
    lower(coalesce(selected_client_status, 'active')) in ('suspended', 'inactive')
    or lower(coalesce(selected_client_user_status, 'active')) in ('suspended', 'inactive');

  return next;
end;
$$;

revoke all on function public.get_current_client_account_status()
  from public, anon;

grant execute on function public.get_current_client_account_status()
  to authenticated;
