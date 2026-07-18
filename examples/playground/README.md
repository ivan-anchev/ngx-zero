# ngx-zero playground

This standalone Angular app is a local integration harness for the current
`ngx-zero` public API. It imports only from the package entry point and runs a
real Zero client with in-memory storage and no backend.

From the repository root:

```sh
pnpm playground
```

The root script builds `ngx-zero` first and then starts Vite. The playground
lets you verify:

- `provideZero()` with a reactive options factory
- `withInit()` for each library-owned instance
- `injectZero()` and its signal-based instance rotation
- Zero's modern `materialize()` and registry-based `mutate()` APIs
- zoneless Angular change detection after live-view updates

Switch between `ada` and `grace` to force an instance rotation. Storage is
intentionally in-memory, so each new user starts with the same seed issues.

To verify a production build without starting a server:

```sh
pnpm playground:build
```
