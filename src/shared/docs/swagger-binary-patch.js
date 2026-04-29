// Swagger UI 4.x has two known limitations for binary responses:
//
//   1. It renders <audio>/<video> with `<source src="<endpoint URL>">` pointing
//      back at the same URL the user just POSTed to. The browser then issues a
//      GET to that URL with no body — fails for POST routes — so duration
//      shows 0:00 and the play button is dead.
//
//   2. The cURL snippet it generates omits `--output <file>` even when the
//      response is `audio/ogg` / `application/octet-stream` / etc. Running the
//      command as-is dumps raw bytes to the terminal (curl prints the famous
//      "Binary output can mess up your terminal" warning and bails).
//
// Neither can be fixed via OpenAPI metadata — both behaviours are hardcoded in
// Swagger UI. So we patch the rendered DOM client-side via `customJsStr`:
//
//   • Replace the broken <audio>/<video> player with a notice that points the
//     user at the cURL command (now patched, see below) or the landing page's
//     "Coba Langsung" tab where the in-page player works.
//   • Append `--output '<filename>.<ext>'` to the cURL snippet so the user can
//     copy-and-run it and get a usable file. Filename is derived from the path
//     (last segment) and the response Content-Type declared in the spec.
//
// Both patches use a single MutationObserver on `#swagger-ui` so they apply on
// every Execute click without needing to re-bootstrap.

