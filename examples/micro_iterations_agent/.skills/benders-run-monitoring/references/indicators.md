# Benders monitoring: displayed indicators

The monitoring UI follows a Benders decomposition run (one master problem, several subproblems,
solved iteratively) and displays the indicators described below. Each indicator and graph is
mapped to the keys of the run's JSON file.

## Vocabulary

- **Master iteration** (`num_master_iter`, also "Benders iteration" or "iteration"): one outer
  Benders loop. The master is solved, then every subproblem, then cuts go back to the master.
- **Micro-iteration** (`num_micro_iter`): within one master iteration, each subproblem is solved
  repeatedly. After each solve, violated network constraints are added and the subproblem is
  re-solved, until no constraint is added.
- **Subproblem** (`sub_name`, list in `subproblemNames`): one scenario/block of the decomposition.
- **N constraints** (`is_N = true`): base-case network constraints, i.e. branch flow limits with
  no outage.
- **N-K constraints** (`is_N = false`, labelled "NK" or "N-1"): network constraints under a
  contingency (incident).
- **Incident families** (`is_inc = true`): blocks of constraints that define an incident itself.
  They are neither N nor N-K branch limits.
- **Constraint family** (`constraints[].name`): a named group of constraint rows added together
  (one branch, one branch under one incident, or one incident definition).
- **Saturated / active constraint** (`active_constraints`): an added constraint that is binding
  (tight) at a solve.
- **Cut** (`addedCuts`): a Benders cut added to the master by the subproblems.
- **UB / LB** (`data.ub`, `data.lb`): the upper and lower bounds on the Benders optimum. The gap
  `best_ub - lb` measures convergence.

## JSON layout

```jsonc
{
  "data":             { "iteration": [int], "lb": [float], "ub": [float], "best_ub": [float] },
  "subproblemNames":  [string],
  "microIters":       [ { "rank", "sub_name", "num_master_iter", "num_micro_iter",
                          "solving_time", "elapsed_time", "nb_added_constraints",
                          "n_added_constraints_N", "n_added_constraints_NK",
                          "n_all_constraints", "n_saturated_constraints" } ],
  "masterTimes":      [ { "num_master_iter", "master_resolution_time", "elapsed_time" } ],
  "addedConstraints": [ { "rank", "sub_name", "num_master_iter", "num_micro_iter",
                          "constraints": [ { "name", "is_N", "is_inc", "n_constraints" } ],
                          "active_constraints": [string] } ],
  "addedCuts":        [int]
}
```

- `data` holds parallel arrays, one entry per master iteration.
- `microIters` and `addedConstraints` hold one record per (subproblem, master iteration,
  micro-iteration). Records with the same `(sub_name, num_master_iter, num_micro_iter)` describe
  the same solve. The arrays are not sorted.
- `addedCuts[i]` is the value for master iteration `i + 1`.
- `active_constraints` may be absent in older files.

## Base indicators

**Per master iteration**

| indicator | key | meaning |
|---|---|---|
| LB | `data.lb` | lower bound. The first value is a placeholder. |
| UB | `data.ub` | upper bound found at that iteration (not monotone) |
| Best UB | `data.best_ub` | best upper bound so far (non-increasing) |
| Master resolution time | `masterTimes[].master_resolution_time` | time to solve the master |
| PTDF elapsed time | `masterTimes[].elapsed_time` | elapsed PTDF time of the iteration, on a different scale from master resolution time |
| Cuts added | `addedCuts[i]` | cuts added to the master at iteration `i + 1` |

**Per (subproblem, master iteration, micro-iteration)**

| indicator | key | meaning |
|---|---|---|
| Solving time | `microIters[].solving_time` | solver time of the solve |
| Elapsed time | `microIters[].elapsed_time` | time spent outside the solver (constraint detection/building), on a different scale from solving time |
| Added constraints | `microIters[].nb_added_constraints` | constraint rows added after the solve. 0 ends the micro-loop. |
| Added N / added NK | `microIters[].n_added_constraints_N` / `n_added_constraints_NK` | split of the added rows. Incident families count as NK. |
| All constraints | `microIters[].n_all_constraints` | rows added so far in this master iteration before this solve, i.e. `Σ nb_added_constraints` of the previous micro-iterations |
| Saturated constraints | `microIters[].n_saturated_constraints` | how many of those rows are binding at this solve |
| Added constraint families | `addedConstraints[].constraints[]` | `name`, `is_N`, `is_inc`, `n_constraints` (row count). `Σ n_constraints = nb_added_constraints` |
| Active constraints | `addedConstraints[].active_constraints` | names of the binding rows. These are solver rows, finer-grained than family names, padded with trailing spaces. The two share the branch and incident identifiers. |

