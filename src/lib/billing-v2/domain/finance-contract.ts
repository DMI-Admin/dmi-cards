export const financeContract = {
  "finance_subscriptions": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "user_id",
      "stripe_customer_id",
      "status",
      "cancel_at_period_end",
      "cancel_at",
      "canceled_at",
      "ended_at",
      "trial_end",
      "collection_paused",
      "linkage_status",
      "valuation_status",
      "valuation_reason",
      "items_complete",
      "discount_context"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision"
    ]
  },
  "finance_subscription_items": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "stripe_subscription_id",
      "stripe_price_id",
      "stripe_product_id",
      "currency",
      "quantity",
      "unit_amount_minor",
      "unit_amount_decimal_minor",
      "recurring_interval",
      "interval_count",
      "usage_type",
      "billing_scheme",
      "tax_behavior",
      "period_start",
      "period_end",
      "effective_cycle_amount_minor",
      "valuation_status",
      "valuation_reason",
      "discount_context",
      "removed_at",
      "forecast_tax_evidence"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision",
      "quantity",
      "unit_amount_minor",
      "unit_amount_decimal_minor",
      "effective_cycle_amount_minor"
    ]
  },
  "invoices": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "stripe_customer_id",
      "stripe_subscription_id",
      "number",
      "status",
      "billing_reason",
      "collection_method",
      "currency",
      "subtotal_minor",
      "discount_minor",
      "tax_minor",
      "total_minor",
      "amount_due_minor",
      "amount_paid_minor",
      "amount_remaining_minor",
      "attempt_count",
      "due_at",
      "next_payment_attempt_at",
      "finalized_at",
      "paid_at",
      "voided_at",
      "marked_uncollectible_at",
      "payments_complete",
      "tax_evidence",
      "ownership_state",
      "ownership_revision",
      "ownership_provenance"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision",
      "subtotal_minor",
      "discount_minor",
      "tax_minor",
      "total_minor",
      "amount_due_minor",
      "amount_paid_minor",
      "amount_remaining_minor",
      "ownership_revision"
    ]
  },
  "payments": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "stripe_customer_id",
      "stripe_payment_intent_id",
      "currency",
      "status",
      "amount_minor",
      "amount_captured_minor",
      "amount_refunded_minor",
      "paid",
      "captured",
      "collected_at",
      "collection_time_basis",
      "attribution_status"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision",
      "amount_minor",
      "amount_captured_minor",
      "amount_refunded_minor"
    ]
  },
  "invoice_payments": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "stripe_invoice_id",
      "stripe_payment_intent_id",
      "stripe_charge_id",
      "payment_type",
      "currency",
      "status",
      "amount_requested_minor",
      "amount_paid_minor",
      "paid_at",
      "canceled_at"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision",
      "amount_requested_minor",
      "amount_paid_minor"
    ]
  },
  "refunds": {
    "columns": [
      "stripe_scope",
      "stripe_object_id",
      "stripe_created_at",
      "source_event_id",
      "source_event_created_at",
      "stripe_api_version",
      "normalizer_version",
      "revision",
      "verified_at",
      "created_at",
      "updated_at",
      "stripe_charge_id",
      "stripe_payment_intent_id",
      "currency",
      "amount_minor",
      "status",
      "reason",
      "failure_reason",
      "succeeded_at",
      "success_time_basis"
    ],
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "immutable": [
      "stripe_scope",
      "stripe_object_id",
      "created_at"
    ],
    "money": [
      "revision",
      "amount_minor"
    ]
  },
  "payment_attempts": {
    "columns": [
      "stripe_scope",
      "attempt_key",
      "stripe_customer_id",
      "stripe_invoice_id",
      "stripe_payment_intent_id",
      "stripe_charge_id",
      "currency",
      "amount_minor",
      "occurred_at",
      "failure_code",
      "evidence_type",
      "source_event_id",
      "stripe_api_version",
      "normalizer_version",
      "verified_at",
      "created_at",
      "updated_at"
    ],
    "pk": [
      "stripe_scope",
      "attempt_key"
    ],
    "immutable": [
      "stripe_scope",
      "attempt_key",
      "created_at"
    ],
    "money": [
      "amount_minor"
    ]
  },
  "finance_activity": {
    "columns": [
      "stripe_scope",
      "activity_key",
      "kind",
      "stripe_customer_id",
      "stripe_subscription_id",
      "object_type",
      "object_id",
      "occurred_at",
      "amount_minor",
      "currency",
      "effective_at",
      "source_event_id",
      "origin",
      "source_revision",
      "created_at",
      "updated_at"
    ],
    "pk": [
      "stripe_scope",
      "activity_key"
    ],
    "immutable": [
      "stripe_scope",
      "activity_key",
      "created_at"
    ],
    "money": [
      "amount_minor",
      "source_revision"
    ]
  }
} as const;

