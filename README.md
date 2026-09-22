# Leafpress

A static website (plain HTML, CSS and JavaScript, no build step) with seven tools: **Image to PDF**, **PDF to Image**, **PDF to Excel**, **Merge PDF**, **Split PDF**, **Compress PDF** and **Compress Image**.
Everything runs in the visitor's browser, so files are never uploaded.

## Before you publish: 5 things to replace

Use your editor's "search in all files" and replace:

| Find | Replace with |
| --- | --- |
| `https://www.yourdomain.com` | your real domain (all HTML files, `sitemap.xml`, `robots.txt`) |
| `hello@yourdomain.com` | your contact email (`privacy.html`) |
| `Leafpress` | your site name (all HTML files, `site.webmanifest`, `js/pdf-builder.js`) |
| `og-image.png` | a 1200x630 image with your own name and look (shown when the site is shared) |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.svg`, `favicon.ico` | your own logo files, same file names |

## Files

```
index.html            Home page with the list of tools
image-to-pdf.html     The Image to PDF tool page (title, description, FAQ, structured data)
compress-pdf.html     The Compress PDF tool page
compress-image.html   The Compress Image tool page
pdf-to-image.html     The PDF to Image tool page
merge-pdf.html        The Merge PDF tool page
split-pdf.html        The Split PDF tool page
pdf-to-excel.html     The PDF to Excel tool page
img/                  Illustrations shown on the home page tool tiles (one SVG per tool)
privacy.html          Privacy policy (review it, and update it if you add analytics or ads)
404.html              Page not found
css/style.css         All styles. Colours are variables at the top of the file
js/main.js            Shared helpers used by every tool
js/pdf-builder.js     Small PDF writer with no libraries
js/image-to-pdf.js    The Image to PDF interface and logic
js/compress-pdf.js    The Compress PDF interface and logic
js/compress-image.js  The Compress Image interface and logic
js/pdf-to-image.js    The PDF to Image interface and logic
js/merge-pdf.js       The Merge PDF interface and logic
js/split-pdf.js       The Split PDF interface and logic
js/pdf-to-excel.js    The PDF to Excel interface and logic
js/xlsx-builder.js    Small Excel (.xlsx) file writer
js/zip-builder.js     Small ZIP file writer (used for "Download all")
js/vendor/            Third-party libraries, do not edit: pdf.js (Mozilla, Apache-2.0) reads PDFs; pdf-lib (MIT) merges them
robots.txt            Tells search engines they may crawl the site
sitemap.xml           List of pages for search engines
site.webmanifest      Lets phones "add to home screen" with your icon and colours
_headers              Security and cache headers for Netlify and Cloudflare Pages
.htaccess             The same for Apache hosting (most shared hosts)
```

## Publishing

Upload the whole folder to any static host. Easy options:

- **Cloudflare Pages, Netlify or Vercel:** drag and drop the folder, or connect a Git repository. Free plans work.
- **GitHub Pages:** push the folder to a repository and turn on Pages. Delete `_headers` and `.htaccess` (GitHub Pages ignores them).
- **Shared hosting (cPanel and similar):** upload the contents into `public_html`. `.htaccess` is picked up automatically.

Open the site over **HTTPS** (all the hosts above provide it for free).

## After publishing: SEO checklist

1. Add your site to **Google Search Console** and **Bing Webmaster Tools**, then submit `https://yourdomain/sitemap.xml`.
2. Check the page in Google's Rich Results Test to confirm the structured data is read.
3. Check the share preview with a link preview tool after you replace `og-image.png`.
4. Every time you add a page, add it to `sitemap.xml` and link to it from the home page and footer.
5. Test speed with PageSpeed Insights. The pages use no external fonts or libraries, so scores should be high.

## How the header menu and home tiles work

- The header has a **Tools** menu that opens on hover (or click/tap and keyboard) and lists every tool. The same menu is repeated in every page's `<header>`, so when you add a tool, add one `<li>` to the menu on each page (search for `tools-menu`).
- The home page tools are tiles in a CSS grid: 4 columns on wide screens, 3 on laptops, 2 on tablets and 1 on phones (see `.tools-grid` in `css/style.css`). Any number of tools works; the last row is simply shorter. Each tile is a small illustration from `img/`, a title and one line of text. To add a tool, copy an existing `<li>` inside `<ul class="tools-grid">` and draw a matching 320x200 SVG in `img/`.

## How to add the next tool

1. Copy `image-to-pdf.html` to a new file, for example `merge-pdf.html`.
2. Change the `<title>`, description, canonical URL, Open Graph tags, breadcrumb, structured data and the visible text. Give every tool its own unique title, description, `<h1>` and FAQ.
3. Replace the `<script src="js/image-to-pdf.js">` line with your new script, for example `js/merge-pdf.js`. Keep `js/main.js`. Only keep `js/pdf-builder.js` if the tool builds PDFs.
4. Put the new tool's interface inside the `<section class="tool">` block and reuse the classes in `css/style.css` (`.btn`, `.field`, `.dropzone`, `.result`, and so on).
5. In `index.html`, remove the tool from the "On the way" list and add a tile to `tools-grid`. Add it to the header Tools menu and footer "Tools" list on every page, and to `sitemap.xml`.

