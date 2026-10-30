import {requireBillingIdentity} from "@/lib/stripe/client-identity";
import {simpleBilling} from "@/lib/stripe/simple-billing";
import {apiSuccess,apiError,apiErrorFromUnknown} from "@/lib/api/responses";
export async function POST(request: Request){
 try{
  const user=await requireBillingIdentity(request),body=await request.json();
  if(!body || Object.keys(body).some(k=>k!=='sessionId') || typeof body.sessionId!=='string' || !/^cs_[A-Za-z0-9_]+$/.test(body.sessionId))return apiError(400,'INVALID_REQUEST','A Checkout Session is required.');
  const billing=await simpleBilling().complete(user.userId,body.sessionId);
  return apiSuccess({plan:billing.plan},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return apiErrorFromUnknown(error);}
}
