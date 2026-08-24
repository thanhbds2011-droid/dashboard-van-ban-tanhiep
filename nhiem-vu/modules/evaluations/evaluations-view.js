import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260824.V1_14_2";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
