import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION9_STABLE_3LEVEL";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
