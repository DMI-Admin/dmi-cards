'use client';
import AdminShell from '@/components/admin/AdminShell';
import {useEffect,useState} from 'react';
type Row={account_id:string;plan:string;status:string;seat_quantity:number;current_period_end:string|null;cancel_at_period_end:boolean};
export default function Subscriptions(){
 const [rows,setRows]=useState<Row[]>([]),[page,setPage]=useState(1),[error,setError]=useState(false);
 useEffect(()=>{let active=true;void fetch(`/api/admin/subscriptions?page=${page}`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(r=>{if(active){setRows(r.items);setError(false);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[page]);
 return <AdminShell><section className="p-8"><h1 className="text-3xl font-bold">Subscriptions</h1><p className="my-4">Current DMI access. Financial history is authoritative in Stripe.</p>
  {error?<p role="alert">Subscription inventory is unavailable.</p>:<div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Account','Plan','Stripe status','Seats','Period end'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.account_id}><td className="p-3">{r.account_id}</td><td>{r.plan}</td><td>{r.status}{r.cancel_at_period_end?' (ending)':''}</td><td>{r.seat_quantity}</td><td>{r.current_period_end?new Date(r.current_period_end).toLocaleDateString('en-GB'):'—'}</td></tr>)}</tbody></table></div>}
  <div className="mt-6 flex gap-6"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button disabled={rows.length<50} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 </section></AdminShell>;
}
