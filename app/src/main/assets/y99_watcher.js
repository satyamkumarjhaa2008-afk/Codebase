(() => {
  if (window.__y99Inspector && window.__y99Inspector.version === 2) {
    window.__y99Inspector.ping();
    return;
  }

  const N = window.Y99Native;
  const PREFIX = "[Y99-INSPECTOR]";
  let seq = 0;
  let lastSnapshot = "";
  let state = "unknown";
  let connectedEvidence = 0;
  let disconnectedEvidence = 0;

  const safe = (v, max = 1400) => {
    try {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return (s || "").replace(/\s+/g, " ").slice(0, max);
    } catch (_) { return String(v).slice(0, max); }
  };

  function log(kind, data) {
    const payload = { seq: ++seq, t: Date.now(), kind, data };
    try { console.log(PREFIX, JSON.stringify(payload)); } catch (_) {}
    try { N && N.event(JSON.stringify(payload)); } catch (_) {}
  }

  function visible(el) {
    return !!el && !!el.getClientRects && el.getClientRects().length > 0 &&
      getComputedStyle(el).display !== "none" &&
      getComputedStyle(el).visibility !== "hidden";
  }

  function bodySummary() {
    return (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2500);
  }

  function elementSummary(el) {
    if (!el || el.nodeType !== 1) return {};
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName, id: el.id || "",
      cls: typeof el.className === "string" ? el.className.slice(0, 300) : "",
      role: el.getAttribute("role") || "",
      aria: el.getAttribute("aria-label") || "",
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 600),
      visible: visible(el),
      rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}
    };
  }

  function emitState(next, evidence, confidence) {
    if (next === state) return;
    const previous = state;
    state = next;
    log("state-transition", {previous, next, confidence, evidence});
    try { N && N.state(next); } catch (_) {}
  }

  function inferStateFromText(text, source) {
    const t = (text || "").toLowerCase();
    const connected = [
      /connected to (an )?stranger/, /stranger connected/,
      /you are connected/, /chatting with/
    ].some(r => r.test(t));
    const disconnected = [
      /chat (has )?ended/, /conversation (has )?ended/,
      /stranger (has )?(disconnected|left)/, /you (have )?disconnected/,
      /waiting for (a )?stranger/, /searching for (a )?stranger/,
      /looking for (a )?stranger/
    ].some(r => r.test(t));

    if (connected) {
      connectedEvidence++;
      disconnectedEvidence = 0;
      emitState("connected", {source, text: t.slice(0, 700)}, connectedEvidence >= 2 ? "high" : "medium");
    } else if (disconnected) {
      disconnectedEvidence++;
      connectedEvidence = 0;
      emitState("disconnected", {source, text: t.slice(0, 700)}, disconnectedEvidence >= 2 ? "high" : "medium");
    }
  }

  function snapshot(reason) {
    const frames = [...document.querySelectorAll("iframe")].map(f => ({
      src: f.getAttribute("src") || "", name: f.getAttribute("name") || "",
      title: f.getAttribute("title") || ""
    })).slice(0, 25);

    const snap = {
      reason, url: location.href, title: document.title, ready: document.readyState,
      body: bodySummary(), frames,
      active: elementSummary(document.activeElement),
      visibility: document.visibilityState, hidden: document.hidden
    };
    const key = safe(snap, 7000);
    if (key !== lastSnapshot) {
      lastSnapshot = key;
      log("snapshot", snap);
      inferStateFromText(snap.body, "snapshot");
    }
  }

  const hp = history.pushState, hr = history.replaceState;
  history.pushState = function() {
    const r = hp.apply(this, arguments);
    log("history.pushState", {url: location.href});
    snapshot("pushState");
    return r;
  };
  history.replaceState = function() {
    const r = hr.apply(this, arguments);
    log("history.replaceState", {url: location.href});
    snapshot("replaceState");
    return r;
  };
  addEventListener("popstate", () => { log("popstate", {url: location.href}); snapshot("popstate"); });
  addEventListener("hashchange", () => { log("hashchange", {url: location.href}); snapshot("hashchange"); });

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function() {
      const input = arguments[0];
      const url = typeof input === "string" ? input : (input?.url || "");
      const method = arguments[1]?.method || input?.method || "GET";
      log("fetch.request", {url: safe(url, 1000), method});
      return originalFetch.apply(this, arguments).then(resp => {
        log("fetch.response", {url: safe(resp.url || url, 1000), status: resp.status, ok: resp.ok});
        return resp;
      }).catch(err => {
        log("fetch.error", {url: safe(url, 1000), error: safe(err)});
        throw err;
      });
    };
  }

  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__y99Meta = {method, url: String(url)};
    return xo.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    const meta = this.__y99Meta || {}, xhr = this;
    log("xhr.request", meta);
    xhr.addEventListener("load", () => log("xhr.response", {
      url: meta.url, method: meta.method, status: xhr.status, responseURL: xhr.responseURL
    }), {once:true});
    xhr.addEventListener("error", () => log("xhr.error", meta), {once:true});
    xhr.addEventListener("abort", () => log("xhr.abort", meta), {once:true});
    return xs.apply(this, arguments);
  };

  const NativeWS = window.WebSocket;
  if (NativeWS) {
    const WrappedWS = function(url, protocols) {
      const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
      log("ws.create", {url: String(url)});
      ws.addEventListener("open", () => log("ws.open", {url: String(url)}));
      ws.addEventListener("message", e => log("ws.message", {url: String(url), data: safe(e.data, 2000)}));
      ws.addEventListener("close", e => log("ws.close", {url: String(url), code: e.code, reason: e.reason, clean: e.wasClean}));
      ws.addEventListener("error", () => log("ws.error", {url: String(url)}));
      const send = ws.send.bind(ws);
      ws.send = function(data) {
        log("ws.send", {url: String(url), data: safe(data, 2000)});
        return send(data);
      };
      return ws;
    };
    WrappedWS.prototype = NativeWS.prototype;
    window.WebSocket = WrappedWS;
  }

  addEventListener("message", e => log("window.message", {
    origin: e.origin, source: e.source === window ? "window" : "other", data: safe(e.data, 2000)
  }));

  const observer = new MutationObserver(mutations => {
    const interesting = mutations.slice(0, 50).map(m => ({
      type: m.type,
      target: elementSummary(m.target),
      added: [...m.addedNodes].slice(0, 8).map(elementSummary),
      removed: [...m.removedNodes].slice(0, 8).map(elementSummary),
      attr: m.attributeName || "",
      oldValue: m.oldValue || "",
      newValue: m.type === "attributes" ? (m.target.getAttribute(m.attributeName) || "") : ""
    }));
    log("dom.mutations", interesting);
    inferStateFromText(bodySummary(), "dom.mutation");
    snapshot("dom.mutation");
  });

  function observe(doc) {
    try {
      observer.observe(doc.documentElement, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeOldValue: true, characterDataOldValue: true
      });
    } catch (_) {}
  }
  observe(document);

  function hookFrame(frame) {
    try { if (frame.contentDocument) observe(frame.contentDocument); } catch (_) {}
    frame.addEventListener("load", () => {
      log("iframe.load", {src: frame.getAttribute("src") || ""});
      try { observe(frame.contentDocument); } catch (_) {}
      snapshot("iframe.load");
    });
  }
  document.querySelectorAll("iframe").forEach(hookFrame);

  new MutationObserver(muts => {
    muts.forEach(m => [...m.addedNodes].forEach(n => {
      if (n.nodeType === 1) {
        if (n.tagName === "IFRAME") hookFrame(n);
        n.querySelectorAll?.("iframe").forEach(hookFrame);
      }
    }));
  }).observe(document.documentElement, {childList:true, subtree:true});

  addEventListener("visibilitychange", () => {
    log("visibility", {state: document.visibilityState, hidden: document.hidden});
    snapshot("visibility");
  });
  ["online","offline"].forEach(name => addEventListener(name, () => {
    log("network", {name});
    snapshot("network");
  }));
  ["click","input","change"].forEach(name => document.addEventListener(name, e =>
    log("ui."+name, {target: elementSummary(e.target)}), true));

  window.__y99Inspector = {
    version: 2,
    ping: () => log("ping", {url: location.href}),
    snapshot: () => snapshot("manual")
  };

  log("started", {url: location.href, ready: document.readyState});
  snapshot("start");
  setInterval(() => { try { snapshot("poll"); } catch (_) {} }, 1000);
})();