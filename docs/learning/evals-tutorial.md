# Evals Tutorial

This tutorial assumes you already know Vitest syntax. The goal is to learn what
makes an eval different from a normal test and how to add one to Pineapple
without turning it into a vague prompt experiment.

## 1. What An Eval Is

An eval is a repeatable measurement of behavior that is partly probabilistic,
qualitative, or model-dependent.

A normal unit test usually asks:

```text
Given this input, does the function return exactly this output?
```

An eval asks:

```text
Given this task, does the system produce an acceptable result according to a
grader, across enough examples to trust the change?
```

The basic shape is:

```text
dataset -> system under test -> output -> grader -> score -> threshold
```

In OpenAI's Evals API, the same idea is split into an Eval, which defines the
data shape and testing criteria, and a Run, which executes that eval against a
candidate. OpenAI's current docs also distinguish between code-based grading and
model-based grading, which is the same split you should use locally.

Useful references:

- [OpenAI Evals API reference](https://platform.openai.com/docs/api-reference/evals)
- [OpenAI evals guide](https://platform.openai.com/docs/guides/evals)
- [Getting started with OpenAI evals](https://developers.openai.com/cookbook/examples/evaluation/getting_started_with_openai_evals)

## 2. When To Write An Eval

Use a unit test when correctness is crisp:

- a parser accepts or rejects input
- a schema migration preserves a field
- a tool handler calls the right store
- a route returns a specific status code

Use an eval when correctness needs judgment over several examples:

- an agent picks the right specialist
- a summarizer keeps the important facts
- a tool-using agent calls the right tool with acceptable arguments
- a prompt change should improve behavior without breaking old cases
- a model upgrade should be at least as good as the current model

For Pineapple, the most valuable first evals are routing and tool-use evals,
because bad routing silently sends work to the wrong agent.

## 3. Pick One Behavior

Do not start with "evaluate the agent." Start with one behavior:

```text
When the user asks for a reminder, the root manager should use the scheduler.
```

Write down the contract before writing code:

```text
Input:
- A natural-language user request.

Expected behavior:
- The root manager should delegate to scheduler or call ask_scheduler.
- It should not answer as a general assistant.
- It should preserve the reminder time and message.

Pass condition:
- 90% of examples route correctly.
- 80% of examples preserve required entities.
```

That contract becomes your dataset fields and your grader.

## 4. Build A Small Dataset

Start with 10 to 20 hand-written examples. The dataset is not trying to
simulate Pineapple. It is just a boring list of user messages and what should
happen for each one.

For routing, each row should answer:

```text
If the user says this, which specialist should root_manager choose?
Which important words must survive delegation?
```

Example dataset shape:

```ts
interface RoutingEvalCase {
  id: string;
  input: string;
  expectedAgentId: string;
  requiredTerms: string[];
}

const cases: RoutingEvalCase[] = [
  {
    id: "simple-reminder",
    input: "Remind me tomorrow at 8am to pay the internet bill.",
    expectedAgentId: "scheduler",
    requiredTerms: ["tomorrow", "8am", "pay the internet bill"]
  },
  {
    id: "general-question",
    input: "Explain why PostgreSQL indexes help query speed.",
    expectedAgentId: "general_assistant",
    requiredTerms: ["PostgreSQL", "indexes"]
  },
  {
    id: "coding-test-failure",
    input: "The backend Vitest suite is failing. Inspect the repo and fix it.",
    expectedAgentId: "codex",
    requiredTerms: ["backend", "Vitest", "fix"]
  },
  {
    id: "play-spotify-now",
    input: "Play my focus playlist on Spotify.",
    expectedAgentId: "assistant_audio_bridge",
    requiredTerms: ["focus playlist", "Spotify"]
  },
  {
    id: "future-music-is-scheduler",
    input: "At 6pm, play my focus playlist on Spotify.",
    expectedAgentId: "scheduler",
    requiredTerms: ["6pm", "focus playlist", "Spotify"]
  },
  {
    id: "shortcut-coding-story",
    input: "Shortcut story APP-123 says add a settings page to the web app. Start working on this.",
    expectedAgentId: "codex",
    requiredTerms: ["APP-123", "settings page", "web app"]
  }
];
```

Store durable datasets in a plain file once they grow:

```text
apps/backend/test/evals/routing.cases.ts
apps/backend/test/evals/routing.eval.test.ts
```

Keep the case IDs stable. They make regressions easy to discuss.

## 5. Write A Thin Runner

The runner adapts the dataset to the real system. It should not contain routing
logic. If the runner says `if input includes remind, return scheduler`, the eval
is testing the fake runner instead of Pineapple.

Use the real Pineapple runtime for the behavior under test:

```text
Real:
- root_manager prompt
- agent manifests
- specialist handoff descriptions
- ask_* tools and handoffs
- model call

Fake or simplified:
- in-memory stores
- test input strings
- disabled external side effects where possible
```

For a Pineapple routing eval, the runner should call `runtime.executeTurn`. Use
`executeTurn` instead of `runTurn` when the grader needs tool-call details.

```ts
async function runRoutingCase(input: string) {
  const runtime = createEvalRuntime();

  try {
    await runtime.initialize();

    const result = await runtime.executeTurn({
      agentId: "root_manager",
      input
    });

    return {
      activeAgentId: result.activeAgentId,
      finalOutput: result.finalOutput,
      toolCallNames: extractToolCallNames(result.newItems)
    };
  } finally {
    await runtime.close();
  }
}
```

Why check tool calls? Pineapple can delegate in two valid ways:

```text
handoff to scheduler -> activeAgentId becomes scheduler
call ask_scheduler -> activeAgentId may stay root_manager, but routing was still correct
```

The grader should accept either one for routing:

```ts
function didRouteTo(output: RoutingOutput, expectedAgentId: string): boolean {
  return (
    output.activeAgentId === expectedAgentId ||
    output.toolCallNames.includes(`ask_${expectedAgentId}`)
  );
}
```

For fast local evals, you can also evaluate a narrower function. That is often
better than running the full model loop while you are still designing the
grader.

## 6. Write Graders

A grader turns output into a score and failure reason.

Start with code graders whenever possible. They are cheap, stable, and easy to
debug.

```ts
interface Grade {
  passed: boolean;
  score: number;
  reason?: string;
}

function gradeAgentRoute(
  actualAgentId: string,
  expectedAgentId: string
): Grade {
  if (actualAgentId === expectedAgentId) {
    return { passed: true, score: 1 };
  }

  return {
    passed: false,
    score: 0,
    reason: `Expected ${expectedAgentId}, got ${actualAgentId}.`
  };
}
```

Add model graders only when code cannot express the quality you need. Good uses:

- summary completeness
- tone or style adherence
- answer usefulness
- "did the assistant actually solve the user's request?"

Bad uses:

- checking exact JSON validity
- checking whether a required field exists
- checking whether a tool was called
- checking a count, ID, enum, or timestamp

Those belong in code.

## 7. Aggregate Scores

One failed case should be visible, but a prompt or model should be judged across
the set.

```ts
function average(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}
```

Typical thresholds:

- `1.0`: deterministic code behavior, no tolerance
- `0.95`: critical agent behavior with a small known noisy surface
- `0.8` to `0.9`: early prompt eval while you are still collecting cases

Do not hide failures behind only the aggregate. Print or assert the failed case
IDs so the next debugging step is obvious.

## 8. Put It In Vitest

You can use Vitest as the eval harness. The important part is that the test is
dataset-driven and reports per-case failures.

```ts
import { describe, expect, it } from "vitest";

const runOnlineEvals = parseBooleanEnv(process.env.EVAL_OPENAI_ENABLED) ?? false;

describe.skipIf(!runOnlineEvals)("root manager routing eval", () => {
  it.each(cases)("$id routes to $expectedAgentId", async (testCase) => {
    const output = await runRoutingCase(testCase.input);
    const grade = gradeAgentRoute(output.activeAgentId, testCase.expectedAgentId);

    expect(grade.passed, grade.reason).toBe(true);
  }, 120_000);
});

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}
```

Run it explicitly:

```bash
EVAL_OPENAI_ENABLED=true pnpm --filter @pineapple/backend exec vitest run test/evals
```

Keep online evals opt-in unless you intentionally want CI to spend tokens and
depend on the model service.

## 9. Debug Like A Product Failure

When an eval fails, do not immediately rewrite the prompt. Classify the failure:

- Dataset issue: the expected answer is wrong or underspecified.
- Runner issue: the eval is not calling the same path as production.
- Grader issue: the grader is too strict, too loose, or checks the wrong thing.
- Prompt issue: the agent had enough information but made the wrong decision.
- Architecture issue: the prompt is being asked to enforce something code should own.
- Model issue: behavior changes with model/settings despite the same contract.

Then make the smallest fix and rerun the same eval. If you change the dataset,
say why in the commit or PR.

## 10. Grow The Eval Set

Add examples when:

- a user reports a bad answer
- you fix a routing or tool-use bug
- you change an agent prompt
- you change model, tool schema, or handoff design
- you add a new adapter such as Telegram or Shortcut

Use this rule:

```text
Every meaningful model-behavior bug should become at least one eval case.
```

That is how evals become regression protection instead of one-off experiments.

## 11. Local Vitest Eval vs OpenAI Evals API

Use local Vitest evals when:

- you need repo-native tests beside code changes
- the runner depends on Pineapple internals
- the grader is mostly code
- you want PR-level regression checks

Use the OpenAI Evals API when:

- you want platform-hosted eval runs and result history
- you want to compare model/settings candidates
- your dataset and grader fit the API's data source and testing criteria model
- non-repo stakeholders need to inspect runs outside the test output

Current OpenAI API shape for creating an eval looks like this:

```ts
import OpenAI from "openai";

const openai = new OpenAI();

const evalObj = await openai.evals.create({
  name: "Root manager routing",
  data_source_config: {
    type: "stored_completions",
    metadata: { usecase: "pineapple-routing" }
  },
  testing_criteria: [
    {
      type: "label_model",
      model: "o3-mini",
      input: [
        {
          role: "developer",
          content:
            "Label whether the sampled response correctly routed the user request."
        },
        {
          role: "user",
          content:
            "Request: {{item.input}}\nExpected agent: {{item.expectedAgentId}}\nOutput: {{sample.output_text}}"
        }
      ],
      passing_labels: ["correct"],
      labels: ["correct", "incorrect"],
      name: "Routing label grader"
    }
  ]
});

console.log(evalObj.id);
```

Do not jump to the platform first. Start locally until you know your dataset and
grader are meaningful, then move stable evals to the platform if hosted history
or model comparisons are useful.

## 12. Checklist For A Good First Eval

- [ ] It evaluates one named behavior.
- [ ] The dataset has stable case IDs.
- [ ] The pass condition is written before the grader.
- [ ] Code graders are used for structural facts.
- [ ] Model graders are used only for judgment calls.
- [ ] The aggregate threshold is explicit.
- [ ] Failed case IDs are visible.
- [ ] Online model calls are opt-in.
- [ ] New production failures become new cases.

## Suggested First Pineapple Eval

Start with root-manager routing:

```text
Goal:
Confirm that root_manager chooses the right specialist for scheduler,
assistant_audio_bridge, codex, and general requests.

Dataset:
20 short user requests, five per category.

Runner:
Call the runtime with agentId=root_manager.

Graders:
1. Code grader checks activeAgentId.
2. Code grader checks required terms appear in finalOutput or tool arguments.
3. Optional model grader checks whether the response actually addresses the task.

Threshold:
Route accuracy >= 0.9 for the first version, then tighten once stable.
```

That eval will teach the core workflow without needing a large dataset or a
complicated model-as-judge prompt.
