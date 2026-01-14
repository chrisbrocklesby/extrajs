// extra.js: x.store/x.watch/x.computed + ((...)) templating + x-js + x-if/x-else/x-show/x-bind/x-on/x-for
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
  // x-if / x-else / x-show / x-bind / x-on / x-for
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
        } catch (_) {}
      }
      el.removeAttribute(attr);
      return;
    }

    // Booleans => presence-only
    if (val === true) {
      if (attr in el) {
        try { el[attr] = true; } catch (_) {}
      }
      el.setAttribute(attr, "");
      return;
    }

    // normal value
    if (attr in el) {
      try { el[attr] = val; } catch (_) {}
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
        return; // children are rebuilt, so skip below scans for this element now
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

    el[DIRECTIVE_DONE] = true;
  }

  // =====================
  // extra.js: init + export
  // =====================

  // =====================
  // x-http (ExtraJS HTTP)
  // =====================
  const X_HTTP_BOUND = Symbol("xHttpBound");
  const X_HTTP_POLL_ID = Symbol("xHttpPollId");

  const xHttpJsonCache = new Map();

  function xHttpParseJsonLiteralCached(str, context) {
    if (!str) return null;
    const key = str;
    if (xHttpJsonCache.has(key)) return xHttpJsonCache.get(key);
    let parsed = null;
    try {
      parsed = JSON.parse(str);
      if (!parsed || typeof parsed !== "object") {
        console.warn("ExtraJS x-http: " + context + " JSON must be an object literal:", str);
        parsed = null;
      }
    } catch (err) {
      console.error("ExtraJS x-http: failed to parse " + context + " JSON:", err, "value:", str);
      parsed = null;
    }
    xHttpJsonCache.set(key, parsed);
    return parsed;
  }

  function xHttpResolveMap(map, el) {
    const result = {};
    if (!map || typeof map !== "object") return result;
    for (const key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      const value = map[key];

      if (typeof value === "string" && (value[0] === "#" || value[0] === "[")) {
        const sel = value;
        const target = document.querySelector(sel);
        if (!target) {
          console.warn("ExtraJS x-http: selector '" + sel + "' not found");
          result[key] = null;
          continue;
        }

        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          if (
            target instanceof HTMLInputElement &&
            (target.type === "checkbox" || target.type === "radio")
          ) {
            result[key] = !!target.checked;
          } else {
            result[key] = target.value;
          }
        } else {
          result[key] = target.textContent;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function xHttpFindNearestForm(el) {
    if (!el) return null;
    return el.closest ? el.closest("form") : null;
  }

  function xHttpBuildParamsFromForm(form) {
    const params = new URLSearchParams();
    if (!form) return params;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      params.append(key, value);
    }
    return params;
  }

  function xHttpBuildJsonFromForm(form) {
    const obj = {};
    if (!form) return obj;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const existing = obj[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          obj[key] = [existing, value];
        }
      } else {
        obj[key] = value;
      }
    }
    return obj;
  }

  function xHttpAppendQuery(url, params) {
    const qs = params.toString();
    if (!qs) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + qs;
  }

  function xHttpResolveTarget(el, selector) {
    if (!selector) return el;
    let target = null;
    try {
      target = document.querySelector(selector);
    } catch (err) {
      console.error("ExtraJS x-http: invalid x-target selector:", selector, "on element:", el, err);
    }
    if (!target) {
      console.warn("ExtraJS x-http: x-target selector '" + selector + "' not found, using element itself.");
      return el;
    }
    return target;
  }

  function xHttpResolveIndicator(selector) {
    if (!selector) return null;
    let el = null;
    try {
      el = document.querySelector(selector);
    } catch (err) {
      console.error("ExtraJS x-http: invalid x-indicator selector:", selector, err);
    }
    return el || null;
  }

  function xHttpShowIndicator(indEl) {
    if (!indEl) return;
    const wasHidden = indEl.hasAttribute("hidden");
    indEl.dataset.xIndicatorWasHidden = wasHidden ? "1" : "0";
    if (wasHidden) indEl.removeAttribute("hidden");
  }

  function xHttpHideIndicator(indEl) {
    if (!indEl) return;
    const wasHidden = indEl.dataset.xIndicatorWasHidden === "1";
    if (wasHidden) {
      indEl.setAttribute("hidden", "");
    }
    delete indEl.dataset.xIndicatorWasHidden;
  }

  function xHttpParseTrigger(el) {
    const raw = (el.getAttribute("x-trigger") || "").trim();
    if (!raw) {
      if (el.tagName === "FORM") {
        return { type: "event", event: "submit", delay: 0 };
      }
      return { type: "event", event: "click", delay: 0 };
    }

    if (raw === "load") {
      return { type: "load", delay: 0 };
    }

    if (raw.startsWith("load:")) {
      const ms = parseInt(raw.slice(5), 10);
      return { type: "load", delay: isNaN(ms) ? 0 : ms };
    }

    if (raw.startsWith("every:")) {
      const ms = parseInt(raw.slice(6), 10);
      return { type: "poll", interval: isNaN(ms) ? 1000 : ms };
    }

    const parts = raw.split(":");
    const ev = parts[0];
    if (parts.length > 1) {
      const ms = parseInt(parts[1], 10);
      return { type: "event", event: ev, delay: isNaN(ms) ? 0 : ms };
    }

    return { type: "event", event: raw, delay: 0 };
  }

  function xHttpApplySwap(target, html, mode) {
    if (!target) return;

    const swap = (mode || "inner").toLowerCase();
    let applyRoot = target;

    switch (swap) {
      case "append":
        target.insertAdjacentHTML("beforeend", html);
        break;
      case "prepend":
        target.insertAdjacentHTML("afterbegin", html);
        break;
      case "before":
        target.insertAdjacentHTML("beforebegin", html);
        applyRoot = target.parentNode || target;
        break;
      case "after":
        target.insertAdjacentHTML("afterend", html);
        applyRoot = target.parentNode || target;
        break;
      case "outer":
        {
          const parent = target.parentNode;
          target.outerHTML = html;
          applyRoot = parent || null;
        }
        break;
      case "inner":
      default:
        target.innerHTML = html;
        break;
    }

    try {
      if (typeof xApply === "function") {
        if (applyRoot) {
          xApply(applyRoot);
        } else if (target.parentNode) {
          xApply(target.parentNode);
        } else {
          xApply(document.body || document);
        }
      }
    } catch (err) {
      console.error("ExtraJS x-http: error running x.apply after swap:", err);
    }
  }

  async function xHttpSendRequest(el) {
    if (!(el instanceof Element)) return;

    const cfg = el._xHttpConfig || {};
    const urlAttr = cfg.url || el.getAttribute("x-http");
    if (!urlAttr) return;

    const confirmMsg = el.getAttribute("x-confirm");
    if (confirmMsg != null) {
      const ok = window.confirm(confirmMsg);
      if (!ok) return;
    }

    const method = (cfg.method || el.getAttribute("x-method") || el.getAttribute("method") || "GET").toUpperCase();
    const swapMode = (cfg.swap || el.getAttribute("x-swap") || "inner").toLowerCase();

    const successTarget =
      cfg.successTarget || xHttpResolveTarget(el, el.getAttribute("x-target"));
    const errorTarget =
      cfg.errorTarget ||
      (el.hasAttribute("x-target-error")
        ? xHttpResolveTarget(el, el.getAttribute("x-target-error"))
        : successTarget);

    const indicatorEl =
      cfg.indicatorEl || xHttpResolveIndicator(el.getAttribute("x-indicator"));
    const hasJson = el.hasAttribute("x-json");
    const hasForm = el.hasAttribute("x-form");

    if (hasJson && hasForm) {
      console.error("ExtraJS x-http: cannot use both x-json and x-form on the same element.", el);
      return;
    }

    let url = urlAttr;
    let body = null;
    let contentType = null;

    const isGetLike = method === "GET" || method === "HEAD";

    try {
      xHttpShowIndicator(indicatorEl);

      if (hasJson) {
        const rawJson = el.getAttribute("x-json");
        let payload = {};

        if (!rawJson || !rawJson.trim()) {
          const form = xHttpFindNearestForm(el);
          payload = xHttpBuildJsonFromForm(form);
        } else {
          const map = xHttpParseJsonLiteralCached(rawJson, "x-json");
          payload = xHttpResolveMap(map || {}, el);
        }

        body = JSON.stringify(payload);
        contentType = "application/json";
      } else if (hasForm) {
        const rawForm = el.getAttribute("x-form");
        let params;
        if (!rawForm || !rawForm.trim()) {
          const form = xHttpFindNearestForm(el);
          params = xHttpBuildParamsFromForm(form);
        } else {
          const map = xHttpParseJsonLiteralCached(rawForm, "x-form");
          const payload = xHttpResolveMap(map || {}, el);
          params = new URLSearchParams();
          for (const key in payload) {
            if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
            const v = payload[key];
            params.append(key, v == null ? "" : String(v));
          }
        }

        if (isGetLike) {
          url = xHttpAppendQuery(url, params);
        } else {
          body = params.toString();
          contentType = "application/x-www-form-urlencoded";
        }
      } else {
        const form = xHttpFindNearestForm(el);
        if (form) {
          const params = xHttpBuildParamsFromForm(form);
          if (isGetLike) {
            url = xHttpAppendQuery(url, params);
          } else {
            body = params.toString();
            contentType = "application/x-www-form-urlencoded";
          }
        } else {
          // no body; GET with no body / or explicit method with empty body
        }
      }

      const headers = new Headers();

      if (contentType) {
        headers.set("Content-Type", contentType);
      }

      const rawHeaders = el.getAttribute("x-headers");
      if (rawHeaders && rawHeaders.trim()) {
        const headerMap = xHttpParseJsonLiteralCached(rawHeaders, "x-headers");
        if (headerMap && typeof headerMap === "object") {
          for (const key in headerMap) {
            if (!Object.prototype.hasOwnProperty.call(headerMap, key)) continue;
            const v = headerMap[key];
            if (v != null) {
              headers.set(key, String(v));
            }
          }
        }
      }

      const opts = {
        method: method,
        headers: headers,
      };

      if (!isGetLike && body != null) {
        opts.body = body;
      }

      let response;
      try {
        response = await fetch(url, opts);
      } catch (err) {
        // Network error
        const msg = "Error: NETWORK";
        xHttpApplySwap(errorTarget, msg, swapMode);
        console.error("HTTP NETWORK " + method + " " + url, err);
        return;
      }

      const status = response.status;
      const contentTypeResp = response.headers.get("Content-Type") || "";
      const isJsonResp = contentTypeResp.toLowerCase().indexOf("application/json") !== -1;

      if (status >= 200 && status < 400) {
        // Success: always treat as text/HTML
        const text = await response.text();
        xHttpApplySwap(successTarget, text, swapMode);
      } else {
        // Error handling
        if (isJsonResp) {
          let data = null;
          try {
            data = await response.json();
          } catch (err) {
            // ignore JSON parse error, still show generic message
          }
          const msg = "Error: " + status;
          xHttpApplySwap(errorTarget, msg, swapMode);

          console.error(
            "Error: JSON response not supported by x-http; use x-js for structured errors."
          );
          console.error("HTTP " + status + " " + method + " " + url);
          if (data !== null) {
            console.error("Response JSON:", data);
          }
        } else {
          const text = await response.text();
          xHttpApplySwap(errorTarget, text, swapMode);
          console.error("HTTP " + status + " " + method + " " + url);
        }
      }
    } finally {
      xHttpHideIndicator(indicatorEl);
    }
  }

  function xHttpBindElement(el) {
    if (!(el instanceof Element)) return;
    if (!el.hasAttribute("x-http")) return;
    if (el[X_HTTP_BOUND]) return;

    const url = el.getAttribute("x-http");
    if (!url) {
      console.warn("ExtraJS x-http: x-http attribute is empty on element:", el);
      return;
    }


    const method = (el.getAttribute("x-method") || el.getAttribute("method") || "GET").toUpperCase();
    const swapMode = (el.getAttribute("x-swap") || "inner").toLowerCase();
    const targetSelector = el.getAttribute("x-target");
    const errorTargetSelector = el.getAttribute("x-target-error");
    const indicatorSelector = el.getAttribute("x-indicator");

    const successTarget = xHttpResolveTarget(el, targetSelector);
    const errorTarget = errorTargetSelector
      ? xHttpResolveTarget(el, errorTargetSelector)
      : successTarget;
    const indicatorEl = xHttpResolveIndicator(indicatorSelector);

    el._xHttpConfig = {
      url: url,
      method: method,
      swap: swapMode,
      successTarget: successTarget,
      errorTarget: errorTarget,
      indicatorEl: indicatorEl,
    };
    const trigger = xHttpParseTrigger(el);
    const handler = function (evt) {
      if (evt && trigger && trigger.event === "submit") {
        evt.preventDefault();
      }
      xHttpSendRequest(el);
    };

    if (trigger.type === "poll") {
      const interval = trigger.interval || 1000;
      const id = setInterval(function () {
        xHttpSendRequest(el);
      }, interval);
      el[X_HTTP_POLL_ID] = id;
    } else if (trigger.type === "load") {
      const delay = trigger.delay || 0;
      if (delay > 0) {
        setTimeout(function () {
          xHttpSendRequest(el);
        }, delay);
      } else {
        // queue microtask to run after current stack
        Promise.resolve().then(function () {
          xHttpSendRequest(el);
        });
      }
    } else if (trigger.type === "event") {
      if (trigger.delay && trigger.delay > 0) {
        // debounced event
        let timeoutId = null;
        const debounced = function (evt) {
          if (evt && trigger && trigger.event === "submit") {
            evt.preventDefault();
          }
          const delay = trigger.delay || 0;
          if (timeoutId != null) {
            clearTimeout(timeoutId);
          }
          timeoutId = setTimeout(function () {
            xHttpSendRequest(el);
          }, delay);
        };
        el.addEventListener(trigger.event, debounced);
      } else {
        el.addEventListener(trigger.event, handler);
      }
    }

    el[X_HTTP_BOUND] = true;
  }

  function bindXHttpIn(root) {
    const base = root || (document.body || document);
    if (!base) return;

    if (base instanceof Element && base.hasAttribute("x-http")) {
      xHttpBindElement(base);
    }

    if (base.querySelectorAll) {
      const list = base.querySelectorAll("[x-http]");
      for (let i = 0; i < list.length; i++) {
        xHttpBindElement(list[i]);
      }
    }
  }

  function cleanupXHttpPolling(root) {
    if (!root) return;
    const base = root;
    if (base[X_HTTP_POLL_ID]) {
      clearInterval(base[X_HTTP_POLL_ID]);
      delete base[X_HTTP_POLL_ID];
    }
    if (base.querySelectorAll) {
      const list = base.querySelectorAll("[x-http]");
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (el[X_HTTP_POLL_ID]) {
          clearInterval(el[X_HTTP_POLL_ID]);
          delete el[X_HTTP_POLL_ID];
        }
      }
    }
  }

  // x.apply: x-js + x-http
  function xApply(root) {
    const base =
      typeof root === "string"
        ? document.getElementById(root) ||
          document.querySelector(root) ||
          (document.body || document)
        : root || (document.body || document);

    if (!base) return;

    runXjsAttributes(base);
    bindXHttpIn(base);
  }

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
            if (m.removedNodes && m.removedNodes.length) {
              for (const n of m.removedNodes) {
                if (n.nodeType !== 1) continue;
                cleanupXHttpPolling(n);
              }
            }

            if (m.addedNodes && m.addedNodes.length) {
              for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                // new subtree: templating + directives + x-js + x-http
                try {
                  scanTemplatesIn(n);
                  processDirectives(n);
                  runXjsAttributes(n);
                  bindXHttpIn(n);
                } catch (err) {
                  console.error("extra.js: error while processing added nodes:", err);
                }
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
      initialScanTemplates();                 // ((...)) outside x-for
      processDirectives(document.body || document); // x-if/x-show/x-bind/x-on/x-for
      initXjsRunner();                        // x-js
      bindXHttpIn(document.body || document); // x-http
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
  var xApi = {
    config: config,
    store: xstore,
    watch: xwatch,
    computed: xcomputed,
    apply: xApply,
  };

  // Single official namespace
  window.x = xApi;

  // Optional library alias
  window.extra = xApi;
})();
