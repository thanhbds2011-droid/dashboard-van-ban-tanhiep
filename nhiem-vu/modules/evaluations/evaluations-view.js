import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260913.V1_23_2";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
