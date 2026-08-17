(function () {
  const LEGACY_KEY = "techroute.visits.v1";

  const TECHNICIANS = [
    { id: "maya-chen", name: "Maya Chen" },
    { id: "luis-navarro", name: "Luis Navarro" },
    { id: "priya-shah", name: "Priya Shah" },
    { id: "jonas-berg", name: "Jonas Berg" },
    { id: "amara-okonkwo", name: "Amara Okonkwo" },
  ];

  const SERVICE_TYPES = [
    "Installation",
    "Preventive maintenance",
    "Corrective repair",
    "Inspection",
    "Calibration",
    "Emergency call-out",
  ];

  const STATUS_LABELS = {
    scheduled: "Scheduled",
    in_progress: "In progress",
    completed: "Completed",
    rescheduled: "Rescheduled",
    cancelled: "Cancelled",
  };

  const REASON_PRESETS = {
    rescheduled: [
      "Client requested a new window",
      "Parts not available",
      "Technician unavailable",
      "Weather / site unsafe",
      "No site access",
    ],
    cancelled: [
      "Client cancelled",
      "Duplicate visit",
      "Out of scope",
      "Could not access site",
      "Safety stop",
    ],
  };

  const form = document.getElementById("visit-form");
  const listEl = document.getElementById("visit-list");
  const countEl = document.getElementById("visit-count");
  const toastEl = document.getElementById("toast");
  const statusEl = document.getElementById("store-status");
  const dateInput = form.elements.date;
  const techSelect = form.elements.technician;
  const serviceSelect = form.elements.serviceType;
  const importFile = document.getElementById("import-file");
  const checklistEl = document.getElementById("resource-checklist");
  const kitCountEl = document.getElementById("kit-count");
  const statusDialog = document.getElementById("status-dialog");
  const statusForm = document.getElementById("status-form");
  const rescheduleFields = document.getElementById("reschedule-fields");
  const reasonFields = document.getElementById("reason-fields");
  const reasonPresets = document.getElementById("reason-presets");
  const weekView = document.getElementById("week-view");
  const scheduleView = document.getElementById("schedule-view");
  const weekGrid = document.getElementById("week-grid");
  const weekLabel = document.getElementById("week-label");
  const filterTechsEl = document.getElementById("filter-techs");
  const filterStatusesEl = document.getElementById("filter-statuses");
  const filterSummary = document.getElementById("filter-summary");

  fillSelect(techSelect, TECHNICIANS.map((t) => [t.id, t.name]));
  fillSelect(serviceSelect, SERVICE_TYPES.map((s) => [s, s]));
  dateInput.min = todayISO();

  let visits = [];
  let online = false;
  let weekStart = startOfWeek(new Date());
  const selectedTechs = new Set();
  const selectedStatuses = new Set();

  paintFilterChips();
  boot();

  form.addEventListener("submit", onSubmit);
  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      clearErrors();
      dateInput.min = todayISO();
      updateKitCount();
    }, 0);
  });
  form.addEventListener("input", (e) => {
    if (e.target.name) clearFieldError(e.target.name);
    if (e.target.name === "resource") updateKitCount();
  });
  checklistEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".kit-all");
    if (!btn) return;
    const group = btn.closest(".kit-group");
    const boxes = Array.from(group.querySelectorAll('input[name="resource"]'));
    const allOn = boxes.every((box) => box.checked);
    boxes.forEach((box) => {
      box.checked = !allOn;
    });
    btn.textContent = allOn ? "All" : "None";
    updateKitCount();
  });
  listEl.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      try {
        await api("/visits/" + removeBtn.dataset.remove, { method: "DELETE" });
        visits = visits.filter((v) => v.id !== removeBtn.dataset.remove);
        render();
        showToast("Visit removed from the board.");
      } catch (err) {
        showToast(err.message);
      }
      return;
    }
    const saveObs = e.target.closest("[data-save-obs]");
    if (saveObs) {
      const id = saveObs.dataset.saveObs;
      const box = saveObs.closest(".obs").querySelector(".obs__input");
      applyObservations(id, box.value);
      return;
    }
    const quick = e.target.closest("[data-quick-status]");
    if (quick) {
      applyStatus(quick.dataset.visit, { status: quick.dataset.quickStatus });
      return;
    }
    const open = e.target.closest("[data-open-status]");
    if (open) {
      const visit = visits.find((v) => v.id === open.dataset.visit);
      if (visit) openStatusDialog(visit, open.dataset.openStatus);
    }
  });

  statusForm.elements.status.addEventListener("change", onStatusTypeChange);
  document.getElementById("status-cancel").addEventListener("click", () => {
    statusDialog.close();
  });
  reasonPresets.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    statusForm.elements.reason.value = btn.dataset.preset;
    reasonPresets.querySelectorAll(".preset").forEach((el) => {
      el.classList.toggle("is-on", el === btn);
    });
    clearStatusFieldError("reason");
  });
  statusForm.addEventListener("submit", onStatusSubmit);

  document.querySelector(".view-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    setView(btn.dataset.view);
  });
  document.getElementById("week-filters").addEventListener("click", (e) => {
    const tech = e.target.closest("[data-filter-tech]");
    if (tech) {
      toggleSet(selectedTechs, tech.dataset.filterTech);
      renderDashboard();
      return;
    }
    const st = e.target.closest("[data-filter-status]");
    if (st) {
      toggleSet(selectedStatuses, st.dataset.filterStatus);
      renderDashboard();
    }
  });
  document.getElementById("filter-clear").addEventListener("click", () => {
    selectedTechs.clear();
    selectedStatuses.clear();
    renderDashboard();
  });

  document.getElementById("export-json").addEventListener("click", () => {
    download("/export.json", "techroute-visits.json");
  });
  document.getElementById("export-db").addEventListener("click", () => {
    download("/export.sqlite", "techroute.sqlite");
  });
  document.getElementById("import-btn").addEventListener("click", () => {
    importFile.click();
  });
  importFile.addEventListener("change", onImport);

  async function boot() {
    try {
      const health = await api("/health");
      visits = await api("/visits");
      const catalog = await api("/resources");
      renderChecklist(catalog);
      online = true;
      setStatus(
        "SQLite ready � " +
          (health.tables ? health.tables.join(", ") : health.table) +
          " � " +
          health.records +
          " visit(s)"
      );
      await migrateLegacy();
      render();
    } catch (err) {
      online = false;
      setStatus("Start with python3 server.py to evaluate the API", true);
      visits = [];
      render();
    }
  }

  async function migrateLegacy() {
    let legacy = [];
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      legacy = raw ? JSON.parse(raw) : [];
    } catch {
      legacy = [];
    }
    if (!Array.isArray(legacy) || !legacy.length) return;
    const result = await api("/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visits: legacy }),
    });
    visits = result.visits || visits;
    if (result.imported) {
      localStorage.removeItem(LEGACY_KEY);
      showToast("Moved " + result.imported + " browser visit(s) into SQLite.");
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearErrors();
    if (!online) {
      showToast("Start the server first: python3 server.py");
      return;
    }

    const data = {
      clientName: value("clientName"),
      clientPhone: value("clientPhone"),
      location: value("location"),
      date: value("date"),
      time: value("time"),
      technician: value("technician"),
      serviceType: value("serviceType"),
      notes: value("notes"),
    };

    const errors = validate(data);
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([name, msg]) => setFieldError(name, msg));
      const first = form.querySelector(".is-invalid input, .is-invalid select, .is-invalid textarea");
      if (first) first.focus();
      return;
    }

    const tech = TECHNICIANS.find((t) => t.id === data.technician);
    try {
      const saved = await api("/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: data.clientName,
          clientPhone: data.clientPhone,
          location: data.location,
          date: data.date,
          time: data.time,
          technicianId: tech.id,
          technicianName: tech.name,
          serviceType: data.serviceType,
          notes: data.notes,
          resourceIds: selectedResourceIds(),
        }),
      });
      visits.push(saved);
      render();
      form.reset();
      dateInput.min = todayISO();
      updateKitCount();
      showToast("Visit filed in SQLite.");
    } catch (err) {
      showToast(err.message);
    }
  }

  async function onImport() {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;
    try {
      const isJson = /\.json$/i.test(file.name) || file.type.indexOf("json") !== -1;
      const body = isJson ? await file.text() : await file.arrayBuffer();
      const headers = isJson
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/octet-stream" };
      const result = await api("/import", {
        method: "POST",
        headers: headers,
        body: body,
      });
      visits = result.visits || [];
      render();
      showToast("Imported " + result.imported + " visit(s).");
    } catch (err) {
      showToast(err.message);
    }
  }

  async function download(path, filename) {
    try {
      const res = await fetch("/api" + path);
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function api(path, opts) {
    let res;
    try {
      res = await fetch("/api" + path, opts);
    } catch {
      throw new Error("SQLite server is off. Run python3 server.py");
    }
    const ct = res.headers.get("content-type") || "";
    const payload = ct.indexOf("json") !== -1 ? await res.json() : null;
    if (!res.ok) {
      throw new Error((payload && payload.error) || "Request failed.");
    }
    return payload;
  }

  function validate(data) {
    const errors = {};
    if (!data.clientName) errors.clientName = "Enter the client name.";
    if (!data.clientPhone) errors.clientPhone = "Enter a contact phone.";
    else if (!/^[\d+\s().-]{7,24}$/.test(data.clientPhone)) {
      errors.clientPhone = "Use a valid phone number.";
    }
    if (!data.location) errors.location = "Enter the client location.";
    if (!data.date) errors.date = "Pick a visit date.";
    else if (data.date < todayISO()) errors.date = "Date cannot be in the past.";
    if (!data.time) errors.time = "Pick a visit time.";
    if (!data.technician) errors.technician = "Assign a technician.";
    if (!data.serviceType) errors.serviceType = "Select a service type.";
    return errors;
  }

  function render() {
    const sorted = visits.slice().sort((a, b) => {
      const ka = a.date + a.time;
      const kb = b.date + b.time;
      return ka.localeCompare(kb);
    });

    countEl.textContent = sorted.length === 1 ? "1 visit" : sorted.length + " visits";

    if (!online) {
      listEl.innerHTML =
        '<li class="empty">SQLite is offline. From the project folder run python3 server.py then open http://127.0.0.1:8765</li>';
      renderDashboard();
      return;
    }

    if (!sorted.length) {
      listEl.innerHTML =
        '<li class="empty">No visits on the board. File one from the work order.</li>';
      renderDashboard();
      return;
    }

    listEl.innerHTML = sorted
      .map((v) => {
        const when = formatWhen(v.date, v.time);
        const notes = v.notes
          ? `<p class="ticket__notes">Job notes: ${escapeHtml(v.notes)}</p>`
          : "";
        const kit = (v.resources || [])
          .map((item) => `<span class="chip">${escapeHtml(item.name)}</span>`)
          .join("");
        const kitBlock = kit ? `<div class="ticket__kit">${kit}</div>` : "";
        const status = v.status || "scheduled";
        const stamp = formatStamp(v.statusChangedAt || v.createdAt);
        const reason = v.statusReason
          ? `<p class="ticket__reason">${escapeHtml(STATUS_LABELS[status] || status)}: ${escapeHtml(v.statusReason)}</p>`
          : "";
        const logItems = (v.statusEvents || [])
          .slice()
          .reverse()
          .slice(0, 4)
          .map((ev) => {
            const extra = ev.reason ? " - " + escapeHtml(ev.reason) : "";
            return (
              "<li><time>" +
              escapeHtml(formatStamp(ev.changedAt)) +
              "</time> " +
              escapeHtml(STATUS_LABELS[ev.status] || ev.status) +
              extra +
              "</li>"
            );
          })
          .join("");
        const log = logItems
          ? `<ol class="ticket__log">${logItems}</ol>`
          : "";
        return `
          <li class="ticket" data-status="${escapeHtml(status)}">
            <div class="ticket__row">
              <div>
                <p class="ticket__meta">
                  <span class="badge badge--${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
                  <span>${escapeHtml(when)}</span>
                  <span>${escapeHtml(v.serviceType)}</span>
                </p>
                <h3 class="ticket__title">${escapeHtml(v.clientName)}</h3>
                <p class="ticket__where">${escapeHtml(v.location)}</p>
                <p class="ticket__meta">${escapeHtml(v.technicianName)} � ${escapeHtml(v.clientPhone)}</p>
                <p class="ticket__meta">Updated ${escapeHtml(stamp)}</p>
                ${notes}
                ${reason}
                ${kitBlock}
                ${log}
                <section class="obs">
                  <header class="obs__head">
                    <p class="obs__kicker">Supervisor view</p>
                    <h4>Technician observations</h4>
                    <p class="obs__when">${
                      v.techObservationsAt
                        ? "Saved " + escapeHtml(formatStamp(v.techObservationsAt))
                        : "Not saved yet"
                    }</p>
                  </header>
                  <div class="obs__read ${v.techObservations ? "" : "is-empty"}">${
                    v.techObservations
                      ? escapeHtml(v.techObservations)
                      : "No observations yet."
                  }</div>
                  <label class="obs__label" for="obs-${v.id}">Write or update notes</label>
                  <textarea
                    id="obs-${v.id}"
                    class="obs__input"
                    rows="4"
                    maxlength="2000"
                    placeholder="Findings, follow-up, parts used, site conditions"
                  >${escapeHtml(v.techObservations || "")}</textarea>
                  <button type="button" class="btn btn--primary obs__save" data-save-obs="${v.id}">
                    Save observations
                  </button>
                </section>
                <div class="ticket__actions">
                  <button type="button" class="btn btn--ghost" data-quick-status="in_progress" data-visit="${v.id}">Start</button>
                  <button type="button" class="btn btn--ghost" data-quick-status="completed" data-visit="${v.id}">Done</button>
                  <button type="button" class="btn btn--ghost" data-open-status="rescheduled" data-visit="${v.id}">Reschedule</button>
                  <button type="button" class="btn btn--ghost" data-open-status="cancelled" data-visit="${v.id}">Cancel</button>
                  <button type="button" class="ticket__remove" data-remove="${v.id}">Remove</button>
                </div>
              </div>
            </div>
          </li>`;
      })
      .join("");
    renderDashboard();
  }

  function value(name) {
    return String(form.elements[name].value || "").trim();
  }

  function setFieldError(name, message) {
    const field = form.elements[name].closest(".field");
    const err = form.querySelector('[data-error-for="' + name + '"]');
    field.classList.add("is-invalid");
    form.elements[name].setAttribute("aria-invalid", "true");
    if (err) err.textContent = message;
  }

  function clearFieldError(name) {
    const el = form.elements[name];
    if (!el) return;
    const field = el.closest(".field");
    const err = form.querySelector('[data-error-for="' + name + '"]');
    if (field) field.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
    if (err) err.textContent = "";
  }

  function clearErrors() {
    form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    form.querySelectorAll(".field__error").forEach((el) => {
      el.textContent = "";
    });
  }

  function fillSelect(select, entries) {
    entries.forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
  }

  function renderChecklist(items) {
    const order = ["materials", "tools", "equipment"];
    const labels = {
      materials: "Materials",
      tools: "Tools",
      equipment: "Equipment",
    };
    const groups = { materials: [], tools: [], equipment: [] };
    (items || []).forEach((item) => {
      if (groups[item.category]) groups[item.category].push(item);
    });
    checklistEl.innerHTML = order
      .map((cat) => {
        const rows = groups[cat]
          .map(
            (item) =>
              '<label class="check">' +
              '<input type="checkbox" name="resource" value="' +
              escapeHtml(item.id) +
              '" />' +
              "<span>" +
              escapeHtml(item.name) +
              "</span></label>"
          )
          .join("");
        return (
          '<div class="kit-group" data-category="' +
          cat +
          '"><div class="kit-group__head"><h3>' +
          labels[cat] +
          '</h3><button type="button" class="btn btn--ghost kit-all">All</button></div>' +
          rows +
          "</div>"
        );
      })
      .join("");
    updateKitCount();
  }

  function selectedResourceIds() {
    return Array.from(form.querySelectorAll('input[name="resource"]:checked')).map(
      (el) => el.value
    );
  }

  function updateKitCount() {
    const n = selectedResourceIds().length;
    kitCountEl.textContent = n === 1 ? "1 item selected" : n + " items selected";
    checklistEl.querySelectorAll(".kit-group").forEach((group) => {
      const boxes = Array.from(group.querySelectorAll('input[name="resource"]'));
      const btn = group.querySelector(".kit-all");
      if (!btn || !boxes.length) return;
      btn.textContent = boxes.every((box) => box.checked) ? "None" : "All";
    });
  }

  function openStatusDialog(visit, status) {
    statusForm.reset();
    clearStatusErrors();
    statusForm.elements.visitId.value = visit.id;
    statusForm.elements.status.value = status;
    statusForm.elements.date.value = visit.date;
    statusForm.elements.time.value = visit.time;
    statusForm.elements.date.min = todayISO();
    document.getElementById("status-dialog-title").textContent =
      (STATUS_LABELS[status] || "Update") + " visit";
    document.getElementById("status-dialog-lede").textContent =
      visit.clientName + " � " + formatWhen(visit.date, visit.time);
    onStatusTypeChange();
    statusDialog.showModal();
    if (!reasonFields.hidden) statusForm.elements.reason.focus();
  }

  function onStatusTypeChange() {
    const status = statusForm.elements.status.value;
    const needsReason = status === "rescheduled" || status === "cancelled";
    rescheduleFields.hidden = status !== "rescheduled";
    reasonFields.hidden = !needsReason;
    fillReasonPresets(status);
    statusForm.elements.date.required = status === "rescheduled";
    statusForm.elements.time.required = status === "rescheduled";
  }

  function fillReasonPresets(status) {
    const items = REASON_PRESETS[status] || [];
    reasonPresets.innerHTML = items
      .map(
        (text) =>
          '<button type="button" class="preset" data-preset="' +
          escapeHtml(text) +
          '">' +
          escapeHtml(text) +
          "</button>"
      )
      .join("");
  }

  async function onStatusSubmit(e) {
    e.preventDefault();
    clearStatusErrors();
    const status = statusForm.elements.status.value;
    const reason = String(statusForm.elements.reason.value || "").trim();
    const date = statusForm.elements.date.value;
    const time = statusForm.elements.time.value;
    let blocked = false;
    if ((status === "rescheduled" || status === "cancelled") && reason.length < 3) {
      setStatusFieldError("reason", "Add a reason (at least 3 characters).");
      blocked = true;
    }
    if (status === "rescheduled") {
      if (!date) {
        setStatusFieldError("date", "Pick a new date.");
        blocked = true;
      }
      if (!time) {
        setStatusFieldError("time", "Pick a new time.");
        blocked = true;
      }
    }
    if (blocked) return;
    const payload = { status: status, reason: reason };
    if (status === "rescheduled") {
      payload.date = date;
      payload.time = time;
    }
    const ok = await applyStatus(statusForm.elements.visitId.value, payload);
    if (ok) statusDialog.close();
  }

  async function applyStatus(visitId, payload) {
    try {
      const saved = await api("/visits/" + visitId + "/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      visits = visits.map((v) => (v.id === saved.id ? saved : v));
      render();
      showToast(
        (STATUS_LABELS[saved.status] || saved.status) +
          " at " +
          formatStamp(saved.statusChangedAt)
      );
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    }
  }

  async function applyObservations(visitId, text) {
    try {
      const saved = await api("/visits/" + visitId + "/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations: text }),
      });
      visits = visits.map((v) => (v.id === saved.id ? saved : v));
      render();
      showToast(
        saved.techObservations
          ? "Observations saved at " + formatStamp(saved.techObservationsAt)
          : "Observations cleared."
      );
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    }
  }

  function setStatusFieldError(name, message) {
    const field = statusForm.elements[name].closest(".field");
    const err = statusForm.querySelector('[data-error-for="' + name + '"]');
    field.classList.add("is-invalid");
    if (err) err.textContent = message;
  }

  function clearStatusFieldError(name) {
    const el = statusForm.elements[name];
    if (!el) return;
    const field = el.closest(".field");
    const err = statusForm.querySelector('[data-error-for="' + name + '"]');
    if (field) field.classList.remove("is-invalid");
    if (err) err.textContent = "";
  }

  function clearStatusErrors() {
    statusForm.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
    statusForm.querySelectorAll(".field__error").forEach((el) => {
      el.textContent = "";
    });
  }

  function formatStamp(ms) {
    if (!ms) return "";
    const dt = new Date(Number(ms));
    return dt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function startOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay();
    x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
    return x;
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function toISODate(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function toggleSet(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  function setView(name) {
    const week = name === "week";
    weekView.hidden = !week;
    scheduleView.hidden = week;
    document.querySelectorAll(".view-tabs__btn").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.view === name);
    });
    if (week) renderDashboard();
  }

  function paintFilterChips() {
    document.getElementById("cal-legend").innerHTML = Object.keys(STATUS_LABELS)
      .map((s) => {
        return (
          "<li><span class=\"cal-dot cal-dot--" +
          s +
          "\"></span>" +
          escapeHtml(STATUS_LABELS[s]) +
          "</li>"
        );
      })
      .join("");
    filterTechsEl.innerHTML = TECHNICIANS.map((t) => {
      return (
        '<button type="button" class="filter-chip" data-filter-tech="' +
        t.id +
        '" aria-pressed="false">' +
        escapeHtml(t.name) +
        "</button>"
      );
    }).join("");
    filterStatusesEl.innerHTML = Object.keys(STATUS_LABELS)
      .map((s) => {
        return (
          '<button type="button" class="filter-chip" data-filter-status="' +
          s +
          '" aria-pressed="false">' +
          escapeHtml(STATUS_LABELS[s]) +
          "</button>"
        );
      })
      .join("");
  }

  function weekVisits() {
    weekStart = startOfWeek(new Date());
    const from = toISODate(weekStart);
    const to = toISODate(addDays(weekStart, 13));
    return visits.filter((v) => v.date >= from && v.date <= to);
  }

  function matchesFilters(visit) {
    const techOk =
      !selectedTechs.size || selectedTechs.has(visit.technicianId);
    const statusOk =
      !selectedStatuses.size ||
      selectedStatuses.has(visit.status || "scheduled");
    return techOk && statusOk;
  }

  function renderDashboard() {
    const inWeek = weekVisits();
    const shown = inWeek.filter(matchesFilters);
    const today = todayISO();
    weekLabel.textContent =
      "This week and next � " +
      formatDayLabel(weekStart) +
      " - " +
      formatDayLabel(addDays(weekStart, 13));

    filterTechsEl.querySelectorAll("[data-filter-tech]").forEach((btn) => {
      const id = btn.dataset.filterTech;
      const on = selectedTechs.has(id);
      const n = inWeek.filter((v) => {
        const statusOk =
          !selectedStatuses.size ||
          selectedStatuses.has(v.status || "scheduled");
        return v.technicianId === id && statusOk;
      }).length;
      const tech = TECHNICIANS.find((t) => t.id === id);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = tech.name + " (" + n + ")";
    });

    filterStatusesEl.querySelectorAll("[data-filter-status]").forEach((btn) => {
      const id = btn.dataset.filterStatus;
      const on = selectedStatuses.has(id);
      const n = inWeek.filter((v) => {
        const techOk = !selectedTechs.size || selectedTechs.has(v.technicianId);
        return (v.status || "scheduled") === id && techOk;
      }).length;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = STATUS_LABELS[id] + " (" + n + ")";
    });

    const techNames = TECHNICIANS.filter((t) => selectedTechs.has(t.id)).map(
      (t) => t.name
    );
    const statusNames = Object.keys(STATUS_LABELS)
      .filter((s) => selectedStatuses.has(s))
      .map((s) => STATUS_LABELS[s]);
    const parts = [];
    if (techNames.length) parts.push(techNames.join(" or "));
    if (statusNames.length) parts.push(statusNames.join(" or "));
    const combo = parts.length ? parts.join(" AND ") : "all technicians and statuses";
    filterSummary.textContent =
      shown.length +
      " of " +
      inWeek.length +
      " in this window � " +
      combo;

    const weekdayHead =
      '<div class="cal-scroll"><div class="cal-week cal-week--head">' +
      [0, 1, 2, 3, 4, 5, 6]
        .map((i) => {
          const name = addDays(weekStart, i).toLocaleDateString("en-US", {
            weekday: "short",
          });
          return '<div class="cal-cell">' + escapeHtml(name) + "</div>";
        })
        .join("") +
      "</div></div>";

    function weekBand(title, offset) {
      const cells = [0, 1, 2, 3, 4, 5, 6]
        .map((i) => {
          const day = addDays(weekStart, offset + i);
          const iso = toISODate(day);
          const items = shown
            .filter((v) => v.date === iso)
            .sort((a, b) => a.time.localeCompare(b.time));
          const dow = day.getDay();
          const weekend = dow === 0 || dow === 6;
          const events = items.length
            ? items
                .map((v) => {
                  const status = v.status || "scheduled";
                  return (
                    '<article class="cal-event cal-event--' +
                    escapeHtml(status) +
                    '">' +
                    '<span class="cal-event__time">' +
                    escapeHtml(formatTimeOnly(v.time)) +
                    "</span>" +
                    '<span class="cal-event__title">' +
                    escapeHtml(v.clientName) +
                    "</span>" +
                    '<span class="cal-event__who">' +
                    escapeHtml(v.technicianName) +
                    "</span>" +
                    "</article>"
                  );
                })
                .join("")
            : '<p class="cal-empty">No visits</p>';
          return (
            '<div class="cal-cell' +
            (iso === today ? " is-today" : "") +
            (weekend ? " is-weekend" : "") +
            '"><div class="cal-cell__num"><span>' +
            day.getDate() +
            '</span><span class="cal-cell__n">' +
            items.length +
            "</span></div>" +
            events +
            "</div>"
          );
        })
        .join("");
      return (
        '<section class="cal-band"><p class="cal-band__title">' +
        title +
        '</p><div class="cal-scroll"><div class="cal-week">' +
        cells +
        "</div></div></section>"
      );
    }

    weekGrid.innerHTML =
      weekdayHead +
      weekBand(
        "This week � " + formatDayLabel(weekStart) + " - " + formatDayLabel(addDays(weekStart, 6)),
        0
      ) +
      weekBand(
        "Next week � " +
          formatDayLabel(addDays(weekStart, 7)) +
          " - " +
          formatDayLabel(addDays(weekStart, 13)),
        7
      );
  }

  function formatWeekday(d) {
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function formatDayLabel(d) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatTimeOnly(time) {
    const [hh, mm] = String(time || "00:00").split(":");
    const t = new Date(2000, 0, 1, Number(hh), Number(mm));
    return t.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatWhen(date, time) {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dateLabel = dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const [hh, mm] = time.split(":");
    const t = new Date(2000, 0, 1, Number(hh), Number(mm));
    const timeLabel = t.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return dateLabel + " � " + timeLabel;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, down) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-down", !!down);
  }

  let toastTimer;
  function showToast(message) {
    toastEl.hidden = false;
    toastEl.classList.add("is-on");
    toastEl.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastEl.classList.remove("is-on");
    }, 3200);
  }
})();
