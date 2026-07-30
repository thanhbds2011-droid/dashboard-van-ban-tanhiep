import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260730.V1_1_10";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
