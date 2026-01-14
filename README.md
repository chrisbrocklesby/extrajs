# ExtraJS

A tiny, reactive, no-build HTML framework.
State, templating, directives, inline JS, content loading, and events — all from standard HTML.

- No bundler
- No virtual DOM
- No compile step
- Works in single files or large apps
- Automatic reactivity
- Session persistence built in

Local Install:

```html
<script src="extra.js"></script>
```
CDN Install:
```html
<script src="https://cdn.jsdelivr.net/gh/chrisbrocklesby/extrajs@latest/extra.js"></script>
```

---

## Core Concepts

### 1) Reactive Store

`x.store` is your global state.

```html
<script>
  x.store.count = 0
</script>
```

Changing `x.store` automatically updates anything that depends on it.

---

### 2) Render Values with `((path))`

Use `((...))` anywhere in text or attributes.

```html
<h1>Hello ((user.name))</h1>
<input x-bind:value="user.name">
```

Nested paths are supported:

```txt
((cart.total))
((user.address.city))
((items[0].price))
```

These can reference:

- Plain store values: `x.store.title`, `x.store.user.name`
- Computed values: anything defined via `x.computed("name", fn)`

---

### 3) Inline JS: `x-js`

Run JavaScript when an element appears in the DOM.

```html
<div x-js="this.textContent = x.store.message"></div>
```

Full JS is allowed (including async):

```html
<div x-js="
  const txt = await fetch('/hello.txt').then(r => r.text());
  this.textContent = txt;
"></div>
```

`el` is implicitly `this` inside the block.

---

## Security model (important)

ExtraJS assumes your markup and `x-*` attributes are **trusted**.

- `x-js` and `x-on:*` execute inline JavaScript via `new Function(...)` (and run it in the element’s scope). Treat this like `eval`: **never** run code sourced from user input.
- `x-load` swaps server responses into the DOM using `innerHTML`. If you inject untrusted HTML, you can create XSS.

Practical guidance:

- Only use `x-js` / `x-on:*` with code you ship.
- Only swap HTML from endpoints you control and trust.
- If you must render untrusted content, sanitize it first (or render as text, not HTML) and consider a strict Content Security Policy (CSP).

---

## Directives

### Conditional: `x-if` / `x-else`

```html
<div x-if="loggedIn">Welcome!</div>
<div x-else>Please log in</div>
```

- `x-if` inserts or removes the block.
- Optional `x-else` immediately following acts as the fallback.

---

### Show / Hide (keep in DOM): `x-show`

Toggles visibility via the `hidden` attribute (does not remove the node).

```html
<div x-show="menuOpen">Menu Content</div>
<button x-on:click="x.store.menuOpen = !x.store.menuOpen">Toggle</button>
```

---

### Bind attributes/properties: `x-bind:*`

```html
<input x-bind:value="name">
<div x-bind:class="theme">Styled!</div>
```

- For booleans, presence/absence is handled automatically.
- For other values, both the DOM property and attribute are kept in sync.

---

### Events: `x-on:*`

Attach event handlers that run in the element’s scope.

```html
<button x-on:click="x.store.count++">Add</button>

<input
  x-on:input="
    x.store.name = el.value
  "
>
```

- `el` is the current element.
- You can use `x.store` (or any global) as normal.
- Handlers support async/await.

---

### Loops: `x-for="item in items"`

Repeat markup for each item in an array.

```html
<ul x-for="p in products">
  <li>
    ((p.name)): $((p.price))
  </li>
</ul>

<script>
  x.store.products = [
    { name: "A", price: 10 },
    { name: "B", price: 20 }
  ]
</script>
```

- `p` is the local loop variable.
- Inside the loop you can still reference global store values via `((...))`.

---

### Load HTML: `x-load`

Fetch HTML from a URL and swap it into the DOM.

```html
<div x-load="remote.html">Loading…</div>
```

By default `x-load` runs on initialisation. After the HTML is inserted, ExtraJS re-processes the affected subtree so `((...))`, directives, and `x-js` work inside the loaded content.

