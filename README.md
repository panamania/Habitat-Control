# Habitat Control

Your agent threads, as a colony you can reach into.

Every coding-agent thread on your machine becomes a small astronaut on a hex-tile moon. Each repo
claims a plot of ground and the astronauts build on it. When one needs you, it stops and holds a
`?` over its head. Habitat Control is a fork of
[Bot Crossing](https://github.com/Station-Sciences/bot-crossing) by Jarren Rocks, which does all
of that. This fork adds the part where you can act on what you see.

## What this fork adds

- **Ask an agent from its card.** Click an astronaut, type a question, and the answer streams back
  while the thread card shows what the agent is doing, tool by tool. Works for resumable Claude
  Code threads and for agents on AWS Bedrock and Kubernetes.
- **Agents beyond your laptop.** AWS Bedrock Agents and self-hosted Kubernetes agents show up as
  harnesses next to the local ones. One zone is one deployed agent.
- **A confirmation step for risky zones.** Zones can be marked high-stakes (trading and banking
  start that way), and an invocation there needs an explicit confirmation before anything runs.
- **Found a new hex space.** The `+` beside Repos creates an empty folder and opens a fresh Claude
  Code session in it. The plot appears as soon as the session does.
- **Rename plots.** Give a repo a display name without touching anything on disk.

Everything else, including the map layout, the astronauts and the harness adapters, is Bot
Crossing's work. The colony is still read from your harnesses' own files, on your own machine.

## Run it

```bash
cd bot-views
npm install
npm run dev
```

Needs Node 22.13 or newer. `npm test` runs the suite. It starts with zero cloud credentials: AWS
and Kubernetes simply show as not detected until you set their environment variables (the headers
of `bot-views/server/platforms/aws-bedrock.mjs` and `k8s-agents.mjs` list them).

## What is real and what is a sketch

- **Local harnesses** (Claude Code, Codex, Cursor) work as in Bot Crossing.
- **AWS Bedrock** is checked against the installed SDK. Invoking an agent needs an
  agent-to-alias map you maintain yourself (`AWS_BEDROCK_AGENT_ALIASES`).
- **Kubernetes** is the one to treat as a starting point. It relies on a pod-labeling convention
  (`agent-colony/*`) that nothing writes for you yet.
- **Azure and GCP** adapters are not included.
- **Deployment** as an in-cluster service behind a tunnel is described in the architecture doc but
  not built. Today this runs as a single localhost process, like the original.

## Writes and trust

Watching the colony never writes to a harness. The two exceptions are things you ask for: Ask on
a Claude Code thread resumes that session through the `claude` CLI, so it adds to that thread, and
the `+` button creates a new project folder. See [ADR-001](ADR-001-trust-model.md) for the trust
model.

## Where to read more

| | |
| --- | --- |
| [`bot-views/README.md`](bot-views/README.md) | The full project README: harnesses, layout, rendering, settings |
| [`bot-views/INTEGRATION_NOTES.md`](bot-views/INTEGRATION_NOTES.md) | What this fork changed, and what is deliberately not done |
| [`HABITAT_CONTROL_ARCHITECTURE.md`](HABITAT_CONTROL_ARCHITECTURE.md) | The spec this fork is being brought in line with |
| [`SPEC.md`](SPEC.md), [`SPRINT_PLAN.md`](SPRINT_PLAN.md) | Scope and plan |

## Credit and licence

Built on [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) by
[Jarren Rocks](https://jarren.rocks), MIT licensed. See [`bot-views/LICENSE`](bot-views/LICENSE).
