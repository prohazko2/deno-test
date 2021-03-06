/*

!!!!!!!

It was only created for local hacks with trusted scripts.
Please never use this in any production environments, since it can easly damage your clusters

!!!!!!!

*/

import { exec } from "./exec.ts";

import type {
  ConfigMap,
  Node,
  NodeList,
  Pod,
  PodList,
  Secret,
  Service,
  ServiceList,
} from "https://deno.land/x/kubernetes_apis@v0.3.0/builtin/core@v1/mod.ts";

import type { Deployment, DeploymentList } from "https://deno.land/x/kubernetes_apis@v0.3.0/builtin/apps@v1/mod.ts";

export type { ConfigMap, Deployment, Node, Pod, Secret, Service };

export type Opts = Partial<{
  output: "json" | "yaml" | string;
  allNamespaces: boolean;
  jsonPath: string;
  context: string;
  namespace: string;
  labels: Record<string, string | boolean>;
}>;

export type PatchOp<T = unknown> = {
  op: string;
  path: string | string[];
  value: T
}

// @TODO: try later with jsonpath
//  > kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'

export async function getMasterIp(opts?: Opts) {
  opts = {
    ...(opts ?? {}),
    jsonPath: "{..status.addresses}",
    labels: {
      ...(opts?.labels ?? {}),
      "node-role.kubernetes.io/master": true,
    },
  };
  const addressesText = await _ctl<string>(`get nodes`, opts);
  const addresses = tryParseJsonVeryHard(addressesText) as {
    type: string;
    address: string;
  }[];
  return addresses.find(({ type }) => type === "InternalIP")?.address;
}

export function getNodes(opts?: Opts): Promise<Node[]> {
  return _ctl<NodeList>(`get nodes`, opts).then(({ items }) => items);
}

export function getPods(opts?: Opts): Promise<Pod[]> {
  return _ctl<PodList>(`get pods`, opts).then(({ items }) => items);
}

export function getServices(opts?: Opts): Promise<Service[]> {
  return _ctl<ServiceList>(`get services`, opts).then(({ items }) => items);
}

export function getDeployments(opts?: Opts): Promise<Deployment[]> {
  return _ctl<DeploymentList>(`get deployments`, opts).then(({ items }) => items);
}

function stringifySelector(selector: Record<string, string | boolean>) {
  return Object.entries(selector)
    .map(([k, v]) => {
      let op = "==";
      if (v === true) {
        v = "";
      }
      if (v === false) {
        v = "";
        op = "!=";
      }
      return `${k}${op}${v}`;
    })
    .join(",");
}

export function tryParseJsonVeryHard<T = unknown>(json: string) {
  let err: SyntaxError;
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    err = e;
  }

  const [, position] = err.message.split(" at position ");
  return JSON.parse(json.slice(0, +position)) as T;
}

export async function _ctl<T = unknown>(cmd: string, opts?: Opts): Promise<T> {
  const args: string[] = [];
  let output = "json";

  if (opts?.output) {
    output = opts?.output;
  }
  if (opts?.jsonPath) {
    output = `jsonpath=${opts?.jsonPath}`;
  }
  if (opts?.context) {
    args.push(`--context ${opts.context}`);
  }
  if (opts?.namespace) {
    args.push(`--namespace ${opts.namespace}`);
  }
  if (opts?.labels && Object.keys(opts?.labels).length) {
    args.push(`--selector ${stringifySelector(opts.labels)}`);
  }

  let command = `kubectl ${args.join(" ")} ${cmd} -o ${output}`;
  if (opts?.allNamespaces) {
    command = `${command} --all-namespaces`;
  }

  const resp = await exec(command);

  if (output === "json") {
    return tryParseJsonVeryHard(resp) as T;
  }

  return (resp as any) as T;
}

export type ApplyResourceStatus = {
  kind: string;
  name: string;
  status: string;
};

function parseApplyResourceStaus(text: string): ApplyResourceStatus {
  const [res, status] = text.split(" ");
  const [kind, name] = res.split("/");
  return { kind, name, status };
}

export async function applyResources(yamls: string) {
  const lines = await exec("kubectl apply -f -", yamls);
  return lines
    .split("\n")
    .filter((x) => !!x)
    .map(parseApplyResourceStaus);
}

function normalizePathchPath(path: string | string[]) {
  if (Array.isArray(path)) {
    path = path.join("/");
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path;
}

export function patchResource(
  resource: string,
  patches: PatchOp[],
  opts?: Opts
) {
  patches = patches.map((patch) => ({
    ...patch,
    path: normalizePathchPath(patch.path)
  }));

  const cmd = `patch ${resource} --type=json -p=${JSON.stringify(patches)}`;
  return _ctl(cmd, opts);
}
