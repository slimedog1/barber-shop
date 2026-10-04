const weekdays = ["Bazar", "Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə", "Şənbə"];

function renderHours(weeklyHours) {
  document.querySelector("#hours-grid").innerHTML = weekdays.map((day, index) => {
    const row = weeklyHours[String(index)] || {};
    const closed = !row.open || !row.close;
    return `<div class="hours-row" data-hours-day="${index}"><strong>${day}</strong><label class="time-field">Açılış<input name="open" type="time" value="${Admin.escapeHtml(row.open || "09:00")}" ${closed ? "disabled" : ""}></label><label class="time-field">Bağlanış<input name="close" type="time" value="${Admin.escapeHtml(row.close || "17:00")}" ${closed ? "disabled" : ""}></label><label class="closed-toggle"><input name="closed" type="checkbox" ${closed ? "checked" : ""}> Bağlıdır</label></div>`;
  }).join("");
}

async function loadHours() {
  const settings = await Admin.api("/api/admin/settings");
  renderHours(settings.weeklyHours || {});
}

document.addEventListener("admin:ready", () => loadHours().catch(Admin.showError));

document.querySelector("#hours-grid").addEventListener("change", (event) => {
  if (event.target.name !== "closed") return;
  event.target.closest(".hours-row").querySelectorAll('input[type="time"]').forEach((input) => { input.disabled = event.target.checked; });
});

document.querySelector("#hours-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const weeklyHours = {};
  for (const row of document.querySelectorAll(".hours-row")) {
    const day = row.dataset.hoursDay;
    const open = row.querySelector('[name="open"]').value;
    const close = row.querySelector('[name="close"]').value;
    if (!row.querySelector('[name="closed"]').checked) weeklyHours[day] = { open, close };
  }
  const message = document.querySelector("#hours-message");
  try {
    await Admin.api("/api/admin/settings/hours", { method: "PUT", body: JSON.stringify({ weeklyHours }) });
    message.textContent = "İş saatları yadda saxlanıldı.";
    message.classList.add("success-message");
    message.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    message.classList.remove("success-message");
    message.hidden = false;
  }
});
