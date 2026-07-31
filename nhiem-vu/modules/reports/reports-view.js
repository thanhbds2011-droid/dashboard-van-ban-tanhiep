import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260731.V1_1_19";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
