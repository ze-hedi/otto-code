# Workflow Builder (React)

A drag-and-drop visual workflow editor for composing **agents**, **tools**, and **artefacts** on a pannable, zoomable canvas. It lives inside the Otto React app at `frontend/react-app/` and is mounted at the `/workflow` route.

The builder fetches the available agents and tools from the Otto backend, lets you drop them onto a canvas, wire them together with curved arrows, and visually distinguish data flow from tool-attachment links.

---

## Quick start

```bash
cd frontend/react-app
npm install
npm start              # dev server on http://localhost:3000
```

The page proxies API requests to the Otto backend on `http://localhost:4000` (see `proxy` in `package.json`), so make sure the backend is running first. The `Sidebar` itself fetches with absolute URLs (`http://localhost:4000/api/agents`, `http://localhost:4000/api/tools`) — start the API server before opening the page.

Once both services are up, navigate to `http://localhost:3000/workflow`.

To produce a production build:

```bash
npm run build          # outputs to build/
```

---

## Where things live

```
frontend/react-app/
├── public/
│   └── index.html
└── src/
    ├── App.js                       ← Router; mounts WorkflowBuilder at /workflow
    ├── WorkflowBuilder.jsx          ← Top-level state, data fetching, all callbacks
    ├── WorkflowBuilder.css          ← Layout, theming, node/handle/arrow styles
    ├── constants.js                 ← (legacy) generic component metadata
    ├── utils.js                     ← Geometry helpers + arrowhead SVG defs
    └── components/
        ├── Header.jsx               ← Top bar: Connect / Undo / Export / Upload / Clear
        ├── Sidebar.jsx              ← Agents (live), Tools (live), Artefacts (static)
        ├── Canvas.jsx               ← Pan, zoom, drop, drag-link, arrow rendering
        ├── WorkflowNode.jsx         ← Node wrapper: drag-to-move + handle wiring
        └── workflow/
            ├── NodeShape.jsx        ← Picks the right shape by node.type
            ├── shapes.config.js     ← type → component + dimensions
            └── shapes/
                ├── WideRectShape.jsx   ← used by 'agent'
                ├── CircleShape.jsx     ← used by 'tool'
                └── SquareShape.jsx     ← used by 'artefact'
```

The single source of truth for what's on the canvas is the `nodes`/`connections` arrays in `WorkflowBuilder`. Everything else — including the SVG layer — is derived from that state.

---

## Node types

There are exactly three node types and they have different geometry, sidebar sources, and connection rules.

| Type | Source | Shape | Dimensions | Default exit | Default entry |
| --- | --- | --- | --- | --- | --- |
| `agent` | `GET /api/agents` | Wide rectangle | 180 × 68 | `right` | `left` |
| `tool` | `GET /api/tools` | Circle | 84 × 84 | `bottom` | `top` |
| `artefact` | Hardcoded (`if`, `plan`) | Square | 80 × 80 | `right` | `left` |

Defaults are declared in `utils.js → NODE_DEFAULT_SIDES` and dimensions in both `utils.js → NODE_DIMS` and `components/workflow/shapes.config.js`. **These two must stay in sync** — handle positions are computed purely from state using `NODE_DIMS`, while CSS rendering uses `shapes.config.js`. If you add a new node type, update both.

### Agent
A live, draggable card backed by a database record. Each agent in the sidebar carries `_id`, `name`, and `icon` from the backend. Dropping an agent creates a node like:

```js
{ id, type: 'agent', agentId, agentName, agentIcon, x, y }
```

### Tool
A live, circular node backed by a database record (`_id`, `name`, `icon`). Tools attach to agents via top/bottom handles and form a special edge type (see *Tool-link edges* below).

```js
{ id, type: 'tool', toolId, toolName, toolIcon, x, y }
```

### Artefact
A static, square node. The available artefact types are hardcoded in `Sidebar.jsx`:

```js
const ARTEFACTS = [
  { type: 'if',   label: 'If',   icon: '◇' },
  { type: 'plan', label: 'Plan', icon: '☰' },
];
```

```js
{ id, type: 'artefact', artefactType, label, x, y }
```

---

## Top bar

| Button | Behaviour |
| --- | --- |
| **Connect / Exit Connect** | Toggles connection mode. Reveals all node handles and switches single-click on a node to "select", second click to "link". |
| **Undo** | Pops the last snapshot (see *Undo* below). Disabled when the history is empty. |
| **Export** | **Disabled in this build.** The handler is a no-op. |
| **Upload** | **Disabled in this build.** The file input is wired but the button is disabled. |
| **Clear** | Empties `nodes` and `connections` after pushing a snapshot, so it is undoable. |

