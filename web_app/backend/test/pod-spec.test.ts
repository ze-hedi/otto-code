import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../src/runtime/config.js";
import { buildPodManifest, buildWorkspaceMount, podNameFor } from "../src/runtime/pod-spec.js";

const cfg = loadRuntimeConfig({});

test("pod names are valid DNS-1123 labels and unique per id", () => {
  const names = [
    podNameFor("agent", "5f0c1a52-9d1e-4a77-8c51-2d6f9a1d0b11"),
    podNameFor("agent", "5f0c1a52-9d1e-4a77-8c51-2d6f9a1d0b12"),
    podNameFor("workflow", "Weird ID_with***chars and a very long tail ".repeat(5)),
  ];
  for (const n of names) {
    assert.match(n, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    assert.ok(n.length <= 63, `${n} too long`);
  }
  assert.equal(new Set(names).size, names.length);
  assert.equal(podNameFor("agent", "abc"), podNameFor("agent", "abc"));
});

test("hostPath mounts the playground at the workspace path", () => {
  const m = buildWorkspaceMount("/home/me/proj/", cfg);
  assert.deepEqual(m.volume.hostPath, { path: "/home/me/proj", type: "Directory" });
  assert.equal(m.volumeMount.mountPath, "/workspace");
});

test("relative playgrounds are rejected", () => {
  assert.throws(() => buildWorkspaceMount("proj", cfg), /absolute/);
  assert.throws(() => buildWorkspaceMount("", cfg), /absolute/);
});

test("playground root allow-list blocks escapes", () => {
  const c = loadRuntimeConfig({ OTTO_K8S_PLAYGROUND_ROOT: "/srv/playgrounds" });
  assert.doesNotThrow(() => buildWorkspaceMount("/srv/playgrounds/a", c));
  assert.throws(() => buildWorkspaceMount("/srv/other", c), /outside/);
  assert.throws(() => buildWorkspaceMount("/srv/playgrounds/../etc", c), /outside/);
  assert.throws(() => buildWorkspaceMount("/srv/playgrounds-evil", c), /outside/);
});

test("pvc mode uses a subPath relative to the root", () => {
  const c = loadRuntimeConfig({ OTTO_K8S_STORAGE: "pvc", OTTO_K8S_PVC: "playgrounds", OTTO_K8S_PLAYGROUND_ROOT: "/srv/pg" });
  const m = buildWorkspaceMount("/srv/pg/team/proj", c);
  assert.deepEqual(m.volume.persistentVolumeClaim, { claimName: "playgrounds" });
  assert.equal(m.volumeMount.subPath, "team/proj");
  assert.throws(() => buildWorkspaceMount("/srv/pg/x", loadRuntimeConfig({ OTTO_K8S_STORAGE: "pvc" })), /OTTO_K8S_PVC/);
});

test("manifest locks the container down", () => {
  const pod = buildPodManifest({ kind: "agent", id: "a1", playground: "/p" }, cfg);
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.restartPolicy, "Never");
  assert.equal(pod.spec.securityContext.runAsNonRoot, true);
  const c = pod.spec.containers[0];
  assert.equal(c.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(c.securityContext.capabilities.drop, ["ALL"]);
  assert.equal(pod.metadata.annotations["otto.dev/id"], "a1");
  assert.equal(pod.metadata.annotations["otto.dev/playground"], "/p");
  assert.equal(pod.metadata.labels["otto.dev/kind"], "agent");
  const env = Object.fromEntries(c.env.map((e: any) => [e.name, e.value]));
  assert.equal(env.OTTO_PLAYGROUND, "/workspace");
  assert.equal(env.OTTO_RUNTIME_KIND, "agent");
  assert.equal(env.OTTO_HOST_ALIAS, undefined);
});

test("host alias is forwarded to the pod when configured", () => {
  const pod = buildPodManifest({ kind: "workflow", id: "w", playground: "/p" }, loadRuntimeConfig({ OTTO_K8S_HOST_ALIAS: "host.minikube.internal" }));
  const env = Object.fromEntries(pod.spec.containers[0].env.map((e: any) => [e.name, e.value]));
  assert.equal(env.OTTO_HOST_ALIAS, "host.minikube.internal");
});

import { assertInProcessAllowed, isKubernetesMode } from "../src/runtime/config.js";

test("sandboxing is the default; local mode must be asked for explicitly", () => {
  assert.equal(isKubernetesMode({}), true);
  assert.equal(isKubernetesMode({ OTTO_RUNTIME: "kubernetes" }), true);
  assert.equal(isKubernetesMode({ OTTO_RUNTIME: "local" }), false);
  assert.throws(() => isKubernetesMode({ OTTO_RUNTIME: "locl" }), /must be/);
});

test("in-process execution is refused unless OTTO_RUNTIME=local", () => {
  assert.throws(() => assertInProcessAllowed("run an agent", {}), /Refusing/);
  assert.doesNotThrow(() => assertInProcessAllowed("run an agent", { OTTO_RUNTIME: "local" }));
});
