# TextStats

A Windows desktop app (Electron) that reads documents and e-books and reports word and character counts, reading time, and a full table of how often each word is used.

## Run it

1. Install **Node.js LTS** (version 20 or newer) from https://nodejs.org. You only need to do this once.
2. Double-click **`Start TextStats.bat`**. The first run downloads Electron (about 100 MB), so it takes a minute. Later runs start right away.

You can also use a terminal in this folder:

```
npm install      (first time only)
npm start
```

### Build a normal Windows program (.exe)

Double-click **`Build TextStats.bat`**. It raises the version number, deletes the previous build and creates a new one in `dist`. (Or run `npm run dist` yourself.) The app icon comes from `build\icon.ico`.

This creates one portable program, for example `dist\TextStats 1.0.3 Portable.exe`. It needs no installation: copy it anywhere (even a USB stick) and double-click it. Its settings are saved next to it in `TextStats-settings.json`. On each start it unpacks itself to a temporary folder, so it takes a few seconds to open.

## Features

- Add files by dragging them anywhere onto the window or with **Open files** (opens the standard Windows file dialog). You can add several at once.
- Each file is one row with: name and extension, file size, word count, character count without spaces, character count with spaces, and reading time (HH:MM).
- **Preferences**: reading speed in words per minute (default 238, the average adult silent reading speed), the theme (Light or Dark) and the app language (English or Spanish). Changes show immediately; **Save** keeps them and **Cancel** undoes them. Until you choose a theme, the app follows the Windows light/dark setting; the moon/sun button in the top bar switches it quickly. On first run the language follows Windows.
- **Text language** (in Create Report): English or Spanish, detected automatically for each file and changeable. It decides which word lists the word-type toggles use, and whether the possessive 's rule applies (English only). It is separate from the app language, so you can use the app in English to analyse Spanish books.
- **App language**: everything in the app switches language, including messages and the CSV labels. Spanish CSV files use `;` between columns and a decimal comma, as Excel expects on Spanish Windows.
- **Create Report** opens a dialog where you choose:
  - **Start point** and **End point**. They default to *Beginning* and *End*. Click one to open the text and click the word where the report should start or end. *Find in text* helps you jump to a chapter.
  - **Chapter titles / headings**, **Copyright page**, **Table of contents / index**: Include or Exclude. All three default to Exclude. If the app cannot recognise one of them in a file, that option is greyed out.
- **Start Report** shows a progress bar on the row. When it finishes, an **Open Report** button appears.
- The report shows the word count, both character counts, unique words and reading time, and a table of every word with how many times it was used and its percentage of all words. The table starts sorted from most used to least used. Click any column header to sort by it, and click again to reverse. Use the filter box to find a word.
- **Word-type toggles** above the table hide or show Nouns, Verbs, Adjectives, Adverbs, Pronouns, Determiners, Articles, Prepositions, Conjunctions, Interjections, Numbers (cardinal and ordinal, in words or digits) and Everything else (words the app does not recognise, such as unusual names). Words that can be several types are listed under each of them. Your choice is remembered.
- Click a word in the table to put it in the filter box.
- **Save as CSV** saves the report (summary and word table) as a `.csv` file that opens in Excel. Word types hidden with the toggles are left out of the file too.

## Supported formats

| Format | Support |
|---|---|
| EPUB (`.epub`) | Full. Headings, copyright page and table of contents come from the book's own markup. |
| Kindle MOBI, PRC, AZW, AZW3/KF8 | Full, **only for DRM-free files** |
| PDF | Full for PDFs that contain text. Headings are recognised by font size. Scanned PDFs need OCR first. |
| Word DOCX, Word 97-2003 DOC | Full. In DOCX, headings and the table of contents come from Word styles. In DOC they are guessed from the text. |
| OpenDocument ODT, RTF | Full |
| TXT, CSV/TSV | Full (encoding is detected automatically) |
| Apple Pages (`.pages`) | Best effort. Reads Pages '09 and the current Pages format. |
| iBooks Author (`.iba`) | Best effort |
| **KFX** (`.kfx`), Amazon Topaz | **Not supported.** These are closed Amazon formats and almost always DRM-protected. Convert a DRM-free copy to EPUB or AZW3 with Calibre first. |

DRM-protected books (Kindle, Adobe ADEPT EPUB) can't be read. The app shows a clear message for these files instead of a count.

## How things are counted

- **Words**: runs of letters and digits. Apostrophes and hyphens inside a word keep it as one word (*don't*, *mother-in-law*), and so do decimal points inside numbers (*3.14*). Punctuation and symbols on their own are not words.
- **Characters with spaces**: every character of the text, including spaces and punctuation. Line breaks between paragraphs are not counted, and runs of several spaces count as one.
- **Characters without spaces**: the same total, minus all whitespace.
- **Word table**: words are counted without regard to case, so *The* and *the* are the same word.
- **Possessive 's** (report option, on by default): *father's* is counted as *father*. Plural possessives such as *parents'* are always counted as *parents*. Contractions with *'s* stay as written (*it's, he's, she's, that's, there's, here's, what's, who's, let's*…), because after those words *'s* means *is*, *has* or *us*. A name followed by a contraction (*John's coming*) still counts as *John*, since telling the two apart would need the meaning of the sentence. The word count itself never changes: *father's* is always one word.
- **Word types** use the word lists of the report's text language (English or Spanish), which contain every inflected form: all verb conjugations (*swam, swum, hablaríamos, anduvieron, quepo*…), plurals and comparatives. Spanish verbs with attached pronouns (*dímelo, hacerlo*) and adverbs in *-mente* are recognised too.
- **Words with several types** are listed under all of them: *vino* is a noun and a verb, *walk* and *love* are nouns and verbs, *que* is a pronoun and a conjunction. Each type shows as a tag next to the word, and the CSV has a Word type column. A word stays visible while at least one of its types is switched on, so switching off Nouns still shows *vino* (it is also a verb); switching off Nouns and Verbs hides it. For short common words (articles, prepositions…) very rare uses are ignored, so *the* is never shown as an adjective. In Spanish, *al* and *del* count as prepositions, and possessives such as *mi*, *tu* and *su* count as pronouns, like *my* and *his* in English. Word-list sources and licences are in `vendor/lexicon/SOURCES.md`.
- **Recognising headings, copyright pages and contents**: the app uses the file's structure when the format has it (EPUB, DOCX, ODT, RTF styles, PDF font sizes). For plain text it looks for lines such as *Chapter 3*, *PART TWO* or *Contents*, and for typical copyright wording (©, *All rights reserved*, ISBN…).

## Project layout

```
src/main/        Electron main process, preload bridge, settings
src/extract/     File readers (one per format) and the heading/copyright/TOC detection
src/renderer/    The app window (HTML/CSS/JS) and the shared statistics code
vendor/pdfjs/    Mozilla pdf.js (Apache 2.0), used to read PDFs
test/            Sample files and test scripts (npm test)
```

All format readers except PDF are written from scratch. The app needs no runtime npm packages, only Electron to run and electron-builder to package.
