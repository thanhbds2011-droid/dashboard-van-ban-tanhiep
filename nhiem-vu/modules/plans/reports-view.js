import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260913.V1_23_2";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