The Export/Upload pair was intentionally disabled — both handlers and the buttons themselves carry an "is currently disabled" tooltip and the buttons have the `disabled` attribute set. The plumbing (FileReader, JSON parsing) is still in `Header.jsx` if you decide to re-enable them.

---

## Canvas: pan, zoom, drop

The canvas is split into a fixed outer container (`.wf-canvas`) and an inner viewport (`.wf-viewport`) that is `transform`-translated and scaled. Both nodes **and** the SVG arrow layer live inside the viewport, so they share one coordinate system that pans and zooms together.

### Pan
Mouse-down on the canvas background and drag. The pan starts only after a 4-pixel deadzone, so a stationary click still registers as `onCanvasClick` and clears selection.

### Zoom
Mouse wheel zooms toward the cursor between scale `0.15` and `3.0`. Each tick multiplies/divides scale by `1.1`. The pan offset is adjusted so the point under the cursor stays put.

```js
viewRef.current.scale = newScale;
viewRef.current.x = cursorX + (viewRef.current.x - cursorX) * ratio;
viewRef.current.y = cursorY + (viewRef.current.y - cursorY) * ratio;
```

### Drop
The sidebar serialises drag payloads as JSON in `e.dataTransfer`:

```js
{ nodeType: 'agent' | 'tool' | 'artefact', ...metadata }
```

`Canvas.jsx` decodes the payload, converts the cursor's screen coordinates into viewport space (subtract pan, divide by scale), and forwards to `WorkflowBuilder.handleDrop`, which centres the node by `(-55, -40)` from the cursor.

---

## Connections

There are two ways to create a connection, plus one specialised edge variant.

### Handle drag
Hover any node to reveal its handles (or toggle Connect mode to keep them visible). Mouse-down on a handle starts a "linking" interaction:

