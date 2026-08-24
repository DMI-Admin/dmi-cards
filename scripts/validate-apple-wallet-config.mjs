import { readFile } from "node:fs/promises";
import path from "node:path";
import forge from "node-forge";
import { PKPass } from "passkit-generator";

const envPath = path.join(process.cwd(), ".env.local");
const assetDirectory = path.join(process.cwd(), "public", "apple-wallet");
const required = [
  "APPLE_WALLET_TEAM_ID",
  "APPLE_WALLET_PASS_TYPE_ID",
  "APPLE_WALLET_CERTIFICATE_BASE64",
  "APPLE_WALLET_CERTIFICATE_PASSWORD",
  "APPLE_WALLET_WWDR_CERTIFICATE_BASE64",
  "APPLE_WALLET_ORGANIZATION_NAME",
];

const env = {
  ...loadDotEnv(await readOptionalText(envPath)),
  ...process.env,
};
const values = Object.fromEntries(required.map((name) => [name, String(env[name] || "").trim()]));
const missing = required.filter((name) => !values[name]);
const results = [];

for (const name of required) {
  results.push([name, values[name] ? "present" : "missing"]);
}

const teamIdValid = /^[A-Z0-9]{10}$/.test(values.APPLE_WALLET_TEAM_ID);
const passTypeValid = /^pass\.[A-Za-z0-9.-]+$/.test(values.APPLE_WALLET_PASS_TYPE_ID);
let signer = null;
let wwdr = null;

if (values.APPLE_WALLET_TEAM_ID) {
  results.push(["APPLE_WALLET_TEAM_ID_FORMAT", teamIdValid ? "valid" : "invalid"]);
}

if (values.APPLE_WALLET_PASS_TYPE_ID) {
  results.push(["APPLE_WALLET_PASS_TYPE_ID_FORMAT", passTypeValid ? "valid" : "invalid"]);
}

if (values.APPLE_WALLET_CERTIFICATE_BASE64 && values.APPLE_WALLET_CERTIFICATE_PASSWORD) {
  signer = validateSignerCertificate(
    values.APPLE_WALLET_CERTIFICATE_BASE64,
    values.APPLE_WALLET_CERTIFICATE_PASSWORD
  );
  results.push(["APPLE_WALLET_CERTIFICATE_PARSE", signer.ok ? "valid" : signer.reason]);
}

if (values.APPLE_WALLET_WWDR_CERTIFICATE_BASE64) {
  wwdr = validateWwdrCertificate(values.APPLE_WALLET_WWDR_CERTIFICATE_BASE64);
  results.push(["APPLE_WALLET_WWDR_CERTIFICATE_PARSE", wwdr.ok ? "valid" : wwdr.reason]);
}

const assets = await validateAssets();
results.push(["APPLE_WALLET_ASSETS", assets.ok ? "present" : assets.reason]);

const canInitialise =
  missing.length === 0 &&
  teamIdValid &&
  passTypeValid &&
  signer?.ok &&
  wwdr?.ok &&
  assets.ok;

if (canInitialise) {
  const initResult = await validatePasskitInitialisation(values, signer, wwdr);
  results.push(["PASSKIT_GENERATOR_INITIALISE", initResult.ok ? "valid" : initResult.reason]);
} else {
  results.push(["PASSKIT_GENERATOR_INITIALISE", "skipped"]);
}

for (const [name, status] of results) {
  console.log(`${name}: ${status}`);
}

if (missing.length > 0) {
  console.log(`MISSING_REQUIRED: ${missing.join(", ")}`);
}

process.exit(missing.length === 0 && canInitialise ? 0 : 1);

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function loadDotEnv(text) {
  const entries = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    entries[match[1]] = match[2]
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }

  return entries;
}

function validateSignerCertificate(certificateBase64, password) {
  try {
    const p12Buffer = decodeBase64Buffer(certificateBase64);
    const p12Der = forge.util.createBuffer(p12Buffer.toString("binary"));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ]?.[0];
    const keyBag =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ]?.[0] ||
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

    if (!certBag?.cert || !keyBag?.key) {
      return { ok: false, reason: "invalid_missing_cert_or_key" };
    }

    return {
      ok: true,
      signerCert: forge.pki.certificateToPem(certBag.cert),
      signerKey: forge.pki.encryptRsaPrivateKey(keyBag.key, password),
    };
  } catch {
    return { ok: false, reason: "invalid_or_wrong_password" };
  }
}

function validateWwdrCertificate(certificateBase64) {
  try {
    const buffer = decodeBase64Buffer(certificateBase64);
    const text = buffer.toString("utf8");

    if (text.includes("-----BEGIN CERTIFICATE-----")) {
      forge.pki.certificateFromPem(text);
      return { ok: true, wwdr: text };
    }

    const certificate = forge.pki.certificateFromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(buffer.toString("binary")))
    );

    return { ok: true, wwdr: forge.pki.certificateToPem(certificate) };
  } catch {
    return { ok: false, reason: "invalid_or_unreadable" };
  }
}

async function validateAssets() {
  const files = ["icon.png", "icon@2x.png", "logo.png", "logo@2x.png"];
  const missingAssets = [];

  for (const file of files) {
    try {
      await readFile(path.join(assetDirectory, file));
    } catch {
      missingAssets.push(file);
    }
  }

  if (missingAssets.length > 0) {
    return { ok: false, reason: `missing_${missingAssets.join("_")}` };
  }

  return { ok: true };
}

async function validatePasskitInitialisation(values, signer, wwdr) {
  try {
    const [icon, icon2x, logo, logo2x] = await Promise.all([
      readFile(path.join(assetDirectory, "icon.png")),
      readFile(path.join(assetDirectory, "icon@2x.png")),
      readFile(path.join(assetDirectory, "logo.png")),
      readFile(path.join(assetDirectory, "logo@2x.png")),
    ]);

    new PKPass(
      {
        "icon.png": icon,
        "icon@2x.png": icon2x,
        "logo.png": logo,
        "logo@2x.png": logo2x,
      },
      {
        wwdr: wwdr.wwdr,
        signerCert: signer.signerCert,
        signerKey: signer.signerKey,
        signerKeyPassphrase: values.APPLE_WALLET_CERTIFICATE_PASSWORD,
      },
      {
        formatVersion: 1,
        passTypeIdentifier: values.APPLE_WALLET_PASS_TYPE_ID,
        teamIdentifier: values.APPLE_WALLET_TEAM_ID,
        organizationName: values.APPLE_WALLET_ORGANIZATION_NAME,
        serialNumber: "dmi-cards-local-validation",
        description: "DMI Cards validation pass",
      }
    );

    return { ok: true };
  } catch {
    return { ok: false, reason: "initialisation_failed" };
  }
}

function decodeBase64Buffer(value) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.length === 0) {
    throw new Error("Empty base64 value.");
  }

  return buffer;
}
