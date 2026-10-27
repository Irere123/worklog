# Instinct's memory, and what Worklog's assistant should take from it

_Researched 2026-10-27. Instinct has published nothing about its internals; what follows comes from one black-box teardown, press coverage, and a paper on compaction. Sources are listed at the end._

_Status: all six proposals in §6 are implemented; see docs/ARCHITECTURE.md, "The assistant" and "Memory"._

How claims are labeled:

- **[teardown]**: Dhravya Shah's three-day black-box probe (supermemory blog, 2026-09-20). It is a reconstruction, not Instinct's code, and the post promotes supermemory.
- **[reported]**: press and third-party reviews, some of them from competitors.
- **[paper]**: Zerhoudi, Mitrovic and Granitzer, "The Compaction Cliff in Long-Running AI Agent Memory" (arXiv 2608.22752, 2026-08-24).
- **[code]**: read in this repo at `ad3f71d`.

---

## 0. Recommendation (TL;DR)

Instinct's storage is deliberately plain (Markdown files in git, searched with grep). Its value is in the layers around the storage: a profile and a one-page digest in every context, a recap when the conversation gets long, and a background job that rewrites what it knows. Worklog already has the storage, plus privacy and injection defenses that Instinct lacks. We're missing those layers.

| Change | Why | Priority |
| --- | --- | --- |
| **Compact long conversations**, starting with the inbox | Every conversation is replayed in full, and the inbox gets every brief, digest and ping appended forever. It will outgrow the model's context. | P1 |
| **Put a memory digest in each conversation** | Today the assistant knows nothing about its owner until it decides to call `recall`. | P1 |
| **Consolidate conversations, not only activity** | The nightly job reads only the owner's activity. Things said in chat are saved only if the model calls `remember` in the moment. | P2 |
| **Reconcile facts weekly**: merge, generalize, expire | Facts only ever accumulate. Time-bound facts never expire, and the context shows just the newest 60. | P2 |
| **Better recall**: aliases, several terms, typo tolerance | `recall` is one `ilike '%q%'`, so a synonym or a typo finds nothing. | P2 |
| **Open loops in the first turn** | Instinct shows its to-do board each turn; our assistant has to ask for attention items and cards. | P3 |

**Keep:**

- the two consolidation passes (team, then private) with visibility enforced in queries;
- the untrusted-content rules;
- supersede chains, which keep the history;
- the fallbacks that work without AI.

**Don't copy:**

- **Files in git:** Postgres already gives us transactions, tenancy and visibility filters, which files can't.
- **Grep-only retrieval.**
- **Refusing to continue:** when Instinct's context overflows, it tells the user to come back tomorrow.

---

## 1. What Instinct is [reported]

- **A personal agent you message:** you text or call it over iMessage, WhatsApp or the phone, and it books, buys and cancels on your behalf. It launched invite-only in August 2026. Sequoia, Benchmark and Coatue led a $1B Series C at a $10B valuation, announced 2026-09-28.
- **Its own cloud computer:** the computer keeps running between messages, with a browser and cached logins. Anish Acharya describes "a top-level agent that dispatches work" and recurring loops. The terms make it your agent, with authority to make binding commitments.
- **It messages first:** it follows up on dropped threads, and it calls or texts the user without being asked.
- **One thread:** all work happens in a single ongoing conversation, and users have asked for one thread per job.
- **Its security record is mixed:** a tester's email with hidden instructions was followed, and one user reported an email sent without being checked first. Its privacy notice names "hidden instructions designed to manipulate agents" as a risk.

## 2. Its memory, as observed [teardown]

### 2.1 Storage

Memory is Markdown files tracked in git, in directories by kind:

```
entities/people/   entities/orgs/
knowledge/facts/   knowledge/preferences/   knowledge/decisions/
comms/phone/
timeline/daily/    timeline/weekly/
workstreams/active/   workstreams/completed/
```

- **Record format:** each file has a header with `id`, `type` and `aliases`, then bulleted facts. `[[links]]` between ids make it a graph.
- **Aliases:** they exist so keyword search finds the file. The example is a dining preference with `aliases: [food, lunch, restaurants, takeout, delivery, dining]`.

### 2.2 What the model sees each turn

| Piece | Size | Notes |
| --- | --- | --- |
| Identity profile | small | Name, time zone, email, and an index of the files available |
| Memory one-pager | ~4,250 tokens | Life context, how much autonomy to take, how to write on each channel. Regenerated daily, and can lag about 2 days; it's dated so the model can judge it. |
| Compaction recap | ~8,750 tokens | Written by the agent at compaction: conversation anchors, open loops, identifiers, completed work |
| To-do board | ids, owners, titles | Details come from to-do tools. One snapshot had ~25 pending and 7 in progress. |
| Current conversation | — | Plus a session id |

