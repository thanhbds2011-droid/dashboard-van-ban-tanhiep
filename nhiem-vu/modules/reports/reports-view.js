import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260904.V1_22_7";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
