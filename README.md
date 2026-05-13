# L'aor Dubber Web

Full static GitHub Pages project for browser-based video translation and dubbed video rendering.

## Files

```text
index.html
styles.css
app.js
AppIcon.ico
AppIcon.png
users.json
.nojekyll
```

## Features

- Sign in with JSON-seeded users
- Continue as Guest with limits: 3 videos total, max 5 minutes per video
- Admin user management: add/update/delete users, active/disabled, role, lifetime, end date, reset password
- User password change with old-password verification
- Browser video preview
- Whisper transcription in browser using Transformers.js/WebAssembly
- Google Translate GTX translation with retry
- Khmer translated voice preview fallback using Google Translate TTS audio
- Browser video render with Canvas + MediaRecorder, no ffmpeg.wasm required
- Translated captions burned into the exported video image
- Generate Dubbed Video creates translated AI voice audio with Edge TTS WebSocket and mixes it into the recorded video; if voice generation is blocked, it falls back to original audio so the export is not silent
- Timeline fills remaining screen height; page does not scroll on desktop

## Default admin seed

The default seed admin is stored in `users.json`. Change it after first deployment from the admin panel, then export the updated users JSON and replace `users.json` in your repository.

## GitHub Pages deployment

1. Upload all files to your repository root.
2. Go to Settings -> Pages.
3. Choose Deploy from branch, `main`, root folder.
4. Open the published GitHub Pages URL.

## Important limitations

This is a static browser-only project. Client-side login is not a secure replacement for server-side authentication. For real protected access, use a backend auth service.

Generated video audio is created from Edge TTS MP3 buffers and mixed through Web Audio into the MediaRecorder stream. If the browser/network blocks Edge TTS, the app falls back to original video audio to avoid a silent export.






## No-FFmpeg video rendering

Generate Dubbed Video now uses browser Canvas + MediaRecorder instead of ffmpeg.wasm. This avoids CDN/core/worker loading errors on GitHub Pages. The generated file does not burn subtitles/captions into the video image. If the browser supports MP4 recording it exports MP4; otherwise it exports WebM. If **AI voice only** is checked, the original/background audio is muted and the exported audio track contains the generated translated AI voices. If unchecked, the app mixes original audio plus translated AI voices where the browser allows it.

## AI voice in generated video

The Generate Dubbed Video button now generates real audio buffers for each translated row using Microsoft Edge TTS WebSocket, decodes the returned MP3 audio in the browser, schedules each segment at its timeline start time, and records the Canvas video stream plus the Web Audio mix.

If **AI voice only** is checked, original/background audio is muted and only the generated translated voices are scheduled. If Edge TTS is blocked by the browser/network, the renderer falls back to original video audio so the final export is not silent. For guaranteed production-quality voice dubbing and perfect sync, the desktop/backend renderer is still the strongest option.


## AI voice generation fix

Generate Dubbed Video now uses a stronger Microsoft Edge TTS WebSocket implementation with browser-compatible security query parameters, chunked text synthesis, retry-friendly status messages, and proper audio-frame parsing. If the online voice service is blocked by the browser, firewall, or network, the app creates an offline synthetic voice buffer instead of exporting a completely silent video.

For best real AI voice quality, use Chrome or Microsoft Edge over HTTPS on GitHub Pages.


## No subtitles in final video

Generate Dubbed Video now records the original video frames only and mixes the translated AI voice audio when available. It no longer draws translated text/captions onto the exported video. Export SRT is still available separately if you need subtitle files.
