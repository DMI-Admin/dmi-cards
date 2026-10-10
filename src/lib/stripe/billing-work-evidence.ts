import "server-only";
import {createHash} from "node:crypto";

// Private specification only: signature verification is a caller prerequisite.
// Never serialize work evidence to a browser, diagnostic, health report or AI input.
export const WORK_EVIDENCE_MAX_BYTES = 32768;
export const WORK_EVIDENCE_VERSION = 2;
type Schema = {type:string;nullable?:boolean;pattern?:string;enum?:readonly unknown[];minimum?:number;maximum?:number;properties?:Record<string,Schema>;required?:readonly string[];items?:Schema;maxItems?:number};
export const workEvidenceContract = {
  "groups": {
    "finance_checkout_session": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "checkout.session.completed"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "checkout_session"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^cs_[A-Za-z0-9_]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^cs_[A-Za-z0-9_]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_customer": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "customer.created"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "customer"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_subscription": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "subscription"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^sub_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "created": {
              "type": "integer",
              "minimum": 0,
              "maximum": 253402300799
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            },
            "items": {
              "type": "object",
              "properties": {
                "has_more": {
                  "type": "boolean"
                },
                "data": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "price": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "pattern": "^price_[A-Za-z0-9]{1,240}$"
                          }
                        },
                        "required": [
                          "id"
                        ]
                      }
                    },
                    "required": [
                      "price"
                    ]
                  },
                  "maxItems": 20
                }
              },
              "required": [
                "has_more",
                "data"
              ]
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_invoice": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "invoice.finalized",
            "invoice.updated",
            "invoice.paid",
            "invoice.payment_succeeded",
            "invoice.payment_failed",
            "invoice.voided",
            "invoice.marked_uncollectible"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "invoice"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^in_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^in_[A-Za-z0-9]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "subscription": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "parent": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "subscription_details",
                    "quote_details"
                  ]
                },
                "subscription_details": {
                  "type": "object",
                  "properties": {
                    "subscription": {
                      "type": "string",
                      "pattern": "^sub_[A-Za-z0-9]{1,240}$",
                      "nullable": true
                    }
                  },
                  "required": [
                    "subscription"
                  ]
                }
              },
              "required": [
                "type"
              ]
            },
            "lines": {
              "type": "object",
              "properties": {
                "has_more": {
                  "type": "boolean"
                },
                "data": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "price": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "pattern": "^price_[A-Za-z0-9]{1,240}$"
                          }
                        },
                        "required": [
                          "id"
                        ],
                        "nullable": true
                      }
                    },
                    "required": [
                      "price"
                    ]
                  },
                  "maxItems": 20
                }
              },
              "required": [
                "has_more",
                "data"
              ]
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_allocation": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "invoice_payment.paid"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "allocation"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^inpay_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^inpay_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_charge_captured": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.succeeded",
            "charge.captured"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "charge"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^ch_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^ch_[A-Za-z0-9]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "captured": {
              "type": "boolean"
            },
            "amount_captured": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "payment_intent": {
              "type": "string",
              "pattern": "^pi_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id",
            "status",
            "captured",
            "amount_captured"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_charge_failed": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.failed"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "charge"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^ch_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^ch_[A-Za-z0-9]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "captured": {
              "type": "boolean"
            },
            "amount_captured": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "payment_intent": {
              "type": "string",
              "pattern": "^pi_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "created": {
              "type": "integer",
              "minimum": 0,
              "maximum": 253402300799
            },
            "livemode": {
              "type": "boolean"
            },
            "currency": {
              "type": "string",
              "pattern": "^[a-z]{3}$"
            },
            "paid": {
              "type": "boolean"
            },
            "amount": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "amount_refunded": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "failure_code": {
              "type": "string",
              "enum": [
                "card_declined",
                "expired_card",
                "incorrect_cvc",
                "insufficient_funds",
                "processing_error",
                "authentication_required"
              ],
              "nullable": true
            }
          },
          "required": [
            "id",
            "created",
            "livemode",
            "currency",
            "status",
            "paid",
            "captured",
            "amount",
            "amount_captured",
            "amount_refunded",
            "customer",
            "payment_intent",
            "failure_code"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_charge": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.refunded"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "charge"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^ch_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^ch_[A-Za-z0-9]{1,240}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "captured": {
              "type": "boolean"
            },
            "amount_captured": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "payment_intent": {
              "type": "string",
              "pattern": "^pi_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "finance_refund": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "finance"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "finance_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.refund.updated",
            "refund.created",
            "refund.updated",
            "refund.failed"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "refund"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^re_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^re_[A-Za-z0-9]{1,240}$"
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "charge": {
              "type": "string",
              "pattern": "^ch_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        },
        "customer": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_checkout_session": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "checkout.session.completed"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "checkout_session"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^cs_[A-Za-z0-9_]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^cs_[A-Za-z0-9_]{1,240}$"
            },
            "namespace": {
              "type": "string",
              "enum": [
                "dmi_cards_v2",
                "none"
              ]
            },
            "dmi_user_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "dmi_profile_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "subscription": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "client_reference_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
              "nullable": true
            }
          },
          "required": [
            "id",
            "namespace"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_customer": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "customer.created"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "customer"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^cus_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_subscription": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "customer.subscription.created",
            "customer.subscription.updated"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "subscription"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^sub_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$"
            },
            "namespace": {
              "type": "string",
              "enum": [
                "dmi_cards_v2",
                "none"
              ]
            },
            "dmi_user_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "dmi_profile_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id",
            "namespace"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_subscription_deleted": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "customer.subscription.deleted"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "subscription"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^sub_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$"
            },
            "namespace": {
              "type": "string",
              "enum": [
                "dmi_cards_v2",
                "none"
              ]
            },
            "dmi_user_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "dmi_profile_id": {
              "type": "string",
              "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            },
            "customer": {
              "type": "string",
              "pattern": "^cus_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "livemode": {
              "type": "boolean"
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            },
            "items": {
              "type": "object",
              "properties": {
                "has_more": {
                  "type": "boolean"
                },
                "data": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "price": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "pattern": "^price_[A-Za-z0-9]{1,240}$"
                          }
                        },
                        "required": [
                          "id"
                        ]
                      },
                      "current_period_start": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 253402300799,
                        "nullable": true
                      },
                      "current_period_end": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 253402300799,
                        "nullable": true
                      }
                    },
                    "required": [
                      "price"
                    ]
                  },
                  "maxItems": 20
                }
              },
              "required": [
                "has_more",
                "data"
              ]
            },
            "trial_end": {
              "type": "integer",
              "minimum": 0,
              "maximum": 253402300799,
              "nullable": true
            },
            "ended_at": {
              "type": "integer",
              "minimum": 0,
              "maximum": 253402300799,
              "nullable": true
            },
            "latest_invoice": {
              "type": "string",
              "pattern": "^in_[A-Za-z0-9]{1,240}$",
              "nullable": true
            }
          },
          "required": [
            "id",
            "namespace",
            "customer",
            "livemode",
            "status",
            "cancel_at_period_end",
            "items",
            "trial_end",
            "ended_at",
            "latest_invoice"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_invoice": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "invoice.finalized",
            "invoice.updated",
            "invoice.paid",
            "invoice.payment_succeeded",
            "invoice.payment_failed",
            "invoice.voided",
            "invoice.marked_uncollectible"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "invoice"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^in_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^in_[A-Za-z0-9]{1,240}$"
            },
            "subscription": {
              "type": "string",
              "pattern": "^sub_[A-Za-z0-9]{1,240}$",
              "nullable": true
            },
            "parent": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "subscription_details",
                    "quote_details"
                  ]
                },
                "subscription_details": {
                  "type": "object",
                  "properties": {
                    "subscription": {
                      "type": "string",
                      "pattern": "^sub_[A-Za-z0-9]{1,240}$",
                      "nullable": true
                    }
                  },
                  "required": [
                    "subscription"
                  ]
                }
              },
              "required": [
                "type"
              ]
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_allocation": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "invoice_payment.paid"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "allocation"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^inpay_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^inpay_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_charge_captured": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.succeeded",
            "charge.failed",
            "charge.captured",
            "charge.refunded"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "charge"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^ch_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^ch_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    },
    "entitlement_refund": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "enum": [
            2
          ]
        },
        "consumer": {
          "type": "string",
          "enum": [
            "entitlement"
          ]
        },
        "consumer_version": {
          "type": "string",
          "enum": [
            "entitlement_v1"
          ]
        },
        "scope": {
          "type": "string",
          "pattern": "^acct_[A-Za-z0-9]{1,240}:(test|live)$"
        },
        "event_id": {
          "type": "string",
          "pattern": "^evt_[A-Za-z0-9]{1,240}$"
        },
        "event_type": {
          "type": "string",
          "enum": [
            "charge.refund.updated",
            "refund.created",
            "refund.updated",
            "refund.failed"
          ]
        },
        "event_created": {
          "type": "integer",
          "minimum": 0,
          "maximum": 253402300799
        },
        "api_version": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[a-z]+)?$",
          "nullable": true
        },
        "subject_type": {
          "type": "string",
          "enum": [
            "refund"
          ]
        },
        "subject_id": {
          "type": "string",
          "pattern": "^re_[A-Za-z0-9]{1,240}$"
        },
        "object": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^re_[A-Za-z0-9]{1,240}$"
            }
          },
          "required": [
            "id"
          ]
        },
        "previous": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "canceled",
                "incomplete",
                "incomplete_expired",
                "paused",
                "draft",
                "open",
                "paid",
                "void",
                "uncollectible",
                "succeeded",
                "failed",
                "pending",
                "requires_action"
              ]
            },
            "cancel_at_period_end": {
              "type": "boolean"
            }
          },
          "required": []
        }
      },
      "required": [
        "version",
        "consumer",
        "consumer_version",
        "scope",
        "event_id",
        "event_type",
        "event_created",
        "api_version",
        "subject_type",
        "subject_id",
        "object",
        "previous"
      ]
    }
  },
  "events": {
    "finance:checkout.session.completed": "finance_checkout_session",
    "finance:customer.created": "finance_customer",
    "finance:customer.subscription.created": "finance_subscription",
    "finance:customer.subscription.updated": "finance_subscription",
    "finance:customer.subscription.deleted": "finance_subscription",
    "finance:invoice.finalized": "finance_invoice",
    "finance:invoice.updated": "finance_invoice",
    "finance:invoice.paid": "finance_invoice",
    "finance:invoice.payment_succeeded": "finance_invoice",
    "finance:invoice.payment_failed": "finance_invoice",
    "finance:invoice.voided": "finance_invoice",
    "finance:invoice.marked_uncollectible": "finance_invoice",
    "finance:invoice_payment.paid": "finance_allocation",
    "finance:charge.succeeded": "finance_charge_captured",
    "finance:charge.failed": "finance_charge_failed",
    "finance:charge.captured": "finance_charge_captured",
    "finance:charge.refunded": "finance_charge",
    "finance:charge.refund.updated": "finance_refund",
    "finance:refund.created": "finance_refund",
    "finance:refund.updated": "finance_refund",
    "finance:refund.failed": "finance_refund",
    "entitlement:checkout.session.completed": "entitlement_checkout_session",
    "entitlement:customer.created": "entitlement_customer",
    "entitlement:customer.subscription.created": "entitlement_subscription",
    "entitlement:customer.subscription.updated": "entitlement_subscription",
    "entitlement:customer.subscription.deleted": "entitlement_subscription_deleted",
    "entitlement:invoice.finalized": "entitlement_invoice",
    "entitlement:invoice.updated": "entitlement_invoice",
    "entitlement:invoice.paid": "entitlement_invoice",
    "entitlement:invoice.payment_succeeded": "entitlement_invoice",
    "entitlement:invoice.payment_failed": "entitlement_invoice",
    "entitlement:invoice.voided": "entitlement_invoice",
    "entitlement:invoice.marked_uncollectible": "entitlement_invoice",
    "entitlement:invoice_payment.paid": "entitlement_allocation",
    "entitlement:charge.succeeded": "entitlement_charge_captured",
    "entitlement:charge.failed": "entitlement_charge_captured",
    "entitlement:charge.captured": "entitlement_charge_captured",
    "entitlement:charge.refunded": "entitlement_charge_captured",
    "entitlement:charge.refund.updated": "entitlement_refund",
    "entitlement:refund.created": "entitlement_refund",
    "entitlement:refund.updated": "entitlement_refund",
    "entitlement:refund.failed": "entitlement_refund"
  }
} as const;
export const workEvidenceSchemas: Record<string,Schema> = Object.fromEntries(Object.entries(workEvidenceContract.events).map(([key,group])=>[key,workEvidenceContract.groups[group] as unknown as Schema]));
export type WorkConsumer = "finance" | "entitlement";
export type VerifiedWorkEvent = {id:string;type:string;created:number;livemode:boolean;api_version?:string|null;account?:string;data:{object:Record<string,unknown>;previous_attributes?:Record<string,unknown>}};
export type WorkEvidence = {version:2;consumer:WorkConsumer;consumer_version:string;scope:string;event_id:string;event_type:string;event_created:number;api_version:string|null;subject_type:string;subject_id:string;object:Record<string,unknown>;previous:Record<string,unknown>;customer?:string};
export type EvidenceResult = {state:"prepared";evidence:WorkEvidence;digest:string}|{state:"rejected";reason:"unsupported_event"|"invalid_evidence"};
function shape(value:unknown,schema:Schema):boolean {
 if(value===null)return schema.nullable===true;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==="string")return typeof value==="string"&&(!schema.pattern||new RegExp(schema.pattern).test(value));
 if(schema.type==="integer")return typeof value==="number"&&Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER);
 if(schema.type==="boolean")return typeof value==="boolean";
 if(schema.type==="array")return Array.isArray(value)&&value.length<=(schema.maxItems??0)&&value.every(v=>shape(v,schema.items!));
 if(schema.type==="object")return !!value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(schema.properties!,k)&&shape((value as Record<string,unknown>)[k],schema.properties![k]))&&(schema.required??[]).every(k=>Object.hasOwn(value,k));
 return false;
}
// Exact PostgreSQL JSONB text representation for this closed ASCII/integer schema.
// Keys use byte length then byte order; arrays retain original order and duplicates.
export function canonicalWorkEvidence(value:unknown):string {
 if(Array.isArray(value))return "["+value.map(canonicalWorkEvidence).join(", ")+"]";
 if(value&&typeof value==="object")return "{"+Object.keys(value).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>JSON.stringify(k)+": "+canonicalWorkEvidence((value as Record<string,unknown>)[k])).join(", ")+"}";
 return JSON.stringify(value);
}
export function validateWorkEvidence(value:unknown):value is WorkEvidence {
 if(!value||typeof value!=="object")return false;
 const e=value as WorkEvidence,schema=workEvidenceSchemas[e.consumer+":"+e.event_type];
 if(!schema||!shape(value,schema)||Buffer.byteLength(canonicalWorkEvidence(value))>WORK_EVIDENCE_MAX_BYTES||e.subject_id!==e.object.id)return false;
 if(e.consumer==="finance"&&e.api_version!=="2023-10-16")return false;
 if(e.consumer==="finance"&&e.customer!==(typeof e.object.customer==="string"?e.object.customer:undefined))return false;
 if(e.event_type==="charge.failed"&&e.consumer==="finance"&&(e.object.status!=="failed"||e.object.paid!==false||e.object.amount_captured!==0||e.object.livemode!==e.scope.endsWith(":live")))return false;
 if(e.event_type==="customer.subscription.deleted"&&e.consumer==="entitlement"&&(e.object.status!=="canceled"||e.object.livemode!==e.scope.endsWith(":live")))return false;
 return true;
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("INVALID");return value as Record<string,unknown>;}
function identifier(value:unknown):unknown{return value===null||typeof value==="string"?value:record(value).id;}
export function prepareBillingWorkEvidence(scope:string,event:VerifiedWorkEvent,consumer:WorkConsumer):EvidenceResult {
 const schema=workEvidenceSchemas[consumer+":"+event.type];if(!schema)return {state:"rejected",reason:"unsupported_event"};
 try {
  if(typeof event.livemode!=="boolean"||event.livemode!==scope.endsWith(":live")||(event.account!==undefined&&event.account!==scope.split(":")[0]))throw Error("INVALID");
  const raw=record(event.data.object),object:Record<string,unknown>={},objectSchema=schema.properties!.object;
  for(const [key,field] of Object.entries(objectSchema.properties!)){
   if(["namespace","dmi_user_id","dmi_profile_id"].includes(key))continue;
   if(raw[key]===undefined)continue;
   if(["customer","subscription","charge","payment_intent","latest_invoice"].includes(key))object[key]=identifier(raw[key]);
   else if(key==="failure_code")object[key]=field.enum!.includes(raw[key])?raw[key]:null;
   else if(key==="items"||key==="lines"){
    const collection=record(raw[key]);if(!Array.isArray(collection.data)||collection.data.length>20)throw Error("INVALID");
    object[key]={has_more:collection.has_more,data:collection.data.map(value=>{
     const row=record(value),result:Record<string,unknown>={};
     if(row.price!==undefined)result.price=row.price===null?null:{id:identifier(row.price)};
     if(consumer==="entitlement")for(const period of ["current_period_start","current_period_end"])if(row[period]!==undefined)result[period]=row[period];
     return result;
    })};
   }else if(key==="parent"){
    if(raw.parent===null)continue;
    const p=record(raw.parent),out:Record<string,unknown>={type:p.type};
    if(p.subscription_details!==undefined)out.subscription_details={subscription:identifier(record(p.subscription_details).subscription)};
    object.parent=out;
   }else object[key]=raw[key];
  }
  if(Object.hasOwn(objectSchema.properties!,"namespace")){
   const metadata=raw.metadata==null?{}:record(raw.metadata);
   object.namespace=metadata.dmi_app==="dmi_cards_v2"?"dmi_cards_v2":"none";
   // Typed keys are extracted individually; arbitrary metadata is never retained.
   for(const key of ["dmi_user_id","dmi_profile_id"])if(metadata[key]!==undefined)object[key]=metadata[key];
  }
  if(consumer==="finance"&&event.type==="charge.failed"&&object.failure_code===undefined)object.failure_code=null;
  const previous:Record<string,unknown>={};
  if(consumer==="finance")for(const key of ["status","cancel_at_period_end"])if(event.data.previous_attributes?.[key]!==undefined)previous[key]=event.data.previous_attributes[key];
  const evidence={version:2 as const,consumer,consumer_version:consumer+"_v1",scope,event_id:event.id,event_type:event.type,event_created:event.created,api_version:event.api_version??null,subject_type:schema.properties!.subject_type.enum![0] as string,subject_id:object.id as string,object,previous,...(consumer==="finance"&&typeof object.customer==="string"?{customer:object.customer}:{})};
  if(raw.object!==undefined&&raw.object!==({checkout_session:"checkout.session",allocation:"invoice_payment"}[evidence.subject_type as "checkout_session"|"allocation"]??evidence.subject_type))throw Error("INVALID");
  if(!validateWorkEvidence(evidence))throw Error("INVALID");
  return {state:"prepared",evidence,digest:createHash("sha256").update(canonicalWorkEvidence(evidence)).digest("hex")};
 }catch{return {state:"rejected",reason:"invalid_evidence"};}
}
export function replayBillingWorkEvidence(evidence:WorkEvidence):VerifiedWorkEvent {
 if(!validateWorkEvidence(evidence))throw Error("BILLING_WORK_EVIDENCE_INVALID");
 const object=JSON.parse(JSON.stringify(evidence.object)) as Record<string,unknown>;
 if(evidence.consumer==="entitlement"&&Object.hasOwn(object,"namespace")){
  const metadata:Record<string,unknown>={};
  if(object.namespace==="dmi_cards_v2")metadata.dmi_app="dmi_cards_v2";
  for(const key of ["dmi_user_id","dmi_profile_id"])if(Object.hasOwn(object,key)){metadata[key]=object[key];delete object[key];}
  delete object.namespace;object.metadata=metadata;
 }
 return {id:evidence.event_id,type:evidence.event_type,created:evidence.event_created,api_version:evidence.api_version,livemode:evidence.scope.endsWith(":live"),data:{object,previous_attributes:{...evidence.previous}}};
}
