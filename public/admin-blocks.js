function todayAtShop() {
  const parts = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function loadBlocks() {
  const rows = await Admin.api("/api/admin/blocks");
  const list = document.querySelector("#blocks-list");
  if (!rows.length) {
    list.innerHTML = '<p class="empty">Aktiv blok yoxdur.</p>';
    return;
  }
  list.innerHTML = rows.map((item) => `<article class="block-card"><div><h3>${Admin.escapeHtml(item.barberName || "Bütün salon")}</h3><p>${Admin.escapeHtml(item.date)} · ${item.startTime === "00:00" && item.endTime === "00:00" ? "Bütün gün" : `${Admin.escapeHtml(item.startTime)}–${Admin.escapeHtml(item.endTime)}`}</p>${item.reason ? `<p>${Admin.escapeHtml(item.reason)}</p>` : ""}</div><button class="text-button" type="button" data-delete-block="${Admin.escapeHtml(item.id)}">Sil</button></article>`).join("");
}

async function loadActiveBarbers() {
  const catalog = await Admin.api("/api/catalog");
  const select = document.querySelector("#block-barber");
  select.innerHTML = '<option value="">Bütün salon</option>' + catalog.barbers.map((barber) => `<option value="${Admin.escapeHtml(barber._id)}">${Admin.escapeHtml(barber.name.az)}</option>`).join("");
}

document.addEventListener("admin:ready", () => {
  document.querySelector('[name="date"]').value = todayAtShop();
  Promise.all([loadBlocks(), loadActiveBarbers()]).catch(Admin.showError);
});

document.querySelector("#block-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const message = document.querySelector("#block-message");
  const startTime = values.get("startTime");
  const endTime = values.get("endTime");
  if (Boolean(startTime) !== Boolean(endTime)) {
    message.textContent = "Hər iki saatı daxil edin və ya bütün günü bağlamaq üçün hər ikisini boş saxlayın.";
    message.hidden = false;
    return;
  }
  try {
    await Admin.api("/api/admin/blocks", { method: "POST", body: JSON.stringify({ date: values.get("date"), barberId: values.get("barberId"), startTime, endTime, reason: values.get("reason") }) });
    form.reset();
    document.querySelector('[name="date"]').value = todayAtShop();
    message.hidden = true;
    await loadBlocks();
    Admin.showNotice("Vaxt bloku əlavə edildi.");
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
});

document.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-delete-block]");
  if (!remove || !window.confirm("Bu vaxt blokunu silmək istəyirsiniz?")) return;
  try {
    await Admin.api(`/api/admin/blocks/${encodeURIComponent(remove.dataset.deleteBlock)}`, { method: "DELETE" });
    await loadBlocks();
    Admin.showNotice("Vaxt bloku silindi.");
  } catch (error) { Admin.showError(error); }
});
