#!/usr/bin/env node
// Builds assets/incognito.js — a single self-contained bundle of the
// whatsapp-web-incognito code, adapted to run inside WhatsApp Desk's native
// WebView (no Chrome extension runtime). Output is embedded into the Go binary
// via incognito_asset.go (go:embed) and prepended to getInitScript().
//
// Layout of the output (matters — read carefully before editing):
//
//   1. BRIDGE SHIM (runs first, try/catch): provides window.browser /
//      window.chrome.runtime.sendMessage + getURL, and a Velocity no-op.
//      chrome is given {app:{isInstalled:false}, runtime} so WhatsApp Desk's
//      own "Emulate window.chrome" guard (main.go, `if (!window.chrome)`) is
//      preserved and the introspection code still finds chrome.runtime.
//
//   2. EARLY interception stack — all files concatenated inside ONE
//      immediately-invoked function within a try/catch. The single function
//      scope keeps every top-level const/let/class (e.g. `const moduleRaid`,
//      `const arrayBufferToBase64`, `class PromiseQueue`) mutually visible
//      across the concatenated files, while the try/catch guarantees a failure
//      here cannot take down WhatsApp Desk's Settings (init_script_guard_test).
//      Order follows core_injection.js exactly: ws_hook MUST be first (it
//      replaces window.WebSocket), WhisperTextProtocol before WAProto.
//
//   3. UI phase — deferred to DOMContentLoaded: drop.js, sweetalert, ui.js,
//      status_download.js plus the two stylesheets injected as a <style>.
import fs from 'node:fs';
import path from 'node:path';

const INC = '/root/SERVER/projects/_wa-fork/whatsapp-web-incognito';
const OUT = '/root/SERVER/projects/_wa-fork/Whatsapp-Dekstop/assets/incognito.js';

const join = (...p) => path.join(INC, ...p);

