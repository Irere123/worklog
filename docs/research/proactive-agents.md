# Proactive agents: research brief for Worklog

_Prepared 2026-10-26. Scope: academic and HCI evidence, industry patterns from 2024 to 2026, design patterns, and a prioritized change list for Worklog's attention, automation and delivery system._

---

## 0. TL;DR

1. **Proactive help works when it is rare, well timed and easy to act on.** It annoys when it is frequent, lands mid-task or needs interpretation.
   - In a 65-person study, 90% preferred a proactive coding assistant at a moderate cadence. Only 47% did when it suggested more often and faster.
   - In a five-day field study, suggestions at a workflow boundary (after a commit) got 52% engagement. Mid-task suggestions were dismissed 62% of the time.
   - Batching phone notifications **three times a day** improved attention, productivity, mood and stress. **Hourly** batching did not help.
2. **LLMs over-trigger.** On ProactiveBench, GPT-4o's false-alarm rate was about 52%. On ProAgentBench, models reached 85–97% recall but only 52–61% precision. Do not let a fast model alone decide whether to interrupt. Put deterministic gates in front of it: budgets, cooldowns, quiet hours and per-sender quotas. Treat the model as a classifier inside those gates.
3. **Industry has moved from model-curated feeds to scheduled jobs plus event triggers that users control.** ChatGPT Pulse, launched September 2025, was retired in June 2026 in favour of Scheduled Tasks. OpenAI said proactive features "work best when personalized, action-oriented, and controlled by the user". Scheduled Tasks run at most hourly, notify only on significant change and auto-pause when unattended. Worklog's job-row design already matches this direction.
4. **Feedback is the missing loop in Worklog.** The system records done, dismissed and snoozed, but not _why_. It does not record which pushes were sent or whether they helped. Without that data it cannot learn, explain itself or measure precision.
5. **Make nudges actionable.**
   - Use the notify / question / review taxonomy from LangChain's ambient agents.
   - Use accept / edit / respond / ignore responses, as in Agent Inbox.
   - Copy Gmail's "Sent 5 days ago. Follow up?" pattern.
   - Your drift example becomes "#12 will drift to Not now in 3 days — still on it? [Keep] [Not now] [Done]", with one click and deterministic execution.
6. **Safety:** the attention check and custom automations combine **private data, untrusted content and an outbound channel**. That is the "lethal trifecta". EchoLeak (CVE-2025-32711, CVSS 9.3) exfiltrated data through rendered Markdown images and links. Build push bodies server-side from database rows, sanitize model prose and scope each automation's data access.

**Top recommendations,** detailed in §6:

| #   | Change                                                   | Effort    |
| --- | -------------------------------------------------------- | --------- |
| 1   | Notification ledger                                      | M         |
| 2   | Feedback endpoint and signals                            | S–M       |
| 3   | Per-item decisions, interruption budget and digest slots | M         |
| 4   | Harden delivery and scope scheduled runs                 | S–M       |
| 5   | Event-triggered, debounced, breakpoint-aware checks      | S, then M |
| 6   | Actionable attention items, starting with drift nudges   | M         |
| 7   | "Why am I seeing this"                                   | S         |
| 8   | Learned per-scope preferences, changed only with consent | M         |
| 9   | Eval harness and metrics                                 | M         |
| 10  | Priority-inflation quotas                                | S         |
| 11  | Automation entropy (auto-pause ignored jobs)             | S         |
| 12  | Presence indicator and global "hold" controls            | S         |

---

## 1. How to read this brief

**Evidence labels:**

- **[P] Primary:** I read the paper, preprint page, official docs or official blog this session.
- **[S] Secondary:** press coverage, course notes, a publisher summary or a search snippet quoting the source. Probably right, but I did not read the original.
- **[U] Unverified:** a single non-authoritative source, or my background knowledge not re-checked this session. Treat as a lead, not a fact.

**Citation style:** works are cited by title, venue and link. Author names are omitted under the organization's policy on personal data. The links carry attribution.

**Effort sizes:**

- **S:** about 1–2 dev-days.
- **M:** about 3–7 dev-days.
- **L:** more than 2 weeks.

**Codebase review:** I read the Worklog code under `apps/api/src` but did not modify it, so §5 can map findings onto actual functions.

---

## 2. Academic and HCI evidence

### 2.1 Foundations: mixed initiative and decision-theoretic alerting