### 2.3 Writes

- **Writes happen in the background only.** The agent that answers can't write to memory.
- **About once a day:** the teardown infers a daily job from a preference that took 23 hours 16 minutes to appear as a commit.
- **Reconciliation commits** do four things:
  - move temporary details into workstreams;
  - shorten records and link out to fuller notes;
  - turn examples into traits;
  - drop incidental detail.

### 2.4 Retrieval

- **No vector search and no BM25:** retrieval is grep-style keyword matching, through bash-like tools that list files, read them and inspect git history.
- **Aliases do the matching work:** "pasta" and "takeout" found the dining file, but the typo "pazta" found nothing.
- **Explicit asks beat implicit ones:** looking something up on request worked well, but unprompted personalization was inconsistent.

### 2.5 Corrections and forgetting

- **Corrections are dated:** a wrong fact is replaced by a dated correction, and the old version stays in git history.
- **Forgetting happens only at the daily ingestion:** an explicit "that's wrong" gets removed, but a time-bound note such as "exam next week" stays until something removes it.

### 2.6 How it scored

- **Passed:** single-fact recall, recency, updates and contradictions, abstaining, explicit personalization, and in-conversation corrections.
- **Weak:** multi-hop recall across sessions, and automatic forgetting.
- **Absent:** procedural memory (learned skills), implicit personalization, and multimodal recall.

## 3. The compaction cliff [paper]

- **Rules decay fastest when summarized.** When an agent summarizes its context to fit, rules need exact wording to stay enforceable, so they decay much faster than logs.
- **The measured decay:** Claude Code's `/compact` on Sonnet 4.6 kept 53% of safety rules after one round and 10% after five, across 20 production agent configurations.
- **Typed retention works much better.** The authors classify each line by type and give each type its own retention policy, which they call "Knowledge Triage". Their TypeCompact operator kept 96% of rules over five rounds. Rules in scope are pinned ahead of whatever retrieval ranks highest.

**For us:** our instructions are rebuilt every turn and never summarized, so the paper's main failure mode doesn't apply to them. A recap still has to treat identifiers (card numbers, PR links, ids, dates) and open commitments as exact, not summarizable.

## 4. Worklog's assistant today [code]

- **Store:** `memories` rows.
  - Kinds: `profile` (how they work, what they own), `fact` (durable knowledge) and `journal` (one per day).
  - Visibility: `team` or `private`.
  - Status: `active` or `superseded`, with `source` and `day`.
  - Corrections supersede rows, so history is kept. This plays the role of Instinct's git history.
- **Writes:**
  - The `remember` and `forget` tools, in owner mode, during chat.
  - A nightly "consolidate" automation (02:00 local) that reads the owner's own activity from the day before and writes a journal entry, new facts and profile lines. It can supersede profile lines but not facts.
  - It runs twice: a team pass that never sees private memory, then a private pass. Without AI it writes the journal from activity titles.
- **Reads:**
  - In chat, the model must call `recall`, an optional single-term `ilike` over `content` that returns the newest 60 rows.
  - `renderMemory` (profile ×40, facts ×60, recent journals) feeds briefs, the proactive check and consolidation, but not chat.
- **Context:**
  - Instructions are stable for the whole conversation, so prompt caching works.
  - Per-turn context (time, asker) goes in the user message.
  - The full transcript is replayed every turn, with no compaction.
- **The inbox:** one conversation per owner. Every automation that sends anything (`send` in `automations/runners.ts`) appends to it. With the defaults, a brief, two digests and any pings each weekday, that's dozens of posts a month, all replayed whenever the owner replies. My estimate is that it outgrows a 200k-token context within a few months.

## 5. Side by side

|  | Instinct [teardown] | Worklog [code] |
| --- | --- | --- |
| Store | Markdown in git, by entity directory | Postgres rows: profile, fact, journal |
| Structure | ids, types, aliases, `[[links]]` | None between memories, although members and cards are already tables |
| Who writes | Background job only | Background job, plus the live model (`remember`) |
| Sources consolidated | Conversations and connected data | Owner's activity only |
| Always in context | Profile, ~4k-token one-pager, recap, to-do board | Instructions only |
| Retrieval | grep plus aliases | One-term `ilike` |
| Long conversations | ~8.7k-token recap, then "come back tomorrow" | Full replay, no limit |
| Corrections | Dated, history in git | Supersede chain |
| Time-bound facts | Linger | Linger |
| Privacy between people | Not described | Team/private split, enforced in queries |
| Prompt injection | A hidden-instruction email was followed [reported] | Untrusted-content rules; consolidation records only the owner's own words and actions |

