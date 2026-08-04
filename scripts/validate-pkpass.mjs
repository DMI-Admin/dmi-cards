import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const requiredFiles = [
  "pass.json",
  "manifest.json",
  "signature",
  "icon.png",
  "icon@2x.png",
  "logo.png",
  "logo@2x.png",
];

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npm run validate:pkpass -- path/to/pass.pkpass");
  process.exit(1);
}

const buffer = await readFile(filePath);

if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
  console.error("Invalid pkpass: file is not a ZIP archive.");
  process.exit(1);
}

const entries = centralDirectoryEntries(buffer);
const names = new Set(entries.map((entry) => entry.name));
const missing = requiredFiles.filter((name) => !names.has(name));

if (missing.length > 0) {
  console.error(`Invalid pkpass: missing ${missing.join(", ")}.`);
  process.exit(1);
}

const passJson = JSON.parse(readZipEntry(buffer, requiredEntry(entries, "pass.json")).toString("utf8"));
const barcode = firstBarcode(passJson);
const barcodeMessage = typeof barcode?.message === "string" ? barcode.message : "";

if (!/^https:\/\/app\.dmicards\.com\/u\/[^/]+/.test(barcodeMessage)) {
  console.error("Invalid pkpass: QR barcode does not contain the public card URL.");
  process.exit(1);
}

if (typeof barcode?.altText === "string" && barcode.altText.trim()) {
  console.error("Invalid pkpass: QR barcode includes visible altText.");
  process.exit(1);
}

if (visibleFieldsContainValue(passJson, barcodeMessage)) {
  console.error("Invalid pkpass: public card URL is present in visible pass fields.");
  process.exit(1);
}

console.log(
  `Valid pkpass structure and Wallet fields: ${requiredFiles.join(", ")} found.`
);

function centralDirectoryEntries(zipBuffer) {
  const endOffset = findEndOfCentralDirectory(zipBuffer);
  const centralDirectorySize = zipBuffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(endOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const entries = [];
  let offset = centralDirectoryOffset;

  while (offset < centralDirectoryEnd) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory.");
    }

    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const name = zipBuffer.subarray(fileNameStart, fileNameEnd).toString("utf8");

    entries.push({
      name,
      compressionMethod: zipBuffer.readUInt16LE(offset + 10),
      compressedSize: zipBuffer.readUInt32LE(offset + 20),
      localHeaderOffset,
    });
    offset = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
}

function requiredEntry(entries, name) {
  const entry = entries.find((item) => item.name === name);

  if (!entry) {
    throw new Error(`Missing ${name}.`);
  }

  return entry;
}

function readZipEntry(zipBuffer, entry) {
  const offset = entry.localHeaderOffset;

  if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header.");
  }

  const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const data = zipBuffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return data;
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(data);
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}.`);
}

function firstBarcode(passJson) {
  if (Array.isArray(passJson.barcodes) && passJson.barcodes.length > 0) {
    return passJson.barcodes[0];
  }

  return passJson.barcode || null;
}

function visibleFieldsContainValue(passJson, value) {
  const passType = ["boardingPass", "coupon", "eventTicket", "generic", "storeCard"].find(
    (type) => passJson[type]
  );

  if (!passType || !value) {
    return false;
  }

  return [
    "headerFields",
    "primaryFields",
    "secondaryFields",
    "auxiliaryFields",
    "backFields",
  ].some((fieldGroup) =>
    (passJson[passType][fieldGroup] || []).some((field) => field?.value === value)
  );
}

function findEndOfCentralDirectory(zipBuffer) {
  const signature = 0x06054b50;
  const minimumOffset = Math.max(0, zipBuffer.length - 65_557);

  for (let offset = zipBuffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP archive: end of central directory not found.");
}
