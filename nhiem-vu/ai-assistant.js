import { auth } from "./firebase-config.js?v=20260718.2000";
import { NOTIFICATION_WEB_APP_URL } from "./notification-config.js?v=20260718.2000";

/* =========================================================
 * AI MODULE V3 — HYBRID CALLBACK + MOBILE POLLING — TRỢ LÝ GỢI Ý NỘI DUNG THEO TINH THẦN 6 RÕ
 *
 * Mô-đun độc lập, được nạp cuối cùng.
 * Muốn gỡ AI: xóa dòng nạp ai-assistant.css/js trong index.html
 * và xóa nhánh AI_SUGGEST_TASK cùng khối AI MODULE V3 — HYBRID CALLBACK + MOBILE POLLING trong Code.gs.
 * ========================================================= */

const AI_REQUEST_TIMEOUT_MS = 35000;
const AI_SOURCE = "TASK_AI_SUGGESTION";
const AI_POLL_ACTION = "AI_GET_RESULT";
const AI_POLL_INTERVAL_MS = 1500;
const AI_POLL_FIRST_DELAY_MS = 700;
const AI_JSONP_TIMEOUT_MS = 8000;

const elements = {
  taskTitle: document.getElementById("taskTitle"),
  taskDescription: document.getElementById("taskDescription"),
  sourceType: document.getElementById("sourceType"),
  sourceDetail: document.getElementById("sourceDetail"),
  assignedByUserId: document.getElementById("assignedByUserId"),
  primaryDepartmentId: document.getElementById("primaryDepartmentId"),
  deadline: document.getElementById("deadline"),
  priority: document.getElementById("priority"),
  resultSummary: document.getElementById("resultSummary")
};

let pendingRequestId = "";
let pendingRequestCancel = null;
let currentSuggestion = null;

