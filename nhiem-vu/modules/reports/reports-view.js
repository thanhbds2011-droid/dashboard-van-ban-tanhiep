import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260916.V1_24_6";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