export const tableContracts = {
  "accounts": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "id": {
        "nullable": false,
        "type": "uuid"
      },
      "principal_kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "individual",
          "business",
          "unresolved"
        ]
      },
      "principal_id": {
        "nullable": true,
        "type": "uuid"
      },
      "stripe_customer_id": {
        "nullable": true,
        "type": "text"
      },
      "binding_state": {
        "nullable": false,
        "type": "text",
        "enum": [
          "unresolved",
          "verified",
          "conflict"
        ]
      },
      "binding_revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "id"
    ],
    "fks": []
  },
  "checkout_attempts": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "id": {
        "nullable": false,
        "type": "uuid"
      },
      "billing_account_id": {
        "nullable": false,
        "type": "uuid"
      },
      "operation_kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "create_customer",
          "create_session",
          "update_subscription"
        ]
      },
      "presentation": {
        "nullable": true,
        "type": "text",
        "enum": [
          "hosted",
          "embedded"
        ]
      },
      "idempotency_key": {
        "nullable": false,
        "type": "text"
      },
      "parameters": {
        "nullable": false,
        "type": "jsonb"
      },
      "parameters_digest": {
        "nullable": false,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "prepared",
          "in_flight",
          "succeeded",
          "ambiguous",
          "attention"
        ]
      },
      "provider_object_id": {
        "nullable": true,
        "type": "text"
      },
      "attempted_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "resolved_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "replay_deadline": {
        "nullable": false,
        "type": "timestamptz"
      },
      "lease_token": {
        "nullable": true,
        "type": "uuid"
      },
      "lease_until": {
        "nullable": true,
        "type": "timestamptz"
      },
      "claim_generation": {
        "nullable": false,
        "type": "bigint"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "billing_account_id"
        ],
        "table": "accounts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "price_catalog": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_price_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_product_id": {
        "nullable": true,
        "type": "text"
      },
      "application_key": {
        "nullable": false,
        "type": "text"
      },
      "plan": {
        "nullable": false,
        "type": "text",
        "enum": [
          "pro"
        ]
      },
      "billing_interval": {
        "nullable": false,
        "type": "text",
        "enum": [
          "monthly",
          "annual"
        ]
      },
      "entitlement_enabled": {
        "nullable": false,
        "type": "boolean"
      },
      "checkout_enabled": {
        "nullable": false,
        "type": "boolean"
      },
      "ownership_state": {
        "nullable": false,
        "type": "text",
        "enum": [
          "active",
          "revoked"
        ]
      },
      "ownership_basis": {
        "nullable": false,
        "type": "text",
        "enum": [
          "price_owner"
        ]
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "application_active": {
        "nullable": false,
        "type": "boolean"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_price_id"
    ],
    "fks": []
  },
  "subscriptions": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_subscription_id": {
        "nullable": false,
        "type": "text"
      },
      "billing_account_id": {
        "nullable": false,
        "type": "uuid"
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_price_id": {
        "nullable": true,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "active",
          "trialing",
          "past_due",
          "unpaid",
          "canceled",
          "incomplete",
          "incomplete_expired",
          "paused",
          "unknown"
        ]
      },
      "plan": {
        "nullable": false,
        "type": "text",
        "enum": [
          "free",
          "pro"
        ]
      },
      "cancel_at_period_end": {
        "nullable": false,
        "type": "boolean"
      },
      "period_start": {
        "nullable": true,
        "type": "timestamptz"
      },
      "period_end": {
        "nullable": true,
        "type": "timestamptz"
      },
      "trial_end": {
        "nullable": true,
        "type": "timestamptz"
      },
      "ended_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "latest_invoice_id": {
        "nullable": true,
        "type": "text"
      },
      "terminal": {
        "nullable": false,
        "type": "boolean"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "last_event_created": {
        "nullable": true,
        "type": "bigint"
      },
      "last_event_id": {
        "nullable": true,
        "type": "text"
      },
      "snapshot_digest": {
        "nullable": false,
        "type": "text"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_subscription_id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "billing_account_id"
        ],
        "table": "accounts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "event_inbox": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "id": {
        "nullable": false,
        "type": "uuid"
      },
      "source_kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "webhook",
          "reconciliation",
          "recovery"
        ]
      },
      "source_id": {
        "nullable": false,
        "type": "text"
      },
      "task_kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "access",
          "finance"
        ]
      },
      "stripe_event_id": {
        "nullable": true,
        "type": "text"
      },
      "event_type": {
        "nullable": true,
        "type": "text"
      },
      "event_created": {
        "nullable": true,
        "type": "bigint"
      },
      "evidence_version": {
        "nullable": false,
        "type": "integer"
      },
      "evidence": {
        "nullable": false,
        "type": "jsonb"
      },
      "evidence_digest": {
        "nullable": false,
        "type": "text"
      },
      "billing_account_id": {
        "nullable": true,
        "type": "uuid"
      },
      "state": {
        "nullable": false,
        "type": "text",
        "enum": [
          "queued",
          "processing",
          "retry_wait",
          "dependency_wait",
          "completed",
          "needs_attention"
        ]
      },
      "available_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "arrival_sequence": {
        "nullable": false,
        "type": "bigint"
      },
      "dependency_kind": {
        "nullable": true,
        "type": "text",
        "enum": [
          "account_binding",
          "subscription",
          "invoice",
          "payment",
          "ownership_provenance"
        ]
      },
      "dependency_reference": {
        "nullable": true,
        "type": "text"
      },
      "lease_token": {
        "nullable": true,
        "type": "uuid"
      },
      "lease_until": {
        "nullable": true,
        "type": "timestamptz"
      },
      "claim_generation": {
        "nullable": false,
        "type": "bigint"
      },
      "authority_generation": {
        "nullable": true,
        "type": "bigint"
      },
      "writer_engine": {
        "nullable": true,
        "type": "text",
        "enum": [
          "shadow"
        ]
      },
      "processing_started_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "claim_count": {
        "nullable": false,
        "type": "bigint"
      },
      "failure_count": {
        "nullable": false,
        "type": "integer"
      },
      "first_failure_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "retry_deadline": {
        "nullable": true,
        "type": "timestamptz"
      },
      "failure_category": {
        "nullable": true,
        "type": "text"
      },
      "result": {
        "nullable": true,
        "type": "text",
        "enum": [
          "processed",
          "ignored",
          "unchanged",
          "stale_ignored",
          "terminal_ignored"
        ]
      },
      "completed_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "projection_revision": {
        "nullable": true,
        "type": "bigint"
      },
      "projection_digest": {
        "nullable": true,
        "type": "text"
      },
      "run_id": {
        "nullable": true,
        "type": "uuid"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "billing_account_id"
        ],
        "table": "accounts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "run_id"
        ],
        "table": "operations",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "authority": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "domain": {
        "nullable": false,
        "type": "text",
        "enum": [
          "access",
          "finance",
          "reconciliation",
          "migration"
        ]
      },
      "resource_key": {
        "nullable": false,
        "type": "text"
      },
      "billing_account_id": {
        "nullable": true,
        "type": "uuid"
      },
      "writer_engine": {
        "nullable": false,
        "type": "text",
        "enum": [
          "shadow"
        ]
      },
      "mode": {
        "nullable": false,
        "type": "text",
        "enum": [
          "shadow_only"
        ]
      },
      "generation": {
        "nullable": false,
        "type": "bigint"
      },
      "inbox_task_id": {
        "nullable": true,
        "type": "uuid"
      },
      "checkout_attempt_id": {
        "nullable": true,
        "type": "uuid"
      },
      "handover_from": {
        "nullable": true,
        "type": "text"
      },
      "handover_started_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "handover_completed_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "last_completed_operation_id": {
        "nullable": true,
        "type": "uuid"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "domain",
      "resource_key"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "billing_account_id"
        ],
        "table": "accounts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "inbox_task_id"
        ],
        "table": "event_inbox",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "checkout_attempt_id"
        ],
        "table": "checkout_attempts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "last_completed_operation_id"
        ],
        "table": "operations",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "operations": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "id": {
        "nullable": false,
        "type": "uuid"
      },
      "record_type": {
        "nullable": false,
        "type": "text",
        "enum": [
          "run",
          "audit"
        ]
      },
      "operation_kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "subscription_sync",
          "finance_projection",
          "checkout",
          "ownership_change",
          "handover",
          "subscription_reconciliation",
          "finance_reconciliation",
          "recovery",
          "backfill",
          "shadow_comparison"
        ]
      },
      "parent_run_id": {
        "nullable": true,
        "type": "uuid"
      },
      "source_kind": {
        "nullable": false,
        "type": "text"
      },
      "source_id": {
        "nullable": false,
        "type": "text"
      },
      "billing_account_id": {
        "nullable": true,
        "type": "uuid"
      },
      "task_id": {
        "nullable": true,
        "type": "uuid"
      },
      "status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "planned",
          "running",
          "partial",
          "completed",
          "failed",
          "suspended"
        ]
      },
      "outcome": {
        "nullable": true,
        "type": "text"
      },
      "authority_generation": {
        "nullable": true,
        "type": "bigint"
      },
      "before_revision": {
        "nullable": true,
        "type": "bigint"
      },
      "after_revision": {
        "nullable": true,
        "type": "bigint"
      },
      "cursor": {
        "nullable": true,
        "type": "jsonb"
      },
      "coverage": {
        "nullable": true,
        "type": "jsonb"
      },
      "facts": {
        "nullable": false,
        "type": "jsonb"
      },
      "started_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "completed_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "billing_account_id"
        ],
        "table": "accounts",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "parent_run_id"
        ],
        "table": "operations",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "task_id"
        ],
        "table": "event_inbox",
        "references": [
          "stripe_scope",
          "id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "finance_subscriptions": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "user_id": {
        "nullable": true,
        "type": "uuid"
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text"
      },
      "cancel_at_period_end": {
        "nullable": false,
        "type": "boolean"
      },
      "cancel_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "canceled_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "ended_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "trial_end": {
        "nullable": true,
        "type": "timestamptz"
      },
      "collection_paused": {
        "nullable": false,
        "type": "boolean"
      },
      "linkage_status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "verified",
          "unresolved",
          "conflict"
        ]
      },
      "valuation_status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "complete",
          "unsupported",
          "incomplete"
        ]
      },
      "valuation_reason": {
        "nullable": true,
        "type": "text"
      },
      "items_complete": {
        "nullable": false,
        "type": "boolean"
      },
      "discount_context": {
        "nullable": false,
        "type": "jsonb"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": []
  },
  "finance_subscription_items": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "stripe_subscription_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_price_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_product_id": {
        "nullable": false,
        "type": "text"
      },
      "currency": {
        "nullable": false,
        "type": "text"
      },
      "quantity": {
        "nullable": true,
        "type": "bigint"
      },
      "unit_amount_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "unit_amount_decimal_minor": {
        "nullable": true,
        "type": "numeric(38,12)"
      },
      "recurring_interval": {
        "nullable": false,
        "type": "text",
        "enum": [
          "day",
          "week",
          "month",
          "year"
        ]
      },
      "interval_count": {
        "nullable": false,
        "type": "integer"
      },
      "usage_type": {
        "nullable": false,
        "type": "text"
      },
      "billing_scheme": {
        "nullable": false,
        "type": "text"
      },
      "tax_behavior": {
        "nullable": false,
        "type": "text"
      },
      "period_start": {
        "nullable": true,
        "type": "timestamptz"
      },
      "period_end": {
        "nullable": true,
        "type": "timestamptz"
      },
      "effective_cycle_amount_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "valuation_status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "complete",
          "unsupported",
          "incomplete"
        ]
      },
      "valuation_reason": {
        "nullable": true,
        "type": "text"
      },
      "discount_context": {
        "nullable": false,
        "type": "jsonb"
      },
      "removed_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "forecast_tax_evidence": {
        "nullable": false,
        "type": "jsonb"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_subscription_id"
        ],
        "table": "finance_subscriptions",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "invoices": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_subscription_id": {
        "nullable": true,
        "type": "text"
      },
      "number": {
        "nullable": true,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text"
      },
      "billing_reason": {
        "nullable": true,
        "type": "text"
      },
      "collection_method": {
        "nullable": false,
        "type": "text"
      },
      "currency": {
        "nullable": false,
        "type": "text"
      },
      "subtotal_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "discount_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "tax_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "total_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_due_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_paid_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_remaining_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "attempt_count": {
        "nullable": false,
        "type": "integer"
      },
      "due_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "next_payment_attempt_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "finalized_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "paid_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "voided_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "marked_uncollectible_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "payments_complete": {
        "nullable": false,
        "type": "boolean"
      },
      "tax_evidence": {
        "nullable": false,
        "type": "jsonb"
      },
      "ownership_state": {
        "nullable": false,
        "type": "text",
        "enum": [
          "proven",
          "unresolved",
          "conflict",
          "foreign"
        ]
      },
      "ownership_revision": {
        "nullable": false,
        "type": "bigint"
      },
      "ownership_provenance": {
        "nullable": false,
        "type": "jsonb"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_subscription_id"
        ],
        "table": "finance_subscriptions",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "payments": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_payment_intent_id": {
        "nullable": true,
        "type": "text"
      },
      "currency": {
        "nullable": false,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text"
      },
      "amount_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_captured_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_refunded_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "paid": {
        "nullable": false,
        "type": "boolean"
      },
      "captured": {
        "nullable": false,
        "type": "boolean"
      },
      "collected_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "collection_time_basis": {
        "nullable": false,
        "type": "text",
        "enum": [
          "verified_event",
          "invoice_payment",
          "automatic_capture_created",
          "unknown"
        ]
      },
      "attribution_status": {
        "nullable": false,
        "type": "text",
        "enum": [
          "verified",
          "unresolved",
          "mixed"
        ]
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": []
  },
  "invoice_payments": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "stripe_invoice_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_payment_intent_id": {
        "nullable": true,
        "type": "text"
      },
      "stripe_charge_id": {
        "nullable": true,
        "type": "text"
      },
      "payment_type": {
        "nullable": false,
        "type": "text"
      },
      "currency": {
        "nullable": false,
        "type": "text"
      },
      "status": {
        "nullable": false,
        "type": "text"
      },
      "amount_requested_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "amount_paid_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "paid_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "canceled_at": {
        "nullable": true,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_invoice_id"
        ],
        "table": "invoices",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "stripe_charge_id"
        ],
        "table": "payments",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "refunds": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "stripe_object_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "source_event_created_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "revision": {
        "nullable": false,
        "type": "bigint"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "stripe_charge_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_payment_intent_id": {
        "nullable": true,
        "type": "text"
      },
      "currency": {
        "nullable": false,
        "type": "text"
      },
      "amount_minor": {
        "nullable": false,
        "type": "bigint"
      },
      "status": {
        "nullable": false,
        "type": "text"
      },
      "reason": {
        "nullable": true,
        "type": "text"
      },
      "failure_reason": {
        "nullable": true,
        "type": "text"
      },
      "succeeded_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "success_time_basis": {
        "nullable": false,
        "type": "text",
        "enum": [
          "verified_event",
          "unknown"
        ]
      }
    },
    "pk": [
      "stripe_scope",
      "stripe_object_id"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_charge_id"
        ],
        "table": "payments",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "payment_attempts": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "attempt_key": {
        "nullable": false,
        "type": "text"
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_invoice_id": {
        "nullable": true,
        "type": "text"
      },
      "stripe_payment_intent_id": {
        "nullable": true,
        "type": "text"
      },
      "stripe_charge_id": {
        "nullable": true,
        "type": "text"
      },
      "currency": {
        "nullable": true,
        "type": "text"
      },
      "amount_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "occurred_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "failure_code": {
        "nullable": true,
        "type": "text"
      },
      "evidence_type": {
        "nullable": false,
        "type": "text"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "stripe_api_version": {
        "nullable": false,
        "type": "text"
      },
      "normalizer_version": {
        "nullable": false,
        "type": "integer"
      },
      "verified_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "attempt_key"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_invoice_id"
        ],
        "table": "invoices",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      },
      {
        "columns": [
          "stripe_scope",
          "stripe_charge_id"
        ],
        "table": "payments",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  },
  "finance_activity": {
    "columns": {
      "stripe_scope": {
        "nullable": false,
        "type": "text"
      },
      "activity_key": {
        "nullable": false,
        "type": "text"
      },
      "kind": {
        "nullable": false,
        "type": "text",
        "enum": [
          "subscription_created",
          "cancellation_scheduled",
          "cancellation_reversed",
          "subscription_ended",
          "invoice_paid",
          "payment_failed",
          "refund_issued"
        ]
      },
      "stripe_customer_id": {
        "nullable": false,
        "type": "text"
      },
      "stripe_subscription_id": {
        "nullable": true,
        "type": "text"
      },
      "object_type": {
        "nullable": false,
        "type": "text"
      },
      "object_id": {
        "nullable": false,
        "type": "text"
      },
      "occurred_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "amount_minor": {
        "nullable": true,
        "type": "bigint"
      },
      "currency": {
        "nullable": true,
        "type": "text"
      },
      "effective_at": {
        "nullable": true,
        "type": "timestamptz"
      },
      "source_event_id": {
        "nullable": true,
        "type": "text"
      },
      "origin": {
        "nullable": false,
        "type": "text",
        "enum": [
          "webhook",
          "backfill",
          "reconciliation"
        ]
      },
      "source_revision": {
        "nullable": true,
        "type": "bigint"
      },
      "created_at": {
        "nullable": false,
        "type": "timestamptz"
      },
      "updated_at": {
        "nullable": false,
        "type": "timestamptz"
      }
    },
    "pk": [
      "stripe_scope",
      "activity_key"
    ],
    "fks": [
      {
        "columns": [
          "stripe_scope",
          "stripe_subscription_id"
        ],
        "table": "finance_subscriptions",
        "references": [
          "stripe_scope",
          "stripe_object_id"
        ],
        "on_delete": "RESTRICT",
        "deferrable": true,
        "initially_deferred": true
      }
    ]
  }
} as const;