function clean(value, maxLength = 3000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function selectedText(selectElement) {
  if (!selectElement || !selectElement.value) {
    return "";
  }

  const option = selectElement.options[selectElement.selectedIndex];
  return clean(option ? option.textContent : "", 300);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createElementFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function buildTaskAssistant() {
  if (!elements.taskDescription || document.getElementById("taskAiAssistant")) {
    return;
  }

  const panel = createElementFromHtml(`
    <section id="taskAiAssistant" class="task-ai-assistant" aria-labelledby="taskAiAssistantTitle">
      <div class="task-ai-header">
        <div>
          <strong id="taskAiAssistantTitle">✨ Trợ lý AI gợi ý theo tinh thần 6 rõ</strong>
          <small>AI chỉ gợi ý; người dùng phải kiểm tra và chủ động áp dụng.</small>
        </div>
        <button id="taskAiSuggestButton" class="task-ai-button" type="button">
          Gợi ý nội dung
        </button>
      </div>

      <div id="taskAiMessage" class="task-ai-message hidden" role="status" aria-live="polite"></div>

      <div id="taskAiResult" class="task-ai-result hidden">
        <div class="task-ai-result-heading">
          <strong>Gợi ý của AI</strong>
          <span>Tham khảo</span>
        </div>

        <div class="task-ai-suggestion-block">
          <small>Tên nhiệm vụ đề xuất</small>
          <p id="taskAiSuggestedTitle"></p>
        </div>

        <div class="task-ai-suggestion-block">
          <small>Nội dung thực hiện đề xuất</small>
          <p id="taskAiSuggestedContent"></p>
        </div>

        <div id="taskAiMissingWrap" class="task-ai-missing hidden">
          <small>Thông tin nên bổ sung</small>
          <ul id="taskAiMissingItems"></ul>
        </div>

        <div id="taskAiChecks" class="task-ai-checks"></div>

        <div class="task-ai-actions">
          <button id="taskAiApplyContentButton" class="secondary-button" type="button">
            Áp dụng nội dung
          </button>
          <button id="taskAiApplyAllButton" class="primary-button" type="button">
            Áp dụng cả tiêu đề và nội dung
          </button>
          <button id="taskAiRegenerateButton" class="text-button" type="button">
            Tạo lại
          </button>
        </div>
      </div>
    </section>
  `);

  const fieldBlock = elements.taskDescription.closest(".field-block");
  if (fieldBlock) {
    fieldBlock.insertAdjacentElement("afterend", panel);
  }

  document.getElementById("taskAiSuggestButton")
    ?.addEventListener("click", requestTaskSuggestion);

  document.getElementById("taskAiRegenerateButton")
    ?.addEventListener("click", requestTaskSuggestion);

  document.getElementById("taskAiApplyContentButton")
    ?.addEventListener("click", () => applyTaskSuggestion(false));

  document.getElementById("taskAiApplyAllButton")
    ?.addEventListener("click", () => applyTaskSuggestion(true));
}

function buildResultAssistant() {
  if (!elements.resultSummary || document.getElementById("resultAiAssistant")) {
    return;
  }

  const panel = createElementFromHtml(`
    <section id="resultAiAssistant" class="task-ai-assistant task-ai-result-assistant">
      <div class="task-ai-header compact">
        <div>
          <strong>✨ AI gợi ý kết quả thực hiện</strong>
          <small>Chuẩn hóa kết quả ngắn gọn, rõ sản phẩm và minh chứng.</small>
        </div>
        <button id="resultAiSuggestButton" class="task-ai-button" type="button">
          Gợi ý kết quả
        </button>
      </div>
      <div id="resultAiMessage" class="task-ai-message hidden" role="status" aria-live="polite"></div>
    </section>
  `);

  const fieldBlock = elements.resultSummary.closest(".field-block");
  if (fieldBlock) {
    fieldBlock.appendChild(panel);
  }

  document.getElementById("resultAiSuggestButton")
    ?.addEventListener("click", requestResultSuggestion);
}

function showMessage(id, message, type = "info") {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `task-ai-message ${type}`;
}

function hideMessage(id) {
  const element = document.getElementById(id);
  if (element) {
    element.className = "task-ai-message hidden";
    element.textContent = "";
  }
}

function setButtonBusy(buttonId, busy, busyText, normalText) {
  const button = document.getElementById(buttonId);
  if (!button) {
    return;
  }

  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function collectTaskContext() {
  return {
    purpose: "CREATE_TASK",
    title: clean(elements.taskTitle?.value, 250),
    description: clean(elements.taskDescription?.value, 3000),
    sourceType: selectedText(elements.sourceType),
    sourceDetail: clean(elements.sourceDetail?.value, 700),
    assignedBy: selectedText(elements.assignedByUserId),
    primaryDepartment: selectedText(elements.primaryDepartmentId),
    deadline: clean(elements.deadline?.value, 20),
    priority: selectedText(elements.priority)
  };
}

function collectResultContext() {
  const detailTitle = clean(
    document.querySelector("#progressTaskSummary strong")?.textContent ||
      elements.taskTitle?.value,
    250
  );

  return {
    purpose: "UPDATE_RESULT",
    title: detailTitle,
    description: clean(
      document.querySelector("#progressTaskSummary span")?.textContent ||
        elements.taskDescription?.value,
      3000
    ),
    currentResult: clean(elements.resultSummary?.value, 3000)
  };
}

function validateTaskContext(context) {
  if (!context.title && !context.description) {
    throw new Error(
      "Hãy nhập tên nhiệm vụ hoặc nội dung thực hiện trước khi yêu cầu AI gợi ý."
    );
  }
}

async function submitAiRequest(context) {
  if (
    !NOTIFICATION_WEB_APP_URL ||
    NOTIFICATION_WEB_APP_URL.includes("DAN_LINK_WEB_APP")
  ) {
    throw new Error("Chưa cấu hình đường dẫn Google Apps Script.");
  }

  if (!auth.currentUser) {
    throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  }

  if (pendingRequestId) {
    throw new Error("AI đang xử lý một yêu cầu khác. Vui lòng chờ.");
  }

  const requestId = [
    "AI_V3",
    Date.now(),
    randomSecureToken(12)
  ].join("_");
  const pollToken = randomSecureToken(32);

  pendingRequestId = requestId;

  let settled = false;
  let timeoutId = null;
  let progressTimerId = null;
  let iframe = null;
  let form = null;
  let activeJsonpCleanup = null;

  return new Promise(async (resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMessage);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      if (progressTimerId) {
        window.clearTimeout(progressTimerId);
      }

      if (activeJsonpCleanup) {
        activeJsonpCleanup();
        activeJsonpCleanup = null;
      }

      iframe?.remove();
      form?.remove();
      pendingRequestId = "";
      pendingRequestCancel = null;
    };

    const finish = (data, error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (error) {
        reject(error);
      } else if (data && data.ok) {
        resolve(data);
      } else {
        reject(new Error(data?.error || "AI không trả được gợi ý."));
      }
    };

    function onMessage(event) {
      const data = event.data;

      if (
        !data ||
        data.source !== AI_SOURCE ||
        data.requestId !== requestId
      ) {
        return;
      }

      finish(data, null);
    }

    pendingRequestCancel = () => {
      finish(
        null,
        new Error("Đã hủy yêu cầu gợi ý AI.")
      );
    };

    window.addEventListener("message", onMessage);

    timeoutId = window.setTimeout(() => {
      finish(
        null,
        new Error(
          "Chưa nhận được phản hồi AI sau 35 giây. Nội dung đã nhập vẫn được giữ nguyên; vui lòng thử lại sau."
        )
      );
    }, AI_REQUEST_TIMEOUT_MS);

    progressTimerId = window.setTimeout(() => {
      if (!settled) {
        updatePendingMessage(
          "AI đang xử lý lâu hơn dự kiến. Bạn vẫn có thể tiếp tục nhập hoặc chờ thêm."
        );
      }
    }, 8000);

    try {
      const idToken = await auth.currentUser.getIdToken(true);

      iframe = document.createElement("iframe");
      iframe.name = `aiFrame_${requestId}`;
      iframe.className = "task-ai-hidden-frame";
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("tabindex", "-1");

      form = document.createElement("form");
      form.method = "POST";
      form.action = NOTIFICATION_WEB_APP_URL;
      form.target = iframe.name;
      form.className = "hidden";

      const payloadInput = document.createElement("input");
      payloadInput.type = "hidden";
      payloadInput.name = "payload";
      payloadInput.value = JSON.stringify({
        action: "AI_SUGGEST_TASK",
        requestId,
        pollToken,
        idToken,
        context
      });

      form.appendChild(payloadInput);
      document.body.appendChild(iframe);
      document.body.appendChild(form);
      form.submit();

      window.setTimeout(async () => {
        while (!settled) {
          try {
            const pollResult = await pollAiResultOnce(
              requestId,
              pollToken,
              (cleanupFn) => {
                activeJsonpCleanup = cleanupFn;
              }
            );

            activeJsonpCleanup = null;

            if (pollResult && pollResult.ready === true) {
              finish(pollResult, null);
              return;
            }
          } catch (pollError) {
            console.warn("AI mobile polling tạm thời lỗi:", pollError);
          }

          await wait(AI_POLL_INTERVAL_MS);
        }
      }, AI_POLL_FIRST_DELAY_MS);
    } catch (error) {
      finish(null, error);
    }
  });
}

function randomSecureToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function updatePendingMessage(message) {
  const taskMessage = document.getElementById("taskAiMessage");
  const resultMessage = document.getElementById("resultAiMessage");

  if (taskMessage && !taskMessage.classList.contains("hidden")) {
    showMessage("taskAiMessage", message, "info");
  }

  if (resultMessage && !resultMessage.classList.contains("hidden")) {
    showMessage("resultAiMessage", message, "info");
  }
}

function pollAiResultOnce(requestId, pollToken, registerCleanup) {
  return new Promise((resolve, reject) => {
    const callbackName = `__aiV3Jsonp_${Date.now()}_${randomSecureToken(5)}`;
    const script = document.createElement("script");
    let completed = false;
    let timerId = null;

    const cleanup = () => {
      if (completed) {
        return;
      }

      completed = true;

      if (timerId) {
        window.clearTimeout(timerId);
      }

      script.remove();

      try {
        delete window[callbackName];
      } catch (error) {
        window[callbackName] = undefined;
      }
    };

    registerCleanup?.(cleanup);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data || null);
    };

    script.async = true;
    script.src = buildAiPollUrl(requestId, pollToken, callbackName);
    script.onerror = () => {
      cleanup();
      reject(new Error("Không kết nối được kênh nhận kết quả AI."));
    };

    timerId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Kênh nhận kết quả AI phản hồi chậm."));
    }, AI_JSONP_TIMEOUT_MS);

    document.head.appendChild(script);
  });
}

