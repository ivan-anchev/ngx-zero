# Branch rulesets

GitHub rulesets cannot be *enforced* on private repos on the Free plan, so
`protect-main.json` is kept as code here. **The moment this repo goes public,
apply it:**

```sh
gh api -X POST repos/ivan-anchev/ngx-zero/rulesets --input .github/rulesets/protect-main.json
```

It enforces: no deletion / no force-push on `main`, changes land via squash-only
PRs, and the `verify` CI job must pass (strict — branch must be up to date).