1. A dashed temp arrow follows the cursor (drawn directly into the SVG layer, not React state, so it doesn't re-render the tree on every mouse move).
2. On mouse-up, `document.elementFromPoint` finds the drop target. If it's another node's handle, that exact side is used; if it's the body of a node, the type's *default entry side* (`NODE_DEFAULT_SIDES`) is used; if it's empty space, the link is cancelled.
3. Self-connections (`fromNodeId === toNodeId`) are dropped on the floor.

### Connect mode (click-to-link)
Click **Connect** in the header. While connection mode is on:
- Click a node — it becomes "selected" (highlighted).
- Click a *different* node — a connection is created from the first node's default exit side to the second node's default entry side.

Mouse-down on a node body in connect mode triggers `onNodeClick` *before* drag-move, so you can still drag a node by holding past the deadzone but a clean click links instead.

### Tool-link edges
Agents have *four* handles (left, right, top, bottom). Top and bottom are reserved for tool attachment:

- Dragging from an agent's `top` or `bottom` handle is only accepted if the target is a `tool` node — otherwise the link is silently dropped.
- The resulting connection carries `linkType: 'tool-link'` and renders as a dashed cyan arrow (CSS class `wf-arrow--tool-link`, marker `wf-arrowhead-tool` defined in `utils.js → ensureSVGDefs`).
- In click-to-link mode, agent ↔ tool combinations are auto-marked as tool-links regardless of which sides were chosen.

Plain data-flow edges between agents (or agent ↔ artefact) render as solid indigo with the `wf-arrowhead` marker.

### Duplicate suppression
A connection is only added if no existing connection has the same `from`, `fromSide`, `to`, `toSide`, *and* `linkType`. So you can have one flow edge and one tool-link edge between the same pair of nodes if you really want to.

### Selecting and deleting connections
Mouse-down on an arrow path stores the connection in state and positions a floating `×` button at the path's midpoint (in canvas-space — converted from viewport space using the current pan/zoom). Clicking the `×` removes the connection.

---

## Geometry

`utils.js` keeps all the geometry functions pure so they can be called either while drawing the live `<svg>` or while computing the temp link line during a drag.

```js
getHandlePosFromState(node, side)
  // returns { x, y } of a handle's centre in viewport coordinates
  // based purely on node.x, node.y, and the type's NODE_DIMS.

bezierPath(x1, y1, x2, y2, fromSide, toSide)
  // returns an SVG path 'M…C…' for a cubic bezier.
  // Control points are offset from each endpoint along the
  // axis implied by the handle side (right/left → horizontal,
  // top/bottom → vertical), with magnitude |Δ|·0.5 + 30.
```

Because handle positions are computed from state and not measured from the DOM, dragging a node updates arrows in lockstep on the same render — there's no flicker or settle frame.

---

## Undo

`history` is an array of full `{ nodes, connections }` snapshots. A snapshot is pushed:

- Before any node is added (drop)
- Before any node is moved (only on the first mouse-move of the drag, via `dragState.snapshotSaved`)
- Before any node is deleted
- Before any connection is added
- Before any connection is deleted
- Before the canvas is cleared

`handleUndo` simply replaces `nodes` and `connections` with the popped snapshot. There is no redo. Pan/zoom are not part of the history — undo never moves the camera.

The `Ctrl+Z` text in the Undo tooltip is informational; **no keyboard shortcut is bound**. Add a `keydown` listener in `WorkflowBuilder` if you want one.

---

## Data contract with the backend

The builder reads from two endpoints on mount:

```
GET http://localhost:4000/api/agents   →  [{ _id, name, icon? }, …]
GET http://localhost:4000/api/tools    →  [{ _id, name, icon? }, …]
```

If either request fails, the corresponding sidebar section shows an error block but the canvas remains functional — you can still drag artefacts and any items from the section that did load.

If a section returns an empty array, an empty-state with a link to `/agents` or `/tools` is rendered instead.

The builder does **not** currently push anything back to the server — the workflow only lives in component state.

---

## State shape (in-memory)

```ts
nodes: Array<
  | { id, type: 'agent',    agentId, agentName, agentIcon, x, y }
  | { id, type: 'tool',     toolId,  toolName,  toolIcon,  x, y }
  | { id, type: 'artefact', artefactType, label,            x, y }
>

connections: Array<{
  from:     string          // node id
  fromSide: 'left' | 'right' | 'top' | 'bottom'
  to:       string          // node id
  toSide:   'left' | 'right' | 'top' | 'bottom'
  linkType?: 'tool-link'    // present only for agent ↔ tool edges
}>
```

`x` / `y` are the top-left of the node wrapper in viewport coordinates (pre-transform).

---

## Extending

| Goal | Where to change |
| --- | --- |
| Add a new node type | `utils.js → NODE_DEFAULT_SIDES` + `NODE_DIMS`; `components/workflow/shapes.config.js`; add a shape component under `components/workflow/shapes/`; teach `Sidebar.jsx` how to drag it; teach `WorkflowBuilder.handleDrop` how to build the node object. |
| Add a new artefact | Append an entry to the `ARTEFACTS` array in `Sidebar.jsx`. |
| Change the bezier curvature | `bezierPath` in `utils.js` — bump the `0.5` multiplier or the `+30` offset. |
| Add a new edge style (e.g. event bus) | Add a CSS class in `WorkflowBuilder.css`, define a new arrowhead `<marker>` in `utils.js → ensureSVGDefs`, set `linkType` when creating the connection, and branch on it in `Canvas.jsx`'s draw loop. |
| Persist workflows | Hook `WorkflowBuilder` into a `POST /api/workflows` from a save button, then re-hydrate `nodes` and `connections` on `/workflow/:id` mount. |
| Re-enable Export/Upload | The disabled handlers are stubs in `WorkflowBuilder` (`handleExport`, `handleImport`); `Header.jsx` already wires the file input. Remove the `disabled` attributes and fill in the bodies. |
| Bind `Ctrl+Z` | Add a `keydown` listener in a `useEffect` in `WorkflowBuilder` that calls `handleUndo()` when `(e.ctrlKey \|\| e.metaKey) && e.key === 'z'`. |
| Add multi-select / lasso | Will require lifting `selectedNodeId` to `selectedNodeIds: Set<string>` and adding marquee logic to `Canvas.handleCanvasMouseDown`. |

---

## Known limitations

- **No persistence** — refreshing the page wipes the canvas.
- **Export and Upload are off** — the buttons exist for visual completeness only.
- **No keyboard shortcuts** — the `Ctrl+Z` tooltip is misleading.
- **No connection labels** — edges are anonymous.
- **No grouping, multi-select, copy/paste, alignment guides, or snap-to-grid.**
- **Sidebar uses absolute backend URLs** (`http://localhost:4000/...`) instead of the configured `proxy`. If you deploy elsewhere, update those fetch URLs.
- The `Header` brand link points to `index.html` (a relative path that doesn't resolve in the React-Router setup); use the React-Router `<Link>` if you want it to behave like the rest of the app.
