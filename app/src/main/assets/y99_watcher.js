(function () {
  // Already running in this document: just force a re-check.
  if (window.__y99Watch) { window.__y99Watch.check(); return; }

  // Y99 system lines (matched against short, visible text nodes only).
  var CONNECTED = /(^|[^a-z])connected to (a )?stranger/;
  var ENDED = /chat (has )?ended|conversation (has )?ended|stranger (has )?(disconnected|left)|you (have )?disconnected/;

  var state = null; // null | 'connected' | 'disconnected'

  // Do not immediately turn a missing status node into "disconnected".
  // Y99 can temporarily remove/recreate the chat UI during a rerender.
  var missingConnectedScans = 0;
  var MISSING_CONFIRMATIONS = 4;

  function visible(el) {
    return !!el &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      getComputedStyle(el).display !== 'none';
  }

  // Walk the DOM in order; whichever marker appears LAST wins.
  function scan() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var seq = 0, lastConn = -1, lastEnd = -1, node;

    while ((node = walker.nextNode())) {
      seq++;
      var t = node.nodeValue;
      if (!t || t.length > 120) continue;

      t = t.trim().toLowerCase();
      if (!t) continue;

      var c = CONNECTED.test(t);
      var e = !c && ENDED.test(t);

      if (!c && !e) continue;
      if (!visible(node.parentElement)) continue;

      if (c) lastConn = seq;
      else lastEnd = seq;
    }

    if (lastConn > lastEnd) return 'connected';
    if (lastEnd >= 0) return 'disconnected';
    return 'none';
  }

  function apply(result) {
    if (result === 'connected') {
      missingConnectedScans = 0;

      if (state !== 'connected') {
        var prev = state;
        state = 'connected';

        // Only report a genuine transition into a connected chat.
        if (prev !== 'connected') Y99Native.state('connected');
      }
      return;
    }

    if (result === 'disconnected') {
      missingConnectedScans = 0;

      // An explicit Y99 end/disconnect marker is strong evidence.
      if (state === 'connected') {
        state = 'disconnected';
        Y99Native.state('disconnected');
      }
      return;
    }

    // "none" is NOT an immediate disconnect. The page can temporarily
    // remove status elements while React/Y99 rerenders the conversation.
    if (state === 'connected') {
      missingConnectedScans++;

      // Only treat prolonged absence as a disconnect fallback.
      // The regular 1-second safety scan therefore requires ~4 seconds
      // of continuous absence before emitting a disconnect.
      if (missingConnectedScans >= MISSING_CONFIRMATIONS) {
        missingConnectedScans = 0;
        state = 'disconnected';
        Y99Native.state('disconnected');
      }
    }
  }

  var timer = null;

  function schedule() {
    if (timer) return;

    timer = setTimeout(function () {
      timer = null;
      try {
        apply(scan());
      } catch (err) {
        // Never emit a state change just because the page threw an error.
      }
    }, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  setInterval(schedule, 1000); // safety net for visibility-only changes

  window.__y99Watch = { check: schedule };
  schedule();
})();