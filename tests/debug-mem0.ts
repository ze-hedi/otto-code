#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Mem0 } from "../memory_layer/mem0";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

async function main() {
  const mem = new Mem0();
  try {
    const r = await mem.add(
      [{ role: "user", content: "I love pizza" }],
      { userId: "test123" }
    );
    console.log("OK", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.error("FULL ERROR:", e);
    if (e.cause) console.error("CAUSE:", e.cause);
    if (e.response) {
      console.error("RESPONSE STATUS:", e.response.status);
      console.error("RESPONSE BODY:", await e.response.text?.());
    }
  }
}

main();
