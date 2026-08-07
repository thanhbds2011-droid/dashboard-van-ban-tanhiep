import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260806.V1_9_4";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
