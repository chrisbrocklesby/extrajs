# ExtraJS

Extra power, minimum JS.

ExtraJS is a tiny **JavaScript library** for browser UIs with zero build tools. It gives you reactive state, computed values, watchers, and a simple templating syntax using `((...))`. No framework, no virtual DOM, no compiler.

```
((title))
<button xjs="xstore.count++">+</button>
```

## Why ExtraJS
- **Library, not a framework**: drop it into any HTML page and keep your existing setup.
- **Tiny surface area**: a few global APIs, easy to learn, easy to remove.
- **No build step**: just a script tag.
- **Reactive updates**: templates and watchers update when state changes.
- **Works everywhere**: plain browser JavaScript.

## Features
- **Global reactive store**: `xstore`
- **Computed values**: `xcomputed(name, fn)`
- **Watchers**: `xwatch(path, fn)`
- **Inline JS actions**: `xjs="..."`
- **Template binding**: `((path))`
- **Session persistence**: state saved to `sessionStorage`

## Installation

### Local
```html
<script src="/extra.js"></script>
```

## Quick Start

```html
<h1>((title))</h1>
<p>Clicks: ((count))</p>
<button xjs="xstore.count++">+</button>

<script>
  xstore.title = "ExtraJS Demo";
  xstore.count = 0;
</script>
```

## API

### `xstore`
A reactive proxy for your global state. Any change triggers template updates and watchers.

```js
xstore.title = "Hello";
xstore.user = { name: "Ava" };
xstore.items = [{ qty: 1 }, { qty: 2 }];
```

### `xcomputed(name, fn)`
Defines a computed value that automatically tracks dependencies.

```js
xcomputed("fullTitle", () => xstore.title + " #" + xstore.count);
```

Use it in templates:
```html
<h2>((fullTitle))</h2>
```

### `xwatch(path, fn)`
Runs when a specific path changes. Receives `(newValue, oldValue)`.

```js
xwatch("count", (nv, ov) => console.log("count:", ov, "->", nv));
xwatch("user.name", (nv) => console.log("name:", nv));
```

### `xjs="..."`
Runs inline JS on an element. The code runs with `this` and `el` bound to the element.

```html
<button xjs="xstore.count++">+</button>
<div xjs="classList.toggle('active')">Toggle</div>
```

## Templates

Template bindings use the `((...))` syntax with simple paths:
- `((title))`
- `((user.name))`
- `((items[0].qty))`

```html
<h1>((user.name))</h1>
<p>First item: ((items[0].qty))</p>
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

### Watch and react
```js
xwatch("cart", () => {
  console.log("cart changed", xstore.cart);
});
```

### Attribute binding
```html
<button title="((user.name))">Hover me</button>
```

## Notes
- Designed to be small and direct. If you need routing, components, or SSR, pair ExtraJS with other tools.
- Uses `sessionStorage` by default for persistence.

## License
MIT — see LICENSE
