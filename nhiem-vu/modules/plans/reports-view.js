import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260911.V1_23_1";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
