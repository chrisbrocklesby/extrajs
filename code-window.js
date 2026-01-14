// code-window.js
// <script src="code-window.js" defer></script>
// <code-window filename="demo.js" language="javascript"> ... </code-window>

(function () {
  // ---------- Base styles ----------
  const BASE_STYLE_ID = "code-window-base-styles";
  function injectBaseStyles() {
    if (document.getElementById(BASE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = BASE_STYLE_ID;
    style.textContent = `
      .cw-window {
        border-radius: 24px;
        overflow: hidden;
        background: #0b1120;
        border: 1px solid #1f2937;
        box-shadow: 0 10px 30px rgba(0,0,0,.5),0 0 0 1px rgba(15,23,42,.7);
        font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .cw-titlebar {
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:0.55rem 0.85rem;
        background:linear-gradient(to bottom,#111827,#020617);
        border-bottom:1px solid #1f2937;
        gap:0.75rem;
      }
      .cw-title-left {display:flex;align-items:center;min-width:0;}
      .cw-dots {display:flex;gap:0.35rem;flex-shrink:0;}
      .cw-dot {width:0.7rem;height:0.7rem;border-radius:999px;}
      .cw-dot.red{background:#f87171;}
      .cw-dot.yellow{background:#facc15;}
      .cw-dot.green{background:#34d399;}
      .cw-filename {
        margin-left:0.75rem;
        font-size:0.78rem;
        color:#e5e7eb;
        opacity:0.9;
        white-space:nowrap;
        text-overflow:ellipsis;
        overflow:hidden;
      }

      /* --- BETTER COPY BUTTON --- */
      .cw-copy {
        font-size:0.72rem;
        padding:0.25rem 0.65rem;
        border-radius:8px;
        border:1px solid rgba(99,102,241,0.6);
        background:rgba(30,41,59,0.7);
        color:#c7d2fe;
        cursor:pointer;
        line-height:1.3;
        white-space:nowrap;
        transition:all .15s ease;
      }
      .cw-copy:hover {
        background:rgba(59,130,246,0.4);
        border-color:rgba(147,197,253,0.9);
        color:white;
      }
      .cw-copy:active {
        transform:scale(.97);
      }

      .cw-body {
        background:transparent;
        padding:0.9rem 1.1rem;
        overflow:auto;
      }
      .cw-body pre {
        margin:0;
        background:transparent !important;
        font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Courier New",monospace;
        font-size:0.92rem; /* slightly larger */
        line-height:1.55;
      }
      .cw-body code {
        display:block;
        background:transparent !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- highlight.js loader ----------
  let hljsLoaded = false, hljsLoading = false;
  const queue = [];

  function loadHLJS() {
    if (hljsLoaded || hljsLoading) return;
    hljsLoading = true;

    const theme = document.createElement("link");
    theme.rel = "stylesheet";
    theme.href =
      "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css";
    document.head.appendChild(theme);

    const override = document.createElement("style");
    override.textContent = `.hljs { background:transparent !important; }`;
    document.head.appendChild(override);

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
    script.onload = () => {
      hljsLoaded = true;
      if (!window.hljs) return;
      queue.forEach((el) => {
        try { window.hljs.highlightElement(el); } catch {}
      });
      queue.length = 0;
    };
    document.head.appendChild(script);
  }

  function requestHighlight(el) {
    if (!el) return;
    if (hljsLoaded && window.hljs) {
      try { window.hljs.highlightElement(el); } catch {}
      return;
    }
    queue.push(el);
    loadHLJS();
  }

  // ---------- indentation stripper ----------
  function cleanContent(raw) {
    if (!raw) return "";
    let lines = raw.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return "";
    const indents = lines
      .filter((l) => l.trim())
      .map((l) => (l.match(/^[ \t]*/)?.[0].length ?? 0));
    const minIndent = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(minIndent)).join("\n");
  }

  // ---------- <code-window> ----------
  class CodeWindow extends HTMLElement {
    constructor() { super(); this._init = false; }

    static get observedAttributes() { return ["filename","language"]; }

    connectedCallback() {
      injectBaseStyles();
      this._render();
    }

    attributeChangedCallback() {
      if (!this._init) return;
      this._render();
    }

    _attachCopyHandler() {
      const btn = this.querySelector(".cw-copy");
      const codeEl = this.querySelector("code");
      if (!btn || !codeEl || btn._bound) return;
      btn._bound = true;

      btn.addEventListener("click", async () => {
        const source = codeEl.textContent || "";
        const original = btn.textContent;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(source);
          } else {
            const tmp = document.createElement("textarea");
            tmp.value = source;
            tmp.style.position = "fixed";
            tmp.style.left = "-9999px";
            document.body.appendChild(tmp);
            tmp.select();
            document.execCommand("copy");
            document.body.removeChild(tmp);
          }
          btn.textContent = "Copied!";
          setTimeout(() => btn.textContent = original, 1200);
        } catch {
          btn.textContent = "Error";
          setTimeout(() => btn.textContent = original, 1200);
        }
      });
    }

    _render() {
      const filename = this.getAttribute("filename") || "";
      const lang = this.getAttribute("language") || "";

      if (!this._init) {
        const raw = cleanContent(this.textContent || "");

        this.innerHTML = `
          <div class="cw-window">
            <div class="cw-titlebar">
              <div class="cw-title-left">
                <div class="cw-dots">
                  <span class="cw-dot red"></span>
                  <span class="cw-dot yellow"></span>
                  <span class="cw-dot green"></span>
                </div>
                <span class="cw-filename"></span>
              </div>
              <button type="button" class="cw-copy">Copy</button>
            </div>
            <div class="cw-body">
              <pre><code></code></pre>
            </div>
          </div>
        `;
        this._init = true;

        const fnameEl = this.querySelector(".cw-filename");
        const codeEl = this.querySelector("code");
        if (fnameEl) fnameEl.textContent = filename;
        if (codeEl) {
          codeEl.textContent = raw;
          if (lang) codeEl.classList.add("language-" + lang);
          requestHighlight(codeEl);
        }
        this._attachCopyHandler();
      } else {
        const fnameEl = this.querySelector(".cw-filename");
        const codeEl = this.querySelector("code");

        if (fnameEl) fnameEl.textContent = filename;
        if (codeEl) {
          codeEl.className = "";
          if (lang) codeEl.classList.add("language-" + lang);
          requestHighlight(codeEl);
        }
        this._attachCopyHandler();
      }
    }
  }

  if (!customElements.get("code-window")) {
    customElements.define("code-window", CodeWindow);
  }
})();