#### Target: `x-load:target`

Swap into a different element (CSS selector).

```html
<div id="remoteContent">Loading…</div>

<button
  x-load="remote.html"
  x-load:target="#remoteContent"
  x-load:on="click"
>
  Load into #remoteContent
</button>
```

#### Swap mode: `x-load:swap`

How the response HTML is applied:

- `inner` (default) – `target.innerHTML = response`
- `append` – append inside
- `prepend` – prepend inside
- `before` – insert before target
- `after` – insert after target
- `outer` – replace target entirely

#### Trigger: `x-load:on`

- Omitted or `init` → run once on init
- Any DOM event name (e.g. `click`) → run on that event
- `every:<ms>` → poll repeatedly

```html
<div x-load="remote.html" x-load:on="every:2000">Loading…</div>
```

---

## Computed Properties

Define derived values that automatically recompute when dependencies change.

```html
<script>
  x.store.a = 2
  x.store.b = 3

  x.computed("total", () => x.store.a + x.store.b)
</script>

Total is ((total))
```

Any `((total))` in the DOM updates when `a` or `b` change.

---

## Watchers

Run code whenever a value changes.

```html
<script>
  x.watch("count", (newVal, oldVal) => {
    console.log("count changed:", oldVal, "→", newVal)
  })
</script>
```

The first argument is a path string, e.g. `"count"` or `"user.name"`.

---

## Persisted State

ExtraJS stores `x.store` in `sessionStorage`.

- Values survive page reloads.
- You set state normally: `x.store.foo = "bar"`.
- No extra configuration required.

---

## Manual re-scan

If you add HTML dynamically and want ExtraJS to process new elements:

```js
x.apply()    // process the whole document
x.apply(el)  // process just a specific subtree
```

This re-scans `((...))`, directives, and `x-js` on new nodes.

---

## Full Example

```html
<!DOCTYPE html>
<html>
<body>

<h1>((title))</h1>
<p>Count: ((count))</p>

<button x-on:click="x.store.count++">+</button>
<button x-on:click="x.store.count--">-</button>

<ul x-for="p in products">
  <li>((p.name)) – $((p.price))</li>
</ul>

<div x-if="countHigh">Too high!</div>
<div x-else>Keep going</div>

<hr>

<div x-load="remote.html">Loading…</div>

<script src="extra.js"></script>
<script>
  x.store.title = "ExtraJS Demo"
  x.store.count = 0
  x.store.products = [
    {name:"Product 1", price:12.95},
    {name:"Product 2", price:18.50},
  ]

  x.computed("countHigh", () => x.store.count > 5)
  x.computed("double", () => x.store.count * 2)
  x.watch("count", (n) => console.log("count:", n))
</script>

</body>
</html>
```

---

## API Summary

### Runtime API

| Feature        | Usage                         |
| ------------- | ----------------------------- |
| Global store  | `x.store.foo = 1`             |
| Watch         | `x.watch("foo", fn)`          |
| Computed      | `x.computed("bar", () => …)`  |
| Re-scan DOM   | `x.apply(el)`                 |

### Attributes

| Attribute                     | Purpose                             |
| ---------------------------- | ----------------------------------- |
| `((path))`                   | Render store/computed               |
| `x-js="code"`                | Run inline JS on element load       |
| `x-if="expr"`                | Conditional insert/remove           |
| `x-else`                     | Fallback for preceding `x-if`       |
| `x-show="expr"`              | Toggle `hidden`                     |
| `x-bind:attr="path"`         | Bind property/attribute             |
| `x-on:event="js"`            | Add event listener                  |
| `x-for="item in list"`       | Loop & stamp HTML                   |
| `x-load="/url"`              | Load HTML into the DOM              |
| `x-load:on="init|click|..."` | When to run the load                |
| `x-load:target="#id"`        | Where to swap the response          |
| `x-load:swap="inner|..."`    | How response is applied             |

---

## License

MIT License
See `LICENSE` file.
