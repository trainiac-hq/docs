// A minimal ZIP reader for the one file we need: VIA's GTFS archive. It reads
// the central directory (so it is robust to streamed archives that defer sizes
// to data descriptors) and inflates each entry with Node's built-in zlib.
// Supports stored (method 0) and deflate (method 8), which is all GTFS uses.

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export function readZip(buf: Buffer): Map<string, Buffer> {
	// Find the End Of Central Directory record, scanning back from the end
	// (its trailing comment is almost always empty, but allow for one).
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0x10000; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIG) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16); // offset of first central-directory entry
	const entries = new Map<string, Buffer>();

	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error("corrupt zip: bad central-directory signature");
		const method = buf.readUInt16LE(p + 10);
		const compSize = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const localOffset = buf.readUInt32LE(p + 42);
		const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

		// Jump to the local header to find where the data actually starts
		// (local extra fields can differ in length from the central ones).
		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const raw = buf.subarray(dataStart, dataStart + compSize);

		if (!name.endsWith("/")) {
			entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
		}
		p += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}
