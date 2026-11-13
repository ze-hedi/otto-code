---
name: benders-run-monitoring
description: Use when the user gives the monitoring JSON of a Benders run and asks about its results, such as bounds, master and subproblem times, micro-iterations, added or binding constraints, or cuts. Tells you which indicator answers the question and which JSON keys hold the data.
---

# Goal

Help you answer a question about a Benders run by finding the right indicator, then reading only the JSON keys that hold its data.

`references/indicators.md` describes the vocabulary, the JSON layout, every indicator, and the monitoring graphs. This file tells you which part of it to read.

# How to use this skill

1. **Find the question** in the table below. It gives the graph that already shows this information.
2. **Read that graph's section** in `references/indicators.md`. It gives the source keys, the filters, and the formula.
3. **Open the JSON** and read only those keys, with those filters. Do not read the whole file.
4. **Compute the answer** with the formula of the graph, and check the data traps below.
5. **Report** the numbers with the keys they come from.

# Question index

| Question | Graph | Section in `indicators.md` | Main keys |
|---|---|---|---|
| Does the run converge, and how fast? | 1 | Convergence: bounds per iteration | `data.lb`, `data.ub`, `data.best_ub` |
| How many micro-iterations does a subproblem need, and which one is costly? | 2 | Micro-iterations: time per micro-iteration | `microIters[]`: `solving_time`, `elapsed_time`, `nb_added_constraints` |
| What share of the added constraints is binding? | 2b | Saturated constraint rate | `microIters[].n_saturated_constraints`, `n_all_constraints`, `addedConstraints[].constraints[]` |
| Which subproblems are slow? | 3 | Subproblem times | `microIters[]`: `solving_time`, `elapsed_time` |
| How much subproblem work does each iteration cost? | 3b | Cumulated times | `microIters[]` |
| How many constraint families are added per micro-iteration? | 4 | Constraints added per micro-iteration | `addedConstraints[].constraints[]` |
| How many N vs. NK rows are added? | 4b | N / NK constraints | `microIters[].n_added_constraints_N`, `n_added_constraints_NK` |
| Does a subproblem keep the same constraints across iterations? | 5a | Heatmap: common per iteration | `addedConstraints[]`: `constraints[].name` or `active_constraints` |
| Which constraints do two subproblems share in one iteration? | 5b | Heatmap: common per subproblem | `addedConstraints[]`: `constraints[].name` or `active_constraints` |
| How does master solve time evolve? | 6a | Master resolution time | `masterTimes[]` |
| How fast does the master grow? | 6b | Cumulative cuts | `addedCuts` |
| What does one iteration cost overall? | 3b + 6a | Links between graphs | `microIters[]`, `masterTimes[]` |

For any key not listed here, check the "Base indicators" section.

# Example

**Question:** which active constraints do subproblems A and B share at master iteration 3?

1. The index points to graph 5b, "Heatmap: common per subproblem", in Active mode.
2. That section says the Active set of one (`sub_name`, `num_master_iter`) is the `active_constraints` of the record with the highest `num_micro_iter`.
3. In the JSON, read `addedConstraints`. Keep the records with `num_master_iter = 3` and `sub_name` A or B. For each subproblem, take the record with the highest `num_micro_iter`.
4. Strip the trailing spaces from each name in `active_constraints`. Then compute the common set, `A ∩ B`, and the overlap, `100 · |A ∩ B| / |A ∪ B|`.
5. Report the overlap, the number of common constraints, and their names, or a sample if there are many.

# Data traps

- The first LB is a placeholder. Never use it in a gap.
- `ub` is not monotone. Use `best_ub` for convergence.
- `addedCuts[i]` belongs to master iteration `i + 1`.
- `microIters` and `addedConstraints` are not sorted. Filter on `sub_name`, `num_master_iter`, and `num_micro_iter`, and do not rely on position.
- `n_all_constraints` counts the rows added earlier in the same master iteration, before this solve. It is not the size of the subproblem.
- `nb_added_constraints` counts rows, while graph 4 counts families. Do not mix them.
- Incident families (`is_inc = true`) are counted in `n_added_constraints_NK`, but they are not branch limits. Remove them when you mean contingency limits only.
- `active_constraints` holds solver row names with trailing spaces. Strip the spaces before comparing. These names are finer than family names, and the key may be missing in older files.
- Times have no unit. `solving_time` and `elapsed_time` are on different scales. Graphs 2 and 3 add them, so say so when you do the same.
- `masterTimes[].elapsed_time` is PTDF time, not master solve time.

# Reporting

- Give each number with the key it comes from and the filters you used.
- Judge a run on its final `best_ub` and gap, not on time alone.
- Compare times only between runs from the same machine and setup.
- Follow the validity rules of the system prompt: separate observations from interpretations, and state your confidence.
