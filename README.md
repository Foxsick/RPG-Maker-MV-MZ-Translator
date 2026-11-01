# RPG Maker Game Translator

Translate RPG Maker MV and MZ game data into your chosen language through a local browser interface. Choose a translation service, point the app at a game folder, and apply the generated files to a copy of the game.

> **Keep the original game intact.** The app writes translated data separately; install it only into a copy you can test.

## Features

- Automatically finds game data in `data` or `www/data`.
- Translates standard dialogue, choices, speaker names, database entries, map names, and system terms.
- Preserves supported RPG Maker control codes and checks that protected codes survive translation.
- Wraps long dialogue and splits it across message windows when needed.
- Saves results separately by game, target language, and translation mode.
- Caches translated phrases, so interrupted work can be resumed without translating every phrase again.
- Shows progress and an estimated remaining time.
- Provides a Russian, English, and German interface, with translations stored in a separate file.

## Translation services

| Service | Setup | Notes |
| --- | --- | --- |
| Google Translate without a key | None | Uses an unofficial interface that may be rate-limited or change without notice. |
| DeepL API Free | DeepL API Free key | Subject to your account's limits and terms. |
| Google Cloud Translation | Google Cloud API key and billing setup | Official API; usage may incur charges. |
| Ollama | A running local Ollama server and an installed model | Runs on your computer; performance and quality depend on the model and hardware. |
| OpenAI API | API key and an available model name | Usage may incur charges. |

The **Use all available free services** option distributes unique text fragments by count between keyless Google and DeepL when a DeepL key is supplied. Without a DeepL key, it uses Google only. Google Cloud, Ollama, and OpenAI are not included in this mode. Different services can produce different styles and terminology.

## Requirements

- Windows, for the included launcher and folder picker.
- [Node.js](https://nodejs.org/) 18 or later; no additional packages are required.
- An internet connection for online translation services. Ollama can translate locally once its model is installed.
- An API key and account setup for any service that requires them.

## Getting started

1. Double-click **`Start.bat`** in this folder.
2. Open the address shown in the terminal in your browser. Keep the terminal open while translating.
3. Click **Choose folder…** and select the game folder containing `Game.exe`. You can also enter a path manually, select the game's `www` folder, or select a parent folder containing a single game.
4. Open **Translation settings**, select a service, and enter any required key or model name. Choose a target language, such as `ru`, and optionally specify the source language.
5. Click **Translate** and wait for the completion message. The app displays the output folder and the corresponding location of the game's data folder.
6. Make a copy of the game. Copy the **contents** of the generated output folder into the corresponding `data` or `www/data` folder in that copy, replacing files when prompted.
7. Start the copied game and check the translated text.

Output is written under `translated_data` in the directory **above** this app folder. Translating the same game again with the same target language and mode overwrites its previous output. Moving a game creates a separate output folder.

## Dialogue wrapping

The default is approximately **32 characters per line** and **4 lines per message window**. Adjust both values in Translation settings. If text still extends beyond the window, reduce the line length and run the translation again; cached phrases can be reused.

Wrapping is approximate: fonts, control codes, window sizes, and plugins vary between games. Always check the result in game. Wrapping applies to standard dialogue, not images, scripts, choice lists, or custom windows.

## Cache and interrupted translations

The cache is stored in `translator-cache.json` in the directory above this app folder. If a service fails, the app stops and keeps translations already saved to the cache. Run the translation again with the same settings to continue. Cache entries are separated by service; AI entries also include the model name.

API keys are held in application memory during a run and are not written to the translation cache. Online services receive the text sent to them; check their terms, limits, and pricing before use.

## Interface languages

The interface selects a supported browser language by default; a manually selected language is remembered in the browser.

To add another language, add an entry to [`languages.json`](languages.json) with a language code, a `name`, a `strings` dictionary based on `ru`, and a `status` dictionary based on `en`. Missing interface strings fall back to Russian. Service error messages may still appear in the service's own language. Restart the app after editing the file.

## Limitations

- Text embedded in images, scripts, plugin-specific commands, notes, and other nonstandard fields is not translated.
- Translations are processed one fragment at a time for some services, which can reduce context and consistency.
- AI models can alter formatting or produce inaccurate translations. Protected control codes are checked, but all output should be reviewed.
- Some games use custom message systems or plugins that need additional handling.
- The unofficial Google interface may stop working or temporarily restrict requests.

## Troubleshooting

- **The app cannot find the game:** Select the folder containing `Game.exe`, its `www` folder, or a parent folder containing only one game. The app looks for `data/System.json` or `www/data/System.json`.
- **A translation service fails:** Check your internet connection, key, account limits, and model name. Retry to reuse cached translations.
- **Ollama cannot connect:** Start the Ollama server on this computer and make sure the selected model is installed. The app connects to `127.0.0.1:11434`.
- **Dialogue is cut off:** Reduce the dialogue line length in Translation settings, run again, and copy the new files into the game copy.
