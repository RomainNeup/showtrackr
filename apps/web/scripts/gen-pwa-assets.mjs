#!/usr/bin/env node
/**
 * Deterministic PWA asset generator for ShowTrackr.
 *
 * Single source of truth: static/icons/icon.svg (the ShowTrackr mark — a TV
 * screen + antenna + play triangle on the brand purple tile). Everything here is
 * rasterized from that SVG (or from a mark-only SVG derived from it), so the
 * output is fully reproducible: delete static/icons/*.png + static/splash and
 * run `pnpm --filter @showtrackr/web run gen:pwa` to rebuild byte-stable assets.
 *
 * Produces:
 *   icons/icon-192.png, icon-512.png              (purpose "any")
 *   icons/icon-192-maskable.png, icon-512-maskable.png (purpose "maskable", safe padding)
 *   icons/apple-touch-icon.png (180)              (opaque, for iOS home screen)
 *   icons/favicon.svg + favicon-32.png + favicon-16.png
 *   splash/apple-splash-<w>-<h>.png               (iOS launch images, portrait + landscape)
 *
 * It also prints the exact <link rel="apple-touch-startup-image"> block for
 * app.html to stdout so the two never drift.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '..');
const ICONS = join(WEB, 'static', 'icons');
const SPLASH = join(WEB, 'static', 'splash');

// Brand palette (mirrors --accent in src/app.css and background_color in the manifest).
const BRAND = '#6c4cf1'; // icon tile / accent
const SPLASH_BG = '#0b0b0f'; // app dark background — matches manifest background_color

const ICON_SVG = join(ICONS, 'icon.svg');

/**
 * Mark-only artwork (no background tile), derived from icon.svg. viewBox is
 * cropped tight to the visible mark (including stroke width) so it composites
 * cleanly onto solid backgrounds at any scale.
 */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 84 320 308" role="img" aria-label="ShowTrackr">
	<g fill="#ffffff">
		<rect x="120" y="176" width="272" height="192" rx="28" fill="none" stroke="#ffffff" stroke-width="24" />
		<path d="M256 176 L200 108" stroke="#ffffff" stroke-width="24" stroke-linecap="round" />
		<path d="M256 176 L312 108" stroke="#ffffff" stroke-width="24" stroke-linecap="round" />
		<path d="M232 232 L232 312 L300 272 Z" />
	</g>
