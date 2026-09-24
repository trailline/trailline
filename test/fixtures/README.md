# Report fixtures

Three hand-written reports that pin down the file format. Every command is
tested against them. If one of them is awkward to write, the format is wrong.

| Fixture  | Graph lives in                 | What it covers                                             |
| -------- | ------------------------------ | ---------------------------------------------------------- |
| `clean`  | embedded in the HTML           | The happy path: everything traces, nothing fires           |
| `messy`  | `.trailline/<stem>.json`       | Every warning, no errors; captures in `.trailline/captured` |
| `broken` | `.trailline/<stem>.json`       | Every error                                                |

Each folder has an `expected.json`: the issues `trailline check` must report,
as `{ code, severity, node }`. Tests for a module compare against the subset
of codes that module owns, so the files stay the one contract as `check`
grows.

These files are excluded from Prettier. Their exact bytes matter: `check`
edits reports in place, and its tests compare against these originals.

## Capture files

The Claude Code hook writes one file per warehouse call to
`.trailline/captured/<n>.json`. The shape is fixed here so `check` can be
built before the hook:

```json
{
  "tool": "mcp__snowflake__run_query",
  "captured_at": "2026-09-18T10:02:11Z",
  "sql": "select ...",
  "columns": ["channel", "new_customers"],
  "rows": { "channel": ["paid_search"], "new_customers": [1240] },
  "row_count": 4
}
```

`rows` is columnar, at most 10 values per column, the same shape as `rows`
on a graph node. `row_count` is the full count the warehouse returned.
