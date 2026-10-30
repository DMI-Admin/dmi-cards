import AdminShell from '@/components/admin/AdminShell';
export default function Finance(){
 const url=process.env.VERCEL_ENV==='production'?'https://dashboard.stripe.com/payments':'https://dashboard.stripe.com/test/payments';
 return <AdminShell><section className="p-8"><h1 className="text-3xl font-bold">Finance</h1><p className="my-6">Stripe is the source of truth for subscriptions, invoices, payments and refunds. DMI Cards stores only current account access.</p><a href={url} target="_blank" rel="noreferrer" className="underline">Open Stripe financial history</a></section></AdminShell>;
}
