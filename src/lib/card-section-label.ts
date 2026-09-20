const canonicalLabels: Record<string, string> = {
  personal: "Personal Details",
  company: "Company Details",
  contact: "Contact",
  social: "Social Links",
};
export function cardSectionLabel(key: string, explicitLabel?: string | null): string {
  const label = explicitLabel?.trim();
  if (label && label.toLowerCase() !== key.toLowerCase()) return label;
  return canonicalLabels[key] || key.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