**"Principles of Mixed-Initiative User Interfaces" (CHI 1999, the LookOut calendar agent)** — [erichorvitz.com](https://erichorvitz.com/uiact.htm), [PDF](https://www.erichorvitz.com/chi99horvitz.pdf)

- **The core rule [S]** ([UBC slides](https://www.cs.ubc.ca/~conati/522/532b-2019/Slides/09-12-JamesonHorvitz-Fall19-20.pdf), [Cambridge lecture](https://www.cl.cam.ac.uk/teaching/1819/P230/IWML-Lecture-3.pdf)):
  - The agent computes the expected utility of acting given evidence: `eu(A|E) = p(G|E)·u(A,G) + p(¬G|E)·u(A,¬G)`. Here _G_ is "the user has the goal this action serves".
  - Plotting expected utility against p(G|E) yields **two thresholds**:
    - Below the lower one: do nothing.
    - Above the upper one: act.
    - In between: **engage in dialog**, meaning ask.
  - The thresholds follow from the utilities. If a wrong interruption costs more, both thresholds move right.
- **Principles [U]** (from memory; partly corroborated by secondary sources):
  - Add significant value.
  - Consider uncertainty about the user's goals.
  - Consider the user's attention when timing services.
  - Infer the ideal action from costs, benefits and uncertainty.
  - Use dialog to resolve key uncertainties.
  - Allow efficient direct invocation and termination.
  - Minimize the cost of poor guesses about action and timing.
  - Scope the precision of service to match uncertainty.
  - Support efficient refinement of results.
  - Use socially appropriate behaviour.
  - Keep a working memory of recent interactions.
  - Keep learning by observing.
- **Worklog mapping:**
  - Worklog's notify/quiet check covers only the two ends of this scale. It has no "ask" middle zone.
  - Wrong pushes have no "cost of poor guesses" term.
  - Cheap pull surfaces (the inbox and digests) can take lower-confidence items. A push needs high confidence.

**"Attention-Sensitive Alerting" (UAI 1999) and the Priorities system** — [arXiv 1301.6707](https://arxiv.org/pdf/1301.6707), [MSR page](https://www.microsoft.com/en-us/research/publication/attention-sensitive-alerting/)

- Each message gets an **expected cost of delayed action (ECDA)**. The system alerts only when that cost exceeds the expected cost of interrupting the user's current focus. [S]
- Priorities learned from user behaviour and routed only the most urgent mail to the phone. [S]
- Microsoft describes it as an ancestor of Outlook Mobile Manager and of Focused Inbox. [S]
- **Worklog mapping:** attention priority (low/normal/high) is a coarse ECDA. The missing half is the _interruption cost_ side: what the person is doing now, and how many times they were pinged today.

**Guidelines for Human-AI Interaction (CHI 2019): 18 guidelines** — [HAX library](https://www.microsoft.com/en-us/haxtoolkit/library/) [P]

- Relevant here:
  - G3 _Time services based on context_
  - G8 _Support efficient dismissal_
  - G9 _Support efficient correction_
  - G10 _Scope services when in doubt_
  - G11 _Make clear why the system did what it did_
  - G13 _Learn from user behavior_
  - G14 _Update and adapt cautiously_
  - G15 _Encourage granular feedback_
  - G17 _Provide global controls_
  - G18 _Notify users about changes_
- Worklog today covers G3 (active hours) and G8 (dismiss). It is missing G11, G13, G15 and G17, and only partly covers G9 and G14.

### 2.2 The cost of interruption and the value of timing

| Finding | Evidence | Label |
| --- | --- | --- |
| Interrupting at **subtask boundaries** costs far less, measured by resumption lag and annoyance, than interrupting mid-task. Lower-workload boundaries are cheaper still. Task structure alone predicts cost reasonably well. | "Investigating the effectiveness of mental workload as a predictor of opportune moments for interruption" (CHI 2005); "Leveraging characteristics of task structure to predict the cost of interruption" (CHI 2006). [PDF 2005](https://www.interruptions.net/literature/Iqbal-CHI05-p1489-iqbal.pdf), [PDF 2006](https://interruptions.net/literature/Iqbal-CHI06-p741-iqbal.pdf) | S |
| After an email or IM alert, people spent close to **10 minutes** on the switch it caused, then another **10–15 minutes** before returning to the suspended task. | "Disruption and Recovery of Computing Tasks" (CHI 2007), [PDF](https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf) | S (figure via a quotation; not checked in the PDF) |
| Interrupted people finish **faster** with no quality loss, but report more stress, frustration and time pressure. | "The cost of interrupted work: more speed and stress" (CHI 2008), [PDF](https://www.ics.uci.edu/~gmark/chi08-mark.pdf) | S |
| Delivering notifications at detected **breakpoints** cut perceived cognitive load by **33%** in a 30-person, 16-day field study. A lab study found 46% for interruption-sensitive users. | Attelia (PerCom/UbiComp 2015), summarized in [this survey](https://arxiv.org/pdf/1711.10171) | S |
| Response time and perceived disruption depend on the **sender relationship**, content, alert type and current task. **Important content can still be disruptive.** Data: 10,372 notifications from 20 users. | "My Phone and Me" (CHI 2016), [UCL](https://discovery.ucl.ac.uk/id/eprint/1502364/) | S |
| Knowledge workers are pinged about every **2 minutes** in core hours, about **275 times a day**. | Microsoft Work Trend Index 2025, [Axios](https://www.axios.com/2025/06/17/microsoft-remote-work-meetings), [UNLEASH](https://www.unleash.ai/artificial-intelligence/microsoft-employees-are-interrupted-every-2-minutes-how-can-ai-help-us-re-focus-on-the-work-that-matters/) | S |

### 2.3 Batching, awareness and well-being

**"Batching smartphone notifications can improve well-being" (Computers in Human Behavior, 2019)** — [Springer Nature blog](https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity), [Duke record](https://scholars.duke.edu/publication/1402953)

- **Design:** a two-week randomized field experiment with N≈237 (abstract). Sources disagree on the arms: three per the abstract, four per the publisher blog.
- **3×/day batching** (9:00, 15:00, 21:00) vs. normal delivery: participants were more attentive and more productive, had better mood, lower stress, more perceived control and fewer phone unlocks. [S]
- **Hourly batching** made no meaningful difference. [S]
- **No notifications at all** brought few of the benefits and **more anxiety and fear of missing out**. [S]
- **Implication:** a 30-minute push cadence for non-urgent items is close to "hourly", which showed no benefit. Two or three digests per day is the evidence-backed shape. Going fully silent is not.

**"Productive, Anxious, Lonely — 24 Hours Without Push Notifications" (MobileHCI 2017)** — [arXiv 1612.02314](https://arxiv.org/pdf/1612.02314) [S]

- **Design:** 30 participants went one day without notification alerts.
- **Results:** they felt less distracted and more productive, but anxious about responsiveness and less socially connected.
- **Follow-up:** about two-thirds planned to change their settings; about half still had two years later.

**"Notifications and Awareness: a field study of alert usage and preferences" (CSCW 2010)** — [PDF](https://www.erichorvitz.com/shamsi_iqbal-eric_horvitz_cscw_2010.pdf) [S]

- Users see notifications as **passive awareness**, not as triggers to switch tasks. They keep them despite the disruption.
- When notifications were turned off, some people focused better. Others **self-interrupted more** to check.
- **Implication:** show a held-items count ("3 things waiting for your 12:30 digest") so quiet does not create checking anxiety.

### 2.4 Volume, long-term effects and learning when to send (industry research)

**LinkedIn, "Less is more: optimizing email volume"** — [blog](https://www.linkedin.com/blog/engineering/archive/less-is-more-optimizing-email-volume-part-1) [P]

- **Design:** a one-week test comparing "send everything" with randomly dropping about half the emails.
- **Results:** send-all produced **45% more negative responses** (unsubscribes and spam reports) and only 2.6% more page views.
- **Lesson:** frame volume as multi-objective (value vs. sends vs. complaints), with per-type constraints. An unsubscribe is a _permanent_ loss of that channel.

**Pinterest, notification volume control (KDD 2018)** — [engineering blog](https://medium.com/pinterest-engineering/user-state-based-notification-volume-optimization-7764118f73ff) [S]

- Uses **weekly per-user budgets**.
- Too many notifications cause fatigue and full unsubscribes.
- Short-term click-through hides long-term harm.

**"Should I send this notification? Optimizing push notifications decision making by modeling the future"** — [arXiv 2202.08812](https://arxiv.org/abs/2202.08812) [P]

- Uses model-based reinforcement learning over a multi-day horizon.
- A myopic policy "will always choose to send". The long-horizon policy sent **fewer** notifications with a **higher open rate** and the same engagement.

**Duolingo, "A Sleeping, Recovering Bandit Algorithm for Optimizing Recurring Notifications" (KDD 2020)** — [PDF](https://research.duolingo.com/papers/yancey.kdd20.pdf) [S]

- A bandit models **novelty decay**: the same message loses effect when repeated.
- Results: +0.5% daily active users and +2% new-user retention.

**Implication for Worklog:** you do not need reinforcement learning. You do need

- a **budget**,
- a **ledger** of what was sent, and
- **negative signals**: mute, dismiss without opening, or disabling a target.

### 2.5 LLM proactive agents: benchmarks and 2025–2026 results

**"Proactive Agent: Shifting LLM Agents from Reactive Responses to Active Assistance" — ProactiveBench (ICLR 2025)** — [arXiv HTML](https://arxiv.org/html/2410.12361v3) [P]

- **Data:** 6,790 training events and 233 test events across coding, writing and daily life. Each event is a candidate task the agent could propose; humans labelled each proposal accept or reject.
- **Reward model:** a fine-tuned LLaMA-3.1-8B judge agreed with humans at **F1 91.8%**. It makes a usable offline evaluator once calibrated on human labels.
- **Single-prediction results:**

  | Model               | F1    | False-alarm rate |
  | ------------------- | ----- | ---------------- |
  | GPT-4o              | 64.6% | 51.9%            |
  | Claude-3.5-Sonnet   | 62.0% | 54.6%            |
  | Fine-tuned Qwen2-7B | 66.5% | 50.2%            |

- **Allowing three candidates (pred@3):** GPT-4o's F1 rose to **77.7%** and false alarms fell to **36.4%**. _Offering a short list in a low-cost surface beats a single high-stakes guess._
- **Reward-model feedback** cut false alarms but made models go **silent when help was needed**. Both kinds of error have to be evaluated.
- **Failure modes:** help offered when it isn't needed (for example, while the user is just switching apps), and help offered **too early**, before intent is clear.

**"ProAgentBench: Evaluating LLM Agents for Proactive Assistance with Real-World Data" (Feb 2026)** — [arXiv HTML](https://arxiv.org/html/2602.04482v1) [P]

- **Data:** 28,528 events from more than 500 hours of real computer use.
- **When to assist:** the best zero-shot accuracy was 64.4%. Models show **recall of 85–97% but precision of only 52–61%**, meaning systematic over-triggering. Chain-of-thought sometimes made it worse.
- **Long-term memory:**
  - A knowledge-graph memory raised accuracy from 53.7% to 60.1%.
  - It raised intent accuracy from 31.2% to 39.6%.
  - A **5-minute** recent-history window was the cost/benefit sweet spot.
- **Real vs. synthetic training data:** fine-tuning on real data reached **74.0%** accuracy, versus 62.1% with synthetic data and 57.3% zero-shot.

**"Do Proactive Agents Need an LLM to Decide When to Act?" (May 2026, revised Sep 2026)** — [arXiv 2605.30152](https://arxiv.org/abs/2605.30152) [P]

- **Method:** a small temporal-graph model decides _whether_ to trigger and _which context_ to use, in about 11 ms per event. That is 4–7× faster than LLM triggers.
- **Result:** it improved downstream F1 by **16.7 points** on average across 14 LLM backbones.
- **Pattern:** a cheap trigger plus an LLM only on fire. Worklog's pre-check is a minimal version of this.

**"AI Assistants Overassist" (Jul 2026)** — [arXiv 2607.21306](https://arxiv.org/abs/2607.21306) [P]

- LLM "teachers" intervened **more often and earlier than humans** and gave full solutions instead of hints.
- **Implication:** default model judgment leans toward too much help.

**"Proactive Conversational Agents with Inner Thoughts" (2025; CHI venue unconfirmed)** — [arXiv 2501.00383](https://arxiv.org/abs/2501.00383v2) [S]

- The agent keeps a covert train of thought and speaks when its intrinsic motivation to contribute is high enough.
- It beat baselines on turn-taking appropriateness.
- **Pattern:** separate "having something to say" from "now is the moment".

**"Knowing Isn't Understanding: Re-grounding Generative Proactivity…" (ICML 2026 position paper)** — [arXiv 2602.15259](https://www.arxiv.org/abs/2602.15259) [P]

- Argues proactive agents need **behavioural grounding**: principled constraints on when, how and how much to intervene.

**TimelyAI workshop (CHIWORK 2026), "When Should Generative AI Assistants Intervene?"** — [CEUR proceedings](https://ceur-ws.org/Vol-4265/) [S]

- Themes:
  - Restraint-first policies.
  - "Knowing when _not_ to help."
  - Signals such as pauses are ambiguous.

### 2.6 Proactive AI in programming and workplace settings

| Study | Setting and N | Quantified findings | Label |
| --- | --- | --- | --- |
| **"Need Help? Designing Proactive AI Assistants for Programming"** (CHI 2025), [arXiv HTML](https://arxiv.org/html/2410.04596v2) | Coding, N=65, 20-minute sessions per condition | **Triggers:** suggest after 5 s idle, at most once every 20 s; suppress while typing; fire immediately on a run error. **Productivity:** proactive variants passed 12–18% more test cases. **Preference over baseline:** Suggest 90%, Suggest + Preview 80%, but **Persistent Suggest 47%** (5 s wait, 5 suggestions), called "distracting" and "annoying". **Acceptance:** 69 of 75 tracked suggestion interactions accepted; most rejections were "efficiency/modularity" advice. **Recommendations:** user-adjustable frequency, say "all good" instead of always suggesting, infer feedback implicitly. | P |
| **"Assistance or Disruption? … Proactive AI Programming Support"** (2025), [arXiv](https://arxiv.org/abs/2502.18658) | Coding, N=18, within-subject | Proactive agents raised efficiency but disrupted workflow. **Presence indicators and interaction context** reduced the disruption. There were trade-offs in control, ownership and understanding. | P (abstract) |
| **"Developer Interaction Patterns with Proactive AI: A Five-Day Field Study"** (IUI 2026), [arXiv HTML](https://arxiv.org/html/2601.10253v1) | Production IDE, 15 developers, 229 interventions | **By timing:** after a commit (workflow boundary), **52% engaged**; mid-task after a declined edit, 31% engaged and **62% dismissed**. **Interpretation time:** ready-to-apply proactive patches took 45.4 s vs. 101.4 s for reactive chat (p=0.0016). **Trust:** only 27% rated it reliable; 47% were comfortable accepting. **Recommendations:** anchor to task boundaries, make settings for timing, frequency and type user-configurable, learn from explicit and implicit feedback. | P |
| **"What Can You Do? … Agent Proactive Interactions with an Agent for Employees"** (DIS 2016), [record](https://archive.cps-vo.org/node/38784) | Workplace, 17-day field study | Proactive interactions risked interruption, **especially for interruption-averse users**. That aversion can be **inferred from behaviour**, which supports personalization. | S |
| **"Having Lunch Now": Understanding How Users Engage with a Proactive Agent for Daily Planning…** (2025–26), [arXiv](https://arxiv.org/abs/2509.24073) | 12 people, 14 days | Users accepted or **negotiated** suggestions and sometimes disengaged. **Rigidity, premature turn-taking and overpromising** caused problems. | P (abstract) |
| **DoubleAgents** (2025–26), [arXiv](https://arxiv.org/abs/2509.12626) | Coordination agent, 10 people plus deployments | Turns user edits into reusable **policies**, templates and stop hooks. Reliance grew over time. Users still wanted control at uncertain or edge-case moments. | P (abstract) |
| **"Help Without Being Asked" (Vigil)**, ByteDance cloud support, deployed more than 10 months, [arXiv HTML](https://arxiv.org/html/2604.09579) | 131k on-call cases | **Gating:** a scope classifier (within scope / out of scope / no help needed) plus an explicit "unable to answer" option. **Dedupe:** suppresses answers with cosine ≥0.7 to earlier ones (best F1). **Feedback:** "Accept" is a strong positive; **explicit negative feedback was ambiguous and inconsistently given**, so an LLM reviews unaccepted answers in light of the follow-up dialogue. **Impact:** 40.5% of on-calls helped; answer accuracy rose from 0.154 to 0.591 with self-improvement. | P |
| **ProMemAssist** (UIST 2025), [arXiv](https://arxiv.org/html/2507.21378v1) | Smart glasses, N=12 | A timing predictor weighs **value of help vs. cost of interruption**. It was more selective than an LLM baseline and got higher engagement. | S |
| **"Sensing What Surveys Miss"** (CHI 2026), [arXiv](https://arxiv.org/abs/2602.00880) | N=32 | Interventions timed to sensed state raised accuracy by 21% and cut false negatives from 50.9% to 22.9%. Users often **don't know when they need help**. | P (abstract) |
| **"How Users Perceive Mixed-Initiative AI"** (IUI 2026), [arXiv](https://arxiv.org/abs/2602.01481) | Puzzle task | Help delivered at **user-chosen intervals** was perceived more positively than on-demand help, with the same performance. Delivery mode shapes experience independently of outcomes. | P (abstract) |
| **Omakase** (2026), [arXiv](https://arxiv.org/abs/2604.08898) | Research projects, N=42 | Inferring timely queries from project docs and distilling long reports into **actionable, project-specific suggestions** was rated more actionable than raw reports. | P (abstract) |
| **Sensible Agent** (UIST 2025, Google), [blog](https://research.google/blog/sensible-agent-a-framework-for-unobtrusive-interaction-with-proactive-ar-agents/) | AR | Choosing _how_ to deliver (a minimally intrusive mode), not just _what_, reduced perceived effort and intrusiveness. | S |

### 2.7 Explanation, expectation-setting and control

**"How much information? Effects of transparency on trust in an algorithmic interface" (CHI 2016)** — [PDF](https://www.cs.mcgill.ca/~jeromew/data/COMP766/CHI2016/p2390-kizilcec.pdf) [S]

- When outcomes violated expectations, a **moderate** explanation restored trust. **Too much** detail eroded it again.
- Users whose expectations were met were unaffected.
- **Implication:** give a one-line "why", with details on demand.

**"Will You Accept an Imperfect AI? Exploring Designs for Adjusting End-user Expectations of AI Systems" (CHI 2019)** — [PDF](https://microsoft.com/en-us/research/uploads/prod/2019/01/chi19_kocielnik_et_al.pdf) [S]

- At the same 50% accuracy, a **high-recall** meeting detector was perceived as more accurate and acceptable than a **high-precision** one. Its false positives were cheap: a highlight in the email.
- Three designs helped preserve acceptance:
  - an accuracy indicator,
  - example-based explanations,
  - a **user-adjustable threshold**.
- **Implication:** the right precision/recall trade-off depends on the surface. Use high recall in the inbox and digest, and high precision for push.

### 2.8 Synthesis: when proactive help is welcome vs. annoying

| Dimension | Welcome when… | Annoying when… | Strongest evidence |
| --- | --- | --- | --- |
| **Frequency** | It is rare and batched. Three batches a day worked; one suggestion per natural pause. | More often than about hourly; persistent suggestions. Preference fell from 90% to 47% with a faster cadence. | 2019 batching study; CHI 2025 "Need Help?" |
| **Timing** | It arrives at task boundaries: after a commit, after finishing a task, after an error. | It arrives mid-task. Dismissals were 62% mid-task vs. 52% engagement at boundaries. | IUI 2026 field study; 2005–06 breakpoint studies; Attelia (−33% load) |
| **Content** | It is actionable and ready to apply. Interpretation took 45 s vs. 101 s for reactive help. Brainstorming and latent-bug help was accepted. | It needs interpretation, or is generic advice (efficiency and modularity suggestions were rejected most). | IUI 2026; CHI 2025; Omakase |
| **Confidence** | It is high-confidence for push. Several candidates are fine on a pull surface (pred@3 gave F1 77.7% vs. 64.6%). | A single low-confidence guess is pushed. LLM false alarms run about 50%; precision 52–61%. | ProactiveBench; ProAgentBench; CHI 2019 imperfect-AI study |
| **Sender and relationship** | It comes from people the user cares about, or is blocked-on-you. | It comes from low-relationship senders or automated noise. Even important content can disrupt. | CHI 2016 "My Phone and Me"; Priorities |
| **Explanation** | A one-line why, expandable. | No why at all, or a wall of detail. | CHI 2016 transparency study; HAX G11 |
| **Control** | Users can adjust frequency, type and threshold, and can see the assistant's state (presence indicator). | The assistant is opaque, cannot be tuned, or silently changes behaviour. | CHI 2025; IUI 2026; Codellaborator; HAX G14, G17 |
| **Silence** | Quiet is the default, with visible held items. | Total silence leaves users anxious and checking. | 2019 batching study; MobileHCI 2017; CSCW 2010 |

**Concrete threshold guidance.** These are my recommendations, derived from the evidence rather than measured in one study:

- **Push** only when precision is likely at least 0.7: blocked-on-you, review requested by a human, direct @mention from a human, a time-bound deadline today.
- **Digest:** anything with precision likely at least 0.3.
- **Drop or brief:** the rest.
- **Tuning target:** a **7-day push precision of at least 60%** ("useful or acted on within 2 h"), measured per person.

---

## 3. Industry products and patterns, 2024–2026

| Product | What it surfaces and how it chooses | Feedback and learning | Status | Label |
| --- | --- | --- | --- | --- |
| **ChatGPT Pulse** (OpenAI) | Overnight asynchronous research from chats, memory, feedback and optionally Gmail or Calendar. 5–10 cards each morning. A **finite feed**: "that's it for today". Cards expire daily unless saved or followed up. | 👍/👎 per card. **"Curate"**: tell it what you want tomorrow; requests before 10 pm are honoured. Free-text feedback with a viewable and deletable **feedback history**. | Launched Sep 25, 2025 (Pro). **Retired June 2026** (announced Jun 17–18, 14-day sunset) in favour of **Scheduled Tasks**. OpenAI's stated lesson: proactive features "work best when personalized, action-oriented, and controlled by the user". | S ([TechCrunch](https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs/), [help center](https://help.openai.com/en/articles/12293630), [Digit](https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html), [Gigazine](https://gigazine.net/gsc_news/en/20260619-chatgpt-scheduled-tasks/)) |
| **ChatGPT Scheduled Tasks** | User-defined one-off or recurring tasks. **Monitoring tasks notify only when the model judges a change significant**. Runs **at most once an hour**. Tasks **auto-pause when unattended**. | Pause, resume and edit from a "Scheduled" page. | June 2026. Event triggers (new Gmail message, Slack message or GitHub PR) reportedly added in late Aug 2026. | S ([AI Weekly](https://aiweekly.co/alerts/openai-brings-scheduled-tasks-and-web-monitoring-to-chatgpt)); event triggers **[U]** |
| **LangChain ambient agents and Agent Inbox** | Agents listen to an **event stream** and act on events, many on schedules (cron). They are **not** fully autonomous. Three human-in-the-loop modes: **Notify** (flag, don't act), **Question** (ask to unblock), **Review** (approve, edit or give feedback on a proposed action). | The inbox returns `accept \| edit \| response \| ignore`, configured per interrupt (`allow_accept/edit/respond/ignore`), with a Markdown `description`. **Human-in-the-loop answers update long-term memory.** They tried Slack first but found items got lost, so they built a dedicated inbox. | 2025 | P ([blog](https://www.langchain.com/blog/introducing-ambient-agents), [repo](https://github.com/langchain-ai/agent-inbox)) |
| **Gmail Nudges** | "Received 3 days ago. Reply?" / "Sent 5 days ago. Follow up?" for messages the model thinks matter. Uses signals such as frequent contacts. | On by default; can be turned off. | 2018 to now | S ([Workspace blog](https://workspaceupdates.googleblog.com/2018/05/gmail-remind-respond.html), [9to5Google](https://9to5google.com/2018/05/14/new-gmail-web-nudge-ai-reminders/)) |
| **Google Pixel Magic Cue** | On-device (Gemini Nano). Surfaces information from Gmail, Calendar, Messages and Screenshots as one-tap chips **inside the app you're using**. | **Press and hold a suggestion to see how it was generated.** | Aug 2025 | S ([9to5Google](https://9to5google.com/2025/08/20/pixel-10-magic-cue-launch/)) |
| **Google Labs CC** | A daily "Your Day Ahead" email built from Gmail, Calendar, Drive and the web. | **Reply to the email** to teach it, correct it, or add to-dos. | Dec 2025 (US/CA) | S ([SiliconANGLE](https://siliconangle.com/2025/12/16/google-tests-cc-ai-agent-summarize-email-calendars-documents/)) |
| **Gemini Daily Brief and Gemini Spark** | **Daily Brief** is a morning digest prioritized by _your stated goals_, with suggested next steps. **Spark** is a 24/7 agent with recurring tasks and triggers; it "**asks you first before high-stakes actions** like spending money or sending emails". | 👍/👎 steers the brief over time. Opt-in app connections. | I/O, May 2026 | P ([Google blog](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/)) |
| **Outlook, "Prioritize my inbox"** | High, normal or low priority per email, with **a brief reason shown**. Users write rules in natural language ("It's from my manager"). Only new mail is re-evaluated. | Users edit the instructions. | 2025–26 | S ([Microsoft support](https://support.microsoft.com/topic/prioritize-my-inbox-65e37040-2c90-4ee3-86d9-e95d5ba0e3cb)) |
| **Microsoft Copilot "Today" and Autopilot** | **Today** sorts mail, calendar, Teams threads, meetings and tasks into **missed / needs attention now / can wait**. It drafts replies, **proposes** schedule changes and flags forgotten follow-ups. **Autopilot** (formerly "Scout") is a long-running proactive agent with its own identity, memory and workspace, working "within existing permissions" with audit and governance. | "You set the objective and boundaries". Learning details are not disclosed. | Announced Sep 25, 2026; private preview Oct 2026 | P ([Microsoft blog](https://blogs.microsoft.com/blog/2026/09/25/introducing-the-new-copilot-with-home-code-and-autopilot/)) |
| **Linear Pulse** | A feed of project and initiative updates: **For me** (projects you follow or belong to), plus **Popular** and **Recent**. AI summary to the Linear inbox **daily or weekly** (user's choice), plus an audio digest. | Users choose the cadence; admins enable it. | Apr 2025 | P ([changelog](https://linear.app/changelog/2025-04-16-pulse)) |
| **Linear Triage Intelligence** | Suggests team, project, assignee and labels for incoming issues. | **Accept, decline, or view why**, with a brief explanation. Can be set to auto-apply. | 2025 | S ([docs](https://linear.app/docs/triage-intelligence), [blog](https://linear.app/blog/how-we-built-triage-intelligence)) |
| **Slack AI recaps and Slackbot agent** | Daily recap of channels you **visit but rarely post in** (that is how it suggests channels), with **citations** to the source messages. Slackbot became a personal agent (GA Jan 13, 2026). | Add or remove channels; admin controls. | 2024 to now; 2026 | P/S ([Slack help](https://slack.com/help/articles/25076892548883-Guide-to-Slack-AI), [Salesforce](https://www.salesforce.com/news/press-releases/2026/01/13/slackbot-announcement/)) |
| **Notion Custom Agents** | Background agents on **schedules or triggers** (database changes, Slack, Mail, Calendar). Each can **reach only the pages and apps it is granted**. | **Every run is logged with what triggered it, what it did and any errors.** | Feb 2026 | S ([AlternativeTo](https://alternativeto.net/news/2026/2/notion-3-3-launches-custom-agents-for-autonomous-team-automation), [Notion help](https://www.notion.com/en-gb/help/custom-agent-pricing)) |
| **Apple notification summaries and Reduce Interruptions** | AI summaries of notifications. A Focus mode lets the model decide which notifications break through, with user allowlists. | **Paused for news in Jan 2025 after false headlines.** It returned with clearer AI labelling and per-app disable from the lock screen. | 2024–25 | S ([TechRadar](https://www.techradar.com/computing/artificial-intelligence/how-to-use-apple-intelligences-most-underrated-feature-reduce-interruptions-focus-mode), [CNN via ABC7](https://abc7news.com/post/apple-is-pulling-ai-generated-notifications-news-generating-fake-headlines/15810860/)) |
| **Android 16 notification cooldown** | Successive notifications from the **same app** are softened for up to about 2 minutes. Calls, alarms and high-priority alerts are exempt. | A system toggle. | 2025 | S ([Android Authority](https://androidauthority.com/android-16-notification-cooldown-3501276)) |
| **OpenClaw heartbeat to cron** | **Heartbeat**: a periodic main-session turn (default 30 min) inside `activeHours`. The agent replies `HEARTBEAT_OK` when nothing needs attention, and the reply is dropped if what remains is 300 characters or fewer. Default prompt: _don't infer or repeat old tasks_. `isolatedSession` cuts per-run cost from about 100K to 2–5K tokens. `skipWhenBusy` defers runs. **Cron** handles exact-time or heavy jobs in isolated sessions. | n/a | 2026 | P (docs mirror: [heartbeat.md](https://app.unpkg.com/openclaw@2026.6.6/files/docs/gateway/heartbeat.md)) |

**Cross-cutting lessons**

1. **Finite and batched beats endless.**
   - Pulse capped its feed.
   - Linear and Slack ship daily or weekly digests.
   - Today sorts into three buckets.
   - Nobody successful pushes every item.
2. **User-authored intent beats inferred intent.** This is the main stated lesson of Pulse's retirement. Gemini's Daily Brief ranks by _your goals_; Outlook asks for _your rules_.
3. **The cheapest feedback wins.**
   - Thumbs up/down: Pulse, Gemini.
   - Reply-to-teach: CC.
   - Accept/decline: Linear.
   - Implicit signals such as clicks, ignores and the follow-up dialogue: Vigil, Duolingo.
   - Explicit negative feedback is sparse and ambiguous (Vigil), so combine it with implicit signals.
4. **Explain in one line, with depth on demand:** Outlook reasons, Magic Cue long-press, Linear "why", Slack citations.
5. **Propose, don't act.** Today drafts and proposes, Spark asks before high-stakes actions, Agent Inbox offers accept/edit, Gmail nudges. Execution is one click by the human.
6. **Agents get scoped permissions and run logs:** Notion, Autopilot.
7. **Wrong summaries erode trust fast** (Apple). Pushes about real people's work must quote or link source records, not paraphrase them loosely.

---

## 4. Design patterns

### 4.1 Triggers: event, schedule, condition watchers, debouncing

| Trigger | Use for | Notes |
| --- | --- | --- |
| **Event-driven** (on `raiseAttention`, on a connector webhook) | Time-sensitive items such as blocked-on-you, review requested or a direct ask | Debounce by scheduling a check _N minutes later_ rather than running per event, to coalesce bursts (a PR with 5 comments). Worklog's dedupe already collapses items, so the debounce only needs to collapse runs. |
| **Scheduled** (brief, digest, weekly wrap, consolidation) | Batching; anything that can wait | Backed by the 3×/day batching evidence. Put digests at natural boundaries: start of day, after lunch, end of day. |
| **Condition watchers** ("tell me when X") | User-authored intent such as "when my PR gets approved" or "if #12 has had no activity for 5 days" | Evaluate deterministically (SQL or rules) and call the LLM only on fire. This mirrors ChatGPT monitoring and the cheap-trigger result. |
| **Breakpoint signals** | Flushing held, non-urgent items at a good moment | The owner's own boundary events in the activity stream: PR merged, card closed, review submitted, a work-log entry. These parallel "after commit" in the IUI 2026 study. |

**Debounce, coalesce and cooldown rules:**

- A **debounce window** of 2–5 minutes after the first urgent event.
- A **per-dedupeKey cooldown**: don't re-push the same thread within 4 hours unless priority escalates. This is the same idea as Android 16's cooldown.
- A **minimum gap** between any two pushes (for example, 60–90 minutes) except for blocked-on-you.

### 4.2 Relevance and urgency scoring; interruption budgets

Score each candidate item with **cheap features first**:

- **kind:** blocked-on-you > review requested > direct mention > assignment > watcher activity
- **sender relationship:** how often the owner acts on this sender
- **age, and deadline proximity:** `dueOn`, entropy date
- **owner's historical action rate** for this kind and sender (see §4.3)
- **whether the owner is at a breakpoint**

The LLM then:

- (a) decides per item among push now, digest, or drop, and
- (b) writes the one-line why.

**Interruption budget:** a per-person daily cap on pushes plus a minimum gap. Pinterest uses weekly per-user budgets; LinkedIn uses global and per-type constraints. When the budget is exhausted, items go to the next digest. Never silently drop blocked-on-you items; escalate them in the digest instead.

**Decision rule (in the spirit of the CHI 1999 paper):** push if `p(item needs action soon) × cost_of_delay > interruption_cost(now)`, where

- `interruption_cost` rises with pushes already sent today and when the owner is mid-burst (several of their own events in the last 10 minutes), and
- it falls at breakpoints.

### 4.3 Learning from feedback

**Explicit signals:**

- 👍/👎 on a push or item.
- Dismiss **reasons**: not mine, not important, already handled, wrong time.
- "Should have pinged me": a miss signal on a digest item.

**Implicit signals:**

- Opened or clicked.
- Acted (state set to done, or the external action observed, such as a review submitted) **within X hours** of the push.
- Dismissed without opening.
- Snoozed, and for how long.
- Muted a source.
- **Disabled a delivery target**: the strongest negative, analogous to an unsubscribe.

**Model:**

- Keep Beta(α, β) counts per scope: kind, kind+sender, source+channel. These give a posterior "acted-on" rate.
- Use it as a feature and to propose policy changes.
- **Update cautiously (HAX G14):** don't silently demote a category. Ask the user, in the inbox, as a one-click question:

  > "You've dismissed 7 of the last 8 Slack-mention pings from #random. Move them to your digest? [Yes] [Keep pushing]"

  This is the DoubleAgents "edits → policies" idea.

- **Adaptive threshold:** if 7-day push precision falls below target, shrink the budget or raise the bar. If "should have pinged me" signals appear, lower it.

### 4.4 "Why am I seeing this"

Store a structured explanation on each pushed item:

- the **rule** that created it,
- the **sender**,
- **why now** (priority, deadline, breakpoint, budget state), and
- **who decided** (rules vs. which model and prompt version).

Render one line in the push, for example _"Because @maria requested your review on acme/api#42 (high) — 2 of 4 pings today"_. Behind it, put an expandable view with controls: _Less like this · Digest only · Mute this source_. This follows the moderate-transparency finding from CHI 2016 and the Outlook and Magic Cue patterns.

### 4.5 Clarifying questions and one-click actions

Use the **notify / question / review** taxonomy:

- **Notify:** "Maria is blocked on you for #31." Actions: [Open] [Reply in thread].
- **Question:** "#12 will drift to Not now in 3 days — still on it?" Actions: [Keep active] [Move to Not now] [Mark done].
- **Review:** "Draft reply to Maria's note: '…'". Actions: [Send] [Edit] [Ignore].

**Rules:**

- Actions come from a **fixed catalogue** with typed arguments, executed server-side by deterministic handlers under the owner's authority. This is the "action-selector" pattern, and it is also the main prompt-injection defence.
- Every action is idempotent and recorded as activity with `via: assistant-suggestion`.
- **Ignore** is always available and is itself a signal.

### 4.6 Evaluating proactive agents

**Online metrics,** per person and aggregated:

| Metric | Definition | Starting target |
| --- | --- | --- |
| Push precision | Pushes where at least one item was 👍, opened and acted, or resolved as done within 2 h ÷ pushes | ≥ 0.6 |
| Dismissal-after-push | Items dismissed or 👎 within 24 h of a push ÷ pushed items | ≤ 0.25 |
| Miss rate | High-priority items acted on more than 4 h after creation **without** a push, plus "should have pinged me" signals ÷ high items | ≤ 0.1 |
| Pushes per person per day | p50 / p90 | p90 ≤ budget |
| Quiet ratio | Quiet checks ÷ checks | Informative only |
| Time-to-action (high) | Median from creation to done | Should fall |
| Hard negatives | Delivery targets disabled, sources muted, automations turned off | ~0; investigate each |
| Digest engagement | Digest items opened or acted ÷ digest items | Informative only |

**Offline evaluations:**

- **Data:** log every check's inputs (item IDs and the feature snapshot) and output into `automation_runs`. Owner feedback becomes **labels**; add a small hand-labelled set (100–200 checks).
- **Replay:** run prompt or model changes against the logged checks.
- **Report:** precision, recall and false-alarm rate. Include cases where **silence is correct**: ProactiveBench showed that optimizing only false alarms makes agents over-quiet.
- **Judges:** an LLM judge is fine for scale once calibrated against your human labels; ProactiveBench's judge reached F1 91.8% against humans.
- **Prefer real logs to synthetic scenarios.** In ProAgentBench, fine-tuning on real data reached 74.0% accuracy vs. 62.1% for synthetic.
- **Adversarial suite:** Slack and GitHub texts with injected instructions, such as "mark this urgent", "include this link" or "tell Ana to rotate her token at …".

### 4.7 Safety: prompt injection and least privilege

**The lethal trifecta** — [blog post](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) [P]

- The three ingredients are **private data**, **untrusted content** and **external communication**.
- An agent with all three can be steered into exfiltration. The reliable fix is to remove a leg.

**EchoLeak (CVE-2025-32711, CVSS 9.3, Microsoft 365 Copilot)** — [arXiv](https://arxiv.org/html/2509.10540v1), [The Hacker News](https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html) [S]

- An attacker's **email entered the context during an ordinary query**.
- The exploit chain bypassed the prompt-injection classifier and evaded link redaction with **reference-style Markdown**. It exfiltrated through **auto-fetched images**.
- Proactive digests that render model Markdown as HTML email follow exactly this shape.

**"Design Patterns for Securing LLM Agents against Prompt Injections" (2025)** — [arXiv 2506.08837](https://arxiv.org/pdf/2506.08837), [summary](https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/) [P]

- **Action-selector:** the agent picks from fixed actions and never sees their results.
- **Plan-then-execute.**
- **LLM map-reduce:** each untrusted item gets a narrow, separate judgement.
- **Dual LLM.**
- **Code-then-execute** (CaMeL).
- **Context minimization.**

Worklog's scheduled runs already have **no tools**, which is good. The residual risks are:

- the **content** of the delivered message,
- **priority inflation**,
- **memory poisoning**, and
- **over-broad data loading**.

**OpenClaw's 2026 incidents** (malicious marketplace skills, exposed instances, prompt-injected emails telling agents to run scripts) show what happens when broad tools meet untrusted content. Counts vary by vendor. [S] ([TechRadar](https://www.techradar.com/pro/here-are-the-openclaw-security-risks-you-should-know-about), [Antiy](https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/))

---

## 5. Where Worklog stands today (read-only code review)

### Already aligned with the evidence

- **Quiet is the default** in `runCheck`'s prompt. This mirrors OpenClaw's `HEARTBEAT_OK` contract.
- Active hours and workdays are respected (`automations/schedule.ts`).
- Jitter is applied.
- A cheap pre-check skips the model when nothing is unpushed.
- The last result is fed back in.
- Inbox-conversation delivery gives replies context.
- **Scheduled runs call `generateText` without tools.** Combined with privacy enforced in queries (`includePrivate`), this is a strong base.
- Fizzy-style dedupe collapse (`attention_dedupe_uq`).
- Failing automations raise attention and auto-disable at 10 failures.
- Discord deliveries use `allowed_mentions: { parse: [] }`. Slack uses `unfurl_links: false`.

### Gaps

1. **No feedback capture.**
   - `PATCH /v1/attention/{id}` takes only `state` and `snoozedUntil`.
   - There is no reason, no thumbs and no seen or acted timestamps.
   - The only learning path is free-text memory.
2. **No ledger of what was sent.**
   - `runCheck` marks _every_ pending item `pushedAt`, even on a "quiet" decision (`markPushed(ctx, pending.map(...))`). So `pushedAt` really means "considered".
   - It is impossible to compute push precision, to tell the model what the _last N pushes_ said, or to show "why".
   - `automation_runs` keeps only a free-text `summary`.
3. **The decision is binary and per batch.**
   - `CheckDecision` is `{decision: notify|quiet, message, reason}`.
   - Items the model would hold for the digest are marked considered and only resurface when re-raised. There is no per-item disposition, no "ask" middle zone and no confidence.
4. **No interruption budget or cooldown.**
   - A 30-minute cadence permits about 18 pushes in a 9-hour day.
   - `raiseAttention`'s upsert resets `pushedAt: null` on every re-raise. A busy card thread (`card:${id}` watcher items) or a repeated mention can be reconsidered every cycle.
5. **Fixed polling latency.** A blocked-on-you item can wait up to 30 minutes, while non-urgent items are considered every 30 minutes. Both ends are suboptimal.
6. **Priority inflation surface.**
   - Any member, **including external agents**, can create `high` items via `@mention` (`board/service.ts` `addComment`; GitHub mention handler).
   - The work-log blocker classifier (`activity/worklog.ts`) sets `priority: "high"` for any handle the LLM extracts.
   - Teammate-mode `leave_note_for_owner({urgent: true})` is decided by the model under the asker's influence.
   - None of these are rate-limited per sender.
7. **Drift warnings are informational only.** `briefs/service.ts` lists `driftingSoon` cards, but nothing lets the owner act from the nudge.
8. **Delivery renders model Markdown.**
   - `delivery/service.ts` email path: `marked.parse(message.markdown)` turns model-written Markdown, including images and arbitrary links, into HTML.
   - Slack does not set `unfurl_media: false`.
   - Webhooks receive model prose.
   - Together this is the EchoLeak shape.
9. **Custom automations over-fetch.** `runCustom` always loads:
   - the owner's private snapshot,
   - 7 days of **team** activity (up to 200 untrusted items), and
   - private memory,

   and sends them to the main model regardless of the instructions. Least privilege is not applied.

10. **Memory and preferences are mixed.**
    - Notification preferences live as free-text profile memories, which `runConsolidate` can write from activity text.
    - An injected Slack message the owner quoted could plant "prefers no notifications". There is no provenance on memories.

---

## 6. Recommendations for Worklog (prioritized)

The order reflects value ÷ effort and dependencies: items 1–2 unlock 3, 7, 8 and 9.

### 1. Notification ledger, and split "considered" from "pushed" — **M**

**What**

- Add a new table `notifications`, one row per push:
  - `id, workspaceId, memberId, automationRunId`
  - `targetIds text[]` and `channelResults jsonb`
  - `itemIds text[]`
  - `lead text`
  - `decidedBy` (`rules` | `model:<id>@<promptVersion>`)
  - `budgetState jsonb` (pushes today, minutes since last)
  - `sentAt, openedAt`
- Change `attention_items`:
  - Rename `pushedAt` to `consideredAt`, keeping the reset-on-reopen semantics.
  - Add `lastPushedAt`, `pushCount`.
  - Add `disposition` (`push_now` | `digest` | `brief` | `drop`) and `heldUntil` (the next digest slot).
- Add `automation_runs.inputs jsonb`: item IDs, per-item decisions, model and prompt version. This feeds the replay evaluation.
- Feed the last 3 notifications (lead and item titles) into the check prompt, instead of only `lastResult`.

**API**

- `GET /v1/notifications?since=`
- `GET /v1/notifications/{id}`

**Why**

- Precision and dismissal metrics need a denominator.
- LinkedIn and Pinterest manage volume per send.
- "Never repeat what the last notification said" needs the actual last notifications.
- The "why" view (item 7) needs per-push context.

### 2. Feedback endpoint and implicit signals — **S–M**

**What**

- New table `attention_feedback`:
  - `id, workspaceId, memberId, attentionItemId, notificationId?`
  - `signal` enum: `useful | not_useful | wrong_time | wrong_priority | not_mine | already_handled | should_have_pinged`
  - `note`, `createdAt`
- Columns on `attention_items`: `seenAt`, `actedAt`, `dismissReason`.

**API**

- `POST /v1/attention/{id}/feedback {signal, note?}`
- `POST /v1/notifications/{id}/feedback {signal}` (for the whole push)
- `POST /v1/attention/{id}/seen`
- `PATCH /v1/attention/{id}` accepts an optional `reason` on dismiss.
- **Signed one-click links** for email, Slack and Discord pushes (`GET /f/{token}` → records the signal → redirects), so 👍/👎 works outside the app. Use Slack interactive buttons where a Slack connection exists.

**Assistant**

- Add an owner-mode tool `give_notification_feedback`, so "stop pinging me about #random" becomes a signal and a preference change (item 8), not just a memory.

**Implicit signals**

- Set `actedAt` when an item is resolved `done`, or when the matching external action is observed (for example `review.submitted` for a `gh:review:*` item).
- Opened means `seenAt` or a link click.

**Why**

- HAX G13 and G15.
- Pulse, Gemini Daily Brief, Linear and CC all collect cheap feedback.
- Vigil found explicit negatives sparse and ambiguous, so implicit signals are essential.
- The IUI 2026 field study recommends learning from explicit and implicit behaviour.

### 3. Per-item decisions, an interruption budget, and 2–3 digest slots — **M**

**What**

1. Replace `CheckDecision` with a per-item schema. The server composes the push body from database rows (titles and URLs) plus the sanitized `why`:

   ```ts
   z.object({
     items: z.array(
       z.object({
         id: z.string(),
         action: z.enum(["push_now", "digest", "drop"]),
         why: z.string().max(140), // shown to the user
         confidence: z.number().min(0).max(1),
       })
     ),
     lead: z.string().max(200), // one plain sentence, no links
   });
   ```

2. Run **deterministic gates before the model**:
   - quiet hours;
   - a **daily budget**;
   - a **minimum gap** between pushes;
   - a **per-dedupeKey cooldown** (4 h unless priority escalates);
   - an **allowlist of interrupt-worthy kinds**: `blocking`, `review.requested` from a human, `mention` from a human, `assistant.note` with `urgent`, `automation.failing`.

   Everything else goes to the digest. The model may only downgrade those kinds, never upgrade other kinds to a push.

3. Add a member setting:

   ```ts
   notify?: {
     mode: "urgent_only" | "balanced" | "everything";
     maxPushesPerDay: number;     // default 4
     minGapMinutes: number;       // default 90
     urgentExtra: number;         // default 3, for blocked-on-you
     digestTimes: string[];       // default ["12:30", "16:30"]
   }
   ```

4. Add a `digest` automation kind. It sends `disposition = 'digest'` items at `digestTimes`, together with the morning brief: **three batches a day**. It stays quiet if empty.

**Why**

- Three-a-day batching improved attention, mood and stress; hourly batching did not; full silence raised anxiety (2019 study).
- A faster, more frequent cadence cut preference from 90% to 47% (CHI 2025).
- LLMs over-trigger: ProactiveBench false alarms about 50%; ProAgentBench precision 52–61%; LLMs over-assist.
- Industry examples: Android cooldown; ChatGPT tasks "at most once per hour" and "notify only when significant"; Pinterest budgets.
- Starting defaults are suggestions; tune them with item 9.

### 4. Harden delivery and scope scheduled runs (least privilege) — **S–M**

**What**

- **Sanitize model prose before delivery:**
  - Strip images and raw HTML.
  - Allow links only to the item URLs present in the input, `PUBLIC_URL`, and the hosts of connected providers (`github.com/<org>`, the Slack permalink base). Render all others as plain text.
  - Email: send model text as text with server-built links, and never render remote images.
  - Slack: set `unfurl_media: false`.
  - Webhooks: send structured JSON (`items: [{id, kind, title, url}]` from the database, plus `why` strings) rather than free Markdown, or alongside it.
- **Scopes on automations:** add `automations.scopes text[]`, for example `read:own`, `read:own_private`, `read:team_activity`, `read:memory_private`.
  - Default custom automations to `read:own`.
  - `runCustom` loads only what the scopes allow, and the UI shows the scopes at creation, as Notion does with per-agent access.
  - Add a token and cost cap per run.
- **Provenance:** store the input activity and attention IDs in `automation_runs.inputs` for audit, matching Notion's run log of "what triggered it, what it did".
- **Memory provenance:**
  - Add `memories.sourceActivityIds text[]`.
  - `runConsolidate` must not write anything that changes notification behaviour. Notification preferences live in structured `notify` settings and `attention_prefs` (item 8), changed only by the owner or by owner-approved proposals.
- Keep the invariant **"no tools in scheduled runs"** and write it down. Any future action must go through the action catalogue in item 6.

**Why**

- The lethal trifecta.
- EchoLeak used Markdown images and reference links for exfiltration.
- The design-patterns paper: action-selector and context minimization.
- Notion and Autopilot scope agents to granted resources and audit their runs.
- OpenClaw's 2026 incidents.

### 5. Event-triggered, debounced, breakpoint-aware checks — **S** (debounce), **M** (breakpoints)

**What**

- **Debounced event trigger.** In `raiseAttention`, when the item is interrupt-worthy (item 3), pull the member's `check` automation forward:

  ```sql
  update automations set next_run_at = least(next_run_at, now() + interval '3 minutes')
  where member_id = $1 and kind = 'check' and enabled;
  ```

  Bursts coalesce naturally. Then relax the background sweep from 30 to 60–120 minutes.

- **Breakpoint flush.** When the **owner's own** activity shows a boundary (`pr.merged`, `card.closed`, `review.submitted`, a `log.*` entry), record `state.breakpointAt` on the check automation and pull it forward by 1 minute.
  - Within 10 minutes after a breakpoint, `runCheck` may push **digest-held** items if the budget allows, for example "Nice — #12 is done. 2 things are waiting: …".
  - Conversely, if the owner produced at least 3 events in the last 10 minutes (mid-burst), hold non-urgent items.
- **Optional:** a `{type: "event", on: string[], filter?, debounceMinutes}` schedule variant for custom automations, as condition watchers ("when a PR I reviewed gets new commits").

**Why**

- Boundary interruptions cost less (2005–06 breakpoint studies).
- 52% engagement after a commit vs. 62% dismissal mid-task (IUI 2026).
- Attelia cut perceived load by 33%.
- The CHI 2025 assistant suppressed suggestions while the user was typing.
- Ambient agents are event-stream driven.
- ChatGPT Scheduled Tasks and Notion agents added event triggers.
- A cheap trigger with the LLM only on fire (the 2026 "do agents need an LLM" paper).

### 6. Actionable attention items: notify / question / review, starting with drift nudges — **M**

**What**

- Columns on `attention_items`:
  - `actions jsonb`: `[{id, label, kind, args, style}]`
  - `question text`
  - `resolution jsonb`: `{actionId, by, at}`
- An **action catalogue** with deterministic server handlers:
  - `card.keep_active` (bumps `lastActiveAt` and logs activity)
  - `card.postpone`, `card.close`
  - `attention.snooze {hours}`
  - `pr.open` (link)
  - `note.reply {text}` (posts to the teammate's conversation)
  - `assistant.accept_pref {prefId}` (for item 8)

**API**

- `POST /v1/attention/{id}/actions/{actionId}` with an optional `{args}` for the edit case. It is idempotent, runs as the owner, and records activity `via: "assistant-suggestion"`.
- Slack and Discord buttons and email signed links map to the same endpoint.

**First rule, the drift nudge**

- In `sweepEntropy` (or a new hourly pass), for active cards where `autoPostponeAt − now ≤ 3 days`, raise for each assignee (or the creator if unassigned):
  - kind `card.drifting`, priority `low`
  - `disposition: digest`
  - dedupe `drift:{cardId}:{autoPostponeAt::date}`
  - `question`: "#12 _Fix billing export_ will drift to Not now on Thu — still on it?"
  - actions: [Keep active] [Move to Not now] [Mark done]
- It is never pushed on its own; it rides the digest or brief.

**Second rule**

- A `review.requested` item still open after 24 hours gets [Open PR] [Snooze 1 day] [Ask @requester to reassign] (the last as a drafted note for review).

**Model-proposed actions**

- The check and custom automations may attach catalogue actions to items through structured output (`actionIds`). They never call tools.

**Why**

- LangChain's notify / question / review taxonomy and Agent Inbox's accept / edit / respond / ignore.
- Gmail Nudges.
- The "ask" middle zone from the CHI 1999 mixed-initiative paper.
- Today proposes rather than acts; Spark asks before high-stakes actions.
- Ready-to-apply help halves interpretation time (45 s vs. 101 s).
- DoubleAgents: users want control at uncertain moments.

### 7. "Why am I seeing this" — **S**

**What**

- Add `attention_items.explanation jsonb`, filled by the creating rule (`{rule, from, matched}`).
- Add per-push `why` and `decidedBy` from items 1 and 3.
- Render one line in every push and digest entry, plus a "Why?" link to `GET /v1/attention/{id}/explain`. That endpoint returns the rule, the sender, the timing reason, the budget state and the decider, plus controls: _Less like this · Digest only · Mute source_, which write `attention_prefs`.

**Why**

- HAX G11.
- Moderate transparency maximizes trust (CHI 2016).
- Outlook priority reasons, Magic Cue long-press, Linear "why", Slack citations.
- Presence and context cues reduced disruption in Codellaborator.

### 8. Learned per-scope preferences with "update cautiously" — **M**

**What**

- New table `attention_prefs`:
  - `id, memberId`
  - `scope jsonb`: `{kind?, fromId?, source?, channel?}`
  - `mode`: `push | digest | mute`
  - `alpha, beta`: Beta counts from feedback
  - `setBy`: `user | learned_approved`
  - `updatedAt`
- **Nightly job:**
  - Update α (useful, or acted within 2 h) and β (not useful, dismissed unseen, wrong time).
  - When a scope's posterior mean is below 0.3 with n ≥ 8 (or above 0.8 for a digest scope), raise an `assistant.question` item with [Yes] [No] actions instead of changing behaviour silently.
- **Adaptive budget:** if 7-day push precision is below 0.6, reduce `maxPushesPerDay` by 1 (floor 2) and tell the user in the next brief. If `should_have_pinged` signals appear, increase it.
- Feed a compact preference table into the check prompt, replacing free-text guesses.

**API**

- `GET/PUT /v1/me/notify`
- `GET /v1/me/attention-prefs`, `PATCH /v1/me/attention-prefs/{id}`

**Why**

- Priorities learned from behaviour.
- Interruption aversion is personal and inferable from behaviour (DIS 2016).
- Expectation and threshold control preserve acceptance (CHI 2019).
- HAX G14 and G18.
- Long-horizon optimization sends less with equal engagement.
- Memory improves when-to-assist accuracy (ProAgentBench: 53.7% to 60.1%).

### 9. Evaluation harness and metrics — **M**

**What**

- A metrics endpoint `GET /v1/metrics/proactive?memberId=&days=` (admin or self). It returns the online metrics in §4.6, computed from `notifications`, `attention_feedback` and `attention_items`.
- **Offline replay:** a script reads `automation_runs.inputs`, re-runs a candidate prompt or model, and compares against labels from feedback plus a hand-labelled seed set (100–200 checks, including correct-silence cases).
  - Report precision, recall, false-alarm rate and cost.
  - Gate prompt or model changes on no regression.
- An **injection test set**: synthetic Slack, GitHub and teammate-note texts with instructions. Assert that pushes contain no foreign links, no inflated priority and no instruction-following.
- A calibrated LLM judge is optional; human labels stay the ground truth.

**Why**

- ProactiveBench (judge F1 91.8% vs. humans; over-quiet failure mode).
- ProAgentBench (real data beats synthetic).
- Vigil's LLM review of unaccepted answers.
- The LinkedIn and Pinterest emphasis on negative and long-term metrics.

### 10. Priority-inflation quotas — **S**

**What**

- Per (sender → recipient), at most **2 `high` items per day** from mentions, notes and blocker classification. Beyond that, items are created as `normal` with an explanation ("downgraded: 3rd urgent item from @x today").
- **External agent members:** `high` only for kinds in an allowlist (for example a failing CI that blocks the owner's PR). Otherwise cap at `normal`.
- In teammate mode, the assistant tells the asker what will happen: "I've left a note; Ana sees notes in her 12:30 digest unless it blocks work today."
- Track each sender's urgent-note acted-on rate and show it to the owner.

**Why**

- Sender relationship drives perceived disruption (CHI 2016).
- Injection and abuse resistance.
- Expectation setting for the asker (CHI 2019).

### 11. Automation entropy — **S**

**What**

- If a custom automation's deliveries get **no opens, replies or 👍 for N consecutive runs** (default 10), auto-pause it.
- Raise an `automation.paused` item with [Resume] [Delete].
- Show `quiet` and `delivered` counts on the automation list.

**Why**

- ChatGPT Scheduled Tasks auto-pause when unattended.
- The same philosophy as Fizzy's entropy.
- It reduces cost and noise.

### 12. Presence indicator and global controls — **S**

**What**

- An inbox header: _"Quiet until 12:30 — 3 items held"_.
- One-tap controls: **Hold everything until…**, **Only blocked-on-you today**, **Pause assistant pings**. These are stored as temporary overrides in `members.settings.notify`.
- The SSE `attention.updated` payload already exists; add `disposition` to it.

**Why**

- HAX G17.
- Presence indicators reduced disruption (Codellaborator).
- Visible held items counter the anxiety of full silence (2019 batching study; MobileHCI 2017; CSCW 2010).
- Apple Reduce Interruptions-style allowlists.

### Suggested sequencing

- **Sprint 1:** items 1, 2, 4 (sanitization and Slack flag), 5 (debounce part) and 10.
- **Sprint 2:** item 3 (budget and digests), item 6 (drift nudge) and item 7.
- **Sprint 3:** items 8 and 9, then 11 and 12.

---

## 7. Schema sketch (Drizzle, illustrative only; not applied)

```ts
export const NOTIFY_DISPOSITIONS = [
  "push_now",
  "digest",
  "brief",
  "drop",
] as const;

// attention_items additions
//   consideredAt  (renamed from pushedAt), lastPushedAt, pushCount int default 0
//   disposition   text enum NOTIFY_DISPOSITIONS, heldUntil timestamptz
//   seenAt, actedAt, dismissReason text
//   explanation   jsonb {rule, from?, matched?}
//   actions       jsonb [{id, label, kind, args, style}]
//   question      text
//   resolution    jsonb {actionId, by, at}

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    automationRunId: text("automation_run_id").references(
      () => automationRuns.id
    ),
    itemIds: text("item_ids").array().notNull(),
    targetIds: text("target_ids").array().notNull(),
    channelResults: jsonb("channel_results")
      .$type<Record<string, "ok" | string>>()
      .notNull()
      .default({}),
    lead: text("lead").notNull(),
    decidedBy: text("decided_by").notNull(), // "rules" | "model:<id>@<promptVersion>"
    budgetState: jsonb("budget_state")
      .$type<{ today: number; minutesSinceLast: number | null }>()
      .notNull(),
    sentAt: ts("sent_at").notNull(),
    openedAt: ts("opened_at"),
  },
  (t) => [index("notifications_member_time_idx").on(t.memberId, t.sentAt)]
);

export const FEEDBACK_SIGNALS = [
  "useful",
  "not_useful",
  "wrong_time",
  "wrong_priority",
  "not_mine",
  "already_handled",
  "should_have_pinged",
] as const;

export const attentionFeedback = pgTable(
  "attention_feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    attentionItemId: text("attention_item_id").references(
      () => attentionItems.id,
      { onDelete: "set null" }
    ),
    notificationId: text("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),
    signal: text("signal", { enum: FEEDBACK_SIGNALS }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("attention_feedback_member_idx").on(t.memberId, t.createdAt)]
);

export const attentionPrefs = pgTable("attention_prefs", {
  id: text("id").primaryKey(),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  scope: jsonb("scope")
    .$type<{
      kind?: string;
      fromId?: string;
      source?: string;
      channel?: string;
    }>()
    .notNull(),
  mode: text("mode", { enum: ["push", "digest", "mute"] }).notNull(),
  alpha: integer("alpha").notNull().default(1),
  beta: integer("beta").notNull().default(1),
  setBy: text("set_by", { enum: ["user", "learned_approved"] }).notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// MemberSettings.notify (see §6 item 3); automations.scopes text[]; automation_runs.inputs jsonb;
// AUTOMATION_KINDS += "digest"; Schedule |= { type: "event"; on: string[]; filter?: Record<string, unknown>; debounceMinutes: number }
// memories.sourceActivityIds text[]
```

---

## 8. Open questions for the team

1. **Should `review.requested` from an _agent_ member (for example a coding agent asking for review) count as interrupt-worthy?** Recommendation: only if a human is also waiting, for example when the PR is linked to a golden card.
2. **Digest channel:** in-app only, or also the user's chosen targets? Recommendation: in-app plus email by default, and Slack only if the user opts in. Slack DMs are themselves interruptions.
3. **Should teammates see the owner's notification mode** ("Ana is in urgent-only until 14:00") to set expectations, or is that private? Recommendation: show it as team-visible status, opt-out.
4. **Agent members as recipients:** should external agents have attention items and budgets? This would let a coding agent's "blocked on human" flow use the same rails.

---

## 9. Unverified or weakly sourced claims (handle with care)

- **The 12-principle list from the CHI 1999 mixed-initiative paper [U].** It is reproduced from memory. The act / dialog / no-action thresholds and the expected-utility formula are corroborated by course slides [S]. I could not extract text from the PDF in this environment.
- **ChatGPT Pulse retirement [S].** Reported consistently by Gigazine, Digit, AI Weekly and others, quoting the ChatGPT account. OpenAI's official page could not be fetched (HTTP 403).
- **Scheduled Tasks details [S]/[U].**
  - "At most once per hour" and "auto-pause when unattended" are [S].
  - "Event triggers from Gmail, Slack or GitHub since late August 2026" is **[U]** (secondary aggregators only).
- **Microsoft Copilot "Today" and Autopilot [P].** These are from Microsoft's blog announcement. They are in private preview, so shipped behaviour may differ.
- **The 2019 batching study [S].** Arm count (three vs. four) and N differ between the abstract and the publisher blog. Effect sizes were not retrieved.
- **Interruption numbers [S].**
  - The "10 minutes + 10–15 minutes" recovery figure comes from a quotation, not from reading the CHI 2007 PDF.
  - The "about 275 pings a day" Work Trend Index figure comes from press coverage of Microsoft's report.
- **Sample size (103) for the CHI 2016 transparency study [S]** comes from a single secondary source. The precision/recall perception result in the "imperfect AI" paper is [S], via course summaries.
- **The Inner Thoughts paper's CHI 2025 acceptance is unconfirmed.**
- **OpenClaw security statistics** (malicious-skill counts, exposed instances, "79% injection success") vary by vendor and are [S]/[U].
- **Default numbers in §6** (budgets, gaps, the 0.6 precision target, the 3-day drift lead, Beta thresholds) are **my starting suggestions**, not values measured in any study. Tune them with the metrics in item 9.

---

## 10. Sources

**Foundations and HCI**

- Principles of Mixed-Initiative User Interfaces (CHI 1999): https://erichorvitz.com/uiact.htm · https://www.erichorvitz.com/chi99horvitz.pdf
- Attention-Sensitive Alerting (UAI 1999): https://arxiv.org/pdf/1301.6707 · https://www.microsoft.com/en-us/research/publication/attention-sensitive-alerting/
- Guidelines for Human-AI Interaction (CHI 2019), HAX library: https://www.microsoft.com/en-us/haxtoolkit/library/
- Mental workload and opportune moments (CHI 2005): https://www.interruptions.net/literature/Iqbal-CHI05-p1489-iqbal.pdf
- Task structure and cost of interruption (CHI 2006): https://interruptions.net/literature/Iqbal-CHI06-p741-iqbal.pdf
- Disruption and Recovery of Computing Tasks (CHI 2007): https://www.erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf
- The cost of interrupted work (CHI 2008): https://www.ics.uci.edu/~gmark/chi08-mark.pdf
- Notifications and Awareness (CSCW 2010): https://www.erichorvitz.com/shamsi_iqbal-eric_horvitz_cscw_2010.pdf
- My Phone and Me (CHI 2016): https://discovery.ucl.ac.uk/id/eprint/1502364/
- Intelligent Notification Systems survey (Attelia numbers): https://arxiv.org/pdf/1711.10171
- Batching smartphone notifications (CHB 2019): https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity · https://scholars.duke.edu/publication/1402953
- Productive, Anxious, Lonely (MobileHCI 2017): https://arxiv.org/pdf/1612.02314
- How much information? (CHI 2016): https://www.cs.mcgill.ca/~jeromew/data/COMP766/CHI2016/p2390-kizilcec.pdf
- Will You Accept an Imperfect AI? (CHI 2019): https://microsoft.com/en-us/research/uploads/prod/2019/01/chi19_kocielnik_et_al.pdf
- What Can You Do? (DIS 2016): https://archive.cps-vo.org/node/38784
- Microsoft Work Trend Index 2025 coverage: https://www.axios.com/2025/06/17/microsoft-remote-work-meetings · https://www.unleash.ai/artificial-intelligence/microsoft-employees-are-interrupted-every-2-minutes-how-can-ai-help-us-re-focus-on-the-work-that-matters/

**Volume and learning (industry research)**

- LinkedIn, Less is more (email volume): https://www.linkedin.com/blog/engineering/archive/less-is-more-optimizing-email-volume-part-1
- Pinterest, notification volume optimization: https://medium.com/pinterest-engineering/user-state-based-notification-volume-optimization-7764118f73ff
- Should I send this notification?: https://arxiv.org/abs/2202.08812
- Duolingo, sleeping recovering bandit (KDD 2020): https://research.duolingo.com/papers/yancey.kdd20.pdf

**LLM proactive agents**

- ProactiveBench (ICLR 2025): https://arxiv.org/html/2410.12361v3 · https://proceedings.iclr.cc/paper_files/paper/2025/hash/75c37811e830bf029584b1c6fac17726-Abstract-Conference.html
- ProAgentBench: https://arxiv.org/html/2602.04482v1
- Do Proactive Agents Need an LLM to Decide When to Act?: https://arxiv.org/abs/2605.30152
- AI Assistants Overassist: https://arxiv.org/abs/2607.21306
- Proactive Conversational Agents with Inner Thoughts: https://arxiv.org/abs/2501.00383v2
- Knowing Isn't Understanding (position): https://www.arxiv.org/abs/2602.15259
- TimelyAI workshop (CHIWORK 2026): https://ceur-ws.org/Vol-4265/
- Need Help? (CHI 2025): https://arxiv.org/html/2410.04596v2
- Assistance or Disruption? (Codellaborator): https://arxiv.org/abs/2502.18658
- Developer Interaction Patterns with Proactive AI (IUI 2026): https://arxiv.org/html/2601.10253v1
- Having Lunch Now: https://arxiv.org/abs/2509.24073
- DoubleAgents: https://arxiv.org/abs/2509.12626
- Help Without Being Asked (Vigil): https://arxiv.org/html/2604.09579
- ProMemAssist (UIST 2025): https://arxiv.org/html/2507.21378v1
- Sensing What Surveys Miss (CHI 2026): https://arxiv.org/abs/2602.00880
- How Users Perceive Mixed-Initiative AI (IUI 2026): https://arxiv.org/abs/2602.01481
- Omakase: https://arxiv.org/abs/2604.08898
- Sensible Agent (UIST 2025): https://research.google/blog/sensible-agent-a-framework-for-unobtrusive-interaction-with-proactive-ar-agents/

**Industry**

- ChatGPT Pulse: https://techcrunch.com/2025/09/25/openai-launches-chatgpt-pulse-to-proactively-write-you-morning-briefs/ · https://help.openai.com/en/articles/12293630
- Pulse retirement and Scheduled Tasks: https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html · https://gigazine.net/gsc_news/en/20260619-chatgpt-scheduled-tasks/ · https://aiweekly.co/alerts/openai-brings-scheduled-tasks-and-web-monitoring-to-chatgpt · https://help.openai.com/en/articles/10291617
- LangChain ambient agents: https://www.langchain.com/blog/introducing-ambient-agents · Agent Inbox: https://github.com/langchain-ai/agent-inbox
- Gmail Nudges: https://workspaceupdates.googleblog.com/2018/05/gmail-remind-respond.html · https://9to5google.com/2018/05/14/new-gmail-web-nudge-ai-reminders/
- Pixel Magic Cue: https://9to5google.com/2025/08/20/pixel-10-magic-cue-launch/
- Google Labs CC: https://siliconangle.com/2025/12/16/google-tests-cc-ai-agent-summarize-email-calendars-documents/ · https://9to5google.com/2025/12/16/google-labs-cc/
- Gemini Daily Brief and Spark: https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/ · https://blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements/
- Outlook, Prioritize my inbox: https://support.microsoft.com/topic/prioritize-my-inbox-65e37040-2c90-4ee3-86d9-e95d5ba0e3cb
- Microsoft Copilot Today and Autopilot: https://blogs.microsoft.com/blog/2026/09/25/introducing-the-new-copilot-with-home-code-and-autopilot/
- Linear Pulse: https://linear.app/changelog/2025-04-16-pulse · Triage Intelligence: https://linear.app/docs/triage-intelligence · https://linear.app/blog/how-we-built-triage-intelligence
- Slack AI recaps: https://slack.com/help/articles/25076892548883-Guide-to-Slack-AI · Slackbot GA: https://www.salesforce.com/news/press-releases/2026/01/13/slackbot-announcement/
- Notion Custom Agents: https://alternativeto.net/news/2026/2/notion-3-3-launches-custom-agents-for-autonomous-team-automation · https://www.notion.com/en-gb/help/custom-agent-pricing
- Apple summaries pause: https://abc7news.com/post/apple-is-pulling-ai-generated-notifications-news-generating-fake-headlines/15810860/ · Reduce Interruptions: https://www.techradar.com/computing/artificial-intelligence/how-to-use-apple-intelligences-most-underrated-feature-reduce-interruptions-focus-mode
- Android 16 notification cooldown: https://androidauthority.com/android-16-notification-cooldown-3501276
- OpenClaw heartbeat docs (mirror): https://app.unpkg.com/openclaw@2026.6.6/files/docs/gateway/heartbeat.md

**Safety**

- The lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- Design Patterns for Securing LLM Agents against Prompt Injections: https://arxiv.org/pdf/2506.08837 · https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/
- EchoLeak (CVE-2025-32711): https://arxiv.org/html/2509.10540v1 · https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html
- OpenClaw security coverage: https://www.techradar.com/pro/here-are-the-openclaw-security-risks-you-should-know-about · https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/
