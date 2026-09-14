import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260914.V1_24_4";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
