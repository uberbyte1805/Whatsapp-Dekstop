# WA Incognito (Linux / macOS / Windows)

Invisible mode for WhatsApp Desk: the account never appears online, never shows
a typing or recording indicator, and never sends read receipts.

## Why this is not a browser extension

Browser extensions cannot run inside this app on any platform:

| Platform | Engine | Chrome `.crx` | Firefox `.xpi` |
| --- | --- | --- | --- |
| Linux | WebKitGTK | no | no |
| macOS | WKWebView | no | no |
| Windows | WebView2 | no | no |

WebKitGTK exposes only `WebKitWebProcessExtension`, a C API for embedding code
in your own app. It has no Chrome or WebExtensions loader, and WebView2 does not
load browser extensions either (only the full Edge browser does). The user agent
is spoofed to Chrome, but the engine underneath is still WebKit.

There is also a licensing reason: [WAIncognito by
tomer8007](https://github.com/tomer8007/whats-incognito) — the extension this
feature is modelled on — is **GPL-2.0**, while WhatsApp Desk is MIT. Its code
cannot be copied into this repository. This is an independent implementation of
the same behaviour.

## How it works

WAIncognito hooks `WebSocket` and decrypts the Noise protocol to read WhatsApp's
binary XMPP stanzas, which needs libsignal, protobuf and WhatsApp's stanza
parser (~200 KB of code). None of that is needed here: invisibility wraps the
functions WhatsApp Web already calls to emit the updates, and the two chat
extras work on the DOM (see below).

For invisibility alone that machinery is unnecessary. WhatsApp Web already has
functions that emit those updates, so this implementation wraps them:

| Behaviour | Wrapped function |
| --- | --- |
| Online presence | `WAWebPresenceChatAction.sendPresenceAvailable` |
| Typing / recording | `WAWebChatStateBridge.sendChatStateComposing` / `sendChatStatePaused` / `sendChatStateRecording` |
| Read receipts | `WAWebSendReadReceiptJob.sendReceipt`, `WAWebSendReceiptJobCommon.sendAggregateReceipts` |

The current WhatsApp Web build is not webpack any more: modules are declared
through a global `__d(id, deps, factory, flags)` with string ids such as
`WAWebChatStateBridge`, and `webpackChunkwhatsapp_web_client` is an empty array
with a native `push`, so the classic "push a fake chunk to grab
`__webpack_require__`" trick yields nothing. Instead the feature installs a
property trap on `window.__d` at document start, before the bundle runs. For
the four modules above it wraps the factory, and the moment WhatsApp
instantiates one, the exported functions are patched in place — whether the
module publishes through `module.exports`, its return value, or a `.default`
object.

Two details matter for correctness:

- `sendAggregateReceipts` also carries delivery receipts. Only `read` and
  `read-self` entries are stripped from the batch; the rest is forwarded
  untouched, otherwise the phone would keep resending messages.
- Going *offline* is never blocked. Enabling incognito calls
  `sendPresenceUnavailable` once so an account that was already announced
  online actually disappears.

Hooks attach when WhatsApp loads the socket modules, i.e. after the device is
paired, so the Settings card shows `…` until then.

The whole feature lives in `main.go` as the `waRunModule('incognito', ...)`
block, so it behaves identically on every platform and needs no native code.

## Chat extras

Two of WAIncognito's features do not need protocol access either, so they are
implemented as separate modules next to the incognito hooks.

### Restore deleted messages

`waRunModule('restore-deleted', ...)` keeps a bounded, in-memory copy of what is
currently rendered in `#main` (800 messages, oldest evicted first). When a bubble
is replaced with a "this message was deleted" notice, the cached text is put
back and tagged with a small `· restored` badge.

This is deliberately DOM-only. WhatsApp still deletes the message on its side
and this does not touch the message store, so:

- Only messages **seen in this session** can be restored. After a reload the
  cache is empty and older deletions stay deleted.
- The cache never touches disk, so deleted content does not end up in the
  profile directory.
- Restoring re-inserts text; media (photos, voice notes) is not recovered,
  because the file was already removed from the page.
- The notice is matched by text, with English and Indonesian patterns. Other
  locales are not restored.

### Status download

`waRunModule('status-download', ...)` adds a **Save status** button while a photo
or video status is open. The status media is already decrypted in the page as a
`blob:` URL, so it is fetched and streamed through the app's existing chunked
native save (`waSaveBlobChunked`) — no media keys, no direct-path rebuild. The
file lands in the configured Downloads folder like any other media save.

## Settings

Settings (`Ctrl+,`) → **WA Incognito**:

- **Always appear offline** — swallows the "available" announcement and, when
  switched on mid-session, sends an explicit `unavailable` so the server stops
  treating the account as online.
- **Hide typing and recording indicators** — drops `composing`, `paused` and
  `recording` chat states.
- **Block read receipts** — drops `sendReadReceipt` calls. Messages still get
  marked read locally, so the chat list behaves normally; the sender just never
  receives the blue ticks.

Settings (`Ctrl+,`) → **Chat extras**:

- **Restore deleted messages** — see above.
- **Show a "Save status" button** — see above.

Preferences are stored in `localStorage` and never leave the machine.

## Escape hatches

```js
// Current state and which hooks were found.
waIncognitoStatus()

// Let receipts through for 8 seconds without disabling the feature.
waIncognitoAllowRead(8000)

// Toggle individual behaviours.
setIncognitoOffline(false)
setIncognitoTypingHidden(false)
setIncognitoReadBlocked(false)

// Chat extras.
waRestoreDeletedStats()
setRestoreDeletedEnabled(false)
setStatusDownloadEnabled(false)
```

## Limitations

- Read receipts are all-or-nothing. Per-chat exceptions are not implemented; use
  `waIncognitoAllowRead()` for a temporary window.
- Blocking `sendReadReceipt` means the sender may see the message as delivered
  but never read. WhatsApp does not treat this as an error.
- Presence is what WhatsApp uses for the "online" dot. Blocking it also stops
  the app from reporting itself as online to your own other devices.
- The **"sent from phone / computer"** indicator from WAIncognito is **not**
  implemented. The sending device is only present in the encrypted stanza
  attributes, so it cannot be read from the DOM; it would require the
  WebSocket/Noise layer and a separate licensing review.
- Restoring deleted messages recovers text only, and only for messages rendered
  in the current session (see above).
