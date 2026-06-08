import { describe, it, expect } from "vitest";

describe("DeepSeek API key", () => {
  it("should be able to call DeepSeek API with the provided key", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    expect(apiKey, "DEEPSEEK_API_KEY must be set").toBeTruthy();

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "Say 'ok' in one word." }],
        max_tokens: 5,
      }),
    });

    expect(response.status, `DeepSeek API returned ${response.status}`).toBe(200);
    const data = await response.json() as { choices: { message: { content: string } }[] };
    expect(data.choices[0].message.content).toBeTruthy();
  }, 20000);
});
