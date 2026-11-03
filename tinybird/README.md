# Worklog on Tinybird

Where Worklog's API and workers send their spans, logs and runtime samples, and the endpoints that read them. What the API records, and what it never does, is in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#observability).

## Set up

With the [Tinybird CLI](https://www.tinybird.co/docs/forward/install-tinybird) installed:

```bash
cd tinybird
tb login
tb --cloud deploy
tb --cloud token copy worklog_append   # the token the API writes with
```

Then set the API's environment (`apps/api/.env`) and restart it:

```bash
TINYBIRD_TOKEN=<the worklog_append token>
TINYBIRD_HOST=<your workspace's API host, e.g. https://api.tinybird.co>
WORKLOG_RELEASE=<the git sha or tag you deploy>
```

`worklog_append` can only append to the three datasources. The endpoints are read with `worklog_read` (`tb --cloud token copy worklog_read`).

## Datasources

| Datasource | One row per | Kept |
| --- | --- | --- |
| `spans` | span: a request, job run, transaction, outbound call, model call or slow query | 30 days |
| `logs` | log line, errors with their type, message, stack and `fingerprint` | 90 days |
| `metrics` | runtime sample per process every 30 seconds | 30 days |

Every row has `service` (`api`, `worker` or `script`), `release` and `instance` (host and pid). `attributes` is a JSON object as text: read it with `JSONExtractString(attributes, 'http.route')`.

Spans are sampled, so count them with `sum(weight)`, not `count()`: `weight` is how many traces a kept span stands for. The endpoints already do. Look-ups by `trace_id` and `fingerprint` use bloom-filter indexes.

## Endpoints

Each takes `hours` (the window, 24 by default) and most take `service`.

| Endpoint | Answers |
| --- | --- |
| `overview` | Requests, server errors, p95 latency, job runs and failures, error logs, per `minutes` bucket, with every bucket present so no traffic reads as zero. Chart and alert on this. |
| `issues` | Errors grouped by fingerprint: count, first and last seen, `is_new`, releases, `error_code`, `error_frame` (the first frame of our code) and the latest trace. Filter by `release` to see what a deploy brought. |
| `issue` | One issue's occurrences with stacks (`fingerprint`, required; `level`, `error` by default). |
| `trace` | A trace's spans and log lines in time order (`trace_id`, required, from `x-worklog-trace`; `days`, 7 by default). |
| `routes` | Per route: requests, error rate, 4xx, p50/p95/p99, queries per request. |
| `jobs` | Per task: runs, failure rate, failures that were the last attempt (`gave_up`), durations, p95 wait past the scheduled time. |
| `models` | Per model: calls, failures, input, cached and output tokens, latency, time to first output. |
| `outbound` | Per host: calls, failures, 429s, 401/403s, latency. |
| `slow_queries` | Queries of 250 ms or more, or that failed, by statement, with their last error code and how busy the pool was. |
| `runtime` | Event loop lag, memory, CPU, pool use and telemetry's own health (`telemetry.dropped_rows`…) per instance (`name` filters one metric). |

```bash
curl -H "Authorization: Bearer $TB_READ_TOKEN" \
  "$TINYBIRD_HOST/v0/pipes/issues.json?hours=24&service=api"
```

Tinybird's alerts can be set on `overview` (server errors or p95 over a threshold) and `issues` (`is_new = 1`).
