import { renderKpiWorkflow } from "./kpi/kpi-workflow.js?v=20260810.V1_10_6";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
