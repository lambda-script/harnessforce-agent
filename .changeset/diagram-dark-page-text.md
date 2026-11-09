---
"@harnessforce/claude-code-plugin": patch
---

The diagram skill's portable block stays readable on GitHub in dark mode for sequence, ER, state and gantt diagrams. The block keeps its light theme on the dark page, where the titles, messages, conditions, section names and axis labels that stand on the page vanished in dark ink. `render.mjs --portable` now sets those text colors to `#64748b` through `themeVariables`, which reach every diagram type, instead of relying on CSS, which mermaid empties when a rule needs `>`.
