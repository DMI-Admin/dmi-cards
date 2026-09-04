import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
  searchText: string;
};

export const defaultPhoneCountry: CountryCode = "GB";

const countryNameFormatter =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export const phoneCountryOptions: PhoneCountryOption[] = getCountries()
  .map((code) => {
    const name = countryNameFormatter?.of(code) || code;
    const dialCode = countryDialCode(code);
    const flag = countryFlag(code);

    return {
      code,
      name,
      dialCode,
      flag,
      searchText: `${name} ${code} ${dialCode} ${dialCode.replace("+", "")}`.toLowerCase(),
    };
  })
  .sort((left, right) => {
    if (left.code === defaultPhoneCountry) return -1;
    if (right.code === defaultPhoneCountry) return 1;

    return left.name.localeCompare(right.name);
  });

export function countryDialCode(country: CountryCode) {
  return `+${getCountryCallingCode(country)}`;
}

export function countryFlag(country: CountryCode) {
  return country
    .toUpperCase()
    .replace(/./g, (character) =>
      String.fromCodePoint(127397 + character.charCodeAt(0))
    );
}

export function normalizeInternationalPhoneNumber(
  value: string | null | undefined,
  defaultCountry: CountryCode = defaultPhoneCountry
) {
  const input = value?.trim() || "";
  if (!input) return null;

  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  if (parsed?.isValid()) return parsed.number;

  const compact = input.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) {
    const international = parsePhoneNumberFromString(`+${compact.slice(2)}`);
    if (international?.isValid()) return international.number;
  }

  return null;
}

export function phoneNumberForWhatsApp(
  value: string | null | undefined,
  defaultCountry: CountryCode = defaultPhoneCountry
) {
  return normalizeInternationalPhoneNumber(value, defaultCountry)?.replace(/^\+/, "") || null;
}

export function formatPhoneNumberForInput(
  value: string | null | undefined,
  country: CountryCode = defaultPhoneCountry
) {
  const input = value?.trim() || "";
  if (!input) return "";

  const formatter = new AsYouType(country);
  return formatter.input(input);
}

export function countryForPhoneNumber(
  value: string | null | undefined,
  fallbackCountry: CountryCode = defaultPhoneCountry
) {
  const parsed = parsePhoneNumberFromString(value?.trim() || "", fallbackCountry);
  return parsed?.country || fallbackCountry;
}

export function nationalPhoneNumberForInput(
  value: string | null | undefined,
  country: CountryCode = defaultPhoneCountry
) {
  const input = value?.trim() || "";
  if (!input) return "";

  const parsed = parsePhoneNumberFromString(input, country);
  if (parsed?.isValid() && parsed.country === country) {
    return parsed.nationalNumber;
  }

  return input;
}
