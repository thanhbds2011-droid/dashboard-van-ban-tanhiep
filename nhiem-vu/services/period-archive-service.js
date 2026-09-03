/**
 * Lưu toàn bộ dữ liệu một kỳ lên Google Drive rồi mới dọn dữ liệu vận hành.
 * Minh chứng trên Drive không bị xóa; tệp lưu trữ chỉ giữ đường dẫn và dữ liệu đối chiếu.
 */
import { FirebaseService } from "../core/firebase-service.js?v=20260903.V1_22_2";
import { UserContext } from "../core/user-context.js?v=20260903.V1_22_2";
import { APP_VERSION } from "../core/app-version.js?v=20260903.V1_22_2";
import { NOTIFICATION_WEB_APP_URL } from "../notification-config.js?v=20260903.V1_22_2";

const ARCHIVE_COLLECTIONS = Object.freeze([
  "tasks",
  "taskMilestones",
  "taskWorkItems",
  "taskEvidenceFiles",
  "taskLogs",
  "taskRegistrations",
  "kpiPlans",
  "taskEvaluations",
  "commonCriteriaAssessments",
  "kpiProfiles",
  "kpiAdjustments",
  "kpiAuditLogs",
  "kpiDeletionLogs",
  "taskCodeReservations"
]);

const PURGE_ORDER = Object.freeze([
  "taskMilestones",
  "taskWorkItems",
  "taskEvidenceFiles",
  "taskLogs",
  "taskEvaluations",
  "commonCriteriaAssessments",
  "taskRegistrations",
  "kpiPlans",
  "kpiProfiles",
  "kpiAdjustments",
  "kpiAuditLogs",
  "kpiDeletionLogs",
  "taskCodeReservations",
  "tasks"
]);

const TIMEOUT_MS = 180000;
const BATCH_SIZE = 350;

function report(onProgress, phase, percent, message, detail = {}) {
  try { onProgress?.({ phase, percent, message, ...detail }); }
  catch (_) { /* Không để lỗi giao diện ngắt quy trình lưu trữ. */ }
}

function randomToken() {
  const values = new Uint32Array(8);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(36)).join("");
}