const PATCH_SCRIPT = `
(function () {
  if (typeof window === 'undefined' || !window.MutationObserver) return;

  var SPEC_URL = '/api/docs.json';
  var nonGetPaths = new Set();
  // Map<pathname, filename> for endpoints whose response is binary. Used to
  // (a) decide whether a curl snippet needs --output, (b) suggest a sensible
  // filename in the patched curl command.
  var binaryFiles = {};

  function deriveExt(contentType) {
    if (!contentType) return 'bin';
    if (/ogg/.test(contentType)) return 'ogg';
    if (/mpeg|mp3/.test(contentType)) return 'mp3';
    if (/wav/.test(contentType)) return 'wav';
    if (/mp4/.test(contentType)) return 'mp4';
    if (/webm/.test(contentType)) return 'webm';
    if (/png/.test(contentType)) return 'png';
    if (/jpe?g/.test(contentType)) return 'jpg';
    if (/gif/.test(contentType)) return 'gif';
    if (/zip/.test(contentType)) return 'zip';
    return 'bin';
  }

  function deriveFilename(pathname, contentType) {
    var parts = pathname.split('/').filter(Boolean);
    var last = parts[parts.length - 1] || 'response';
    return last + '.' + deriveExt(contentType);
  }

  // Pull the spec once so we know which routes are non-GET (to fix the audio
  // element) and which return binary (to fix the curl snippet). Best-effort:
  // if this fails the patches simply don't apply.
  fetch(SPEC_URL).then(function (r) { return r.json(); }).then(function (spec) {
    var paths = (spec && spec.paths) || {};
    Object.keys(paths).forEach(function (p) {
      var ops = paths[p] || {};
      Object.keys(ops).forEach(function (m) {
        if (!m || typeof m !== 'string') return;
        var ml = m.toLowerCase();
        if (ml === 'parameters' || ml === 'summary' || ml === 'description' || ml === 'servers') return;
        if (ml !== 'get') nonGetPaths.add(p);
        var resps = (ops[m] && ops[m].responses) || {};
        Object.keys(resps).forEach(function (code) {
          var content = (resps[code] && resps[code].content) || {};
          Object.keys(content).forEach(function (ct) {
            if (/^audio\\/|^video\\/|^image\\/|application\\/octet-stream|application\\/zip/.test(ct)) {
              binaryFiles[p] = deriveFilename(p, ct);
            }
          });
        });
      });
    });
  }).catch(function () {});

  function isNonGetEndpoint(url) {
    if (!url) return false;
    try {
      var pathname = new URL(url, window.location.origin).pathname;
      var iter = nonGetPaths.values();
      var hit = iter.next();
      while (!hit.done) {
        if (pathname === hit.value || pathname.endsWith(hit.value)) return true;
        hit = iter.next();
      }
      return /^\\/api\\//.test(pathname) && !/\\.[a-z0-9]{2,5}$/i.test(pathname);
    } catch (e) {
      return false;
    }
  }

  function findBinaryFilenameInCurl(text) {
    var paths = Object.keys(binaryFiles);
    for (var i = 0; i < paths.length; i++) {
      if (text.indexOf(paths[i]) !== -1) return binaryFiles[paths[i]];
    }
    return null;
  }

  function buildNotice() {
    var div = document.createElement('div');
    div.style.cssText =
      'padding:12px 14px;background:#fef3c7;border-left:3px solid #f59e0b;' +
      'color:#78350f;font-size:13px;border-radius:4px;line-height:1.5';
    div.innerHTML =
      '<strong>Audio preview unavailable in Swagger UI</strong><br>' +
      'This is a <code>POST</code> endpoint, so the embedded audio player ' +
      'cannot replay it (Swagger UI tries to <code>GET</code> the URL ' +
      'instead). The cURL command above has been patched with ' +
      '<code>--output</code> — copy and run it to save the file, or test on ' +
      'the <a href="/" style="color:#1e40af;text-decoration:underline">' +
      'Rex landing page</a>\\'s "Coba Langsung" tab where the in-page player ' +
      'works.';
    return div;
  }

  function patchMediaElements(root) {
    var nodes = root.querySelectorAll
      ? root.querySelectorAll('audio, video')
      : [];
    nodes.forEach(function (el) {
      if (el.dataset.rexPatched === '1') return;
      var src = el.currentSrc || el.src ||
        (el.querySelector('source') && el.querySelector('source').src);
      if (!isNonGetEndpoint(src)) return;
      el.dataset.rexPatched = '1';
      el.replaceWith(buildNotice());
    });
  }

  function patchCurlBlocks(root) {
    // Swagger UI's curl block lives inside .responses-wrapper .curl-command
    // (a textarea on some versions, a <pre><code> on others). Cover both
    // and also fall back to scanning all <pre> for one that starts with curl.
    var candidates = [];
    if (root.querySelectorAll) {
      candidates = candidates.concat(
        Array.prototype.slice.call(
          root.querySelectorAll('.curl-command, .copy-to-clipboard textarea, pre code, pre'),
        ),
      );
    }
    candidates.forEach(function (el) {
      if (el.dataset.rexCurlPatched === '1') return;
      var text = (el.value !== undefined ? el.value : el.textContent) || '';
      if (!/^\\s*curl\\b/.test(text)) return;
      if (/--output\\b|\\s-o\\s/.test(text)) {
        el.dataset.rexCurlPatched = '1';
        return;
      }
      var filename = findBinaryFilenameInCurl(text);
      if (!filename) return;
      // Insert "--output 'filename'" right after the initial "curl" token so
      // the rest of the command (-X, -H, -d) renders unchanged.
      var patched = text.replace(/^(\\s*curl)\\b/, "$1 --output '" + filename + "'");
      if (el.value !== undefined) {
        el.value = patched;
      } else {
        el.textContent = patched;
      }
      el.dataset.rexCurlPatched = '1';
    });
  }

  function patchAll(root) {
    patchMediaElements(root);
    patchCurlBlocks(root);
  }

  // Swagger UI re-renders the curl <pre> in place by mutating its text node
  // (not by replacing the whole element), so a childList-only observer misses
  // updates after the second Execute click. Watch characterData too, and fall
  // back to a re-scan of the whole #swagger-ui root when text changes.
  var obs = new MutationObserver(function (muts) {
    var needsFullRescan = false;
    muts.forEach(function (m) {
      if (m.type === 'characterData') {
        needsFullRescan = true;
        return;
      }
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) patchAll(node);
      });
    });
    if (needsFullRescan) {
      var root = document.querySelector('#swagger-ui') || document.body;
      patchAll(root);
    }
  });

  function patchCurlText(text) {
    if (!text || typeof text !== 'string') return text;
    if (!/^\\s*curl\\b/.test(text)) return text;
    if (/--output\\b|\\s-o\\s/.test(text)) return text;
    var filename = findBinaryFilenameInCurl(text);
    if (!filename) return text;
    return text.replace(/^(\\s*curl)\\b/, "$1 --output '" + filename + "'");
  }

  // Swagger UI's copy button hands clipboard text from React state, NOT the
  // <pre> we patched. Hook the actual clipboard write paths so the copied
  // text matches what the user sees.
  function installClipboardHooks() {
    // 1. navigator.clipboard.writeText — modern browsers / react-copy-to-clipboard fallback
    if (window.navigator && window.navigator.clipboard) {
      var orig = window.navigator.clipboard.writeText.bind(window.navigator.clipboard);
      window.navigator.clipboard.writeText = function (text) {
        return orig(patchCurlText(text));
      };
    }
    // 2. document.execCommand('copy') path — react-copy-to-clipboard usually
    //    creates a hidden textarea, selects it, then runs execCommand. Hook
    //    the 'copy' event to rewrite clipboard data.
    document.addEventListener('copy', function (e) {
      try {
        var sel = window.getSelection && window.getSelection().toString();
        if (!sel) return;
        var patched = patchCurlText(sel);
        if (patched === sel) return;
        if (e.clipboardData && e.clipboardData.setData) {
          e.clipboardData.setData('text/plain', patched);
          e.preventDefault();
        }
      } catch (err) { /* ignore */ }
    }, true);
  }

  function start() {
    var root = document.querySelector('#swagger-ui') || document.body;
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    patchAll(root);
    installClipboardHooks();
    // Also force a re-scan whenever the user clicks Execute, since the
    // MutationObserver sometimes misses the moment Swagger UI swaps in a
    // freshly-built curl <pre> (timing varies per swagger-ui-dist version).
    document.addEventListener(
      'click',
      function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var btn = target.closest('.try-out__btn, .execute, .btn.execute, button');
        if (!btn) return;
        var label = (btn.textContent || '').trim().toLowerCase();
        if (label === 'execute' || label === 'try it out') {
          // Two passes: now (catches GET endpoints that resolve instantly)
          // and after the response comes back (~700 ms is plenty for local).
          patchAll(root);
          setTimeout(function () { patchAll(root); }, 800);
          setTimeout(function () { patchAll(root); }, 2000);
        }
      },
      true,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;

module.exports = { PATCH_SCRIPT };
