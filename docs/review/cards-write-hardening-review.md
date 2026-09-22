# Cards write boundary — local review, not executed

Production application prerequisite: deployed protected card writes at
`bfd7482a5f70354cfb6904abd04e03bad1fc092c` and successful Client/Admin smoke tests.
Customer-facing code is unchanged. This package affects only authenticated ACLs
on `public.cards`; no policies, data, functions, other tables or role memberships.

## Review/execution sequence (requires separate authorization)

1. In staging first, run `cards-write-hardening-verification.sql` read-only.
   Confirm published/owned read policies and all required RPCs. Review membership
   rows, including roles which could be reached with SET ROLE. The migration
   conservatively rejects privileged membership even if its SET option is disabled.
2. Run `cards-write-hardening-rollback-generator.sql` BEFORE hardening and save its
   complete `rollback_sql` and original ACL output. Confirm the executor is the
   Cards table owner and mutation ACL grantors match it. Do not use staging ACL
   output as the production rollback: capture each environment independently.
3. Review/apply the new migration as that same table-owner role. The transaction
   takes an exclusive Cards lock with a 5-second acquisition timeout. A guard,
   dependent grant (RESTRICT), inherited/PUBLIC privilege, unexpected role path or
   missing prerequisite aborts the entire migration. Do not disable guards to pass.
4. Rerun verification: authenticated table writes and every column-level
   INSERT/UPDATE/REFERENCES must be false. SELECT must remain true for existing
   authenticated/anon access and service_role CRUD must remain true. Existing RLS
   still decides which rows readers see. Verify browser direct mutation denial and
   protected Client/Admin create/edit/publish/unpublish/delete in staging, plus
   media save/reopen and atomic capacity tests. No production test data automatically.
5. Only after staging passes, capture fresh production preflight/rollback output
   and request separate production authorization. No SQL has been run here.

## Rollback

The generator emits transactional GRANT statements for exactly the original direct
mutation ACL entries, including quoted column identifiers and WITH GRANT OPTION.
It does not invent grants, alter SELECT, or restore unrelated ACLs. The migration
requires the same grantor/table owner so executing rollback as that owner preserves
provenance. Restore only against the reviewed post-migration state, before any
later ACL change; otherwise regenerate a reviewed recovery plan from the saved
ACL output. Rollback intentionally reopens the previous security bypass and is
an emergency compatibility measure, not normal operation. Failed migration
transactions roll back their revocations without requiring this recovery SQL.

## Compatibility and limits

- Browser card service mutations use protected APIs; SELECT helpers remain intact.
- Client delete derives the owner from Auth and uses the server admin client.
- Admin writes enforce Admin authorization and use the service-role client.
- Server write helpers require explicit trusted DB context; media/atomic/snapshot
  RPCs retain their original definitions and service-only execution boundaries.
- No migration can prove there are no unknown live SECURITY DEFINER functions or
  external consumers. Source audit covers the released repository; live preflight
  must review any additional privileged mutation surface or custom deployment.
- Static tests/model checks are not PostgreSQL execution tests. Actual DDL,
  inherited-role denial, rollback restoration, and RLS/API compatibility still
  require isolated staging verification before production.
