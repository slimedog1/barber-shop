const appointmentList = document.querySelector("#appointments-list");
const shopTimezone = "Asia/Baku";

function todayInShopZone() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: shopTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(value, amount) {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function displayDay(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("az-AZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

async function loadAppointments() {
  const date = document.querySelector("#appointment-date").value;
  const status = document.querySelector("#appointment-filter").value;
  const rows = await Admin.api(`/api/admin/appointments?date=${encodeURIComponent(date)}&status=${encodeURIComponent(status)}`);
  document.querySelector("#selected-day-title").textContent = displayDay(date);
  const statusLabels = { confirmed: "təsdiqlənmiş", cancelled: "ləğv edilmiş", all: "bütün statuslar" };
  document.querySelector("#appointment-count").textContent = `${rows.length} görüş · ${statusLabels[status]}`;
  if (!rows.length) {
    appointmentList.innerHTML = '<p class="empty">Bu gün üçün görüş yoxdur.</p>';
    return;
  }
  appointmentList.innerHTML = rows.map((item) => `
    <article class="appointment-card">
      <div class="appointment-time">${Admin.escapeHtml(item.time)}</div>
      <div class="appointment-details"><div class="appointment-top"><div><h3>${Admin.escapeHtml(item.customerName)}</h3><p><a href="mailto:${Admin.escapeHtml(item.customerEmail)}">${Admin.escapeHtml(item.customerEmail)}</a></p></div><span class="badge ${item.status === "cancelled" ? "cancelled" : ""}">${item.status === "cancelled" ? "ləğv edilib" : "təsdiqlənib"}</span></div>
        <div class="appointment-bottom"><p><strong>${Admin.escapeHtml(item.serviceName)}</strong> · ₼${Admin.escapeHtml(item.servicePrice)} · ${Admin.escapeHtml(item.serviceDurationMinutes)} dəq.</p><p>${Admin.escapeHtml(item.barberName)}</p>${item.note ? `<p>Qeyd: ${Admin.escapeHtml(item.note)}</p>` : ""}${item.cancellationReason ? `<p>Ləğv səbəbi: ${Admin.escapeHtml(item.cancellationReason)}</p>` : ""}</div>
        ${item.status === "confirmed" ? `<div class="appointment-actions"><button class="text-button" type="button" data-cancel-appointment="${Admin.escapeHtml(item.id)}">Görüşü ləğv et</button></div>` : ""}
      </div>
    </article>`).join("");
}

document.addEventListener("admin:ready", () => {
  const dateInput = document.querySelector("#appointment-date");
  if (!dateInput.value) dateInput.value = todayInShopZone();
  loadAppointments().catch(Admin.showError);
});

document.querySelector("#appointment-date").addEventListener("change", () => loadAppointments().catch(Admin.showError));
document.querySelector("#appointment-filter").addEventListener("change", () => loadAppointments().catch(Admin.showError));
document.querySelector("#date-prev").addEventListener("click", () => { const input = document.querySelector("#appointment-date"); input.value = shiftDate(input.value, -1); loadAppointments().catch(Admin.showError); });
document.querySelector("#date-next").addEventListener("click", () => { const input = document.querySelector("#appointment-date"); input.value = shiftDate(input.value, 1); loadAppointments().catch(Admin.showError); });
document.querySelector("#date-today").addEventListener("click", () => { document.querySelector("#appointment-date").value = todayInShopZone(); loadAppointments().catch(Admin.showError); });

document.addEventListener("click", async (event) => {
  const cancel = event.target.closest("[data-cancel-appointment]");
  if (!cancel || !window.confirm("Bu görüşü ləğv etmək istəyirsiniz? Müştəriyə e-poçt bildirişi göndərilə bilər.")) return;
  const reason = window.prompt("Müştəri üçün ləğv qeydi (istəyə bağlı):", "") || "";
  try {
    await Admin.api(`/api/admin/appointments/${encodeURIComponent(cancel.dataset.cancelAppointment)}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) });
    await loadAppointments();
  } catch (error) { Admin.showError(error); }
});
