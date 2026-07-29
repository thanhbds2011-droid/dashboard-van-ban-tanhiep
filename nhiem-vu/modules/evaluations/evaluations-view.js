import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260728.V1_1_7";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
