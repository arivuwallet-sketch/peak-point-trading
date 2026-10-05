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
- Numeric indicator code relies on index access; tsconfig has noUncheckedIndexedAccess off — why: per-index guards across indicator math add noise without safety benefit.
- Market data comes from a server function proxying Yahoo Finance chart API; analysis runs client-side in src/lib/analysis.ts — why: one keyless source covers all asset classes and analysis stays deterministic.
- Discretionary price-action reading (market stage, MAEE/MBEE setups, trend quality, exhaustion, trade-management mode) lives in src/lib/playbook.ts and feeds analyze() as factors plus a `playbook` object — why: keeps the rule-based playbook separate from indicator/SMC math and testable on its own.