function buildAiPollUrl(requestId, pollToken, callbackName) {
  const url = new URL(NOTIFICATION_WEB_APP_URL);

  url.searchParams.set("action", AI_POLL_ACTION);
  url.searchParams.set("requestId", requestId);
  url.searchParams.set("pollToken", pollToken);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("_", String(Date.now()));

  return url.toString();
}

async function requestTaskSuggestion() {
  hideMessage("taskAiMessage");

  try {
    const context = collectTaskContext();
    validateTaskContext(context);

    setButtonBusy("taskAiSuggestButton", true, "Đang gợi ý...", "Gợi ý nội dung");
    setButtonBusy("taskAiRegenerateButton", true, "Đang tạo lại...", "Tạo lại");
    showMessage(
      "taskAiMessage",
      "AI đang phân tích nội dung theo tinh thần 6 rõ...",
      "info"
    );

    const response = await submitAiRequest(context);
    currentSuggestion = response.suggestion || null;

    if (!currentSuggestion) {
      throw new Error("AI không trả về nội dung phù hợp.");
    }

    renderTaskSuggestion(currentSuggestion);
    showMessage(
      "taskAiMessage",
      response.cached
        ? "Đã sử dụng gợi ý gần nhất. Hãy kiểm tra trước khi áp dụng."
        : "Đã tạo gợi ý. Hãy kiểm tra trước khi áp dụng.",
      "success"
    );
  } catch (error) {
    showMessage(
      "taskAiMessage",
      error?.message || "Không tạo được gợi ý AI.",
      "error"
    );
  } finally {
    setButtonBusy("taskAiSuggestButton", false, "Đang gợi ý...", "Gợi ý nội dung");
    setButtonBusy("taskAiRegenerateButton", false, "Đang tạo lại...", "Tạo lại");
  }
}

