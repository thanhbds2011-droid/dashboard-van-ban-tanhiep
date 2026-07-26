import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION10_HOTFIX_ASYNC";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
