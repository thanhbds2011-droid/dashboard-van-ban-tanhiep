import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260731.V1_1_18";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
