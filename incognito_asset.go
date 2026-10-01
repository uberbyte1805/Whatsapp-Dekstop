package main

import _ "embed"

// incognitoJS embeds the bundled WhatsApp Web Incognito feature set (read-receipt
// control, presence/typing suppression, deleted-message restore, status download,
// device-type detection, view-once saving), ported from tomer8007's
// whatsapp-web-incognito Chrome extension (GPL-2.0 — see LICENSE.incognito and
// NOTICE.incognito). It is prepended to the page init script so its WebSocket
// interception installs before WhatsApp Web boots. Built by
// tools/build_incognito_bundle.mjs; do not hand-edit the generated asset.
//
//go:embed assets/incognito.js
var incognitoJS string