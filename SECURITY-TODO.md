# Security TODO Before Production

## Supabase RLS

Current prototype policy allows anon access to the clients table because the admin panel is protected by Clerk.

Before production:

- Remove anon access policies from Supabase
- Connect Clerk auth properly to Supabase
- Use secure server-side database actions
- Add admin-only database access
- Add proper RLS policies for:
  - clients
  - templates
  - cards
  - subscriptions
  - uploads
  - analytics
- Confirm no browser-exposed key can write sensitive data
- Test with non-admin user
- Test with logged-out user

## Clerk

- Keep public sign-ups disabled or invite-only for admin panel
- Enforce admin-only access by user ID or role
- Add unauthorized page
- Review production keys before deployment

## Deployment

- Use production Clerk keys
- Use production Supabase keys
- Store all secrets in Vercel environment variables
- Never expose service role key in browser code