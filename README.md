# ExtraJS

**A tiny, reactive, no-build HTML framework.**\
State, templating, directives, inline JS & events --- all from standard
HTML.

-   No bundler
-   No virtual DOM
-   No compiler step
-   Works in single files or large apps
-   Automatic reactivity
-   Session persistence built-in

Load it:

``` html
<script src="extra.js"></script>
```

------------------------------------------------------------------------

## Core Concepts

### 1) Reactive Store

`x.store` is your global state.

``` html
<script>
  x.store.count = 0
</script>
```

Changing store values automatically updates the page.

------------------------------------------------------------------------

### 2) Render Values

Use `((path))` anywhere in text or attributes.

``` html
<h1>Hello ((user.name))</h1>
<input x-bind:value="user.name">
```

Supports nested:

    ((cart.total))
    ((user.address.city))
    ((items[0].price))

------------------------------------------------------------------------

### 3) Inline JS: `x-js`

Runs when the element appears.

``` html
<div x-js="this.textContent = x.store.message"></div>
```

Full JS allowed (async too):

``` html
<div x-js="
  const txt = await fetch('/hello.txt').then(r=>r.text());
  this.textContent = txt;
"></div>
```

------------------------------------------------------------------------

## Directives

### Conditional

``` html
<div x-if="loggedIn">Welcome!</div>
<div x-else>Please log in</div>
```

### Show / Hide (keeps in DOM)

``` html
<div x-show="menuOpen">Menu Content</div>
<button x-on:click="x.store.menuOpen = !menuOpen">Toggle</button>
```

### Bind attribute/property

``` html
<input x-bind:value="name">
<div x-bind:class="theme">Styled!</div>
```

### Events: `x-on:*`

``` html
<button x-on:click="x.store.count++">Add</button>
<input x-on:input="x.store.name = el.value">
```

### Loop: `x-for="item in items"`

``` html
<ul>
  <li x-for="p in products">
    ((p.name)): $((p.price))
  </li>
</ul>

<script>
  x.store.products = [
    {name:'A', price:10},
    {name:'B', price:20}
  ]
</script>
```

------------------------------------------------------------------------

## Computed Properties

``` html
<script>
x.store.a = 2
x.store.b = 3
x.computed("total", () => x.store.a + x.store.b)
</script>

Total is ((total))
```

Automatically updates when dependencies change.

------------------------------------------------------------------------

## Watchers

Run code when a value changes.

``` html
<script>
x.watch("count", (nv, ov) => {
  console.log("count changed:", ov, "→", nv)
})
</script>
```

------------------------------------------------------------------------

## Persisted State

ExtraJS stores `x.store` in *sessionStorage*. Refresh-safe.\
Set values normally --- no config required.

------------------------------------------------------------------------

## Manual re-scan (advanced)

``` js
x.apply()      // run x-js on new elements
```

------------------------------------------------------------------------

## Full Example

``` html
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

<script src="extra.js"></script>
<script>
  x.store.title = "ExtraJS Demo"
  x.store.count = 0
  x.store.products = [
    {name:"Product 1", price:12.95},
    {name:"Product 2", price:18.50},
  ]

  x.computed("double", () => x.store.count * 2)
  x.watch("count", (n)=>console.log("count:", n))
</script>

</body>
</html>
```

------------------------------------------------------------------------

## API Summary

  Feature         Usage
  --------------- ------------------------------
  Global Store    `x.store.foo = 1`
  Watch           `x.watch("foo", fn)`
  Computed        `x.computed("bar", () => …)`
  Force re-scan   `x.apply(el)`

### Supported attributes

  Attribute                Purpose
  ------------------------ -----------------------
  `((path))`               Render store/computed
  `x-js="code"`            Run inline JS
  `x-if="expr"`            Conditional insert
  `x-else`                 Paired fallback
  `x-show="expr"`          Toggle hidden
  `x-bind:attr="path"`     Bind prop/attr
  `x-on:event="js"`        Add event listener
  `x-for="item in list"`   Loop & stamp HTML

------------------------------------------------------------------------

## License

MIT License\
See `LICENSE` file.
