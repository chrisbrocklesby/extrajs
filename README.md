# extraJS

**HTML with extras, Just enough JS, skip the framework...**

ExtraJS is a tiny HTML add-on that brings a few missing extras to standard markup: reactive bindings with `((...))` and inline behavior via `xjs`. The JavaScript layer is intentionally small and secondary — it exists to power those HTML-first features.

```
((title))
<button xjs="xstore.count++">+</button>
```

## The idea
ExtraJS treats HTML as the primary surface. Think of it like Tailwind for behavior: keep small interactions close to the markup, without a framework or build step. Use `<script>` when logic grows, but stay in HTML for the little things.

## What it adds to HTML
- **HTML Template bindings**: `((path))` in text and attributes
- **HTML Tag Inline JS**: `xjs="..."` for tiny interactions
- **JS API Minimal reactive state**: `xstore`, `xcomputed`, `xwatch` to support the above

## What it does not add
- No components, routing, or virtual DOM
- No compiler, no build tools
- No opinionated app structure

## Installation

### Local
```html
<script src="/extra.js"></script>
```

## Quick Start (HTML-first)

```html
<h1>((title))</h1>
<p>Clicks: ((count))</p>
<button xjs="xstore.count++">+</button>

<script>
  xstore.title = "ExtraJS Demo";
  xstore.count = 0;
</script>
```

## HTML Extras

### Template bindings: `((...))`
Bind text or attributes to state paths:
- `((title))`
- `((user.name))`
- `((items[0].qty))`

```html
<h1>((user.name))</h1>
<p>First item: ((items[0].qty))</p>
<button title="((user.name))">Hover me</button>
```

### Inline JS: `xjs="..."`
`xjs` is real JavaScript, inline in your HTML. Use it for small, local behavior: toggles, quick state changes, simple timers, wiring events.

```html
<button xjs="xstore.count++">+</button>
<div xjs="classList.toggle('active')">Toggle</div>
```

Multi-line inline JS:
```html
<div xjs="
  setInterval(() => {
    textContent = new Date().toLocaleTimeString();
  }, 1000);
">
  Time will update here every second
</div>
```

When logic grows, keep it in `<script>` and call it from `xjs`:
```html
<button xjs="increment()">+</button>
<script>
  function increment() {
    xstore.count++;
  }
</script>
```

`xjs` runs once per element and will re-run if the `xjs` attribute changes or a new element is added.

## Minimal JS layer

### `xstore`
A reactive proxy for global state. Updates bindings and watchers.

```js
xstore.title = "Hello";
xstore.user = { name: "Ava" };
xstore.items = [{ qty: 1 }, { qty: 2 }];
```

### `xcomputed(name, fn)`
Define derived values.

```js
xcomputed("fullTitle", () => xstore.title + " #" + xstore.count);
```

Use it in templates:
```html
<h2>((fullTitle))</h2>
```

### `xwatch(path, fn)`
Run code when a specific path changes.

```js
xwatch("count", (nv, ov) => console.log("count:", ov, "->", nv));
xwatch("user.name", (nv) => console.log("name:", nv));
```

## Persistence
State is stored in `sessionStorage` under the key `extrajs_xstore` and restored on load.

## More Examples

### Live clock
```html
<div>Time: ((time))</div>
<script>
  setInterval(() => {
    xstore.time = new Date().toLocaleTimeString();
  }, 1000);
</script>
```

### Derived totals
```js
xstore.cart = [{ qty: 2 }, { qty: 1 }];

xcomputed("totalItems", () =>
  xstore.cart.reduce((sum, item) => sum + item.qty, 0)
);
```

```html
<p>Total items: ((totalItems))</p>
```

### Inline JS for tiny interactions
```html
<button xjs="onclick = () => xstore.count++">Click</button>
<span xjs="onmouseenter = () => classList.add('hot')">Hover me</span>
```

## Notes
- ExtraJS is an HTML enhancement layer; the JS API stays minimal by design.
- Use `xjs` for quick, local behavior. Prefer `<script>` for larger functions and reuse.
- **Security**: `xjs` executes JavaScript from HTML. Avoid injecting untrusted content into `xjs` or `((...))` bindings. If you use a Content Security Policy (CSP), allow inline scripts via nonces/hashes or move logic to `<script>` and call functions from `xjs`. Treat inline code as privileged and keep it local and intentional.

## License
MIT — see LICENSE
