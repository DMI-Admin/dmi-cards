import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Exact reviewed presentation/checkout edits. No worker, receipt, Finance,
// Entitlement, activation or migration authority is excluded by this contract.
const reviewed={
  "src/lib/stripe/checkout.ts": "192f83bc724ec53d5c46301d645df97c30592326dcff172543865a785891a811",
  "src/lib/checkout-startup-timing.ts": "82f0ba25d354ae94f4cb307aeacdbdd862570536586bf7071ff80fb4f1a33411",
  "src/app/api/stripe/checkout/route.ts": "596d4c1f6b0a28da9b66134dc22f721c8a925c7101b3b64b6d9ce40877b731e0",
  "src/app/api/v1/billing/checkout/route.ts": "c10160de34245a768cee5aed74c65cece37a735bc5851ddac4c9a7b179960622",
  "src/app/api/v1/billing/checkout/embedded/route.ts": "b587052c976b5f485d07b62f9148aca75b97553329419cbdf8da17d3b798b866",
  "src/lib/stripe/embedded-checkout-config.ts": "95d2ce61c95bac71159e980b21b8e14a9250edeeda7daa4f6f8ecf430476dfea",
  "src/lib/stripe/embedded-checkout-response.ts": "da410f330200bbf841b300ed49d4d2fa48a2a83ddaef553c2a1a3c41bdfdf341",
  "src/lib/embedded-checkout-client.ts": "53dc1d4612708985acd5627ae31661e3933b792b7e9d2aff00dda434a79b3d70",
  "src/components/EmbeddedPayment.tsx": "35d1f996595561cb49d504e700a7b0835865c2494f326c30ad1e9e75b14af561",
  "src/components/UpgradeToProModal.tsx": "0e319e6c7b86ea2e5eefbd67820b333d874cf78d9f2be2a1550cae318a33aaec",
  "src/app/client/billing/pay/page.tsx": "fbf163b23945cdd7db659356af1f6df9c551a595554d4cd96f1b8914a3a351ce"
};
export const embeddedCheckoutReviewedPaths=Object.keys(reviewed);
export function assertEmbeddedCheckoutFiles(read=fs.readFileSync){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file,'utf8')).digest('hex'),digest,'Unexpected checkout change: '+file);
}