function requestId(periodId) {
  return `PERIOD_ARCHIVE_${periodId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(new Error("Không mã hóa được tệp lưu trữ kỳ."));
    reader.readAsDataURL(blob);
  });
}

async function prepareArchiveTransport(json, onProgress) {
  const rawBlob = new Blob([json], { type: "application/json;charset=utf-8" });
  if (typeof CompressionStream === "function") {
    report(onProgress, "COMPRESSING", 37, "Đang nén hồ sơ kỳ để giảm tải Apps Script…");
    const compressedStream = rawBlob.stream().pipeThrough(new CompressionStream("gzip"));
    const compressedBlob = await new Response(compressedStream).blob();
    return {
      encoding: "GZIP_BASE64",
      base64Data: await blobToBase64(compressedBlob),
      sourceSizeBytes: rawBlob.size,
      transportSizeBytes: compressedBlob.size
    };
  }
  return {
    encoding: "PLAIN_BASE64",
    base64Data: await blobToBase64(rawBlob),
    sourceSizeBytes: rawBlob.size,
    transportSizeBytes: rawBlob.size
  };
}

async function readPeriodCollection(collectionName, periodId, taskIds = []) {
  const snapshots = [await FirebaseService.getDocs(
    FirebaseService.query(
      FirebaseService.collection(FirebaseService.db, collectionName),
      FirebaseService.where("periodId", "==", periodId)
    )
  )];

  // Nhật ký V1.2.0 trở về trước có thể chưa có periodId; truy theo taskId để
  // lưu và dọn trọn vẹn mà không phải quét toàn bộ collection.
  if (collectionName === "taskLogs" && taskIds.length) {
    for (let offset = 0; offset < taskIds.length; offset += 30) {
      snapshots.push(await FirebaseService.getDocs(
        FirebaseService.query(
          FirebaseService.collection(FirebaseService.db, collectionName),
          FirebaseService.where("taskId", "in", taskIds.slice(offset, offset + 30))
        )
      ));
    }
  }

  const documents = new Map();
  snapshots.forEach(snapshot => snapshot.docs.forEach(item => documents.set(item.id, item)));
  const docs = [...documents.values()];
  return {
    name: collectionName,
    references: docs.map(item => item.ref),
    records: docs.map(item => ({ id: item.id, ...normalizeValue(item.data()) }))
  };
}

async function collectPeriod(periodId, onProgress) {
  if (!periodId) throw new Error("Không xác định được kỳ cần lưu trữ.");
  report(onProgress, "READING", 5, "Đang đọc dữ liệu của kỳ đánh giá…");

  const periodSnapshot = await FirebaseService.getDoc(
    FirebaseService.doc(FirebaseService.db, "evaluationPeriods", periodId)
  );
  if (!periodSnapshot.exists()) throw new Error("Không tìm thấy kỳ đánh giá trên Firestore.");
  const period = { id: periodSnapshot.id, ...normalizeValue(periodSnapshot.data()) };
  if (period.active === true || String(period.status || "").toUpperCase() !== "COMPLETED") {
    throw new Error("Chỉ được lưu trữ và dọn dữ liệu sau khi kỳ đã kết thúc.");
  }

  const results = [];
  for (let index = 0; index < ARCHIVE_COLLECTIONS.length; index += 1) {
    const name = ARCHIVE_COLLECTIONS[index];
    const taskIds = results.find(item => item.name === "tasks")?.records
      .filter(item => String(item.appVersion || "") !== "1.3.0")
      .map(item => item.id) || [];
    results.push(await readPeriodCollection(name, periodId, taskIds));
    report(
      onProgress,
      "READING",
      8 + Math.round(((index + 1) / ARCHIVE_COLLECTIONS.length) * 27),
      `Đang tổng hợp ${name}…`
    );
  }

  const collections = Object.fromEntries(results.map(item => [item.name, item.records]));
  const counts = Object.fromEntries(results.map(item => [item.name, item.records.length]));
  const totalRecords = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const archive = {
    schemaVersion: "KPI_PERIOD_ARCHIVE_V1",
    applicationVersion: `V${APP_VERSION}`,
    exportedAt: new Date().toISOString(),
    exportedBy: normalizeValue(UserContext.requireUser()),
    period,
    counts,
    totalRecords,
    collections
  };
  const json = JSON.stringify(archive, null, 2);
  const sha256 = await sha256Hex(json);
  return { period, results, counts, totalRecords, json, sha256 };
}

async function uploadToDrive(collected, onProgress) {
  if (!NOTIFICATION_WEB_APP_URL || NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")) {
    throw new Error("Chưa cấu hình Apps Script để lưu hồ sơ kỳ lên Google Drive.");
  }
  if (!FirebaseService.auth.currentUser) throw new Error("Phiên đăng nhập không hợp lệ.");

  const currentRequestId = requestId(collected.period.id);
  const pollToken = randomToken();
  const idToken = await FirebaseService.auth.currentUser.getIdToken(false);
  const transport = await prepareArchiveTransport(collected.json, onProgress);
  report(onProgress, "UPLOADING", 40, "Đang lưu hồ sơ kỳ lên Google Drive…");

  return new Promise((resolve, reject) => {
    const frameName = `periodArchiveFrame_${currentRequestId}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");
    const scripts = new Set();
    const callbacks = new Set();
    let settled = false;
    let pollTimer = null;
    let pollDelay = 700;

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    form.method = "POST";
    form.action = NOTIFICATION_WEB_APP_URL;
    form.target = frameName;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      action: "ARCHIVE_PERIOD_DATA",
      requestId: currentRequestId,
      pollToken,
      idToken,
      periodId: collected.period.id,
      sha256: collected.sha256,
      archiveEncoding: transport.encoding,
      archiveDataBase64: transport.base64Data,
      sourceSizeBytes: transport.sourceSizeBytes,
      transportSizeBytes: transport.transportSizeBytes
    });
    form.appendChild(input);

    const cleanup = () => {
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(pollTimer);
      scripts.forEach(script => script.remove());
      callbacks.forEach(name => { try { delete window[name]; } catch (_) { window[name] = undefined; } });
      form.remove();
      iframe.remove();
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const finishFromData = data => {
      if (data?.ok === true && data.fileUrl && data.sha256 === collected.sha256) {
        report(onProgress, "ARCHIVED", 60, "Đã lưu và kiểm tra hồ sơ kỳ trên Google Drive.");
        finish(() => resolve(data));
      } else {
        finish(() => reject(new Error(data?.error || "Không xác nhận được tệp lưu trữ trên Google Drive.")));
      }
    };
    const poll = () => {
      if (settled) return;
      const callbackName = `periodArchiveCallback_${currentRequestId.replace(/[^A-Za-z0-9_$]/g, "_")}_${Date.now()}`;
      const script = document.createElement("script");
      scripts.add(script);
      callbacks.add(callbackName);
      const release = () => {
        scripts.delete(script);
        callbacks.delete(callbackName);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };
      window[callbackName] = data => {
        release();
        if (data?.ready === true) return finishFromData(data);
        pollDelay = Math.min(2200, Math.round(pollDelay * 1.25));
        pollTimer = window.setTimeout(poll, pollDelay);
      };
      script.onerror = () => {
        release();
        pollDelay = Math.min(2500, Math.round(pollDelay * 1.35));
        pollTimer = window.setTimeout(poll, pollDelay);
      };
      script.src = `${NOTIFICATION_WEB_APP_URL}?action=PERIOD_ARCHIVE_GET_RESULT&requestId=${encodeURIComponent(currentRequestId)}&pollToken=${encodeURIComponent(pollToken)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      document.head.appendChild(script);
    };

    const timeoutTimer = window.setTimeout(
      () => finish(() => reject(new Error("Quá thời gian lưu hồ sơ kỳ lên Google Drive."))),
      TIMEOUT_MS
    );
    document.body.append(iframe, form);
    form.submit();
    pollTimer = window.setTimeout(poll, 700);
  });
}

async function markArchiveReady(collected, driveResult) {
  const user = UserContext.requireUser();
  const reference = FirebaseService.doc(FirebaseService.db, "periodArchives", collected.period.id);
  await FirebaseService.setDoc(reference, {
    periodId: collected.period.id,
    periodName: collected.period.name || collected.period.id,
    status: "ARCHIVED",
    schemaVersion: "KPI_PERIOD_ARCHIVE_V1",
    sha256: collected.sha256,
    archiveFileId: driveResult.fileId || "",
    archiveFileUrl: driveResult.fileUrl || "",
    archiveFileName: driveResult.fileName || "",
    sizeBytes: Number(driveResult.sizeBytes || 0),
    recordCounts: collected.counts,
    totalRecords: collected.totalRecords,
    archivedByUserId: user.uid,
    archivedByName: user.fullName || "",
    archivedAt: FirebaseService.serverTimestamp(),
    updatedAt: FirebaseService.serverTimestamp()
  }, { merge: true });
}

async function purgeCollected(collected, driveResult, onProgress) {
  const user = UserContext.requireUser();
  const archiveReference = FirebaseService.doc(FirebaseService.db, "periodArchives", collected.period.id);
  await FirebaseService.setDoc(archiveReference, {
    status: "PURGING",
    purgeStartedAt: FirebaseService.serverTimestamp(),
    updatedAt: FirebaseService.serverTimestamp()
  }, { merge: true });

  const resultMap = new Map(collected.results.map(item => [item.name, item]));
  const totalReferences = PURGE_ORDER.reduce((sum, name) => sum + (resultMap.get(name)?.references.length || 0), 0);
  let deleted = 0;

  for (const name of PURGE_ORDER) {
    const references = resultMap.get(name)?.references || [];
    for (let offset = 0; offset < references.length; offset += BATCH_SIZE) {
      const batch = FirebaseService.writeBatch(FirebaseService.db);
      const current = references.slice(offset, offset + BATCH_SIZE);
      current.forEach(reference => batch.delete(reference));
      await batch.commit();
      deleted += current.length;
      const percent = totalReferences ? 65 + Math.round((deleted / totalReferences) * 28) : 93;
      report(onProgress, "PURGING", percent, `Đã dọn ${deleted}/${totalReferences} bản ghi vận hành…`, { deleted, total: totalReferences, collectionName: name });
    }
  }

  const purgedRecordCount = Number(collected.expectedTotalRecords || deleted);

  await FirebaseService.updateDoc(
    FirebaseService.doc(FirebaseService.db, "evaluationPeriods", collected.period.id),
    {
      active: false,
      status: "PURGED",
      archiveStatus: "PURGED",
      archiveSha256: collected.sha256,
      archiveFileUrl: driveResult.fileUrl || "",
      purgedRecordCount,
      lastPurgeDeletedCount: deleted,
      purgedByUserId: user.uid,
      purgedByName: user.fullName || "",
      purgedAt: FirebaseService.serverTimestamp(),
      updatedAt: FirebaseService.serverTimestamp()
    }
  );
  await FirebaseService.setDoc(archiveReference, {
    status: "PURGED",
    purgedRecordCount,
    lastPurgeDeletedCount: deleted,
    purgedByUserId: user.uid,
    purgedByName: user.fullName || "",
    purgedAt: FirebaseService.serverTimestamp(),
    updatedAt: FirebaseService.serverTimestamp()
  }, { merge: true });

  report(onProgress, "COMPLETED", 100, "Đã lưu Drive và dọn dữ liệu kỳ khỏi Firestore.", { deleted });
  return { deleted };
}

export const PeriodArchiveService = Object.freeze({
  async archiveAndPurge(periodId, options = {}) {
    const existingSnapshot = await FirebaseService.getDoc(
      FirebaseService.doc(FirebaseService.db, "periodArchives", periodId)
    );
    const existing = existingSnapshot.exists() ? { id: existingSnapshot.id, ...existingSnapshot.data() } : null;
    if (existing?.status === "PURGED") {
      return {
        periodId,
        sha256: existing.sha256,
        totalRecords: Number(existing.totalRecords || 0),
        archiveFileUrl: existing.archiveFileUrl || "",
        archiveFileName: existing.archiveFileName || "",
        deleted: Number(existing.purgedRecordCount || 0),
        resumed: true
      };
    }

    const collected = await collectPeriod(periodId, options.onProgress);
    if (existing && ["ARCHIVED", "PURGING"].includes(existing.status) && existing.sha256 && existing.archiveFileUrl) {
      report(options.onProgress, "RESUMING", 60, "Đã tìm thấy tệp Drive hợp lệ; tiếp tục dọn phần dữ liệu còn lại…");
      const purgeResult = await purgeCollected({
        ...collected,
        sha256: existing.sha256,
        expectedTotalRecords: Number(existing.totalRecords || 0)
      }, {
        fileId: existing.archiveFileId || "",
        fileUrl: existing.archiveFileUrl,
        fileName: existing.archiveFileName || "",
        sizeBytes: existing.sizeBytes || 0
      }, options.onProgress);
      return {
        periodId,
        sha256: existing.sha256,
        totalRecords: Number(existing.totalRecords || collected.totalRecords),
        archiveFileUrl: existing.archiveFileUrl,
        archiveFileName: existing.archiveFileName || "",
        deleted: purgeResult.deleted,
        resumed: true
      };
    }

    const driveResult = await uploadToDrive(collected, options.onProgress);
    await markArchiveReady(collected, driveResult);
    const purgeResult = await purgeCollected(collected, driveResult, options.onProgress);
    return {
      periodId,
      sha256: collected.sha256,
      totalRecords: collected.totalRecords,
      archiveFileUrl: driveResult.fileUrl,
      archiveFileName: driveResult.fileName,
      deleted: purgeResult.deleted
    };
  },

  collections: ARCHIVE_COLLECTIONS
});
