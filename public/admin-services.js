let serviceData = { barbers: [], services: [] };

function selectedServiceBarber() { return document.querySelector("#service-barber").value; }

function renderServices() {
  const barberId = selectedServiceBarber();
  const rows = serviceData.services.filter((service) => service.barberId === barberId);
  document.querySelector("#services-list").innerHTML = rows.length ? rows.map((service) => `<form class="admin-service-card" data-service="${Admin.escapeHtml(service._id)}"><div class="admin-service-heading"><strong>${Admin.escapeHtml(service.name)}</strong><span class="muted">${service.active === false ? "Arxivdədir" : "Aktiv"}</span></div><label>Ad<input name="name" value="${Admin.escapeHtml(service.name)}" required maxlength="100"></label><label>Təsvir<textarea name="description" maxlength="240" rows="2">${Admin.escapeHtml(service.description || "")}</textarea></label><div class="service-number-fields"><label>Qiymət (₼)<input name="price" type="number" min="0.01" max="10000" step="0.01" value="${Admin.escapeHtml(service.price)}" required></label><label>Müddət (dəqiqə)<input name="durationMinutes" type="number" min="10" max="240" step="5" value="${Admin.escapeHtml(service.durationMinutes)}" required></label></div><p class="inline-message message" hidden></p><div class="admin-service-actions"><button class="button button-quiet" type="submit">Yadda saxla <span>→</span></button><button class="button button-quiet" type="button" data-toggle-service="${Admin.escapeHtml(service._id)}" data-active="${service.active !== false}">${service.active === false ? "Yenidən aktiv et" : "Arxivə köçür"}</button></div></form>`).join("") : '<p class="empty">Bu bərbər üçün xidmət yoxdur.</p>';
}

async function loadServices() {
  serviceData = await Admin.api("/api/admin/services");
  const select = document.querySelector("#service-barber");
  const prior = select.value;
  const activeBarbers = serviceData.barbers.filter((barber) => barber.active !== false);
  select.innerHTML = activeBarbers.map((barber) => `<option value="${Admin.escapeHtml(barber._id)}">${Admin.escapeHtml(barber.name)}</option>`).join("");
  if (activeBarbers.some((barber) => barber._id === prior)) select.value = prior;
  renderServices();
}

document.addEventListener("admin:ready", () => loadServices().catch(Admin.showError));
document.querySelector("#service-barber").addEventListener("change", renderServices);

document.querySelector("#service-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#service-message");
  try {
    await Admin.api("/api/admin/services", { method: "POST", body: JSON.stringify({ barberId: selectedServiceBarber(), name: form.elements.name.value, description: form.elements.description.value, price: form.elements.price.value, durationMinutes: form.elements.durationMinutes.value }) });
    form.reset();
    message.hidden = true;
    await loadServices();
    Admin.showNotice("Xidmət əlavə edildi.");
  } catch (error) { message.textContent = error.message; message.hidden = false; }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-service]");
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector(".inline-message");
  try {
    await Admin.api(`/api/admin/services/${encodeURIComponent(form.dataset.service)}`, { method: "PATCH", body: JSON.stringify({ name: form.elements.name.value, description: form.elements.description.value, price: form.elements.price.value, durationMinutes: form.elements.durationMinutes.value }) });
    await loadServices();
    Admin.showNotice("Xidmət məlumatları yadda saxlanıldı.");
  } catch (error) { message.textContent = error.message; message.hidden = false; }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-service]");
  if (!button) return;
  try {
    await Admin.api(`/api/admin/services/${encodeURIComponent(button.dataset.toggleService)}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.active !== "true" }) });
    await loadServices();
    Admin.showNotice(button.dataset.active === "true" ? "Xidmət arxivə köçürüldü." : "Xidmət yenidən aktiv edildi.");
  } catch (error) { Admin.showError(error); }
});