## 6. Proposals

### 6.1 Compact long conversations (P1)

- **Data:** add `recap` and `recapThroughSeq` to `conversations`. `messages` stays append-only.
  - `loadHistory` returns the recap, then the messages after `recapThroughSeq`.
  - `appendMessages` stays the only write path.
- **Trigger:** after a reply, if the replayed transcript is over a budget, enqueue `conversation:compact`. Use the last call's input-token usage, or a character estimate. Doing it as a job means the user never waits, and the model call stays out of any transaction.
- **Recap format:** fixed, typed sections, following the paper:
  - open loops and promises;
  - decisions;
  - identifiers, copied verbatim (card numbers, PRs, ids, dates);
  - what was done.

  Keep the last ~20 messages verbatim.

- **Inbox:** automation posts older than a few days can simply drop out of the replay. They live on in `briefs` and the deliveries.
- **Without AI:** keep only the newest messages that fit the budget.
- **Cost:** one cache miss per compaction.

### 6.2 A memory digest in every conversation (P1)

- **Write it nightly:** after consolidating, the job writes a short digest per visibility (team, and team plus private), capped at about 1,500 tokens.
  - It's model-written from profile, facts and recent journals.
  - It's dated, so the model can tell how fresh it is.
  - It can be a fourth memory kind, `digest`, or a column on members.
- **Inject it at conversation start:** copy the right digest onto the conversation when it's created, and render it into the instructions.
  - Owner mode gets team plus private; teammate mode gets team only.
  - The digest doesn't change mid-conversation, so the prefix stays cacheable.
  - Compaction refreshes it.
- **Without AI:** truncate `renderMemory`'s output.

### 6.3 Consolidate conversations (P2)

- **What it reads:** the nightly pass also reads the previous day's owner-mode messages and extracts facts and profile lines with the same schema and the same "only the owner's own words" rule.
- **Keep `remember`:** it handles explicit "remember this" requests immediately, and the background pass catches what the live model missed.
- **Leave teammate-mode conversations out for now:** they need their own privacy rules.

### 6.4 Reconcile facts weekly (P2)

- **A weekly job per member and visibility:** it reads all active facts and profile lines and returns merges, generalizations and expirations. Each one lands as a superseding row, so history is kept.
- **Expiry:** add `validUntil` (nullable date) for time-bound facts such as "on leave until 3 Nov" or "demo on Friday". Queries hide expired rows, and consolidation sets the date.
- **What it fixes:** facts that only grow, and the newest-60 cutoff silently hiding older facts.

### 6.5 Better recall (P2)

- **New columns:** `aliases text[]`, filled by consolidation, and an optional `subject` pointing at a member, card or repo. Worklog already stores these entities in tables, so they don't need entity files.
- **Search:** Postgres full-text search (`websearch_to_tsquery` over content and aliases) or `pg_trgm` similarity for typos. Add the index with `.concurrently()`.
- **Multi-hop recall:** `subject` lets recall pull everything about a person or card directly, which is the area where Instinct scored weak.

### 6.6 Open loops in the first turn (P3)

- **What:** on a conversation's first turn, add the owner's top open attention items and their golden or in-progress cards (ids and titles) to the turn preamble.
- **Why there:** it's per-turn data, so it belongs in the user message, not the instructions, and including it only on the first turn keeps later turns small.

## Sources

- Dhravya Shah, [I reverse-engineered Instinct's memory. Here's exactly how it works](https://supermemory.ai/blog/reverse-engineering-instinct-memory/), supermemory, 2026-09-20
- [Supermemory reverse-engineers Instinct's memory down to git, Markdown and grep](https://runtimewire.com/article/supermemory-reverse-engineers-instinct-memory-git-markdown-grep), Runtime Wire, 2026-09-20
- [Official Instinct Breakdown (2026)](https://www.vellum.ai/blog/official-instinct-breakdown), Vellum (a competitor), 2026-08-20, updated later
- [Instinct raises $1B Series C at $10B for personal AI agent](https://aiweekly.co/alerts/instinct-raises-1b-series-c-at-10b-for-personal-ai-agent), AI Weekly
- [What is Instinct AI](https://www.usecarly.com/blog/what-is-instinct-ai/), Carly, which cites Anish Acharya's comparison of Instinct, Grok Bot and ChatGPT Work
- Zerhoudi, Mitrovic, Granitzer, [The Compaction Cliff in Long-Running AI Agent Memory](https://arxiv.org/abs/2608.22752), arXiv, 2026-08-24
