import {requireApiClient} from "@/lib/api/client-context";
import {apiSuccess,apiErrorFromUnknown} from "@/lib/api/responses";
export async function GET(request: Request){
 try{
  const client=await requireApiClient(request);
  return apiSuccess({plan:client.plan,source:client.planSource,billing:client.billing},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return apiErrorFromUnknown(error);}
}
