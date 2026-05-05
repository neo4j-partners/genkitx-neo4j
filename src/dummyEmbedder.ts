import { Document } from "@genkit-ai/ai";
import { genkit, z } from "genkit";

// init Genkit
const ai = genkit({ name: "test-ai" });

// mock  embedding
function mockEmbed(text: string) {
  const vec = Array.from(text).map((c) => c.charCodeAt(0) / 100);
  while (vec.length < 10) vec.push(0);
  return vec.slice(0, 10);
}

// define the mock embedder
export const mockEmbedder = ai.defineEmbedder(
  {
    name: "mock-embedder",
    configSchema: z.object({}), // no config
  },
  async (input: Document[]) => {
    const embeddings = input.map((doc: Document) => {
      const txt = doc.text;
      return {
        embedding: mockEmbed(txt),
        metadata: (doc as any).metadata ?? undefined,
      };
    });
    return { embeddings };
  },
);
