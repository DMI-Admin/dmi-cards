import { redirect } from "next/navigation";

export default function ClientQrRedirectPage() {
  redirect("/client/qr-code");
}
