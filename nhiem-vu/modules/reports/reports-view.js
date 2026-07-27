import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=1.0.0";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
