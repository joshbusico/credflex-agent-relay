import { Agent, Runner, withTrace } from "@openai/agents";

const credflexXAgent = new Agent({
  name: "CredFlex X Agent",
  instructions: process.env.CREDFLEX_INSTRUCTIONS,
  model: "gpt-5.2-chat-latest",
  modelSettings: { store: true }
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const { input_as_text } = req.body || {};
    if (!input_as_text) {
      return res.status(400).json({ error: "Missing input_as_text" });
    }

    const output_text = await withTrace("CredFlex X Agent", async () => {
      const runner = new Runner({
        traceMetadata: {
          __trace_source__: "agent-relay",
          workflow_id: "wf_6991f60de1ac81908b39c44b4e1c8eb7074527ca7a1a48d3"
        }
      });

      const run = await runner.run(credflexXAgent, [
        { role: "user", content: [{ type: "input_text", text: input_as_text }] }
      ]);

      return run.finalOutput ?? "";
    });

    return res.status(200).json({ output_text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
