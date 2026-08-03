import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260803.V1_7_1";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
