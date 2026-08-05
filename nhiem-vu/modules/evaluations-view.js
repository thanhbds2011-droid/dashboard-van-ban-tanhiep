import { renderKpiWorkflow } from "./kpi/kpi-workflow.js?v=20260805.V1_9_3";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
