// Lets node:test run the TypeScript sources directly: maps "./x.js" imports onto "./x.ts".
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    try {
      return await next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        return next(specifier.slice(0, -3) + ".ts", context);
      }
      throw err;
    }
  }
`));
