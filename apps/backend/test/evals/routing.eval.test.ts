import { describe, expect, it } from "vitest";

import {
  createEvalRuntime,
  didRouteTo,
  extractToolCalls,
  shouldRunOnlineEvals
} from "./eval-support.js";
import { routingCases } from "./routing.cases.js";

const runOnlineEvals = shouldRunOnlineEvals();

interface RoutingOutput {
  activeAgentId: string;
  finalOutput: string;
  toolCalls: { name: string }[];
}

describe.skipIf(!runOnlineEvals)("root manager routing eval", () => {
  it.each(routingCases)("$id routes to $expectedAgentId", async (testCase) => {
    const output = await runRoutingCase(testCase.input);
    const passed = didRouteTo(output, testCase.expectedAgentId);

    expect(
      passed,
      JSON.stringify(
        {
          id: testCase.id,
          expectedAgentId: testCase.expectedAgentId,
          actualActiveAgentId: output.activeAgentId,
          toolCallNames: output.toolCalls.map((call) => call.name)
        },
        null,
        2
      )
    ).toBe(true);
  }, 180_000);
});

async function runRoutingCase(input: string): Promise<RoutingOutput> {
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
      toolCalls: extractToolCalls(result.newItems)
    };
  } finally {
    await runtime.close();
  }
}
