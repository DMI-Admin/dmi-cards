import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Exact reviewed presentation/checkout edits. No worker, receipt, Finance,
// Entitlement, activation or migration authority is excluded by this contract.
const reviewed={
  "src/lib/stripe/checkout.ts": "53dd9c6018a536033e570de70bd344ce811c50ca1a0781ebefc0ebe1a24b00ba",
  "src/app/api/stripe/checkout/route.ts": "596d4c1f6b0a28da9b66134dc22f721c8a925c7101b3b64b6d9ce40877b731e0",
  "src/app/api/v1/billing/checkout/route.ts": "c10160de34245a768cee5aed74c65cece37a735bc5851ddac4c9a7b179960622",
  "src/app/api/v1/billing/checkout/embedded/route.ts": "9c5e4b5ddf50eba3e7c43e9a40c2313e7d4a2b945100b8c0e6a7ecc536fdd663",
  "src/lib/stripe/embedded-checkout-config.ts": "95d2ce61c95bac71159e980b21b8e14a9250edeeda7daa4f6f8ecf430476dfea",
  "src/lib/stripe/embedded-checkout-response.ts": "da410f330200bbf841b300ed49d4d2fa48a2a83ddaef553c2a1a3c41bdfdf341",
  "src/lib/embedded-checkout-client.ts": "206b54426cc5f28982656fa30485e576b680923ccf454107a7a02635f9e9d570",
  "src/components/EmbeddedPayment.tsx": "0575f6a339643a8007b4ebdfe4ee42ca50400004c7806d7f28b44ffaa0ca25bf",
  "src/components/UpgradeToProModal.tsx": "0e319e6c7b86ea2e5eefbd67820b333d874cf78d9f2be2a1550cae318a33aaec",
  "src/app/client/billing/pay/page.tsx": "81e6e37167a3aa41e77393ec5d35293bb1c5fa7cd03b88dcb7f936f2a4d996d7"
};
export const embeddedCheckoutReviewedPaths=Object.keys(reviewed);
export function assertEmbeddedCheckoutFiles(read=fs.readFileSync){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file,'utf8')).digest('hex'),digest,'Unexpected checkout change: '+file);
}
