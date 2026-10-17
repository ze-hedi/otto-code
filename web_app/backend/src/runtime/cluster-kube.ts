import net from "net";
import type { RuntimeConfig } from "./config.js";
import type { ClusterApi, PodView } from "./manager.js";
import type { PodManifest } from "./pod-spec.js";

// The only file that touches @kubernetes/client-node (v1.x, object-parameter API).
// It is imported lazily so `OTTO_RUNTIME=local` works without the package being usable.

type K8s = typeof import("@kubernetes/client-node");

function toPodView(pod: any): PodView {
  const status = pod.status ?? {};
  const waiting = (status.containerStatuses ?? []).map((c: any) => c.state?.waiting).find(Boolean);
  return {
    name: pod.metadata?.name ?? "",
    phase: status.phase ?? "Unknown",
    ready: (status.conditions ?? []).some((c: any) => c.type === "Ready" && c.status === "True"),
    ip: status.podIP,
    deleting: !!pod.metadata?.deletionTimestamp,
    waitingReason: waiting?.reason,
    waitingMessage: waiting?.message,
    labels: pod.metadata?.labels ?? {},
    annotations: pod.metadata?.annotations ?? {},
  };
}

function isNotFound(err: any): boolean {
  return err?.code === 404 || err?.statusCode === 404 || err?.response?.statusCode === 404;
}

export class KubeClusterApi implements ClusterApi {
  private readonly cfg: RuntimeConfig;
  private k8s?: K8s;
  private kc?: InstanceType<K8s["KubeConfig"]>;
  private core?: InstanceType<K8s["CoreV1Api"]>;
  private readonly forwards = new Map<string, { server: net.Server; port: number }>();

  constructor(cfg: RuntimeConfig) {
    this.cfg = cfg;
  }

  private async api(): Promise<InstanceType<K8s["CoreV1Api"]>> {
    if (!this.core) {
      this.k8s = await import("@kubernetes/client-node");
      this.kc = new this.k8s.KubeConfig();
      this.kc.loadFromDefault(); // in-cluster service account, else $KUBECONFIG / ~/.kube/config
      this.core = this.kc.makeApiClient(this.k8s.CoreV1Api);
    }
    return this.core;
  }

  async createPod(manifest: PodManifest): Promise<void> {
    await (await this.api()).createNamespacedPod({ namespace: this.cfg.namespace, body: manifest as any });
  }

  async getPod(name: string): Promise<PodView | null> {
    try {
      return toPodView(await (await this.api()).readNamespacedPod({ name, namespace: this.cfg.namespace }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async listPods(labelSelector: string): Promise<PodView[]> {
    const list = await (await this.api()).listNamespacedPod({ namespace: this.cfg.namespace, labelSelector });
    return list.items.map(toPodView);
  }

  async deletePod(name: string): Promise<void> {
    try {
      await (await this.api()).deleteNamespacedPod({ name, namespace: this.cfg.namespace, gracePeriodSeconds: 5 });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async resolveBaseUrl(pod: PodView, port: number): Promise<string> {
    const inCluster = this.cfg.access === "in-cluster"
      || (this.cfg.access === "auto" && !!process.env.KUBERNETES_SERVICE_HOST);
    if (inCluster) {
      if (!pod.ip) throw new Error(`Pod ${pod.name} has no IP yet`);
      return `http://${pod.ip}:${port}`;
    }
    return `http://127.0.0.1:${await this.forward(pod.name, port)}`;
  }

  release(name: string): void {
    const fwd = this.forwards.get(name);
    if (fwd) {
      fwd.server.close();
      this.forwards.delete(name);
    }
  }

  /** Out-of-cluster access: a local TCP port tunnelled to the pod through the API server. */
  private async forward(podName: string, port: number): Promise<number> {
    const existing = this.forwards.get(podName);
    if (existing) return existing.port;
    await this.api();
    const forwarder = new this.k8s!.PortForward(this.kc!);
    const server = net.createServer((socket) => {
      forwarder.portForward(this.cfg.namespace, podName, [port], socket, null, socket).catch(() => socket.destroy());
    });
    const localPort = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
    });
    server.unref();
    this.forwards.set(podName, { server, port: localPort });
    return localPort;
  }
}
