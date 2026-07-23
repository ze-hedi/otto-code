// src/oss/src/utils/telemetry.ts
var version = true ? "3.0.3" : "dev";
var MEM0_TELEMETRY = true;
var _a;
try {
  MEM0_TELEMETRY = ((_a = process == null ? void 0 : process.env) == null ? void 0 : _a.MEM0_TELEMETRY) === "false" ? false : true;
} catch (error) {
}
var POSTHOG_API_KEY = "phc_hgJkUVJFYtmaJqrvf6CYN67TIQ8yhXAkWzUn9AMU4yX";
var POSTHOG_HOST = "https://us.i.posthog.com/i/v0/e/";
var DEFAULT_SAMPLE_RATE = 0.1;
var MEM0_TELEMETRY_SAMPLE_RATE = (() => {
  var _a2;
  try {
    const raw = (_a2 = process == null ? void 0 : process.env) == null ? void 0 : _a2.MEM0_TELEMETRY_SAMPLE_RATE;
    if (raw !== void 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch (e) {
  }
  return DEFAULT_SAMPLE_RATE;
})();
var LIFECYCLE_EVENTS = /* @__PURE__ */ new Set(["init", "reset"]);
var UnifiedTelemetry = class {
  constructor(projectApiKey, host) {
    this.apiKey = projectApiKey;
    this.host = host;
  }
  async captureEvent(distinctId, eventName, properties = {}) {
    if (!MEM0_TELEMETRY) return;
    const eventProperties = {
      client_version: version,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...properties,
      $process_person_profile: distinctId === "anonymous" || distinctId === "anonymous-supabase" ? false : true,
      $lib: "posthog-node"
    };
    const payload = {
      api_key: this.apiKey,
      distinct_id: distinctId,
      event: eventName,
      properties: eventProperties
    };
    try {
      const response = await fetch(this.host, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error("Telemetry event capture failed:", await response.text());
      }
    } catch (error) {
      console.error("Telemetry event capture failed:", error);
    }
  }
  async shutdown() {
  }
};
var telemetry = new UnifiedTelemetry(POSTHOG_API_KEY, POSTHOG_HOST);
async function captureClientEvent(eventName, instance, additionalData = {}) {
  if (!instance.telemetryId) {
    console.warn("No telemetry ID found for instance");
    return;
  }
  const isLifecycle = LIFECYCLE_EVENTS.has(eventName);
  if (!isLifecycle && Math.random() >= MEM0_TELEMETRY_SAMPLE_RATE) {
    return;
  }
  const eventData = {
    function: `${instance.constructor.name}`,
    method: eventName,
    api_host: instance.host,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    client_version: version,
    client_source: "nodejs",
    ...additionalData,
    // sample_rate set AFTER the spread so callers can never override it
    sample_rate: isLifecycle ? 1 : MEM0_TELEMETRY_SAMPLE_RATE
  };
  await telemetry.captureEvent(
    instance.telemetryId,
    `mem0.${eventName}`,
    eventData
  );
}

// src/client/config.ts
async function getNodeFs() {
  var _a2, _b, _c, _d, _e;
  if (typeof process === "undefined" || !((_a2 = process.versions) == null ? void 0 : _a2.node)) return null;
  try {
    const [fs4, path3, os2, crypto] = await Promise.all([
      import("fs"),
      import("path"),
      import("os"),
      import("crypto")
    ]);
    const fsMod = (_b = fs4.default) != null ? _b : fs4;
    const pathMod = (_c = path3.default) != null ? _c : path3;
    const osMod = (_d = os2.default) != null ? _d : os2;
    const cryptoMod = (_e = crypto.default) != null ? _e : crypto;
    const dir = process.env.MEM0_DIR || pathMod.join(osMod.homedir(), ".mem0");
    return {
      fs: fsMod,
      path: pathMod,
      crypto: cryptoMod,
      configPath: pathMod.join(dir, "config.json")
    };
  } catch (e) {
    return null;
  }
}
function loadConfig(node) {
  try {
    if (!node.fs.existsSync(node.configPath)) return null;
    const parsed = JSON.parse(node.fs.readFileSync(node.configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}
function writeConfig(node, config) {
  node.fs.mkdirSync(node.path.dirname(node.configPath), { recursive: true });
  node.fs.writeFileSync(node.configPath, JSON.stringify(config, null, 4));
}
function randomUserId(node) {
  if (typeof node.crypto.randomUUID === "function") {
    return node.crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
async function getOrCreateMem0UserId() {
  var _a2;
  const node = await getNodeFs();
  if (!node) return null;
  try {
    const config = (_a2 = loadConfig(node)) != null ? _a2 : {};
    if (typeof config.user_id === "string" && config.user_id) {
      return config.user_id;
    }
    const userId = randomUserId(node);
    config.user_id = userId;
    writeConfig(node, config);
    return userId;
  } catch (e) {
    return null;
  }
}

export { UnifiedTelemetry, telemetry, captureClientEvent, getOrCreateMem0UserId };