async function requestResultSuggestion() {
  hideMessage("resultAiMessage");

  try {
    const context = collectResultContext();

    if (!context.title && !context.currentResult) {
      throw new Error("Chưa có đủ thông tin để AI gợi ý kết quả.");
    }

    setButtonBusy("resultAiSuggestButton", true, "Đang gợi ý...", "Gợi ý kết quả");
    showMessage(
      "resultAiMessage",
      "AI đang chuẩn hóa kết quả thực hiện...",
      "info"
    );

    const response = await submitAiRequest(context);
    const suggestedContent = clean(
      response.suggestion?.suggestedContent,
      3000
    );

    if (!suggestedContent) {
      throw new Error("AI không trả về nội dung kết quả phù hợp.");
    }

    elements.resultSummary.value = suggestedContent;
    elements.resultSummary.dispatchEvent(new Event("input", { bubbles: true }));
    showMessage(
      "resultAiMessage",
      "Đã điền gợi ý. Hãy kiểm tra và chỉnh lại trước khi lưu.",
      "success"
    );
  } catch (error) {
    showMessage(
      "resultAiMessage",
      error?.message || "Không tạo được gợi ý kết quả.",
      "error"
    );
  } finally {
    setButtonBusy("resultAiSuggestButton", false, "Đang gợi ý...", "Gợi ý kết quả");
  }
}

function renderTaskSuggestion(suggestion) {
  const result = document.getElementById("taskAiResult");
  const title = document.getElementById("taskAiSuggestedTitle");
  const content = document.getElementById("taskAiSuggestedContent");
  const missingWrap = document.getElementById("taskAiMissingWrap");
  const missingItems = document.getElementById("taskAiMissingItems");
  const checks = document.getElementById("taskAiChecks");

  if (!result || !title || !content || !missingWrap || !missingItems || !checks) {
    return;
  }

  title.textContent =
    clean(suggestion.suggestedTitle, 250) || "Giữ nguyên tiêu đề hiện tại";
  content.textContent = clean(suggestion.suggestedContent, 3000);

  const missing = Array.isArray(suggestion.missingItems)
    ? suggestion.missingItems
        .map((item) => clean(item, 250))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  missingItems.innerHTML = missing
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  missingWrap.classList.toggle("hidden", missing.length === 0);

  const labels = {
    clearPerson: "Rõ người",
    clearTask: "Rõ việc",
    clearTime: "Rõ thời gian",
    clearResponsibility: "Rõ trách nhiệm",
    clearProduct: "Rõ sản phẩm",
    clearAuthority: "Rõ thẩm quyền"
  };

  const clarity = suggestion.clarityChecks || {};

  checks.innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const passed = clarity[key] === true;
      return `
        <span class="task-ai-check ${passed ? "passed" : "missing"}">
          ${passed ? "✓" : "!"} ${escapeHtml(label)}
        </span>
      `;
    })
    .join("");

  result.classList.remove("hidden");
}

function applyTaskSuggestion(includeTitle) {
  if (!currentSuggestion) {
    return;
  }

  const suggestedContent = clean(currentSuggestion.suggestedContent, 3000);
  const suggestedTitle = clean(currentSuggestion.suggestedTitle, 250);

  if (suggestedContent && elements.taskDescription) {
    elements.taskDescription.value = suggestedContent;
    elements.taskDescription.dispatchEvent(new Event("input", { bubbles: true }));
  }

  if (includeTitle && suggestedTitle && elements.taskTitle) {
    elements.taskTitle.value = suggestedTitle;
    elements.taskTitle.dispatchEvent(new Event("input", { bubbles: true }));
  }

  showMessage(
    "taskAiMessage",
    includeTitle
      ? "Đã áp dụng tiêu đề và nội dung. Hãy kiểm tra lại trước khi lưu."
      : "Đã áp dụng nội dung. Hãy kiểm tra lại trước khi lưu.",
    "success"
  );
}

function initializeAiAssistant() {
  buildTaskAssistant();
  buildResultAssistant();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAiAssistant, {
    once: true
  });
} else {
  initializeAiAssistant();
}