`js/main.js` already has two helpers you can reuse from any tool: `Leafpress.formatBytes()` and `Leafpress.safeFileName()`.

## If you add ads or analytics later

`_headers` and `.htaccess` include a strict Content-Security-Policy that only allows scripts, styles and images from your own site. This is good for security, but ad and analytics scripts will be blocked until you add their domains to `script-src`, `img-src` and `connect-src`. Also update `privacy.html` and add a cookie notice if your visitors' region requires one.

## Image to PDF: how it works

- Each image is drawn onto a canvas (applying rotation and size limits), saved as a JPEG, and embedded in the PDF as-is.
- Quality presets: **High** keeps up to 3840 px and JPEG quality 0.92, **Medium** 2400 px at 0.80, **Low** 1400 px at 0.60. Change them in `QUALITY` at the top of `js/image-to-pdf.js`.
- Transparent PNGs get a white background because JPEG has no transparency.
- HEIC files open only in browsers that can decode them (Safari).

## Compress PDF: how it works

- pdf.js (in `js/vendor/`, loaded only when someone picks a PDF) draws each page, and the page is saved as a JPEG and rebuilt into a new PDF with `js/pdf-builder.js`. Pages keep their original physical size.
- Levels are set in `LEVELS` at the top of `js/compress-pdf.js` (dpi and JPEG quality).
- Because pages become images, text is no longer selectable. The page says so, and the tool will not offer a file that is not at least 2% smaller than the original.
- It needs to be served over http(s). Opening `compress-pdf.html` straight from disk will not load the PDF engine (browsers block that); Image to PDF still works from disk.
- Very rare PDFs that contain JPEG 2000 or JBIG2 images may fail to render, because those decoders need WebAssembly, which the strict Content-Security-Policy blocks.

## Compress Image: how it works

- Each image is redrawn on a canvas (optionally smaller) and saved as JPG, WebP or PNG at the chosen quality. Redrawing also strips hidden metadata such as GPS location.
- If the new file would not be smaller, the original is kept, so users never get a bigger file. Kept originals are still included in the ZIP.
- PNG stays lossless, so it only shrinks when the image is also resized. WebP is disabled automatically in browsers that cannot encode it.
- Photos above 16 megapixels are scaled down (`MAX_PIXELS` in `js/compress-image.js`) so they work on phones.
- GIFs are rejected on purpose, because re-saving would remove the animation.

## PDF to Image: how it works

- pdf.js draws each chosen page on a canvas at the chosen dpi, and the canvas is saved as PNG, JPG or WebP. Download pages one by one, or all as a ZIP.
- The Pages box accepts ranges such as `1-3, 5`. Up to 200 pages per run (`MAX_PAGES`), and pages above 16 megapixels are scaled down (`MAX_PIXELS`), both in `js/pdf-to-image.js`.
- Like Compress PDF, it needs to be served over http(s) and will not load the PDF engine when opened straight from disk.

## Merge PDF: how it works

- pdf-lib (in `js/vendor/`) reads each PDF and copies its pages, in the order shown, into a new PDF. Pages are copied as they are, so text stays selectable and the file size is about the sum of the originals.
- Password-protected PDFs are refused with a clear message. Bookmarks, fillable form fields and links between pages may not carry over.
- Unlike Compress PDF and PDF to Image, Merge PDF loads its library with a normal script tag, so it also works when the page is opened straight from disk.

## Split PDF: how it works

- pdf-lib copies the chosen pages into new PDFs, so text stays sharp and selectable. Three modes: **Extract pages** (one PDF from `1-3, 5`), **Split by ranges** (one PDF per range) and **Every N pages**. A live preview line shows what will be created.
- Up to 300 files per run (`MAX_FILES` in `js/split-pdf.js`). Several files are offered as a ZIP.
- Like Merge PDF, it loads its library with a normal script tag, so it also works when opened straight from disk.

## PDF to Excel: how it works

- pdf.js reads each page's text with its position. Text on the same line becomes a row, close pieces of text are joined into one cell, and text that lines up down the page becomes a column (`findColumns` in `js/pdf-to-excel.js`). The **Column detection** option changes how far apart text must be to become separate cells (`GAP`).
- `js/xlsx-builder.js` writes the workbook (an .xlsx file is a ZIP of XML files, built with `js/zip-builder.js`). Numbers are converted only when they are clearly numbers (`toCellValue`); leading-zero codes, long IDs, dates and mixed text stay as text.
- It works for PDFs with real text. Scanned PDFs need OCR, which is not included, so the tool says so instead of producing an empty file.
- Like Compress PDF and PDF to Image, it needs to be served over http(s).

## Testing locally

Run a local server from this folder (needed for Compress PDF):

```
python3 -m http.server 8000
```

then visit http://localhost:8000
