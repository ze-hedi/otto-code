#!/usr/bin/env bash
# Thin wrapper over the Otto backend API. No jq needed; python3 is used for JSON checks.
set -euo pipefail
API="${OTTO_API:-http://localhost:4000}"
cmd="${1:-}"; shift || true

post_json() { curl -sS -X POST "$API$1" -H 'Content-Type: application/json' --data-binary "$2"; echo; }

case "$cmd" in
  agents)
    curl -sS "$API/agents" | python3 -c '
import json,sys
for a in json.load(sys.stdin):
    c=a["config"]; print(a["agent_id"], "|", c.get("name",""), "|", c.get("description",""), "|", c["model"], "|", ",".join(c.get("builtInTools",[])), "|", c.get("playground",""))'
    ;;
  create-agent)
    post_json /agents "$(cat "$1")"
    ;;
  validate)
    python3 - "$1" <<'PY'
import json,sys
s=json.load(open(sys.argv[1])); comps=s["components"]; conns=s["connections"]
ids={c["id"] for c in comps}; kind={c["id"]:c["type"] for c in comps}
rules={"delegate":(1,1,1,None),"forward":(1,1,1,1),"accumulate":(1,None,1,1),"route":(1,1,1,None)}
err=[]
for c in conns:
    for k in ("from","to"):
        if c[k] not in ids: err.append(f"connection references missing node {c[k]}")
    if kind.get(c["from"])=="agent" and kind.get(c["to"])=="agent":
        err.append(f"direct agent->agent {c['from']} -> {c['to']}: use an interface")
for i,t in kind.items():
    if t!="interface": continue
    if i not in rules: err.append(f"unknown interface {i}"); continue
    nin=sum(c["to"]==i for c in conns); nout=sum(c["from"]==i for c in conns)
    lo_i,hi_i,lo_o,hi_o=rules[i]
    if nin<lo_i or (hi_i and nin>hi_i): err.append(f"{i}: bad input count {nin}")
    if nout<lo_o or (hi_o and nout>hi_o): err.append(f"{i}: bad output count {nout}")
if len(ids)!=len(comps): err.append("duplicate node ids")
deg={i:0 for i in ids}
for c in conns:
    if c["from"] in ids and c["to"] in ids: deg[c["to"]]+=1
q=[i for i in ids if deg[i]==0]; seen=0
while q:
    n=q.pop(); seen+=1
    for c in conns:
        if c["from"]==n and c["to"] in deg:
            deg[c["to"]]-=1
            if deg[c["to"]]==0: q.append(c["to"])
if seen<len(ids): err.append("cycle detected")
print("\n".join(err) if err else "ok"); sys.exit(1 if err else 0)
PY
    ;;
  save)
    python3 - "$1" "$2" "$3" "${4:-}" <<'PY' | { read -r body; post_json /workflow-store "$body"; }
import json,sys
name,desc,path,pg=sys.argv[1:5]
d={"name":name,"description":desc,"schema":json.load(open(path))}
if pg: d["playground"]=pg
print(json.dumps(d))
PY
    ;;
  compile)
    python3 - "$1" "$2" <<'PY' | { read -r body; post_json /workflows/compile "$body"; }
import json,sys
s=json.load(open(sys.argv[2])); s.update({"workflowId":sys.argv[1],"sessionMode":"new"})
print(json.dumps(s))
PY
    ;;
  run)
    python3 -c 'import json,sys; print(json.dumps({"message":sys.argv[1]}))' "$1" \
      | curl -sSN -X POST "$API/workflows/run" -H 'Content-Type: application/json' --data-binary @-
    ;;
  *)
    echo "usage: wf.sh agents | create-agent <f> | validate <schema> | save <name> <desc> <schema> [playground] | compile <id> <schema> | run <message>" >&2; exit 2;;
esac