Times have no unit stored.

## Graphs

### 1. Convergence: bounds per iteration

- Line chart. x = `data.iteration`, series `data.ub`, `data.lb`, `data.best_ub`.
- The first iteration is not plotted, because its LB is a placeholder.
- Shows convergence speed, the gap, plateaus, LB jumps, and UB oscillation.

### 2. Micro-iterations: time per micro-iteration (one subproblem)

- Source: `microIters` filtered on `sub_name`.
- Stacked bars. x = `num_master_iter`. Each segment is one `num_micro_iter`, and its height is
  `elapsed_time + solving_time`.
- Tooltip: `elapsed_time`, `solving_time`, `nb_added_constraints`.
- Shows how many micro-iterations a subproblem needs per master iteration, and which
  micro-iteration carries the cost. `solving_time` accounts for almost all of the height.

#### 2b. Saturated constraint rate (one subproblem, one master iteration)

- Source: `microIters` and `addedConstraints` filtered on `sub_name` and `num_master_iter`.
- Grouped bars. x = `num_micro_iter`.
- *Saturated / all constraints* = `n_saturated_constraints / n_all_constraints` (%).
- *Saturated / added constraints* = `n_saturated_constraints(micro k) /
  Σ constraints[].n_constraints where is_inc = false, at micro k-1` (%).
- Shows the share of added constraints that turn out to be binding.

### 3. Subproblem times: total time per subproblem per iteration

- Source: `microIters`.
- Line chart, one line per `sub_name`. x = `num_master_iter`,
  y = `Σ over num_micro_iter (elapsed_time + solving_time)`.
- Shows load imbalance between subproblems (stragglers) and the time trend across iterations.

#### 3b. Cumulated times

- Bars. x = `num_master_iter`, y = the graph 3 values summed over all `sub_name`.
- Shows the total subproblem work per iteration.

### 4. Constraints: constraints added per micro-iteration (one subproblem)

- Source: `addedConstraints` filtered on `sub_name`.
- Stacked bars. x = `num_master_iter`, one segment per `num_micro_iter`. Segment height =
  `len(constraints)`, the **number of families**, not rows.
- Tooltip: family count, `is_N` split, the first family names.
- Shows how much each micro-iteration adds, and how that changes across master iterations.

#### 4b. N / NK constraints

- Source: `microIters` filtered on `sub_name`.
- Per master iteration: stacked bars of `Σ n_added_constraints_N` and `Σ n_added_constraints_NK`
  over micro-iterations.
- For one selected master iteration: grouped bars per `num_micro_iter`, N rows vs NK rows.
- Shows the split between base-case and contingency constraint generation.

### 5. Heatmap: overlap of constraint sets (Jaccard similarity, %)

- Source: `addedConstraints`.
- Each cell is `100 · |A ∩ B| / |A ∪ B|`. The matrix is symmetric with a diagonal of 100.
- The set for one (`sub_name`, `num_master_iter`) depends on the source toggle:
  - **All:** the union of `constraints[].name` over its micro-iterations.
  - **Active:** `active_constraints` of the record with the highest `num_micro_iter`.
- **5a. Common per iteration** (one `sub_name`): rows and columns are `num_master_iter`. Shows
  how stable the subproblem's constraint set is across iterations.
- **5b. Common per subproblem** (one `num_master_iter`): rows and columns are `sub_name`. Shows
  how much the subproblems share constraints within that iteration.

### 6. Master

- **6a. Master resolution time:** line chart. x = `masterTimes[].num_master_iter`,
  y = `master_resolution_time`. The tooltip also shows `elapsed_time` (PTDF). Shows how the cost
  of solving the master evolves.
- **6b. Cumulative cuts:** bars. x = `i + 1`, y = running sum of `addedCuts`. The tooltip shows
  `addedCuts[i]`. Shows how the master grows.

## Links between graphs

- 3b (subproblem work) and 6a (master time) together cover the cost of one iteration. 3 and 2
  break the subproblem side down by subproblem and by micro-iteration.
- 2, 4 and 2b describe the same (`sub_name`, `num_master_iter`) from three angles: time,
  constraints added, and binding fraction.
- 6a and 6b show master cost alongside master size.
- 1 against 3b + 6a gives bound improvement against cost for each iteration.
