import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260826.V1_18_5";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
