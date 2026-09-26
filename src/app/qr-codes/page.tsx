import { redirect } from "next/navigation";

// Retain the protected Admin URL for bookmarks; client QR tools are separate.
export default function QRCodesPage() {
  redirect("/cards");
}
