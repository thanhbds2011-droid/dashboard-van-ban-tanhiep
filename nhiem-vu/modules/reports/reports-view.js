import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260801.V1_5_0";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
