/**
 * Streaming .zip extraction for the GDPR import.
 *
 * Uses yauzl (lazy entries, streamed to disk) so a large archive is never held
 * in memory. Hardened against:
 *  - zip-slip: every entry is sanitised and the resolved output path is verified
 *    to stay inside the destination directory;
 *  - zip bombs: total uncompressed bytes and entry count are capped.
 */
import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, open } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Files that unambiguously identify the root of a TV Time export. */
const MARKER_FILES = [
	'tracking-prod-records-v2.csv',
	'user.csv',
	'user_tv_show_data.csv',
	'followed_tv_show.csv'
];

const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB uncompressed, generous for CSVs

/** True when the file begins with the local-file-header / EOCD zip magic (`PK`). */
export async function isZipFile(path: string): Promise<boolean> {
	const fh = await open(path, 'r');
	try {
		const buf = Buffer.alloc(4);
		const { bytesRead } = await fh.read(buf, 0, 4, 0);
		// 50 4B = "PK"; 0304 (local file), 0506 (empty archive), 0708 (spanned).
		return bytesRead >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
	} finally {
		await fh.close();
	}
}

/**
 * Normalise a zip entry name to a safe RELATIVE path, or return null if it is
 * absolute or tries to escape the extraction root (zip-slip).
 */
function safeRelativePath(entryName: string): string | null {
	const cleaned = entryName.replace(/\\/g, '/');
	// Drop leading slashes / drive letters (absolute paths).
	if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) return null;
	const parts = cleaned.split('/').filter((p) => p.length > 0 && p !== '.');
	if (parts.some((p) => p === '..')) return null;
	if (parts.length === 0) return null;
	return parts.join(sep);
}

/**
 * Extract `zipPath` into `destDir`, returning the list of extracted relative paths.
 * Directory entries and unsafe/absolute paths are skipped.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
	await mkdir(destDir, { recursive: true });
	const destRoot = resolve(destDir);
	const extracted: string[] = [];
	let totalBytes = 0;
	let entryCount = 0;

	await new Promise<void>((resolvePromise, reject) => {
		yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
			if (err || !zip) {
				reject(err ?? new Error('Could not open the uploaded file as a zip archive.'));
				return;
			}
			zip.on('error', reject);
			zip.on('end', () => resolvePromise());
			zip.readEntry();

			zip.on('entry', (entry: yauzl.Entry) => {
				(async () => {
					if (++entryCount > MAX_ENTRIES) {
						throw new Error('Archive has too many files.');
					}
					// Directory entry → just continue.
					if (/\/$/.test(entry.fileName)) {
						zip.readEntry();
						return;
					}
					const rel = safeRelativePath(entry.fileName);
					if (rel === null) {
						// Skip unsafe entry (zip-slip / absolute) without aborting the whole import.
						zip.readEntry();
						return;
					}
					totalBytes += entry.uncompressedSize ?? 0;
					if (totalBytes > MAX_TOTAL_BYTES) {
						throw new Error('Archive is too large when uncompressed.');
					}
					const outPath = join(destRoot, rel);
					// Final belt-and-braces zip-slip check on the resolved path.
					if (outPath !== destRoot && !outPath.startsWith(destRoot + sep)) {
						zip.readEntry();
						return;
					}
					await mkdir(dirname(outPath), { recursive: true });
					await new Promise<void>((res, rej) => {
						zip.openReadStream(entry, (streamErr, readStream) => {
							if (streamErr || !readStream) {
								rej(streamErr ?? new Error(`Could not read ${entry.fileName} from the archive.`));
								return;
							}
							pipeline(readStream, createWriteStream(outPath)).then(() => {
								extracted.push(rel);
								res();
							}, rej);
						});
					});
					zip.readEntry();
				})().catch(reject);
			});
		});
	});

	return extracted;
}

/**
 * Find the directory that actually holds the TV Time CSVs. The export is usually
 * flat, but some downloads nest everything under a sub-folder — so we walk the
 * tree (shallow-first) and return the first directory containing a marker file.
 */
export async function locateDataDir(root: string): Promise<string> {
	const queue: string[] = [root];
	while (queue.length > 0) {
		const dir = queue.shift()!;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
		if (MARKER_FILES.some((m) => names.has(m))) return dir;
		for (const e of entries) {
			if (e.isDirectory()) queue.push(join(dir, e.name));
		}
	}
	throw new Error(
		'No TV Time CSV files were found in the archive. Make sure you uploaded the GDPR export .zip.'
	);
}
