import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260825.V1_17_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
