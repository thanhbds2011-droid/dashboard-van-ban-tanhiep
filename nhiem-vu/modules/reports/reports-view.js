import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260903.V1_22_3";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
