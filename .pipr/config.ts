import { definePipr } from "@usepipr/sdk";

export default definePipr((pipr) => {
  const model = pipr.model({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: pipr.secret({ name: "DEEPSEEK_API_KEY" }),
    thinking: "medium",
  });

  pipr.config({
    publication: { maxInlineComments: 5 },
    limits: {
      diffManifest: {
        fullMaxBytes: 1,
        fullMaxEstimatedTokens: 1,
        condensedMaxBytes: 1_200,
        condensedMaxEstimatedTokens: 10_000,
        maxShards: 4,
      },
    },
  });

  const security = pipr.agent({
    name: "Security reviewer",
    model,
    instructions:
      "Report only concrete security regressions introduced by the change. Return no finding when there is no exploitable path.",
    output: pipr.schemas.review,
    tools: pipr.tools.readOnly,
    prompt: () => "Review the supplied Diff Manifest for security regressions.",
  });

  const tests = pipr.agent({
    name: "Test reviewer",
    model,
    instructions:
      "Report only concrete behavior changes that lack regression coverage capable of catching a real failure.",
    output: pipr.schemas.review,
    tools: pipr.tools.readOnly,
    prompt: () => "Review the supplied Diff Manifest for meaningful test gaps.",
  });

  const task = pipr.task({
    name: "Live multi-agent review",
    async run(ctx) {
      const manifest = await ctx.change.diffManifest();
      const [securityResult, testResult] = await Promise.all([
        ctx.pi.run(security, { manifest }),
        ctx.pi.run(tests, { manifest }),
      ]);

      const inlineFindings = [...securityResult.inlineFindings, ...testResult.inlineFindings];
      await ctx.comment({
        main: [
          "## Summary",
          "",
          securityResult.summary.body,
          "",
          testResult.summary.body,
          "",
          "## Review Result",
          "",
          `Reviewed by two custom agents across ${inlineFindings.length} candidate finding(s).`,
        ].join("\n"),
        inlineFindings,
      });
    },
  });

  pipr.on.changeRequest({
    actions: ["opened", "updated", "reopened", "ready"],
    task,
  });
});
