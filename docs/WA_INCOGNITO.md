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
parser (~200 KB of code). That is required for its heavier features (restoring
deleted messages, device-type indicators, status downloads).

For invisibility alone that machinery is unnecessary. WhatsApp Web already has
functions that emit those updates, so this implementation wraps them:

| Behaviour | Wrapped function |
| --- | --- |
| Online presence | `sendPresenceAvailable`, `sendPresenceUpdate`, `sendPresenceStatusProtocol` |
| Typing / recording | `sendChatState`, `sendChatStateUpdate`, `sendTypingState` |
| Read receipts | `sendReadReceipt` |

The functions are found by reading the webpack chunk registry
(`webpackChunkwhatsapp_web_client`) and inspecting module source for those
names. Only matching factories are instantiated, so the scan never runs
thousands of unrelated modules. Because WhatsApp boots its modules over the
first seconds and lazily loads more later, the registry is re-scanned on a
decaying schedule and then every two minutes.

The whole feature lives in `main.go` as the `waRunModule('incognito', ...)`
block, so it behaves identically on every platform and needs no native code.

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
```

## Limitations

- Read receipts are all-or-nothing. Per-chat exceptions are not implemented; use
  `waIncognitoAllowRead()` for a temporary window.
- Blocking `sendReadReceipt` means the sender may see the message as delivered
  but never read. WhatsApp does not treat this as an error.
- Presence is what WhatsApp uses for the "online" dot. Blocking it also stops
  the app from reporting itself as online to your own other devices.
- Features from WAIncognito that need protocol decoding (restore deleted
  messages, "sent from phone/computer", status download) are not part of this
  implementation. They would require the WebSocket/Noise layer and a separate
  licensing review.
