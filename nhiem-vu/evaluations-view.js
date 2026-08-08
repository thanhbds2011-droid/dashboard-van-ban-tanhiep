import { renderKpiWorkflow } from "./kpi/kpi-workflow.js?v=20260808.V1_10_1";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
