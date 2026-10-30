import 'server-only';
import {auth} from '@clerk/nextjs/server';
import {requireAdminAccess} from '@/lib/admin-auth';
import {createSupabaseAdminClient} from '@/lib/supabase-admin';
import {NextResponse} from 'next/server';
export async function readAdminSubscriptions(request: Request){
 const access=await requireAdminAccess(await auth());
 if(!access.authorized)return NextResponse.json({error:'Admin access required'},{status:403});
 const page=Number(new URL(request.url).searchParams.get('page')||1);
 if(!Number.isSafeInteger(page)||page<1||page>10000)return NextResponse.json({error:'Invalid page'},{status:400});
 const {data,error}=await createSupabaseAdminClient().from('account_billing')
  .select('account_id,plan,status,current_period_end,cancel_at_period_end,seat_quantity')
  .order('account_id').range((page-1)*50,page*50-1);
 return NextResponse.json(error?{error:'Billing inventory unavailable'}:{items:data,page},
  {status:error?503:200,headers:{'Cache-Control':'private, no-store'}});
}
