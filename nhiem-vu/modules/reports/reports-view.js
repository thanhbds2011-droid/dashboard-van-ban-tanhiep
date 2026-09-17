import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260917.V1_24_9";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
