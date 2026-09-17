# Trailline

**A provenance layer for AI-generated reports.** Every number, chart, and claim traces back to the query that produced it.

AI writes analytics reports faster than data teams can vet them. Trailline records where each figure came from — `source → view → figure → insight` — so a reviewer can see the lineage behind any claim before it reaches a CXO deck.

- **Visibility, not verification.** Trailline shows the lineage; it doesn't assert the numbers are right.
- **Zero builder friction.** Reports stay plain `.html`. Lineage rides along in an inert `<script type="application/trailline+json">` block and `data-trailline` attributes — invisible to the reader.
- **SQL-first evidence.** Compose an entire report back into one runnable SQL script for review.
- **Pinned time.** Queries use absolute date ranges, never `now()`, so a report reproduces exactly.

## Status

🚧 **Pre-development.** The name is reserved on npm; the CLI, skill, and viewer are being built. This README is a teaser, not documentation. Watch the repo for the first release.

## Planned usage

```bash
npx trailline check report.html   # validate lineage coverage
npx trailline view report.html    # open the two-pane report + lineage viewer
npx trailline sql report.html     # compose the report into one SQL script
```

## License

MIT © Varun Jain
