# Admin Clients functional split — local review

Two routes reuse the existing UI and protected APIs: `/clients/individual` and
`/clients/business`. `/clients` redirects to Individuals. Full lists retain the
existing modal with 25-record pagination; recent lists show the newest ten.
Inventory fetches are still paginated by the existing API helper then assembled
locally. Server-side filtered pagination can follow if inventory size requires it.

Individual legacy plan labels display Free/Pro (`paid` maps to Pro for display
only); the existing billing filter remains explicitly informational. These labels
never grant access. Business has no paid-plan creation control. Its API retains
legacy stored labels for compatibility, not a Business billing/seat model.

Canonical entitlement audit: `stripe/billing-state.ts` resolves trusted Stripe
subscription state/price, and `entitlements/plan-resolver.ts` transports the server
verdict. Free remains one card, Pro three. Existing client/profile labels are not
an entitlement grant. Complimentary Pro needs a separately reviewed server-side
grant source (with issuer/reason/expiry/revocation and precedence), likely an
additive grant table plus resolver changes. STOPPED/deferred that specific part;
no fake Stripe subscription or `complimentary_pro` plan is introduced.
TODO: Send Pro Subscription Link. Pro is visible but unavailable for manual creation.

Enterprise values remain in storage, APIs and entitlements for compatibility.
Business inventory includes them with a legacy label; new page/import creation
uses business only. No destructive removal or constraint change. Existing legacy
enterprise accounts remain readable; no new Enterprise selector is offered.
Groups/Sections and Business billing require separate model review and are deferred.

Bulk Company Import remains transactional companies-plus-staff creation, now only
in Business. Future location/semantics: Company → Staff → Bulk Staff Import.
No invitations, identity inference, payment actions or automatic subscriptions.
No media, template, Stripe webhook, middleware, ACL or schema changes.
