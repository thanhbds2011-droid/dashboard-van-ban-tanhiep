import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.KPI_WORKFLOW_V3";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
