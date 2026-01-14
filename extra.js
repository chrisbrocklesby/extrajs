// extra.js: x.store/x.watch/x.computed + ((...)) templating + x-js + x-if/x-else/x-show/x-bind/x-on/x-for + x-load
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
  } catch (err) {
    console.error("extra.js: failed to load session storage state:", err);
  }

  // Global config for extra.js (reserved for future options)
  var config = {
    // add flags here later, e.g. debug: true
  };

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

  // Directives
  var ifBlocksByKey = new Map();     // topKey -> [block]
  var showBlocksByKey = new Map();   // topKey -> [block]
  var bindBlocksByKey = new Map();   // topKey -> [binding]
  var forBlocksByKey = new Map();    // topKey -> [forBlock]
  var DIRECTIVE_DONE = Symbol("extraJsDirectiveDone");

  // ---------- Persistence ----------
  function scheduleSave() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(function () {
      saveScheduled = false;
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(base));
      } catch (err) {
        console.error("extra.js: failed to save session storage state:", err);
      }
    }, 0);
  }

  // ---------- Path parsing: user.name, items[0].qty ----------
  function parsePath(expr) {
    if (typeof expr !== "string") return null;
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
        // unsupported syntax -> treat as invalid path
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
        tokens.push(m[0]); // keep raw, invalid expr left as-is
      }
      last = re.lastIndex;
    }
    if (last < str.length) tokens.push(str.slice(last));
    return { t: tokens, k: keys };
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

  function addBinding(b) {
    bindings.push(b);
    b.k.forEach(function (key) {
      var list = deps.get(key);
      if (!list) deps.set(key, list = []);
      list.push(b);
    });
    // render immediately
    renderBinding(b);
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
      try {
        w.fn(nv, ov);
      } catch (err) {
        console.error("extra.js: x.watch error for path '" + w.parts.join(".") + "':", err);
      }
    }
  }

  function xwatch(path, fn) {
    var parts = parsePath(path);
    if (!parts || typeof fn !== "function") {
      console.warn("extra.js: x.watch: invalid arguments, expected (pathString, function). Got:", path, fn);
      return;
    }
    var top = String(parts[0]);
    var list = watchers.get(top);
    if (!list) watchers.set(top, list = []);
    list.push({ parts: parts, fn: fn, last: undefined, inited: false });
  }

  // ---------- Computed props ----------
  function recomputeComputed(entry) {
    // detach old deps
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
    try {
      val = entry.fn();
    } catch (err) {
      console.error("extra.js: x.computed error for '" + entry.name + "':", err);
      val = undefined;
    }
    currentComputed = null;

    entry.value = val;
    entry.dirty = false;
  }

  function xcomputed(name, fn) {
    if (!name || typeof name !== "string" || typeof fn !== "function") {
      console.warn("extra.js: x.computed: invalid arguments, expected (string, function). Got:", name, fn);
      return;
    }
    computeds[name] = {
      name: name,
      fn: fn,
      deps: new Set(),
      value: undefined,
      dirty: true
    };
  }

  // ---------- Deep proxy for x.store ----------
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
    runIfBlocks(top);
    runShowBlocks(top);
    runBindBlocks(top);
    runForBlocks(top);

    // computed props that depend on that key
    var set = computedDeps.get(top);
    if (!set) return;
    var arr = Array.from(set);
    for (var i = 0; i < arr.length; i++) {
      var entry = arr[i];
      entry.dirty = true;
      recomputeComputed(entry);
      // notify dependents on computed name
      var cname = entry.name;
      notifyBindings(cname);
      runWatchers(cname);
      runIfBlocks(cname);
      runShowBlocks(cname);
      runBindBlocks(cname);
      runForBlocks(cname);
    }
  }

  var xstore = proxify(base, []);

  // ---------- DOM scan for (( ... )) ----------
  function scanTemplatesIn(root, skipTemplates) {
    if (!root) return;

    function hasTemplateAttr(el) {
      return !!(el && el.hasAttribute && (
        el.hasAttribute("x-for") ||
        el.hasAttribute("x-if") ||
        el.hasAttribute("x-else")
      ));
    }

    function isDescendantOfTemplate(el) {
      var cur = el && el.parentNode;
      while (cur) {
        if (cur.nodeType === 1 && hasTemplateAttr(cur)) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    function isTextInTemplate(node) {
      var cur = node && node.parentNode;
      while (cur) {
        if (cur.nodeType === 1 && hasTemplateAttr(cur)) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    // text nodes
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      if (skipTemplates && isTextInTemplate(n)) continue;
      var s = n.nodeValue;
      if (!s || s.indexOf("((") === -1) continue;
      var parsed = parseTemplate(s);
      if (!parsed.k.size) continue;
      addBinding({ n: n, a: null, t: parsed.t, k: parsed.k });
    }

    // attributes (excluding <script>)
    var all = root.getElementsByTagName ? root.getElementsByTagName("*") : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.tagName === "SCRIPT") continue;
      if (skipTemplates) {
        if (el.hasAttribute("x-if") || el.hasAttribute("x-else")) continue;
        if (isDescendantOfTemplate(el)) continue;
      }
      var attrs = el.attributes;
      for (var j = 0; j < attrs.length; j++) {
        var at = attrs[j], val = at.value;
        if (!val || val.indexOf("((") === -1) continue;
        var pa = parseTemplate(val);
        if (!pa.k.size) continue;
        addBinding({ n: el, a: at.name, t: pa.t, k: pa.k });
      }
    }
  }

  function initialScanTemplates() {
    var root = document.body || document;
    scanTemplatesIn(root, true);
  }

  // =====================
  // x-js runner
  // =====================
  const fnCache = new Map();
  const XJS_RAN = Symbol("xjsRan");

  function getXjsCode(el) {
    // Only support x-js (no xjs backwards compat)
    return el.getAttribute("x-js");
  }

  // Run x-js on a single element
  function runXjsOnElement(el) {
    if (!(el instanceof Element)) return;

    const raw = getXjsCode(el);
    if (!raw) return;

    const code = raw.trim();
    if (!code) return;

    let fn = fnCache.get(code);
    if (!fn) {
      try {
        fn = new Function(
          "el",
          "x",
          "store",
          `
            return (async function () {
              with (el) {
                ${code}
              }
            }).call(el);
          `
        );
        fnCache.set(code, fn);
      } catch (err) {
        console.error("extra.js: x-js compile error on element:", el, err);
        // mark as ran to avoid spamming errors on repeated mutations
        el[XJS_RAN] = true;
        return;
      }
    }

    el[XJS_RAN] = true;

    try {
      const result = fn(el, window.x, xstore);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.error("extra.js: x-js async error on element:", el, err);
        });
      }
    } catch (err) {
      console.error("extra.js: x-js runtime error on element:", el, err);
    }
  }

  // Run x-js for root and all descendants
  function runXjsAttributes(root) {
    var baseNode = root || document;
    if (baseNode instanceof Element) {
      const hasAttr = baseNode.hasAttribute("x-js");
      if (hasAttr && !baseNode[XJS_RAN]) runXjsOnElement(baseNode);
    }

    baseNode.querySelectorAll?.("[x-js]").forEach((el) => {
      if (!el[XJS_RAN]) runXjsOnElement(el);
    });
  }

  // =====================
  // x-if / x-else / x-show / x-bind / x-on / x-for / x-load
  // =====================

  // ----- x-if / x-else -----
  function registerIfBlock(block) {
    var list = ifBlocksByKey.get(block.topKey);
    if (!list) ifBlocksByKey.set(block.topKey, list = []);
    list.push(block);
    renderIfBlock(block);
  }

  function runIfBlocks(topKey) {
    var list = ifBlocksByKey.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) renderIfBlock(list[i]);
  }

  function renderIfBlock(block) {
    var condVal = getPath(xstore, block.parts);
    var truthy = !!condVal;
    var wantTemplate = truthy ? block.ifTemplate : block.elseTemplate;

    var cur = block.currentEl || null;

    // if we don't want any element
    if (!wantTemplate) {
      if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
      block.currentEl = null;
      block.currentKind = null;
      return;
    }

    // same kind as before -> keep
    var wantKind = truthy ? "if" : "else";
    if (cur && block.currentKind === wantKind) return;

    // remove old
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);

    // insert new from template
    var clone = wantTemplate.cloneNode(true);
    block.currentKind = wantKind;
    block.currentEl = clone;

    var parent = block.placeholder.parentNode;
    if (!parent) return;
    parent.insertBefore(clone, block.placeholder.nextSibling);

    // process new subtree
    try {
      scanTemplatesIn(clone);
      processDirectives(clone);
      runXjsAttributes(clone);
    } catch (err) {
      console.error("extra.js: x-if render error:", err);
    }
  }

  // ----- x-show -----
  function registerShowBlock(block) {
    var list = showBlocksByKey.get(block.topKey);
    if (!list) showBlocksByKey.set(block.topKey, list = []);
    list.push(block);
    renderShowBlock(block);
  }

  function runShowBlocks(topKey) {
    var list = showBlocksByKey.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) renderShowBlock(list[i]);
  }

  function renderShowBlock(block) {
    var condVal = getPath(xstore, block.parts);
    var truthy = !!condVal;
    block.el.hidden = !truthy;
  }

  // ----- x-bind:* -----
  function registerBindBlock(binding) {
    var list = bindBlocksByKey.get(binding.topKey);
    if (!list) bindBlocksByKey.set(binding.topKey, list = []);
    list.push(binding);
    renderBindBlock(binding);
  }

  function runBindBlocks(topKey) {
    var list = bindBlocksByKey.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) renderBindBlock(list[i]);
  }

  function applyBoundValue(el, attr, val) {
    // null/false/undefined => remove
    if (val == null || val === false) {
      if (attr in el) {
        try {
          if (typeof el[attr] === "boolean") el[attr] = false;
        } catch (_) { }
      }
      el.removeAttribute(attr);
      return;
    }

    // Booleans => presence-only
    if (val === true) {
      if (attr in el) {
        try { el[attr] = true; } catch (_) { }
      }
      el.setAttribute(attr, "");
      return;
    }

    // normal value
    if (attr in el) {
      try { el[attr] = val; } catch (_) { }
    }
    el.setAttribute(attr, String(val));
  }

  function renderBindBlock(binding) {
    var val = getPath(xstore, binding.parts);
    applyBoundValue(binding.el, binding.attr, val);
  }

  // ----- x-on:* -----
  const xOnFnCache = new Map();

  function attachXOn(el, eventName, code) {
    if (!code) return;
    var trimmed = code.trim();
    if (!trimmed) return;

    var key = eventName + "::" + trimmed;
    var fn = xOnFnCache.get(key);
    if (!fn) {
      try {
        fn = new Function(
          "el",
          "event",
          "x",
          "store",
          `
            return (async function () {
              with (el) {
                ${trimmed}
              }
            }).call(el);
          `
        );
        xOnFnCache.set(key, fn);
      } catch (err) {
        console.error("extra.js: x-on compile error for", eventName, "on element:", el, err);
        return;
      }
    }

    el.addEventListener(eventName, function (evt) {
      try {
        var result = fn(el, evt, window.x, xstore);
        if (result && typeof result.catch === "function") {
          result.catch(function (err) {
            console.error("extra.js: x-on async error for", eventName, "on element:", el, err);
          });
        }
      } catch (err) {
        console.error("extra.js: x-on runtime error for", eventName, "on element:", el, err);
      }
    });
  }

  // ----- x-load (GET + HTML swap) -----
  function applyXLoadSwap(target, html, swap) {
    if (!target) return;
    var mode = swap || "inner";

    function initNode(n) {
      try {
        scanTemplatesIn(n, true);
        processDirectives(n);
        runXjsAttributes(n);
      } catch (err) {
        console.error("extra.js: x-load init error on node:", n, err);
      }
    }

    if (mode === "inner") {
      target.innerHTML = html;
      initNode(target);
      return;
    }

    if (mode === "append" || mode === "prepend") {
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      var nodes = Array.from(tmp.childNodes);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (mode === "append") {
          target.appendChild(n);
        } else {
          target.insertBefore(n, target.firstChild);
        }
        initNode(n);
      }
      return;
    }

    // before / after / outer
    var parent = target.parentNode;
    if (!parent) return;

    var tmp2 = document.createElement("div");
    tmp2.innerHTML = html;
    var nodes2 = Array.from(tmp2.childNodes);

    if (mode === "before") {
      for (var j = 0; j < nodes2.length; j++) {
        var nb = nodes2[j];
        parent.insertBefore(nb, target);
        initNode(nb);
      }
      return;
    }

    if (mode === "after") {
      var ref = target.nextSibling;
      for (var k = 0; k < nodes2.length; k++) {
        var na = nodes2[k];
        parent.insertBefore(na, ref);
        initNode(na);
      }
      return;
    }

    if (mode === "outer") {
      for (var m = 0; m < nodes2.length; m++) {
        var no = nodes2[m];
        parent.insertBefore(no, target);
        initNode(no);
      }
      parent.removeChild(target);
      return;
    }

    // fallback -> inner
    target.innerHTML = html;
    initNode(target);
  }

  function xLoadFromEl(el, urlOverride) {
    if (!(el instanceof Element)) return;
    var url = urlOverride || el.getAttribute("x-load");
    if (!url) {
      console.warn("extra.js: x-load with empty URL on element:", el);
      return;
    }

    var target = el;
    var sel = el.getAttribute("x-load:target");
    if (sel) {
      var found = document.querySelector(sel);
      if (found) target = found;
    }

    var swap = el.getAttribute("x-load:swap") || "inner";

    fetch(url, { method: "GET", credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) {
          console.error("extra.js: x-load HTTP error", res.status, "for", url);
        }
        return res.text();
      })
      .then(function (html) {
        if (html == null) return;
        applyXLoadSwap(target, html, swap);
      })
      .catch(function (err) {
        console.error("extra.js: x-load network error for", url, err);
      });
  }

  function registerXLoad(el) {
    var url = el.getAttribute("x-load");
    if (!url) {
      console.warn("extra.js: x-load missing URL on element:", el);
      return;
    }

    var on = el.getAttribute("x-load:on");

    // init default
    if (!on || on === "init") {
      xLoadFromEl(el, url);
      return;
    }

    // interval: every:<ms>
    if (on.startsWith("every:")) {
      var ms = parseInt(on.slice(6), 10);
      if (!isNaN(ms) && ms > 0) {
        setInterval(function () {
          xLoadFromEl(el, url);
        }, ms);
      } else {
        console.warn("extra.js: invalid every:<ms> on x-load:", on);
      }
      return;
    }

    // native DOM event
    el.addEventListener(on, function () {
      xLoadFromEl(el, url);
    });
  }

  // ----- x-for -----
  function parseForExpression(expr) {
    if (typeof expr !== "string") return null;
    expr = expr.trim();
    if (!expr) return null;
    // very simple: "<var> in <path>"
    var m = expr.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+in\s+(.+)$/);
    if (!m) {
      console.warn("extra.js: x-for: invalid expression (expected 'item in path'):", expr);
      return null;
    }
    var varName = m[1];
    var colExpr = m[2].trim();
    var parts = parsePath(colExpr);
    if (!parts) {
      console.warn("extra.js: x-for: invalid collection path in expression:", expr);
      return null;
    }
    return {
      varName: varName,
      parts: parts,
      topKey: String(parts[0])
    };
  }

  function computeForDeps(templateHTML, varName, topKey) {
    var keys = new Set();
    keys.add(topKey);

    var re = /\(\(\s*([^()]+)\s*\)\)/g, m;
    while ((m = re.exec(templateHTML))) {
      var expr = m[1].trim();
      if (!expr) continue;

      // local var usage => already covered by collection topKey
      if (
        expr === varName ||
        expr.startsWith(varName + ".") ||
        expr.startsWith(varName + "[")
      ) {
        continue;
      }

      var parts = parsePath(expr);
      if (parts) keys.add(String(parts[0]));
    }

    return Array.from(keys);
  }

  function renderForItem(templateHTML, varName, item) {
    // Replace ((expr)) in templateHTML
    return templateHTML.replace(/\(\(\s*([^()]+)\s*\)\)/g, function (_, exprRaw) {
      var expr = exprRaw.trim();
      if (!expr) return "";

      // local variable (e.g. product, product.name, product[0].name)
      if (
        expr === varName ||
        expr.startsWith(varName + ".") ||
        expr.startsWith(varName + "[")
      ) {
        var tail = expr.slice(varName.length); // e.g. ".name" or "[0].name"
        if (!tail) return item == null ? "" : String(item);

        var pathStr = "x" + tail; // 'x.name', 'x[0].name'
        var parts = parsePath(pathStr);
        var cur = item;
        if (parts) {
          for (var i = 1; i < parts.length; i++) {
            if (cur == null) break;
            cur = cur[parts[i]];
          }
        } else {
          cur = undefined;
        }
        return cur == null ? "" : String(cur);
      }

      // global store path
      var partsStore = parsePath(expr);
      if (!partsStore) return "";
      var v = getPath(xstore, partsStore);
      return v == null ? "" : String(v);
    });
  }

  function registerForBlock(block) {
    // register under each dependency key
    var keys = block.depsKeys;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var list = forBlocksByKey.get(key);
      if (!list) forBlocksByKey.set(key, list = []);
      list.push(block);
    }
    renderForBlock(block);
  }

  function runForBlocks(topKey) {
    var list = forBlocksByKey.get(topKey);
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      renderForBlock(list[i]);
    }
  }

  function renderForBlock(block) {
    var col = getPath(xstore, block.parts);
    if (!Array.isArray(col)) col = [];

    var el = block.el;
    // clear and rebuild
    el.innerHTML = "";

    for (var i = 0; i < col.length; i++) {
      var item = col[i];
      var html = renderForItem(block.templateHTML, block.varName, item);
      el.insertAdjacentHTML("beforeend", html);
    }

    // process nested directives / x-js in the new children
    try {
      processDirectives(el);
      runXjsAttributes(el);
    } catch (err) {
      console.error("extra.js: x-for render error:", err);
    }
  }

  // ---------- Directive scanner ----------
  function processDirectives(root) {
    var base = root || (document.body || document);
    if (!base) return;

    var walker = document.createTreeWalker(
      base,
      NodeFilter.SHOW_ELEMENT
    );
    var node = base instanceof Element ? base : walker.nextNode();

    if (base instanceof Element) {
      processElementDirectives(base);
    }

    while ((node = walker.nextNode())) {
      processElementDirectives(node);
    }
  }

  function processElementDirectives(el) {
    if (!(el instanceof Element)) return;
    if (el[DIRECTIVE_DONE]) return;

    var hasXIf = el.hasAttribute("x-if");
    var hasXElse = el.hasAttribute("x-else");
    var hasXShow = el.hasAttribute("x-show");
    var hasXFor = el.hasAttribute("x-for");
    var hasXLoad = el.hasAttribute("x-load");

    // x-if (with optional x-else)
    if (hasXIf) {
      var expr = el.getAttribute("x-if") || "";
      el.removeAttribute("x-if");
      var parts = parsePath(expr);
      if (parts) {
        var topKey = String(parts[0]);

        var placeholder = document.createComment("x-if:" + expr);
        var parent = el.parentNode;
        if (parent) parent.insertBefore(placeholder, el);

        // check next sibling for x-else
        var elseTemplate = null;
        var next = el.nextElementSibling;
        if (next && next.hasAttribute("x-else")) {
          next.removeAttribute("x-else");
          elseTemplate = next;
          if (next.parentNode) next.parentNode.removeChild(next);
          next[DIRECTIVE_DONE] = true;
        }

        // detach original template
        if (el.parentNode) el.parentNode.removeChild(el);

        var block = {
          topKey: topKey,
          parts: parts,
          placeholder: placeholder,
          ifTemplate: el,
          elseTemplate: elseTemplate,
          currentEl: null,
          currentKind: null
        };
        el[DIRECTIVE_DONE] = true;
        if (elseTemplate) elseTemplate[DIRECTIVE_DONE] = true;
        registerIfBlock(block);
      } else {
        console.warn("extra.js: invalid x-if expression:", expr, "on element:", el);
      }
    } else if (hasXElse) {
      // x-else without matching x-if => ignore, just strip attribute
      console.warn("extra.js: x-else without a preceding x-if. Element:", el);
      el.removeAttribute("x-else");
    }

    // x-show
    if (hasXShow) {
      var showExpr = el.getAttribute("x-show") || "";
      el.removeAttribute("x-show");
      var showParts = parsePath(showExpr);
      if (showParts) {
        var topShow = String(showParts[0]);
        var showBlock = {
          el: el,
          parts: showParts,
          topKey: topShow
        };
        registerShowBlock(showBlock);
      } else {
        console.warn("extra.js: invalid x-show expression:", showExpr, "on element:", el);
      }
    }

    // x-for (container-based, innerHTML as template)
    if (hasXFor) {
      var forExpr = el.getAttribute("x-for") || "";
      el.removeAttribute("x-for");
      var parsedFor = parseForExpression(forExpr);
      if (parsedFor) {
        var tpl = el.innerHTML;
        var depsKeys = computeForDeps(tpl, parsedFor.varName, parsedFor.topKey);
        var block = {
          el: el,
          varName: parsedFor.varName,
          parts: parsedFor.parts,
          topKey: parsedFor.topKey,
          templateHTML: tpl,
          depsKeys: depsKeys
        };
        el[DIRECTIVE_DONE] = true;
        registerForBlock(block);
        // IMPORTANT: we don't process children here; renderForBlock will.
        // children are rebuilt, so skip below scans for this element now
      } else {
        console.warn("extra.js: ignoring x-for with invalid expression:", forExpr, "on element:", el);
      }
    }

    // x-bind:* attributes
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var at = attrs[i];
      if (!at) continue;
      var name = at.name;
      if (name.slice(0, 7) === "x-bind:") {
        var attrName = name.slice(7);
        if (!attrName) continue;
        var val = at.value || "";
        var partsBind = parsePath(val);
        if (!partsBind) {
          console.warn("extra.js: invalid x-bind expression:", val, "on element:", el);
          continue;
        }
        var topB = String(partsBind[0]);
        var binding = {
          el: el,
          attr: attrName,
          parts: partsBind,
          topKey: topB
        };
        registerBindBlock(binding);
      }
    }

    // x-on:* attributes
    for (var j = 0; j < attrs.length; j++) {
      var at2 = attrs[j];
      if (!at2) continue;
      var n2 = at2.name;
      if (n2.slice(0, 5) === "x-on:") {
        var evtName = n2.slice(5);
        if (!evtName) {
          console.warn("extra.js: x-on without event name on element:", el);
          continue;
        }
        attachXOn(el, evtName, at2.value || "");
      }
    }

    // x-load
    if (hasXLoad) {
      registerXLoad(el);
    }

    el[DIRECTIVE_DONE] = true;
  }

  // =====================
  // extra.js: init + export
  // =====================
  function initXjsRunner() {
    // initial run
    try {
      runXjsAttributes(document);
    } catch (err) {
      console.error("extra.js: initial x-js run failed:", err);
    }

    try {
      const observer = new MutationObserver((muts) => {
        for (const m of muts) {
          if (
            m.type === "attributes" &&
            m.attributeName === "x-js" &&
            m.target instanceof Element
          ) {
            // Attribute changed: allow re-run even if it ran before
            delete m.target[XJS_RAN];
            runXjsOnElement(m.target);
          }

          if (m.type === "childList") {
            for (const n of m.addedNodes) {
              if (n.nodeType !== 1) continue;
              // new subtree: templating + directives + x-js
              try {
                scanTemplatesIn(n, true);
                processDirectives(n);
                runXjsAttributes(n);
              } catch (err) {
                console.error("extra.js: error while processing added nodes:", err);
              }
            }
          }
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["x-js"],
      });
    } catch (err) {
      console.error("extra.js: failed to initialise MutationObserver:", err);
    }
  }

  function initExtraJS() {
    try {
      initialScanTemplates();                      // ((...)) outside x-for
      processDirectives(document.body || document); // x-if/x-show/x-bind/x-on/x-for/x-load
      initXjsRunner();                             // x-js
    } catch (err) {
      console.error("extra.js: init failed:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initExtraJS, { once: true });
  } else {
    initExtraJS();
  }

  // Public API: x.*
  function xapplyPublic(root) {
    var baseNode = root || (document.body || document);
    try {
      scanTemplatesIn(baseNode, true);
      processDirectives(baseNode);
      runXjsAttributes(baseNode);
    } catch (err) {
      console.error("extra.js: x.apply failed:", err);
    }
  }

  function xloadPublic(target, url) {
    if (!target) {
      console.warn("extra.js: x.load requires a target element or selector");
      return;
    }

    var el = target;
    if (!(el instanceof Element)) {
      if (typeof target === "string") {
        el = document.querySelector(target);
      } else {
        console.warn("extra.js: x.load: invalid target:", target);
        return;
      }
    }
    if (!el) {
      console.warn("extra.js: x.load: cannot find element for target:", target);
      return;
    }
    xLoadFromEl(el, url);
  }

  var xApi = {
    config: config,
    store: xstore,
    watch: xwatch,
    computed: xcomputed,
    apply: xapplyPublic,
    load: xloadPublic
  };

  // Single official namespace
  window.x = xApi;

  // Optional library alias
  window.extra = xApi;
})();