function read(p) {
  let s = fs.readFileSync(join(p), 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip UTF-8 BOM
  return s;
}
// The two protobuf files are UTF-16 LE (BOM 0xFFFE) — decode specially.
function readUtf16(p) {
  let s = fs.readFileSync(join(p), 'utf16le');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

// Inline every image under images/ as a data URI for runtime.getURL().
function buildImageMap() {
  const map = {};
  try {
    for (const f of fs.readdirSync(join('images'))) {
      const ext = path.extname(f).toLowerCase();
      let mime;
      if (ext === '.svg') mime = 'image/svg+xml';
      else if (ext === '.png') mime = 'image/png';
      else if (ext === '.jpg') mime = 'image/jpeg';
      else continue;
      map['images/' + f] = `data:${mime};base64,${fs.readFileSync(join('images', f)).toString('base64')}`;
    }
  } catch (e) { /* images dir absent — getURL falls back to passthrough */ }
  return map;
}

const DEFAULTS = {
  readConfirmationsHook: true,
  onlineUpdatesHook: false,
  typingUpdatesHook: false,
  showReadWarning: true,
  safetyDelay: 0,
  saveDeletedMsgs: false,
  showDeviceTypes: true,
  autoReceiptOnReplay: true,
  allowStatusDownload: true,
};
const imgMap = buildImageMap();

const shim = `
/* ================================================================
 * WhatsApp Desk — Incognito bridge (extension-runtime shim).
 * ================================================================ */
;(function () {
  try {
    var IMG = ${JSON.stringify(imgMap)};
    var DEFAULTS = ${JSON.stringify(DEFAULTS)};
    function getOptions() {
      var o = {};
      for (var k in DEFAULTS) {
        var v = null;
        try { v = localStorage.getItem('waIncognito_' + k); } catch (e) {}
        if (v === null || v === undefined) { o[k] = DEFAULTS[k]; continue; }
        if (v === 'true') o[k] = true;
        else if (v === 'false') o[k] = false;
        else { var n = Number(v); o[k] = isNaN(n) ? v : n; }
      }
      return o;
    }
    function setOptions(msg) {
      for (var k in msg) {
        if (k === 'name') continue;
        try { localStorage.setItem('waIncognito_' + k, String(msg[k])); } catch (e) {}
      }
      try { document.dispatchEvent(new CustomEvent('onOptionsUpdate', { detail: JSON.stringify(getOptions()) })); } catch (e) {}
    }
    var runtime = {
      sendMessage: function (msg, cb) {
        try {
          if (msg && msg.name === 'getOptions') { if (cb) cb(getOptions()); return; }
          if (msg && msg.name === 'setOptions') { setOptions(msg); return; }
        } catch (e) {}
        if (cb) cb({});
      },
      getURL: function (p) { return IMG[p] || p; }
    };
    window.browser = { runtime: runtime };
    if (!window.chrome) {
      window.chrome = { app: { isInstalled: false }, runtime: runtime };
    } else if (!window.chrome.runtime) {
      window.chrome.runtime = runtime;
    }
    // Velocity is WhatsApp's own animation helper, absent from this repo.
    if (typeof window.Velocity === 'undefined') {
      window.Velocity = function () {
        var el = arguments[0];
        return (el && typeof el.length !== 'undefined') ? el : el;
      };
    }
    window.__waIncognitoGetOptions = getOptions;
  } catch (e) {
    try { console.error('[wa-incognito] bridge init failed', e); } catch (_) {}
  }
})();
`;

// --- EARLY interception stack (single shared scope) -----------------------
// Order matches core_injection.js exactly.
const earlyFiles = [
  ['core/ws_hook.js', read],
  ['lib/pbf.3.0.5.min.js', read],
  ['lib/libsignal-protocol-ee5b8ba.min.js', read],
  ['lib/pako.js', read],
  ['core/parsing/binary_reader.js', read],
  ['core/parsing/binary_writer.js', read],
  ['core/parsing/node_reader_writer.js', read],
  ['core/parsing/protobuf/WhisperTextProtocol.js', readUtf16],
  ['core/parsing/protobuf/WAProto.js', readUtf16],
  ['core/utils.js', read],
  ['core/ui_class_names.js', read],
  ['core/injected_ui.js', read],
  ['core/multi_device.js', read],
  ['core/node_handler.js', read],
  ['core/interception.js', read],
  ['lib/moduleraid.js', read],
].map(([f, r]) => {
  try { return `/* === ${f} === */\n${r(f)}`; }
  catch (e) { return `/* === ${f} MISSING === */\n`; }
}).join('\n;\n');

// --- UI phase (deferred to DOMContentLoaded) ------------------------------
const uiFiles = [
  ['lib/drop.js', read],
  ['lib/sweetalert.min.js', read],
  ['core/ui.js', read],
  ['core/status_download.js', read],
].map(([f, r]) => {
  try { return `/* === ${f} === */\n${r(f)}`; }
  catch (e) { return `/* === ${f} MISSING === */\n`; }
}).join('\n;\n');

const css = (() => {
  try { return read('styles.css') + '\n' + read('lib/css/drop-theme-basic.css'); }
  catch (e) { return ''; }
})();

const out = [
  '/* GENERATED by tools/build_incognito_bundle.mjs — do not hand-edit. */',
  '',
  shim,
  '',
  '// Single shared scope: early (interception) files run immediately; the UI',
  '// files are declared as a nested function in the SAME scope and invoked once',
  '// document.body exists. Nesting (instead of a second IIFE) keeps early `var`/',
  '// `const`/`function` symbols (UIClassNames, chats, FindReact, moduleRaid, …)',
  '// visible to the UI code through closure, exactly like the extension sharing',
  '// one page world. The outer try/catch keeps any early failure from reaching',
  '// WhatsApp Desk\'s Settings (init_script_guard_test invariant).',
  'try {',
  '  (function () {',
  '',
  '/* ===================== Phase 1: interception stack ===================== */',
  earlyFiles,
  '',
  '/* ===================== Phase 2: UI (deferred) ===================== */',
  'function __waIncognitoRunUI() {',
  '  try {',
  '    var _st = document.createElement("style"); _st.id = "wa-incognito-css";',
  '    _st.textContent = ' + JSON.stringify(css) + ';',
  '    (document.head || document.documentElement).appendChild(_st);',
  '  } catch (e) {}',
  '  ' + uiFiles,
  '}',
  'if (document.readyState === "loading") {',
  '  document.addEventListener("DOMContentLoaded", __waIncognitoRunUI);',
  '} else {',
  '  __waIncognitoRunUI();',
  '}',
  '',
  '  })();',
  '} catch (e) { try { console.error("[wa-incognito] stack failed", e); } catch(_){} }',
  '',
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
const sz = fs.statSync(OUT).size;
console.log(`Wrote ${OUT} (${(sz / 1024).toFixed(1)} KB, ${sz} bytes)`);