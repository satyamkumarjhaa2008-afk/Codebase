(function () {
  // Already running in this document: just force a re-check.
  if (window.__y99Watch) { window.__y99Watch.check(); return; }

  // Y99 system lines (matched against short, visible text nodes only).
  var CONNECTED = /(^|[^a-z])connected to (a )?stranger/;
  var ENDED = /chat (has )?ended|conversation (has )?ended|stranger (has )?(disconnected|left)|you (have )?disconnected/;

  var state = null; // null | 'connected' | 'disconnected'

  function visible(el) {
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
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
      if (c) lastConn = seq; else lastEnd = seq;
    }
    if (lastConn > lastEnd) return 'connected';
    return lastEnd >= 0 ? 'disconnected' : 'none';
  }

  function apply(result) {
    var next = state;
    if (result === 'connected') next = 'connected';
    else if (result === 'disconnected') next = 'disconnected';
    else if (state === 'connected') next = 'disconnected'; // active conversation vanished
    if (next === state) return;
    var prev = state;
    state = next;
    // Only real transitions are reported (initial "disconnected" is silent).
    if (next === 'connected' || prev === 'connected') Y99Native.state(next);
  }

  var timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      try { apply(scan()); } catch (err) { /* stay silent */ }
    }, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });
  setInterval(schedule, 1000); // safety net for visibility-only changes

  window.__y99Watch = { check: schedule };
  schedule();
})();