import { requireBillingIdentity } from "@/lib/stripe/client-identity";
import { simpleBilling } from "@/lib/stripe/simple-billing";
import { apiSuccess,apiError,apiErrorFromUnknown } from "@/lib/api/responses";
export async function POST(request: Request) {
  try {
    const user=await requireBillingIdentity(request),body=await request.json();
    if(!body || Object.keys(body).some(k=>!['interval','requestId'].includes(k)) || !['monthly','annual'].includes(body.interval) || typeof body.requestId!=='string')return apiError(400,'INVALID_REQUEST','Choose Pro monthly or annual.');
    const session=await simpleBilling().checkout(user.userId,body.interval,body.requestId,{email:user.email,name:user.name});
    return apiSuccess({...session,publishableKey:process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error){return apiErrorFromUnknown(error);}
}
