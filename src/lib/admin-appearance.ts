// Appearance routing only. This is not an authorization boundary.
export const adminAppearanceKey = "dmi-admin-appearance";
export type AdminAppearance = "system" | "light" | "dark";
export const adminAppearancePaths = ["admin", "dashboard", "clients", "templates", "cards", "public-pages", "qr-codes", "subscriptions", "finance", "analytics", "uploads", "support", "audit-logs", "system-health", "settings", "security"];
export function isAdminAppearancePath(pathname: string) {
  return adminAppearancePaths.includes(pathname.split("/")[1]);
}
export function normalizeAdminAppearance(value: string | null): AdminAppearance {
  return value === "light" || value === "dark" ? value : "system";
}
// Runs before paint; intentionally never reads/writes the Client Portal's dmi-theme.
export const adminAppearanceBootstrap = `(()=>{if(!${JSON.stringify(adminAppearancePaths)}.includes(location.pathname.split('/')[1]))return;let v='system';try{v=localStorage.getItem('${adminAppearanceKey}')}catch{}document.documentElement.dataset.adminAppearance=v==='light'||v==='dark'?v:'system'})()`;
