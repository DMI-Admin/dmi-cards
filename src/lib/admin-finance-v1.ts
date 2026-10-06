// Browser-safe DTOs only; all reads and calculations are server-side.
export const financeViews=['new_customers','invoices','upcoming','failed','cancelled','refunds'] as const;
export type FinanceView=typeof financeViews[number];
export type FinanceV1Row={id:string;client:{name:string|null;email:string|null}|null;linked:boolean;date:string|null;started:string|null;status:string;plan:string|null;reference:string|null;amount:string|null;currency:string|null;vat:string|null;net:string|null;interval:string|null;intervalCount:number|null;attempts:string|null;nextRetry:string|null;reason:string|null;finalPayment:{amount:string|null;currency:string|null;date:string|null}|null};
export type FinanceMonth={label:string;newCustomers:string;invoiceCount:string;gross:string|null;vat:string|null;net:string|null;failedPayments:string;cancelledCustomers:string;refunds:string};
export type FinanceV1Report={items:FinanceV1Row[];nextCursor:string|null;months:FinanceMonth[];activePaidCustomers:string;recoveryCustomers:string;undatedInvoices:string;undatedRefunds:string;basis:'observed_finance_history';asOf:string};
