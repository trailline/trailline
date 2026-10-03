import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../src/cli.js";

/** Run the CLI in-process and collect everything it printed. */
export async function runCli(argv, { color } = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    color,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Paths and the expected-issues contract for one fixture report. */
export function loadFixture(name) {
  const dir = join(FIXTURES, name);
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  return { dir, reportPath: join(dir, expected.report), expected };
}

export const FIXTURE_NAMES = ["clean", "messy", "broken"];

/** A throwaway directory, removed when the test finishes. */
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "trailline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The scripts `trailline sql` composes for the clean and messy fixtures. */
export const CLEAN_SQL = `-- august-retention.html
with
q1 as (
    -- 30-day retention inputs by channel, region and cohort month, Jan to Aug 2026
    select
        channel,
        region,
        cohort_month,
        cohort_customers,
        retained_30d
    from marts.retention_by_channel
    where cohort_month between '2026-01-01' and '2026-08-31'
),
q2 as (
    -- New customers by channel, August 2026
    select
        channel,
        signup_month,
        new_customers
    from marts.acquisition_by_channel
    where signup_month between '2026-08-01' and '2026-08-31'
),
v1 as (
    -- Monthly 30-day retention by channel, with each channel's rank in its month
    select
        channel,
        cohort_month,
        sum(retained_30d) / sum(cohort_customers) as retention,
        rank() over (
            partition by cohort_month
            order by sum(retained_30d) / sum(cohort_customers) desc
        ) as retention_rank
    from q1
    group by channel, cohort_month
),
v2 as (
    -- August new customers and 30-day retention by channel
    select
        q2.channel,
        q2.new_customers,
        sum(q1.retained_30d) / sum(q1.cohort_customers) as retention
    from q2
    join q1
        on q1.channel = q2.channel
        and q1.cohort_month = q2.signup_month
    group by q2.channel, q2.new_customers
    order by retention desc
),
f1 (value) as (
    select retention
    from v1
    where channel = 'paid_social'
      and cohort_month = '2026-08-01'
),
f2 (value) as (
    select retention
    from v1
    where channel = 'paid_social'
      and cohort_month = '2026-07-01'
),
f4 (value) as (
    select retention_rank
    from v1
    where channel = 'paid_social'
      and cohort_month = '2026-08-01'
),
f5 (value) as (
    select customer_share
    from (
        select
            channel,
            new_customers / sum(new_customers) over () as customer_share
        from v2
    ) as shares
    where channel = 'paid_social'
),
f6 (value) as (
    select channel
    from v2
    order by retention desc
    limit 1
)
select 'f1' as figure, 'Paid social retention, August' as label, cast((select value from f1) as varchar) as value
union all
select 'f2', 'Paid social retention, July', cast((select value from f2) as varchar)
union all
select 'f3', 'Change in paid social retention, August vs July', cast(((select value from f1) - (select value from f2)) / (select value from f2) as varchar)
union all
select 'f4', 'Paid social''s retention rank among channels, August', cast((select value from f4) as varchar)
union all
select 'f5', 'Paid social share of August new customers', cast((select value from f5) as varchar)
union all
select 'f6', 'Channel with the highest August retention', cast((select value from f6) as varchar)`;

export const MESSY_SQL = `-- paid-search-costs.html
with
q1 as (
    -- New customers and spend by channel, August 2026
    select
        channel,
        signup_month,
        new_customers,
        spend
    from marts.acquisition_by_channel
    where signup_month between '2026-08-01' and '2026-08-31'
),
q2 as (
    -- Site sessions over the last 30 days
    select
        count(session_id) as sessions
    from marts.web_sessions
    where session_date >= dateadd('day', -30, current_date)
),
v1 as (
    -- August new customers, spend and cost per new customer by channel
    select
        channel,
        new_customers,
        spend,
        spend / new_customers as cost_per_customer
    from q1
    order by cost_per_customer desc
),
v2 as (
    SELECT * FROM v1 ORDER BY cost_per_customer DESC
),
v3 as (
    -- Paid channels only
    select
        channel,
        cost_per_customer
    from v2
    where channel in ('paid_search', 'paid_social')
),
f1 (value) as (
    select cost_per_customer
    from v1
    where channel = 'paid_search'
),
f2 (value) as (
    -- from the report: rests on external t1
    select 55
),
f4 (value) as (
    select sessions
    from q2
)
select 'f1' as figure, 'Paid search cost per new customer, August' as label, cast((select value from f1) as varchar) as value
union all
select 'f2', null, cast((select value from f2) as varchar)
union all
select 'f3', 'Paid search cost over target, August', cast(((select value from f1) - (select value from f2)) / (select value from f2) as varchar)
union all
select 'f4', 'Site sessions, last 30 days', cast((select value from f4) as varchar)

-- not covered by this script:
-- t1 external: q3-targets.csv
-- i2 ungrounded: Industry benchmarks put paid search cost per customer around $50.
-- i3 ungrounded: Creative fatigue on the summer campaign is the likely driver.
-- i4 ungrounded: Costs should ease in September once the new creative is live.`;
