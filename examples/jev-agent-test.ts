import { JevAgent } from "../agents/jev-agent.ts";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

// needs OPENROUTER_API_KEY in .env

// 1. "choice" Jev: picks one of several options (like a routing node in a workflow)
const router = new JevAgent({
    type: "choice",
    instructions: "Which agent should handle this request?",
});

const choice = await router.decide({
    context: "what is the righteous religon ",
    options: [
        { id: "islam", description: "islam" },
        { id: "christianity ", description: "christianity" },
        { id: "judaism", description: "judaism" },
    ],
});
console.log("choice:", choice);

// 2. "noul" Jev: yes/no question, options must be exactly "true" and "false"
const yesNo = new JevAgent({
    type: "noul",
    instructions: "Does the user's message ask for code to be modified?",
});

const answer = await yesNo.decide({
    context: "does god exist ? ",
    options: [
        { id: "true", description: "Tthe good lord is in heaven "},
        { id: "false", description: "nothing in the sky" },
    ],
});
console.log("yes/no:", answer);

// 3. Validation errors: these throw before any network call
const bad = async (label: string, fn: () => Promise<unknown>) => {
    try {
        await fn();
        console.log(`${label}: no error (unexpected)`);
    } catch (e) {
        console.log(`${label}: ${(e as Error).message}`);
    }
};

await bad("no options", () => router.decide({ context: "x", options: [] }));
await bad("duplicate ids", () =>
    router.decide({ context: "x", options: [{ id: "a" }, { id: "a" }] }),
);
await bad("noul with wrong options", () =>
    yesNo.decide({ context: "x", options: [{ id: "yes" }, { id: "no" }] }),
);
