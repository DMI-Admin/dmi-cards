import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Exact reviewed presentation/checkout edits. No worker, receipt, Finance,
// Entitlement, activation or migration authority is excluded by this contract.
const reviewed={
  "src/lib/embedded-stripe-loader.ts": "7de7d38b825d03f5142b59618e0d4bf4458f808d61ee43a90854f98daf02ad73",
  "src/app/client/billing/pay/PaymentClient.tsx": "dab76db358f57cfebfb47260120119adb631573ac0ad4fd1b210b9d9d8253679",
  "src/lib/stripe/checkout.ts": "f99f2c0012ed682c628d5e85ef1f59eaa652bd23afc3087c55329fe55a5f8c91",
  "src/lib/checkout-startup-timing.ts": "3600cc090c914b62e557e3d39af01f3fe2d0c1c56d737eba403dd1118ff076b6",
  "src/app/api/stripe/checkout/route.ts": "596d4c1f6b0a28da9b66134dc22f721c8a925c7101b3b64b6d9ce40877b731e0",
  "src/app/api/v1/billing/checkout/route.ts": "c10160de34245a768cee5aed74c65cece37a735bc5851ddac4c9a7b179960622",
  "src/app/api/v1/billing/checkout/embedded/route.ts": "b587052c976b5f485d07b62f9148aca75b97553329419cbdf8da17d3b798b866",
  "src/lib/stripe/embedded-checkout-config.ts": "95d2ce61c95bac71159e980b21b8e14a9250edeeda7daa4f6f8ecf430476dfea",
  "src/lib/stripe/embedded-checkout-response.ts": "da410f330200bbf841b300ed49d4d2fa48a2a83ddaef553c2a1a3c41bdfdf341",
  "src/lib/embedded-checkout-client.ts": "53dc1d4612708985acd5627ae31661e3933b792b7e9d2aff00dda434a79b3d70",
  "src/components/EmbeddedPayment.tsx": "de100beb0f141607b63cdee66d17a1425124c47137a7e4e6f33b92fee58e7aa1",
  "src/components/UpgradeToProModal.tsx": "0e319e6c7b86ea2e5eefbd67820b333d874cf78d9f2be2a1550cae318a33aaec",
  "src/app/client/billing/pay/page.tsx": "01309feaff1e62a484115b3af6bdccf8b2bf0c17b9b61811f5ed07003e4dad52"
};
export const embeddedCheckoutReviewedPaths=Object.keys(reviewed);
export function assertEmbeddedCheckoutFiles(read=fs.readFileSync){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file,'utf8')).digest('hex'),digest,'Unexpected checkout change: '+file);
}