</svg>`;

const round = (n) => Math.round(n);

/** Rasterize an SVG buffer/string to a PNG buffer at an exact pixel size. */
function rasterize(svg, size) {
	return sharp(Buffer.from(svg), { density: 384 })
		.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
}

/** Solid-color square with the mark centered at `markRatio` of the canvas. */
async function tile(size, bg, markRatio) {
	const markSize = round(size * markRatio);
	const mark = await rasterize(MARK_SVG, markSize);
	return sharp({
		create: { width: size, height: size, channels: 4, background: bg }
	})
		.composite([{ input: mark, gravity: 'center' }])
		.png()
		.toBuffer();
}

async function write(path, buf) {
	await writeFile(path, buf);
	console.log(`  ${path.replace(WEB + '/', '')}  (${buf.length} bytes)`);
}

// iPhone / iPad launch-image matrix (current + recent devices).
// cssW/cssH are the portrait CSS-point dimensions used in the media query;
// ratio is device-pixel-ratio; the pixel canvas is cssW*ratio x cssH*ratio.
const DEVICES = [
	{ cssW: 440, cssH: 956, ratio: 3 }, // 16 Pro Max / 15 Pro Max / 14 Pro Max
	{ cssW: 402, cssH: 874, ratio: 3 }, // 16 Pro / 15 Pro / 14 Pro
	{ cssW: 430, cssH: 932, ratio: 3 }, // 16 Plus / 15 Plus / 14 Plus
	{ cssW: 428, cssH: 926, ratio: 3 }, // 13 Pro Max / 12 Pro Max
	{ cssW: 393, cssH: 852, ratio: 3 }, // 16 / 15 / 14 / 14 Pro
	{ cssW: 390, cssH: 844, ratio: 3 }, // 13 / 13 Pro / 12 / 12 Pro
	{ cssW: 375, cssH: 812, ratio: 3 }, // 13 mini / 12 mini / 11 Pro / XS / X
	{ cssW: 414, cssH: 896, ratio: 3 }, // 11 Pro Max / XS Max
	{ cssW: 414, cssH: 896, ratio: 2 }, // 11 / XR
	{ cssW: 414, cssH: 736, ratio: 3 }, // 8 Plus / 7 Plus / 6s Plus
	{ cssW: 375, cssH: 667, ratio: 2 }, // SE 2nd/3rd / 8 / 7 / 6s / 6
	{ cssW: 320, cssH: 568, ratio: 2 }, // SE 1st / 5s / 5
	{ cssW: 1024, cssH: 1366, ratio: 2 }, // iPad Pro 12.9"
	{ cssW: 834, cssH: 1194, ratio: 2 }, // iPad Pro 11" / 10.5"
	{ cssW: 820, cssH: 1180, ratio: 2 }, // iPad Air 10.9"
	{ cssW: 810, cssH: 1080, ratio: 2 }, // iPad 10.2"
	{ cssW: 768, cssH: 1024, ratio: 2 } // iPad Mini / 9.7" / Air
];

/** Full branded icon tile rendered onto a splash canvas of w x h. */
async function splashImage(w, h) {
	const iconSvg = await readFile(ICON_SVG);
	const logo = round(Math.min(w, h) * 0.32);
	const icon = await sharp(iconSvg, { density: 384 }).resize(logo, logo).png().toBuffer();
	return sharp({
		create: { width: w, height: h, channels: 4, background: SPLASH_BG }
	})
		.composite([{ input: icon, gravity: 'center' }])
		.png()
		.toBuffer();
}

async function main() {
	await mkdir(ICONS, { recursive: true });
	await mkdir(SPLASH, { recursive: true });

	const iconSvg = await readFile(ICON_SVG);

	console.log('Icons:');
	// "any" icons: the full branded tile straight from icon.svg.
	await write(join(ICONS, 'icon-192.png'), await rasterize(iconSvg.toString(), 192));
	await write(join(ICONS, 'icon-512.png'), await rasterize(iconSvg.toString(), 512));
	// Maskable: full-bleed brand square + mark inside the ~80% safe zone (~60% mark).
	await write(join(ICONS, 'icon-192-maskable.png'), await tile(192, BRAND, 0.6));
	await write(join(ICONS, 'icon-512-maskable.png'), await tile(512, BRAND, 0.6));
	// Apple touch icon: opaque (no alpha), iOS applies its own rounding.
	await write(join(ICONS, 'apple-touch-icon.png'), await tile(180, BRAND, 0.66));
	// Favicons.
	await copyFile(ICON_SVG, join(ICONS, 'favicon.svg'));
	console.log(`  static/icons/favicon.svg  (copied from icon.svg)`);
	await write(join(ICONS, 'favicon-32.png'), await rasterize(iconSvg.toString(), 32));
	await write(join(ICONS, 'favicon-16.png'), await rasterize(iconSvg.toString(), 16));

	console.log('Splash:');
	const links = [];
	for (const d of DEVICES) {
		const pw = d.cssW * d.ratio;
		const ph = d.cssH * d.ratio;
		// Portrait.
		const pName = `apple-splash-${pw}-${ph}.png`;
		await write(join(SPLASH, pName), await splashImage(pw, ph));
		links.push(
			`\t\t\t<link rel="apple-touch-startup-image" href="%sveltekit.assets%/splash/${pName}" media="screen and (device-width: ${d.cssW}px) and (device-height: ${d.cssH}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)" />`
		);
		// Landscape (swap pixel dims; keep portrait CSS device-width/height per Apple convention).
		const lName = `apple-splash-${ph}-${pw}.png`;
		await write(join(SPLASH, lName), await splashImage(ph, pw));
		links.push(
			`\t\t\t<link rel="apple-touch-startup-image" href="%sveltekit.assets%/splash/${lName}" media="screen and (device-width: ${d.cssW}px) and (device-height: ${d.cssH}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: landscape)" />`
		);
	}

	console.log('\n--- app.html apple-touch-startup-image block (copy into <head>) ---');
	console.log(links.join('\n'));
	console.log('--- end block ---');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
