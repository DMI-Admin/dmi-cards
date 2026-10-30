import {requireBillingIdentity} from "@/lib/stripe/client-identity";
import {simpleBilling} from "@/lib/stripe/simple-billing";
import {apiSuccess,apiErrorFromUnknown} from "@/lib/api/responses";
export async function POST(request: Request){
 try{
  const user=await requireBillingIdentity(request);
  const session=await simpleBilling().portal(user.userId);
  return apiSuccess({url:session.url},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return apiErrorFromUnknown(error);}
}
