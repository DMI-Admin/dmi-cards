import { readFile } from "node:fs/promises";

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

const names = centralDirectoryNames(buffer);
const missing = requiredFiles.filter((name) => !names.has(name));

if (missing.length > 0) {
  console.error(`Invalid pkpass: missing ${missing.join(", ")}.`);
  process.exit(1);
}

console.log(`Valid pkpass structure: ${requiredFiles.join(", ")} found.`);

function centralDirectoryNames(zipBuffer) {
  const endOffset = findEndOfCentralDirectory(zipBuffer);
  const centralDirectorySize = zipBuffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(endOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const names = new Set();
  let offset = centralDirectoryOffset;

  while (offset < centralDirectoryEnd) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory.");
    }

    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    names.add(zipBuffer.subarray(fileNameStart, fileNameEnd).toString("utf8"));
    offset = fileNameEnd + extraFieldLength + commentLength;
  }

  return names;
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
