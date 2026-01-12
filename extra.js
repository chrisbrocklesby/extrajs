// ExtraJS: xstore/xcomputed/xwatch + ((...)) templating + xjs="..." runner
(function () {
  // =====================
  // Store + templating
  // =====================
  var STORAGE_KEY = "extrajs_xstore";

  // ---------- Load base state from sessionStorage ----------
  var base = {};
  try {
    var raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") base = parsed;
    }
  } catch (_) {}

  var bindings = [];                  // template bindings
  var deps = new Map();               // topKey -> [bindings...]
  var proxyCache = new WeakMap();     // target -> proxy
  var saveScheduled = false;

  // watchers: topKey -> [{ parts, fn, last, inited }]
  var watchers = new Map();

  // computed props
  var computeds = Object.create(null);       // name -> entry
  var computedDeps = new Map();              // topKey -> Set<entry>
  var currentComputed = null;                // entry being evaluated

  // ---------- Persistence ----------
  function scheduleSave() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(function () {
      saveScheduled = false;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(base));
      } catch (_) {}
    }, 0);
  }

  // ---------- Path parsing: user.name, items[0].qty ----------
  function parsePath(expr) {
    expr = expr.trim();
    if (!expr) return null;
    var parts = [];
    var i = 0, len = expr.length;

    function isWs(ch) { return /\s/.test(ch); }
    function isIdStart(ch) { return /[A-Za-z_$]/.test(ch); }
    function isIdPart(ch) { return /[A-Za-z0-9_$]/.test(ch); }
    function skip() { while (i < len && isWs(expr[i])) i++; }
    function ident() {
      if (i >= len || !isIdStart(expr[i])) return null;
      var st = i++;
      while (i < len && isIdPart(expr[i])) i++;
      return expr.slice(st, i);
    }

    skip();
    var first = ident();
    if (!first) return null;
    parts.push(first);
    skip();

    while (i < len) {
      var ch = expr[i];
      if (ch === ".") {
        i++; skip();
        var id = ident();
        if (!id) return null;
        parts.push(id);
        skip();
      } else if (ch === "[") {
        i++; skip();
        var num = "";
        while (i < len && /[0-9]/.test(expr[i])) num += expr[i++];
        skip();
        if (!num || expr[i] !== "]") return null;
        i++;
        parts.push(Number(num));
        skip();
      } else {
        return null;
      }
    }
    return parts;
  }

  // ---------- Get with computed support ----------
  function getPath(rootState, parts) {
    if (!parts || !parts.length) return undefined;
    var first = parts[0], cur, idx;

    // computed root?
    if (Object.prototype.hasOwnProperty.call(computeds, first)) {
      var ce = computeds[first];
      if (!ce) return undefined;
      if (ce.dirty) recomputeComputed(ce);
      cur = ce.value;
      idx = 1;
    } else {
      cur = rootState;
      idx = 0;
    }

    for (; idx < parts.length; idx++) {
      if (cur == null) return undefined;
      cur = cur[parts[idx]];
    }
    return cur;
  }

  // ---------- Template parsing: (( user.name )) ----------
  function parseTemplate(str) {
    var tokens = [];
    var keys = new Set();
    var re = /\(\(\s*([^()]+)\s*\)\)/g;
    var last = 0, m;

    while ((m = re.exec(str))) {
      if (m.index > last) tokens.push(str.slice(last, m.index));
      var expr = m[1];
      var path = parsePath(expr);
      if (path) {
        tokens.push({ p: path });
        keys.add(String(path[0]));
      } else {
        tokens.push(m[0]); // keep raw
      }
      last = re.lastIndex;
    }
    if (last < str.length) tokens.push(str.slice(last));
    return { t: tokens, k: keys };
  }

  function addBinding(b) {
    bindings.push(b);
    b.k.forEach(function (key) {
      var list = deps.get(key);
      if (!list) deps.set(key, list = []);
      list.push(b);
    });
  }

  function renderBinding(b) {
    var out = "", t = b.t;
    for (var i = 0; i < t.length; i++) {
      var x = t[i];
      if (typeof x === "string") out += x;
      else out += (getPath(xstore, x.p) ?? "");
    }
    if (b.a == null) b.n.nodeValue = out;
    else b.n.setAttribute(b.a, out);
  }

  function notifyBindings(topKey) {
    var list = deps.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) renderBinding(list[i]);
  }

  // ---------- Watchers ----------
  function runWatchers(topKey) {
    var list = watchers.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      var nv = getPath(xstore, w.parts);
      if (w.inited && nv === w.last) continue;
      var ov = w.last;
      w.last = nv;
      w.inited = true;
      try { w.fn(nv, ov); }
      catch (err) { console.error("xwatch", err); }
    }
  }

  function xwatch(path, fn) {
    var parts = parsePath(path);
    if (!parts || typeof fn !== "function") return;
    var top = String(parts[0]);
    var list = watchers.get(top);
    if (!list) watchers.set(top, list = []);
    list.push({ parts: parts, fn: fn, last: undefined, inited: false });
  }
  window.xwatch = xwatch;

  // ---------- Computed props ----------
  function recomputeComputed(entry) {
    entry.deps.forEach(function (key) {
      var set = computedDeps.get(key);
      if (set) {
        set.delete(entry);
        if (!set.size) computedDeps.delete(key);
      }
    });
    entry.deps.clear();

    currentComputed = entry;
    var val;
    try { val = entry.fn(); }
    catch (err) {
      console.error("xcomputed", entry.name, err);
      val = undefined;
    }
    currentComputed = null;

    entry.value = val;
    entry.dirty = false;
  }

  function xcomputed(name, fn) {
    if (!name || typeof name !== "string" || typeof fn !== "function") return;
    computeds[name] = {
      name: name,
      fn: fn,
      deps: new Set(),
      value: undefined,
      dirty: true
    };
  }
  window.xcomputed = xcomputed;

  // ---------- Deep proxy for xstore ----------
  function proxify(target, path) {
    if (target === null || typeof target !== "object") return target;
    var ex = proxyCache.get(target);
    if (ex) return ex;

    var p = new Proxy(target, {
      get: function (t, prop, r) {
        if (prop === "__raw") return t;
        var v = Reflect.get(t, prop, r);

        // dependency tracking for computed
        if (currentComputed && typeof prop !== "symbol") {
          var top = path.length ? path[0] : String(prop);
          currentComputed.deps.add(top);
          var set = computedDeps.get(top);
          if (!set) computedDeps.set(top, set = new Set());
          set.add(currentComputed);
        }

        if (v && typeof v === "object") return proxify(v, path.concat(String(prop)));
        return v;
      },
      set: function (t, prop, value, r) {
        if (typeof prop === "symbol") return Reflect.set(t, prop, value, r);
        var old = t[prop];
        if (old === value) return true;
        t[prop] = value;
        scheduleSave();
        handleChange(path.length ? path[0] : String(prop));
        return true;
      },
      deleteProperty: function (t, prop) {
        if (typeof prop === "symbol") return Reflect.deleteProperty(t, prop);
        if (!(prop in t)) return true;
        delete t[prop];
        scheduleSave();
        handleChange(path.length ? path[0] : String(prop));
        return true;
      }
    });

    proxyCache.set(target, p);
    return p;
  }

  function handleChange(top) {
    // state bindings + watchers on that key
    notifyBindings(top);
    runWatchers(top);

    // computed props that depend on that key
    var set = computedDeps.get(top);
    if (!set) return;
    var arr = Array.from(set);
    for (var i = 0; i < arr.length; i++) {
      var entry = arr[i];
      entry.dirty = true;
      recomputeComputed(entry);
      // notify bindings and watchers on computed name
      notifyBindings(entry.name);
      runWatchers(entry.name);
    }
  }

  var xstore = proxify(base, []);
  window.xstore = xstore;

  // ---------- DOM scan for (( ... )) ----------
  function scanTemplates() {
    var root = document.body || document;

    // text nodes
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while (n = walker.nextNode()) {
      var s = n.nodeValue;
      if (!s || s.indexOf("((") === -1) continue;
      var parsed = parseTemplate(s);
      if (!parsed.k.size) continue;
      addBinding({ n: n, a: null, t: parsed.t, k: parsed.k });
    }

    // attributes (excluding <script>)
    var all = root.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.tagName === "SCRIPT") continue;
      var attrs = el.attributes;
      for (var j = 0; j < attrs.length; j++) {
        var at = attrs[j], val = at.value;
        if (!val || val.indexOf("((") === -1) continue;
        var pa = parseTemplate(val);
        if (!pa.k.size) continue;
        addBinding({ n: el, a: at.name, t: pa.t, k: pa.k });
      }
    }

    // initial render
    for (var k = 0; k < bindings.length; k++) renderBinding(bindings[k]);
  }

  // =====================
  // xjs="..." runner
  // =====================
  const fnCache = new Map();
  const XJS_RAN = Symbol("xjsRan");

  // Run xjs="..." or data-xjs="..." on a single element
  function runXjsOnElement(el) {
    if (!(el instanceof Element)) return;

    const raw = el.getAttribute("xjs") || el.getAttribute("data-xjs");
    if (!raw) return;

    const code = raw.trim();

    let fn = fnCache.get(code);
    if (!fn) {
      fn = new Function(
        "el",
        `
          return (async function () {
            with (el) {
              ${code}
            }
          }).call(el);
        `
      );
      fnCache.set(code, fn);
    }

    el[XJS_RAN] = true;

    try {
      const result = fn(el);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.error("xjs async error on element:", el, err);
        });
      }
    } catch (err) {
      console.error("xjs error on element:", el, err);
    }
  }

  // Run xjs="..." or data-xjs="..." for root and all descendants
  function runXjsAttributes(root = document) {
    if (
      root instanceof Element &&
      (root.hasAttribute("xjs") || root.hasAttribute("data-xjs")) &&
      !root[XJS_RAN]
    ) {
      runXjsOnElement(root);
    }

    root.querySelectorAll?.("[xjs],[data-xjs]").forEach((el) => {
      if (!el[XJS_RAN]) runXjsOnElement(el);
    });
  }

  function initXjsRunner() {
    // initial run
    runXjsAttributes(document);

    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (
          m.type === "attributes" &&
          (m.attributeName === "xjs" || m.attributeName === "data-xjs") &&
          m.target instanceof Element
        ) {
          // Attribute changed: allow re-run even if it ran before
          delete m.target[XJS_RAN];
          runXjsOnElement(m.target);
        }

        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            runXjsAttributes(n);
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["xjs", "data-xjs"],
    });
  }

  // =====================
  // ExtraJS init + export
  // =====================
  function initExtraJS() {
    scanTemplates();
    initXjsRunner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initExtraJS, { once: true });
  } else {
    initExtraJS();
  }

  // Public facade
  window.ExtraJS = {
    store: xstore,
    watch: xwatch,
    computed: xcomputed,
    runXjs: runXjsAttributes,
  };

})();
