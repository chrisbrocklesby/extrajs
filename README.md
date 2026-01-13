# ExtraJS

A tiny, reactive, no-build HTML framework.
State, templating, directives, inline JS, HTTP, and events — all from standard HTML.

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
<button x-on:click="x.store.menuOpen = !menuOpen">Toggle</button>
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
<ul>
  <li x-for="p in products">
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

## HTTP Requests: `x-http`

ExtraJS includes a small HTTP helper that plugs into the same attribute style.

### Basic idea

Attach `x-http` to any element to trigger a fetch:

```html
<button x-http="/api/ping">Ping</button>
```

By default:

- Non-forms trigger on `click`
- Forms trigger on `submit`
- Response HTML/text is swapped into the same element (`inner`)

All behavior is controlled with attributes.

### Core attributes

#### `x-http` (required)

The URL to request.

```html
<button x-http="/api/time">Get Time</button>
```

#### `x-method`

HTTP method override:

```html
<button x-http="/api/items" x-method="POST">Create</button>
```

Defaults:

- Uses `x-method` if present
- Else `<form method="...">` when inside a form
- Else `GET`

#### `x-target` and `x-target-error`

Where to put the response.

```html
<button
  x-http="/api/partial"
  x-target="#result"
>
  Load partial
</button>

<div id="result"></div>
```

- `x-target` — success target (default: element itself)
- `x-target-error` — error target (default: same as success target)

#### `x-swap`

How the response HTML is applied:

- `inner` (default) – `target.innerHTML = response`
- `append` – append inside
- `prepend` – prepend inside
- `before` – insert before target
- `after` – insert after target
- `outer` – replace target entirely

```html
<button
  x-http="/comments"
  x-target="#comments"
  x-swap="append"
>
  Load more
</button>
```

After the swap, `x.apply` is called on the smallest affected subtree so new `x-*` attributes are wired up.

---

### Triggers: `x-trigger`

Controls *when* the request fires.

Defaults:

- Non-form elements: `click`
- Forms: `submit`

#### Event triggers

```html
<button x-http="/api/save" x-trigger="click">Save</button>
<form x-http="/api/save" x-trigger="submit">...</form>
```

#### Debounced events: `event:ms`

```html
<input
  x-http="/api/search"
  x-trigger="input:300"
  x-json
  x-target="#results"
/>
<div id="results"></div>
```

- Waits 300ms after the last input event before sending.
- New events reset the timer.

#### Load-once: `load` / `load:ms`

```html
<div x-http="/hero.html" x-trigger="load"></div>

<div
  x-http="/slow-section"
  x-trigger="load:500"
>
  Loading...
</div>
```

- `load` – fire once when element is initialised.
- `load:500` – delay by 500ms.

#### Polling: `every:ms`

```html
<div
  x-http="/api/metrics"
  x-trigger="every:2000"
  x-target="#metrics"
>
  Loading...
</div>

<div id="metrics"></div>
```

- Repeats every `ms` until the element is removed from the DOM.
- Polling timers are cleaned up when nodes are detached.

---

### Indicators: `x-indicator`

Show/hide a loading indicator while the request is in-flight.

```html
<button
  x-http="/api/submit"
  x-indicator="#saving"
>
  Save
</button>

<span id="saving" hidden>Saving…</span>
```

- Indicator is un-hidden while the request runs.
- Previous `hidden` state is restored afterwards.

---

### Headers: `x-headers`

JSON literal of extra headers. These override defaults.

```html
<button
  x-http="/api/secure"
  x-headers='{"X-Token": "abc123"}'
>
  Secure call
</button>
```

Automatic `Content-Type`:

- `application/json` when using `x-json`
- `application/x-www-form-urlencoded` when sending form-style bodies

Your custom headers always win if they set the same key.

---

### Confirm dialogs: `x-confirm`

Ask before sending.

```html
<button
  x-http="/api/delete"
  x-method="DELETE"
  x-confirm="Are you sure you want to delete this item?"
>
  Delete
</button>
```

- Uses `window.confirm`.
- If the user cancels, the request is aborted silently.

---

### Body selection: `x-form` and `x-json`

There are three modes: none, `x-form`, or `x-json`. You cannot combine `x-form` and `x-json` on the same element.

Rules:

