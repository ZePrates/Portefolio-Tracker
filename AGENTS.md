<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Exposure reads paginate holdings and exposure records in stable ID order, because manager lists exceed Data API row limits.
- Company exposure calculations stay in the pure exposure module; exposure-only formatting and tables stay scoped to their own modules to avoid changing other portfolio views.
- ETF manager sync uses the existing authenticated function through the browser session; legacy composition sync must never overwrite manager holdings.
- External database column extensions live in external-types.ts and are shared by external authenticated clients and helpers, because generated Cloud types describe a different schema and must remain untouched.