- If **both** `x-form` and `x-json` are present → log an error and abort.
- If `x-json` is present → send JSON body.
- Else if `x-form` is present → send form-style body.
- Else:
  - If inside a `<form>`:
    - `GET` → encode form fields as query string
    - non-`GET` → send URL-encoded form body
  - If not in a form → send no body (`GET` by default)

#### Using `x-json`

1) No value: use nearest form as a JS object then `JSON.stringify`:

```html
<form id="login">
  <input name="user">
  <input name="pass" type="password">

  <button
    x-http="/api/login"
    x-json
  >
    Login
  </button>
</form>
```

2) With a JSON map: literals and DOM selectors:

```html
<button
  x-http="/api/login"
  x-json='{
    "username": "#user",
    "password": "#pass",
    "remember": true
  }'
>
  Login
</button>

<input id="user" name="user">
<input id="pass" name="pass" type="password">
```

Map resolution:

- **Keys** are field names.
- **Values**:
  - Literal JSON values are used as-is.
  - Selector strings starting with `#` or `[`:
    - `querySelector` is used to find an element.
    - If it is an `<input>`, `<textarea>`, or `<select>`:
      - `checkbox`/`radio` → `.checked`
      - else → `.value`
    - Anything else → `.textContent`
  - If selector not found:
    - Logs `ExtraJS x-http: selector '#id' not found`
    - Uses `null` for that field.

> When using a map (`{…}`) for `x-json`, form fields are **not** merged in. Only the map is used.

#### Using `x-form`

1) No value: use nearest form fields.

```html
<form x-http="/api/submit" x-form>
  <input name="name">
  <input name="email">
  <button>Submit</button>
</form>
```

- For `GET`: fields become query string.
- For non-`GET`: fields become URL-encoded body.

2) With a map: build URL-encoded body from a JSON map (same selector rules as `x-json`):

```html
<button
  x-http="/api/contact"
  x-method="POST"
  x-form='{
    "name": "#name",
    "email": "#email",
    "topic": "support"
  }'
>
  Send
</button>
```

> When using a map (`{…}`) for `x-form`, form fields are **not** merged in. Only the map is used.

---

### Success handling

On 2xx/3xx responses:

- Response is treated as **text/HTML**.
- Swap into `x-target` (or the element itself) using `x-swap`.
- `x.apply` is re-run on the smallest mutated subtree.
- Indicators are cleared.

---

### Error handling

On 4xx/5xx or network failure:

- Target:
  - Use `x-target-error` if present
  - Else use the success target

- Response type:
  - If response is **text/HTML**:
    - The response text is injected using the same `x-swap` rules.
  - If response is **JSON**:
    - The target receives a simple string: `"Error: <status>"`
    - Console logs:

      - `Error: JSON response not supported by x-http; use x-js for structured errors.`
      - `HTTP <status or NETWORK> <METHOD> <URL>`
      - Parsed JSON body (for debugging)

- Indicator is always cleared at the end.

Use `x-js` when you need custom error handling for JSON APIs.

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

This re-runs `x-js` and binds `x-http` on new nodes.

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

<ul>
  <li x-for="p in products">
    ((p.name)) – $((p.price))
  </li>
</ul>

<div x-if="count > 5">Too high!</div>
<div x-else>Keep going</div>

<hr>

<!-- Simple HTTP GET into a target -->
<button
  x-http="/api/time"
  x-target="#time"
  x-indicator="#loading"
>
  Get server time
</button>

<span id="loading" hidden>Loading…</span>
<pre id="time"></pre>

<script src="extra.js"></script>
<script>
  x.store.title = "ExtraJS Demo"
  x.store.count = 0
  x.store.products = [
    {name:"Product 1", price:12.95},
    {name:"Product 2", price:18.50},
  ]

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
| `x-http="/url"`              | Send HTTP request                   |
| `x-method="POST"`            | Override HTTP method                |
| `x-target="#id"`             | Success target element              |
| `x-target-error="#id"`       | Error target element                |
| `x-swap="inner|append|..."`  | How response is applied             |
| `x-trigger="click|load|..."` | When to fire the request            |
| `x-indicator="#id"`          | Show/hide loading indicator         |
| `x-headers='{...}'`          | Extra request headers (JSON)        |
| `x-confirm="message"`        | Confirm dialog before sending       |
| `x-form` / `x-form='{...}'`  | Form-style body / selector map      |
| `x-json` / `x-json='{...}'`  | JSON body / selector map            |

---

## License

MIT License
See `LICENSE` file.
